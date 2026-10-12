import { describe, expect, it } from 'vitest';
import { buildContextMaps, canConfirm, hasErrors, validateSchedule, type RuleContext, serviceBusConflicts } from '../shared/rules';
import type { ConfirmedWork, Entry, Person } from '../shared/types';
import { bus, entry, line, person, service } from './helpers';

const SAT = '2026-10-17';
const SUN = '2026-10-18';

function ctx(people: Person[], otherConfirmed: ConfirmedWork[] = [], extra: Partial<RuleContext> = {}): RuleContext {
  return {
    saturday: SAT,
    ...buildContextMaps(people, [line(1), line(2)], [bus(1), bus(2), bus(3)]),
    otherConfirmed, settings: { maxServicesPerDay: 1 }, ...extra,
  };
}
const codes = (entries: Entry[], c: RuleContext) => validateSchedule(entries, c).filter((i) => i.severity === 'error').map((i) => i.code);
const P = [person(1, 'motorista'), person(2, 'cobrador'), person(3, 'motorista'), person(4, 'cobrador')];

describe('alternância semanal', () => {
  it('bloqueia dois sábados consecutivos', () => {
    const e = [entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e, ctx(P, [{ personId: 1, date: '2026-10-10', scheduleId: 9 }]))).toContain('WEEKLY_PREV');
  });
  it('bloqueia dois domingos consecutivos', () => {
    const e = [entry(SUN, '06:00', '12:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e, ctx(P, [{ personId: 2, date: '2026-10-11', scheduleId: 9 }]))).toContain('WEEKLY_PREV');
  });
  it('permite sábado anterior e domingo atual (e vice-versa)', () => {
    const e = [entry(SUN, '06:00', '12:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e, ctx(P, [{ personId: 1, date: '2026-10-10', scheduleId: 9 }]))).toEqual([]);
    const e2 = [entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e2, ctx(P, [{ personId: 1, date: '2026-10-11', scheduleId: 9 }]))).toEqual([]);
  });
  it('um dia por fim de semana: bloqueia sábado e domingo do mesmo fim de semana (padrão)', () => {
    const e = [
      entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2, busId: 1 }),
      entry(SUN, '06:00', '12:00', { driverId: 1, conductorId: 4, busId: 1 }),
    ];
    expect(codes(e, ctx(P))).toContain('SAME_WEEKEND');
  });
  it('permite sábado e domingo no mesmo fim de semana quando configurado', () => {
    const e = [
      entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2, busId: 1 }),
      entry(SUN, '06:00', '12:00', { driverId: 1, conductorId: 2, busId: 1 }),
    ];
    const issues = validateSchedule(e, ctx(P, [], { settings: { maxServicesPerDay: 1, allowBothDays: true } }));
    expect(hasErrors(issues)).toBe(false);
    expect(canConfirm(issues)).toBe(true);
  });
  it('quem trabalha sábado 10/10 não trabalha domingo 11/10 nem sábado 17/10, mas pode domingo 18/10', () => {
    const c10 = { ...ctx(P), saturday: '2026-10-10' };
    expect(codes([entry('2026-10-10', '06:00', '12:00', { driverId: 1, conductorId: 2, busId: 1 }),
      entry('2026-10-11', '06:00', '12:00', { driverId: 1, conductorId: 4, busId: 1 })], c10)).toContain('SAME_WEEKEND');
    const work = [{ personId: 1, date: '2026-10-10', scheduleId: 1 }];
    expect(codes([entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2 })], ctx(P, work))).toContain('WEEKLY_PREV');
    expect(codes([entry(SUN, '06:00', '12:00', { driverId: 1, conductorId: 2 })], ctx(P, work))).toEqual([]);
  });
  it('ao editar escala antiga, confere o sábado seguinte já confirmado', () => {
    const e = [entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e, ctx(P, [{ personId: 1, date: '2026-10-24', scheduleId: 10 }]))).toContain('WEEKLY_NEXT');
  });
  it('virada de mês e de ano', () => {
    const c = { ...ctx(P, [{ personId: 1, date: '2022-12-31', scheduleId: 1 }]), saturday: '2023-01-07' };
    expect(codes([entry('2023-01-07', '06:00', '12:00', { driverId: 1, conductorId: 2 })], c)).toContain('WEEKLY_PREV');
    const c2 = { ...ctx(P, [{ personId: 2, date: '2026-10-25', scheduleId: 1 }]), saturday: '2026-10-31' };
    expect(codes([entry('2026-11-01', '06:00', '12:00', { driverId: 1, conductorId: 2 })], c2)).toContain('WEEKLY_PREV');
  });
  it('usa o dia de início do serviço que atravessa a meia-noite', () => {
    // trabalhou sábado anterior 23:00–02:00 (registrado no sábado); hoje domingo é permitido, sábado não
    const work = [{ personId: 1, date: '2026-10-10', scheduleId: 1 }];
    expect(codes([entry(SUN, '00:30', '04:00', { driverId: 1, conductorId: 2 })], ctx(P, work))).toEqual([]);
    expect(codes([entry(SAT, '23:00', '02:00', { driverId: 1, conductorId: 2 })], ctx(P, work))).toContain('WEEKLY_PREV');
  });
});

