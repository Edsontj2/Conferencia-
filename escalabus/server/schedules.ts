import type { Q } from './db.js';
import { nowIso } from './db.js';
import * as repo from './repo.js';
import { buildContextMaps, canConfirm, hasErrors, validateSchedule, type RuleContext } from '../shared/rules.js';
import { buildSlotsFromServices, compareEntries, generateSchedule } from '../shared/generator.js';
import { diffEntries } from '../shared/diff.js';
import { addDays, isSaturday, sundayOf } from '../shared/time.js';
import type { Entry, Issue, Schedule } from '../shared/types.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

/** Serializa todas as gravações de escalas (evita duas confirmações simultâneas de fins de semana vizinhos). */
const lockSchedules = (q: Q) => q('SELECT pg_advisory_xact_lock(7300452)');

/** Contexto de regras de um fim de semana: cadastros + escalas confirmadas vizinhas (±7 dias). */
export async function weekendContext(q: Q, saturday: string, scheduleId: number | null, baseline?: Entry[]): Promise<RuleContext> {
  if (!isSaturday(saturday)) throw new HttpError(400, 'A data base da escala precisa ser um sábado.');
  const sun = sundayOf(saturday);
  // Consultas em sequência: a transação usa uma única conexão.
  const people = await repo.listPeople(q);
  const lines = await repo.listLines(q);
  const buses = await repo.listBuses(q);
  const otherConfirmed = await repo.confirmedWorkBetween(q, addDays(saturday, -7), addDays(sun, 7), scheduleId);
  const settings = await repo.getSettings(q);
  const hasSat = await repo.hasConfirmedOn(q, addDays(saturday, -7), scheduleId);
  const hasSun = await repo.hasConfirmedOn(q, addDays(sun, -7), scheduleId);
  return {
    saturday, ...buildContextMaps(people, lines, buses), otherConfirmed, settings, baseline,
    historyMissing: { saturday: !hasSat, sunday: !hasSun },
  };
}

/**
 * Preenche os campos de snapshot (nomes, código da linha, carro, placa) a partir dos cadastros.
 * Se a atribuição não mudou em relação à versão salva, mantém o snapshot antigo (preserva o histórico).
 */
export function normalizeEntries(entries: Entry[], ctx: RuleContext): Entry[] {
  const base = new Map((ctx.baseline ?? []).map((e) => [e.id, e]));
  return entries.map((e) => {
    const b = base.get(e.id);
    const out: Entry = { ...e };
    if (e.lineId == null) { out.lineCode = ''; out.lineDescription = null; }
    else if (b && b.lineId === e.lineId) { out.lineCode = b.lineCode; out.lineDescription = b.lineDescription; }
    else { const l = ctx.lines.get(e.lineId); out.lineCode = l?.code ?? ''; out.lineDescription = l?.description ?? null; }
    if (e.busId == null) { out.busFleet = ''; out.busPlate = ''; }
    else if (b && b.busId === e.busId) { out.busFleet = b.busFleet; out.busPlate = b.busPlate; }
    else { const x = ctx.buses.get(e.busId); out.busFleet = x?.fleetNumber ?? ''; out.busPlate = x?.plate ?? ''; }
    if (e.driverId == null) out.driverName = '';
    else if (b && b.driverId === e.driverId) out.driverName = b.driverName;
    else out.driverName = ctx.people.get(e.driverId)?.name ?? '';
    if (e.conductorId == null) out.conductorName = '';
    else if (b && b.conductorId === e.conductorId) out.conductorName = b.conductorName;
    else out.conductorName = ctx.people.get(e.conductorId)?.name ?? '';
    out.shiftName = (e.shiftName ?? '').trim();
    return out;
  }).sort(compareEntries);
}

function assertSavable(issues: Issue[]) {
  if (hasErrors(issues)) throw new HttpError(422, 'A escala viola regras obrigatórias e não foi salva.', { issues });
}

