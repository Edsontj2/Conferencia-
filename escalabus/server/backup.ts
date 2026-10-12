import { z } from 'zod';
import type { Q } from './db.js';
import { nowIso } from './db.js';
import { isSaturday, isValidDate, isValidHM, sundayOf } from '../shared/time.js';

/** Tabelas de dados incluídas no backup (usuários e sessões ficam de fora: não exportamos segredos). */
export const BACKUP_TABLES = ['settings', 'people', 'lines', 'buses', 'services', 'recipients', 'schedules', 'schedule_entries', 'schedule_audit'] as const;
export const BACKUP_FORMAT = 1;

const ORDER: Record<string, string> = { settings: 'key', schedule_entries: 'schedule_id, position' };

export async function exportBackup(q: Q, mode: string) {
  const tables: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) tables[t] = await q(`SELECT * FROM ${t} ORDER BY ${ORDER[t] ?? 'id'}`);
  return { app: 'EscalaBus', format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), mode, tables };
}

const hm = z.string().refine(isValidHM, 'horário inválido (HH:MM)');
const date = z.string().refine(isValidDate, 'data inválida (AAAA-MM-DD)');
const bool01 = z.union([z.literal(0), z.literal(1)]);
const ts = z.string().min(1);
const id = z.number().int().positive();
const nid = id.nullable();

const schemas = {
  settings: z.object({ key: z.string(), value: z.string() }),
  people: z.object({ id, name: z.string().min(1), role: z.enum(['motorista', 'cobrador']), shift_name: z.string(), avail_start: hm, avail_end: hm, whatsapp: z.string().nullable(), active: bool01, created_at: ts, updated_at: ts }),
  lines: z.object({ id, code: z.string().min(1), description: z.string().nullable(), active: bool01, created_at: ts, updated_at: ts }),
  buses: z.object({ id, fleet_number: z.string().min(1), plate: z.string(), active: bool01, created_at: ts, updated_at: ts }),
  services: z.object({ id, weekday: z.union([z.literal(0), z.literal(6)]), line_id: id, bus_id: nid, start_time: hm, end_time: hm, shift_name: z.string(), active: bool01, created_at: ts, updated_at: ts }),
  recipients: z.object({ id, name: z.string().min(1), phone: z.string().min(1), created_at: ts }),
  schedules: z.object({ id, saturday: date.refine(isSaturday, 'deve ser sábado'), status: z.enum(['rascunho', 'confirmada', 'cancelada']), version: z.number().int(), notes: z.string().nullable(), created_at: ts, updated_at: ts, confirmed_at: z.string().nullable(), cancelled_at: z.string().nullable(), cancel_reason: z.string().nullable() }),
  schedule_entries: z.object({ uid: z.string().min(1), schedule_id: id, position: z.number().int(), date, service_id: nid, line_id: nid, line_code: z.string(), line_description: z.string().nullable(), bus_id: nid, bus_fleet: z.string(), bus_plate: z.string(), start_time: hm, end_time: hm, shift_name: z.string(), driver_id: nid, driver_name: z.string(), conductor_id: nid, conductor_name: z.string() }),
  schedule_audit: z.object({ id, schedule_id: id, at: ts, username: z.string(), action: z.string(), reason: z.string().nullable(), summary: z.string(), before_json: z.string().nullable(), after_json: z.string().nullable() }),
};

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
  exportedAt?: string;
  mode?: string;
}

