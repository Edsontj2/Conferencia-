import {
  absInterval, addDays, dayLabel, fitsAvailability, fmtDate, isSaturday, isValidHM, overlaps, sundayOf,
} from './time.js';
import type {
  AssignRole, Bus, ConfirmedWork, Entry, HistoryMissing, Issue, Line, Person, Settings,
} from './types.js';
import { roleOf } from './types.js';

export interface RuleContext {
  saturday: string;
  people: Map<number, Person>;
  lines: Map<number, Line>;
  buses: Map<number, Bus>;
  /** Participações em OUTRAS escalas confirmadas (normalmente ±7 dias do fim de semana). */
  otherConfirmed: ConfirmedWork[];
  settings: Pick<Settings, 'maxServicesPerDay'>;
  /**
   * Versão já salva da escala. Atribuições que não mudaram (mesma pessoa, mesma vaga, mesmos horários)
   * não são reprovadas por mudanças posteriores no cadastro (pessoa inativada, turno alterado),
   * preservando o histórico. Sobreposições e alternância semanal são SEMPRE verificadas.
   */
  baseline?: Entry[];
  historyMissing?: HistoryMissing;
}

export const ROLE_TEXT: Record<AssignRole, string> = { driver: 'motorista', conductor: 'cobrador' };
const personIdOf = (e: Entry, r: AssignRole) => (r === 'driver' ? e.driverId : e.conductorId);

export function entryInterval(e: Pick<Entry, 'date' | 'startTime' | 'endTime'>) {
  return absInterval(e.date, e.startTime, e.endTime);
}

export function entryTimesValid(e: Pick<Entry, 'startTime' | 'endTime'>): boolean {
  return isValidHM(e.startTime) && isValidHM(e.endTime) && e.startTime !== e.endTime;
}

export function buildContextMaps(people: Person[], lines: Line[], buses: Bus[]) {
  return {
    people: new Map(people.map((p) => [p.id, p])),
    lines: new Map(lines.map((l) => [l.id, l])),
    buses: new Map(buses.map((b) => [b.id, b])),
  };
}

/** Indexa as participações confirmadas por pessoa e data. */
export function indexConfirmed(work: ConfirmedWork[]): Map<number, Set<string>> {
  const m = new Map<number, Set<string>>();
  for (const w of work) {
    if (!m.has(w.personId)) m.set(w.personId, new Set());
    m.get(w.personId)!.add(w.date);
  }
  return m;
}

/**
 * Regras 6, 7, 8, 10 e 11: quem trabalhou num sábado não trabalha no sábado seguinte
 * (idem domingo). Considera o dia de INÍCIO do serviço e escalas confirmadas dos dois lados
 * (anterior e seguinte), comparando datas reais.
 */
export function weeklyConflict(personId: number, date: string, confirmed: Map<number, Set<string>>): Problem | null {
  const dates = confirmed.get(personId);
  if (!dates) return null;
  const prev = addDays(date, -7);
  const next = addDays(date, 7);
  const dl = dayLabel(date).toLowerCase();
  if (dates.has(prev)) return { code: 'WEEKLY_PREV', text: `trabalhou no ${dl} anterior (${fmtDate(prev)})` };
  if (dates.has(next)) return { code: 'WEEKLY_NEXT', text: `já está na escala confirmada do ${dl} seguinte (${fmtDate(next)})` };
  return null;
}

function isGrandfathered(e: Entry, role: AssignRole, baseline?: Map<string, Entry>): boolean {
  const b = baseline?.get(e.id);
  if (!b) return false;
  return (
    personIdOf(b, role) === personIdOf(e, role) &&
    b.date === e.date && b.startTime === e.startTime && b.endTime === e.endTime
  );
}

export type ProblemCode = 'ROLE' | 'PERSON_INACTIVE' | 'AVAILABILITY' | 'WEEKLY_PREV' | 'WEEKLY_NEXT' | 'PERSON_OVERLAP' | 'DAY_LIMIT';
export interface Problem { code: ProblemCode; text: string }

