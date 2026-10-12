import { useEffect, useRef, type ReactNode } from 'react';
import type { Issue } from '../../shared/types';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = { rascunho: 'Rascunho', confirmada: 'Confirmada', cancelada: 'Cancelada' };
  return <span className={`badge badge-${status}`}>{label[status] ?? status}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <span className={`badge ${active ? 'badge-ok' : 'badge-off'}`}>{active ? 'Ativo' : 'Inativo'}</span>;
}

export function IssuesPanel({ issues, title = 'Pendências' }: { issues: Issue[]; title?: string }) {
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.severity === 'error');
  const incomplete = issues.filter((i) => i.severity === 'incomplete');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <section className="issues" aria-label={title}>
      {errors.length > 0 && (
        <div className="alert alert-err">
          <strong>Regras violadas ({errors.length}) — não é possível salvar:</strong>
          <ul>{errors.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        </div>
      )}
      {incomplete.length > 0 && (
        <div className="alert alert-warn">
          <strong>Incompleta ({incomplete.length}) — pode salvar como rascunho, mas não confirmar:</strong>
          <ul>{incomplete.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="alert alert-info">
          <strong>Avisos</strong>
          <ul>{warnings.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
