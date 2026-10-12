import { describe, expect, it } from 'vitest';
import { buildPersonMessage, buildScheduleMessage, normalizePhone, phoneProblem, waLink } from '../shared/whatsapp';
import { buildReportDay, reportTitle } from '../shared/report';
import { entry } from './helpers';

describe('wa.me', () => {
  it('normaliza telefone para somente dígitos', () => {
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('5511987654321');
  });
  it('monta o link com texto codificado', () => {
    const url = waLink('+55 (11) 98765-4321', 'Escala & turno: 05:30 às 11:00\nLinha 0.783 #1');
    expect(url).toBe('https://wa.me/5511987654321?text=' + encodeURIComponent('Escala & turno: 05:30 às 11:00\nLinha 0.783 #1'));
    expect(url.split('?text=')[1]).not.toMatch(/[\s&#]/);
    expect(url).toContain('%0A');
    expect(url).toContain('%26');
  });
  it('exige código do país e DDD', () => {
    expect(phoneProblem('(11) 98765-4321')).toMatch(/código do país/);
    expect(phoneProblem('55 11 98765-4321')).toBeNull();
    expect(phoneProblem('351 912 345 678')).toBeNull();
  });
});

describe('mensagens e relatório', () => {
  const es = [
    entry('2026-10-17', '13:00', '19:00', { shiftName: 'Tarde', lineCode: '141.8', busFleet: '2201', driverId: 1, driverName: 'Ana', conductorId: 2, conductorName: 'Bia' }),
    entry('2026-10-17', '05:30', '11:00', { shiftName: 'Manhã', lineCode: '0.783', busFleet: '2202', driverId: 3, driverName: 'Caio', conductorId: 4, conductorName: 'Duda' }),
    entry('2026-10-17', '06:00', '12:00', { shiftName: 'Manhã', lineCode: '0.783', busFleet: '2203', driverId: 1, driverName: 'Ana', conductorId: null, conductorName: '' }),
    entry('2026-10-18', '18:20', '00:20', { shiftName: 'Noite', lineCode: '0.783', busFleet: '2202', driverId: 1, driverName: 'Ana', conductorId: 2, conductorName: 'Bia' }),
  ];
  it('título no padrão do relatório', () => {
    expect(reportTitle('2026-10-17')).toBe('ESCALA SÁBADO 17-10-2026');
    expect(reportTitle('2026-10-18')).toBe('ESCALA DOMINGO 18-10-2026');
  });
  it('separa por turno, ordena por horário e reinicia a sequência', () => {
    const d = buildReportDay(es, '2026-10-17');
    expect(d.sections.map((s) => s.shiftName)).toEqual(['Manhã', 'Tarde']);
    expect(d.sections[0].rows.map((r) => [r.seq, r.entry.startTime])).toEqual([[1, '05:30'], [2, '06:00']]);
    expect(d.sections[1].rows[0].seq).toBe(1);
  });
  it('mensagem do fim de semana contém data, turno, linha, carro, horários e pessoas', () => {
    const m = buildScheduleMessage(es, { companyName: 'Viação X', dates: ['2026-10-17', '2026-10-18'] });
    expect(m).toContain('*ESCALA SÁBADO 17-10-2026*');
    expect(m).toContain('*ESCALA DOMINGO 18-10-2026*');
    expect(m).toContain('_Turno: Manhã_');
    expect(m).toContain('1. 05:30 às 11:00 | Linha 0.783 | Carro 2202');
    expect(m).toContain('Mot.: Caio');
    expect(m).toContain('Cob.: — (vaga aberta)');
  });
  it('mensagem individual', () => {
    const m = buildPersonMessage(1, 'Ana', es);
    expect(m.match(/Linha/g)).toHaveLength(3);
    expect(m).toContain('Domingo 18/10/2026');
    expect(m).toContain('Cobrador: Bia');
  });
});