/** Valida estrutura, tipos e integridade referencial do backup antes de qualquer importação. */
export function validateBackup(data: unknown): BackupCheck {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const d = data as { app?: string; format?: number; exportedAt?: string; mode?: string; tables?: Record<string, unknown[]> };
  if (!d || typeof d !== 'object') return { ok: false, errors: ['Arquivo não é um JSON de backup.'], counts };
  if (d.app !== 'EscalaBus') errors.push('O arquivo não é um backup do EscalaBus.');
  if (d.format !== BACKUP_FORMAT) errors.push(`Versão de backup não suportada (${d.format ?? '?'}).`);
  if (!d.tables || typeof d.tables !== 'object') return { ok: false, errors: [...errors, 'Seção "tables" ausente.'], counts };
  for (const t of BACKUP_TABLES) {
    const rows = d.tables[t];
    if (!Array.isArray(rows)) { errors.push(`Tabela ${t} ausente.`); continue; }
    counts[t] = rows.length;
    rows.forEach((r, i) => {
      const res = schemas[t].safeParse(r);
      if (!res.success && errors.length < 50) {
        errors.push(`${t}[${i}]: ${res.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
      }
    });
  }
  if (errors.length) return { ok: false, errors, counts, exportedAt: d.exportedAt, mode: d.mode };

  const T = d.tables as Record<string, Record<string, unknown>[]>;
  const ids = (t: string, k = 'id') => new Set(T[t].map((r) => r[k]));
  const dup = (t: string, k: string) => {
    const s = new Set();
    for (const r of T[t]) { if (s.has(r[k])) errors.push(`${t}: valor duplicado em ${k} (${String(r[k])}).`); s.add(r[k]); }
  };
  dup('people', 'id'); dup('lines', 'id'); dup('lines', 'code'); dup('buses', 'id'); dup('buses', 'fleet_number');
  dup('services', 'id'); dup('schedules', 'id'); dup('schedule_entries', 'uid'); dup('settings', 'key');
  const lineIds = ids('lines'), busIds = ids('buses'), schIds = ids('schedules');
  for (const s of T.services) {
    if (!lineIds.has(s.line_id)) errors.push(`Serviço ${s.id}: linha ${s.line_id} inexistente.`);
    if (s.bus_id != null && !busIds.has(s.bus_id)) errors.push(`Serviço ${s.id}: ônibus ${s.bus_id} inexistente.`);
  }
  const open = new Set<string>();
  const satOf = new Map<unknown, string>();
  for (const s of T.schedules) {
    satOf.set(s.id, s.saturday as string);
    if (s.status !== 'cancelada') {
      if (open.has(s.saturday as string)) errors.push(`Mais de uma escala ativa para o sábado ${s.saturday}.`);
      open.add(s.saturday as string);
    }
  }
  for (const e of T.schedule_entries) {
    if (!schIds.has(e.schedule_id)) { errors.push(`Registro ${e.uid}: escala ${e.schedule_id} inexistente.`); continue; }
    const sat = satOf.get(e.schedule_id)!;
    if (e.date !== sat && e.date !== sundayOf(sat)) errors.push(`Registro ${e.uid}: data ${e.date} fora do fim de semana ${sat}.`);
  }
  for (const a of T.schedule_audit) if (!schIds.has(a.schedule_id)) errors.push(`Auditoria ${a.id}: escala inexistente.`);
  return { ok: errors.length === 0, errors: errors.slice(0, 50), counts, exportedAt: d.exportedAt, mode: d.mode };
}

/** Substitui TODOS os dados (do modo atual) pelo backup, numa única transação. Guarda antes uma cópia no banco. */
export async function importBackup(q: Q, data: unknown, mode: string): Promise<{ safetyCopyId: number }> {
  const check = validateBackup(data);
  if (!check.ok) throw Object.assign(new Error('Backup inválido.'), { details: check });
  const [{ id: safetyCopyId }] = await q<{ id: number }>('INSERT INTO backup_snapshots (created_at, reason, data) VALUES (?, ?, ?) RETURNING id',
    [nowIso(), `antes da importação (${mode})`, JSON.stringify(await exportBackup(q, mode))]);
  await q('DELETE FROM backup_snapshots WHERE id NOT IN (SELECT id FROM backup_snapshots ORDER BY id DESC LIMIT 10)');
  const T = (data as { tables: Record<string, Record<string, unknown>[]> }).tables;
  for (const t of [...BACKUP_TABLES].reverse()) await q(`DELETE FROM ${t}`);
  for (const t of BACKUP_TABLES) {
    const cols = Object.keys(schemas[t].shape);
    const rows = T[t];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const params: unknown[] = [];
      const values = chunk.map((r) => { cols.forEach((c) => params.push(r[c] ?? null)); return `(${cols.map(() => '?').join(', ')})`; });
      await q(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${values.join(', ')}`, params);
    }
    if (cols.includes('id')) {
      await q(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    }
  }
  return { safetyCopyId: Number(safetyCopyId) };
}
