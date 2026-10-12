import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { Q } from './db.js';
import { nowIso } from './db.js';

export const COOKIE = 'eb_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, got);
}

export const MIN_PASSWORD = 6;
export function passwordProblem(pw: string): string | null {
  return pw.length < MIN_PASSWORD ? `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` : null;
}

export const DEFAULT_ADMIN = { username: 'admin', password: 'admin' };

/**
 * Cria ou redefine um administrador (q no schema real).
 * `mustChange` marca a senha como provisória (ex.: admin/admin padrão), exibindo aviso até ser trocada.
 */
export async function upsertAdmin(q: Q, username: string, password: string, opts: { mustChange?: boolean; skipCheck?: boolean } = {}) {
  const p = opts.skipCheck ? null : passwordProblem(password);
  if (p) throw new Error(p);
  const h = hashPassword(password);
  const mc = opts.mustChange ? 1 : 0;
  const [ex] = await q<{ id: number }>('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
  if (ex) {
    await q('UPDATE users SET password_hash = ?, is_admin = 1, must_change = ? WHERE id = ?', [h, mc, ex.id]);
    await q('DELETE FROM sessions WHERE user_id = ?', [ex.id]);
  } else {
    await q('INSERT INTO users (username, password_hash, created_at, is_admin, must_change) VALUES (?, ?, ?, 1, ?)', [username, h, nowIso(), mc]);
  }
}

export const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function createSession(q: Q, userId: number, mode: 'real' | 'demo' = 'real'): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await q('INSERT INTO sessions (token_hash, user_id, mode, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sha(token), userId, mode, nowIso(), exp]);
  await q('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);
  return token;
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export interface AuthInfo { userId: number; username: string; mode: 'real' | 'demo'; tokenHash: string; isAdmin: boolean; mustChange: boolean }

export async function sessionFrom(q: Q, req: Request): Promise<AuthInfo | null> {
  const tok = readCookie(req, COOKIE);
  if (!tok) return null;
  const [r] = await q<{ token_hash: string; mode: 'real' | 'demo'; expires_at: string; id: number; username: string; is_admin: number; must_change: number }>(
    `SELECT s.token_hash, s.mode, s.expires_at, u.id, u.username, u.is_admin, u.must_change
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [sha(tok)]);
  if (!r || r.expires_at < nowIso()) return null;
  return {
    userId: Number(r.id), username: r.username, mode: r.mode, tokenHash: r.token_hash,
    isAdmin: Number(r.is_admin) === 1, mustChange: Number(r.must_change) === 1,
  };
}

export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400_000, path: '/' });
}

/** Limite de tentativas de login por IP, guardado no banco (vale para várias instâncias serverless). */
export const loginLimit = {
  async blocked(q: Q, ip: string) {
    const [r] = await q<{ fails: number; until: string }>('SELECT fails, until FROM login_attempts WHERE ip = ?', [ip]);
    return !!r && r.fails >= 5 && r.until > nowIso();
  },
  async fail(q: Q, ip: string) {
    const until = new Date(Date.now() + 15 * 60_000).toISOString();
    await q(`INSERT INTO login_attempts (ip, fails, until) VALUES (?, 1, ?)
      ON CONFLICT (ip) DO UPDATE SET fails = CASE WHEN login_attempts.until > ? THEN login_attempts.fails + 1 ELSE 1 END, until = excluded.until`,
    [ip, until, nowIso()]);
  },
  async ok(q: Q, ip: string) { await q('DELETE FROM login_attempts WHERE ip = ?', [ip]); },
};
