import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, prepareDatabase } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db.js';

// Servidor próprio (computador, VPS, Tailscale). Na Vercel o ponto de entrada é api/index.ts.
const cfg = config();
if (!cfg.databaseUrl) fs.mkdirSync(cfg.pgliteDir, { recursive: true });
const db = await openDatabase({ databaseUrl: cfg.databaseUrl, pgliteDir: cfg.databaseUrl ? undefined : cfg.pgliteDir, schemaPrefix: cfg.schemaPrefix });

const opts = {
  db, secureCookies: cfg.secureCookies, seedRealData: cfg.seedRealData,
  initialAdmin: { username: cfg.adminUsername, password: cfg.adminPassword },
  staticDir: path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist'),
};
await prepareDatabase(opts);
const hasAdmin = await db.tx('real', async (q) => (await q('SELECT 1 FROM users LIMIT 1')).length > 0);
if (!hasAdmin) {
  console.error('Nenhum administrador cadastrado. Defina ADMIN_USERNAME e ADMIN_PASSWORD no .env ou rode: npm run create-admin');
  process.exit(1);
}

const app = createApp(opts);
const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`EscalaBus ouvindo em http://${cfg.host}:${cfg.port} (banco: ${cfg.databaseUrl ? 'Postgres/Supabase' : cfg.pgliteDir})`);
});
const shutdown = () => server.close(() => { void db.close().finally(() => process.exit(0)); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
