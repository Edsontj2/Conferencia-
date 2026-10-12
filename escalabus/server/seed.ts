import crypto from 'node:crypto';
import type { Q } from './db.js';
import { nowIso } from './db.js';
import * as repo from './repo.js';
import { SEED_DAYS, type SeedDay } from './seed-data.js';
import { validateSchedule, buildContextMaps } from '../shared/rules.js';
import { weekdayOf, weekendSaturdayOf } from '../shared/time.js';
import type { Entry } from '../shared/types.js';

/** Janela de disponibilidade padrão por turno (ajustável depois em Pessoas). */
const SHIFT_WINDOWS: Record<string, [string, string]> = { 'Manhã': ['05:00', '18:00'], 'Tarde': ['10:00', '00:00'] };
const sortShifts = (s: Set<string>) => [...s].sort((a, b) => (a === 'Manhã' ? -1 : b === 'Manhã' ? 1 : a.localeCompare(b)));
export function shiftWindow(shifts: Set<string>): { start: string; end: string } {
  const ws = [...shifts].map((x) => SHIFT_WINDOWS[x]).filter(Boolean);
  if (!ws.length) return { start: '00:00', end: '00:00' };
  return { start: ws.map((w) => w[0]).sort()[0], end: ws.some((w) => w[1] < w[0]) ? ws.find((w) => w[1] < w[0])![1] : ws.map((w) => w[1]).sort().reverse()[0] };
}

