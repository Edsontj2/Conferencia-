import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { DB } from './db';
import { nowIso } from './db';
import * as repo from './repo';
import * as sch from './schedules';
import { HttpError } from './schedules';
import {
  COOKIE, createSession, loginLimiter, passwordProblem, requireAuth, sessionFrom, setSessionCookie,
  verifyPassword, hashPassword, type AuthedRequest,
} from './auth';
import { exportBackup, importBackup, validateBackup } from './backup';
import { ensureDemoSeeded, seedDemo } from './demo';
import { isSaturday, isValidDate, isValidHM } from '../shared/time';
import { serviceBusConflicts } from '../shared/rules';
import { phoneProblem, normalizePhone } from '../shared/whatsapp';
import type { Entry } from '../shared/types';
import crypto from 'node:crypto';

export interface AppOptions {
  mainDb: DB;
  demoDb: DB;
  secureCookies?: boolean;
  staticDir?: string | null;
  backupDir?: string | null;
}

/* ---------- validação de entrada ---------- */
const hm = z.string().refine(isValidHM, 'Horário inválido (use HH:MM).');
const sat = z.string().refine(isSaturday, 'A data precisa ser um sábado.');
const bool = z.boolean();
const personIn = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo.').max(120),
  role: z.enum(['motorista', 'cobrador']),
  shiftName: z.string().trim().min(1, 'Informe o nome do turno.').max(60),
  availStart: hm, availEnd: hm,
  whatsapp: z.string().trim().max(30).nullable().optional()
    .refine((v) => !v || !phoneProblem(v), { message: 'WhatsApp inválido: inclua código do país e DDD (ex.: 55 11 98765-4321).' }),
  active: bool,
});
const lineIn = z.object({ code: z.string().trim().min(1, 'Informe o código da linha.').max(30), description: z.string().trim().max(200).nullable().optional(), active: bool });
const busIn = z.object({
  fleetNumber: z.string().trim().min(1, 'Informe o número do carro.').max(20),
  plate: z.string().trim().toUpperCase().regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, 'Placa inválida (ex.: ABC1D23 ou ABC-1234).'),
  active: bool,
});
const serviceIn = z.object({
  weekday: z.union([z.literal(0), z.literal(6)]), lineId: z.number().int(), busId: z.number().int(),
  startTime: hm, endTime: hm, shiftName: z.string().trim().min(1, 'Informe o turno.').max(60), active: bool,
}).refine((s) => s.startTime !== s.endTime, 'Início e término não podem ser iguais.');
const recipientIn = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  phone: z.string().trim().refine((v) => !phoneProblem(v), { message: 'Número inválido: inclua código do país e DDD.' }),
});
const settingsIn = z.object({ companyName: z.string().trim().min(1).max(120), maxServicesPerDay: z.number().int().min(1).max(5) });
const entryIn = z.object({
  id: z.string().min(1).max(64),
  date: z.string().refine(isValidDate, 'Data inválida.'),
  serviceId: z.number().int().nullable(),
  lineId: z.number().int().nullable(), lineCode: z.string().default(''), lineDescription: z.string().nullable().default(null),
  busId: z.number().int().nullable(), busFleet: z.string().default(''), busPlate: z.string().default(''),
  startTime: hm, endTime: hm, shiftName: z.string().max(60).default(''),
  driverId: z.number().int().nullable(), driverName: z.string().default(''),
  conductorId: z.number().int().nullable(), conductorName: z.string().default(''),
});
const entriesIn = z.array(entryIn).max(500);

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, r.error.issues.map((i) => i.message).join(' '), { fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  return r.data;
}
const idParam = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador inválido.');
  return n;
};
const A = (req: Request) => req as AuthedRequest;

