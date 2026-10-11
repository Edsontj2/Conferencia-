import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { config } from './config';
import { openDb } from './db';
import { upsertAdmin } from './auth';

const cfg = config();
const mainDb = openDb(cfg.dbFile);
const demoDb = openDb(cfg.demoDbFile);

const users = mainDb.prepare('SELECT COUNT(*) FROM users').pluck().get() as number;
if (users === 0) {
  if (!cfg.adminPassword) {
    console.error('Nenhum administrador cadastrado. Defina ADMIN_USERNAME e ADMIN_PASSWORD no .env ou rode: npm run create-admin');
    process.exit(1);
  }
  upsertAdmin(mainDb, cfg.adminUsername, cfg.adminPassword);
  console.log(`Administrador "${cfg.adminUsername}" criado a partir do .env.`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = createApp({
  mainDb, demoDb, secureCookies: cfg.secureCookies, backupDir: cfg.backupDir,
  staticDir: path.join(root, 'dist'), // frontend compilado (npm run build); ignorado se não existir
});

const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`EscalaBus ouvindo em http://${cfg.host}:${cfg.port} (dados em ${cfg.dataDir})`);
});
const shutdown = () => server.close(() => { mainDb.close(); demoDb.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
