import { useMemo, useState } from 'react';
import { send } from '../api';
import { useApp } from '../state';
import { ActiveBadge, Empty, Field, Modal } from '../components/ui';
import type { Bus, Line } from '../../shared/types';

export function LinhasPage() {
  const { catalog, reloadCatalog, toast, online } = useApp();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Line> | null>(null);
  const list = useMemo(() => (catalog?.lines ?? []).filter((l) => {
    const t = q.trim().toLowerCase();
    return !t || l.code.toLowerCase().includes(t) || (l.description ?? '').toLowerCase().includes(t);
  }).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })), [catalog, q]);
  if (!catalog) return <p>Carregando…</p>;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); await reloadCatalog(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <div className="page-head"><h1>Linhas</h1><button className="btn btn-primary" disabled={!online} onClick={() => setEdit({ code: '', description: '', active: true })}>+ Nova linha</button></div>
      <div className="filters"><input type="search" placeholder="Pesquisar código ou itinerário" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.length === 0 ? <Empty>Nenhuma linha cadastrada.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Código</th><th>Descrição / itinerário</th><th>Situação</th><th>Uso em escalas</th><th></th></tr></thead>
          <tbody>{list.map((l) => {
            const used = catalog.usage.lines[l.id] ?? 0;
            return (
              <tr key={l.id} className={l.active ? '' : 'row-off'}>
                <td className="strong">{l.code}</td><td>{l.description}</td><td><ActiveBadge active={l.active} /></td><td>{used}</td>
                <td className="actions">
                  <button className="btn btn-sm" disabled={!online} onClick={() => setEdit(l)}>Editar</button>
                  <button className="btn btn-sm" disabled={!online} onClick={() => void act(() => send('PUT', `/api/lines/${l.id}`, { ...l, active: !l.active }), 'Situação alterada.')}>{l.active ? 'Inativar' : 'Reativar'}</button>
                  {used === 0 && <button className="btn btn-sm btn-danger-ghost" disabled={!online} onClick={() => { if (confirm(`Excluir a linha ${l.code}?`)) void act(() => send('DELETE', `/api/lines/${l.id}`), 'Linha excluída.'); }}>Excluir</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {edit && (
        <SimpleForm title={edit.id ? 'Editar linha' : 'Nova linha'} onClose={() => setEdit(null)}
          onSave={async () => {
            const body = { code: edit.code ?? '', description: edit.description || null, active: edit.active ?? true };
            if (edit.id) await send('PUT', `/api/lines/${edit.id}`, body); else await send('POST', '/api/lines', body);
            toast('Linha salva.'); setEdit(null); await reloadCatalog();
          }}>
          <Field label="Código da linha" hint="Ex.: 0.783 ou 141.8"><input value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} maxLength={30} /></Field>
          <Field label="Descrição / itinerário (opcional)"><input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={200} /></Field>
          <label className="check"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Ativa</label>
        </SimpleForm>
      )}
    </div>
  );
}

export function OnibusPage() {
  const { catalog, reloadCatalog, toast, online } = useApp();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Bus> | null>(null);
  const list = useMemo(() => (catalog?.buses ?? []).filter((b) => {
    const t = q.trim().toLowerCase();
    return !t || b.fleetNumber.toLowerCase().includes(t) || b.plate.toLowerCase().includes(t);
  }).sort((a, b) => a.fleetNumber.localeCompare(b.fleetNumber, 'pt-BR', { numeric: true })), [catalog, q]);
  if (!catalog) return <p>Carregando…</p>;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); await reloadCatalog(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <div className="page-head"><h1>Ônibus</h1><button className="btn btn-primary" disabled={!online} onClick={() => setEdit({ fleetNumber: '', plate: '', active: true })}>+ Novo ônibus</button></div>
      <div className="filters"><input type="search" placeholder="Pesquisar carro ou placa" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.length === 0 ? <Empty>Nenhum ônibus cadastrado.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Carro (frota)</th><th>Placa</th><th>Situação</th><th>Uso em escalas</th><th></th></tr></thead>
          <tbody>{list.map((b) => {
            const used = catalog.usage.buses[b.id] ?? 0;
            return (
              <tr key={b.id} className={b.active ? '' : 'row-off'}>
                <td className="strong">{b.fleetNumber}</td><td>{b.plate}</td><td><ActiveBadge active={b.active} /></td><td>{used}</td>
                <td className="actions">
                  <button className="btn btn-sm" disabled={!online} onClick={() => setEdit(b)}>Editar</button>
                  <button className="btn btn-sm" disabled={!online} onClick={() => void act(() => send('PUT', `/api/buses/${b.id}`, { ...b, active: !b.active }), 'Situação alterada.')}>{b.active ? 'Inativar' : 'Reativar'}</button>
                  {used === 0 && <button className="btn btn-sm btn-danger-ghost" disabled={!online} onClick={() => { if (confirm(`Excluir o carro ${b.fleetNumber}?`)) void act(() => send('DELETE', `/api/buses/${b.id}`), 'Ônibus excluído.'); }}>Excluir</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {edit && (
        <SimpleForm title={edit.id ? 'Editar ônibus' : 'Novo ônibus'} onClose={() => setEdit(null)}
          onSave={async () => {
            const body = { fleetNumber: edit.fleetNumber ?? '', plate: (edit.plate ?? '').toUpperCase(), active: edit.active ?? true };
            if (edit.id) await send('PUT', `/api/buses/${edit.id}`, body); else await send('POST', '/api/buses', body);
            toast('Ônibus salvo.'); setEdit(null); await reloadCatalog();
          }}>
          <Field label="Número de frota (carro)"><input value={edit.fleetNumber ?? ''} onChange={(e) => setEdit({ ...edit, fleetNumber: e.target.value })} maxLength={20} /></Field>
          <Field label="Placa" hint="Ex.: ABC1D23 ou ABC-1234"><input value={edit.plate ?? ''} onChange={(e) => setEdit({ ...edit, plate: e.target.value.toUpperCase() })} maxLength={8} /></Field>
          <label className="check"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Ativo</label>
        </SimpleForm>
      )}
    </div>
  );
}

export function SimpleForm({ title, onClose, onSave, children }: { title: string; onClose: () => void; onSave: () => Promise<void>; children: React.ReactNode }) {
  const { online } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={busy || !online} onClick={async () => {
        setBusy(true); setErr(null);
        try { await onSave(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>Salvar</button>
    </>}>
      <div className="form-grid">{children}</div>
      {err && <div className="alert alert-err">{err}</div>}
    </Modal>
  );
}
