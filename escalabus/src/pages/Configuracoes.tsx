import { useEffect, useState } from 'react';
import { get, send } from '../api';
import { useApp } from '../state';
import { Empty, Field, fmtDateTime, Modal } from '../components/ui';
import { InstallButton, IosInstructions } from '../components/InstallButton';
import { SimpleForm } from './Linhas';
import type { Recipient } from '../../shared/types';
import { formatPhone, phoneProblem } from '../../shared/whatsapp';

interface BackupCheck { ok: boolean; errors: string[]; counts: Record<string, number>; exportedAt?: string; mode?: string }

export function ConfiguracoesPage() {
  const { catalog, reloadCatalog, toast, online, me, switchMode, refreshMe } = useApp();
  const [company, setCompany] = useState<string | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [rec, setRec] = useState<Partial<Recipient> | null>(null);
  const [imp, setImp] = useState<{ data: unknown; check: BackupCheck; name: string } | null>(null);
  const [ios, setIos] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  if (!catalog) return <p>Carregando…</p>;
  const s = catalog.settings;

  const saveSettings = async () => {
    try {
      await send('PUT', '/api/settings', { companyName: (company ?? s.companyName).trim(), maxServicesPerDay: limit ?? s.maxServicesPerDay });
      toast('Configurações salvas.'); setCompany(null); setLimit(null); await reloadCatalog();
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  const exportBackup = () => { window.location.href = '/api/backup/export'; };
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const check = await send<BackupCheck>('POST', '/api/backup/validate', data);
      setImp({ data, check, name: f.name });
    } catch (e) { toast(e instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : (e as Error).message, 'err'); }
  };

  return (
    <div>
      <div className="page-head"><h1>Configurações</h1></div>

      <section className="card">
        <h2>Geral</h2>
        <div className="form-grid two">
          <Field label="Nome da empresa (aparece nos relatórios)"><input value={company ?? s.companyName} onChange={(e) => setCompany(e.target.value)} maxLength={120} /></Field>
          <Field label="Limite de serviços por pessoa por dia" hint="Padrão 1. Com valor maior, sobreposição e disponibilidade continuam sendo validadas.">
            <input type="number" min={1} max={5} value={limit ?? s.maxServicesPerDay} onChange={(e) => setLimit(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
          </Field>
        </div>
        <button className="btn btn-primary" disabled={!online || (company === null && limit === null)} onClick={() => void saveSettings()}>Salvar</button>
      </section>

      <section className="card">
        <div className="page-head"><h2>Destinatários do WhatsApp</h2><button className="btn btn-sm" disabled={!online} onClick={() => setRec({ name: '', phone: '' })}>+ Novo destinatário</button></div>
        {catalog.recipients.length === 0 ? <Empty>Nenhum destinatário cadastrado.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Nome</th><th>WhatsApp</th><th></th></tr></thead>
            <tbody>{catalog.recipients.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td>{formatPhone(r.phone)}</td>
                <td className="actions">
                  <button className="btn btn-sm" disabled={!online} onClick={() => setRec(r)}>Editar</button>
                  <button className="btn btn-sm btn-danger-ghost" disabled={!online} onClick={async () => { if (!confirm(`Excluir ${r.name}?`)) return; try { await send('DELETE', `/api/recipients/${r.id}`); await reloadCatalog(); } catch (e) { toast((e as Error).message, 'err'); } }}>Excluir</button>
                </td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Backup</h2>
        <p className="muted">O backup contém cadastros, escalas, histórico e registro de alterações do modo atual ({me?.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'dados reais'}). Senhas não são exportadas.</p>
        <div className="actionbar">
          <button className="btn" onClick={exportBackup} disabled={!online}>⬇ Exportar backup (.json)</button>
          <label className={`btn ${!online ? 'disabled' : ''}`}>
            ⬆ Importar backup…
            <input type="file" accept="application/json,.json" hidden disabled={!online} onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Modo de demonstração</h2>
        <p className="muted">O modo demonstração usa um banco de dados separado, com dados fictícios claramente identificados. Nada do que é feito nele afeta os dados reais.</p>
        <div className="actionbar">
          {me?.mode === 'demo'
            ? <button className="btn btn-primary" disabled={!online} onClick={() => void switchMode('real').then(() => toast('Voltou aos dados reais.'))}>Voltar aos dados reais</button>
            : <button className="btn" disabled={!online} onClick={() => void switchMode('demo').then(() => toast('Modo demonstração ativado.'))}>Entrar no modo demonstração</button>}
          {me?.mode === 'demo' && <button className="btn btn-danger-ghost" disabled={!online} onClick={async () => { if (!confirm('Recriar todos os dados fictícios da demonstração?')) return; await send('POST', '/api/demo/reset'); await reloadCatalog(); toast('Demonstração reiniciada.'); }}>Reiniciar dados da demonstração</button>}
        </div>
      </section>

      <section className="card">
        <h2>Aplicativo</h2>
        <div className="actionbar"><InstallButton /><button className="btn btn-ghost" onClick={() => setIos(true)}>Como instalar no iPhone</button></div>
        <p className="muted small">Instalado ou não, a última escala e os cadastros carregados ficam disponíveis para consulta sem internet. Alterações exigem conexão com o servidor.</p>
      </section>

      {me?.isAdmin && <UsersSection />}

      <section className="card" id="minha-senha">
        <h2>Minha senha ({me?.username})</h2>
        {me?.mustChange && <div className="alert alert-warn">Você ainda está com a senha padrão. Defina uma senha nova.</div>}
        <div className="form-grid three">
          <Field label="Senha atual"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nova senha (mín. 6)"><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Repita a nova senha" error={pw.again && pw.again !== pw.next ? 'Não confere.' : null}><input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
        </div>
        <button className="btn btn-primary" disabled={!online || !pw.current || pw.next.length < 6 || pw.next !== pw.again} onClick={async () => {
          try {
            await send('POST', '/api/auth/password', { current: pw.current, next: pw.next });
            setPw({ current: '', next: '', again: '' });
            await refreshMe();
            toast('Senha alterada. Outras sessões foram encerradas.');
          } catch (e) { toast((e as Error).message, 'err'); }
        }}>Alterar minha senha</button>
      </section>

      {rec && (
        <SimpleForm title={rec.id ? 'Editar destinatário' : 'Novo destinatário'} onClose={() => setRec(null)} onSave={async () => {
          const p = phoneProblem(rec.phone);
          if (p) throw new Error(p);
          const body = { name: rec.name ?? '', phone: rec.phone ?? '' };
          if (rec.id) await send('PUT', `/api/recipients/${rec.id}`, body); else await send('POST', '/api/recipients', body);
          toast('Destinatário salvo.'); setRec(null); await reloadCatalog();
        }}>
          <Field label="Nome"><input value={rec.name ?? ''} onChange={(e) => setRec({ ...rec, name: e.target.value })} /></Field>
          <Field label="WhatsApp (país + DDD + número)" error={rec.phone ? phoneProblem(rec.phone) : null}><input type="tel" value={rec.phone ?? ''} onChange={(e) => setRec({ ...rec, phone: e.target.value })} placeholder="+55 11 98765-4321" /></Field>
        </SimpleForm>
      )}
      {imp && <ImportDialog imp={imp} onClose={() => setImp(null)} onDone={async () => { setImp(null); await reloadCatalog(); }} />}
      {ios && <IosInstructions onClose={() => setIos(false)} />}
    </div>
  );
}

const TABLE_LABEL: Record<string, string> = {
  people: 'Pessoas', lines: 'Linhas', buses: 'Ônibus', services: 'Serviços', recipients: 'Destinatários',
  schedules: 'Escalas', schedule_entries: 'Registros de escala', schedule_audit: 'Registro de alterações', settings: 'Configurações',
};

function ImportDialog({ imp, onClose, onDone }: { imp: { data: unknown; check: BackupCheck; name: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast, me } = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const { check } = imp;
  return (
    <Modal title="Importar backup" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      {check.ok && <button className="btn btn-danger" disabled={typed !== 'SUBSTITUIR' || busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await send<{ safetyCopy: string | null }>('POST', '/api/backup/import', { data: imp.data, confirm: 'SUBSTITUIR' });
          toast(`Backup importado.${r.safetyCopy ? ` Cópia dos dados anteriores salva no servidor: ${r.safetyCopy}` : ''}`);
          await onDone();
        } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
      }}>Substituir dados</button>}
    </>}>
      <p>Arquivo: <strong>{imp.name}</strong>{check.exportedAt ? ` · exportado em ${new Date(check.exportedAt).toLocaleString('pt-BR')}` : ''}{check.mode ? ` · origem: ${check.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'dados reais'}` : ''}</p>
      {check.ok ? <div className="alert alert-ok">Backup válido.</div> : (
        <div className="alert alert-err"><strong>Backup inválido — importação bloqueada:</strong><ul>{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
      )}
      <ul className="counts">{Object.entries(check.counts).map(([k, v]) => <li key={k}>{TABLE_LABEL[k] ?? k}: <strong>{v}</strong></li>)}</ul>
      {check.ok && <>
        {check.mode && check.mode !== me?.mode && <div className="alert alert-warn">Atenção: o backup veio do modo {check.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'real'} e será importado no modo {me?.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'real'}.</div>}
        <div className="alert alert-warn">TODOS os dados atuais do modo {me?.mode === 'demo' ? 'demonstração' : 'real'} serão SUBSTITUÍDOS. O servidor guarda uma cópia automática antes da importação.</div>
        <Field label='Digite SUBSTITUIR para confirmar'><input value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
      </>}
    </Modal>
  );
}

interface UserRow { id: number; username: string; isAdmin: boolean; mustChange: boolean; createdAt: string; self: boolean }

/** Painel de acessos: o administrador cria logins, redefine senhas, define quem é administrador e exclui acessos. */
function UsersSection() {
  const { toast, online } = useApp();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState({ username: '', password: '', isAdmin: false });
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [newPw, setNewPw] = useState('');
  const load = async () => { try { setUsers(await get<UserRow[]>('/api/users')); } catch (e) { toast((e as Error).message, 'err'); } };
  useEffect(() => { void load(); }, []); // eslint-disable-line
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); await load(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <section className="card">
      <h2>Usuários e acessos</h2>
      <p className="muted small">Crie um login e senha para cada pessoa que vai usar o sistema. <strong>Administrador</strong> também pode gerenciar os acessos; <strong>Operador</strong> usa todo o resto (escalas, cadastros, relatórios).</p>
      <div className="form-grid three">
        <Field label="Login"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} autoComplete="off" autoCapitalize="none" placeholder="ex.: maria" /></Field>
        <Field label="Senha (mín. 6)"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Tipo de acesso">
          <select value={form.isAdmin ? 'admin' : 'op'} onChange={(e) => setForm({ ...form, isAdmin: e.target.value === 'admin' })}>
            <option value="op">Operador</option><option value="admin">Administrador</option>
          </select>
        </Field>
      </div>
      <div className="actionbar">
        <button className="btn btn-primary" disabled={!online || form.username.length < 3 || form.password.length < 6}
          onClick={() => void act(async () => { await send('POST', '/api/users', form); setForm({ username: '', password: '', isAdmin: false }); }, 'Acesso criado.')}>+ Criar acesso</button>
      </div>
      {!users ? <p>Carregando…</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Login</th><th>Tipo</th><th>Criado em</th><th></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td className="strong">{u.username}{u.self ? ' (você)' : ''}{u.mustChange ? <span className="badge badge-rascunho" style={{ marginLeft: 6 }}>senha padrão</span> : null}</td>
              <td>{u.isAdmin ? 'Administrador' : 'Operador'}</td>
              <td className="nowrap">{fmtDateTime(u.createdAt)}</td>
              <td className="actions">
                <button className="btn btn-sm" disabled={!online} onClick={() => { setResetFor(u); setNewPw(''); }}>Redefinir senha</button>
                {!u.self && <button className="btn btn-sm" disabled={!online} onClick={() => void act(() => send('PUT', `/api/users/${u.id}`, { isAdmin: !u.isAdmin }), 'Tipo de acesso alterado.')}>{u.isAdmin ? 'Tornar operador' : 'Tornar administrador'}</button>}
                {!u.self && <button className="btn btn-sm btn-danger-ghost" disabled={!online} onClick={() => { if (confirm(`Excluir o acesso "${u.username}"?`)) void act(() => send('DELETE', `/api/users/${u.id}`), 'Acesso excluído.'); }}>Excluir</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {resetFor && (
        <Modal title={`Nova senha para ${resetFor.username}`} onClose={() => setResetFor(null)} footer={<>
          <button className="btn" onClick={() => setResetFor(null)}>Cancelar</button>
          <button className="btn btn-primary" disabled={newPw.length < 6 || !online} onClick={() => {
            const u = resetFor; setResetFor(null);
            void act(() => send('POST', `/api/users/${u.id}/password`, { password: newPw }), `Senha de ${u.username} redefinida.`);
          }}>Salvar senha</button>
        </>}>
          <Field label="Nova senha (mín. 6)"><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></Field>
          <p className="muted small">As sessões abertas desse usuário em outros aparelhos serão encerradas.</p>
        </Modal>
      )}
    </section>
  );
}
