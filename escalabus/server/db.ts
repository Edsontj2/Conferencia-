import type { Pool as PgPool } from 'pg';
import { MIGRATIONS } from './migrations.js';

/**
 * Acesso ao Postgres. Produção: Supabase (pg + pooler). Local/testes: PGlite (Postgres embutido).
 *
 * Os dados reais e os de demonstração ficam em schemas separados do mesmo banco.
 * Cada operação roda numa transação com `SET LOCAL search_path`, o que funciona com o
 * pooler em modo transação do Supabase (serverless).
 */
export type Row = Record<string, unknown>;
export type Q = <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;
export type Mode = 'real' | 'demo';

export interface Database {
  tx<T>(mode: Mode, fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly schemas: Record<Mode, string>;
}

/** Converte `?` em `$1, $2…` (as consultas do app não usam `?` dentro de textos literais). */
export function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;
function schemaNames(prefix = 'escalabus'): Record<Mode, string> {
  if (!SCHEMA_RE.test(prefix)) throw new Error('DB_SCHEMA inválido.');
  return { real: prefix, demo: `${prefix}_demo` };
}

interface Runner {
  run<T>(fn: (exec: (sql: string, params?: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function pgRunner(pool: PgPool): Runner {
  return {
    async run(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows);
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pgliteRunner(dataDir?: string): Promise<Runner> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    run: (fn) => db.transaction((tx) => fn(async (sql, params) => {
      // Sem parâmetros usa exec (aceita vários comandos, como nas migrations)
      if (!params || params.length === 0) {
        const rs = await tx.exec(sql);
        return (rs[rs.length - 1]?.rows ?? []) as Row[];
      }
      return (await tx.query<Row>(sql, params as unknown[])).rows;
    })),
    close: () => db.close(),
  };
}

function makeDatabase(runner: Runner, schemas: Record<Mode, string>): Database {
  return {
    schemas,
    tx(mode, fn) {
      return runner.run(async (exec) => {
        await exec(`SET LOCAL search_path TO "${schemas[mode]}"`);
        const q: Q = async <T>(sql: string, params: unknown[] = []) => (await exec(toPg(sql), params)) as T[];
        return fn(q);
      });
    },
    close: () => runner.close(),
  };
}

/**
 * Remove parâmetros que o driver `pg` interpretaria por conta própria (sslmode, supa, pgbouncer),
 * como os incluídos na POSTGRES_URL da integração Vercel + Supabase. O SSL é configurado abaixo.
 */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of ['sslmode', 'supa', 'pgbouncer', 'sslrootcert']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * O pooler do Supabase fica em clusters diferentes conforme o projeto (aws-0-…, aws-1-…).
 * Se o endereço informado responder "Tenant or user not found", tenta os outros clusters da mesma região.
 */
export function poolerCandidates(url: string): string[] {
  const m = /@aws-(\d+)-([a-z0-9-]+)\.pooler\.supabase\.com/.exec(url);
  if (!m) return [url];
  const others = [0, 1, 2].filter((n) => String(n) !== m[1])
    .map((n) => url.replace(`@aws-${m[1]}-${m[2]}.pooler`, `@aws-${n}-${m[2]}.pooler`));
  return [url, ...others];
}

export interface DbOptions {
  /** postgres://… (Supabase). Vazio = PGlite em `pgliteDir` (ou em memória). */
  databaseUrl?: string;
  pgliteDir?: string;
  schemaPrefix?: string;
}

export async function openDatabase(opts: DbOptions = {}): Promise<Database> {
  const schemas = schemaNames(opts.schemaPrefix);
  let runner: Runner;
  if (opts.databaseUrl) {
    const pg = await import('pg');
    const Pool = pg.default?.Pool ?? (pg as unknown as { Pool: typeof PgPool }).Pool;
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(opts.databaseUrl);
    const makePool = (url: string) => new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
    let pool: PgPool | null = null;
    let lastErr: unknown = null;
    for (const url of poolerCandidates(cleanUrl(opts.databaseUrl))) {
      const p = makePool(url);
      try {
        await p.query('SELECT 1');
        pool = p;
        break;
      } catch (e) {
        lastErr = e;
        await p.end().catch(() => {});
        if (!/tenant or user not found/i.test(String((e as Error).message))) break;
      }
    }
    if (!pool) throw lastErr;
    runner = pgRunner(pool);
  } else {
    runner = await pgliteRunner(opts.pgliteDir);
  }
  const db = makeDatabase(runner, schemas);
  await migrate(runner, schemas);
  return db;
}

/** Aplica as migrations pendentes nos dois schemas, com trava para várias instâncias simultâneas. */
async function migrate(runner: Runner, schemas: Record<Mode, string>): Promise<void> {
  await runner.run(async (exec) => {
    await exec('SELECT pg_advisory_xact_lock(7300451)');
    for (const mode of ['real', 'demo'] as Mode[]) {
      const s = schemas[mode];
      await exec(`CREATE SCHEMA IF NOT EXISTS "${s}"`);
      await exec(`SET LOCAL search_path TO "${s}"`);
      await exec('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at text NOT NULL)');
      const done = new Set((await exec('SELECT version FROM schema_migrations')).map((r) => r.version as string));
      for (const m of MIGRATIONS) {
        if (done.has(m.name) || (m.scope === 'auth' && mode !== 'real')) continue;
        await exec(m.sql);
        await exec('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [m.name, nowIso()]);
      }
      // No Supabase, impede acesso pela API pública (PostgREST) com as chaves anon/authenticated.
      await exec(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          EXECUTE 'REVOKE ALL ON SCHEMA "${s}" FROM anon, authenticated';
          EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "${s}" FROM anon, authenticated';
        END IF; END $$`);
    }
  });
}

export const nowIso = () => new Date().toISOString();
export const toInt = (v: unknown) => Number(v ?? 0);
