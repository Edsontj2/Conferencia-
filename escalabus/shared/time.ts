/**
 * Utilitários de data e hora. Datas são strings ISO "YYYY-MM-DD" tratadas como dias
 * de calendário (sem fuso), convertidas para um número de dia absoluto via UTC.
 * Assim a comparação funciona na virada de mês e de ano sem efeitos de horário de verão.
 */
const MS_DAY = 86_400_000;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const WEEKDAY_NAMES = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
export const WEEKDAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function isValidHM(s: string | null | undefined): boolean {
  return typeof s === 'string' && HM_RE.test(s);
}

export function parseHM(s: string): number {
  const m = HM_RE.exec(s);
  if (!m) throw new Error(`Horário inválido: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidDate(s: string | null | undefined): boolean {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function dateToDay(iso: string): number {
  const m = DATE_RE.exec(iso);
  if (!m || !isValidDate(iso)) throw new Error(`Data inválida: ${iso}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DAY);
}

export function dayToDate(day: number): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return dayToDate(dateToDay(iso) + n);
}

export function weekdayOf(iso: string): number {
  return new Date(dateToDay(iso) * MS_DAY).getUTCDay();
}

export const isSaturday = (iso: string) => isValidDate(iso) && weekdayOf(iso) === 6;
export const isSunday = (iso: string) => isValidDate(iso) && weekdayOf(iso) === 0;
export const sundayOf = (saturday: string) => addDays(saturday, 1);

/** Sábado do fim de semana da data (sábado ou domingo); null para dias úteis. */
export function weekendSaturdayOf(iso: string): string | null {
  const wd = weekdayOf(iso);
  if (wd === 6) return iso;
  if (wd === 0) return addDays(iso, -1);
  return null;
}

/** Próximo sábado a partir de uma data (inclusive). */
export function nextSaturday(iso: string): string {
  const wd = weekdayOf(iso);
  return addDays(iso, (6 - wd + 7) % 7);
}

export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** DD/MM/AAAA */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** DD-MM-AAAA (usado no título do relatório) */
export function fmtDateDash(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function dayLabel(iso: string): string {
  return WEEKDAY_LABEL[weekdayOf(iso)];
}

/** Intervalo absoluto [início, fim) em minutos; fim <= início significa que atravessa a meia-noite. */
export function absInterval(date: string, start: string, end: string): { s: number; e: number } {
  const base = dateToDay(date) * 1440;
  const s = parseHM(start);
  let e = parseHM(end);
  if (e <= s) e += 1440;
  return { s: base + s, e: base + e };
}

export function crossesMidnight(start: string, end: string): boolean {
  return parseHM(end) <= parseHM(start);
}

export function overlaps(a: { s: number; e: number }, b: { s: number; e: number }): boolean {
  return a.s < b.e && b.s < a.e;
}

/**
 * Verifica se o serviço inteiro cabe na disponibilidade da pessoa.
 * A disponibilidade se repete todos os dias; se ela atravessa a meia-noite (ex.: 18:00–02:00),
 * um serviço que começa de madrugada pode pertencer à janela iniciada no dia anterior.
 * Início igual ao fim significa disponibilidade de 24 horas (sem restrição de turno).
 */
export function fitsAvailability(date: string, start: string, end: string, availStart: string, availEnd: string): boolean {
  if (availStart === availEnd) return true;
  const svc = absInterval(date, start, end);
  const day = dateToDay(date);
  for (const anchor of [day - 1, day]) {
    const w = absInterval(dayToDate(anchor), availStart, availEnd);
    if (svc.s >= w.s && svc.e <= w.e) return true;
  }
  return false;
}

export function durationLabel(start: string, end: string): string {
  return crossesMidnight(start, end) ? `${start}–${end} (+1 dia)` : `${start}–${end}`;
}
