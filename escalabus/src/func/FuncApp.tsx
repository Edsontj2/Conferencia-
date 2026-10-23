import { useEffect, useMemo, useState } from 'react';
import { ApiError, getCached, isOnline, onOnlineChange, send, setCacheScope, clearCache } from '../api';
import { Logo } from '../components/Logo';
import { Icon } from '../components/Icons';
import { Field, Modal } from '../components/ui';
import { InstallButton } from '../components/InstallButton';
import type { Entry } from '../../shared/types';
import type { ExtraSchedule } from '../../shared/extras';
import { buildReportDay } from '../../shared/report';
import { crossesMidnight, dayLabel, fmtDate, todayLocal, weekdayOf, addDays } from '../../shared/time';
import { formatPhone } from '../../shared/whatsapp';

interface Me { phone: string; fullName: string; person: { id: number; name: string; role: string; shiftName: string } | null; companyName: string }
type ListItem = { kind: 'fds'; id: number; date: string; saturday: string; sunday: string; mine: number }
  | { kind: 'avulsa'; id: number; date: string; title: string; mine: number };
const keyOf = (w: ListItem) => `${w.kind}:${w.id}`;
interface Detail { id: number; saturday: string; sunday: string; entries: Entry[]; updatedAt: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const weekendText = (sat: string) => {
  const sun = addDays(sat, 1);
  const [, m1, d1] = sat.split('-').map(Number);
  const [y2, m2, d2] = sun.split('-').map(Number);
  return m1 === m2 ? `${d1} e ${d2} de ${MESES[m1 - 1]} de ${y2}` : `${d1} de ${MESES[m1 - 1]} e ${d2} de ${MESES[m2 - 1]} de ${y2}`;
};
/** Sábado do fim de semana atual (ou do próximo, de segunda a sexta). */
const currentSaturday = () => { const t = todayLocal(); const wd = weekdayOf(t); return wd === 0 ? addDays(t, -1) : addDays(t, (6 - wd + 7) % 7); };

export function FuncApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [online, setOnline] = useState(isOnline());
  useEffect(() => onOnlineChange(setOnline), []);

  const loadMe = async () => {
    try {
      const r = await getCached<Me>('/api/func/me');
      setCacheScope(`func:${r.data.phone}`);
      setMe(r.data);
    } catch { setMe(null); } finally { setChecked(true); }
  };
  useEffect(() => { setCacheScope('func'); void loadMe(); }, []);

  if (!checked) return <div className="splash">Carregando…</div>;
  if (!me) return <AuthScreen online={online} onDone={() => { setCacheScope('func'); void loadMe(); }} />;
  return <Viewer me={me} online={online} onLogout={async () => { try { await send('POST', '/api/func/logout'); } catch { /* offline */ } clearCache(); setMe(null); }} />;
}

