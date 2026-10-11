import { useEffect, useState } from 'react';
import { Modal } from './ui';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: BIPEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()); });
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Botão "Instalar aplicativo": usa o prompt nativo quando o navegador permite; no iPhone mostra instruções. */
export function InstallButton({ compact }: { compact?: boolean }) {
  const [, force] = useState(0);
  const [showIos, setShowIos] = useState(false);
  useEffect(() => { const f = () => force((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  if (isStandalone()) return null;
  if (deferred) {
    return (
      <button className="btn btn-sm" onClick={async () => { await deferred!.prompt(); await deferred!.userChoice; deferred = null; force((x) => x + 1); }}>
        ⬇ {compact ? 'Instalar' : 'Instalar aplicativo'}
      </button>
    );
  }
  if (isIos()) {
    return (
      <>
        <button className="btn btn-sm" onClick={() => setShowIos(true)}>⬇ {compact ? 'Instalar' : 'Instalar no iPhone'}</button>
        {showIos && <IosInstructions onClose={() => setShowIos(false)} />}
      </>
    );
  }
  return null;
}

export function IosInstructions({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Instalar no iPhone / iPad" onClose={onClose}>
      <ol className="steps">
        <li>Abra o EscalaBus no <strong>Safari</strong> (no iOS, só o Safari instala aplicativos web).</li>
        <li>Toque no botão <strong>Compartilhar</strong> (quadrado com seta para cima) na barra inferior.</li>
        <li>Role e toque em <strong>Adicionar à Tela de Início</strong>.</li>
        <li>Confirme em <strong>Adicionar</strong>. O ícone do EscalaBus aparecerá na tela inicial.</li>
      </ol>
      <p className="muted">O endereço precisa ser HTTPS para o modo offline funcionar.</p>
    </Modal>
  );
}
