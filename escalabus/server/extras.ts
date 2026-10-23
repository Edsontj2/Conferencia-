import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { Database, Mode, Q } from './db.js';
import { nowIso } from './db.js';
import { HttpError } from './schedules.js';
import * as repo from './repo.js';
import { matchPerson, myRole, type ExtraFileMeta, type ExtraRow, type ExtraSchedule } from '../shared/extras.js';
import { aiEnabled, aiReadable, readScheduleFile } from './ai-reader.js';
import { shiftWindow } from './seed.js';
import { findNameMatches, nameTokens } from '../shared/names.js';
import { parseHM, isValidHM, serviceMinutes } from '../shared/time.js';
import type { Person, Role } from '../shared/types.js';

/** Tamanho máximo de cada arquivo (o limite do corpo da requisição na Vercel é 4,5 MB). */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

type R = Record<string, unknown>;
const fileMeta = (f: R): ExtraFileMeta => ({ id: Number(f.id), name: String(f.name), mime: String(f.mime), size: Number(f.size), createdAt: String(f.created_at) });
const rowOf = (r: R): ExtraRow => ({
  seq: String(r.seq), bus: String(r.bus), start: String(r.start_time), line: String(r.line), end: String(r.end_time),
  driverName: String(r.driver_name), driverId: r.driver_id == null ? null : Number(r.driver_id),
  conductorName: String(r.conductor_name), conductorId: r.conductor_id == null ? null : Number(r.conductor_id),
});

export async function loadExtra(q: Q, id: number): Promise<ExtraSchedule | null> {
  const [s] = await q<R>('SELECT * FROM extra_schedules WHERE id = ?', [id]);
  if (!s) return null;
  const rows = await q<R>('SELECT * FROM extra_rows WHERE schedule_id = ? ORDER BY position', [id]);
  const files = await q<R>('SELECT id, name, mime, size, created_at FROM extra_files WHERE schedule_id = ? ORDER BY id', [id]);
  return {
    id: Number(s.id), title: String(s.title), date: String(s.date), status: s.status as ExtraSchedule['status'], notes: (s.notes as string) ?? null,
    createdAt: String(s.created_at), updatedAt: String(s.updated_at), publishedAt: (s.published_at as string) ?? null,
    rows: rows.map(rowOf), files: files.map(fileMeta),
  };
}

const sendFile = async (res: Response, q: Q, fid: number, where: string, params: unknown[]) => {
  const [f] = await q<R>(`SELECT f.name, f.mime, f.data FROM extra_files f JOIN extra_schedules s ON s.id = f.schedule_id WHERE f.id = ? ${where}`, [fid, ...params]);
  if (!f) throw new HttpError(404, 'Arquivo não encontrado.');
  res.setHeader('Content-Type', String(f.mime));
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(String(f.name))}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(String(f.data), 'base64'));
};

const rowIn = z.object({
  seq: z.string().max(20), bus: z.string().max(30), start: z.string().max(10), line: z.string().max(30), end: z.string().max(10),
  driverName: z.string().max(120), driverId: z.number().int().nullable(),
  conductorName: z.string().max(120), conductorId: z.number().int().nullable(),
});
const headIn = z.object({
  title: z.string().trim().min(1, 'Informe o título da escala.').max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data da escala.'),
  notes: z.string().max(1000).nullable().optional(),
});

