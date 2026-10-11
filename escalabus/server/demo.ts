import type { DB } from './db';
import { nowIso } from './db';
import { BACKUP_TABLES } from './backup';
import { saveSettings, listPeople, listServices, listLines, listBuses } from './repo';
import { buildSlotsFromServices, generateSchedule } from '../shared/generator';
import { addDays, nextSaturday, todayLocal } from '../shared/time';

/**
 * Popula o banco de DEMONSTRAÇÃO (arquivo separado do banco real) com dados fictícios.
 * Todos os nomes levam o sufixo "(fictício)" e a empresa é identificada como demonstração.
 */
export function seedDemo(db: DB) {
  const now = nowIso();
  db.transaction(() => {
    for (const t of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    saveSettings(db, { companyName: 'Viação Exemplo – DEMONSTRAÇÃO', maxServicesPerDay: 1 });
    const pi = db.prepare(`INSERT INTO people (name, role, shift_name, avail_start, avail_end, whatsapp, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Fábio', 'Gabriela', 'Hugo', 'Isabel', 'João', 'Karina', 'Lucas', 'Marina', 'Nelson', 'Olívia', 'Paulo', 'Quésia', 'Rafael', 'Sílvia', 'Tiago', 'Úrsula', 'Vítor', 'Wanda', 'Xavier', 'Yara', 'Zeca', 'Alice', 'Bento', 'Cecília', 'Davi', 'Elisa', 'Fernando'];
    const last = ['Souza', 'Lima', 'Pereira', 'Costa', 'Rocha', 'Alves', 'Gomes', 'Ribeiro'];
    const shifts: [string, string, string][] = [['Manhã', '04:30', '13:00'], ['Tarde', '11:00', '20:00'], ['Noite', '17:30', '01:30'], ['Integral', '00:00', '00:00']];
    const names = [...first, ...first.slice(0, 16).map((f) => f + ' ' + 'Neto')];
    names.forEach((f, i) => {
      const [sn, a, b] = shifts[Math.floor(i / 2) % 4];
      const role = i % 2 === 0 ? 'motorista' : 'cobrador';
      const phone = i % 3 === 0 ? `55119${String(90000000 + i * 1234567).slice(0, 8)}` : null;
      pi.run(`${f} ${last[i % last.length]} (fictício)`, role, sn, a, b, phone, i === 46 ? 0 : 1, now, now);
    });
    const li = db.prepare('INSERT INTO lines (code, description, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    const lines = [['0.783', 'Terminal Centro – Jardim Exemplo'], ['141.8', 'Rodoviária – Vila Fictícia'], ['2.10', 'Circular Bairro Modelo'], ['305', 'Estação – Parque Imaginário']];
    for (const [c, d] of lines) li.run(c, d, now, now);
    const bi = db.prepare('INSERT INTO buses (fleet_number, plate, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    ['2201', '2202', '2203', '2204', '2205', '2206'].forEach((n, i) => bi.run(n, `DEM${i}A0${i}`, now, now));
    const si = db.prepare(`INSERT INTO services (weekday, line_id, bus_id, start_time, end_time, shift_name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    const tpl: [number, number, number, string, string, string][] = [
      [6, 1, 1, '05:00', '11:30', 'Manhã'], [6, 2, 2, '05:30', '12:00', 'Manhã'], [6, 3, 3, '06:00', '12:30', 'Manhã'],
      [6, 1, 1, '12:00', '18:30', 'Tarde'], [6, 4, 4, '12:30', '19:00', 'Tarde'],
      [6, 2, 2, '18:20', '00:20', 'Noite'],
      [0, 1, 1, '06:00', '12:30', 'Manhã'], [0, 2, 5, '06:30', '13:00', 'Manhã'],
      [0, 3, 3, '13:00', '19:00', 'Tarde'], [0, 1, 6, '18:20', '00:20', 'Noite'],
    ];
    for (const t of tpl) si.run(...t, now, now);
    db.prepare('INSERT INTO recipients (name, phone, created_at) VALUES (?, ?, ?)').run('Plantão Tráfego (fictício)', '5511900000000', now);

    // Fim de semana anterior já confirmado, para a regra de alternância funcionar na demonstração.
    const prevSat = addDays(nextSaturday(todayLocal()), -7);
    const people = listPeople(db);
    const slots = buildSlotsFromServices(prevSat, listServices(db), listLines(db), listBuses(db));
    const g = generateSchedule({ entries: slots.entries, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed: 42 });
    const sid = Number(db.prepare(`INSERT INTO schedules (saturday, status, version, notes, created_at, updated_at, confirmed_at) VALUES (?, 'confirmada', 1, 'Histórico fictício', ?, ?, ?)`).run(prevSat, now, now, now).lastInsertRowid);
    const ei = db.prepare(`INSERT INTO schedule_entries (uid, schedule_id, position, date, service_id, line_id, line_code, line_description, bus_id, bus_fleet, bus_plate, start_time, end_time, shift_name, driver_id, driver_name, conductor_id, conductor_name)
      VALUES (@id, ${sid}, @pos, @date, @serviceId, @lineId, @lineCode, @lineDescription, @busId, @busFleet, @busPlate, @startTime, @endTime, @shiftName, @driverId, @driverName, @conductorId, @conductorName)`);
    g.entries.forEach((e, pos) => ei.run({ ...e, pos }));
    db.prepare(`INSERT INTO schedule_audit (schedule_id, at, username, action, summary) VALUES (?, ?, 'demo', 'confirmada', 'Histórico fictício gerado para demonstração.')`).run(sid, now);
  })();
}

export function ensureDemoSeeded(db: DB) {
  const n = db.prepare('SELECT COUNT(*) FROM people').pluck().get() as number;
  if (n === 0) seedDemo(db);
}
