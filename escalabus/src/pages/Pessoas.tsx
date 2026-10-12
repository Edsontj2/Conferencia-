import { useMemo, useState } from 'react';
import { ApiError, send } from '../api';
import { useApp } from '../state';
import { ActiveBadge, Empty, Field, Modal } from '../components/ui';
import type { Person } from '../../shared/types';
import { ROLE_LABEL } from '../../shared/types';
import { formatPhone, phoneProblem } from '../../shared/whatsapp';
import { crossesMidnight } from '../../shared/time';

type Form = Omit<Person, 'id'> & { id?: number };
const blank: Form = { name: '', role: 'motorista', shiftName: '', availStart: '05:00', availEnd: '13:00', whatsapp: '', active: true };

export function PessoasPage() {
  const { catalog, reloadCatalog, toast, online } = useApp();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('ativos');
  const [edit, setEdit] = useState<Form | null>(null);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (catalog?.people ?? []).filter((p) =>
      (!t || p.name.toLowerCase().includes(t) || p.shiftName.toLowerCase().includes(t) || (p.whatsapp ?? '').includes(t.replace(/\D/g, '') || '§')) &&
      (!role || p.role === role) && (status === 'todos' || (status === 'ativos') === p.active));
  }, [catalog, q, role, status]);

  if (!catalog) return <p>Carregando…</p>;

  const toggle = async (p: Person) => {
    try {
      await send('PUT', `/api/people/${p.id}`, { ...p, active: !p.active });
      toast(p.active ? 'Pessoa inativada.' : 'Pessoa reativada.');
      await reloadCatalog();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const remove = async (p: Person) => {
    if (!confirm(`Excluir definitivamente ${p.name}? Só é possível porque nunca participou de escalas.`)) return;
    try { await send('DELETE', `/api/people/${p.id}`); toast('Pessoa excluída.'); await reloadCatalog(); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Pessoas</h1>
        <button className="btn btn-primary" disabled={!online} onClick={() => setEdit({ ...blank })}>+ Nova pessoa</button>
      </div>
      <div className="filters">
        <input type="search" placeholder="Pesquisar nome, turno ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Função">
          <option value="">Todas as funções</option><option value="motorista">Motoristas</option><option value="cobrador">Cobradores</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="todos">Todos</option>
        </select>
        <span className="muted">{list.length} registro(s)</span>
      </div>
      {list.length === 0 ? <Empty>Nenhuma pessoa encontrada.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>Função</th><th>Turno</th><th>Disponível</th><th>WhatsApp</th><th>Situação</th><th>Escalas</th><th></th></tr></thead>
            <tbody>
              {list.map((p) => {
                const used = catalog.usage.people[p.id] ?? 0;
                return (
                  <tr key={p.id} className={p.active ? '' : 'row-off'}>
                    <td>{p.name}</td>
                    <td>{ROLE_LABEL[p.role]}</td>
                    <td>{p.shiftName}</td>
                    <td className="nowrap">{p.availStart === p.availEnd ? '24 horas' : `${p.availStart}–${p.availEnd}${crossesMidnight(p.availStart, p.availEnd) ? ' (+1)' : ''}`}</td>
                    <td className="nowrap">{formatPhone(p.whatsapp)}</td>
                    <td><ActiveBadge active={p.active} /></td>
                    <td>{used}</td>
                    <td className="actions">
                      <button className="btn btn-sm" disabled={!online} onClick={() => setEdit({ ...p, whatsapp: p.whatsapp ?? '' })}>Editar</button>
                      <button className="btn btn-sm" disabled={!online} onClick={() => void toggle(p)}>{p.active ? 'Inativar' : 'Reativar'}</button>
                      {used === 0 && <button className="btn btn-sm btn-danger-ghost" disabled={!online} onClick={() => void remove(p)}>Excluir</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Pessoas que já participaram de escalas não podem ser excluídas — inative-as. O histórico guarda o nome usado em cada escala.</p>
      {edit && <PersonForm initial={edit} used={edit.id ? (catalog.usage.people[edit.id] ?? 0) > 0 : false} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reloadCatalog(); }} />}
    </div>
  );
}

function PersonForm({ initial, used, onClose, onSaved }: { initial: Form; used: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast, online } = useApp();
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const phoneErr = f.whatsapp ? phoneProblem(f.whatsapp) : null;

  const save = async () => {
    setErr(null);
    if (f.name.trim().length < 3) { setErr('Informe o nome completo.'); return; }
    if (!f.shiftName.trim()) { setErr('Informe o nome do turno.'); return; }
    if (phoneErr) { setErr(phoneErr); return; }
    setBusy(true);
    try {
      const body = { name: f.name, role: f.role, shiftName: f.shiftName, availStart: f.availStart, availEnd: f.availEnd, whatsapp: f.whatsapp || null, active: f.active };
      if (f.id) await send('PUT', `/api/people/${f.id}`, body); else await send('POST', '/api/people', body);
      toast('Pessoa salva.');
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={f.id ? 'Editar pessoa' : 'Nova pessoa'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !online} onClick={() => void save()}>Salvar</button></>}>
      <div className="form-grid">
        <Field label="Nome completo"><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} autoComplete="off" /></Field>
        <Field label="Função" hint={used ? 'Já usada em escalas: não pode mudar.' : undefined}>
          <select value={f.role} disabled={used} onChange={(e) => set('role', e.target.value as Form['role'])}>
            <option value="motorista">Motorista</option><option value="cobrador">Cobrador</option>
          </select>
        </Field>
        <Field label="Nome do turno"><input value={f.shiftName} onChange={(e) => set('shiftName', e.target.value)} placeholder="Ex.: Manhã" maxLength={60} /></Field>
        <div className="field-row">
          <Field label="Horário inicial"><input type="time" value={f.availStart} onChange={(e) => set('availStart', e.target.value)} /></Field>
          <Field label="Horário final"><input type="time" value={f.availEnd} onChange={(e) => set('availEnd', e.target.value)} /></Field>
        </div>
        <p className="field-hint">
          O serviço inteiro precisa caber neste horário. Final menor que o inicial = atravessa a meia-noite (ex.: 18:00–01:00). Inicial igual ao final = disponível 24 horas.
        </p>
        <Field label="WhatsApp (opcional)" error={phoneErr} hint="Com código do país e DDD. Ex.: +55 11 98765-4321">
          <input type="tel" inputMode="tel" value={f.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} placeholder="+55 11 98765-4321" />
        </Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Ativo(a)</label>
      </div>
      {err && <div className="alert alert-err">{err}</div>}
    </Modal>
  );
}
