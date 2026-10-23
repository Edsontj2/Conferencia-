import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { Database, Q } from './db.js';
import { nowIso } from './db.js';
import { hashPassword, loginLimit, passwordProblem, readCookie, sha, verifyPassword } from './auth.js';
import { HttpError } from './schedules.js';
import * as repo from './repo.js';
import { findNameMatches, normalizeBrPhone, pickPerson } from '../shared/names.js';
import { phoneProblem } from '../shared/whatsapp.js';
import { serviceMinutes, sundayOf } from '../shared/time.js';
import { publishedExtra, publishedExtras, sendPublishedFile } from './extras.js';

/**
 * App dos funcionários (somente visualização). Contas e sessões ficam no schema real.
 * Mostra apenas escalas CONFIRMADAS dos dados reais.
 */
const COOKIE = 'eb_func';
const DAYS = 60;

interface Account { id: number; phone: string; full_name: string; person_id: number | null }
type FuncReq = Request & { account: Account };

export function registerEmployeeRoutes(app: Express, db: Database, secure: (req: Request) => boolean, parse: <T>(s: z.ZodType<T>, d: unknown) => T) {
  const real = <T>(fn: (q: Q) => Promise<T>) => db.tx('real', fn);

  const setCookie = (req: Request, res: Response, token: string) =>
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secure(req), maxAge: DAYS * 86400_000, path: '/' });
  const newSession = async (q: Q, accountId: number) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await q('INSERT INTO employee_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [sha(token), accountId, nowIso(), new Date(Date.now() + DAYS * 86400_000).toISOString()]);
    await q('UPDATE employee_accounts SET last_login_at = ? WHERE id = ?', [nowIso(), accountId]);
    return token;
  };
  const phoneIn = z.string().transform(normalizeBrPhone).refine((v) => !phoneProblem(v), 'Telefone inválido: informe DDD e número (ex.: 61 99999-0000).');

  const personInfo = async (q: Q, id: number | null) => {
    if (id == null) return null;
    const [p] = await q<{ id: number; name: string; role: string; shift_name: string }>('SELECT id, name, role, shift_name FROM people WHERE id = ?', [id]);
    return p ? { id: Number(p.id), name: p.name, role: p.role, shiftName: p.shift_name } : null;
  };

  /** Liga a conta à pessoa e grava o telefone no cadastro dela. */
  const link = async (q: Q, accountId: number, phone: string, personId: number) => {
    const [taken] = await q('SELECT id FROM employee_accounts WHERE person_id = ? AND id <> ?', [personId, accountId]);
    if (taken) throw new HttpError(409, 'Esta pessoa já tem um acesso cadastrado. Procure a administração.');
    await q('UPDATE employee_accounts SET person_id = ? WHERE id = ?', [personId, accountId]);
    await q('UPDATE people SET whatsapp = ?, updated_at = ? WHERE id = ?', [phone, nowIso(), personId]);
  };

  /* ---------- cadastro e login (sem sessão) ---------- */
  app.post('/api/func/register', async (req, res) => {
    const b = parse(z.object({
      phone: phoneIn, name: z.string().trim().min(5, 'Informe seu nome completo.').max(120),
      password: z.string(), personId: z.number().int().optional(), noMatch: z.boolean().optional(),
    }), req.body);
    const p = passwordProblem(b.password);
    if (p) throw new HttpError(400, p);
    const result = await real(async (q) => {
      if ((await q('SELECT 1 FROM employee_accounts WHERE phone = ?', [b.phone])).length) {
        throw new HttpError(409, 'Este telefone já está cadastrado. Use "Entrar" ou peça à administração para redefinir.');
      }
      const people = (await repo.listPeople(q)).filter((x) => x.active);
      const linked = new Set((await q<{ person_id: number }>('SELECT person_id FROM employee_accounts WHERE person_id IS NOT NULL')).map((r) => Number(r.person_id)));
      const matches = findNameMatches(b.name, people.filter((x) => !linked.has(x.id)), (x) => x.name);
      const { auto, options } = pickPerson(matches);
      let personId: number | null = auto?.id ?? null;
      if (b.personId != null) {
        // escolha do funcionário entre as opções mostradas
        if (!matches.some((m) => m.item.id === b.personId)) throw new HttpError(400, 'Opção inválida. Confira seu nome.');
        personId = b.personId;
      } else if (b.noMatch) {
        personId = null; // "nenhum destes sou eu": cadastra sem vínculo; a administração vincula depois
      } else if (!auto && options.length) {
        return { choose: options.map((o) => ({ id: o.id, name: o.name, role: o.role })) };
      }
      const [{ id }] = await q<{ id: number }>('INSERT INTO employee_accounts (phone, full_name, password_hash, person_id, created_at) VALUES (?, ?, ?, NULL, ?) RETURNING id',
        [b.phone, b.name, hashPassword(b.password), nowIso()]);
      if (personId != null) await link(q, Number(id), b.phone, personId);
      return { token: await newSession(q, Number(id)), person: await personInfo(q, personId) };
    });
    if ('choose' in result) { res.json({ choose: result.choose }); return; }
    setCookie(req, res, result.token);
    res.status(201).json({ person: result.person });
  });

  app.post('/api/func/login', async (req, res) => {
    const b = parse(z.object({ phone: z.string().transform(normalizeBrPhone), password: z.string().min(1) }), req.body);
    const ip = `func:${req.ip ?? 'x'}`;
    const r = await real(async (q) => {
      if (await loginLimit.blocked(q, ip)) return { status: 'blocked' as const };
      const [a] = await q<{ id: number; password_hash: string }>('SELECT id, password_hash FROM employee_accounts WHERE phone = ?', [b.phone]);
      if (!a || !verifyPassword(b.password, a.password_hash)) return { status: 'bad' as const };
      await loginLimit.ok(q, ip);
      return { status: 'ok' as const, token: await newSession(q, Number(a.id)) };
    });
    if (r.status === 'blocked') throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
    if (r.status === 'bad') { await real((q) => loginLimit.fail(q, ip)); throw new HttpError(401, 'Telefone ou senha incorretos.'); }
    setCookie(req, res, r.token);
    res.json({ ok: true });
  });

  app.post('/api/func/logout', async (req, res) => {
    const tok = readCookie(req, COOKIE);
    if (tok) await real((q) => q('DELETE FROM employee_sessions WHERE token_hash = ?', [sha(tok)]));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  /* ---------- com sessão do funcionário ---------- */
  const auth = async (req: Request, res: Response, next: NextFunction) => {
    const tok = readCookie(req, COOKIE);
    const a = tok ? await real(async (q) => (await q<Account & { expires_at: string }>(
      `SELECT a.id, a.phone, a.full_name, a.person_id, s.expires_at FROM employee_sessions s JOIN employee_accounts a ON a.id = s.account_id WHERE s.token_hash = ?`, [sha(tok)]))[0]) : null;
    if (!a || a.expires_at < nowIso()) { res.status(401).json({ error: 'Entre com seu telefone e senha.' }); return; }
    (req as FuncReq).account = { ...a, id: Number(a.id), person_id: a.person_id == null ? null : Number(a.person_id) };
    next();
  };
  const acc = (req: Request) => (req as FuncReq).account;

  app.get('/api/func/me', auth, async (req, res) => {
    const a = acc(req);
    const out = await real(async (q) => ({ phone: a.phone, fullName: a.full_name, person: await personInfo(q, a.person_id), companyName: (await repo.getSettings(q)).companyName }));
    res.json(out);
  });

  app.post('/api/func/password', auth, async (req, res) => {
    const b = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const p = passwordProblem(b.next);
    if (p) throw new HttpError(400, p);
    await real(async (q) => {
      const [r] = await q<{ password_hash: string }>('SELECT password_hash FROM employee_accounts WHERE id = ?', [acc(req).id]);
      if (!verifyPassword(b.current, r.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
      await q('UPDATE employee_accounts SET password_hash = ? WHERE id = ?', [hashPassword(b.next), acc(req).id]);
    });
    res.json({ ok: true });
  });

  /** Escalas confirmadas dos fins de semana + escalas avulsas publicadas (mais recentes primeiro), indicando se a pessoa trabalha. */
  app.get('/api/func/schedules', auth, async (req, res) => {
    const pid = acc(req).person_id;
    const rows = await real((q) => q<{ id: number; saturday: string; mine: number }>(
      `SELECT s.id, s.saturday,
        (SELECT COUNT(*) FROM schedule_entries e WHERE e.schedule_id = s.id AND (e.driver_id = ? OR e.conductor_id = ?)) AS mine
       FROM schedules s WHERE s.status = 'confirmada' ORDER BY s.saturday DESC LIMIT 60`, [pid ?? -1, pid ?? -1]));
    const extras = await real((q) => publishedExtras(q, pid));
    // horas estimadas da pessoa em cada escala (soma das durações dos serviços dela)
    const mins = new Map<number, number>();
    if (pid != null) {
      const es = await real((q) => q<{ schedule_id: number; start_time: string; end_time: string }>(
        `SELECT e.schedule_id, e.start_time, e.end_time FROM schedule_entries e JOIN schedules s ON s.id = e.schedule_id
         WHERE s.status = 'confirmada' AND (e.driver_id = ? OR e.conductor_id = ?)`, [pid, pid]));
      for (const e of es) mins.set(Number(e.schedule_id), (mins.get(Number(e.schedule_id)) ?? 0) + serviceMinutes(e.start_time, e.end_time));
    }
    const items = [
      ...rows.map((r) => ({ kind: 'fds' as const, id: Number(r.id), date: r.saturday, saturday: r.saturday, sunday: sundayOf(r.saturday), mine: Number(r.mine), minutes: mins.get(Number(r.id)) ?? 0 })),
      ...extras.map((x) => ({ kind: 'avulsa' as const, ...x })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    res.json(items);
  });

  /** Escala avulsa/importada publicada (ex.: escala de eleição), com os arquivos originais. */
  app.get('/api/func/extras/:id', auth, async (req, res) => {
    res.json(await real((q) => publishedExtra(q, Number(req.params.id))));
  });
  app.get('/api/func/files/:fid', auth, async (req, res) => {
    await real((q) => sendPublishedFile(res, q, Number(req.params.fid)));
  });

  app.get('/api/func/schedules/:id', auth, async (req, res) => {
    const id = Number(req.params.id);
    const s = await real((q) => repo.loadSchedule(q, id));
    if (!s || s.status !== 'confirmada') throw new HttpError(404, 'Escala não encontrada.');
    res.json({ id: s.id, saturday: s.saturday, sunday: sundayOf(s.saturday), confirmedAt: s.confirmedAt, updatedAt: s.updatedAt, entries: s.entries });
  });
}

/** Rotas do painel administrativo para gerenciar os acessos dos funcionários (chamar após a autenticação do admin). */
export function registerEmployeeAdminRoutes(app: Express, db: Database, isAdmin: (req: Request) => boolean, parse: <T>(s: z.ZodType<T>, d: unknown) => T) {
  const real = <T>(fn: (q: Q) => Promise<T>) => db.tx('real', fn);
  const guard = (req: Request) => { if (!isAdmin(req)) throw new HttpError(403, 'Somente administradores.'); };
  app.get('/api/employees', async (req, res) => {
    guard(req);
    const rows = await real((q) => q(`SELECT a.id, a.phone, a.full_name, a.person_id, a.created_at, a.last_login_at, p.name AS person_name, p.role
      FROM employee_accounts a LEFT JOIN people p ON p.id = a.person_id ORDER BY lower(a.full_name)`));
    res.json(rows.map((r) => ({ id: Number(r.id), phone: r.phone, fullName: r.full_name, personId: r.person_id == null ? null : Number(r.person_id),
      personName: r.person_name ?? null, role: r.role ?? null, createdAt: r.created_at, lastLoginAt: r.last_login_at ?? null })));
  });
  app.put('/api/employees/:id', async (req, res) => {
    guard(req);
    const id = Number(req.params.id);
    const b = parse(z.object({ personId: z.number().int().nullable() }), req.body);
    await real(async (q) => {
      const [a] = await q<{ phone: string }>('SELECT phone FROM employee_accounts WHERE id = ?', [id]);
      if (!a) throw new HttpError(404, 'Acesso não encontrado.');
      if (b.personId != null) {
        if ((await q('SELECT 1 FROM employee_accounts WHERE person_id = ? AND id <> ?', [b.personId, id])).length) throw new HttpError(409, 'Esta pessoa já está vinculada a outro acesso.');
        await q('UPDATE people SET whatsapp = ?, updated_at = ? WHERE id = ?', [a.phone, nowIso(), b.personId]);
      }
      await q('UPDATE employee_accounts SET person_id = ? WHERE id = ?', [b.personId, id]);
    });
    res.json({ ok: true });
  });
  app.post('/api/employees/:id/password', async (req, res) => {
    guard(req);
    const b = parse(z.object({ password: z.string() }), req.body);
    const p = passwordProblem(b.password);
    if (p) throw new HttpError(400, p);
    await real(async (q) => {
      await q('UPDATE employee_accounts SET password_hash = ? WHERE id = ?', [hashPassword(b.password), Number(req.params.id)]);
      await q('DELETE FROM employee_sessions WHERE account_id = ?', [Number(req.params.id)]);
    });
    res.json({ ok: true });
  });
  app.delete('/api/employees/:id', async (req, res) => {
    guard(req);
    await real((q) => q('DELETE FROM employee_accounts WHERE id = ?', [Number(req.params.id)]));
    res.json({ ok: true });
  });
}
