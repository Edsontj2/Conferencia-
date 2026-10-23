import { describe, expect, it } from 'vitest';
import { matchPerson, normTime, parseTable } from '../shared/extras';
import type { Person } from '../shared/types';

const P = (id: number, name: string, role: Person['role']): Person => ({ id, name, role, shiftName: 'Manhã', availStart: '05:00', availEnd: '18:00', whatsapp: null, active: true });
const people = [P(1, 'JOSE ALEXANDRE DA SILVA', 'motorista'), P(2, 'YASMIM GOMES', 'cobrador'), P(3, 'YASMIM COSTA', 'cobrador'), P(4, 'PAULO HENRIQUE', 'motorista'), P(5, 'PABLO HENRIQUE', 'motorista')];

describe('escalas importadas', () => {
  it('normaliza horários', () => {
    expect(normTime('5:15')).toBe('05:15');
    expect(normTime('05h40')).toBe('05:40');
    expect(normTime('0545')).toBe('05:45');
    expect(normTime('abc')).toBe('abc');
  });
  it('lê tabela colada do Excel sem cabeçalho e CSV com cabeçalho em outra ordem', () => {
    const a = parseTable('1\t541681\t04:45\t0.783\t11:36\tFRANCISCO IVANILDO\tYASMIM GOMES\n2\t541699\t4:45\t141.9\t12:09\tFABIO SANTOS\tCLEANE GONÇALVES');
    expect(a).toHaveLength(2);
    expect(a[1]).toMatchObject({ start: '04:45', line: '141.9', conductorName: 'CLEANE GONÇALVES' });
    const b = parseTable('ESCALA DE ELEIÇÃO 25/10/2026\nMotorista;Cobrador;Linha;Hora\n"SILVA, JOSE";ANA;0.783;6:48');
    expect(b).toEqual([expect.objectContaining({ driverName: 'SILVA, JOSE', conductorName: 'ANA', line: '0.783', start: '06:48', bus: '' })]);
  });
  it('liga nomes ao cadastro sem confundir pessoas parecidas', () => {
    expect(matchPerson('JOSE ALEXANDRE', people, 'motorista')).toBe(1);
    expect(matchPerson('YASMIM GOMES', people, 'cobrador')).toBe(2);
    expect(matchPerson('YASMIM', people, 'cobrador')).toBeNull();
    expect(matchPerson('PAULO HENRIQUE', people, 'motorista')).toBe(4);
    expect(matchPerson('FULANO DE TAL', people, 'motorista')).toBeNull();
  });
});