/** Aplica os lotes de dados reais ainda não aplicados (q no schema real). */
export async function applySeeds(q: Q) {
  for (const day of SEED_DAYS) {
    const [done] = await q('SELECT 1 FROM schema_migrations WHERE version = ?', [day.name]);
    if (done) continue;
    await applyDay(q, day);
    await q('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [day.name, nowIso()]);
  }
  // Ajuste único: a primeira importação usava só o horário trabalhado no dia como disponibilidade (estreito demais).
  const FIX = 'seed_turnos_padrao_v1';
  if (!(await q('SELECT 1 FROM schema_migrations WHERE version = ?', [FIX])).length) {
    const seeded = new Map<string, Set<string>>();
    for (const d of SEED_DAYS) for (const sec of d.sections) for (const r of sec.rows) {
      for (const k of [`motorista|${r.motorista}`, `cobrador|${r.cobrador}`]) seeded.set(k, (seeded.get(k) ?? new Set()).add(sec.shift));
    }
    for (const [k, shifts] of seeded) {
      const [role, name] = k.split('|');
      const w = shiftWindow(shifts);
      await q('UPDATE people SET avail_start = ?, avail_end = ?, shift_name = ?, updated_at = ? WHERE lower(name) = lower(?) AND role = ?',
        [w.start, w.end, sortShifts(shifts).join(' e '), nowIso(), name, role]);
    }
    await q('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [FIX, nowIso()]);
  }
  // Regime definido pela empresa: Manhã 05:00–18:00, Tarde 10:00–00:00, os dois turnos 05:00–00:00.
  const FIX2 = 'turnos_regime_v2';
  if (!(await q('SELECT 1 FROM schema_migrations WHERE version = ?', [FIX2])).length) {
    for (const [shiftName, shifts] of [['Manhã', ['Manhã']], ['Tarde', ['Tarde']], ['Manhã e Tarde', ['Manhã', 'Tarde']]] as const) {
      const w = shiftWindow(new Set(shifts));
      await q('UPDATE people SET avail_start = ?, avail_end = ?, updated_at = ? WHERE shift_name = ?', [w.start, w.end, nowIso(), shiftName]);
    }
    await q('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [FIX2, nowIso()]);
  }
}

async function applyDay(q: Q, day: SeedDay) {
  const now = nowIso();
  const saturday = weekendSaturdayOf(day.date);
  if (!saturday) throw new Error(`${day.date} não é sábado nem domingo.`);
  const weekday = weekdayOf(day.date) as 0 | 6;
  const rows = day.sections.flatMap((s) => s.rows.map((r) => ({ ...r, shift: s.shift })));

  // Duas escalas no mesmo dia para a mesma pessoa (dobra) exigem limite >= 2
  const perPerson = new Map<string, number>();
  for (const r of rows) for (const n of [`m:${r.motorista}`, `c:${r.cobrador}`]) perPerson.set(n, (perPerson.get(n) ?? 0) + 1);
  const settings = await repo.getSettings(q);
  const maxNeeded = Math.max(...perPerson.values());
  if (settings.maxServicesPerDay < maxNeeded) await repo.saveSettings(q, { ...settings, maxServicesPerDay: maxNeeded });

  // Linhas e carros
  const lineId = new Map<string, number>();
  for (const code of new Set(rows.map((r) => r.linha))) {
    const [ex] = await q<{ id: number }>('SELECT id FROM lines WHERE code = ?', [code]);
    lineId.set(code, ex ? ex.id : (await q<{ id: number }>('INSERT INTO lines (code, description, active, created_at, updated_at) VALUES (?, NULL, 1, ?, ?) RETURNING id', [code, now, now]))[0].id);
  }
  const busId = new Map<string, number>();
  for (const fleet of new Set(rows.map((r) => r.carro).filter((x): x is string => !!x))) {
    const [ex] = await q<{ id: number }>('SELECT id FROM buses WHERE fleet_number = ?', [fleet]);
    busId.set(fleet, ex ? ex.id : (await q<{ id: number }>(`INSERT INTO buses (fleet_number, plate, active, created_at, updated_at) VALUES (?, '', 1, ?, ?) RETURNING id`, [fleet, now, now]))[0].id);
  }

  // Pessoas: disponibilidade = janela padrão dos turnos em que trabalham (Manhã, Tarde ou os dois)
  const people = new Map<string, { role: 'motorista' | 'cobrador'; shifts: Set<string> }>();
  for (const r of rows) {
    for (const [name, role] of [[r.motorista, 'motorista'], [r.cobrador, 'cobrador']] as const) {
      const k = `${role}|${name}`;
      const p = people.get(k) ?? { role, shifts: new Set<string>() };
      p.shifts.add(r.shift);
      people.set(k, p);
    }
  }
  const personId = new Map<string, number>();
  for (const [k, p] of people) {
    const name = k.split('|')[1];
    const [ex] = await q<{ id: number; shift_name: string }>('SELECT id, shift_name FROM people WHERE lower(name) = lower(?) AND role = ?', [name, p.role]);
    const shifts = new Set([...(ex ? ex.shift_name.split(' e ') : []), ...p.shifts]);
    const w = shiftWindow(shifts);
    const shiftName = sortShifts(shifts).join(' e ');
    if (ex) {
      await q('UPDATE people SET avail_start = ?, avail_end = ?, shift_name = ?, updated_at = ? WHERE id = ?', [w.start, w.end, shiftName, now, ex.id]);
      personId.set(k, ex.id);
      continue;
    }
    const [{ id }] = await q<{ id: number }>(`INSERT INTO people (name, role, shift_name, avail_start, avail_end, whatsapp, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?) RETURNING id`, [name, p.role, shiftName, w.start, w.end, now, now]);
    personId.set(k, id);
  }

  // Serviços-modelo do dia da semana
  const svcId: number[] = [];
  for (const r of rows) {
    const b = r.carro ? busId.get(r.carro)! : null;
    const [ex] = await q<{ id: number }>(`SELECT id FROM services WHERE weekday = ? AND line_id = ? AND bus_id IS NOT DISTINCT FROM ? AND start_time = ? AND end_time = ?`,
      [weekday, lineId.get(r.linha), b, r.hora, r.rend]);
    svcId.push(ex ? ex.id : (await q<{ id: number }>(`INSERT INTO services (weekday, line_id, bus_id, start_time, end_time, shift_name, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`, [weekday, lineId.get(r.linha), b, r.hora, r.rend, r.shift, now, now]))[0].id);
  }

  // Escala confirmada (histórico)
  const entries: Entry[] = rows.map((r, i) => ({
    id: crypto.randomUUID(), date: day.date, serviceId: svcId[i],
    lineId: lineId.get(r.linha)!, lineCode: r.linha, lineDescription: null,
    busId: r.carro ? busId.get(r.carro)! : null, busFleet: r.carro ?? '', busPlate: '',
    startTime: r.hora, endTime: r.rend, shiftName: r.shift,
    driverId: personId.get(`motorista|${r.motorista}`)!, driverName: r.motorista,
    conductorId: personId.get(`cobrador|${r.cobrador}`)!, conductorName: r.cobrador,
  }));
  let sched = await repo.openScheduleForWeekend(q, saturday);
  if (sched?.entries.some((e) => e.date === day.date)) return; // dia já registrado manualmente
  const all = [...(sched?.entries ?? []), ...entries];
  const ctx = {
    saturday, ...buildContextMaps(await repo.listPeople(q), await repo.listLines(q), await repo.listBuses(q)),
    otherConfirmed: [], settings: await repo.getSettings(q),
  };
  // A escala em papel é o registro real: sobreposições de poucos minutos (rendição) são mantidas e avisadas no log.
  const errors = validateSchedule(all, ctx).filter((i) => i.severity === 'error');
  const blocking = errors.filter((e) => e.code !== 'PERSON_OVERLAP' && e.code !== 'SAME_WEEKEND');
  if (blocking.length) throw new Error(`Dados de ${day.date} inválidos: ${blocking.map((e) => e.message).join(' | ')}`);
  if (errors.length) console.warn(`[seed ${day.date}] mantido como na escala em papel: ${[...new Set(errors.map((e) => e.message))].join(' | ')}`);
  if (!sched) {
    const [{ id }] = await q<{ id: number }>(`INSERT INTO schedules (saturday, status, version, notes, created_at, updated_at, confirmed_at)
      VALUES (?, 'confirmada', 1, 'Importada da escala em papel', ?, ?, ?) RETURNING id`, [saturday, now, now, now]);
    sched = (await repo.loadSchedule(q, id))!;
  }
  await repo.writeEntries(q, sched.id, all);
  await q(`UPDATE schedules SET status = 'confirmada', confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?, version = version + 1 WHERE id = ?`, [now, now, sched.id]);
  await repo.addAudit(q, { scheduleId: sched.id, username: 'sistema', action: 'importada', summary: `Escala de ${day.date.split('-').reverse().join('/')} importada da escala em papel (${entries.length} serviços).` });
}
