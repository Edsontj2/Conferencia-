import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DB } from './db';
import { nowIso } from './db';

export const COOKIE = 'eb_session';
const SESSION_DAYS = 30;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  return null;
}

export function upsertAdmin(db: DB, username: string, password: string) {
  const p = passwordProblem(password);
  if (p) throw new Error(p);
  const h = hashPassword(password);
  const ex = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (ex) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(h, ex.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(ex.id);
  } else {
    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, h, nowIso());
  }
}

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db: DB, userId: number, mode: 'real' | 'demo' = 'real'): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, mode, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha(token), userId, mode, nowIso(), exp);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
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

export interface AuthInfo { userId: number; username: string; mode: 'real' | 'demo'; tokenHash: string }

export function sessionFrom(db: DB, req: Request): AuthInfo | null {
  const tok = readCookie(req, COOKIE);
  if (!tok) return null;
  const r = db.prepare(`SELECT s.token_hash, s.mode, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
    .get(sha(tok)) as { token_hash: string; mode: 'real' | 'demo'; expires_at: string; id: number; username: string } | undefined;
  if (!r || r.expires_at < nowIso()) return null;
  return { userId: r.id, username: r.username, mode: r.mode, tokenHash: r.token_hash };
}

export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400_000, path: '/' });
}

/** Limite simples de tentativas de login por IP (proteção contra força bruta). */
export function loginLimiter() {
  const fails = new Map<string, { n: number; until: number }>();
  return {
    check(ip: string) {
      const f = fails.get(ip);
      return !(f && f.n >= 5 && f.until > Date.now());
    },
    fail(ip: string) {
      const f = fails.get(ip);
      const n = f && f.until > Date.now() ? f.n + 1 : 1;
      fails.set(ip, { n, until: Date.now() + 15 * 60_000 });
    },
    ok(ip: string) { fails.delete(ip); },
  };
}

export type AuthedRequest = Request & { auth: AuthInfo; db: DB };
export function requireAuth(mainDb: DB, dbFor: (mode: 'real' | 'demo') => DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    const a = sessionFrom(mainDb, req);
    if (!a) { res.status(401).json({ error: 'Sessão expirada ou inexistente. Entre novamente.' }); return; }
    (req as AuthedRequest).auth = a;
    (req as AuthedRequest).db = dbFor(a.mode);
    next();
  };
}
