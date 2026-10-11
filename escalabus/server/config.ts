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
    dataDir,
    dbFile: path.join(dataDir, 'escalabus.db'),
    demoDbFile: path.join(dataDir, 'escalabus-demo.db'),
    backupDir: path.join(dataDir, 'backups'),
    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword: process.env.ADMIN_PASSWORD ?? '',
    secureCookies: process.env.COOKIE_SECURE === 'true' ? true : process.env.COOKIE_SECURE === 'false' ? false : undefined,
  };
}
