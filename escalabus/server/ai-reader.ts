import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { emptyRow, normTime, type ExtraRow } from '../shared/extras.js';
import { HttpError } from './schedules.js';

/**
 * Leitura automática de uma escala em foto ou PDF (Claude, visão).
 * Só funciona com a variável de ambiente ANTHROPIC_API_KEY configurada no servidor.
 */
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const aiReadable = (mime: string) => mime === 'application/pdf' || (IMAGE_TYPES as readonly string[]).includes(mime);

const Result = z.object({
  title: z.string().describe('Título escrito no topo da escala, sem a data. Ex.: "ESCALA DE ELEIÇÃO". Vazio se não houver.'),
  date: z.string().describe('Data da escala no formato AAAA-MM-DD, ou vazio se não estiver escrita.'),
  rows: z.array(z.object({
    seq: z.string().describe('Número da coluna SEQ'),
    bus: z.string().describe('Número do carro/ônibus'),
    start: z.string().describe('HORA de início, HH:MM'),
    line: z.string().describe('LINHA exatamente como escrita, ex.: 0.783 ou 141.6'),
    end: z.string().describe('REND. (rendição), HH:MM'),
    driver: z.string().describe('Nome na coluna MOTORISTA'),
    conductor: z.string().describe('Nome na coluna COBRADOR'),
  })),
});

const PROMPT = `Esta é a foto (ou PDF) de uma escala de motoristas e cobradores de ônibus.
Transcreva TODAS as linhas da tabela, de cima para baixo, na ordem em que aparecem (não reordene).
Colunas usuais: SEQ, CARRO, HORA, LINHA, REND., JORNADA (ignore), MOTORISTA, COBRADOR.
Copie números e nomes exatamente como escritos, em maiúsculas. Não invente: se uma célula estiver vazia ou ilegível, deixe vazia.
Horários no formato HH:MM.`;

export async function readScheduleFile(mime: string, base64: string): Promise<{ title: string; date: string; rows: ExtraRow[] }> {
  if (!aiEnabled()) throw new HttpError(400, 'Leitura automática não configurada (falta a chave ANTHROPIC_API_KEY no servidor). Digite ou cole a tabela.');
  if (!aiReadable(mime)) throw new HttpError(400, 'A leitura automática aceita fotos (JPG, PNG, WEBP) e PDF.');
  const client = new Anthropic({ timeout: 240_000, maxRetries: 1 });
  const file: Anthropic.Beta.BetaContentBlockParam = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime as (typeof IMAGE_TYPES)[number], data: base64 } };
  let msg;
  try {
    msg = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Result) },
      messages: [{ role: 'user', content: [file, { type: 'text', text: PROMPT }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'Chave ANTHROPIC_API_KEY inválida.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'Leitura automática ocupada. Tente de novo em alguns minutos.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Falha na leitura automática (${e.status ?? 'rede'}).`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Não foi possível ler este arquivo automaticamente. Digite ou cole a tabela.');
  if (msg.stop_reason === 'max_tokens' || !msg.parsed_output) throw new HttpError(422, 'A leitura ficou incompleta. Tente uma foto mais nítida ou divida a tabela.');
  const out = msg.parsed_output;
  return {
    title: out.title.trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(out.date.trim()) ? out.date.trim() : '',
    rows: out.rows.map((r) => ({
      ...emptyRow(), seq: r.seq.trim(), bus: r.bus.trim(), start: normTime(r.start), line: r.line.trim(), end: normTime(r.end),
      driverName: r.driver.trim().toUpperCase(), conductorName: r.conductor.trim().toUpperCase(),
    })).filter((r) => r.driverName || r.conductorName || r.bus),
  };
}