/**
 * Diz por que uma pessoa NÃO pode ocupar a vaga (ou null se pode).
 * `others` são as demais vagas da mesma escala (a própria vaga é ignorada).
 */
export function candidateProblem(
  entry: Entry,
  role: AssignRole,
  person: Person,
  ctx: Pick<RuleContext, 'settings'> & { confirmedIdx: Map<number, Set<string>> },
  others: Entry[],
  opts: { skipCadastro?: boolean } = {},
): Problem | null {
  if (!opts.skipCadastro) {
    if (person.role !== roleOf(role)) return { code: 'ROLE', text: `é ${person.role}, não ${ROLE_TEXT[role]}` };
    if (!person.active) return { code: 'PERSON_INACTIVE', text: 'está inativo(a)' };
    if (entryTimesValid(entry) && !fitsAvailability(entry.date, entry.startTime, entry.endTime, person.availStart, person.availEnd)) {
      return { code: 'AVAILABILITY', text: `turno incompatível (disponível ${person.availStart}–${person.availEnd})` };
    }
  }
  const wc = weeklyConflict(person.id, entry.date, ctx.confirmedIdx);
  if (wc) return wc;
  if (!entryTimesValid(entry)) return null;
  const iv = entryInterval(entry);
  let sameDay = 0;
  for (const o of others) {
    if (o.id === entry.id) continue;
    if (o.driverId !== person.id && o.conductorId !== person.id) continue;
    if (o.date === entry.date) sameDay++;
    if (entryTimesValid(o) && overlaps(iv, entryInterval(o))) {
      return { code: 'PERSON_OVERLAP', text: `já escalado(a) em horário sobreposto (${safeDay(o.date).toLowerCase()} ${o.startTime}–${o.endTime})` };
    }
  }
  if (sameDay >= ctx.settings.maxServicesPerDay) {
    return { code: 'DAY_LIMIT', text: `já atingiu o limite de ${ctx.settings.maxServicesPerDay} serviço(s) no dia` };
  }
  return null;
}

/**
 * Valida a escala inteira. Retorna as pendências:
 *  - error: viola regra obrigatória (bloqueia salvar e confirmar)
 *  - incomplete: vaga sem preenchimento/dado faltante (permite rascunho, bloqueia confirmar)
 *  - warning: aviso (ex.: histórico ausente)
 */
