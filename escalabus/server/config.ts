import fs from 'node:fs';
import path from 'node:path';

/** Carrega um arquivo .env simples (CHAVE=valor) sem sobrescrever variáveis já definidas. */
export function loadEnv(file = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function config() {
  loadEnv();
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    /** Supabase/Postgres. Vazio = Postgres embutido (PGlite) em DATA_DIR/pglite. */
    databaseUrl: process.env.DATABASE_URL || '',
    pgliteDir: path.join(dataDir, 'pglite'),
    schemaPrefix: process.env.DB_SCHEMA || 'escalabus',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    seedRealData: process.env.SEED_REAL_DATA !== 'false',
    secureCookies: process.env.COOKIE_SECURE === 'true' ? true : process.env.COOKIE_SECURE === 'false' ? false : undefined,
  };
}

export type Config = ReturnType<typeof config>;
