import { describe, expect, it } from 'vitest';
import { addDays, fitsAvailability, isSaturday, nextSaturday, sundayOf, weekendSaturdayOf, absInterval, overlaps } from '../shared/time';

describe('datas reais', () => {
  it('calcula o domingo seguinte na virada do mês', () => {
    expect(sundayOf('2026-10-31')).toBe('2026-11-01');
    expect(isSaturday('2026-10-31')).toBe(true);
  });
  it('calcula o domingo seguinte na virada do ano', () => {
    expect(isSaturday('2022-12-31')).toBe(true);
    expect(sundayOf('2022-12-31')).toBe('2023-01-01');
    expect(addDays('2023-01-07', -7)).toBe('2022-12-31');
  });
  it('trata ano bissexto', () => {
    expect(addDays('2024-02-24', 7)).toBe('2024-03-02');
    expect(addDays('2025-02-22', 7)).toBe('2025-03-01');
  });
  it('só aceita sábado como data base', () => {
    expect(isSaturday('2026-10-17')).toBe(true);
    expect(isSaturday('2026-10-18')).toBe(false);
    expect(isSaturday('2026-02-30')).toBe(false);
    expect(weekendSaturdayOf('2026-10-18')).toBe('2026-10-17');
    expect(weekendSaturdayOf('2026-10-19')).toBeNull();
    expect(nextSaturday('2026-10-11')).toBe('2026-10-17');
  });
});

describe('turnos atravessando a meia-noite', () => {
  it('18:20–00:20 termina no dia seguinte', () => {
    const iv = absInterval('2026-10-17', '18:20', '00:20');
    expect(iv.e - iv.s).toBe(360);
  });
  it('sábado 23:00–01:00 sobrepõe domingo 00:30', () => {
    expect(overlaps(absInterval('2026-10-17', '23:00', '01:00'), absInterval('2026-10-18', '00:30', '02:00'))).toBe(true);
    expect(overlaps(absInterval('2026-10-17', '23:00', '01:00'), absInterval('2026-10-18', '01:00', '02:00'))).toBe(false);
  });
  it('serviço precisa caber inteiro na disponibilidade', () => {
    expect(fitsAvailability('2026-10-17', '18:20', '00:20', '18:00', '01:00')).toBe(true);
    expect(fitsAvailability('2026-10-17', '18:20', '00:20', '18:00', '23:59')).toBe(false);
    expect(fitsAvailability('2026-10-17', '05:00', '11:00', '05:00', '13:00')).toBe(true);
    expect(fitsAvailability('2026-10-17', '04:30', '11:00', '05:00', '13:00')).toBe(false);
    // madrugada pertence à janela iniciada no dia anterior
    expect(fitsAvailability('2026-10-18', '00:30', '02:00', '22:00', '06:00')).toBe(true);
    // 00:00–00:00 = disponível 24h
    expect(fitsAvailability('2026-10-17', '22:00', '03:00', '00:00', '00:00')).toBe(true);
  });
});

import { cleanUrl } from '../server/db';
describe('conexão Supabase', () => {
  it('remove parâmetros da POSTGRES_URL que conflitam com o driver', () => {
    expect(cleanUrl('postgres://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x'))
      .toBe('postgres://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres');
  });
});

import { poolerCandidates } from '../server/db';
describe('pooler do Supabase', () => {
  it('gera endereços alternativos da mesma região', () => {
    expect(poolerCandidates('postgres://u.ref:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres')).toEqual([
      'postgres://u.ref:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
      'postgres://u.ref:p@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
      'postgres://u.ref:p@aws-2-us-east-1.pooler.supabase.com:6543/postgres',
    ]);
    expect(poolerCandidates('postgres://u:p@localhost:5432/x')).toEqual(['postgres://u:p@localhost:5432/x']);
  });
});

describe('horas estimadas', () => {
  it('calcula a duração do serviço, inclusive passando da meia-noite', async () => {
    const { serviceMinutes, fmtHours } = await import('../shared/time');
    expect(serviceMinutes('05:00', '11:45')).toBe(405);
    expect(serviceMinutes('18:30', '00:10')).toBe(340);
    expect(serviceMinutes('', '11:00')).toBe(0);
    expect(fmtHours(405)).toBe('6h45');
    expect(fmtHours(420)).toBe('7h');
    expect(fmtHours(65)).toBe('1h05');
  });
});
