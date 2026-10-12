import { describe, expect, it } from 'vitest';
import { findNameMatches, nameTokens, normalizeBrPhone, pickPerson, tokenMatch } from '../shared/names';

const people = [
  { id: 1, name: 'HENRRIQUE GRECCO' }, { id: 2, name: 'ALEX OLIVERIA' }, { id: 3, name: 'JHONATHA OLIVERIA' },
  { id: 4, name: 'PAULO OLIVEIRA' }, { id: 5, name: 'PAULO SERGIO' }, { id: 6, name: 'PAULO HENRRIQUE' },
  { id: 7, name: 'FRANCISCO DE ASSIS' }, { id: 8, name: 'ANDRAIDE DA CONCEIÇÃO' }, { id: 9, name: 'JOSE FERREIRA' },
];
const find = (t: string) => pickPerson(findNameMatches(t, people, (p) => p.name));

describe('reconhecimento do nome do funcionário', () => {
  it('normaliza acentos, maiúsculas, letras dobradas e H mudo', () => {
    expect(nameTokens('Henrique Grêco')).toEqual(nameTokens('HENRRIQUE GRECCO'));
    expect(nameTokens('Jonatha')).toEqual(nameTokens('JHONATHA'));
    expect(tokenMatch(nameTokens('Oliveira')[0], nameTokens('OLIVERIA')[0])).toBe(true);
  });
  it('vincula automaticamente com nome completo ou com palavras a mais', () => {
    expect(find('Henrique Grecco').auto?.id).toBe(1);
    expect(find('Alex Oliveira').auto?.id).toBe(2);
    expect(find('José Ferreira da Silva').auto?.id).toBe(9);
    expect(find('Francisco de Assis').auto?.id).toBe(7);
    expect(find('Andraide da Conceicao').auto?.id).toBe(8);
  });
  it('nome ambíguo devolve opções para escolher', () => {
    const r = find('Paulo Henrique Oliveira');
    expect(r.auto).toBeNull();
    expect(r.options.map((p) => p.id).sort()).toEqual([4, 6]);
  });
  it('não expõe nomes com busca de uma palavra só e não vincula desconhecidos', () => {
    expect(find('Paulo').options).toEqual([]);
    expect(find('Maria Souza')).toEqual({ auto: null, options: [] });
  });
  it('telefone sem código do país assume Brasil', () => {
    expect(normalizeBrPhone('(61) 99999-0000')).toBe('5561999990000');
    expect(normalizeBrPhone('+55 61 99999-0000')).toBe('5561999990000');
  });
});
