import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database, Mode, Q } from './db.js';
import { nowIso, toInt } from './db.js';
import * as repo from './repo.js';
import * as sch from './schedules.js';
import { HttpError } from './schedules.js';
import {
  COOKIE, createSession, loginLimit, passwordProblem, sessionFrom, setSessionCookie,
  verifyPassword, hashPassword, upsertAdmin, DEFAULT_ADMIN, type AuthInfo,
} from './auth.js';
import { exportBackup, importBackup, validateBackup } from './backup.js';
import { ensureDemoSeeded, seedDemo } from './demo.js';
import { applySeeds } from './seed.js';
import { isSaturday, isValidDate, isValidHM } from '../shared/time.js';
import { serviceBusConflicts } from '../shared/rules.js';
import { phoneProblem, normalizePhone } from '../shared/whatsapp.js';
import type { Entry } from '../shared/types.js';
import crypto from 'node:crypto';

export interface AppOptions {
  db: Database;
  secureCookies?: boolean;
  staticDir?: string | null;
  /** Aplica os dados reais iniciais (escalas em papel). Desligado nos testes. */
  seedRealData?: boolean;
  /** Administrador criado se ainda não houver nenhum usuário (padrão: admin/admin, com aviso para trocar). */
  initialAdmin?: { username: string; password: string } | null;
}

/** Prepara o banco: administrador inicial, dados reais e demonstração. Idempotente. */
export async function prepareDatabase(opts: AppOptions) {
  await opts.db.tx('real', async (q) => {
    const [r] = await q('SELECT COUNT(*) AS n FROM users');
    if (toInt(r.n) === 0) {
      const custom = !!opts.initialAdmin?.password;
      await upsertAdmin(q, (custom && opts.initialAdmin!.username) || DEFAULT_ADMIN.username,
        custom ? opts.initialAdmin!.password : DEFAULT_ADMIN.password, { mustChange: !custom, skipCheck: true });
    }
    if (opts.seedRealData) await applySeeds(q);
  });
  await opts.db.tx('demo', ensureDemoSeeded);
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
  plate: z.string().trim().toUpperCase().refine((v) => v === '' || /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(v), 'Placa inválida (ex.: ABC1D23 ou ABC-1234).'),
  active: bool,
});
const serviceIn = z.object({
  weekday: z.union([z.literal(0), z.literal(6)]), lineId: z.number().int(), busId: z.number().int().nullable(),
  startTime: hm, endTime: hm, shiftName: z.string().trim().min(1, 'Informe o turno.').max(60), active: bool,
}).refine((s) => s.startTime !== s.endTime, 'Início e término não podem ser iguais.');
const recipientIn = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  phone: z.string().trim().refine((v) => !phoneProblem(v), { message: 'Número inválido: inclua código do país e DDD.' }),
});
const settingsIn = z.object({ companyName: z.string().trim().min(1).max(120), maxServicesPerDay: z.number().int().min(1).max(5), allowBothDays: z.boolean().default(false), allowOutsideShift: z.boolean().default(true) });
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
type Authed = Request & { auth: AuthInfo };
const meOf = (a: AuthInfo) => ({ username: a.username, mode: a.mode, isAdmin: a.isAdmin, mustChange: a.mustChange });
const A = (req: Request) => req as Authed;