/** Rotas do painel (chamar após a autenticação do painel). Usa o banco do modo da sessão (real/demonstração). */
export function registerExtraAdminRoutes(app: Express, db: Database, modeOf: (req: Request) => Mode, isAdmin: (req: Request) => boolean,
  parse: <T>(s: z.ZodType<T>, d: unknown) => T) {
  const data = <T>(req: Request, fn: (q: Q) => Promise<T>) => db.tx(modeOf(req), fn);
  const must = async (q: Q, id: number) => { const s = await loadExtra(q, id); if (!s) throw new HttpError(404, 'Escala importada não encontrada.'); return s; };

  app.get('/api/extras', async (req, res) => {
    const rows = await data(req, (q) => q<R>(`SELECT s.id, s.title, s.date, s.status, s.updated_at,
      (SELECT COUNT(*) FROM extra_rows r WHERE r.schedule_id = s.id) AS n_rows,
      (SELECT COUNT(*) FROM extra_files f WHERE f.schedule_id = s.id) AS n_files
      FROM extra_schedules s ORDER BY s.date DESC, s.id DESC`));
    res.json({ aiEnabled: aiEnabled(), items: rows.map((r) => ({ id: Number(r.id), title: r.title, date: r.date, status: r.status, updatedAt: r.updated_at, rows: Number(r.n_rows), files: Number(r.n_files) })) });
  });

  app.post('/api/extras', async (req, res) => {
    const b = parse(headIn, req.body);
    const out = await data(req, async (q) => {
      const [{ id }] = await q<{ id: number }>('INSERT INTO extra_schedules (title, date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
        [b.title, b.date, b.notes ?? null, nowIso(), nowIso()]);
      return loadExtra(q, Number(id));
    });
    res.status(201).json(out);
  });

  app.get('/api/extras/:id', async (req, res) => {
    res.json(await data(req, (q) => must(q, Number(req.params.id))));
  });

  /** Salva cabeçalho e linhas. Nomes sem vínculo (id nulo) são procurados no cadastro de pessoas. */
  app.put('/api/extras/:id', async (req, res) => {
    const id = Number(req.params.id);
    const b = parse(headIn.extend({ rows: z.array(rowIn).max(600), createMissing: z.boolean().optional() }), req.body);
    const created: { id: number; name: string; role: Role; shiftName: string }[] = [];
    const out = await data(req, async (q) => {
      await must(q, id);
      const people = await repo.listPeople(q);
      const known = new Set(people.map((p) => p.id));
      /** Liga ao cadastro; se não existir e createMissing, cadastra a pessoa (função da coluna, turno pelo horário). */
      const resolve = async (name: string, given: number | null, role: Role, start: string): Promise<number | null> => {
        const n = name.trim().replace(/\s+/g, ' ').toUpperCase();
        if (!n) return null;
        if (given != null && known.has(given)) return given;
        const hit = matchPerson(n, people, role);
        if (hit != null) return hit;
        // só cadastra nome com 2+ palavras e sem nenhum parecido no cadastro (parecido = o admin decide)
        if (!b.createMissing || nameTokens(n).length < 2 || findNameMatches(n, people, (x) => x.name).length) return null;
        const shiftName = isValidHM(start) && parseHM(start) >= 10 * 60 ? 'Tarde' : 'Manhã';
        const w = shiftWindow(new Set([shiftName]));
        const now = nowIso();
        const [{ id: pid }] = await q<{ id: number }>(`INSERT INTO people (name, role, shift_name, avail_start, avail_end, whatsapp, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?) RETURNING id`, [n, role, shiftName, w.start, w.end, now, now]);
        const p: Person = { id: Number(pid), name: n, role, shiftName, availStart: w.start, availEnd: w.end, whatsapp: null, active: true };
        people.push(p); known.add(p.id);
        created.push({ id: p.id, name: n, role, shiftName });
        return p.id;
      };
      await q('UPDATE extra_schedules SET title = ?, date = ?, notes = ?, updated_at = ? WHERE id = ?', [b.title, b.date, b.notes ?? null, nowIso(), id]);
      await q('DELETE FROM extra_rows WHERE schedule_id = ?', [id]);
      let pos = 0;
      for (const r of b.rows) {
        if (!r.driverName.trim() && !r.conductorName.trim() && !r.bus.trim() && !r.start.trim()) continue;
        const driverId = await resolve(r.driverName, r.driverId, 'motorista', r.start.trim());
        const conductorId = await resolve(r.conductorName, r.conductorId, 'cobrador', r.start.trim());
        await q(`INSERT INTO extra_rows (schedule_id, position, seq, bus, start_time, line, end_time, driver_name, driver_id, conductor_name, conductor_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, pos++, r.seq.trim(), r.bus.trim(), r.start.trim(), r.line.trim(), r.end.trim(), r.driverName.trim(), driverId, r.conductorName.trim(), conductorId]);
      }
      return loadExtra(q, id);
    });
    res.json({ ...out, created });
  });

  app.post('/api/extras/:id/status', async (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ status: z.enum(['rascunho', 'publicada']) }), req.body);
    const out = await data(req, async (q) => {
      const s = await must(q, id);
      if (b.status === 'publicada' && !s.rows.length && !s.files.length) throw new HttpError(400, 'Adicione as linhas da escala ou um arquivo antes de publicar.');
      await q('UPDATE extra_schedules SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
        [b.status, b.status === 'publicada' ? nowIso() : null, nowIso(), id]);
      return loadExtra(q, id);
    });
    res.json(out);
  });

  app.delete('/api/extras/:id', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Somente administradores podem excluir escalas.');
    await data(req, async (q) => { await must(q, Number(req.params.id)); await q('DELETE FROM extra_schedules WHERE id = ?', [Number(req.params.id)]); });
    res.json({ ok: true });
  });

  /* ---------- arquivos ---------- */
  app.post('/api/extras/:id/files', async (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ name: z.string().trim().min(1).max(200), mime: z.string(), data: z.string().min(1) }), req.body);
    if (!MIMES.includes(b.mime)) throw new HttpError(400, 'Tipo de arquivo não aceito. Envie foto (JPG/PNG), PDF ou planilha (CSV/XLSX).');
    const size = Buffer.byteLength(b.data, 'base64');
    if (size > MAX_FILE_BYTES) throw new HttpError(413, 'Arquivo muito grande (máximo 3 MB).');
    const out = await data(req, async (q) => {
      await must(q, id);
      await q('INSERT INTO extra_files (schedule_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, b.name, b.mime, size, b.data, nowIso()]);
      await q('UPDATE extra_schedules SET updated_at = ? WHERE id = ?', [nowIso(), id]);
      return loadExtra(q, id);
    });
    res.status(201).json(out);
  });

  app.get('/api/extras/files/:fid', async (req, res) => {
    await data(req, (q) => sendFile(res, q, Number(req.params.fid), '', []));
  });

  app.delete('/api/extras/files/:fid', async (req, res) => {
    await data(req, (q) => q('DELETE FROM extra_files WHERE id = ?', [Number(req.params.fid)]));
    res.json({ ok: true });
  });

  /** Leitura automática (IA) de um arquivo já enviado. Não grava: devolve as linhas para revisão na tela. */
  app.post('/api/extras/files/:fid/read', async (req, res) => {
    const [f] = await data(req, (q) => q<R>('SELECT mime, data FROM extra_files WHERE id = ?', [Number(req.params.fid)]));
    if (!f) throw new HttpError(404, 'Arquivo não encontrado.');
    if (!aiReadable(String(f.mime))) throw new HttpError(400, 'A leitura automática aceita fotos e PDF. Para planilhas, use "Colar do Excel".');
    res.json(await readScheduleFile(String(f.mime), String(f.data)));
  });
}

/** Itens publicados para o app dos funcionários (dados reais). */
export async function publishedExtras(q: Q, personId: number | null) {
  // escalas publicadas sem linhas e sem arquivo não aparecem para a equipe
  const rows = await q<R>(`SELECT s.id, s.title, s.date FROM extra_schedules s WHERE s.status = 'publicada'
    AND (EXISTS (SELECT 1 FROM extra_rows r WHERE r.schedule_id = s.id) OR EXISTS (SELECT 1 FROM extra_files f WHERE f.schedule_id = s.id))
    ORDER BY s.date DESC LIMIT 60`);
  const mine = new Map<number, { n: number; min: number }>();
  if (personId != null && rows.length) {
    const [p] = await q<{ name: string }>('SELECT name FROM people WHERE id = ?', [personId]);
    const rs = await q<R>(`SELECT r.* FROM extra_rows r JOIN extra_schedules s ON s.id = r.schedule_id WHERE s.status = 'publicada'`);
    for (const raw of rs) {
      const r = rowOf(raw);
      if (!myRole(r, personId, p?.name ?? null)) continue;
      const k = Number(raw.schedule_id);
      const cur = mine.get(k) ?? { n: 0, min: 0 };
      cur.n++; cur.min += serviceMinutes(r.start, r.end); mine.set(k, cur);
    }
  }
  return rows.map((r) => ({ id: Number(r.id), title: String(r.title), date: String(r.date), mine: mine.get(Number(r.id))?.n ?? 0, minutes: mine.get(Number(r.id))?.min ?? 0 }));
}

export async function publishedExtra(q: Q, id: number) {
  const s = await loadExtra(q, id);
  if (!s || s.status !== 'publicada') throw new HttpError(404, 'Escala não encontrada.');
  return s;
}

export const sendPublishedFile = (res: Response, q: Q, fid: number) => sendFile(res, q, fid, "AND s.status = 'publicada'", []);
