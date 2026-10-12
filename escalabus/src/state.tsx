import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, clearCache, get, getCached, isOnline, onOnlineChange, send, setCacheScope } from './api';
import type { Catalog } from './types';

export interface Me { username: string; mode: 'real' | 'demo' }

interface AppState {
  me: Me | null;
  authChecked: boolean;
  online: boolean;
  catalog: Catalog | null;
  catalogSavedAt: string | null;
  catalogFromCache: boolean;
  reloadCatalog: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  switchMode: (m: 'real' | 'demo') => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);
const ME_KEY = 'eb-me';

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogSavedAt, setSavedAt] = useState<string | null>(null);
  const [catalogFromCache, setFromCache] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);

  useEffect(() => onOnlineChange(setOnline), []);

  const applyMe = (m: Me | null) => {
    setMe(m);
    setCacheScope(m ? `${m.username}:${m.mode}` : 'anon');
    try { if (m) localStorage.setItem(ME_KEY, JSON.stringify(m)); else localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
  };

  useEffect(() => {
    get<Me>('/api/auth/me')
      .then(applyMe)
      .catch((e) => {
        // Offline: permite consultar os dados salvos da última sessão (somente leitura).
        if (e instanceof ApiError && e.status === 0) {
          try { const m = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null'); if (m) applyMe(m); } catch { /* ignore */ }
        } else applyMe(null);
      })
      .finally(() => setAuthChecked(true));
    const onUnauth = () => applyMe(null);
    window.addEventListener('eb-unauthorized', onUnauth);
    return () => window.removeEventListener('eb-unauthorized', onUnauth);
  }, []);

  const reloadCatalog = useCallback(async () => {
    const r = await getCached<Catalog>('/api/catalog');
    setCatalog(r.data);
    setSavedAt(r.savedAt);
    setFromCache(r.fromCache);
  }, []);

  useEffect(() => {
    if (me) reloadCatalog().catch(() => setCatalog(null));
    else setCatalog(null);
  }, [me, reloadCatalog]);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);

  const value: AppState = {
    me, authChecked, online, catalog, catalogSavedAt, catalogFromCache, reloadCatalog, toast,
    login: async (u, p) => { applyMe(await send<Me>('POST', '/api/auth/login', { username: u, password: p })); },
    logout: async () => {
      try { await send('POST', '/api/auth/logout'); } finally { clearCache(); applyMe(null); }
    },
    switchMode: async (m) => { applyMe(await send<Me>('POST', '/api/auth/mode', { mode: m })); },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}
