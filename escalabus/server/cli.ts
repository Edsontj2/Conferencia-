import fs from 'node:fs';
import readline from 'node:readline/promises';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { upsertAdmin } from './auth.js';
import { seedDemo } from './demo.js';
import { applySeeds } from './seed.js';

const cfg = config();
const cmd = process.argv[2];

async function main() {
  if (!cfg.databaseUrl) fs.mkdirSync(cfg.pgliteDir, { recursive: true });
  const open = () => openDatabase({ databaseUrl: cfg.databaseUrl, pgliteDir: cfg.databaseUrl ? undefined : cfg.pgliteDir, schemaPrefix: cfg.schemaPrefix });
  if (cmd === 'migrate') {
    const db = await open(); // aplica migrations ao abrir
    if (cfg.seedRealData) await db.tx('real', applySeeds);
    await db.close();
    console.log('Banco atualizado.');
  } else if (cmd === 'create-admin') {
    let user = cfg.adminUsername;
    let pw = cfg.adminPassword;
    // --env: usa ADMIN_USERNAME/ADMIN_PASSWORD do ambiente (usado pelo script de instalação)
    if (!process.argv.includes('--env')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      user = (await rl.question(`Usuário [${cfg.adminUsername}]: `)).trim() || cfg.adminUsername;
      pw = await rl.question('Senha (mín. 8 caracteres): ');
      rl.close();
    }
    const db = await open();
    await db.tx('real', (q) => upsertAdmin(q, user, pw));
    await db.close();
    console.log(`Administrador "${user}" salvo. Sessões anteriores desse usuário foram encerradas.`);
  } else if (cmd === 'has-admin') {
    const db = await open();
    const n = await db.tx('real', async (q) => (await q('SELECT 1 FROM users LIMIT 1')).length);
    await db.close();
    console.log(n);
  } else if (cmd === 'demo-reset') {
    const db = await open();
    await db.tx('demo', seedDemo);
    await db.close();
    console.log('Dados de demonstração recriados.');
  } else {
    console.log('Comandos: migrate | create-admin | demo-reset');
    process.exit(1);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
