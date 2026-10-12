import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="ph">
      <div className="ph-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right && <div className="ph-right">{right}</div>}
    </div>
  );
}

/** Botões de ícone das tabelas (editar azul, excluir vermelho…). */
export function IconAction({ kind = 'edit', title, onClick, disabled, children }: {
  kind?: 'edit' | 'danger' | 'neutral'; title: string; onClick: () => void; disabled?: boolean; children: ReactNode;
}) {
  return <button type="button" className={`ia ia-${kind}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}