/* ---------------- Entrar / Primeiro acesso ---------------- */
function AuthScreen({ online, onDone }: { online: boolean; onDone: () => void }) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState<{ id: number; name: string; role: string }[] | null>(null);
  const [linked, setLinked] = useState<string | null | undefined>(undefined);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };
  const login = () => run(async () => { await send('POST', '/api/func/login', { phone, password: pw }); onDone(); });
  const register = (extra: { personId?: number; noMatch?: boolean } = {}) => run(async () => {
    if (pw.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
    if (pw !== pw2) throw new Error('As senhas não conferem.');
    const r = await send<{ choose?: { id: number; name: string; role: string }[]; person?: { name: string } | null }>('POST', '/api/func/register', { phone, name, password: pw, ...extra });
    if (r.choose) { setChoose(r.choose); return; }
    setChoose(null);
    setLinked(r.person?.name ?? null);
  });

  if (linked !== undefined) {
    return (
      <div className="fa-auth"><div className="fa-card">
        <Logo size={44} dark={false} />
        {linked ? <>
          <div className="fa-ok"><Icon.check /> Cadastro feito!</div>
          <p>Encontramos você na equipe como <strong>{linked}</strong>. Seu telefone foi registrado no seu cadastro.</p>
        </> : <>
          <div className="fa-ok"><Icon.check /> Cadastro feito!</div>
          <p>Não encontramos seu nome na equipe. Você já pode ver a escala completa; a administração vai vincular seu nome para destacar os seus serviços.</p>
        </>}
        <button className="btn btn-primary btn-block btn-lg" onClick={onDone}>Ver minha escala</button>
      </div></div>
    );
  }

  return (
    <div className="fa-auth">
      <div className="fa-card">
        <Logo size={44} dark={false} />
        <p className="muted" style={{ margin: '.2rem 0 1rem' }}>Consulte sua escala de fim de semana</p>
        <div className="fa-tabs">
          <button className={tab === 'login' ? 'active' : ''} onClick={() => { setTab('login'); setErr(null); setChoose(null); }}>Entrar</button>
          <button className={tab === 'signup' ? 'active' : ''} onClick={() => { setTab('signup'); setErr(null); }}>Primeiro acesso</button>
        </div>
        {!online && <div className="alert alert-warn">Sem internet. É preciso estar conectado para entrar.</div>}
        {choose ? (
          <div className="fa-choose">
            <p><strong>Qual destes é você?</strong></p>
            {choose.map((c) => (
              <button key={c.id} className="btn btn-block" disabled={busy} onClick={() => void register({ personId: c.id })}>
                {c.name} <span className="muted small">· {c.role === 'motorista' ? 'Motorista' : 'Cobrador(a)'}</span>
              </button>
            ))}
            <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => void register({ noMatch: true })}>Nenhum destes sou eu</button>
            <button className="btn btn-ghost btn-block" onClick={() => setChoose(null)}>Voltar e corrigir o nome</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void (tab === 'login' ? login() : register()); }} className="fa-form">
            {tab === 'signup' && (
              <Field label="Nome completo" hint="Como está na escala (ex.: José Ferreira)">
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={5} />
              </Field>
            )}
            <Field label="Telefone (com DDD)">
              <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="61 99999-0000" autoComplete="tel" required />
            </Field>
            <Field label={tab === 'signup' ? 'Crie uma senha (mín. 6)' : 'Senha'}>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} required />
            </Field>
            {tab === 'signup' && <Field label="Repita a senha"><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></Field>}
            {err && <div className="alert alert-err">{err}</div>}
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !online}>{tab === 'login' ? 'Entrar' : 'Cadastrar'}</button>
            {tab === 'login' && <p className="muted small">Ainda não tem acesso? Toque em <b>Primeiro acesso</b>. Esqueceu a senha? Peça à administração.</p>}
          </form>
        )}
        <div style={{ marginTop: '1rem' }}><InstallButton /></div>
      </div>
    </div>
  );
}

