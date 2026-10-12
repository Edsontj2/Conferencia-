import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCached } from '../api';
import { useApp } from '../state';
import { PageHeader } from '../components/PageHeader';
import { Empty, Field, fmtDateTime, StatusBadge } from '../components/ui';
import type { ScheduleMeta } from '../types';
import type { Entry } from '../../shared/types';
import { addDays, dayLabel, fmtDate, todayLocal } from '../../shared/time';

type Row = Entry & { scheduleId: number; status: string; saturday: string };

export function HistoricoPage() {
  const { catalog } = useApp();
  const [tab, setTab] = useState<'escalas' | 'participacoes'>('escalas');
  const [from, setFrom] = useState(addDays(todayLocal(), -90));
  const [to, setTo] = useState(addDays(todayLocal(), 30));
  const [status, setStatus] = useState('');
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState('');
  const [lineCode, setLineCode] = useState('');
  const [schedules, setSchedules] = useState<ScheduleMeta[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (tab === 'escalas') {
      if (status) qs.set('status', status);
      getCached<ScheduleMeta[]>(`/api/schedules?${qs}`).then((r) => setSchedules(r.data)).catch((e) => setErr(e.message));
    } else {
      qs.set('status', status || 'confirmada');
      if (personId) qs.set('personId', personId);
      if (role) qs.set('role', role);
      if (lineCode) qs.set('lineCode', lineCode);
      getCached<Row[]>(`/api/history?${qs}`).then((r) => setRows(r.data)).catch((e) => setErr(e.message));
    }
  }, [tab, from, to, status, personId, role, lineCode]);

  const people = (catalog?.people ?? []).filter((p) => !role || p.role === role);
  const lineCodes = [...new Set((catalog?.lines ?? []).map((l) => l.code))];
  const pid = Number(personId);

  return (
    <div>
      <PageHeader title="Histórico" subtitle="Escalas anteriores e participações, com filtros por data, pessoa, função e linha" />
      <div className="tabs">
        <button className={tab === 'escalas' ? 'active' : ''} onClick={() => setTab('escalas')}>Escalas</button>
        <button className={tab === 'participacoes' ? 'active' : ''} onClick={() => setTab('participacoes')}>Participações</button>
      </div>
      <div className="filters">
        <Field label="De"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {tab === 'escalas' ? <option value="">Todos</option> : <option value="">Confirmadas</option>}
            {tab === 'participacoes' && <option value="todas">Todas</option>}
            <option value="rascunho">Rascunho</option>{tab === 'escalas' && <option value="confirmada">Confirmada</option>}<option value="cancelada">Cancelada</option>
          </select>
        </Field>
        {tab === 'participacoes' && <>
          <Field label="Função"><select value={role} onChange={(e) => { setRole(e.target.value); setPersonId(''); }}><option value="">Todas</option><option value="motorista">Motorista</option><option value="cobrador">Cobrador</option></select></Field>
          <Field label="Pessoa"><select value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">Todas</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inativo)'}</option>)}</select></Field>
          <Field label="Linha"><select value={lineCode} onChange={(e) => setLineCode(e.target.value)}><option value="">Todas</option>{lineCodes.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        </>}
      </div>
      {err && <div className="alert alert-err">{err}</div>}
      {tab === 'escalas' && schedules && (schedules.length === 0 ? <Empty>Nenhuma escala no período.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Sábado</th><th>Domingo</th><th>Status</th><th>Serviços</th><th>Vagas abertas</th><th>Atualizada</th><th></th></tr></thead>
          <tbody>{schedules.map((s) => (
            <tr key={s.id}>
              <td>{fmtDate(s.saturday)}</td><td>{fmtDate(s.sunday)}</td><td><StatusBadge status={s.status} />{s.cancelReason ? <span className="muted small"> {s.cancelReason}</span> : null}</td>
              <td>{s.entryCount}</td><td>{s.openCount || ''}</td><td className="nowrap">{fmtDateTime(s.updatedAt)}</td>
              <td className="actions">{s.status !== 'cancelada' && <><Link className="btn btn-sm" to={`/escala?sabado=${s.saturday}`}>Abrir</Link><Link className="btn btn-sm" to={`/relatorio?sabado=${s.saturday}`}>Relatório</Link></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      {tab === 'participacoes' && rows && (rows.length === 0 ? <Empty>Nenhum registro com esses filtros.</Empty> : (
        <>
          <p className="muted small">{rows.length} registro(s). Os nomes, linhas e carros são os gravados em cada escala (preservados mesmo se o cadastro mudar).</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Data</th><th>Turno</th><th>Horário</th><th>Linha</th><th>Carro</th><th>Placa</th><th>Motorista</th><th>Cobrador</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{dayLabel(r.date)} {fmtDate(r.date)}</td><td>{r.shiftName}</td><td className="nowrap">{r.startTime}–{r.endTime}</td>
                <td>{r.lineCode}</td><td>{r.busFleet}</td><td className="muted">{r.busPlate}</td>
                <td className={pid && r.driverId === pid ? 'strong' : ''}>{r.driverName || '—'}</td>
                <td className={pid && r.conductorId === pid ? 'strong' : ''}>{r.conductorName || '—'}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      ))}
    </div>
  );
}
