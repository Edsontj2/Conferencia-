import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FuncApp } from './FuncApp';
import '../styles.css';
import './func.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/func/sw.js', { scope: '/func/' }).catch(() => {}); });
}

/**
 * No iPhone o app instalado fica aberto em segundo plano por dias, sem recarregar a página.
 * Ao voltar para o app (e a cada 30 min) confere se saiu versão nova do app e recarrega.
 */
const SCRIPT_RE = /\/assets\/func-[\w-]+\.js/;
const current = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => SCRIPT_RE.exec(s.src)?.[0]).find(Boolean);
async function checkUpdate() {
  if (!current || !navigator.onLine) return;
  try {
    const html = await (await fetch('/func/', { cache: 'no-store' })).text();
    const latest = SCRIPT_RE.exec(html)?.[0];
    if (latest && latest !== current) {
      void navigator.serviceWorker?.getRegistration('/func/').then((r) => r?.update()).catch(() => {});
      location.reload();
    }
  } catch { /* sem internet: tenta depois */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkUpdate(); });
setInterval(() => void checkUpdate(), 30 * 60_000);
void checkUpdate();

createRoot(document.getElementById('root')!).render(<StrictMode><FuncApp /></StrictMode>);