/* ---------------- Visualizador ---------------- */
function Viewer({ me, online, onLogout }: { me: Me; online: boolean; onLogout: () => void }) {
  const [list, setList] = useState<ListItem[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [extra, setExtra] = useState<ExtraSchedule | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [day, setDay] = useState<'sat' | 'sun'>('sat');
  const [q, setQ] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const pid = me.person?.id ?? null;

  useEffect(() => {
    getCached<ListItem[]>('/api/func/schedules').then((r) => {
      const items = r.data.map((w) => (w.kind ? w : { ...(w as object), kind: 'fds', date: (w as { saturday: string }).saturday } as ListItem));
      setList(items);
      // abre a próxima escala (a mais próxima a partir de hoje; no fim de semana, a do fim de semana atual)
      const today = todayLocal();
      const cur = currentSaturday();
      const upcoming = [...items].filter((w) => (w.kind === 'fds' ? w.saturday >= cur : w.date >= today)).sort((a, b) => a.date.localeCompare(b.date))[0];
      const first = upcoming ?? items[0];
      setSel(first ? keyOf(first) : null);
    }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (sel == null) return;
    setErr(null);
    const [kind, idStr] = sel.split(':');
    if (kind === 'avulsa') {
      setDetail(null);
      getCached<ExtraSchedule>(`/api/func/extras/${idStr}`).then((r) => { setExtra(r.data); setSavedAt(r.savedAt); setFromCache(r.fromCache); }).catch((e) => setErr(e.message));
      return;
    }
    setExtra(null);
    getCached<Detail>(`/api/func/schedules/${idStr}`).then((r) => {
      setDetail(r.data); setSavedAt(r.savedAt); setFromCache(r.fromCache);
      const mine = r.data.entries.filter((e) => e.driverId === pid || e.conductorId === pid);
      setDay(mine.length && mine.every((e) => e.date === r.data.sunday) ? 'sun' : 'sat');
    }).catch((e) => setErr(e.message));
  }, [sel, pid]);

  const mine = useMemo(() => (detail && pid != null ? detail.entries.filter((e) => e.driverId === pid || e.conductorId === pid)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)) : []), [detail, pid]);
  const date = detail ? (day === 'sat' ? detail.saturday : detail.sunday) : '';
  const report = useMemo(() => (detail ? buildReportDay(detail.entries, date) : null), [detail, date]);
  const term = q.trim().toLowerCase();
  const visible = (e: Entry) => !term || e.driverName.toLowerCase().includes(term) || e.conductorName.toLowerCase().includes(term) || e.lineCode.includes(term) || e.busFleet.includes(term);

  return (
    <div className="app">
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <div className="sb-brand">
          <Logo size={34} />
          <button className="sb-close" onClick={() => setMenu(false)} aria-label="Fechar menu"><Icon.close /></button>
        </div>
        <div className="fa-team">Equipe</div>
        <nav className="sb-nav">
          <div className="sb-group-title">Histórico de escalas</div>
          {!list ? <p className="fa-muted-dark">Carregando…</p> : list.length === 0 ? <p className="fa-muted-dark">Nenhuma escala publicada ainda.</p> : list.map((w) => (
            <button key={keyOf(w)} className={`sb-link fa-week ${sel === keyOf(w) ? 'active' : ''}`} onClick={() => { setSel(keyOf(w)); setMenu(false); setQ(''); }}>
              {w.kind === 'fds' ? <Icon.calendar /> : <Icon.image />}
              <span className="fa-week-text">
                {w.kind === 'fds'
                  ? <span>{fmtDate(w.saturday).slice(0, 5)} e {fmtDate(w.sunday).slice(0, 5)}</span>
                  : <span>{fmtDate(w.date).slice(0, 5)} · {w.title}</span>}
                <small>{w.kind === 'fds' ? 'Fim de semana' : dayLabel(w.date)} · {w.date.slice(0, 4)}{w.mine ? ' · você trabalha' : ''}</small>
              </span>
              {w.mine > 0 && <span className="fa-dot" />}
            </button>
          ))}
        </nav>
        <div className="sb-footer">
          <InstallButton />
          <div className="sb-user">
            <div className="avatar">{(me.person?.name ?? me.fullName).slice(0, 2).toUpperCase()}</div>
            <div className="sb-user-text">
              <strong>{me.person?.name ?? me.fullName}</strong>
              <span>{formatPhone(me.phone)}</span>
            </div>
            <button className="sb-icon-btn" onClick={onLogout} title="Sair" aria-label="Sair"><Icon.logout /></button>
          </div>
          <button className="sb-collapse" style={{ display: 'flex' }} onClick={() => setPwOpen(true)}><Icon.settings /><span>Alterar senha</span></button>
        </div>
      </aside>
      {menu && <div className="sb-overlay" onClick={() => setMenu(false)} />}

      <div className="main">
        <header className="mobile-bar">
          <button className="mobile-menu" onClick={() => setMenu(true)} aria-label="Abrir menu"><Icon.menu /></button>
          <Logo size={32} />
        </header>
        {!online && <div className="notice notice-err"><Icon.wifiOff /> Sem internet — mostrando a última escala salva{savedAt && fromCache ? ` (${new Date(savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})` : ''}.</div>}
        <main className="content fa-content">
          <div className="ph">
            <div className="ph-text">
              <h1>{extra ? extra.title : detail ? 'Escala do fim de semana' : 'Minha escala'}</h1>
              <p>{extra ? `${dayLabel(extra.date)} · ${fmtDate(extra.date)}` : detail ? `Sábado e domingo · ${weekendText(detail.saturday)}` : me.companyName}</p>
            </div>
          </div>
          {err && <div className="alert alert-err">{err}</div>}
          {list && list.length === 0 && <div className="empty">Ainda não há escala publicada. Volte mais tarde.</div>}

          {extra && <ExtraView s={extra} pid={pid} linked={!!me.person} />}
          {detail && (
            <>
              <section className="fa-mine">
                <h2>Meus serviços</h2>
                {!me.person ? (
                  <p className="muted">Seu cadastro ainda não foi vinculado ao seu nome na equipe. Veja a escala completa abaixo; a administração vai fazer o vínculo.</p>
                ) : mine.length === 0 ? (
                  <div className="fa-free"><Icon.check /> Você <strong>não está escalado(a)</strong> neste fim de semana.</div>
                ) : (
                  <div className="fa-mine-list">
                    {mine.map((e) => {
                      const isDriver = e.driverId === pid;
                      return (
                        <div key={e.id} className="fa-mine-card">
                          <div className="fa-mine-day">{dayLabel(e.date)} <span>{fmtDate(e.date)}</span></div>
                          <div className="fa-mine-time">{e.startTime} – {e.endTime}{crossesMidnight(e.startTime, e.endTime) ? ' (+1)' : ''}</div>
                          <div className="fa-mine-info">
                            <span>Linha <strong>{e.lineCode}</strong></span>
                            <span>Carro <strong>{e.busFleet || 'a definir'}</strong></span>
                            <span>Turno <strong>{e.shiftName}</strong></span>
                          </div>
                          <div className="fa-mine-partner">
                            <span className={`role-badge ${isDriver ? 'motorista' : 'cobrador'}`}>{isDriver ? 'Você: motorista' : 'Você: cobrador(a)'}</span>
                            <span>{isDriver ? 'Cobrador(a)' : 'Motorista'}: <strong>{isDriver ? e.conductorName : e.driverName}</strong></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="sheet">
                <div className="day-tabs">
                  <button className={day === 'sat' ? 'active' : ''} onClick={() => setDay('sat')}>Sábado ({fmtDate(detail.saturday).slice(0, 5)})</button>
                  <button className={day === 'sun' ? 'active' : ''} onClick={() => setDay('sun')}>Domingo ({fmtDate(detail.sunday).slice(0, 5)})</button>
                </div>
                <label className="search fa-search"><Icon.search /><input type="search" placeholder="Procurar nome, linha ou carro…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
                {report && report.sections.length === 0 && <div className="empty">Sem serviços neste dia.</div>}
                {report?.sections.map((s) => {
                  const rows = s.rows.filter((r) => visible(r.entry));
                  if (!rows.length) return null;
                  return (
                    <div key={s.shiftName} className="fa-section">
                      <h3>Turno: {s.shiftName}</h3>
                      <div className="table-wrap fa-table">
                        <table className="table">
                          <thead><tr><th>Seq</th><th>Hora</th><th>Rend.</th><th>Linha</th><th>Carro</th><th>Motorista</th><th>Cobrador</th></tr></thead>
                          <tbody>{rows.map(({ seq, entry: e }) => {
                            const isMine = pid != null && (e.driverId === pid || e.conductorId === pid);
                            return (
                              <tr key={e.id} className={isMine ? 'fa-row-mine' : ''}>
                                <td className="muted">{seq}</td><td className="strong">{e.startTime}</td>
                                <td>{e.endTime}{crossesMidnight(e.startTime, e.endTime) ? '*' : ''}</td>
                                <td>{e.lineCode}</td><td>{e.busFleet || '—'}</td>
                                <td className={e.driverId === pid ? 'strong' : ''}>{e.driverName}</td>
                                <td className={e.conductorId === pid ? 'strong' : ''}>{e.conductorName}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                      <div className="fa-cards">
                        {rows.map(({ entry: e }) => {
                          const isMine = pid != null && (e.driverId === pid || e.conductorId === pid);
                          return (
                            <div key={e.id} className={`fa-card-row ${isMine ? 'fa-row-mine' : ''}`}>
                              <div className="fa-card-top"><strong>{e.startTime} – {e.endTime}</strong><span>Linha {e.lineCode} · Carro {e.busFleet || '—'}</span></div>
                              <div><span className="chip-cell chip-blue fa-chip">{e.driverName}</span></div>
                              <div><span className="chip-cell chip-amber fa-chip">{e.conductorName}</span></div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </main>
      </div>
      {pwOpen && <PasswordDialog online={online} onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function PasswordDialog({ online, onClose }: { online: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Modal title="Alterar senha" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Fechar</button>
      <button className="btn btn-primary" disabled={!online || !cur || next.length < 6 || next !== again} onClick={async () => {
        try { await send('POST', '/api/func/password', { current: cur, next }); setMsg({ ok: true, text: 'Senha alterada.' }); setCur(''); setNext(''); setAgain(''); }
        catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
      }}>Salvar</button>
    </>}>
      <div className="form-grid">
        <Field label="Senha atual"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="Nova senha (mín. 6)"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Repita a nova senha" error={again && again !== next ? 'Não confere.' : null}><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-err'}`}>{msg.text}</div>}
    </Modal>
  );
}


/* ---------------- Escala importada (foto/PDF feita fora do sistema) ---------------- */
function ExtraView({ s, pid, linked }: { s: ExtraSchedule; pid: number | null; linked: boolean }) {
  const [q, setQ] = useState('');
  const [photo, setPhoto] = useState<number | null>(null);
  const mine = pid == null ? [] : s.rows.filter((r) => r.driverId === pid || r.conductorId === pid);
  const term = q.trim().toLowerCase();
  const rows = s.rows.filter((r) => !term || r.driverName.toLowerCase().includes(term) || r.conductorName.toLowerCase().includes(term) || r.line.includes(term) || r.bus.includes(term));
  const isMine = (r: ExtraSchedule['rows'][number]) => pid != null && (r.driverId === pid || r.conductorId === pid);
  return (
    <>
      {s.notes && <div className="alert alert-info">{s.notes}</div>}
      <section className="fa-mine">
        <h2>Meus serviços</h2>
        {!linked ? (
          <p className="muted">Seu cadastro ainda não foi vinculado ao seu nome na equipe. Veja a escala completa abaixo; a administração vai fazer o vínculo.</p>
        ) : mine.length === 0 ? (
          <div className="fa-free"><Icon.check /> Seu nome <strong>não aparece</strong> nesta escala. Confira a tabela e o arquivo original abaixo.</div>
        ) : (
          <div className="fa-mine-list">
            {mine.map((r, i) => {
              const isDriver = r.driverId === pid;
              return (
                <div key={i} className="fa-mine-card">
                  <div className="fa-mine-day">{dayLabel(s.date)} <span>{fmtDate(s.date)}</span></div>
                  <div className="fa-mine-time">{r.start || '—'}{r.end ? ` – ${r.end}` : ''}</div>
                  <div className="fa-mine-info">
                    <span>Linha <strong>{r.line || '—'}</strong></span>
                    <span>Carro <strong>{r.bus || 'a definir'}</strong></span>
                    {r.seq && <span>Seq <strong>{r.seq}</strong></span>}
                  </div>
                  <div className="fa-mine-partner">
                    <span className={`role-badge ${isDriver ? 'motorista' : 'cobrador'}`}>{isDriver ? 'Você: motorista' : 'Você: cobrador(a)'}</span>
                    <span>{isDriver ? 'Cobrador(a)' : 'Motorista'}: <strong>{(isDriver ? r.conductorName : r.driverName) || '—'}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {s.files.length > 0 && (
        <section className="fa-files">
          <h2>Escala original</h2>
          <div className="fa-files-list">
            {s.files.map((f) => f.mime.startsWith('image/') ? (
              <button key={f.id} className="fa-photo" onClick={() => setPhoto(f.id)}><img src={`/api/func/files/${f.id}`} alt={f.name} loading="lazy" /><span>Ampliar foto</span></button>
            ) : (
              <a key={f.id} className="btn" href={`/api/func/files/${f.id}`} target="_blank" rel="noreferrer"><Icon.pdf /> {f.name}</a>
            ))}
          </div>
        </section>
      )}

      {s.rows.length > 0 && (
        <section className="sheet">
          <label className="search fa-search" style={{ marginTop: '1rem' }}><Icon.search /><input type="search" placeholder="Procurar nome, linha ou carro…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="table-wrap fa-table">
            <table className="table">
              <thead><tr><th>Seq</th><th>Carro</th><th>Hora</th><th>Linha</th><th>Rend.</th><th>Motorista</th><th>Cobrador</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} className={isMine(r) ? 'fa-row-mine' : ''}>
                  <td className="muted">{r.seq}</td><td>{r.bus}</td><td className="strong">{r.start}</td><td>{r.line}</td><td>{r.end}</td>
                  <td className={r.driverId != null && r.driverId === pid ? 'strong' : ''}>{r.driverName}</td>
                  <td className={r.conductorId != null && r.conductorId === pid ? 'strong' : ''}>{r.conductorName}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="fa-cards">
            {rows.map((r, i) => (
              <div key={i} className={`fa-card-row ${isMine(r) ? 'fa-row-mine' : ''}`}>
                <div className="fa-card-top"><strong>{r.start}{r.end ? ` – ${r.end}` : ''}</strong><span>Linha {r.line || '—'} · Carro {r.bus || '—'}</span></div>
                <div><span className="chip-cell chip-blue fa-chip">{r.driverName || '—'}</span></div>
                <div><span className="chip-cell chip-amber fa-chip">{r.conductorName || '—'}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}
      {photo != null && (
        <div className="fa-lightbox" onClick={() => setPhoto(null)} role="dialog" aria-label="Foto da escala">
          <button className="fa-lightbox-close" aria-label="Fechar"><Icon.close /></button>
          <img src={`/api/func/files/${photo}`} alt="Escala original" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
