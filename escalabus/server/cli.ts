import readline from 'node:readline/promises';
import { config } from './config';
import { openDb, migrate } from './db';
import { upsertAdmin } from './auth';
import { seedDemo } from './demo';

const cfg = config();
const cmd = process.argv[2];

async function main() {
  if (cmd === 'migrate') {
    for (const f of [cfg.dbFile, cfg.demoDbFile]) {
      const db = openDb(f);
      console.log(`${f}: ${migrate(db).length ? 'migrações aplicadas' : 'esquema atualizado'}`);
      db.close();
    }
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
    const db = openDb(cfg.dbFile);
    upsertAdmin(db, user, pw);
    console.log(`Administrador "${user}" salvo. Sessões anteriores desse usuário foram encerradas.`);
  } else if (cmd === 'demo-reset') {
    seedDemo(openDb(cfg.demoDbFile));
    console.log('Banco de demonstração recriado com dados fictícios.');
  } else {
    console.log('Comandos: migrate | create-admin | demo-reset');
    process.exit(1);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
