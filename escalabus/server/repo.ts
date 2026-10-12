import type { Q, Row } from './db.js';
import { nowIso, toInt } from './db.js';
import type { Bus, ConfirmedWork, Entry, Line, Person, Recipient, Schedule, Service, Settings } from '../shared/types.js';
import { addDays, sundayOf } from '../shared/time.js';

/* ---------- mapeamento linha do banco -> objeto ---------- */
const b = (v: unknown) => v === 1 || v === true;
const n = (v: unknown) => (v == null ? null : Number(v));

export const mapPerson = (r: Row): Person => ({
  id: Number(r.id), name: r.name as string, role: r.role as Person['role'], shiftName: r.shift_name as string,
  availStart: r.avail_start as string, availEnd: r.avail_end as string, whatsapp: (r.whatsapp as string) || null, active: b(r.active),
});
export const mapLine = (r: Row): Line => ({ id: Number(r.id), code: r.code as string, description: (r.description as string) || null, active: b(r.active) });
export const mapBus = (r: Row): Bus => ({ id: Number(r.id), fleetNumber: r.fleet_number as string, plate: r.plate as string, active: b(r.active) });
export const mapService = (r: Row): Service => ({
  id: Number(r.id), weekday: Number(r.weekday) as 0 | 6, lineId: Number(r.line_id), busId: n(r.bus_id),
  startTime: r.start_time as string, endTime: r.end_time as string, shiftName: r.shift_name as string, active: b(r.active),
});
export const mapRecipient = (r: Row): Recipient => ({ id: Number(r.id), name: r.name as string, phone: r.phone as string });
export const mapEntry = (r: Row): Entry => ({
  id: r.uid as string, date: r.date as string, serviceId: n(r.service_id),
  lineId: n(r.line_id), lineCode: r.line_code as string, lineDescription: (r.line_description as string) ?? null,
  busId: n(r.bus_id), busFleet: r.bus_fleet as string, busPlate: r.bus_plate as string,
  startTime: r.start_time as string, endTime: r.end_time as string, shiftName: r.shift_name as string,
  driverId: n(r.driver_id), driverName: r.driver_name as string,
  conductorId: n(r.conductor_id), conductorName: r.conductor_name as string,
});

/* ---------- cadastros ---------- */
export const listPeople = async (q: Q) => (await q('SELECT * FROM people ORDER BY lower(name), id')).map(mapPerson);
export const listLines = async (q: Q) => (await q('SELECT * FROM lines ORDER BY code')).map(mapLine);
export const listBuses = async (q: Q) => (await q('SELECT * FROM buses ORDER BY fleet_number')).map(mapBus);
export const listServices = async (q: Q) => (await q('SELECT * FROM services ORDER BY weekday DESC, start_time, id')).map(mapService);
export const listRecipients = async (q: Q) => (await q('SELECT * FROM recipients ORDER BY lower(name), id')).map(mapRecipient);

export const DEFAULT_SETTINGS: Settings = { companyName: 'Minha Empresa de Ônibus', maxServicesPerDay: 1, allowBothDays: false };

export async function getSettings(q: Q): Promise<Settings> {
  const rows = await q<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === 'companyName') s.companyName = r.value;
    if (r.key === 'maxServicesPerDay') s.maxServicesPerDay = Math.max(1, Number(r.value) || 1);
    if (r.key === 'allowBothDays') s.allowBothDays = r.value === 'true';
  }
  return s;
}

export async function saveSettings(q: Q, s: Settings) {
  const sql = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value';
  await q(sql, ['companyName', s.companyName]);
  await q(sql, ['maxServicesPerDay', String(s.maxServicesPerDay)]);
  await q(sql, ['allowBothDays', s.allowBothDays ? 'true' : 'false']);
}

/** Quantas vezes o id aparece em escalas (qualquer status) – usado para impedir exclusão que prejudique o histórico. */
export async function usageCount(q: Q, kind: 'person' | 'line' | 'bus'): Promise<Map<number, number>> {
  const sql = {
    person: `SELECT id, COUNT(*) AS c FROM (SELECT driver_id AS id FROM schedule_entries UNION ALL SELECT conductor_id FROM schedule_entries) t WHERE id IS NOT NULL GROUP BY id`,
    line: `SELECT line_id AS id, COUNT(*) AS c FROM schedule_entries WHERE line_id IS NOT NULL GROUP BY line_id`,
    bus: `SELECT bus_id AS id, COUNT(*) AS c FROM schedule_entries WHERE bus_id IS NOT NULL GROUP BY bus_id`,
  }[kind];
  return new Map((await q(sql)).map((r) => [Number(r.id), toInt(r.c)]));
}

