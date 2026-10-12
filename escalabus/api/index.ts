import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp, prepareDatabase } from '../server/app.js';
import { config } from '../server/config.js';
import { openDatabase } from '../server/db.js';

/**
 * Função serverless da Vercel: toda requisição /api/* chega aqui (ver vercel.json).
 * O banco é o Postgres do Supabase (DATABASE_URL). A conexão e o app são reaproveitados
 * entre requisições enquanto a instância estiver ativa.
 */
let ready: Promise<ReturnType<typeof createApp>> | null = null;

async function init() {
  const cfg = config();
  if (!cfg.databaseUrl) throw new Error('Banco não configurado: conecte o Supabase ao projeto na Vercel (Storage → Connect) ou defina DATABASE_URL.');
  const db = await openDatabase({ databaseUrl: cfg.databaseUrl, schemaPrefix: cfg.schemaPrefix });
  const opts = {
    db, secureCookies: cfg.secureCookies ?? true, seedRealData: cfg.seedRealData,
    initialAdmin: { username: cfg.adminUsername, password: cfg.adminPassword },
  };
  await prepareDatabase(opts);
  return createApp(opts);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    ready ??= init();
    const app = await ready;
    app(req as never, res as never);
  } catch (e) {
    ready = null;
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `Servidor não configurado: ${(e as Error).message}` }));
  }
}
