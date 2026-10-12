import { useState } from 'react';
import { useApp } from '../state';
import { Field } from '../components/ui';
import { InstallButton } from '../components/InstallButton';

export function LoginPage() {
  const { login, online } = useApp();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await login(u, p); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <div className="login-brand"><img src="/icons/icon-192.png" alt="" width={48} height={48} /><div><h1>EscalaBus</h1><p className="muted">Escalas de fim de semana</p></div></div>
        {!online && <div className="alert alert-warn">Sem conexão com o servidor. É preciso estar online para entrar.</div>}
        <Field label="Usuário"><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" required /></Field>
        <Field label="Senha"><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
        {err && <div className="alert alert-err">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !online}>Entrar</button>
        <p className="muted small">Acesso restrito ao administrador. O modo demonstração (dados fictícios) fica disponível após entrar, em Configurações.</p>
        <InstallButton />
      </form>
    </div>
  );
}
