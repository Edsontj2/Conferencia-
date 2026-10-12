import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../state';
import { InstallButton } from './InstallButton';
import { Icon } from './Icons';
import { Logo } from './Logo';
import { fmtDateTime } from './ui';

interface NavItem { to: string; label: string; icon: () => ReactNode; end?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Icon.home, end: true },
  { to: '/escala', label: 'Escalas', icon: Icon.calendar },
  { to: '/pessoas', label: 'Pessoas', icon: Icon.people },
  { to: '/linhas', label: 'Linhas', icon: Icon.route },
  { to: '/onibus', label: 'Ônibus', icon: Icon.bus },
  { to: '/servicos', label: 'Serviços', icon: Icon.clock },
  { to: '/relatorio', label: 'Relatórios', icon: Icon.chart },
  { to: '/historico', label: 'Histórico', icon: Icon.history },
  { to: '/configuracoes', label: 'Configurações', icon: Icon.settings },
];

export function Layout() {
  const { me, online, logout, catalogSavedAt } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const initials = (me?.username ?? '?').slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className={`sidebar no-print ${open ? 'open' : ''}`} aria-label="Menu principal">
        <div className="sb-brand">
          <Logo size={34} />
          <button className="sb-close" onClick={() => setOpen(false)} aria-label="Fechar menu"><Icon.close /></button>
        </div>
        <nav className="sb-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `sb-link ${isActive ? 'active' : ''}`}>
              <n.icon /><span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sb-footer">
          {me?.mode === 'demo' && <div className="sb-demo">Modo demonstração</div>}
          <InstallButton />
          <div className="sb-user">
            <div className="avatar">{initials}</div>
            <div className="sb-user-text">
              <strong>{me?.username}</strong>
              <span>{me?.isAdmin ? 'Administrador' : 'Operador'}</span>
            </div>
            <button className="sb-icon-btn" onClick={() => void logout()} disabled={!online} title="Sair" aria-label="Sair"><Icon.logout /></button>
          </div>
        </div>
      </aside>
      {open && <div className="sb-overlay no-print" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="mobile-bar no-print">
          <Logo size={32} />
          <button className="mobile-menu" onClick={() => setOpen(true)} aria-label="Abrir menu"><Icon.menu /></button>
        </header>
        {me?.mustChange && (
          <div className="notice notice-warn no-print" role="alert">
            <Icon.alert /> Você está usando a senha padrão.&nbsp;<NavLink to="/configuracoes">Troque agora em Configurações → Minha senha</NavLink>.
          </div>
        )}
        {me?.mode === 'demo' && (
          <div className="notice notice-demo no-print">Modo demonstração: dados fictícios, separados dos dados reais. Volte ao modo real em Configurações.</div>
        )}
        {!online && (
          <div className="notice notice-err no-print" role="alert">
            <Icon.wifiOff /> Sem conexão. Exibindo a última cópia carregada{catalogSavedAt ? ` (${fmtDateTime(catalogSavedAt)})` : ''}. Alterações estão bloqueadas.
          </div>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
