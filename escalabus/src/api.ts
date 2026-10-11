/**
 * Cliente da API. O banco de dados principal é o servidor (SQLite).
 * O localStorage guarda apenas uma CÓPIA das últimas consultas, para leitura offline.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { issues?: import('../shared/types').Issue[]; [k: string]: unknown }) {
    super(message);
  }
}

type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let cacheScope = 'anon';

export const isOnline = () => online;
export function onOnlineChange(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setOnline(v: boolean) {
  if (v === online) return;
  online = v;
  listeners.forEach((l) => l(v));
}
export function setCacheScope(scope: string) { cacheScope = scope; }

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void ping(); });
  window.addEventListener('offline', () => setOnline(false));
  setInterval(() => { if (!online) void ping(); }, 15000);
}

export async function ping(): Promise<boolean> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    setOnline(r.ok);
    return r.ok;
  } catch {
    setOnline(false);
    return false;
  }
}

const CACHE_PREFIX = 'eb-cache:';
export interface Cached<T> { data: T; savedAt: string; fromCache: boolean }

function cacheKey(url: string) { return `${CACHE_PREFIX}${cacheScope}:${url}`; }
function writeCache(url: string, data: unknown) {
  try { localStorage.setItem(cacheKey(url), JSON.stringify({ data, savedAt: new Date().toISOString() })); } catch { /* cota cheia: ignora */ }
}
function readCache<T>(url: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return { data: v.data, savedAt: v.savedAt, fromCache: true };
  } catch { return null; }
}
export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  } catch { /* ignore */ }
}
export function rememberLast(key: string, value: string) { try { localStorage.setItem(`eb-last:${cacheScope}:${key}`, value); } catch { /* ignore */ } }
export function recallLast(key: string): string | null { try { return localStorage.getItem(`eb-last:${cacheScope}:${key}`); } catch { return null; } }

async function parse(r: Response) {
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const b = body as { error?: string; details?: ApiError['details'] } | null;
    if (r.status === 401) window.dispatchEvent(new Event('eb-unauthorized'));
    throw new ApiError(r.status, b?.error ?? `Erro ${r.status}`, b?.details);
  }
  return body;
}

/** GET com cópia offline: se a rede falhar, devolve a última resposta salva (marcada como fromCache). */
export async function getCached<T>(url: string): Promise<Cached<T>> {
  try {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    setOnline(true);
    const data = (await parse(r)) as T;
    writeCache(url, data);
    return { data, savedAt: new Date().toISOString(), fromCache: false };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    setOnline(false);
    const c = readCache<T>(url);
    if (c) return c;
    throw new ApiError(0, 'Sem conexão com o servidor e sem cópia salva desta consulta.');
  }
}

export async function get<T>(url: string): Promise<T> {
  try {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    setOnline(true);
    return (await parse(r)) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    setOnline(false);
    throw new ApiError(0, 'Sem conexão com o servidor.');
  }
}

/** Alterações: bloqueadas quando offline (nunca ficam "pendentes" sem garantia de gravação). */
export async function send<T>(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  if (!online) throw new ApiError(0, 'Você está offline. Alterações ficam bloqueadas até a conexão voltar.');
  let r: Response;
  try {
    r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'EscalaBus' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    setOnline(false);
    throw new ApiError(0, 'Falha de conexão: a alteração NÃO foi salva. Tente novamente quando estiver online.');
  }
  setOnline(true);
  return (await parse(r)) as T;
}
