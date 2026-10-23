/**
 * Escalas avulsas/importadas: feitas fora do sistema (foto, PDF, planilha) e publicadas para a equipe.
 * Ex.: "ESCALA DE ELEIÇÃO 25/10/2026". Não passam pelas regras do gerador.
 */
import { findNameMatches, nameTokens, pickPerson } from './names.js';
import type { Person, Role } from './types.js';

export type ExtraStatus = 'rascunho' | 'publicada';

export interface ExtraRow {
  seq: string;
  bus: string;
  start: string;
  line: string;
  end: string;
  driverName: string;
  driverId: number | null;
  conductorName: string;
  conductorId: number | null;
}

export interface ExtraFileMeta { id: number; name: string; mime: string; size: number; createdAt: string }

export interface ExtraSchedule {
  id: number;
  title: string;
  date: string; // AAAA-MM-DD
  status: ExtraStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  rows: ExtraRow[];
  files: ExtraFileMeta[];
}

export const emptyRow = (): ExtraRow => ({ seq: '', bus: '', start: '', line: '', end: '', driverName: '', driverId: null, conductorName: '', conductorId: null });

/** "5:15", "05h15", "0515" → "05:15". Outros textos ficam como estão. */
export function normTime(v: string): string {
  const t = String(v ?? '').trim();
  const m = /^(\d{1,2})\s*[:hH.]\s*(\d{2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 24 || mi > 59) return t;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

type Col = 'seq' | 'bus' | 'start' | 'line' | 'end' | 'driverName' | 'conductorName' | 'skip';
const HEADER: [RegExp, Col][] = [
  [/^(seq|n|nº|no|ordem|#)$/, 'seq'],
  [/^(carro|onibus|ônibus|prefixo|veiculo|veículo|frota)/, 'bus'],
  [/^(hora|horario|horário|inicio|início|saida|saída|pegada)/, 'start'],
  [/^linha/, 'line'],
  [/^(rend|rendicao|rendição|fim|termino|término|largada)/, 'end'],
  [/^motorista/, 'driverName'],
  [/^(cobrador|cobradora)/, 'conductorName'],
];
const DEFAULT_ORDER: Col[] = ['seq', 'bus', 'start', 'line', 'end', 'driverName', 'conductorName'];

/**
 * Lê uma tabela colada do Excel/Google Planilhas (separada por tabulação) ou um CSV (; ou ,).
 * Reconhece o cabeçalho (SEQ, CARRO, HORA, LINHA, REND., MOTORISTA, COBRADOR) em qualquer ordem;
 * sem cabeçalho, usa essa ordem. Colunas desconhecidas (ex.: JORNADA) são ignoradas.
 */
export function parseTable(text: string): ExtraRow[] {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  // separador: o mais frequente nas primeiras linhas (a primeira pode ser só o título)
  const head = lines.slice(0, 3).join('\n');
  const count = (c: string) => head.split(c).length;
  const sep = count('\t') > 1 ? '\t' : count(';') >= count(',') ? ';' : ',';
  const split = (l: string) => {
    if (sep === '\t') return l.split('\t');
    const out: string[] = []; let cur = ''; let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  let order: Col[] = DEFAULT_ORDER;
  let start = 0;
  // o cabeçalho pode vir depois de uma linha de título (ex.: "ESCALA DE ELEIÇÃO 25/10/2026")
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const cells = split(lines[i]).map((c) => clean(c).toLowerCase().replace(/\.$/, ''));
    const mapped = cells.map((c) => HEADER.find(([re]) => re.test(c))?.[1] ?? 'skip');
    if (mapped.filter((m) => m !== 'skip').length >= 3) { order = mapped; start = i + 1; break; }
  }
  const rows: ExtraRow[] = [];
  for (const l of lines.slice(start)) {
    const cells = split(l);
    const r = emptyRow();
    order.forEach((col, i) => { if (col !== 'skip') (r[col] as string) = clean(cells[i]); });
    r.start = normTime(r.start); r.end = normTime(r.end);
    if (!r.driverName && !r.conductorName && !r.bus && !r.start) continue;
    rows.push(r);
  }
  return rows;
}

/**
 * Liga o nome escrito na escala a uma pessoa cadastrada (prefere a função da coluna).
 * Vincula quando o melhor candidato é único e cobre todas as palavras do cadastro
 * ou todas as palavras escritas na escala (ex.: "JOSE ALEXANDRE" → "JOSÉ ALEXANDRE DA SILVA").
 */
export function matchPerson(name: string, people: Person[], role: Role): number | null {
  if (nameTokens(name).length < 1) return null;
  const typed = nameTokens(name);
  for (const pool of [people.filter((p) => p.role === role), people]) {
    const exact = pool.filter((p) => nameTokens(p.name).join(' ') === typed.join(' '));
    if (exact.length === 1) return exact[0].id;
    const ms = findNameMatches(name, pool, (p) => p.name);
    if (!ms.length) continue;
    const { auto } = pickPerson(ms);
    if (auto) return auto.id;
    const top = ms[0];
    const tie = ms.filter((m) => m.score === top.score).length > 1;
    if (!tie && top.matched === typed.length) return top.item.id;
  }
  return null;
}

/** Linhas da escala em que a pessoa aparece. */
export const rowsOf = (rows: ExtraRow[], personId: number | null) =>
  personId == null ? [] : rows.filter((r) => r.driverId === personId || r.conductorId === personId);

const sameName = (a: string, b: string) => { const x = nameTokens(a).join(' '); return x !== '' && x === nameTokens(b).join(' '); };
/**
 * Papel da pessoa na linha: pelo vínculo com o cadastro ou, se a linha ficou sem vínculo,
 * pelo nome escrito igual ao do cadastro (ignorando acentos e maiúsculas).
 */
export function myRole(r: ExtraRow, personId: number | null, personName: string | null): 'driver' | 'conductor' | null {
  if (personId == null) return null;
  if (r.driverId === personId || (r.driverId == null && personName && sameName(r.driverName, personName))) return 'driver';
  if (r.conductorId === personId || (r.conductorId == null && personName && sameName(r.conductorName, personName))) return 'conductor';
  return null;
}
