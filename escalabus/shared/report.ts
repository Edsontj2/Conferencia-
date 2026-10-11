import { compareEntries } from './generator';
import { parseHM, WEEKDAY_NAMES, weekdayOf, fmtDateDash } from './time';
import type { Entry } from './types';

export interface ReportRow {
  seq: number;
  entry: Entry;
}
export interface ReportSection {
  shiftName: string;
  rows: ReportRow[];
}
export interface ReportDay {
  date: string;
  title: string; // ESCALA SÁBADO DD-MM-AAAA
  sections: ReportSection[];
}

export function reportTitle(date: string): string {
  return `ESCALA ${WEEKDAY_NAMES[weekdayOf(date)]} ${fmtDateDash(date)}`;
}

/**
 * Monta o relatório de um dia: separa por turno (turnos ordenados pelo primeiro horário),
 * ordena por horário inicial e reinicia a sequência em cada turno.
 */
export function buildReportDay(entries: Entry[], date: string): ReportDay {
  const ofDay = entries.filter((e) => e.date === date).sort(compareEntries);
  const groups = new Map<string, Entry[]>();
  for (const e of ofDay) {
    const k = e.shiftName?.trim() || 'Sem turno';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const sections = [...groups.entries()]
    .sort((a, b) => parseHM(a[1][0].startTime) - parseHM(b[1][0].startTime) || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([shiftName, list]) => ({ shiftName, rows: list.map((entry, i) => ({ seq: i + 1, entry })) }));
  return { date, title: reportTitle(date), sections };
}