export function createApp(opts: AppOptions) {
  const { mainDb, demoDb } = opts;
  ensureDemoSeeded(demoDb);
  const dbFor = (m: 'real' | 'demo') => (m === 'demo' ? demoDb : mainDb);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Proteção CSRF simples: requisições que alteram dados precisam vir do próprio site (cabeçalho customizado).
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.get('X-Requested-With') !== 'EscalaBus') {
      res.status(403).json({ error: 'Requisição recusada.' });
      return;
    }
    next();
  });

  const limiter = loginLimiter();
  const secure = (req: Request) => opts.secureCookies ?? req.secure;

  app.get('/api/health', (_req, res) => { res.json({ ok: true, time: nowIso() }); });

  /* ---------- autenticação ---------- */
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = parse(z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    const ip = req.ip ?? 'x';
    if (!limiter.check(ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
    const u = mainDb.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as { id: number; username: string; password_hash: string } | undefined;
    if (!u || !verifyPassword(password, u.password_hash)) {
      limiter.fail(ip);
      throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    limiter.ok(ip);
    setSessionCookie(res, createSession(mainDb, u.id), secure(req));
    res.json({ username: u.username, mode: 'real' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const a = sessionFrom(mainDb, req);
    if (a) mainDb.prepare('DELETE FROM sessions WHERE token_hash = ?').run(a.tokenHash);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const a = sessionFrom(mainDb, req);
    if (!a) { res.status(401).json({ error: 'Não autenticado.' }); return; }
    res.json({ username: a.username, mode: a.mode });
  });

  app.use('/api', requireAuth(mainDb, dbFor));

  app.post('/api/auth/mode', (req, res) => {
    const { mode } = parse(z.object({ mode: z.enum(['real', 'demo']) }), req.body);
    mainDb.prepare('UPDATE sessions SET mode = ? WHERE token_hash = ?').run(mode, A(req).auth.tokenHash);
    res.json({ username: A(req).auth.username, mode });
  });

  app.post('/api/auth/password', (req, res) => {
    const { current, next } = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const u = mainDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(A(req).auth.userId) as { password_hash: string };
    if (!verifyPassword(current, u.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
    const p = passwordProblem(next);
    if (p) throw new HttpError(400, p);
    mainDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), A(req).auth.userId);
    mainDb.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(A(req).auth.userId, A(req).auth.tokenHash);
    res.json({ ok: true });
  });

  /* ---------- cadastros ---------- */
  app.get('/api/catalog', (req, res) => {
    const db = A(req).db;
    res.json({
      people: repo.listPeople(db), lines: repo.listLines(db), buses: repo.listBuses(db), services: repo.listServices(db),
      recipients: repo.listRecipients(db), settings: repo.getSettings(db),
      usage: {
        people: Object.fromEntries(repo.usageCount(db, 'person')),
        lines: Object.fromEntries(repo.usageCount(db, 'line')),
        buses: Object.fromEntries(repo.usageCount(db, 'bus')),
      },
    });
  });

  const uniqueGuard = (fn: () => void, msg: string) => {
    try { fn(); } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, msg);
      throw e;
    }
  };

  app.post('/api/people', (req, res) => {
    const p = parse(personIn, req.body);
    const now = nowIso();
    const r = A(req).db.prepare(`INSERT INTO people (name, role, shift_name, avail_start, avail_end, whatsapp, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.name, p.role, p.shiftName, p.availStart, p.availEnd, p.whatsapp ? normalizePhone(p.whatsapp) : null, p.active ? 1 : 0, now, now);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/people/:id', (req, res) => {
    const id = idParam(req);
    const p = parse(personIn, req.body);
    const db = A(req).db;
    const cur = db.prepare('SELECT role FROM people WHERE id = ?').get(id) as { role: string } | undefined;
    if (!cur) throw new HttpError(404, 'Pessoa não encontrada.');
    if (cur.role !== p.role && repo.usageCount(db, 'person').get(id)) {
      throw new HttpError(409, 'Esta pessoa já aparece em escalas; a função não pode ser alterada. Cadastre uma nova pessoa e inative esta.');
    }
    db.prepare(`UPDATE people SET name = ?, role = ?, shift_name = ?, avail_start = ?, avail_end = ?, whatsapp = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(p.name, p.role, p.shiftName, p.availStart, p.availEnd, p.whatsapp ? normalizePhone(p.whatsapp) : null, p.active ? 1 : 0, nowIso(), id);
    res.json({ ok: true });
  });

  /** Exclusão só é permitida quando o registro nunca foi usado em escalas; caso contrário, inative. */
  const guardedDelete = (table: string, kind: 'person' | 'line' | 'bus', label: string) => (req: Request, res: Response) => {
    const id = idParam(req);
    const db = A(req).db;
    if (repo.usageCount(db, kind).get(id)) {
      throw new HttpError(409, `${label} já aparece em escalas e não pode ser excluído(a) para não prejudicar o histórico. Use "Inativar".`);
    }
    if (kind !== 'person' && db.prepare(`SELECT 1 FROM services WHERE ${kind}_id = ?`).get(id)) {
      throw new HttpError(409, `${label} é usado(a) em serviços cadastrados. Remova ou altere esses serviços antes, ou inative.`);
    }
    const r = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (!r.changes) throw new HttpError(404, 'Registro não encontrado.');
    res.json({ ok: true });
  };
  app.delete('/api/people/:id', guardedDelete('people', 'person', 'A pessoa'));

  app.post('/api/lines', (req, res) => {
    const l = parse(lineIn, req.body);
    const now = nowIso();
    let id = 0;
    uniqueGuard(() => { id = Number(A(req).db.prepare('INSERT INTO lines (code, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(l.code, l.description || null, l.active ? 1 : 0, now, now).lastInsertRowid); }, 'Já existe uma linha com esse código.');
    res.status(201).json({ id });
  });
  app.put('/api/lines/:id', (req, res) => {
    const id = idParam(req);
    const l = parse(lineIn, req.body);
    uniqueGuard(() => {
      const r = A(req).db.prepare('UPDATE lines SET code = ?, description = ?, active = ?, updated_at = ? WHERE id = ?').run(l.code, l.description || null, l.active ? 1 : 0, nowIso(), id);
      if (!r.changes) throw new HttpError(404, 'Linha não encontrada.');
    }, 'Já existe uma linha com esse código.');
    res.json({ ok: true });
  });
  app.delete('/api/lines/:id', guardedDelete('lines', 'line', 'A linha'));

  app.post('/api/buses', (req, res) => {
    const b = parse(busIn, req.body);
    const now = nowIso();
    let id = 0;
    uniqueGuard(() => { id = Number(A(req).db.prepare('INSERT INTO buses (fleet_number, plate, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(b.fleetNumber, b.plate, b.active ? 1 : 0, now, now).lastInsertRowid); }, 'Já existe um ônibus com esse número de frota.');
    res.status(201).json({ id });
  });
  app.put('/api/buses/:id', (req, res) => {
    const id = idParam(req);
    const b = parse(busIn, req.body);
    uniqueGuard(() => {
      const r = A(req).db.prepare('UPDATE buses SET fleet_number = ?, plate = ?, active = ?, updated_at = ? WHERE id = ?').run(b.fleetNumber, b.plate, b.active ? 1 : 0, nowIso(), id);
      if (!r.changes) throw new HttpError(404, 'Ônibus não encontrado.');
    }, 'Já existe um ônibus com esse número de frota.');
    res.json({ ok: true });
  });
  app.delete('/api/buses/:id', guardedDelete('buses', 'bus', 'O ônibus'));

  const saveService = (db: DB, id: number | null, s: z.infer<typeof serviceIn>) => db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM lines WHERE id = ?').get(s.lineId)) throw new HttpError(400, 'Linha inexistente.');
    if (!db.prepare('SELECT 1 FROM buses WHERE id = ?').get(s.busId)) throw new HttpError(400, 'Ônibus inexistente.');
    const now = nowIso();
    let sid = id;
    if (id == null) {
      sid = Number(db.prepare(`INSERT INTO services (weekday, line_id, bus_id, start_time, end_time, shift_name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(s.weekday, s.lineId, s.busId, s.startTime, s.endTime, s.shiftName, s.active ? 1 : 0, now, now).lastInsertRowid);
    } else {
      const r = db.prepare(`UPDATE services SET weekday = ?, line_id = ?, bus_id = ?, start_time = ?, end_time = ?, shift_name = ?, active = ?, updated_at = ? WHERE id = ?`)
        .run(s.weekday, s.lineId, s.busId, s.startTime, s.endTime, s.shiftName, s.active ? 1 : 0, now, id);
      if (!r.changes) throw new HttpError(404, 'Serviço não encontrado.');
    }
    const conflicts = serviceBusConflicts(repo.listServices(db)).filter(([a, b]) => a.id === sid || b.id === sid);
    if (conflicts.length) {
      const o = conflicts[0][0].id === sid ? conflicts[0][1] : conflicts[0][0];
      throw new HttpError(409, `O ônibus já está em outro serviço ativo com horário sobreposto (${o.weekday === 6 ? 'sábado' : 'domingo'} ${o.startTime}–${o.endTime}).`);
    }
    return sid!;
  })();
  app.post('/api/services', (req, res) => { res.status(201).json({ id: saveService(A(req).db, null, parse(serviceIn, req.body)) }); });
  app.put('/api/services/:id', (req, res) => { saveService(A(req).db, idParam(req), parse(serviceIn, req.body)); res.json({ ok: true }); });
  app.delete('/api/services/:id', (req, res) => {
    const r = A(req).db.prepare('DELETE FROM services WHERE id = ?').run(idParam(req));
    if (!r.changes) throw new HttpError(404, 'Serviço não encontrado.');
    res.json({ ok: true });
  });

  app.post('/api/recipients', (req, res) => {
    const r = parse(recipientIn, req.body);
    const id = A(req).db.prepare('INSERT INTO recipients (name, phone, created_at) VALUES (?, ?, ?)').run(r.name, normalizePhone(r.phone), nowIso()).lastInsertRowid;
    res.status(201).json({ id: Number(id) });
  });
  app.put('/api/recipients/:id', (req, res) => {
    const r = parse(recipientIn, req.body);
    const x = A(req).db.prepare('UPDATE recipients SET name = ?, phone = ? WHERE id = ?').run(r.name, normalizePhone(r.phone), idParam(req));
    if (!x.changes) throw new HttpError(404, 'Destinatário não encontrado.');
    res.json({ ok: true });
  });
  app.delete('/api/recipients/:id', (req, res) => {
    A(req).db.prepare('DELETE FROM recipients WHERE id = ?').run(idParam(req));
    res.json({ ok: true });
  });

  app.put('/api/settings', (req, res) => {
    repo.saveSettings(A(req).db, parse(settingsIn, req.body));
    res.json({ ok: true });
  });

  /* ---------- escalas ---------- */
  app.get('/api/weekend/:saturday', (req, res) => {
    const s = parse(sat, req.params.saturday);
    res.json(sch.getWeekend(A(req).db, s));
  });

  app.post('/api/schedules/generate', (req, res) => {
    const { saturday, seed } = parse(z.object({ saturday: sat, seed: z.number().int().optional() }), req.body);
    res.json(sch.generate(A(req).db, saturday, seed));
  });

  app.post('/api/schedules/validate', (req, res) => {
    const b = parse(z.object({ saturday: sat, entries: entriesIn, scheduleId: z.number().int().nullable().optional() }), req.body);
    res.json(sch.validateDraft(A(req).db, b.saturday, b.entries as Entry[], b.scheduleId ?? null));
  });

  app.get('/api/schedules', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(repo.listSchedulesMeta(A(req).db, {
      from: q.from && isValidDate(q.from) ? q.from : undefined, to: q.to && isValidDate(q.to) ? q.to : undefined,
      status: q.status && ['rascunho', 'confirmada', 'cancelada'].includes(q.status) ? q.status : undefined,
    }));
  });

  app.post('/api/schedules', (req, res) => {
    const b = parse(z.object({ saturday: sat, entries: entriesIn, notes: z.string().max(1000).nullable().optional() }), req.body);
    res.status(201).json(sch.createSchedule(A(req).db, A(req).auth.username, { saturday: b.saturday, entries: b.entries as Entry[], notes: b.notes }));
  });

  app.get('/api/schedules/:id', (req, res) => {
    const s = repo.loadSchedule(A(req).db, idParam(req));
    if (!s) throw new HttpError(404, 'Escala não encontrada.');
    res.json(s);
  });

  app.put('/api/schedules/:id', (req, res) => {
    const b = parse(z.object({ entries: entriesIn, version: z.number().int(), reason: z.string().max(500).nullable().optional(), notes: z.string().max(1000).nullable().optional() }), req.body);
    res.json(sch.updateSchedule(A(req).db, A(req).auth.username, idParam(req), { ...b, entries: b.entries as Entry[] }));
  });

  app.post('/api/schedules/:id/confirm', (req, res) => {
    const b = parse(z.object({ version: z.number().int() }), req.body);
    res.json(sch.confirmSchedule(A(req).db, A(req).auth.username, idParam(req), b.version));
  });

  app.post('/api/schedules/:id/cancel', (req, res) => {
    const b = parse(z.object({ version: z.number().int(), reason: z.string().trim().min(1, 'Informe o motivo.').max(500) }), req.body);
    res.json(sch.cancelSchedule(A(req).db, A(req).auth.username, idParam(req), b.version, b.reason));
  });

  app.post('/api/schedules/:id/swap', (req, res) => {
    const b = parse(z.object({ a: z.string(), b: z.string(), field: z.enum(['driver', 'conductor', 'line', 'bus']), version: z.number().int(), reason: z.string().max(500).nullable().optional() }), req.body);
    res.json(sch.swapEntries(A(req).db, A(req).auth.username, idParam(req), b));
  });

  app.get('/api/schedules/:id/audit', (req, res) => { res.json(repo.listAudit(A(req).db, idParam(req))); });

  /** Histórico em formato de lista, com filtros por data, pessoa, função, linha e status. */
  app.get('/api/history', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const where = ['1 = 1'];
    const args: unknown[] = [];
    if (q.from && isValidDate(q.from)) { where.push('e.date >= ?'); args.push(q.from); }
    if (q.to && isValidDate(q.to)) { where.push('e.date <= ?'); args.push(q.to); }
    const status = q.status ?? 'confirmada';
    if (status !== 'todas') { where.push('s.status = ?'); args.push(status); }
    if (q.lineCode) { where.push('e.line_code = ?'); args.push(q.lineCode); }
    const pid = Number(q.personId);
    if (q.personId && Number.isInteger(pid)) {
      if (q.role === 'motorista') { where.push('e.driver_id = ?'); args.push(pid); }
      else if (q.role === 'cobrador') { where.push('e.conductor_id = ?'); args.push(pid); }
      else { where.push('(e.driver_id = ? OR e.conductor_id = ?)'); args.push(pid, pid); }
    } else if (q.role === 'motorista') where.push('e.driver_id IS NOT NULL');
    else if (q.role === 'cobrador') where.push('e.conductor_id IS NOT NULL');
    const rows = A(req).db.prepare(`SELECT e.*, s.status, s.saturday FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
      WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.start_time LIMIT 2000`).all(...args) as Record<string, unknown>[];
    res.json(rows.map((r) => ({ ...repo.mapEntry(r), scheduleId: r.schedule_id, status: r.status, saturday: r.saturday })));
  });

  /* ---------- backup ---------- */
  app.get('/api/backup/export', (req, res) => {
    const data = exportBackup(A(req).db, A(req).auth.mode);
    const name = `escalabus-${A(req).auth.mode === 'demo' ? 'DEMO-' : ''}backup-${nowIso().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.json(data);
  });
  app.post('/api/backup/validate', (req, res) => { res.json(validateBackup(req.body)); });
  app.post('/api/backup/import', (req, res) => {
    const b = parse(z.object({ confirm: z.literal('SUBSTITUIR', { message: 'Digite SUBSTITUIR para confirmar.' }), data: z.unknown() }), req.body);
    try {
      const r = importBackup(A(req).db, b.data, A(req).auth.mode, opts.backupDir ?? null);
      res.json({ ok: true, safetyCopy: r.safetyCopy ? path.basename(r.safetyCopy) : null });
    } catch (e) {
      throw new HttpError(400, (e as Error).message, (e as { details?: unknown }).details);
    }
  });

  app.post('/api/demo/reset', (req, res) => {
    if (A(req).auth.mode !== 'demo') throw new HttpError(400, 'Disponível somente no modo demonstração.');
    seedDemo(demoDb);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Rota não encontrada.' }); });

  /* ---------- frontend estático (produção) ---------- */
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        if (file.endsWith('sw.js') || file.endsWith('.webmanifest') || file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, details: err.details }); return; }
    if ((err as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: 'Arquivo grande demais.' }); return; }
    if ((err as { type?: string }).type === 'entity.parse.failed') { res.status(400).json({ error: 'JSON inválido.' }); return; }
    const ref = crypto.randomBytes(4).toString('hex');
    console.error(`[erro ${ref}]`, err);
    res.status(500).json({ error: `Erro interno (ref. ${ref}).` });
  });

  return app;
}
