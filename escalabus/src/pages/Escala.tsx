import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, getCached, get, recallLast, rememberLast, send } from '../api';
import { useApp } from '../state';
import { Empty, Field, fmtDateTime, IssuesPanel, Modal, StatusBadge } from '../components/ui';
import { EntryEditor, SwapDialog } from '../components/EntryEditor';
import type { GenerateResponse, WeekendData } from '../types';
import type { Entry, Issue, Schedule } from '../../shared/types';
import { buildContextMaps, canConfirm, hasErrors, validateSchedule, type RuleContext } from '../../shared/rules';
import { compareEntries, newId } from '../../shared/generator';
import { addDays, crossesMidnight, dayLabel, fmtDate, isSaturday, isValidDate, nextSaturday, sundayOf, todayLocal, weekendSaturdayOf } from '../../shared/time';

interface Working { entries: Entry[]; dirty: boolean; creating: boolean; fromProposal: boolean }

export function EscalaPage() {
  const { catalog, online, toast, me } = useApp();
  const [params, setParams] = useSearchParams();
  const initialSat = (() => {
    const p = params.get('sabado');
    if (p && isSaturday(p)) return p;
    const last = recallLast('saturday');
    return last && isSaturday(last) ? last : nextSaturday(todayLocal());
  })();
  const [saturday, setSaturday] = useState(initialSat);
  const [dateInput, setDateInput] = useState(initialSat);
  const [dateErr, setDateErr] = useState<string | null>(null);
  const [data, setData] = useState<WeekendData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [proposal, setProposal] = useState<GenerateResponse | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [swapping, setSwapping] = useState<Entry | null>(null);
  const [reasonFor, setReasonFor] = useState<null | 'save' | 'cancel'>(null);
  const [serverIssues, setServerIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async (sat: string) => {
    setLoadErr(null);
    try {
      const r = await getCached<WeekendData>(`/api/weekend/${sat}`);
      setData(r.data); setSavedAt(r.savedAt); setFromCache(r.fromCache);
      rememberLast('saturday', sat);
    } catch (e) { setData(null); setLoadErr((e as Error).message); }
  }, []);

  useEffect(() => {
    setWorking(null); setProposal(null); setServerIssues(null);
    void load(saturday);
    setParams({ sabado: saturday }, { replace: true });
  }, [saturday, load, setParams]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (working?.dirty || proposal) { e.preventDefault(); } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [working, proposal]);

  const schedule: Schedule | null = data?.schedule ?? null;

  const ctx: RuleContext | null = useMemo(() => {
    if (!catalog || !data) return null;
    return {
      saturday, ...buildContextMaps(catalog.people, catalog.lines, catalog.buses),
      otherConfirmed: data.context.otherConfirmed, settings: catalog.settings,
      baseline: schedule?.entries, historyMissing: data.context.historyMissing,
    };
  }, [catalog, data, saturday, schedule]);

  const shown: Entry[] = working?.entries ?? proposal?.entries ?? schedule?.entries ?? [];
  const issues = useMemo(() => {
    if (!ctx) return data?.issues ?? [];
    if (!working && !proposal && !schedule) return validateSchedule([], ctx).filter((i) => i.severity === 'warning');
    return validateSchedule(shown, ctx);
  }, [ctx, shown, working, proposal, schedule, data]);
  const issuesByEntry = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) if (i.entryId) m.set(i.entryId, [...(m.get(i.entryId) ?? []), i]);
    return m;
  }, [issues]);

  if (!catalog) return <p>Carregando…</p>;

  const confirmLeave = () => !(working?.dirty || proposal) || confirm('Há alterações não salvas nesta escala. Descartar?');
  const goTo = (sat: string) => { if (!confirmLeave()) return; setSaturday(sat); setDateInput(sat); setDateErr(null); };
  const onDate = (v: string) => {
    setDateInput(v);
    if (!isValidDate(v)) { setDateErr('Data inválida.'); return; }
    if (!isSaturday(v)) {
      const s = weekendSaturdayOf(v);
      setDateErr(s ? `Escolha o sábado. ${dayLabel(v)} pertence ao fim de semana de ${fmtDate(s)}.` : `${dayLabel(v)} não é dia de escala: só sábados e domingos. Escolha um sábado.`);
      return;
    }
    goTo(v);
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.details?.issues) setServerIssues(e.details.issues);
      toast(e.message, 'err');
      if (e.status === 409) void load(saturday);
    } else toast(String(e), 'err');
  };

  const generate = async () => {
    if (working?.dirty && !confirm('Descartar as edições atuais e sortear uma nova proposta?')) return;
    setBusy(true); setServerIssues(null);
    try {
      const r = await send<GenerateResponse>('POST', '/api/schedules/generate', { saturday });
      setProposal(r); setWorking(null);
      if (r.entries.length === 0) toast('Nenhum serviço ativo cadastrado para este fim de semana.', 'err');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  /** Salva entradas: cria rascunho ou atualiza a escala existente (com versão para não sobrescrever outro dispositivo). */
  const persist = async (entries: Entry[], reason?: string) => {
    setBusy(true); setServerIssues(null);
    try {
      if (!schedule) await send<Schedule>('POST', '/api/schedules', { saturday, entries });
      else await send<Schedule>('PUT', `/api/schedules/${schedule.id}`, { entries, version: schedule.version, reason: reason ?? null });
      toast(schedule?.status === 'confirmada' ? 'Alterações salvas e registradas.' : 'Rascunho salvo.');
      setWorking(null); setProposal(null);
      await load(saturday);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const saveProposal = async () => {
    if (!proposal) return;
    if (schedule?.status === 'confirmada') { toast('Já existe escala confirmada. Use "Editar escala confirmada".', 'err'); return; }
    if (schedule && !confirm(`Já existe um rascunho salvo para este fim de semana (${schedule.entries.length} serviços, atualizado em ${fmtDateTime(schedule.updatedAt)}).\n\nSubstituir pelo novo sorteio?`)) return;
    await persist(proposal.entries);
  };

  const saveWorking = async () => {
    if (!working) return;
    if (schedule?.status === 'confirmada') { setReasonFor('save'); return; }
    if (working.fromProposal && schedule && !confirm(`Já existe um rascunho salvo para este fim de semana (${schedule.entries.length} serviços). Substituir pelo sorteio editado?`)) return;
    await persist(working.entries);
  };

  const doConfirm = async () => {
    if (!schedule) return;
    if (!confirm('Confirmar a escala? Após confirmada, ela passa a valer para a regra de alternância dos próximos fins de semana.')) return;
    setBusy(true); setServerIssues(null);
    try {
      await send('POST', `/api/schedules/${schedule.id}/confirm`, { version: schedule.version });
      toast('Escala confirmada.');
      await load(saturday);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const doCancel = async (reason: string) => {
    if (!schedule) return;
    setBusy(true);
    try {
      await send('POST', `/api/schedules/${schedule.id}/cancel`, { version: schedule.version, reason });
      toast('Escala cancelada. Ela permanece no histórico e não conta para as restrições.');
      await load(saturday);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const startEdit = (fromProposal = false) => {
    setWorking({ entries: (fromProposal ? proposal!.entries : schedule?.entries ?? []).map((e) => ({ ...e })), dirty: fromProposal, creating: !schedule, fromProposal });
    setProposal(null);
  };
  const startManual = (withTemplates: boolean) => {
    const sun = sundayOf(saturday);
    const lines = new Map(catalog.lines.map((l) => [l.id, l]));
    const buses = new Map(catalog.buses.map((b) => [b.id, b]));
    const entries: Entry[] = withTemplates ? catalog.services.filter((s) => s.active && lines.get(s.lineId)?.active && (s.busId == null || buses.get(s.busId)?.active)).map((s) => {
      const bus = s.busId == null ? undefined : buses.get(s.busId);
      return {
      id: newId(), date: s.weekday === 6 ? saturday : sun, serviceId: s.id,
      lineId: s.lineId, lineCode: lines.get(s.lineId)!.code, lineDescription: lines.get(s.lineId)!.description,
      busId: s.busId, busFleet: bus?.fleetNumber ?? '', busPlate: bus?.plate ?? '',
      startTime: s.startTime, endTime: s.endTime, shiftName: s.shiftName, driverId: null, driverName: '', conductorId: null, conductorName: '',
    }; }).sort(compareEntries) : [];
    setWorking({ entries, dirty: true, creating: true, fromProposal: false });
    setProposal(null);
  };
  const updateWorking = (fn: (es: Entry[]) => Entry[]) => setWorking((w) => (w ? { ...w, entries: fn(w.entries).sort(compareEntries), dirty: true } : w));
  const addEntry = () => setEditing({
    id: newId(), date: saturday, serviceId: null, lineId: null, lineCode: '', lineDescription: null, busId: null, busFleet: '', busPlate: '',
    startTime: '05:00', endTime: '11:00', shiftName: '', driverId: null, driverName: '', conductorId: null, conductorName: '',
  });

  const sat = saturday, sun = sundayOf(saturday);
  const editable = !!working;
  const rowClass = (iss: Issue[]) => (iss.some((i) => i.severity === 'error') ? 'row-err' : iss.length ? 'row-warn' : '');
  const rowActions = (e: Entry) => (<>
    <button className="btn btn-sm" onClick={() => setEditing(e)}>Editar</button>
    <button className="btn btn-sm" onClick={() => setSwapping(e)} disabled={shown.length < 2}>Trocar</button>
    <button className="btn btn-sm btn-danger-ghost" onClick={() => { if (confirm('Remover este serviço da escala?')) updateWorking((es) => es.filter((x) => x.id !== e.id)); }}>Remover</button>
  </>);
  const st = schedule?.status;
  const blocked = !online || busy;
  const confirmBlocked = !schedule || hasErrors(issues) || !canConfirm(issues) || !!working || !!proposal;

  return (
    <div>
      <div className="page-head">
        <h1>Escala do fim de semana</h1>
        {me?.mode === 'demo' && <span className="badge badge-demo">DEMONSTRAÇÃO</span>}
      </div>

      <div className="toolbar card">
        <div className="weekend-picker">
          <button className="btn btn-sm" onClick={() => goTo(addDays(sat, -7))} aria-label="Fim de semana anterior">◀</button>
          <Field label="Sábado" error={dateErr}>
            <input type="date" value={dateInput} onChange={(e) => onDate(e.target.value)} />
          </Field>
          <div className="sunday-box"><span className="field-label">Domingo</span><strong>{fmtDate(sun)}</strong></div>
          <button className="btn btn-sm" onClick={() => goTo(addDays(sat, 7))} aria-label="Próximo fim de semana">▶</button>
        </div>
        <div className="status-box">
          {schedule ? <><StatusBadge status={schedule.status} /> <span className="muted small">v{schedule.version} · atualizada {fmtDateTime(schedule.updatedAt)}</span></>
            : <span className="muted">Sem escala salva</span>}
          {proposal && <span className="badge badge-rascunho">Proposta NÃO salva</span>}
          {working?.dirty && <span className="badge badge-rascunho">Alterações NÃO salvas</span>}
          {fromCache && <span className="muted small">Cópia offline de {fmtDateTime(savedAt)}</span>}
        </div>
      </div>

      {loadErr && <div className="alert alert-err">{loadErr}</div>}

      <div className="actionbar no-print">
        {!working && st !== 'confirmada' && (
          <button className="btn btn-primary" disabled={blocked} onClick={() => void generate()}>🎲 Gerar escala aleatória</button>
        )}
        {proposal && <>
          <button className="btn btn-primary" disabled={blocked || hasErrors(issues)} onClick={() => void saveProposal()}>{schedule ? 'Substituir rascunho salvo' : 'Salvar como rascunho'}</button>
          <button className="btn" disabled={blocked} onClick={() => startEdit(true)}>Editar antes de salvar</button>
          <button className="btn btn-ghost" onClick={() => setProposal(null)}>Descartar proposta</button>
        </>}
        {!schedule && !working && !proposal && <>
          <button className="btn" disabled={blocked} onClick={() => startManual(true)}>Montar manualmente (a partir dos serviços)</button>
          <button className="btn" disabled={blocked} onClick={() => startManual(false)}>Escala em branco (histórico)</button>
        </>}
        {schedule && !working && !proposal && st === 'rascunho' && <>
          <button className="btn" disabled={blocked} onClick={() => startEdit()}>Editar rascunho</button>
          <button className="btn btn-success" disabled={blocked || confirmBlocked} onClick={() => void doConfirm()}
            title={confirmBlocked ? 'Preencha todas as vagas e corrija os conflitos para confirmar' : ''}>✔ Confirmar escala</button>
        </>}
        {schedule && !working && !proposal && st === 'confirmada' && (
          <button className="btn" disabled={blocked} onClick={() => startEdit()}>✎ Editar escala confirmada</button>
        )}
        {working && <>
          <button className="btn" disabled={blocked} onClick={addEntry}>+ Adicionar serviço</button>
          <button className="btn btn-primary" disabled={blocked || hasErrors(issues) || !working.dirty || (st === 'confirmada' && !canConfirm(issues))} onClick={() => void saveWorking()}>
            {st === 'confirmada' ? 'Salvar alterações (com motivo)' : 'Salvar rascunho'}
          </button>
          <button className="btn btn-ghost" onClick={() => { if (!working.dirty || confirm('Descartar alterações?')) setWorking(null); }}>Descartar alterações</button>
        </>}
        {schedule && !working && !proposal && <>
          <Link className="btn" to={`/relatorio?sabado=${sat}`}>🖨 Relatório / WhatsApp</Link>
          <button className="btn btn-ghost" onClick={() => setShowAudit(true)}>Registro de alterações</button>
          <button className="btn btn-danger-ghost" disabled={blocked} onClick={() => setReasonFor('cancel')}>Cancelar escala</button>
        </>}
      </div>

      {st === 'confirmada' && !working && <p className="muted small">Escala confirmada: alterações exigem a ação explícita "Editar escala confirmada", nova validação e motivo (fica registrado).</p>}
      {data?.cancelled && data.cancelled.length > 0 && <p className="muted small">Este fim de semana tem {data.cancelled.length} escala(s) cancelada(s) no histórico (não contam para as restrições).</p>}

      {proposal && <ProposalSummary p={proposal} />}
      <IssuesPanel issues={issues} />
      {serverIssues && hasErrors(serverIssues) && <IssuesPanel title="Validação do servidor" issues={serverIssues.filter((i) => i.severity !== 'warning')} />}

      {[sat, sun].map((date) => {
        const list = shown.filter((e) => e.date === date);
        return (
          <section key={date} className="day-block">
            <h2>{dayLabel(date)} {fmtDate(date)} <span className="muted small">({list.length} serviço(s))</span></h2>
            {list.length === 0 ? <Empty>{schedule || working || proposal ? 'Nenhum serviço neste dia.' : 'Gere a escala ou monte-a manualmente.'}</Empty> : (
              <>
                <div className="table-wrap escala-table">
                  <table className="table table-escala">
                    <thead><tr><th>Turno</th><th>Início</th><th>Término</th><th>Linha</th><th>Carro</th><th>Placa</th><th>Motorista</th><th>Cobrador</th>{editable && <th></th>}</tr></thead>
                    <tbody>
                      {list.map((e) => {
                        const iss = issuesByEntry.get(e.id) ?? [];
                        const roleIss = (r: 'driver' | 'conductor') => iss.filter((i) => i.role === r);
                        return (
                          <tr key={e.id} className={rowClass(iss)} title={iss.map((i) => i.message).join('\n')}>
                            <td>{e.shiftName}</td>
                            <td>{e.startTime}</td>
                            <td className="nowrap">{e.endTime}{crossesMidnight(e.startTime, e.endTime) ? ' (+1)' : ''}</td>
                            <td className="strong">{e.lineCode || '—'}</td>
                            <td>{e.busFleet || '—'}</td>
                            <td className="muted">{e.busPlate}</td>
                            <PersonCell name={e.driverName} issues={roleIss('driver')} />
                            <PersonCell name={e.conductorName} issues={roleIss('conductor')} />
                            {editable && <td className="actions">{rowActions(e)}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="entry-cards">
                  {list.map((e) => {
                    const iss = issuesByEntry.get(e.id) ?? [];
                    return (
                      <div key={e.id} className={`entry-card ${rowClass(iss)}`}>
                        <div className="entry-card-head">
                          <span className="time">{e.startTime}–{e.endTime}{crossesMidnight(e.startTime, e.endTime) ? ' (+1)' : ''}</span>
                          <span>{e.shiftName}</span><span>Linha <strong>{e.lineCode || '—'}</strong></span>
                          <span>Carro {e.busFleet || '—'} <span className="muted">{e.busPlate}</span></span>
                        </div>
                        <div className="entry-card-people">
                          <span>Mot.</span><span className={e.driverName ? '' : 'cell-open'}>{e.driverName || 'VAGA ABERTA'}</span>
                          <span>Cob.</span><span className={e.conductorName ? '' : 'cell-open'}>{e.conductorName || 'VAGA ABERTA'}</span>
                        </div>
                        {iss.length > 0 && <ul className="small entry-issues">{iss.map((i, k) => <li key={k} className={i.severity === 'error' ? 'cell-err' : ''}>{i.message}</li>)}</ul>}
                        {editable && <div className="actions">{rowActions(e)}</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        );
      })}

      {editing && ctx && working && (
        <EntryEditor initial={editing} entries={working.entries} ctx={ctx} catalog={catalog} historyCounts={data?.context.historyCounts ?? {}}
          onClose={() => setEditing(null)}
          onApply={(e) => { updateWorking((es) => (es.some((x) => x.id === e.id) ? es.map((x) => (x.id === e.id ? e : x)) : [...es, e])); setEditing(null); }} />
      )}
      {swapping && ctx && working && (
        <SwapDialog source={swapping} entries={working.entries} ctx={ctx} onClose={() => setSwapping(null)}
          onApply={(next, label) => { updateWorking(() => next); setSwapping(null); toast(`Troca de ${label} aplicada. Salve para gravar.`); }} />
      )}
      {reasonFor && (
        <ReasonDialog
          title={reasonFor === 'cancel' ? 'Cancelar escala' : 'Salvar alterações na escala confirmada'}
          label={reasonFor === 'cancel' ? 'Motivo do cancelamento' : 'Motivo da alteração (fica no registro)'}
          danger={reasonFor === 'cancel'}
          onClose={() => setReasonFor(null)}
          onOk={async (r) => { const k = reasonFor; setReasonFor(null); if (k === 'cancel') await doCancel(r); else if (working) await persist(working.entries, r); }} />
      )}
      {showAudit && schedule && <AuditDialog scheduleId={schedule.id} onClose={() => setShowAudit(false)} />}
    </div>
  );
}

function PersonCell({ name, issues }: { name: string; issues: Issue[] }) {
  if (!name) return <td className="cell-open">VAGA ABERTA</td>;
  const err = issues.some((i) => i.severity === 'error');
  return <td className={err ? 'cell-err' : ''}>{name}{err ? ' ⚠' : ''}</td>;
}

function ProposalSummary({ p }: { p: GenerateResponse }) {
  return (
    <div className="card proposal">
      <strong>Proposta de sorteio</strong> — {p.entries.length} serviço(s), {p.unfilled.length === 0 ? 'todas as vagas preenchidas.' : `${p.unfilled.length} vaga(s) sem preenchimento.`}
      {' '}Nada foi salvo ainda.
      {!p.exhaustive && <p className="muted small">A busca atingiu o limite de tentativas; pode existir distribuição melhor. Tente sortear novamente.</p>}
      {p.skipped.length > 0 && <p className="muted small">Serviços ignorados: {p.skipped.map((s) => s.reason).join('; ')}.</p>}
      {p.unfilled.length > 0 && (
        <div className="alert alert-warn">
          <strong>Vagas sem preenchimento e causas (nenhuma regra foi burlada):</strong>
          <ul>{p.unfilled.map((u) => (
            <li key={u.entryId + u.role}><strong>{u.description}</strong>
              <ul>{u.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </li>
          ))}</ul>
          <p className="small">Você pode salvar como rascunho incompleto e completar depois; a confirmação fica bloqueada até preencher todas as vagas.</p>
        </div>
      )}
    </div>
  );
}

function ReasonDialog({ title, label, onClose, onOk, danger }: { title: string; label: string; onClose: () => void; onOk: (r: string) => Promise<void>; danger?: boolean }) {
  const [r, setR] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Voltar</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!r.trim()} onClick={() => void onOk(r.trim())}>Confirmar</button>
    </>}>
      <Field label={label}><textarea rows={3} value={r} onChange={(e) => setR(e.target.value)} maxLength={500} /></Field>
    </Modal>
  );
}

function AuditDialog({ scheduleId, onClose }: { scheduleId: number; onClose: () => void }) {
  const [rows, setRows] = useState<{ id: number; at: string; username: string; action: string; reason: string | null; summary: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get<typeof rows>(`/api/schedules/${scheduleId}/audit`).then(setRows).catch((e) => setErr(e.message)); }, [scheduleId]);
  return (
    <Modal title="Registro de alterações" onClose={onClose} wide>
      {err && <div className="alert alert-err">{err}</div>}
      {!rows ? <p>Carregando…</p> : rows.length === 0 ? <Empty>Sem registros.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Motivo</th><th>Detalhes</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="nowrap">{fmtDateTime(r.at)}</td><td>{r.username}</td><td>{r.action}</td><td>{r.reason}</td><td className="pre">{r.summary}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  );
}
