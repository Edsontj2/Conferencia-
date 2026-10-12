import { useMemo, useState } from 'react';
import { send } from '../api';
import { useApp } from '../state';
import { ActiveBadge, Empty, Field } from '../components/ui';
import { SimpleForm } from './Linhas';
import type { Service } from '../../shared/types';
import { serviceBusConflicts } from '../../shared/rules';
import { crossesMidnight } from '../../shared/time';

type Form = Omit<Service, 'id' | 'lineId' | 'busId'> & { id?: number; lineId: number | ''; busId: number | '' | null };

export function ServicosPage() {
  const { catalog, reloadCatalog, toast, online } = useApp();
  const [day, setDay] = useState<'' | '6' | '0'>('');
  const [lineF, setLineF] = useState('');
  const [status, setStatus] = useState('ativos');
  const [edit, setEdit] = useState<Form | null>(null);

  const lines = useMemo(() => new Map((catalog?.lines ?? []).map((l) => [l.id, l])), [catalog]);
  const buses = useMemo(() => new Map((catalog?.buses ?? []).map((b) => [b.id, b])), [catalog]);
  const list = useMemo(() => (catalog?.services ?? []).filter((s) =>
    (!day || String(s.weekday) === day) && (!lineF || String(s.lineId) === lineF) && (status === 'todos' || (status === 'ativos') === s.active),
  ), [catalog, day, lineF, status]);
  if (!catalog) return <p>Carregando…</p>;

  const conflictWith = (f: Form) => {
    if (f.lineId === '' || f.busId === '' || f.busId == null || !f.active) return null;
    const cand = { ...f, id: f.id ?? -1, lineId: f.lineId, busId: f.busId };
    const others = catalog.services.filter((s) => s.id !== f.id);
    const c = serviceBusConflicts([...others, cand]).find(([a, b]) => a.id === cand.id || b.id === cand.id);
    if (!c) return null;
    const o = c[0].id === cand.id ? c[1] : c[0];
    return `Este carro já está em outro serviço ativo com horário sobreposto: ${o.weekday === 6 ? 'sábado' : 'domingo'} ${o.startTime}–${o.endTime}.`;
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); await reloadCatalog(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const payload = (s: Form | Service) => ({ weekday: s.weekday, lineId: Number(s.lineId), busId: s.busId === '' || s.busId == null ? null : Number(s.busId), startTime: s.startTime, endTime: s.endTime, shiftName: s.shiftName, active: s.active });

  return (
    <div>
      <div className="page-head">
        <h1>Serviços do fim de semana</h1>
        <button className="btn btn-primary" disabled={!online} onClick={() => setEdit({ weekday: 6, lineId: '', busId: '', startTime: '05:00', endTime: '11:00', shiftName: '', active: true })}>+ Novo serviço</button>
      </div>
      <p className="muted">Cada serviço é uma vaga (motorista + cobrador) e funciona como modelo reutilizado em todos os fins de semana.</p>
      <div className="filters">
        <select value={day} onChange={(e) => setDay(e.target.value as typeof day)} aria-label="Dia"><option value="">Sábado e domingo</option><option value="6">Sábado</option><option value="0">Domingo</option></select>
        <select value={lineF} onChange={(e) => setLineF(e.target.value)} aria-label="Linha"><option value="">Todas as linhas</option>{catalog.lines.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="todos">Todos</option></select>
        <span className="muted">{list.length} serviço(s)</span>
      </div>
      {list.length === 0 ? <Empty>Nenhum serviço. Cadastre linhas e ônibus e depois os serviços de sábado e domingo.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Dia</th><th>Turno</th><th>Saída</th><th>Rendição</th><th>Linha</th><th>Carro</th><th>Situação</th><th></th></tr></thead>
          <tbody>{list.map((s) => {
            const l = lines.get(s.lineId), b = s.busId == null ? undefined : buses.get(s.busId);
            return (
              <tr key={s.id} className={s.active ? '' : 'row-off'}>
                <td>{s.weekday === 6 ? 'Sábado' : 'Domingo'}</td><td>{s.shiftName}</td><td>{s.startTime}</td>
                <td className="nowrap">{s.endTime}{crossesMidnight(s.startTime, s.endTime) ? ' (+1)' : ''}</td>
                <td>{l?.code}{l && !l.active ? ' (inativa)' : ''}</td>
                <td>{b ? b.fleetNumber : <span className="muted">a definir</span>}{b && !b.active ? ' (inativo)' : ''}</td>
                <td><ActiveBadge active={s.active} /></td>
                <td className="actions">
                  <button className="btn btn-sm" disabled={!online} onClick={() => setEdit({ ...s })}>Editar</button>
                  <button className="btn btn-sm" disabled={!online} onClick={() => setEdit({ ...s, id: undefined })}>Duplicar</button>
                  <button className="btn btn-sm" disabled={!online} onClick={() => void act(() => send('PUT', `/api/services/${s.id}`, payload({ ...s, active: !s.active })), 'Situação alterada.')}>{s.active ? 'Inativar' : 'Reativar'}</button>
                  <button className="btn btn-sm btn-danger-ghost" disabled={!online} onClick={() => { if (confirm('Excluir este serviço-modelo? Escalas já geradas não são afetadas.')) void act(() => send('DELETE', `/api/services/${s.id}`), 'Serviço excluído.'); }}>Excluir</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {edit && (
        <SimpleForm title={edit.id ? 'Editar serviço' : 'Novo serviço'} onClose={() => setEdit(null)} onSave={async () => {
          if (edit.lineId === '') throw new Error('Escolha a linha.');
          if (!edit.shiftName.trim()) throw new Error('Informe o turno.');
          if (edit.startTime === edit.endTime) throw new Error('Saída e término não podem ser iguais.');
          const c = conflictWith(edit);
          if (c) throw new Error(c);
          if (edit.id) await send('PUT', `/api/services/${edit.id}`, payload(edit)); else await send('POST', '/api/services', payload(edit));
          toast('Serviço salvo.'); setEdit(null); await reloadCatalog();
        }}>
          <Field label="Dia da semana"><select value={edit.weekday} onChange={(e) => setEdit({ ...edit, weekday: Number(e.target.value) as 0 | 6 })}><option value={6}>Sábado</option><option value={0}>Domingo</option></select></Field>
          <Field label="Linha"><select value={edit.lineId} onChange={(e) => setEdit({ ...edit, lineId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Selecione…</option>
            {catalog.lines.filter((l) => l.active || l.id === edit.lineId).map((l) => <option key={l.id} value={l.id}>{l.code}{l.description ? ` – ${l.description}` : ''}</option>)}
          </select></Field>
          <Field label="Ônibus (carro)" hint="Pode ficar a definir; aparece como aviso na escala."><select value={edit.busId ?? ''} onChange={(e) => setEdit({ ...edit, busId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— a definir —</option>
            {catalog.buses.filter((b) => b.active || b.id === edit.busId).map((b) => <option key={b.id} value={b.id}>{b.fleetNumber}{b.plate ? ` – ${b.plate}` : ''}</option>)}
          </select></Field>
          <div className="field-row">
            <Field label="Saída"><input type="time" value={edit.startTime} onChange={(e) => setEdit({ ...edit, startTime: e.target.value })} /></Field>
            <Field label="Término / rendição" hint={crossesMidnight(edit.startTime, edit.endTime) ? 'Termina no dia seguinte' : undefined}><input type="time" value={edit.endTime} onChange={(e) => setEdit({ ...edit, endTime: e.target.value })} /></Field>
          </div>
          <Field label="Turno"><input value={edit.shiftName} onChange={(e) => setEdit({ ...edit, shiftName: e.target.value })} list="shift-names" placeholder="Ex.: Manhã" maxLength={60} /></Field>
          <datalist id="shift-names">{[...new Set([...catalog.services.map((s) => s.shiftName), ...catalog.people.map((p) => p.shiftName)])].map((s) => <option key={s} value={s} />)}</datalist>
          <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Ativo</label>
          {conflictWith(edit) && <div className="alert alert-err">{conflictWith(edit)}</div>}
        </SimpleForm>
      )}
    </div>
  );
}
