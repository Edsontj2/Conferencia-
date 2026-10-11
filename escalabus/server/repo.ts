import type { DB } from './db';
import { nowIso } from './db';
import type { Bus, ConfirmedWork, Entry, Line, Person, Recipient, Schedule, Service, Settings } from '../shared/types';
import { addDays, sundayOf } from '../shared/time';

/* ---------- mapeamento linha do banco -> objeto ---------- */
type Row = Record<string, unknown>;
const b = (v: unknown) => v === 1 || v === true;

export const mapPerson = (r: Row): Person => ({
  id: r.id as number, name: r.name as string, role: r.role as Person['role'], shiftName: r.shift_name as string,
  availStart: r.avail_start as string, availEnd: r.avail_end as string, whatsapp: (r.whatsapp as string) || null, active: b(r.active),
});
export const mapLine = (r: Row): Line => ({ id: r.id as number, code: r.code as string, description: (r.description as string) || null, active: b(r.active) });
export const mapBus = (r: Row): Bus => ({ id: r.id as number, fleetNumber: r.fleet_number as string, plate: r.plate as string, active: b(r.active) });
export const mapService = (r: Row): Service => ({
  id: r.id as number, weekday: r.weekday as 0 | 6, lineId: r.line_id as number, busId: r.bus_id as number,
  startTime: r.start_time as string, endTime: r.end_time as string, shiftName: r.shift_name as string, active: b(r.active),
});
export const mapRecipient = (r: Row): Recipient => ({ id: r.id as number, name: r.name as string, phone: r.phone as string });
export const mapEntry = (r: Row): Entry => ({
  id: r.uid as string, date: r.date as string, serviceId: (r.service_id as number) ?? null,
  lineId: (r.line_id as number) ?? null, lineCode: r.line_code as string, lineDescription: (r.line_description as string) ?? null,
  busId: (r.bus_id as number) ?? null, busFleet: r.bus_fleet as string, busPlate: r.bus_plate as string,
  startTime: r.start_time as string, endTime: r.end_time as string, shiftName: r.shift_name as string,
  driverId: (r.driver_id as number) ?? null, driverName: r.driver_name as string,
  conductorId: (r.conductor_id as number) ?? null, conductorName: r.conductor_name as string,
});

/* ---------- cadastros ---------- */
export const listPeople = (db: DB) => (db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE').all() as Row[]).map(mapPerson);
export const listLines = (db: DB) => (db.prepare('SELECT * FROM lines ORDER BY code').all() as Row[]).map(mapLine);
export const listBuses = (db: DB) => (db.prepare('SELECT * FROM buses ORDER BY fleet_number').all() as Row[]).map(mapBus);
export const listServices = (db: DB) =>
  (db.prepare('SELECT * FROM services ORDER BY weekday DESC, start_time, id').all() as Row[]).map(mapService);
export const listRecipients = (db: DB) => (db.prepare('SELECT * FROM recipients ORDER BY name COLLATE NOCASE').all() as Row[]).map(mapRecipient);

export const DEFAULT_SETTINGS: Settings = { companyName: 'Minha Empresa de Ônibus', maxServicesPerDay: 1 };

export function getSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === 'companyName') s.companyName = r.value;
    if (r.key === 'maxServicesPerDay') s.maxServicesPerDay = Math.max(1, Number(r.value) || 1);
  }
  return s;
}

export function saveSettings(db: DB, s: Settings) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    st.run('companyName', s.companyName);
    st.run('maxServicesPerDay', String(s.maxServicesPerDay));
  })();
}

/** Quantas vezes o id aparece em escalas (qualquer status) – usado para impedir exclusão que prejudique o histórico. */
export function usageCount(db: DB, kind: 'person' | 'line' | 'bus'): Map<number, number> {
  const sql = {
    person: `SELECT id, COUNT(*) c FROM (SELECT driver_id id FROM schedule_entries UNION ALL SELECT conductor_id FROM schedule_entries) WHERE id IS NOT NULL GROUP BY id`,
    line: `SELECT line_id id, COUNT(*) c FROM schedule_entries WHERE line_id IS NOT NULL GROUP BY line_id`,
    bus: `SELECT bus_id id, COUNT(*) c FROM schedule_entries WHERE bus_id IS NOT NULL GROUP BY bus_id`,
  }[kind];
  return new Map((db.prepare(sql).all() as { id: number; c: number }[]).map((r) => [r.id, r.c]));
}

/* ---------- escalas ---------- */
export function loadSchedule(db: DB, id: number): Schedule | null {
  const r = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined;
  if (!r) return null;
  return mapSchedule(db, r);
}

