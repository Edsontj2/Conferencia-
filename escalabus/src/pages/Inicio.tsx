import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCached } from '../api';
import { useApp } from '../state';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icons';
import { fmtDateTime, StatusBadge } from '../components/ui';
import type { ScheduleMeta, WeekendData } from '../types';
import { addDays, fmtDate, nextSaturday, sundayOf, todayLocal } from '../../shared/time';

export function InicioPage() {
  const { catalog, me } = useApp();
  const sat = nextSaturday(todayLocal());
  const [next, setNext] = useState<WeekendData | null>(null);
  const [recent, setRecent] = useState<ScheduleMeta[] | null>(null);

  useEffect(() => {
    getCached<WeekendData>(`/api/weekend/${sat}`).then((r) => setNext(r.data)).catch(() => setNext(null));
    getCached<ScheduleMeta[]>(`/api/schedules?from=${addDays(sat, -84)}`).then((r) => setRecent(r.data.slice(0, 6))).catch(() => setRecent([]));
  }, [sat]);

  const people = catalog?.people ?? [];
  const drivers = people.filter((p) => p.active && p.role === 'motorista').length;
  const conductors = people.filter((p) => p.active && p.role === 'cobrador').length;
  const svcSat = catalog?.services.filter((s) => s.active && s.weekday === 6).length ?? 0;
  const svcSun = catalog?.services.filter((s) => s.active && s.weekday === 0).length ?? 0;
  const s = next?.schedule;
  const open = s ? s.entries.reduce((n, e) => n + (e.driverId ? 0 : 1) + (e.conductorId ? 0 : 1), 0) : 0;
  const warnings = next?.issues.filter((i) => i.severity === 'warning') ?? [];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="dash">
      <PageHeader title="Dashboard" subtitle={`${greet}, ${me?.username}! Resumo das escalas de fim de semana${catalog ? ` · ${catalog.settings.companyName}` : ''}.`} />

      <section className="hero card">
        <div className="hero-main">
          <span className="eyebrow">Próximo fim de semana</span>
          <h3>Sábado {fmtDate(sat)} e domingo {fmtDate(sundayOf(sat))}</h3>
          <div className="hero-status">
            {s ? <StatusBadge status={s.status} /> : <span className="badge badge-off">Sem escala</span>}
            {s && <span className="muted small">{s.entries.length} serviços · atualizada {fmtDateTime(s.updatedAt)}</span>}
          </div>
          {s && open > 0 && <p className="hero-warn"><Icon.alert /> {open} vaga(s) sem preenchimento</p>}
          {s?.status === 'confirmada' && <p className="hero-ok"><Icon.check /> Escala confirmada e pronta para envio</p>}
          {warnings.length > 0 && !s && <p className="muted small">{warnings[0].message}</p>}
        </div>
        <div className="hero-actions">
          <Link className="btn btn-primary" to={`/escala?sabado=${sat}`}><Icon.dice /> {s ? 'Abrir escala' : 'Gerar escala'}</Link>
          {s && <Link className="btn" to={`/relatorio?sabado=${sat}`}><Icon.report /> Relatório e WhatsApp</Link>}
        </div>
      </section>

      <div className="stats">
        <Stat to="/pessoas" icon={<Icon.people />} label="Motoristas ativos" value={drivers} />
        <Stat to="/pessoas" icon={<Icon.people />} label="Cobradores ativos" value={conductors} />
        <Stat to="/linhas" icon={<Icon.route />} label="Linhas ativas" value={catalog?.lines.filter((l) => l.active).length ?? 0} />
        <Stat to="/onibus" icon={<Icon.bus />} label="Carros ativos" value={catalog?.buses.filter((b) => b.active).length ?? 0} />
        <Stat to="/servicos" icon={<Icon.clock />} label="Serviços sábado / domingo" value={`${svcSat} / ${svcSun}`} />
      </div>

      <section className="card">
        <div className="card-head"><h3>Escalas recentes</h3><Link to="/historico" className="link">Ver histórico</Link></div>
        {!recent ? <p className="muted">Carregando…</p> : recent.length === 0 ? <p className="muted">Nenhuma escala ainda.</p> : (
          <ul className="list">
            {recent.map((r) => (
              <li key={r.id}>
                <Link to={`/escala?sabado=${r.saturday}`}>
                  <span className="list-date"><Icon.calendar /> {fmtDate(r.saturday)} – {fmtDate(r.sunday)}</span>
                  <span className="muted small">{r.entryCount} serviços{r.openCount ? ` · ${r.openCount} incompletos` : ''}</span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ to, icon, label, value }: { to: string; icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Link to={to} className="stat card">
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </Link>
  );
}
