import { buildReportDay } from './report';
import { dayLabel, fmtDate } from './time';
import type { Entry } from './types';

/** Mantém somente dígitos do telefone. */
export function normalizePhone(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D+/g, '');
}

/** Valida número internacional (código do país + DDD + número). Retorna mensagem de erro ou null. */
export function phoneProblem(raw: string | null | undefined): string | null {
  const d = normalizePhone(raw);
  if (!d) return 'Informe o número.';
  if (d.length < 12) return 'Inclua o código do país e o DDD (ex.: 55 11 98765-4321).';
  if (d.length > 15) return 'Número longo demais.';
  if (d.startsWith('55') && (d.length < 12 || d.length > 13)) return 'Número brasileiro deve ter 55 + DDD + 8 ou 9 dígitos.';
  return null;
}

export function waLink(phone: string, text: string): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

export function formatPhone(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return d ? `+${d}` : '';
}

export interface MessageOptions {
  companyName?: string;
  dates: string[]; // sábado e/ou domingo
  shiftName?: string; // limitar a um turno
  demo?: boolean;
}

/** Mensagem da escala para WhatsApp, organizada por dia e turno. */
export function buildScheduleMessage(entries: Entry[], opt: MessageOptions): string {
  const out: string[] = [];
  if (opt.demo) out.push('⚠️ DEMONSTRAÇÃO – dados fictícios');
  if (opt.companyName) out.push(`*${opt.companyName}*`);
  for (const date of opt.dates) {
    const day = buildReportDay(entries, date);
    const sections = opt.shiftName ? day.sections.filter((s) => s.shiftName === opt.shiftName) : day.sections;
    out.push('', `*${day.title}*`);
    if (sections.length === 0) out.push('(sem serviços)');
    for (const s of sections) {
      out.push('', `_Turno: ${s.shiftName}_`);
      for (const { seq, entry: e } of s.rows) {
        out.push(
          `${seq}. ${e.startTime} às ${e.endTime} | Linha ${e.lineCode} | Carro ${e.busFleet}`,
          `   Mot.: ${e.driverName || '— (vaga aberta)'}`,
          `   Cob.: ${e.conductorName || '— (vaga aberta)'}`,
        );
      }
    }
  }
  return out.join('\n').trim();
}

/** Mensagem individual com os serviços de uma pessoa no fim de semana. */
export function buildPersonMessage(personId: number, personName: string, entries: Entry[], opt: { companyName?: string; demo?: boolean } = {}): string {
  const mine = entries
    .filter((e) => e.driverId === personId || e.conductorId === personId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const out: string[] = [];
  if (opt.demo) out.push('⚠️ DEMONSTRAÇÃO – dados fictícios');
  if (opt.companyName) out.push(`*${opt.companyName}*`);
  out.push(`Olá, ${personName}! Sua escala:`);
  if (mine.length === 0) out.push('Você não está escalado(a) neste fim de semana.');
  for (const e of mine) {
    const parceiro = e.driverId === personId ? `Cobrador: ${e.conductorName || '—'}` : `Motorista: ${e.driverName || '—'}`;
    out.push(
      '',
      `*${dayLabel(e.date)} ${fmtDate(e.date)}*`,
      `Turno: ${e.shiftName} | ${e.startTime} às ${e.endTime}`,
      `Linha ${e.lineCode} | Carro ${e.busFleet}`,
      parceiro,
    );
  }
  return out.join('\n').trim();
}