function mapSchedule(db: DB, r: Row): Schedule {
  const entries = (db.prepare('SELECT * FROM schedule_entries WHERE schedule_id = ? ORDER BY position').all(r.id) as Row[]).map(mapEntry);
  return {
    id: r.id as number, saturday: r.saturday as string, status: r.status as Schedule['status'], version: r.version as number,
    notes: (r.notes as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    confirmedAt: (r.confirmed_at as string) ?? null, cancelledAt: (r.cancelled_at as string) ?? null,
    cancelReason: (r.cancel_reason as string) ?? null, entries,
  };
}

/** Escala ativa (não cancelada) do fim de semana. */
export function openScheduleForWeekend(db: DB, saturday: string): Schedule | null {
  const r = db.prepare(`SELECT * FROM schedules WHERE saturday = ? AND status <> 'cancelada'`).get(saturday) as Row | undefined;
  return r ? mapSchedule(db, r) : null;
}

export function listSchedulesMeta(db: DB, filter: { from?: string; to?: string; status?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.from) { where.push('saturday >= ?'); args.push(addDays(filter.from, -1)); }
  if (filter.to) { where.push('saturday <= ?'); args.push(filter.to); }
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT s.*, (SELECT COUNT(*) FROM schedule_entries e WHERE e.schedule_id = s.id) AS entry_count,
    (SELECT COUNT(*) FROM schedule_entries e WHERE e.schedule_id = s.id AND (e.driver_id IS NULL OR e.conductor_id IS NULL)) AS open_count
    FROM schedules s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY saturday DESC, id DESC LIMIT 500`;
  return (db.prepare(sql).all(...args) as Row[]).map((r) => ({
    id: r.id as number, saturday: r.saturday as string, sunday: sundayOf(r.saturday as string), status: r.status as string,
    version: r.version as number, updatedAt: r.updated_at as string, confirmedAt: (r.confirmed_at as string) ?? null,
    cancelReason: (r.cancel_reason as string) ?? null, entryCount: r.entry_count as number, openCount: r.open_count as number,
  }));
}

/** Participações em escalas CONFIRMADAS (exceto a escala informada) num intervalo de datas. */
export function confirmedWorkBetween(db: DB, from: string, to: string, excludeScheduleId: number | null): ConfirmedWork[] {
  const rows = db.prepare(`
    SELECT e.driver_id AS d, e.conductor_id AS c, e.date, e.schedule_id
    FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
    WHERE s.status = 'confirmada' AND e.date BETWEEN ? AND ? AND s.id <> ?`).all(from, to, excludeScheduleId ?? -1) as Row[];
  const out: ConfirmedWork[] = [];
  for (const r of rows) {
    if (r.d != null) out.push({ personId: r.d as number, date: r.date as string, scheduleId: r.schedule_id as number });
    if (r.c != null) out.push({ personId: r.c as number, date: r.date as string, scheduleId: r.schedule_id as number });
  }
  return out;
}

/** Existe registro confirmado para a data? (para o aviso de histórico ausente) */
export function hasConfirmedOn(db: DB, date: string, excludeScheduleId: number | null): boolean {
  return !!db.prepare(`SELECT 1 FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
    WHERE s.status = 'confirmada' AND e.date = ? AND s.id <> ? LIMIT 1`).get(date, excludeScheduleId ?? -1);
}

export function historyCounts(db: DB): Record<number, number> {
  const rows = db.prepare(`SELECT id, COUNT(*) c FROM (
      SELECT e.driver_id id FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id WHERE s.status = 'confirmada'
      UNION ALL
      SELECT e.conductor_id FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id WHERE s.status = 'confirmada'
    ) WHERE id IS NOT NULL GROUP BY id`).all() as { id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.c]));
}

export function writeEntries(db: DB, scheduleId: number, entries: Entry[]) {
  db.prepare('DELETE FROM schedule_entries WHERE schedule_id = ?').run(scheduleId);
  const ins = db.prepare(`INSERT INTO schedule_entries (uid, schedule_id, position, date, service_id, line_id, line_code, line_description,
    bus_id, bus_fleet, bus_plate, start_time, end_time, shift_name, driver_id, driver_name, conductor_id, conductor_name)
    VALUES (@id, @scheduleId, @position, @date, @serviceId, @lineId, @lineCode, @lineDescription, @busId, @busFleet, @busPlate,
    @startTime, @endTime, @shiftName, @driverId, @driverName, @conductorId, @conductorName)`);
  entries.forEach((e, position) => ins.run({ ...e, scheduleId, position }));
}

export function addAudit(db: DB, a: { scheduleId: number; username: string; action: string; reason?: string | null; summary: string; before?: unknown; after?: unknown }) {
  db.prepare(`INSERT INTO schedule_audit (schedule_id, at, username, action, reason, summary, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(a.scheduleId, nowIso(), a.username, a.action, a.reason ?? null, a.summary,
    a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after));
}

export function listAudit(db: DB, scheduleId: number) {
  return (db.prepare('SELECT id, at, username, action, reason, summary FROM schedule_audit WHERE schedule_id = ? ORDER BY id DESC').all(scheduleId)) as Row[];
}