export function validateSchedule(entries: Entry[], ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const sat = ctx.saturday;
  if (!isSaturday(sat)) {
    issues.push({ code: 'NOT_SATURDAY', severity: 'error', message: `A data ${sat} não é um sábado.` });
    return issues;
  }
  const sun = sundayOf(sat);
  const baseline = ctx.baseline ? new Map(ctx.baseline.map((e) => [e.id, e])) : undefined;
  const confirmedIdx = indexConfirmed(ctx.otherConfirmed);
  const seenIds = new Set<string>();
  const label = (e: Entry) => `${safeDay(e.date)} ${e.startTime}–${e.endTime} linha ${e.lineCode || '?'}`;

  for (const e of entries) {
    if (seenIds.has(e.id)) issues.push({ code: 'DUP_ID', severity: 'error', entryId: e.id, message: 'Registro duplicado.' });
    seenIds.add(e.id);
    if (e.date !== sat && e.date !== sun) {
      issues.push({
        code: 'BAD_DATE', severity: 'error', entryId: e.id,
        message: `Data ${e.date ? fmtDate(e.date) : '(vazia)'} fora do fim de semana: use o sábado ${fmtDate(sat)} ou o domingo ${fmtDate(sun)}.`,
      });
      continue;
    }
    if (!entryTimesValid(e)) {
      issues.push({ code: 'BAD_TIME', severity: 'error', entryId: e.id, message: `Horários inválidos (${e.startTime || '?'}–${e.endTime || '?'}).` });
    }
    // Linha
    if (e.lineId == null) {
      issues.push({ code: 'NO_LINE', severity: 'incomplete', entryId: e.id, message: `${label(e)}: linha não informada.` });
    } else {
      const l = ctx.lines.get(e.lineId);
      const keep = baseline?.get(e.id)?.lineId === e.lineId;
      if (!l && !keep) issues.push({ code: 'LINE_NOT_FOUND', severity: 'error', entryId: e.id, message: `${label(e)}: linha não cadastrada.` });
      else if (l && !l.active && !keep) issues.push({ code: 'LINE_INACTIVE', severity: 'error', entryId: e.id, message: `${label(e)}: a linha ${l.code} está inativa.` });
    }
    // Ônibus
    if (e.busId == null) {
      issues.push({ code: 'NO_BUS', severity: 'warning', entryId: e.id, message: `${label(e)}: carro não definido.` });
    } else {
      const b = ctx.buses.get(e.busId);
      const keep = baseline?.get(e.id)?.busId === e.busId;
      if (!b && !keep) issues.push({ code: 'BUS_NOT_FOUND', severity: 'error', entryId: e.id, message: `${label(e)}: ônibus não cadastrado.` });
      else if (b && !b.active && !keep) issues.push({ code: 'BUS_INACTIVE', severity: 'error', entryId: e.id, message: `${label(e)}: o carro ${b.fleetNumber} está inativo.` });
    }
    // Pessoas
    for (const role of ['driver', 'conductor'] as AssignRole[]) {
      const pid = personIdOf(e, role);
      if (pid == null) {
        issues.push({ code: 'UNFILLED', severity: 'incomplete', entryId: e.id, role, message: `${label(e)}: vaga de ${ROLE_TEXT[role]} sem preenchimento.` });
        continue;
      }
      const p = ctx.people.get(pid);
      const keep = isGrandfathered(e, role, baseline);
      if (!p) {
        if (!keep) issues.push({ code: 'PERSON_NOT_FOUND', severity: 'error', entryId: e.id, role, message: `${label(e)}: pessoa não cadastrada.` });
        continue;
      }
      // Sobreposição e limite diário são verificados abaixo de forma agregada; aqui: cadastro + alternância.
      const problem = candidateProblem(e, role, p, { settings: { maxServicesPerDay: Infinity }, confirmedIdx }, [], { skipCadastro: keep });
      if (problem) {
        issues.push({ code: problem.code, severity: 'error', entryId: e.id, role, message: `${label(e)}: ${p.name} ${problem.text}.` });
      }
    }
  }

  // Sobreposição de pessoas e limite por dia (regras 4 e 12)
  const byPerson = new Map<number, { e: Entry; role: AssignRole }[]>();
  for (const e of entries) {
    for (const role of ['driver', 'conductor'] as AssignRole[]) {
      const pid = personIdOf(e, role);
      if (pid == null) continue;
      if (!byPerson.has(pid)) byPerson.set(pid, []);
      byPerson.get(pid)!.push({ e, role });
    }
  }
  for (const [pid, list] of byPerson) {
    const name = ctx.people.get(pid)?.name ?? list[0].e[list[0].role === 'driver' ? 'driverName' : 'conductorName'] ?? `#${pid}`;
    const valid = list.filter((x) => entryTimesValid(x.e) && (x.e.date === sat || x.e.date === sun));
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i], b = valid[j];
        if (a.e.id === b.e.id) {
          issues.push({ code: 'SAME_ENTRY', severity: 'error', entryId: a.e.id, message: `${name} está duas vezes na mesma vaga.` });
        } else if (overlaps(entryInterval(a.e), entryInterval(b.e))) {
          // Sobreposição que já existia na versão salva (ex.: escala importada do papel) não bloqueia outras edições.
          const pre = isGrandfathered(a.e, a.role, baseline) && isGrandfathered(b.e, b.role, baseline);
          const msg = `${name} escalado(a) em horários sobrepostos: ${label(a.e)} e ${label(b.e)}.${pre ? ' (já existia na escala salva)' : ''}`;
          const severity = pre ? 'warning' : 'error';
          issues.push({ code: 'PERSON_OVERLAP', severity, entryId: a.e.id, role: a.role, message: msg });
          issues.push({ code: 'PERSON_OVERLAP', severity, entryId: b.e.id, role: b.role, message: msg });
        }
      }
    }
    const perDay = new Map<string, { e: Entry; role: AssignRole }[]>();
    for (const x of list) {
      if (!perDay.has(x.e.date)) perDay.set(x.e.date, []);
      perDay.get(x.e.date)!.push(x);
    }
    for (const [date, xs] of perDay) {
      if (xs.length > ctx.settings.maxServicesPerDay) {
        for (const x of xs) {
          issues.push({
            code: 'DAY_LIMIT', severity: 'error', entryId: x.e.id, role: x.role,
            message: `${name} tem ${xs.length} serviços em ${fmtDate(date)} (limite configurado: ${ctx.settings.maxServicesPerDay}).`,
          });
        }
      }
    }
  }

  // Sobreposição de ônibus (regra 5)
  const byBus = new Map<number, Entry[]>();
  for (const e of entries) {
    if (e.busId == null || !entryTimesValid(e) || (e.date !== sat && e.date !== sun)) continue;
    if (!byBus.has(e.busId)) byBus.set(e.busId, []);
    byBus.get(e.busId)!.push(e);
  }
  for (const list of byBus.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(entryInterval(list[i]), entryInterval(list[j]))) {
          const msg = `Carro ${list[i].busFleet || list[i].busId} em horários sobrepostos: ${label(list[i])} e ${label(list[j])}.`;
          issues.push({ code: 'BUS_OVERLAP', severity: 'error', entryId: list[i].id, message: msg });
          issues.push({ code: 'BUS_OVERLAP', severity: 'error', entryId: list[j].id, message: msg });
        }
      }
    }
  }

  if (entries.length === 0) {
    issues.push({ code: 'EMPTY', severity: 'incomplete', message: 'A escala não tem nenhum serviço.' });
  }
  if (ctx.historyMissing?.saturday) {
    issues.push({ code: 'NO_HISTORY_SAT', severity: 'warning', message: historyMissingMessage(addDays(sat, -7)) });
  }
  if (ctx.historyMissing?.sunday) {
    issues.push({ code: 'NO_HISTORY_SUN', severity: 'warning', message: historyMissingMessage(addDays(sun, -7)) });
  }
  return dedupe(issues);
}

