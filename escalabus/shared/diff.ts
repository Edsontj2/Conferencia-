import { dayLabel, fmtDate } from './time';
import type { Entry } from './types';

const FIELDS: [keyof Entry, string][] = [
  ['date', 'data'], ['lineCode', 'linha'], ['busFleet', 'carro'], ['startTime', 'início'], ['endTime', 'término'],
  ['shiftName', 'turno'], ['driverName', 'motorista'], ['conductorName', 'cobrador'],
];

const desc = (e: Entry) => `${safe(e.date)} ${e.startTime}–${e.endTime} linha ${e.lineCode || '?'}`;
function safe(d: string) {
  try { return `${dayLabel(d)} ${fmtDate(d)}`; } catch { return d; }
}

/** Descreve em texto as diferenças entre duas versões da escala (para o registro de alterações). */
export function diffEntries(before: Entry[], after: Entry[]): string[] {
  const out: string[] = [];
  const bm = new Map(before.map((e) => [e.id, e]));
  const am = new Map(after.map((e) => [e.id, e]));
  for (const a of after) {
    const b = bm.get(a.id);
    if (!b) { out.push(`Serviço incluído: ${desc(a)} (mot.: ${a.driverName || '—'}, cob.: ${a.conductorName || '—'})`); continue; }
    const ch: string[] = [];
    for (const [k, label] of FIELDS) {
      if ((b[k] ?? '') !== (a[k] ?? '')) {
        const v = (x: unknown) => (k === 'date' ? fmtDate(String(x)) : String(x ?? '') || '—');
        ch.push(`${label}: ${v(b[k])} → ${v(a[k])}`);
      }
    }
    if (ch.length) out.push(`${desc(b)}: ${ch.join('; ')}`);
  }
  for (const b of before) if (!am.has(b.id)) out.push(`Serviço removido: ${desc(b)}`);
  return out;
}
