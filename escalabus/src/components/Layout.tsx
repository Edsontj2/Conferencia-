import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../state';
import { InstallButton } from './InstallButton';
import { fmtDateTime } from './ui';

const NAV = [
  { to: '/', label: 'Escala', end: true },
  { to: '/relatorio', label: 'Relatório' },
  { to: '/historico', label: 'Histórico' },
  { to: '/pessoas', label: 'Pessoas' },
  { to: '/linhas', label: 'Linhas' },
  { to: '/onibus', label: 'Ônibus' },
  { to: '/servicos', label: 'Serviços' },
  { to: '/configuracoes', label: 'Configurações' },
];

export function Layout() {
  const { me, online, logout, catalogSavedAt, catalog } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="shell">
      <header className="topbar no-print">
        <button className="btn-icon menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>☰</button>
        <div className="brand">
          <img src="/icons/icon-192.png" alt="" width={28} height={28} />
          <span>EscalaBus</span>
          {catalog && <span className="company">{catalog.settings.companyName}</span>}
        </div>
        <div className="topbar-right">
          <InstallButton compact />
          <span className="user">{me?.username}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => void logout()} disabled={!online}>Sair</button>
        </div>
      </header>
      {me?.mode === 'demo' && (
        <div className="banner banner-demo no-print">
          MODO DEMONSTRAÇÃO — dados fictícios, armazenados separadamente dos dados reais. Volte ao modo real em Configurações.
        </div>
      )}
      {!online && (
        <div className="banner banner-offline no-print" role="alert">
          ● Você está OFFLINE. Exibindo a última cópia carregada{catalogSavedAt ? ` (${fmtDateTime(catalogSavedAt)})` : ''}. Alterações estão bloqueadas.
        </div>
      )}
      <div className="body">
        <nav className={`sidenav no-print ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
          ))}
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
