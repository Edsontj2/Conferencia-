/**
 * Comparação de nomes de pessoas tolerante a acentos, maiúsculas, partes do nome e pequenas
 * diferenças de grafia (ex.: HENRRIQUE × Henrique, OLIVERIA × Oliveira, Jhonatha × Jonatha).
 */
const STOP = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D']);

/** Forma "fonética" simples de uma palavra. */
function soundOf(t: string): string {
  return t
    .replace(/PH/g, 'F').replace(/Y/g, 'I').replace(/W/g, 'V').replace(/K/g, 'C')
    .replace(/(?!^)H/g, '')      // H mudo no meio/fim (JHONATHA → JONATA)
    .replace(/(.)\1+/g, '$1');    // letras dobradas (HENRRIQUE → HENRIQUE)
}

export function nameTokens(name: string): string[] {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).map(soundOf);
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Duas palavras "iguais": mesma forma, ou 1 diferença (troca/erro) em palavras de 6+ letras (evita PAULO × PABLO). */
export function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 6 && lev(a, b) <= 1;
}

export interface NameMatch<T> { item: T; matched: number; total: number; score: number }

/**
 * Procura pessoas cujo nome combina com o nome digitado.
 * Retorna somente candidatos com pelo menos 2 palavras em comum (evita expor nomes com buscas genéricas),
 * ordenados do mais parecido para o menos parecido.
 */
export function findNameMatches<T>(typed: string, items: T[], getName: (t: T) => string): NameMatch<T>[] {
  const tt = nameTokens(typed);
  if (tt.length < 2) return [];
  const out: NameMatch<T>[] = [];
  for (const item of items) {
    const pt = nameTokens(getName(item));
    if (!pt.length) continue;
    const used = new Set<number>();
    let matched = 0;
    for (const p of pt) {
      const i = tt.findIndex((t, k) => !used.has(k) && tokenMatch(t, p));
      if (i >= 0) { used.add(i); matched++; }
    }
    if (matched < 2 && !(matched === pt.length && matched >= 1 && pt.length === 1)) continue;
    // cobre todas as palavras do cadastro = melhor; palavras a mais digitadas pesam pouco
    const score = matched * 10 - (pt.length - matched) * 6 - (tt.length - matched) * 1;
    out.push({ item, matched, total: pt.length, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Decide o vínculo automático: só quando o melhor candidato cobre TODAS as palavras do nome
 * cadastrado e é o único com essa pontuação. Caso contrário, devolve as opções para o funcionário escolher.
 */
export function pickPerson<T>(matches: NameMatch<T>[]): { auto: T | null; options: T[] } {
  if (!matches.length) return { auto: null, options: [] };
  const top = matches[0];
  const tie = matches.filter((m) => m.score === top.score).length > 1;
  if (top.matched === top.total && !tie) return { auto: top.item, options: [] };
  return { auto: null, options: matches.slice(0, 6).map((m) => m.item) };
}

/** Telefone do funcionário: só dígitos; sem código do país (10–11 dígitos) assume Brasil (55). */
export function normalizeBrPhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D+/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}