/* ---------- escalas ---------- */
async function mapSchedule(q: Q, r: Row): Promise<Schedule> {
  const entries = (await q('SELECT * FROM schedule_entries WHERE schedule_id = ? ORDER BY position', [r.id])).map(mapEntry);
  return {
    id: Number(r.id), saturday: r.saturday as string, status: r.status as Schedule['status'], version: Number(r.version),
    notes: (r.notes as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    confirmedAt: (r.confirmed_at as string) ?? null, cancelledAt: (r.cancelled_at as string) ?? null,
    cancelReason: (r.cancel_reason as string) ?? null, entries,
  };
}

export async function loadSchedule(q: Q, id: number, forUpdate = false): Promise<Schedule | null> {
  const [r] = await q(`SELECT * FROM schedules WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return r ? mapSchedule(q, r) : null;
}

/** Escala ativa (não cancelada) do fim de semana. */
export async function openScheduleForWeekend(q: Q, saturday: string): Promise<Schedule | null> {
  const [r] = await q(`SELECT * FROM schedules WHERE saturday = ? AND status <> 'cancelada'`, [saturday]);
  return r ? mapSchedule(q, r) : null;
}

export async function listSchedulesMeta(q: Q, filter: { from?: string; to?: string; status?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.from) { where.push('saturday >= ?'); args.push(addDays(filter.from, -1)); }
  if (filter.to) { where.push('saturday <= ?'); args.push(filter.to); }
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT s.*, (SELECT COUNT(*) FROM schedule_entries e WHERE e.schedule_id = s.id) AS entry_count,
    (SELECT COUNT(*) FROM schedule_entries e WHERE e.schedule_id = s.id AND (e.driver_id IS NULL OR e.conductor_id IS NULL)) AS open_count
    FROM schedules s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY saturday DESC, id DESC LIMIT 500`;
  return (await q(sql, args)).map((r) => ({
    id: Number(r.id), saturday: r.saturday as string, sunday: sundayOf(r.saturday as string), status: r.status as string,
    version: Number(r.version), updatedAt: r.updated_at as string, confirmedAt: (r.confirmed_at as string) ?? null,
    cancelReason: (r.cancel_reason as string) ?? null, entryCount: toInt(r.entry_count), openCount: toInt(r.open_count),
  }));
}

/** Participações em escalas CONFIRMADAS (exceto a escala informada) num intervalo de datas. */
export async function confirmedWorkBetween(q: Q, from: string, to: string, excludeScheduleId: number | null): Promise<ConfirmedWork[]> {
  const rows = await q(`
    SELECT e.driver_id AS d, e.conductor_id AS c, e.date, e.schedule_id
    FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
    WHERE s.status = 'confirmada' AND e.date BETWEEN ? AND ? AND s.id <> ?`, [from, to, excludeScheduleId ?? -1]);
  const out: ConfirmedWork[] = [];
  for (const r of rows) {
    if (r.d != null) out.push({ personId: Number(r.d), date: r.date as string, scheduleId: Number(r.schedule_id) });
    if (r.c != null) out.push({ personId: Number(r.c), date: r.date as string, scheduleId: Number(r.schedule_id) });
  }
  return out;
}

/** Existe registro confirmado para a data? (para o aviso de histórico ausente) */
export async function hasConfirmedOn(q: Q, date: string, excludeScheduleId: number | null): Promise<boolean> {
  const r = await q(`SELECT 1 FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
    WHERE s.status = 'confirmada' AND e.date = ? AND s.id <> ? LIMIT 1`, [date, excludeScheduleId ?? -1]);
  return r.length > 0;
}

export async function historyCounts(q: Q): Promise<Record<number, number>> {
  const rows = await q(`SELECT id, COUNT(*) AS c FROM (
      SELECT e.driver_id AS id FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id WHERE s.status = 'confirmada'
      UNION ALL
      SELECT e.conductor_id FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id WHERE s.status = 'confirmada'
    ) t WHERE id IS NOT NULL GROUP BY id`);
  return Object.fromEntries(rows.map((r) => [Number(r.id), toInt(r.c)]));
}

const ENTRY_COLS = ['uid', 'schedule_id', 'position', 'date', 'service_id', 'line_id', 'line_code', 'line_description',
  'bus_id', 'bus_fleet', 'bus_plate', 'start_time', 'end_time', 'shift_name', 'driver_id', 'driver_name', 'conductor_id', 'conductor_name'];

export async function writeEntries(q: Q, scheduleId: number, entries: Entry[]) {
  await q('DELETE FROM schedule_entries WHERE schedule_id = ?', [scheduleId]);
  if (!entries.length) return;
  const params: unknown[] = [];
  const rows = entries.map((e, position) => {
    params.push(e.id, scheduleId, position, e.date, e.serviceId, e.lineId, e.lineCode, e.lineDescription, e.busId, e.busFleet,
      e.busPlate, e.startTime, e.endTime, e.shiftName, e.driverId, e.driverName, e.conductorId, e.conductorName);
    return `(${ENTRY_COLS.map(() => '?').join(', ')})`;
  });
  await q(`INSERT INTO schedule_entries (${ENTRY_COLS.join(', ')}) VALUES ${rows.join(', ')}`, params);
}

export async function addAudit(q: Q, a: { scheduleId: number; username: string; action: string; reason?: string | null; summary: string; before?: unknown; after?: unknown }) {
  await q(`INSERT INTO schedule_audit (schedule_id, at, username, action, reason, summary, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [a.scheduleId, nowIso(), a.username, a.action, a.reason ?? null, a.summary,
    a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after)]);
}

export async function listAudit(q: Q, scheduleId: number) {
  return (await q('SELECT id, at, username, action, reason, summary FROM schedule_audit WHERE schedule_id = ? ORDER BY id DESC', [scheduleId]))
    .map((r) => ({ ...r, id: Number(r.id) }));
}
