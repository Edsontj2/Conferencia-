import type { Q } from './db.js';
import { nowIso, toInt } from './db.js';
import { BACKUP_TABLES } from './backup.js';
import { saveSettings, listPeople, listServices, listLines, listBuses, writeEntries } from './repo.js';
import { buildSlotsFromServices, generateSchedule } from '../shared/generator.js';
import { addDays, nextSaturday, todayLocal } from '../shared/time.js';

/**
 * Popula o banco de DEMONSTRAÇÃO (arquivo separado do banco real) com dados fictícios.
 * Todos os nomes levam o sufixo "(fictício)" e a empresa é identificada como demonstração.
 */
/** q deve estar no schema de demonstração. */
export async function seedDemo(q: Q) {
  const now = nowIso();
  {
    for (const t of [...BACKUP_TABLES].reverse()) await q(`DELETE FROM ${t}`);
    await saveSettings(q, { companyName: 'Viação Exemplo – DEMONSTRAÇÃO', maxServicesPerDay: 1 });
    const pi = { run: (...a: unknown[]) => q(`INSERT INTO people (name, role, shift_name, avail_start, avail_end, whatsapp, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, a) };
    const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Fábio', 'Gabriela', 'Hugo', 'Isabel', 'João', 'Karina', 'Lucas', 'Marina', 'Nelson', 'Olívia', 'Paulo', 'Quésia', 'Rafael', 'Sílvia', 'Tiago', 'Úrsula', 'Vítor', 'Wanda', 'Xavier', 'Yara', 'Zeca', 'Alice', 'Bento', 'Cecília', 'Davi', 'Elisa', 'Fernando'];
    const last = ['Souza', 'Lima', 'Pereira', 'Costa', 'Rocha', 'Alves', 'Gomes', 'Ribeiro'];
    const shifts: [string, string, string][] = [['Manhã', '04:30', '13:00'], ['Tarde', '11:00', '20:00'], ['Noite', '17:30', '01:30'], ['Integral', '00:00', '00:00']];
    const names = [...first, ...first.slice(0, 16).map((f) => f + ' ' + 'Neto')];
    for (const [i, f] of names.entries()) {
      const [sn, a, b] = shifts[Math.floor(i / 2) % 4];
      const role = i % 2 === 0 ? 'motorista' : 'cobrador';
      const phone = i % 3 === 0 ? `55119${String(90000000 + i * 1234567).slice(0, 8)}` : null;
      await pi.run(`${f} ${last[i % last.length]} (fictício)`, role, sn, a, b, phone, i === 46 ? 0 : 1, now, now);
    }
    const li = { run: (...a: unknown[]) => q('INSERT INTO lines (code, description, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', a) };
    const lines = [['0.783', 'Terminal Centro – Jardim Exemplo'], ['141.8', 'Rodoviária – Vila Fictícia'], ['2.10', 'Circular Bairro Modelo'], ['305', 'Estação – Parque Imaginário']];
    for (const [c, d] of lines) await li.run(c, d, now, now);
    for (const [i, n] of ['2201', '2202', '2203', '2204', '2205', '2206'].entries()) {
      await q('INSERT INTO buses (fleet_number, plate, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [n, `DEM${i}A0${i}`, now, now]);
    }
    const lineIds = (await listLines(q)).map((l) => l.id).sort((a, b) => a - b);
    const busIds = (await listBuses(q)).map((b) => b.id).sort((a, b) => a - b);
    const tpl: [number, number, number, string, string, string][] = [
      [6, 1, 1, '05:00', '11:30', 'Manhã'], [6, 2, 2, '05:30', '12:00', 'Manhã'], [6, 3, 3, '06:00', '12:30', 'Manhã'],
      [6, 1, 1, '12:00', '18:30', 'Tarde'], [6, 4, 4, '12:30', '19:00', 'Tarde'],
      [6, 2, 2, '18:20', '00:20', 'Noite'],
      [0, 1, 1, '06:00', '12:30', 'Manhã'], [0, 2, 5, '06:30', '13:00', 'Manhã'],
      [0, 3, 3, '13:00', '19:00', 'Tarde'], [0, 1, 6, '18:20', '00:20', 'Noite'],
    ];
    for (const [wd, l, bu, st, en, sh] of tpl) {
      await q(`INSERT INTO services (weekday, line_id, bus_id, start_time, end_time, shift_name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [wd, lineIds[l - 1], busIds[bu - 1], st, en, sh, now, now]);
    }
    await q('INSERT INTO recipients (name, phone, created_at) VALUES (?, ?, ?)', ['Plantão Tráfego (fictício)', '5511900000000', now]);

    // Fim de semana anterior já confirmado, para a regra de alternância funcionar na demonstração.
    const prevSat = addDays(nextSaturday(todayLocal()), -7);
    const people = await listPeople(q);
    const slots = buildSlotsFromServices(prevSat, await listServices(q), await listLines(q), await listBuses(q));
    const g = generateSchedule({ entries: slots.entries, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed: 42 });
    const [{ id: sid }] = await q<{ id: number }>(`INSERT INTO schedules (saturday, status, version, notes, created_at, updated_at, confirmed_at) VALUES (?, 'confirmada', 1, 'Histórico fictício', ?, ?, ?) RETURNING id`, [prevSat, now, now, now]);
    await writeEntries(q, sid, g.entries);
    await q(`INSERT INTO schedule_audit (schedule_id, at, username, action, summary) VALUES (?, ?, 'demo', 'confirmada', 'Histórico fictício gerado para demonstração.')`, [sid, now]);
  }
}

export async function ensureDemoSeeded(q: Q) {
  const [r] = await q('SELECT COUNT(*) AS n FROM people');
  if (toInt(r.n) === 0) await seedDemo(q);
}
