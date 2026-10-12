import { candidateProblem, entryInterval, entryTimesValid, indexConfirmed, ROLE_TEXT, type ProblemCode } from './rules.js';
import { addDays, dayLabel, fmtDate, isSaturday, overlaps, sundayOf, weekdayOf } from './time.js';
import type { AssignRole, Bus, ConfirmedWork, Entry, Line, Person, Service, Settings } from './types.js';
import { roleOf } from './types.js';

/** Gerador pseudoaleatório com semente (mulberry32), para sorteios reproduzíveis em testes. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export interface SkippedService { serviceId: number; reason: string }

/** Cria as vagas do fim de semana a partir dos serviços-modelo ATIVOS (com linha e ônibus ativos). */
export function buildSlotsFromServices(
  saturday: string,
  services: Service[],
  lines: Line[],
  buses: Bus[],
  makeId: () => string = newId,
): { entries: Entry[]; skipped: SkippedService[] } {
  if (!isSaturday(saturday)) throw new Error('A data escolhida não é um sábado.');
  const lm = new Map(lines.map((l) => [l.id, l]));
  const bm = new Map(buses.map((b) => [b.id, b]));
  const entries: Entry[] = [];
  const skipped: SkippedService[] = [];
  for (const s of services) {
    if (!s.active) continue;
    const l = lm.get(s.lineId);
    if (!l || !l.active) { skipped.push({ serviceId: s.id, reason: `linha ${l?.code ?? '?'} inativa ou inexistente` }); continue; }
    const b = s.busId == null ? null : bm.get(s.busId);
    if (s.busId != null && (!b || !b.active)) { skipped.push({ serviceId: s.id, reason: `carro ${b?.fleetNumber ?? '?'} inativo ou inexistente` }); continue; }
    entries.push({
      id: makeId(),
      date: s.weekday === 6 ? saturday : sundayOf(saturday),
      serviceId: s.id,
      lineId: l.id, lineCode: l.code, lineDescription: l.description,
      busId: b?.id ?? null, busFleet: b?.fleetNumber ?? '', busPlate: b?.plate ?? '',
      startTime: s.startTime, endTime: s.endTime, shiftName: s.shiftName,
      driverId: null, driverName: '', conductorId: null, conductorName: '',
    });
  }
  entries.sort(compareEntries);
  return { entries, skipped };
}

export function compareEntries(a: Entry, b: Entry): number {
  return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.lineCode.localeCompare(b.lineCode, 'pt-BR', { numeric: true });
}

export interface GenerateInput {
  entries: Entry[];
  people: Person[];
  otherConfirmed: ConfirmedWork[];
  settings: Pick<Settings, 'maxServicesPerDay'>;
  /** Participações confirmadas no histórico por pessoa (prioriza quem tem menos). */
  historyCounts: Record<number, number>;
  seed?: number;
  /** Limite de nós da busca com retrocesso (proteção contra explosão combinatória). */
  nodeBudget?: number;
  /** Desliga a heurística de "vaga mais restrita primeiro" (usado em testes do retrocesso). */
  disableMrv?: boolean;
}

export interface Unfilled {
  entryId: string;
  role: AssignRole;
  description: string;
  reasons: string[];
}

export interface GenerateResult {
  entries: Entry[];
  unfilled: Unfilled[];
  exhaustive: boolean;
  nodes: number;
}

/**
 * Sorteio da escala.
 *
 * Para cada função (motorista / cobrador — conjuntos disjuntos de pessoas) executa uma busca em
 * profundidade com retrocesso:
 *  - escolhe primeiro a vaga com menos candidatos compatíveis (MRV);
 *  - tenta candidatos ordenados por (participações no histórico + vagas já recebidas neste sorteio),
 *    desempatando por uma ordem aleatória sorteada a cada geração;
 *  - se uma escolha levar a um beco sem saída, desfaz e tenta a próxima (retrocesso);
 *  - quando não existe solução completa, maximiza o número de vagas preenchidas, usando como limite
 *    superior um emparelhamento máximo (vaga × pessoa/dia) e poda por contagem otimista.
 * Nenhuma regra é relaxada: vagas sem candidato válido ficam vazias, com explicação.
 */
