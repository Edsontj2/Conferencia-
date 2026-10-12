import { describe, expect, it } from 'vitest';
import { buildSlotsFromServices, generateSchedule } from '../shared/generator';
import { buildContextMaps, canConfirm, validateSchedule } from '../shared/rules';
import type { ConfirmedWork, Person } from '../shared/types';
import { bus, entry, line, person, service } from './helpers';

const SAT = '2026-10-17';
const SUN = '2026-10-18';
let n = 0;
const mkId = () => `s${++n}`;

function check(entries: ReturnType<typeof generateSchedule>['entries'], people: Person[], work: ConfirmedWork[] = [], max = 1) {
  return validateSchedule(entries, {
    saturday: SAT, ...buildContextMaps(people, [line(1)], [bus(1), bus(2), bus(3), bus(4)]),
    otherConfirmed: work, settings: { maxServicesPerDay: max },
  });
}

describe('geração aleatória', () => {
  it('preenche todas as vagas respeitando as regras e usa só itens ativos', () => {
    const services = [service(1, 6, '05:00', '11:00', 1), service(2, 6, '11:00', '17:00', 2), service(3, 0, '05:00', '11:00', 1),
      { ...service(4, 0, '06:00', '10:00', 3), active: false }];
    const { entries } = buildSlotsFromServices(SAT, services, [line(1)], [bus(1), bus(2), bus(3)], mkId);
    expect(entries).toHaveLength(3);
    const people = [person(1, 'motorista'), person(2, 'motorista'), person(3, 'cobrador'), person(4, 'cobrador'),
      person(5, 'motorista', '00:00', '00:00', { active: false }), person(6, 'motorista'), person(7, 'cobrador')];
    for (let seed = 1; seed <= 30; seed++) {
      const r = generateSchedule({ entries, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed });
      expect(r.unfilled).toEqual([]);
      expect(r.entries.some((e) => e.driverId === 5)).toBe(false);
      expect(canConfirm(check(r.entries, people))).toBe(true);
    }
  });

  it('sorteio respeita um dia por fim de semana', () => {
    const slots = [entry(SAT, '06:00', '12:00', { busId: 1 }), entry(SUN, '06:00', '12:00', { busId: 1 })];
    const people = [person(1, 'motorista'), person(3, 'cobrador'), person(4, 'cobrador')];
    for (let seed = 1; seed <= 10; seed++) {
      const r = generateSchedule({ entries: slots, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed });
      expect(r.unfilled.filter((u) => u.role === 'driver')).toHaveLength(1);
      expect(r.unfilled[0].reasons.join(' ')).toMatch(/outro dia deste fim de semana/);
      const both = generateSchedule({ entries: slots, people, otherConfirmed: [], settings: { maxServicesPerDay: 1, allowBothDays: true }, historyCounts: {}, seed });
      expect(both.unfilled).toEqual([]);
    }
  });

  it('ignora serviços com linha ou ônibus inativos', () => {
    const r = buildSlotsFromServices(SAT, [service(1, 6, '05:00', '11:00', 1), service(2, 6, '05:00', '11:00', 2)], [line(1)], [bus(1), bus(2, false)], mkId);
    expect(r.entries).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/inativo/);
  });

  it('respeita a alternância: quem trabalhou sábado anterior fica fora do sábado mas pode no domingo', () => {
    const slots = [entry(SAT, '06:00', '12:00', { busId: 1 }), entry(SUN, '06:00', '12:00', { busId: 1 })];
    const people = [person(1, 'motorista'), person(2, 'motorista'), person(3, 'cobrador'), person(4, 'cobrador')];
    const work = [{ personId: 1, date: '2026-10-10', scheduleId: 1 }];
    for (let seed = 1; seed <= 20; seed++) {
      const r = generateSchedule({ entries: slots, people, otherConfirmed: work, settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed });
      expect(r.entries[0].driverId).toBe(2);
      expect(r.unfilled).toEqual([]);
    }
  });

  it('encontra solução que exige reconsiderar a escolha inicial (retrocesso)', () => {
    // A (id 1) tem menos histórico e serve nas duas vagas; B (id 2) só serve na manhã.
    // Sem MRV, o sorteio tenta primeiro A na manhã e deixaria a tarde sem motorista; o retrocesso corrige.
    const slots = [entry(SAT, '06:00', '12:00', { busId: 1 }), entry(SAT, '13:00', '19:00', { busId: 2 })];
    const people = [person(1, 'motorista', '05:00', '20:00'), person(2, 'motorista', '05:00', '12:30'), person(3, 'cobrador'), person(4, 'cobrador')];
    for (let seed = 1; seed <= 20; seed++) {
      const r = generateSchedule({
        entries: slots, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 },
        historyCounts: { 1: 0, 2: 10 }, seed, disableMrv: true,
      });
      expect(r.unfilled).toEqual([]);
      expect(r.entries[0].driverId).toBe(2);
      expect(r.entries[1].driverId).toBe(1);
    }
  });

  it('instância maior com restrições cruzadas é resolvida para várias sementes', () => {
    const slots = [] as ReturnType<typeof entry>[];
    const times: [string, string][] = [['04:00', '10:00'], ['06:00', '12:00'], ['10:00', '16:00'], ['12:00', '18:00'], ['16:00', '22:00'], ['18:20', '00:20']];
    for (const d of [SAT, SUN]) times.forEach(([s, e], i) => slots.push(entry(d, s, e, { busId: i + 1 })));
    const avail: [string, string][] = [['04:00', '10:00'], ['06:00', '12:00'], ['10:00', '16:00'], ['12:00', '18:00'], ['16:00', '22:00'], ['18:00', '01:00']];
    const people: Person[] = [];
    avail.forEach(([s, e], i) => {
      people.push(person(100 + i, 'motorista', s, e), person(200 + i, 'cobrador', s, e));
      people.push(person(300 + i, 'motorista', '00:00', '00:00'), person(400 + i, 'cobrador', '00:00', '00:00'));
    });
    // metade das pessoas "coringa" trabalhou no sábado anterior
    const work = people.filter((p) => p.id >= 300 && p.id % 2 === 0).map((p) => ({ personId: p.id, date: '2026-10-10', scheduleId: 1 }));
    for (let seed = 1; seed <= 15; seed++) {
      const r = generateSchedule({ entries: slots, people, otherConfirmed: work, settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed });
      expect(r.unfilled).toEqual([]);
      const issues = validateSchedule(r.entries, {
        saturday: SAT, ...buildContextMaps(people, [line(1)], times.map((_, i) => bus(i + 1))), otherConfirmed: work, settings: { maxServicesPerDay: 1 },
      });
      expect(canConfirm(issues)).toBe(true);
    }
  });

  it('prioriza quem tem menos participações no histórico', () => {
    const slots = [entry(SAT, '06:00', '12:00')];
    const people = [person(1, 'motorista'), person(2, 'motorista'), person(3, 'motorista'), person(9, 'cobrador')];
    for (let seed = 1; seed <= 20; seed++) {
      const r = generateSchedule({ entries: slots, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: { 1: 5, 2: 1, 3: 5 }, seed });
      expect(r.entries[0].driverId).toBe(2);
    }
  });

  it('sorteia entre candidatos equivalentes', () => {
    const slots = [entry(SAT, '06:00', '12:00')];
    const people = [person(1, 'motorista'), person(2, 'motorista'), person(3, 'motorista'), person(9, 'cobrador')];
    const chosen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      chosen.add(generateSchedule({ entries: slots, people, otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed }).entries[0].driverId!);
    }
    expect(chosen.size).toBe(3);
  });

  it('falta de pessoas: não burla regras, deixa vagas abertas e explica as causas', () => {
    const slots = [entry(SAT, '06:00', '12:00', { busId: 1 }), entry(SAT, '07:00', '13:00', { busId: 2 }), entry(SAT, '20:00', '02:00', { busId: 3 })];
    const people = [person(1, 'motorista', '05:00', '14:00'), person(2, 'motorista'), person(3, 'cobrador', '05:00', '14:00'),
      person(4, 'cobrador', '05:00', '14:00'), person(5, 'cobrador', '18:00', '03:00')];
    const work = [{ personId: 2, date: '2026-10-10', scheduleId: 1 }];
    const r = generateSchedule({ entries: slots, people, otherConfirmed: work, settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed: 3 });
    const issues = check(r.entries, people, work);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(canConfirm(issues)).toBe(false);
    const drv = r.unfilled.filter((u) => u.role === 'driver');
    expect(drv).toHaveLength(2); // só um motorista utilizável
    expect(r.unfilled.filter((u) => u.role === 'conductor')).toHaveLength(0);
    const night = drv.find((u) => u.entryId === slots[2].id)!;
    expect(night.reasons.join(' ')).toMatch(/turno\/horário incompatível/);
    expect(night.reasons.join(' ')).toMatch(/trabalhou no sábado anterior \(10\/10\/2026\)/);
    const morning = drv.find((u) => u.entryId !== slots[2].id)!;
    expect(morning.reasons.join(' ')).toMatch(/horário sobreposto|já foram usados/);
  });

  it('sem nenhum cobrador cadastrado', () => {
    const r = generateSchedule({ entries: [entry(SAT, '06:00', '12:00')], people: [person(1, 'motorista')], otherConfirmed: [], settings: { maxServicesPerDay: 1 }, historyCounts: {}, seed: 1 });
    expect(r.unfilled).toHaveLength(1);
    expect(r.unfilled[0].reasons[0]).toMatch(/Nenhum cobrador cadastrado/);
  });

  it('com limite 2 por dia, distribui sem sobreposição', () => {
    const slots = [entry(SAT, '05:00', '09:00', { busId: 1 }), entry(SAT, '10:00', '14:00', { busId: 1 })];
    const people = [person(1, 'motorista'), person(2, 'cobrador')];
    const r = generateSchedule({ entries: slots, people, otherConfirmed: [], settings: { maxServicesPerDay: 2 }, historyCounts: {}, seed: 1 });
    expect(r.unfilled).toEqual([]);
    expect(canConfirm(check(r.entries, people, [], 2))).toBe(true);
  });
});