function safeDay(d: string) {
  try { return dayLabel(d); } catch { return '?'; }
}

export function historyMissingMessage(prevDate: string): string {
  return `Não há escala confirmada para o ${dayLabel(prevDate).toLowerCase()} anterior (${fmtDate(prevDate)}). ` +
    'O sistema ainda não consegue verificar a alternância desse dia: a ausência de histórico NÃO significa que ninguém trabalhou. ' +
    'Cadastre e confirme a escala anterior para que a regra seja aplicada.';
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${i.entryId}|${i.role}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
export const canConfirm = (issues: Issue[]) => !issues.some((i) => i.severity === 'error' || i.severity === 'incomplete');

/** Valida um conjunto de serviços-modelo: o mesmo ônibus não pode ter serviços sobrepostos no mesmo dia da semana. */
export function serviceBusConflicts<T extends { id: number; weekday: number; busId: number | null; startTime: string; endTime: string; active: boolean }>(
  services: T[],
): [T, T][] {
  // Usa um sábado/domingo de referência para comparar intervalos (inclusive atravessando a meia-noite).
  const refDate = (wd: number) => (wd === 6 ? '2000-01-01' : '2000-01-02');
  const act = services.filter((s) => s.active && s.busId != null && isValidHM(s.startTime) && isValidHM(s.endTime) && s.startTime !== s.endTime);
  const out: [T, T][] = [];
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (a.busId !== b.busId) continue;
      if (overlaps(absInterval(refDate(a.weekday), a.startTime, a.endTime), absInterval(refDate(b.weekday), b.startTime, b.endTime))) {
        out.push([a, b]);
      }
    }
  }
  return out;
}