export function generateSchedule(input: GenerateInput): GenerateResult {
  const random = rng(input.seed ?? Math.floor(Math.random() * 2 ** 31));
  const confirmedIdx = indexConfirmed(input.otherConfirmed);
  const result = input.entries.map((e) => ({ ...e, driverId: null, driverName: '', conductorId: null, conductorName: '' } as Entry));
  const unfilled: Unfilled[] = [];
  let exhaustive = true;
  let nodes = 0;

  for (const role of ['driver', 'conductor'] as AssignRole[]) {
    const pool = input.people.filter((p) => p.active && p.role === roleOf(role));
    const rank = new Map(pool.map((p) => [p.id, random()]));
    const r = solveRole(result, role, pool, rank, confirmedIdx, input);
    nodes += r.nodes;
    if (!r.exhaustive) exhaustive = false;
    r.assign.forEach((pid, i) => {
      if (pid == null) return;
      const p = pool.find((x) => x.id === pid)!;
      if (role === 'driver') { result[i].driverId = p.id; result[i].driverName = p.name; }
      else { result[i].conductorId = p.id; result[i].conductorName = p.name; }
    });
  }

  for (const e of result) {
    for (const role of ['driver', 'conductor'] as AssignRole[]) {
      if ((role === 'driver' ? e.driverId : e.conductorId) != null) continue;
      unfilled.push({
        entryId: e.id, role,
        description: `${dayLabel(e.date)} ${fmtDate(e.date)} · ${e.startTime}–${e.endTime} · linha ${e.lineCode} · carro ${e.busFleet} · ${ROLE_TEXT[role]}`,
        reasons: explainUnfilled(e, role, input.people, result, confirmedIdx, input.settings),
      });
    }
  }
  return { entries: result, unfilled, exhaustive, nodes };
}

function solveRole(
  entries: Entry[], role: AssignRole, pool: Person[], rank: Map<number, number>,
  confirmedIdx: Map<number, Set<string>>, input: GenerateInput,
) {
  const n = entries.length;
  const budget = input.nodeBudget ?? 200_000;
  const maxDay = input.settings.maxServicesPerDay;
  const iv = entries.map((e) => (entryTimesValid(e) ? entryInterval(e) : null));

  // Candidatos estáticos: função, ativo, disponibilidade e alternância semanal.
  const cands: number[][] = entries.map((e, i) => {
    if (!iv[i]) return [];
    const res: number[] = [];
    pool.forEach((p, pi) => {
      if (!candidateProblem(e, role, p, { settings: input.settings, confirmedIdx }, [])) res.push(pi);
    });
    return res;
  });

  const assign: (number | null)[] = new Array(n).fill(undefined);
  const personSlots: number[][] = pool.map(() => []);
  const load = pool.map((p) => input.historyCounts[p.id] ?? 0);

  const compatible = (pi: number, i: number): boolean => {
    let sameDay = 0;
    for (const j of personSlots[pi]) {
      if (entries[j].date === entries[i].date) sameDay++;
      if (overlaps(iv[i]!, iv[j]!)) return false;
    }
    return sameDay < maxDay;
  };

  const upper = matchingUpperBound(entries, cands, maxDay);
  let best = -1;
  let bestAssign: (number | null)[] = new Array(n).fill(null);
  let nodes = 0;
  let stop = false;
  let aborted = false;

  const remaining = new Set<number>(Array.from({ length: n }, (_, i) => i));

  const dfs = (filled: number) => {
    if (stop) return;
    if (++nodes > budget) { stop = true; aborted = true; return; }
    if (remaining.size === 0) {
      if (filled > best) {
        best = filled;
        bestAssign = assign.map((x) => (x === undefined ? null : x));
        if (best >= upper) stop = true;
      }
      return;
    }
    // Contagem otimista + escolha da vaga mais restrita.
    let optimistic = filled;
    let pick = -1;
    let pickCount = Infinity;
    let pickOptions: number[] = [];
    for (const i of remaining) {
      const opts = cands[i].filter((pi) => compatible(pi, i));
      if (opts.length > 0) optimistic++;
      const key = input.disableMrv ? i : opts.length;
      if (key < pickCount || pick === -1) { pick = i; pickCount = key; pickOptions = opts; }
    }
    if (optimistic <= best) return;

    remaining.delete(pick);
    pickOptions.sort((a, b) => load[a] - load[b] || rank.get(pool[a].id)! - rank.get(pool[b].id)!);
    for (const pi of pickOptions) {
      assign[pick] = pi;
      personSlots[pi].push(pick);
      load[pi]++;
      dfs(filled + 1);
      load[pi]--;
      personSlots[pi].pop();
      if (stop) break;
    }
    if (!stop) {
      assign[pick] = null; // tentar deixar esta vaga vazia (só quando não há solução completa)
      dfs(filled);
    }
    assign[pick] = undefined as unknown as null;
    remaining.add(pick);
  };
  dfs(0);

  return {
    assign: bestAssign.map((pi) => (pi == null ? null : pool[pi].id)),
    exhaustive: !aborted,
    nodes,
  };
}