export async function getWeekend(q: Q, saturday: string) {
  const schedule = await repo.openScheduleForWeekend(q, saturday);
  const ctx = await weekendContext(q, saturday, schedule?.id ?? null, schedule?.entries);
  const issues = schedule ? validateSchedule(schedule.entries, ctx) : validateSchedule([], ctx).filter((i) => i.severity === 'warning');
  const cancelled = (await repo.listSchedulesMeta(q, { from: saturday, to: saturday, status: 'cancelada' })).filter((s) => s.saturday === saturday);
  return {
    saturday, sunday: sundayOf(saturday), schedule, issues, cancelled,
    context: { otherConfirmed: ctx.otherConfirmed, historyMissing: ctx.historyMissing, historyCounts: await repo.historyCounts(q) },
  };
}

/** Sorteio: retorna uma PROPOSTA (não salva). O cliente decide salvar como rascunho. */
export async function generate(q: Q, saturday: string, seed?: number) {
  const existing = await repo.openScheduleForWeekend(q, saturday);
  const ctx = await weekendContext(q, saturday, existing?.id ?? null);
  const slots = buildSlotsFromServices(saturday, await repo.listServices(q), [...ctx.lines.values()], [...ctx.buses.values()]);
  const r = generateSchedule({
    entries: slots.entries, people: [...ctx.people.values()], otherConfirmed: ctx.otherConfirmed,
    settings: ctx.settings, historyCounts: await repo.historyCounts(q), seed,
  });
  const entries = normalizeEntries(r.entries, ctx);
  return {
    entries, unfilled: r.unfilled, skipped: slots.skipped, exhaustive: r.exhaustive,
    issues: validateSchedule(entries, ctx),
    existing: existing ? { id: existing.id, status: existing.status, version: existing.version } : null,
  };
}

export async function validateDraft(q: Q, saturday: string, entries: Entry[], scheduleId: number | null) {
  const base = scheduleId ? (await repo.loadSchedule(q, scheduleId))?.entries : undefined;
  const ctx = await weekendContext(q, saturday, scheduleId, base);
  const norm = normalizeEntries(entries, ctx);
  return { entries: norm, issues: validateSchedule(norm, ctx) };
}

export async function createSchedule(q: Q, username: string, input: { saturday: string; entries: Entry[]; notes?: string | null }): Promise<Schedule> {
  await lockSchedules(q);
  if (await repo.openScheduleForWeekend(q, input.saturday)) {
    throw new HttpError(409, 'Já existe uma escala (rascunho ou confirmada) para este fim de semana. Abra-a para editar ou cancele-a antes.');
  }
  const ctx = await weekendContext(q, input.saturday, null);
  const entries = normalizeEntries(input.entries, ctx);
  assertSavable(validateSchedule(entries, ctx));
  const now = nowIso();
  const [{ id }] = await q<{ id: number }>(`INSERT INTO schedules (saturday, status, version, notes, created_at, updated_at)
    VALUES (?, 'rascunho', 1, ?, ?, ?) RETURNING id`, [input.saturday, input.notes ?? null, now, now]);
  await repo.writeEntries(q, id, entries);
  await repo.addAudit(q, { scheduleId: id, username, action: 'criada', summary: `Rascunho criado com ${entries.length} serviço(s).` });
  return (await repo.loadSchedule(q, id))!;
}

async function loadForWrite(q: Q, id: number, version: number): Promise<Schedule> {
  await lockSchedules(q);
  const s = await repo.loadSchedule(q, id, true);
  if (!s) throw new HttpError(404, 'Escala não encontrada.');
  if (s.status === 'cancelada') throw new HttpError(409, 'Escala cancelada não pode ser alterada.');
  if (s.version !== version) {
    throw new HttpError(409, 'A escala foi alterada em outro dispositivo. Recarregue para ver a versão atual antes de salvar.', { currentVersion: s.version });
  }
  return s;
}