describe('cadastro, função e turno', () => {
  it('rejeita função incompatível', () => {
    expect(codes([entry(SAT, '06:00', '12:00', { driverId: 2, conductorId: 1 })], ctx(P))).toEqual(['ROLE', 'ROLE']);
  });
  it('rejeita turno incompatível', () => {
    const people = [person(1, 'motorista', '05:00', '13:00'), person(2, 'cobrador', '18:00', '01:00')];
    const e = [entry(SAT, '12:00', '18:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e, ctx(people))).toEqual(['AVAILABILITY', 'AVAILABILITY']);
    const ok = [entry(SAT, '18:20', '00:20', { driverId: 3, conductorId: 2 })];
    expect(codes(ok, ctx([...people, person(3, 'motorista', '18:00', '01:00')]))).toEqual([]);
  });
  it('rejeita pessoa inativa, mas preserva atribuição antiga inalterada', () => {
    const people = [person(1, 'motorista', '00:00', '00:00', { active: false }), person(2, 'cobrador')];
    const e = [entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2 })];
    expect(codes(e, ctx(people))).toEqual(['PERSON_INACTIVE']);
    expect(codes(e, ctx(people, [], { baseline: e }))).toEqual([]);
  });
  it('vaga vazia é incompleta: rascunho pode salvar, confirmação bloqueada', () => {
    const issues = validateSchedule([entry(SAT, '06:00', '12:00', { driverId: 1 })], ctx(P));
    expect(hasErrors(issues)).toBe(false);
    expect(canConfirm(issues)).toBe(false);
  });
  it('rejeita datas fora do fim de semana', () => {
    expect(codes([entry('2026-10-19', '06:00', '12:00', { driverId: 1, conductorId: 2 })], ctx(P))).toContain('BAD_DATE');
  });
});

describe('sobreposição', () => {
  it('rejeita pessoa em horários sobrepostos (mesmo com limite maior)', () => {
    const e = [
      entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2, busId: 1 }),
      entry(SAT, '11:00', '15:00', { driverId: 1, conductorId: 4, busId: 2 }),
    ];
    expect(codes(e, ctx(P, [], { settings: { maxServicesPerDay: 2 } }))).toContain('PERSON_OVERLAP');
  });
  it('limite de serviços por dia é configurável', () => {
    const e = [
      entry(SAT, '06:00', '10:00', { driverId: 1, conductorId: 2, busId: 1 }),
      entry(SAT, '11:00', '15:00', { driverId: 1, conductorId: 4, busId: 2 }),
    ];
    expect(codes(e, ctx(P))).toContain('DAY_LIMIT');
    expect(codes(e, ctx(P, [], { settings: { maxServicesPerDay: 2 } }))).toEqual([]);
  });
  it('rejeita ônibus em horários sobrepostos, inclusive após a meia-noite', () => {
    const e = [
      entry(SAT, '23:00', '01:00', { driverId: 1, conductorId: 2, busId: 3 }),
      entry(SUN, '00:30', '05:00', { driverId: 3, conductorId: 4, busId: 3 }),
    ];
    expect(codes(e, ctx(P))).toContain('BUS_OVERLAP');
    const ok = [{ ...e[0] }, { ...e[1], startTime: '01:00' }];
    expect(codes(ok, ctx(P))).toEqual([]);
  });
  it('pessoa em turno que atravessa a meia-noite e serviço de domingo cedo', () => {
    const e = [
      entry(SAT, '18:20', '00:20', { driverId: 1, conductorId: 2, busId: 1 }),
      entry(SUN, '00:10', '06:00', { driverId: 1, conductorId: 4, busId: 2 }),
    ];
    expect(codes(e, ctx(P))).toContain('PERSON_OVERLAP');
  });
  it('serviços-modelo: mesmo ônibus só sem sobreposição', () => {
    const s = [service(1, 6, '05:00', '11:00', 1), service(2, 6, '11:00', '17:00', 1), service(3, 6, '16:00', '20:00', 1), service(4, 0, '16:00', '20:00', 1)];
    const conf = serviceBusConflicts(s);
    expect(conf.map(([a, b]) => [a.id, b.id])).toEqual([[2, 3]]);
  });
});

describe('histórico ausente', () => {
  it('gera aviso claro, sem tratar como prova de que ninguém trabalhou', () => {
    const issues = validateSchedule([entry(SAT, '06:00', '12:00', { driverId: 1, conductorId: 2 })], ctx(P, [], { historyMissing: { saturday: true, sunday: false } }));
    const w = issues.filter((i) => i.severity === 'warning');
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/não consegue verificar a alternância/);
    expect(w[0].message).toMatch(/NÃO significa que ninguém trabalhou/);
    expect(canConfirm(issues)).toBe(true);
  });
});

describe('sobreposição herdada da versão salva', () => {
  it('vira aviso quando já existia; volta a ser erro se a edição criar outra', () => {
    const e = [
      entry(SAT, '05:50', '13:15', { driverId: 1, conductorId: 2, busId: 1 }),
      entry(SAT, '13:12', '20:20', { driverId: 3, conductorId: 2, busId: 2 }),
    ];
    const c = ctx(P, [], { settings: { maxServicesPerDay: 2 }, baseline: e });
    expect(validateSchedule(e, c).find((i) => i.code === 'PERSON_OVERLAP')?.severity).toBe('warning');
    const changed = [e[0], { ...e[1], startTime: '13:00' }];
    expect(validateSchedule(changed, c).find((i) => i.code === 'PERSON_OVERLAP')?.severity).toBe('error');
  });
});