/**
 * Limite superior de vagas preenchíveis: emparelhamento máximo bipartido entre vagas e
 * "pessoa no dia" (capacidade = limite diário), ignorando sobreposição de horário.
 */
function matchingUpperBound(entries: Entry[], cands: number[][], maxDay: number): number {
  const nodeOf = new Map<string, number>();
  const adj: number[][] = entries.map((e, i) =>
    cands[i].flatMap((pi) => {
      const out: number[] = [];
      for (let k = 0; k < Math.min(maxDay, entries.length); k++) {
        const key = `${pi}|${e.date}|${k}`;
        if (!nodeOf.has(key)) nodeOf.set(key, nodeOf.size);
        out.push(nodeOf.get(key)!);
      }
      return out;
    }),
  );
  const matchR = new Map<number, number>();
  const tryKuhn = (u: number, seen: Set<number>): boolean => {
    for (const v of adj[u]) {
      if (seen.has(v)) continue;
      seen.add(v);
      const cur = matchR.get(v);
      if (cur === undefined || tryKuhn(cur, seen)) { matchR.set(v, u); return true; }
    }
    return false;
  };
  let size = 0;
  for (let u = 0; u < entries.length; u++) if (tryKuhn(u, new Set())) size++;
  return size;
}

const REASON_TEXT: Record<ProblemCode, string> = {
  ROLE: 'função diferente',
  PERSON_INACTIVE: 'inativo(a)',
  AVAILABILITY: 'turno/horário incompatível com o serviço',
  WEEKLY_PREV: 'trabalhou no mesmo dia da semana anterior',
  WEEKLY_NEXT: 'já confirmado(a) no mesmo dia da semana seguinte',
  PERSON_OVERLAP: 'já escalado(a) em horário sobreposto nesta escala',
  DAY_LIMIT: 'já atingiu o limite de serviços no dia',
};

/** Explica, em português, por que ninguém pôde ocupar a vaga. */
export function explainUnfilled(
  entry: Entry, role: AssignRole, people: Person[], all: Entry[],
  confirmedIdx: Map<number, Set<string>>, settings: Pick<Settings, 'maxServicesPerDay'>,
): string[] {
  const roleName = ROLE_TEXT[role];
  const plural = role === 'driver' ? 'motoristas' : 'cobradores';
  const n = (c: number) => `${c} ${c === 1 ? roleName : plural}`;
  if (!entryTimesValid(entry)) return ['Horário do serviço inválido.'];
  const ofRole = people.filter((p) => p.role === roleOf(role));
  const active = ofRole.filter((p) => p.active);
  if (ofRole.length === 0) return [`Nenhum ${roleName} cadastrado.`];
  if (active.length === 0) return [`Nenhum ${roleName} ativo (${ofRole.length} inativo(s)).`];
  const counts = new Map<ProblemCode, number>();
  let free = 0;
  for (const p of active) {
    const pr = candidateProblem(entry, role, p, { settings, confirmedIdx }, all);
    if (!pr) { free++; continue; }
    counts.set(pr.code, (counts.get(pr.code) ?? 0) + 1);
  }
  const out: string[] = [];
  const wd = weekdayOf(entry.date) === 6 ? 'sábado' : 'domingo';
  for (const [code, c] of counts) {
    let txt = REASON_TEXT[code];
    if (code === 'WEEKLY_PREV') txt = `trabalhou no ${wd} anterior (${fmtDate(addDays(entry.date, -7))})`;
    if (code === 'WEEKLY_NEXT') txt = `já confirmado(a) no ${wd} seguinte (${fmtDate(addDays(entry.date, 7))})`;
    if (code === 'DAY_LIMIT') txt = `já atingiu o limite de ${settings.maxServicesPerDay} serviço(s) no dia`;
    out.push(`${n(c)}: ${txt}.`);
  }
  if (free > 0) out.push(`${n(free)} livre(s), mas a busca foi interrompida antes de usá-los (tente gerar novamente).`);
  const usable = active.length - (counts.get('AVAILABILITY') ?? 0) - (counts.get('WEEKLY_PREV') ?? 0) - (counts.get('WEEKLY_NEXT') ?? 0);
  if (usable <= 0) out.unshift(`Nenhum ${roleName} ativo atende a esta vaga.`);
  else if (free === 0) out.unshift(`Falta de pessoas: ${usable === 1 ? `o único ${roleName} compatível já foi usado` : `os ${usable} ${plural} compatíveis já foram usados`} em outras vagas.`);
  return out;
}