export async function updateSchedule(
  q: Q, username: string, id: number,
  input: { entries: Entry[]; version: number; reason?: string | null; notes?: string | null; action?: string },
): Promise<Schedule> {
  const s = await loadForWrite(q, id, input.version);
  if (s.status === 'confirmada' && !input.reason?.trim()) {
    throw new HttpError(400, 'Para editar uma escala confirmada, informe o motivo da alteração.');
  }
  const ctx = await weekendContext(q, s.saturday, s.id, s.entries);
  const entries = normalizeEntries(input.entries, ctx);
  const issues = validateSchedule(entries, ctx);
  assertSavable(issues);
  if (s.status === 'confirmada' && !canConfirm(issues)) {
    throw new HttpError(422, 'Uma escala confirmada não pode ficar com vagas sem preenchimento.', { issues });
  }
  const changes = diffEntries(s.entries, entries);
  await q('UPDATE schedules SET version = version + 1, updated_at = ?, notes = COALESCE(?, notes) WHERE id = ?', [nowIso(), input.notes ?? null, id]);
  await repo.writeEntries(q, id, entries);
  if (changes.length || s.status === 'confirmada') {
    await repo.addAudit(q, {
      scheduleId: id, username, action: input.action ?? (s.status === 'confirmada' ? 'edição de confirmada' : 'edição'),
      reason: input.reason, summary: changes.length ? changes.join('\n') : 'Sem mudanças nos serviços.',
      before: s.status === 'confirmada' ? s.entries : undefined, after: s.status === 'confirmada' ? entries : undefined,
    });
  }
  return (await repo.loadSchedule(q, id))!;
}

/** Revalida TODAS as regras no backend e confirma dentro de uma transação. */
export async function confirmSchedule(q: Q, username: string, id: number, version: number): Promise<{ schedule: Schedule; issues: Issue[] }> {
  const s = await loadForWrite(q, id, version);
  if (s.status === 'confirmada') throw new HttpError(409, 'A escala já está confirmada.');
  const ctx = await weekendContext(q, s.saturday, s.id, undefined); // sem tolerância: confirma com o cadastro atual
  const issues = validateSchedule(s.entries, ctx);
  if (!canConfirm(issues)) {
    throw new HttpError(422, 'Não é possível confirmar: há vagas sem preenchimento ou regras violadas.', { issues });
  }
  const now = nowIso();
  await q(`UPDATE schedules SET status = 'confirmada', version = version + 1, confirmed_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
  await repo.addAudit(q, { scheduleId: id, username, action: 'confirmada', summary: `Escala confirmada com ${s.entries.length} serviço(s).`, after: s.entries });
  return { schedule: (await repo.loadSchedule(q, id))!, issues };
}

export async function cancelSchedule(q: Q, username: string, id: number, version: number, reason: string): Promise<Schedule> {
  const s = await loadForWrite(q, id, version);
  if (!reason.trim()) throw new HttpError(400, 'Informe o motivo do cancelamento.');
  const now = nowIso();
  await q(`UPDATE schedules SET status = 'cancelada', version = version + 1, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`, [now, reason, now, id]);
  await repo.addAudit(q, { scheduleId: id, username, action: 'cancelada', reason, summary: `Escala cancelada (era ${s.status}).`, before: s.entries });
  return (await repo.loadSchedule(q, id))!;
}

export type SwapField = 'driver' | 'conductor' | 'line' | 'bus';
export const SWAP_LABEL: Record<SwapField, string> = { driver: 'motoristas', conductor: 'cobradores', line: 'linhas', bus: 'ônibus' };

/** Troca um campo entre duas vagas numa única operação, validando só o estado final. */
export async function swapEntries(
  q: Q, username: string, id: number,
  input: { a: string; b: string; field: SwapField; version: number; reason?: string | null },
): Promise<Schedule> {
  const s = await repo.loadSchedule(q, id);
  if (!s) throw new HttpError(404, 'Escala não encontrada.');
  const entries = applySwap(s.entries, input.a, input.b, input.field);
  return updateSchedule(q, username, id, { entries, version: input.version, reason: input.reason, action: `troca de ${SWAP_LABEL[input.field]}` });
}

export function applySwap(entries: Entry[], a: string, b: string, field: SwapField): Entry[] {
  const ea = entries.find((e) => e.id === a);
  const eb = entries.find((e) => e.id === b);
  if (!ea || !eb || a === b) throw new HttpError(400, 'Selecione duas vagas diferentes da mesma escala.');
  const keys: Record<SwapField, (keyof Entry)[]> = {
    driver: ['driverId', 'driverName'], conductor: ['conductorId', 'conductorName'],
    line: ['lineId', 'lineCode', 'lineDescription'], bus: ['busId', 'busFleet', 'busPlate'],
  };
  return entries.map((e) => {
    if (e.id !== a && e.id !== b) return e;
    const other = e.id === a ? eb : ea;
    const copy = { ...e } as Record<string, unknown>;
    for (const k of keys[field]) copy[k] = other[k];
    return copy as unknown as Entry;
  });
}