export function createApp(opts: AppOptions) {
  const { db } = opts;
  /** Executa no banco do modo da sessão (real ou demonstração), numa transação. */
  const data = <T>(req: Request, fn: (q: Q) => Promise<T>) => db.tx(A(req).auth.mode as Mode, fn);
  const real = <T>(fn: (q: Q) => Promise<T>) => db.tx('real', fn);

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

  const secure = (req: Request) => opts.secureCookies ?? req.secure;

  app.get('/api/health', (_req, res) => { res.json({ ok: true, time: nowIso() }); });

  /* ---------- autenticação ---------- */
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = parse(z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    const ip = req.ip ?? 'x';
    const result = await real(async (q) => {
      if (await loginLimit.blocked(q, ip)) return { status: 'blocked' as const };
      const [u] = await q<{ id: number; username: string; password_hash: string; is_admin: number; must_change: number }>(
        'SELECT id, username, password_hash, is_admin, must_change FROM users WHERE lower(username) = lower(?)', [username]);
      if (!u || !verifyPassword(password, u.password_hash)) return { status: 'bad' as const };
      await loginLimit.ok(q, ip);
      return {
        status: 'ok' as const, username: u.username, isAdmin: Number(u.is_admin) === 1, mustChange: Number(u.must_change) === 1,
        token: await createSession(q, Number(u.id)),
      };
    });
    if (result.status === 'blocked') throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
    if (result.status === 'bad') {
      await real((q) => loginLimit.fail(q, ip)); // transação própria: a falha fica registrada
      throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    setSessionCookie(res, result.token, secure(req));
    res.json({ username: result.username, mode: 'real', isAdmin: result.isAdmin, mustChange: result.mustChange });
  });

  app.post('/api/auth/logout', async (req, res) => {
    await real(async (q) => {
      const a = await sessionFrom(q, req);
      if (a) await q('DELETE FROM sessions WHERE token_hash = ?', [a.tokenHash]);
    });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    const a = await real((q) => sessionFrom(q, req));
    if (!a) { res.status(401).json({ error: 'Não autenticado.' }); return; }
    res.json(meOf(a));
  });

  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const a = await real((q) => sessionFrom(q, req));
    if (!a) { res.status(401).json({ error: 'Sessão expirada ou inexistente. Entre novamente.' }); return; }
    (req as Authed).auth = a;
    next();
  });

  app.post('/api/auth/mode', async (req, res) => {
    const { mode } = parse(z.object({ mode: z.enum(['real', 'demo']) }), req.body);
    await real((q) => q('UPDATE sessions SET mode = ? WHERE token_hash = ?', [mode, A(req).auth.tokenHash]));
    res.json({ ...meOf(A(req).auth), mode });
  });

  app.post('/api/auth/password', async (req, res) => {
    const { current, next } = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const p = passwordProblem(next);
    if (p) throw new HttpError(400, p);
    await real(async (q) => {
      const [u] = await q<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [A(req).auth.userId]);
      if (!verifyPassword(current, u.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
      if (verifyPassword(next, u.password_hash)) throw new HttpError(400, 'A nova senha precisa ser diferente da atual.');
      await q('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', [hashPassword(next), A(req).auth.userId]);
      await q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [A(req).auth.userId, A(req).auth.tokenHash]);
    });
    res.json({ ok: true });
  });

  /* ---------- usuários e acessos (somente administradores) ---------- */
  const adminOnly = (req: Request) => { if (!A(req).auth.isAdmin) throw new HttpError(403, 'Somente administradores podem gerenciar usuários.'); };
  const usernameIn = z.string().trim().min(3, 'O login precisa ter pelo menos 3 caracteres.').max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use no login apenas letras, números, ponto, hífen ou sublinhado (sem espaços).');
  const countAdmins = async (q: Q) => toInt((await q('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'))[0].n);

  app.get('/api/users', async (req, res) => {
    adminOnly(req);
    const rows = await real((q) => q<{ id: number; username: string; is_admin: number; must_change: number; created_at: string }>(
      'SELECT id, username, is_admin, must_change, created_at FROM users ORDER BY lower(username)'));
    res.json(rows.map((r) => ({ id: Number(r.id), username: r.username, isAdmin: Number(r.is_admin) === 1, mustChange: Number(r.must_change) === 1, createdAt: r.created_at, self: Number(r.id) === A(req).auth.userId })));
  });

  app.post('/api/users', async (req, res) => {
    adminOnly(req);
    const b = parse(z.object({ username: usernameIn, password: z.string(), isAdmin: z.boolean() }), req.body);
    const p = passwordProblem(b.password);
    if (p) throw new HttpError(400, p);
    const id = await unique(real((q) => one(q('INSERT INTO users (username, password_hash, created_at, is_admin, must_change) VALUES (?, ?, ?, ?, 0) RETURNING id',
      [b.username, hashPassword(b.password), nowIso(), b.isAdmin ? 1 : 0]))), 'Já existe um usuário com esse login.');
    res.status(201).json({ id });
  });

  app.put('/api/users/:id', async (req, res) => {
    adminOnly(req);
    const id = idParam(req);
    const b = parse(z.object({ isAdmin: z.boolean() }), req.body);
    await real(async (q) => {
      if (!b.isAdmin && id === A(req).auth.userId) throw new HttpError(400, 'Você não pode remover o seu próprio acesso de administrador.');
      await changed(q('UPDATE users SET is_admin = ? WHERE id = ? RETURNING id', [b.isAdmin ? 1 : 0, id]), 'Usuário não encontrado.');
      if (await countAdmins(q) === 0) throw new HttpError(400, 'É preciso manter pelo menos um administrador.');
    });
    res.json({ ok: true });
  });

  app.post('/api/users/:id/password', async (req, res) => {
    adminOnly(req);
    const id = idParam(req);
    const b = parse(z.object({ password: z.string() }), req.body);
    const p = passwordProblem(b.password);
    if (p) throw new HttpError(400, p);
    await real(async (q) => {
      await changed(q('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ? RETURNING id', [hashPassword(b.password), id]), 'Usuário não encontrado.');
      // encerra as sessões do usuário (exceto a sessão atual, se for a própria conta)
      await q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [id, A(req).auth.tokenHash]);
    });
    res.json({ ok: true });
  });

  app.delete('/api/users/:id', async (req, res) => {
    adminOnly(req);
    const id = idParam(req);
    if (id === A(req).auth.userId) throw new HttpError(400, 'Você não pode excluir o seu próprio usuário.');
    await real(async (q) => {
      await changed(q('DELETE FROM users WHERE id = ? RETURNING id', [id]), 'Usuário não encontrado.');
      if (await countAdmins(q) === 0) throw new HttpError(400, 'É preciso manter pelo menos um administrador.');
    });
    res.json({ ok: true });
  });

  /* ---------- cadastros ---------- */
  app.get('/api/catalog', async (req, res) => {
    res.json(await data(req, async (q) => ({
      people: await repo.listPeople(q), lines: await repo.listLines(q), buses: await repo.listBuses(q), services: await repo.listServices(q),
      recipients: await repo.listRecipients(q), settings: await repo.getSettings(q),
      usage: {
        people: Object.fromEntries(await repo.usageCount(q, 'person')),
        lines: Object.fromEntries(await repo.usageCount(q, 'line')),
        buses: Object.fromEntries(await repo.usageCount(q, 'bus')),
      },
    })));
  });

  /** Converte violação de unicidade do Postgres (23505) em 409 com mensagem amigável. */
  const unique = async <T>(p: Promise<T>, msg: string): Promise<T> => {
    try { return await p; } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new HttpError(409, msg);
      throw e;
    }
  };
  const one = async (p: Promise<{ id: number }[]>) => Number((await p)[0].id);
  const changed = async (p: Promise<unknown[]>, msg: string) => { if ((await p).length === 0) throw new HttpError(404, msg); };

  app.post('/api/people', async (req, res) => {
    const p = parse(personIn, req.body);
    const now = nowIso();
    const id = await data(req, (q) => one(q(`INSERT INTO people (name, role, shift_name, avail_start, avail_end, whatsapp, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [p.name, p.role, p.shiftName, p.availStart, p.availEnd, p.whatsapp ? normalizePhone(p.whatsapp) : null, p.active ? 1 : 0, now, now])));
    res.status(201).json({ id });
  });
  app.put('/api/people/:id', async (req, res) => {
    const id = idParam(req);
    const p = parse(personIn, req.body);
    await data(req, async (q) => {
      const [cur] = await q<{ role: string }>('SELECT role FROM people WHERE id = ?', [id]);
      if (!cur) throw new HttpError(404, 'Pessoa não encontrada.');
      if (cur.role !== p.role && (await repo.usageCount(q, 'person')).get(id)) {
        throw new HttpError(409, 'Esta pessoa já aparece em escalas; a função não pode ser alterada. Cadastre uma nova pessoa e inative esta.');
      }
      await q(`UPDATE people SET name = ?, role = ?, shift_name = ?, avail_start = ?, avail_end = ?, whatsapp = ?, active = ?, updated_at = ? WHERE id = ?`,
        [p.name, p.role, p.shiftName, p.availStart, p.availEnd, p.whatsapp ? normalizePhone(p.whatsapp) : null, p.active ? 1 : 0, nowIso(), id]);
    });
    res.json({ ok: true });
  });

  /** Exclusão só é permitida quando o registro nunca foi usado em escalas; caso contrário, inative. */
  const guardedDelete = (table: string, kind: 'person' | 'line' | 'bus', label: string) => async (req: Request, res: Response) => {
    const id = idParam(req);
    await data(req, async (q) => {
      if ((await repo.usageCount(q, kind)).get(id)) {
        throw new HttpError(409, `${label} já aparece em escalas e não pode ser excluído(a) para não prejudicar o histórico. Use "Inativar".`);
      }
      if (kind !== 'person' && (await q(`SELECT 1 FROM services WHERE ${kind}_id = ?`, [id])).length) {
        throw new HttpError(409, `${label} é usado(a) em serviços cadastrados. Remova ou altere esses serviços antes, ou inative.`);
      }
      await changed(q(`DELETE FROM ${table} WHERE id = ? RETURNING id`, [id]), 'Registro não encontrado.');
    });
    res.json({ ok: true });
  };
  app.delete('/api/people/:id', guardedDelete('people', 'person', 'A pessoa'));

  const LINE_DUP = 'Já existe uma linha com esse código.';
  app.post('/api/lines', async (req, res) => {
    const l = parse(lineIn, req.body);
    const now = nowIso();
    const id = await unique(data(req, (q) => one(q('INSERT INTO lines (code, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [l.code, l.description || null, l.active ? 1 : 0, now, now]))), LINE_DUP);
    res.status(201).json({ id });
  });
  app.put('/api/lines/:id', async (req, res) => {
    const id = idParam(req);
    const l = parse(lineIn, req.body);
    await unique(data(req, (q) => changed(q('UPDATE lines SET code = ?, description = ?, active = ?, updated_at = ? WHERE id = ? RETURNING id',
      [l.code, l.description || null, l.active ? 1 : 0, nowIso(), id]), 'Linha não encontrada.')), LINE_DUP);
    res.json({ ok: true });
  });
  app.delete('/api/lines/:id', guardedDelete('lines', 'line', 'A linha'));

  const BUS_DUP = 'Já existe um ônibus com esse número de frota.';
  app.post('/api/buses', async (req, res) => {
    const b = parse(busIn, req.body);
    const now = nowIso();
    const id = await unique(data(req, (q) => one(q('INSERT INTO buses (fleet_number, plate, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [b.fleetNumber, b.plate, b.active ? 1 : 0, now, now]))), BUS_DUP);
    res.status(201).json({ id });
  });
  app.put('/api/buses/:id', async (req, res) => {
    const id = idParam(req);
    const b = parse(busIn, req.body);
    await unique(data(req, (q) => changed(q('UPDATE buses SET fleet_number = ?, plate = ?, active = ?, updated_at = ? WHERE id = ? RETURNING id',
      [b.fleetNumber, b.plate, b.active ? 1 : 0, nowIso(), id]), 'Ônibus não encontrado.')), BUS_DUP);
    res.json({ ok: true });
  });
  app.delete('/api/buses/:id', guardedDelete('buses', 'bus', 'O ônibus'));

  const saveService = async (q: Q, id: number | null, s: z.infer<typeof serviceIn>) => {
    if (!(await q('SELECT 1 FROM lines WHERE id = ?', [s.lineId])).length) throw new HttpError(400, 'Linha inexistente.');
    if (s.busId != null && !(await q('SELECT 1 FROM buses WHERE id = ?', [s.busId])).length) throw new HttpError(400, 'Ônibus inexistente.');
    const now = nowIso();
    let sid = id;
    if (id == null) {
      sid = await one(q(`INSERT INTO services (weekday, line_id, bus_id, start_time, end_time, shift_name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [s.weekday, s.lineId, s.busId, s.startTime, s.endTime, s.shiftName, s.active ? 1 : 0, now, now]));
    } else {
      await changed(q(`UPDATE services SET weekday = ?, line_id = ?, bus_id = ?, start_time = ?, end_time = ?, shift_name = ?, active = ?, updated_at = ? WHERE id = ? RETURNING id`,
        [s.weekday, s.lineId, s.busId, s.startTime, s.endTime, s.shiftName, s.active ? 1 : 0, now, id]), 'Serviço não encontrado.');
    }
    const conflicts = serviceBusConflicts(await repo.listServices(q)).filter(([a, b]) => a.id === sid || b.id === sid);
    if (conflicts.length) {
      const o = conflicts[0][0].id === sid ? conflicts[0][1] : conflicts[0][0];
      throw new HttpError(409, `O ônibus já está em outro serviço ativo com horário sobreposto (${o.weekday === 6 ? 'sábado' : 'domingo'} ${o.startTime}–${o.endTime}).`);
    }
    return sid!;
  };
  app.post('/api/services', async (req, res) => {
    const s = parse(serviceIn, req.body);
    res.status(201).json({ id: await data(req, (q) => saveService(q, null, s)) });
  });
  app.put('/api/services/:id', async (req, res) => {
    const id = idParam(req);
    const s = parse(serviceIn, req.body);
    await data(req, (q) => saveService(q, id, s));
    res.json({ ok: true });
  });
  app.delete('/api/services/:id', async (req, res) => {
    const id = idParam(req);
    await data(req, (q) => changed(q('DELETE FROM services WHERE id = ? RETURNING id', [id]), 'Serviço não encontrado.'));
    res.json({ ok: true });
  });

  app.post('/api/recipients', async (req, res) => {
    const r = parse(recipientIn, req.body);
    const id = await data(req, (q) => one(q('INSERT INTO recipients (name, phone, created_at) VALUES (?, ?, ?) RETURNING id', [r.name, normalizePhone(r.phone), nowIso()])));
    res.status(201).json({ id });
  });
  app.put('/api/recipients/:id', async (req, res) => {
    const id = idParam(req);
    const r = parse(recipientIn, req.body);
    await data(req, (q) => changed(q('UPDATE recipients SET name = ?, phone = ? WHERE id = ? RETURNING id', [r.name, normalizePhone(r.phone), id]), 'Destinatário não encontrado.'));
    res.json({ ok: true });
  });
  app.delete('/api/recipients/:id', async (req, res) => {
    const id = idParam(req);
    await data(req, (q) => q('DELETE FROM recipients WHERE id = ?', [id]));
    res.json({ ok: true });
  });

  app.put('/api/settings', async (req, res) => {
    const s = parse(settingsIn, req.body);
    await data(req, (q) => repo.saveSettings(q, s));
    res.json({ ok: true });
  });

  /* ---------- escalas ---------- */
  app.get('/api/weekend/:saturday', async (req, res) => {
    const s = parse(sat, req.params.saturday);
    res.json(await data(req, (q) => sch.getWeekend(q, s)));
  });

  app.post('/api/schedules/generate', async (req, res) => {
    const { saturday, seed } = parse(z.object({ saturday: sat, seed: z.number().int().optional() }), req.body);
    res.json(await data(req, (q) => sch.generate(q, saturday, seed)));
  });

  app.post('/api/schedules/validate', async (req, res) => {
    const b = parse(z.object({ saturday: sat, entries: entriesIn, scheduleId: z.number().int().nullable().optional() }), req.body);
    res.json(await data(req, (q) => sch.validateDraft(q, b.saturday, b.entries as Entry[], b.scheduleId ?? null)));
  });

  app.get('/api/schedules', async (req, res) => {
    const q0 = req.query as Record<string, string | undefined>;
    res.json(await data(req, (q) => repo.listSchedulesMeta(q, {
      from: q0.from && isValidDate(q0.from) ? q0.from : undefined, to: q0.to && isValidDate(q0.to) ? q0.to : undefined,
      status: q0.status && ['rascunho', 'confirmada', 'cancelada'].includes(q0.status) ? q0.status : undefined,
    })));
  });

  app.post('/api/schedules', async (req, res) => {
    const b = parse(z.object({ saturday: sat, entries: entriesIn, notes: z.string().max(1000).nullable().optional() }), req.body);
    const created = await unique(data(req, (q) => sch.createSchedule(q, A(req).auth.username, { saturday: b.saturday, entries: b.entries as Entry[], notes: b.notes })),
      'Já existe uma escala (rascunho ou confirmada) para este fim de semana.');
    res.status(201).json(created);
  });

  app.get('/api/schedules/:id', async (req, res) => {
    const id = idParam(req);
    const s = await data(req, (q) => repo.loadSchedule(q, id));
    if (!s) throw new HttpError(404, 'Escala não encontrada.');
    res.json(s);
  });

  app.put('/api/schedules/:id', async (req, res) => {
    const id = idParam(req);
    const b = parse(z.object({ entries: entriesIn, version: z.number().int(), reason: z.string().max(500).nullable().optional(), notes: z.string().max(1000).nullable().optional() }), req.body);
    res.json(await data(req, (q) => sch.updateSchedule(q, A(req).auth.username, id, { ...b, entries: b.entries as Entry[] })));
  });

  app.post('/api/schedules/:id/confirm', async (req, res) => {
    const id = idParam(req);
    const b = parse(z.object({ version: z.number().int() }), req.body);
    res.json(await data(req, (q) => sch.confirmSchedule(q, A(req).auth.username, id, b.version)));
  });

  app.post('/api/schedules/:id/cancel', async (req, res) => {
    const id = idParam(req);
    const b = parse(z.object({ version: z.number().int(), reason: z.string().trim().min(1, 'Informe o motivo.').max(500) }), req.body);
    res.json(await data(req, (q) => sch.cancelSchedule(q, A(req).auth.username, id, b.version, b.reason)));
  });

  app.post('/api/schedules/:id/swap', async (req, res) => {
    const id = idParam(req);
    const b = parse(z.object({ a: z.string(), b: z.string(), field: z.enum(['driver', 'conductor', 'line', 'bus']), version: z.number().int(), reason: z.string().max(500).nullable().optional() }), req.body);
    res.json(await data(req, (q) => sch.swapEntries(q, A(req).auth.username, id, b)));
  });

  /** Apaga de vez escalas (somente administradores). Guarda antes uma cópia em backup_snapshots. */
  const purge = async (q: Q, ids: number[] | null, username: string) => {
    const where = ids ? 'WHERE id = ANY(?)' : '';
    const whereE = ids ? 'WHERE schedule_id = ANY(?)' : '';
    const args = ids ? [ids] : [];
    const data = {
      schedules: await q(`SELECT * FROM schedules ${where}`, args),
      schedule_entries: await q(`SELECT * FROM schedule_entries ${whereE}`, args),
      schedule_audit: await q(`SELECT * FROM schedule_audit ${whereE}`, args),
    };
    if (!data.schedules.length) return 0;
    await q('INSERT INTO backup_snapshots (created_at, reason, data) VALUES (?, ?, ?)',
      [nowIso(), `escalas apagadas por ${username}`, JSON.stringify(data)]);
    await q(`DELETE FROM schedule_entries ${whereE}`, args);
    await q(`DELETE FROM schedule_audit ${whereE}`, args);
    await q(`DELETE FROM schedules ${where}`, args);
    return data.schedules.length;
  };
  app.delete('/api/schedules/:id', async (req, res) => {
    if (!A(req).auth.isAdmin) throw new HttpError(403, 'Somente administradores podem apagar escalas.');
    const id = idParam(req);
    const n = await data(req, (q) => purge(q, [id], A(req).auth.username));
    if (!n) throw new HttpError(404, 'Escala não encontrada.');
    res.json({ ok: true });
  });
  app.post('/api/schedules/purge', async (req, res) => {
    if (!A(req).auth.isAdmin) throw new HttpError(403, 'Somente administradores podem apagar o histórico.');
    parse(z.object({ confirm: z.literal('APAGAR', { message: 'Digite APAGAR para confirmar.' }) }), req.body);
    const n = await data(req, (q) => purge(q, null, A(req).auth.username));
    res.json({ ok: true, deleted: n });
  });

  app.get('/api/schedules/:id/audit', async (req, res) => {
    const id = idParam(req);
    res.json(await data(req, (q) => repo.listAudit(q, id)));
  });

  /** Histórico em formato de lista, com filtros por data, pessoa, função, linha e status. */
  app.get('/api/history', async (req, res) => {
    const qs = req.query as Record<string, string | undefined>;
    const where = ['1 = 1'];
    const args: unknown[] = [];
    if (qs.from && isValidDate(qs.from)) { where.push('e.date >= ?'); args.push(qs.from); }
    if (qs.to && isValidDate(qs.to)) { where.push('e.date <= ?'); args.push(qs.to); }
    const status = qs.status ?? 'confirmada';
    if (status !== 'todas') { where.push('s.status = ?'); args.push(status); }
    if (qs.lineCode) { where.push('e.line_code = ?'); args.push(qs.lineCode); }
    const pid = Number(qs.personId);
    if (qs.personId && Number.isInteger(pid)) {
      if (qs.role === 'motorista') { where.push('e.driver_id = ?'); args.push(pid); }
      else if (qs.role === 'cobrador') { where.push('e.conductor_id = ?'); args.push(pid); }
      else { where.push('(e.driver_id = ? OR e.conductor_id = ?)'); args.push(pid, pid); }
    } else if (qs.role === 'motorista') where.push('e.driver_id IS NOT NULL');
    else if (qs.role === 'cobrador') where.push('e.conductor_id IS NOT NULL');
    const rows = await data(req, (q) => q(`SELECT e.*, s.status, s.saturday FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
      WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.start_time LIMIT 2000`, args));
    res.json(rows.map((r) => ({ ...repo.mapEntry(r), scheduleId: Number(r.schedule_id), status: r.status, saturday: r.saturday })));
  });

  /* ---------- backup ---------- */
  app.get('/api/backup/export', async (req, res) => {
    const out = await data(req, (q) => exportBackup(q, A(req).auth.mode));
    const name = `escalabus-${A(req).auth.mode === 'demo' ? 'DEMO-' : ''}backup-${nowIso().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.json(out);
  });
  app.post('/api/backup/validate', (req, res) => { res.json(validateBackup(req.body)); });
  app.post('/api/backup/import', async (req, res) => {
    const b = parse(z.object({ confirm: z.literal('SUBSTITUIR', { message: 'Digite SUBSTITUIR para confirmar.' }), data: z.unknown() }), req.body);
    try {
      const r = await data(req, (q) => importBackup(q, b.data, A(req).auth.mode));
      res.json({ ok: true, safetyCopy: `cópia nº ${r.safetyCopyId} (tabela backup_snapshots)` });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const details = (e as { details?: unknown }).details;
      if (details) throw new HttpError(400, (e as Error).message, details);
      throw e;
    }
  });

  app.post('/api/demo/reset', async (req, res) => {
    if (A(req).auth.mode !== 'demo') throw new HttpError(400, 'Disponível somente no modo demonstração.');
    await db.tx('demo', seedDemo);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Rota não encontrada.' }); });

  /* ---------- frontend estático (servidor próprio; na Vercel os arquivos são servidos pela CDN) ---------- */
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
