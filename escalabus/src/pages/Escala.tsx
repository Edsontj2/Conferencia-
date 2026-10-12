import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, getCached, get, recallLast, rememberLast, send } from '../api';
import { useApp } from '../state';
import { Empty, Field, fmtDateTime, IssuesPanel, Modal, StatusBadge } from '../components/ui';
import { personOptions, SwapDialog } from '../components/EntryEditor';
import { WhatsAppDialog } from '../components/WhatsAppDialog';
import { Icon } from '../components/Icons';
import { IconAction, PageHeader } from '../components/PageHeader';
import { buildPdf, pdfFileName } from '../pdf';
import type { GenerateResponse, WeekendData } from '../types';
import type { AssignRole, Entry, Issue, Schedule } from '../../shared/types';
import { buildContextMaps, canConfirm, hasErrors, validateSchedule, type RuleContext } from '../../shared/rules';
import { compareEntries, newId } from '../../shared/generator';
import { addDays, crossesMidnight, dayLabel, fmtDate, isSaturday, isValidDate, nextSaturday, sundayOf, todayLocal, weekendSaturdayOf } from '../../shared/time';

interface Working { entries: Entry[]; dirty: boolean; fromProposal: boolean }
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Cor da faixa lateral por turno (cartões no celular). */
function shiftTone(name: string) {
  const n = name.toLowerCase();
  if (n.includes('manh')) return 'tone-green';
  if (n.includes('tard')) return 'tone-amber';
  if (n.includes('noit')) return 'tone-purple';
  return 'tone-blue';
}

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
  const [data, setData] = useState<WeekendData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [proposal, setProposal] = useState<GenerateResponse | null>(null);
  const [swapping, setSwapping] = useState<Entry | null>(null);
  const [reasonFor, setReasonFor] = useState<null | 'save' | 'cancel'>(null);
  const [serverIssues, setServerIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<'sat' | 'sun'>('sat');
  const [wa, setWa] = useState(false);

  const load = useCallback(async (sat: string) => {
    setLoadErr(null);
    try {
      const r = await getCached<WeekendData>(`/api/weekend/${sat}`);
      setData(r.data); setSavedAt(r.savedAt); setFromCache(r.fromCache);
      rememberLast('saturday', sat);
    } catch (e) { setData(null); setLoadErr((e as Error).message); }
  }, []);

  useEffect(() => {
    setWorking(null); setProposal(null); setServerIssues(null); setUnlocked(false);
    void load(saturday);
    setParams({ sabado: saturday }, { replace: true });
  }, [saturday, load, setParams]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (working?.dirty || proposal) e.preventDefault(); };
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

  const st = schedule?.status;
  const editable = online && !busy && st !== 'cancelada' && (st !== 'confirmada' || unlocked);
  const historyCounts = data?.context.historyCounts ?? {};

  // Opções de motorista/cobrador por linha da tabela (com o motivo de quem não pode)
  const options = useMemo(() => {
    const m = new Map<string, { driver: ReturnType<typeof personOptions>; conductor: ReturnType<typeof personOptions> }>();
    if (!ctx || !catalog || !editable) return m;
    for (const e of shown) {
      m.set(e.id, {
        driver: personOptions(e, 'driver', shown, ctx, catalog, historyCounts),
        conductor: personOptions(e, 'conductor', shown, ctx, catalog, historyCounts),
      });
    }
    return m;
  }, [shown, ctx, catalog, editable, historyCounts]);

  if (!catalog) return <p>Carregando…</p>;

  const sat = saturday, sun = sundayOf(saturday);
  const confirmLeave = () => !(working?.dirty || proposal) || confirm('Há alterações não salvas nesta escala. Descartar?');
  const goTo = (s: string) => { if (!confirmLeave()) return; setSaturday(s); };
  const onDate = (v: string) => {
    if (!isValidDate(v)) return;
    const s = weekendSaturdayOf(v);
    if (!s) { toast(`${dayLabel(v)} não é dia de escala: escolha um sábado ou domingo.`, 'err'); return; }
    goTo(s);
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.details?.issues) setServerIssues(e.details.issues);
      toast(e.message, 'err');
      if (e.status === 409) void load(saturday);
    } else toast(String(e), 'err');
  };

  /** Toda alteração na tabela passa por aqui: cria a cópia de trabalho e marca como não salva. */
  const mutate = (fn: (es: Entry[]) => Entry[]) => {
    setWorking((w) => ({
      entries: fn(w?.entries ?? proposal?.entries ?? schedule?.entries ?? []).sort(compareEntries),
      dirty: true,
      fromProposal: w?.fromProposal ?? !!proposal,
    }));
    setProposal(null);
  };
  const patch = (id: string, p: Partial<Entry>) => mutate((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const setPerson = (e: Entry, role: AssignRole, value: string) => {
    const pid = value ? Number(value) : null;
    const name = catalog.people.find((x) => x.id === pid)?.name ?? '';
    patch(e.id, role === 'driver' ? { driverId: pid, driverName: name } : { conductorId: pid, conductorName: name });
  };
  const addRow = (date: string) => mutate((es) => [...es, {
    id: newId(), date, serviceId: null, lineId: null, lineCode: '', lineDescription: null, busId: null, busFleet: '', busPlate: '',
    startTime: '05:00', endTime: '11:00', shiftName: 'Manhã', driverId: null, driverName: '', conductorId: null, conductorName: '',
  }]);
  const fromTemplates = () => {
    const lines = new Map(catalog.lines.map((l) => [l.id, l]));
    const buses = new Map(catalog.buses.map((b) => [b.id, b]));
    mutate(() => catalog.services.filter((s) => s.active && lines.get(s.lineId)?.active && (s.busId == null || buses.get(s.busId)?.active)).map((s) => {
      const bus = s.busId == null ? undefined : buses.get(s.busId);
      const l = lines.get(s.lineId)!;
      return {
        id: newId(), date: s.weekday === 6 ? sat : sun, serviceId: s.id, lineId: l.id, lineCode: l.code, lineDescription: l.description,
        busId: s.busId, busFleet: bus?.fleetNumber ?? '', busPlate: bus?.plate ?? '', startTime: s.startTime, endTime: s.endTime,
        shiftName: s.shiftName, driverId: null, driverName: '', conductorId: null, conductorName: '',
      };
    }));
  };

  const generate = async () => {
    if (working?.dirty && !confirm('Descartar as alterações e sortear uma nova proposta?')) return;
    setBusy(true); setServerIssues(null);
    try {
      const r = await send<GenerateResponse>('POST', '/api/schedules/generate', { saturday });
      setProposal(r); setWorking(null);
      if (r.entries.length === 0) toast('Nenhum serviço ativo cadastrado para este fim de semana.', 'err');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const persist = async (entries: Entry[], reason?: string) => {
    setBusy(true); setServerIssues(null);
    try {
      if (!schedule) await send<Schedule>('POST', '/api/schedules', { saturday, entries });
      else await send<Schedule>('PUT', `/api/schedules/${schedule.id}`, { entries, version: schedule.version, reason: reason ?? null });
      toast(schedule?.status === 'confirmada' ? 'Alterações salvas e registradas.' : 'Escala salva.');
      setWorking(null); setProposal(null); setUnlocked(false);
      await load(saturday);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const save = async () => {
    const entries = working?.entries ?? proposal?.entries;
    if (!entries) return;
    if (st === 'confirmada') { setReasonFor('save'); return; }
    if ((proposal || working?.fromProposal) && schedule && !confirm(`Já existe um rascunho salvo (${schedule.entries.length} serviços, ${fmtDateTime(schedule.updatedAt)}). Substituir?`)) return;
    await persist(entries);
  };

  const discard = () => {
    if ((working?.dirty || proposal) && !confirm('Descartar as alterações não salvas?')) return;
    setWorking(null); setProposal(null); setUnlocked(false); setServerIssues(null);
  };

  const doConfirm = async () => {
    if (!schedule || !confirm('Confirmar a escala? Ela passa a valer para a regra de alternância dos próximos fins de semana.')) return;
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
      toast('Escala cancelada. Ela fica no histórico e não conta para as restrições.');
      await load(saturday);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const clearPeople = () => {
    if (!confirm('Limpar todos os motoristas e cobradores desta escala? Linhas, ônibus e horários são mantidos.')) return;
    mutate((es) => es.map((e) => ({ ...e, driverId: null, driverName: '', conductorId: null, conductorName: '' })));
  };

  const exportPdf = () => {
    if (!shown.length) { toast('Não há serviços para exportar.', 'err'); return; }
    const status = working || proposal ? 'rascunho' : st ?? 'rascunho';
    buildPdf(shown, { companyName: catalog.settings.companyName, dates: [sat, sun], detailed: false, status, demo: me?.mode === 'demo' })
      .save(pdfFileName([sat, sun], me?.mode === 'demo'));
  };

  const pending = !!(working?.dirty || proposal);
  const errorsCount = issues.filter((i) => i.severity === 'error').length;
  const openCount = issues.filter((i) => i.severity === 'incomplete').length;
  const confirmBlocked = !schedule || hasErrors(issues) || !canConfirm(issues) || pending;
  const dayDate = tab === 'sat' ? sat : sun;
  const list = shown.filter((e) => e.date === dayDate);
  const satN = shown.filter((e) => e.date === sat).length;
  const sunN = shown.filter((e) => e.date === sun).length;
  const [ys, ms, ds] = sat.split('-').map(Number);
  const [yu, mu, du] = sun.split('-').map(Number);
  const rangeText = ms === mu ? `${ds} e ${du} de ${MESES[ms - 1]} de ${ys}` : `${ds} de ${MESES[ms - 1]} e ${du} de ${MESES[mu - 1]} de ${yu}`;

  const lineOptions = (cur: number | null) => catalog.lines.filter((l) => l.active || l.id === cur);
  const busOptions = (cur: number | null) => catalog.buses.filter((b) => b.active || b.id === cur);
  const shiftNames = [...new Set([...catalog.services.map((s) => s.shiftName), 'Manhã', 'Tarde', 'Noite'])];

  const personSelect = (e: Entry, role: AssignRole, roleIssues: Issue[]) => {
    const value = role === 'driver' ? e.driverId : e.conductorId;
    const name = role === 'driver' ? e.driverName : e.conductorName;
    const err = roleIssues.some((i) => i.severity === 'error');
    const cls = `chip-cell ${role === 'driver' ? 'chip-blue' : 'chip-amber'} ${!value ? 'chip-empty' : ''} ${err ? 'chip-err' : ''}`;
    if (!editable) return <span className={cls}>{name || 'Vaga aberta'}</span>;
    const opts = options.get(e.id)?.[role] ?? [];
    return (
      <select className={cls} value={value ?? ''} onChange={(ev) => setPerson(e, role, ev.target.value)} title={roleIssues.map((i) => i.message).join('\n')}>
        <option value="">— vaga aberta —</option>
        {value != null && !opts.some((o) => o.person.id === value) && <option value={value}>{name}</option>}
        {opts.map(({ person: p, problem, outside }) => (
          <option key={p.id} value={p.id} disabled={!!problem && p.id !== value}>
            {p.name}{problem ? ` — ${problem}` : outside ? ' (fora do turno)' : ''}
          </option>
        ))}
      </select>
    );
  };

  const cells = (e: Entry) => ({
    line: editable ? (
      <select className="cell-input" value={e.lineId ?? ''} onChange={(ev) => {
        const l = catalog.lines.find((x) => x.id === Number(ev.target.value));
        patch(e.id, { lineId: l?.id ?? null, lineCode: l?.code ?? '', lineDescription: l?.description ?? null });
      }}>
        <option value="">—</option>
        {lineOptions(e.lineId).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
      </select>
    ) : <strong>{e.lineCode || '—'}</strong>,
    bus: editable ? (
      <select className="cell-input" value={e.busId ?? ''} onChange={(ev) => {
        const b = catalog.buses.find((x) => x.id === Number(ev.target.value));
        patch(e.id, { busId: b?.id ?? null, busFleet: b?.fleetNumber ?? '', busPlate: b?.plate ?? '' });
      }}>
        <option value="">a definir</option>
        {busOptions(e.busId).map((b) => <option key={b.id} value={b.id}>{b.fleetNumber}{b.plate ? ` - ${b.plate}` : ''}</option>)}
      </select>
    ) : <span>{e.busFleet ? `${e.busFleet}${e.busPlate ? ` - ${e.busPlate}` : ''}` : <span className="muted">a definir</span>}</span>,
    time: editable ? (
      <span className="time-pair">
        <input className="cell-input" type="time" value={e.startTime} onChange={(ev) => ev.target.value && patch(e.id, { startTime: ev.target.value })} />
        <span>-</span>
        <input className="cell-input" type="time" value={e.endTime} onChange={(ev) => ev.target.value && patch(e.id, { endTime: ev.target.value })} />
      </span>
    ) : <span className="nowrap">{e.startTime} - {e.endTime}{crossesMidnight(e.startTime, e.endTime) ? ' (+1)' : ''}</span>,
    shift: editable ? (
      <input className="cell-input" list="shift-list" value={e.shiftName} onChange={(ev) => patch(e.id, { shiftName: ev.target.value })} />
    ) : <span>{e.shiftName}</span>,
  });

  const actions = (e: Entry) => editable ? (
    <span className="row-actions">
      <select className="cell-input day-select" value={e.date} onChange={(ev) => patch(e.id, { date: ev.target.value })} title="Dia do serviço">
        <option value={sat}>Sáb</option><option value={sun}>Dom</option>
      </select>
      <IconAction kind="edit" title="Trocar com outra vaga" onClick={() => setSwapping(e)} disabled={shown.length < 2}><Icon.swap /></IconAction>
      <IconAction kind="danger" title="Remover serviço" onClick={() => { if (confirm('Remover este serviço da escala?')) mutate((es) => es.filter((x) => x.id !== e.id)); }}><Icon.trash /></IconAction>
    </span>
  ) : null;

  return (
    <div className="escala">
      <PageHeader
        title="Escala de Trabalho"
        subtitle="Gere e gerencie as escalas de motoristas e cobradores"
        right={
          <div className="date-card">
            <button className="ia ia-neutral" onClick={() => goTo(addDays(sat, -7))} aria-label="Fim de semana anterior"><Icon.chevronLeft /></button>
            <label className="date-card-body" title="Escolher outra data">
              <span className="date-card-icon"><Icon.calendar /></span>
              <span>
                <strong>Sábado e Domingo</strong>
                <span>{rangeText}</span>
              </span>
              <input type="date" value={sat} onChange={(ev) => onDate(ev.target.value)} aria-label="Escolher sábado" />
            </label>
            <button className="ia ia-neutral" onClick={() => goTo(addDays(sat, 7))} aria-label="Próximo fim de semana"><Icon.chevronRight /></button>
          </div>
        }
      />

      {loadErr && <div className="alert alert-err">{loadErr}</div>}

      <div className="action-row no-print">
        <button className="btn btn-primary btn-lg" disabled={!online || busy || st === 'confirmada'} onClick={() => void generate()}
          title={st === 'confirmada' ? 'Escala já confirmada: use "Editar escala confirmada"' : ''}>
          <Icon.shuffle /> Gerar Escala Aleatória <Icon.shuffle />
        </button>
        <button className="btn btn-lg" disabled={!editable || shown.length === 0} onClick={clearPeople}><Icon.trash /> Limpar Escala</button>
        <button className="btn btn-lg" disabled={shown.length === 0} onClick={exportPdf}><Icon.pdf /> Exportar PDF</button>
        <button className="btn btn-lg btn-whatsapp" disabled={shown.length === 0} onClick={() => setWa(true)}><Icon.whatsapp /> Enviar no WhatsApp</button>
      </div>

      <div className="status-row no-print">
        {schedule ? <StatusBadge status={schedule.status} /> : <span className="badge badge-off">Sem escala salva</span>}
        {schedule && <span className="muted small">v{schedule.version} · atualizada {fmtDateTime(schedule.updatedAt)}</span>}
        {proposal && <span className="badge badge-rascunho">Sorteio não salvo</span>}
        {fromCache && <span className="muted small">Cópia offline de {fmtDateTime(savedAt)}</span>}
        <span className="spacer" />
        {!schedule && !pending && online && <button className="btn btn-sm" onClick={fromTemplates}>Montar com os serviços cadastrados</button>}
        {st === 'rascunho' && !pending && (
          <button className="btn btn-sm btn-success" disabled={busy || confirmBlocked || !online} onClick={() => void doConfirm()}
            title={confirmBlocked ? 'Preencha todas as vagas e corrija os conflitos' : ''}><Icon.check /> Confirmar escala</button>
        )}
        {st === 'confirmada' && !unlocked && !pending && <button className="btn btn-sm" disabled={!online} onClick={() => setUnlocked(true)}><Icon.edit /> Editar escala confirmada</button>}
        {schedule && <button className="btn btn-sm btn-ghost" onClick={() => setShowAudit(true)}>Registro de alterações</button>}
        {schedule && !pending && <button className="btn btn-sm btn-danger-ghost" disabled={!online || busy} onClick={() => setReasonFor('cancel')}>Cancelar escala</button>}
      </div>

      {st === 'confirmada' && unlocked && !pending && <div className="alert alert-info">Edição liberada: altere direto na tabela. Ao salvar, informe o motivo (fica registrado).</div>}
      {proposal && <ProposalSummary p={proposal} />}
      <IssuesPanel issues={issues} />
      {serverIssues && hasErrors(serverIssues) && <IssuesPanel title="Validação do servidor" issues={serverIssues.filter((i) => i.severity !== 'warning')} />}

      <div className="sheet">
        <div className="day-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'sat'} className={tab === 'sat' ? 'active' : ''} onClick={() => setTab('sat')}>
            Sábado ({fmtDate(sat).slice(0, 5)}) <span className="count">{satN}</span>
          </button>
          <button role="tab" aria-selected={tab === 'sun'} className={tab === 'sun' ? 'active' : ''} onClick={() => setTab('sun')}>
            Domingo ({fmtDate(sun).slice(0, 5)}) <span className="count">{sunN}</span>
          </button>
        </div>

        {list.length === 0 && !editable ? <Empty>{schedule || proposal ? 'Nenhum serviço neste dia.' : 'Gere a escala ou monte-a com os serviços cadastrados.'}</Empty> : (
          <>
            <div className="table-wrap escala-table">
              <table className="table sheet-table">
                <colgroup><col className="c-n" /><col className="c-line" /><col className="c-bus" /><col className="c-time" /><col className="c-shift" /><col /><col /><col className="c-act" /></colgroup>
                <thead><tr><th className="c">#</th><th>Linha</th><th>Ônibus</th><th>Horário</th><th>Turno</th><th>Motorista</th><th>Cobrador</th><th className="c">Ações</th></tr></thead>
                <tbody>
                  {list.map((e, i) => {
                    const iss = issuesByEntry.get(e.id) ?? [];
                    const c = cells(e);
                    const rowErr = iss.some((x) => x.severity === 'error' && !x.role);
                    return (
                      <tr key={e.id} className={rowErr ? 'row-err' : ''} title={iss.filter((x) => !x.role).map((x) => x.message).join('\n')}>
                        <td className="c muted">{i + 1}</td>
                        <td>{c.line}</td>
                        <td>{c.bus}</td>
                        <td>{c.time}</td>
                        <td>{c.shift}</td>
                        <td>{personSelect(e, 'driver', iss.filter((x) => x.role === 'driver'))}</td>
                        <td>{personSelect(e, 'conductor', iss.filter((x) => x.role === 'conductor'))}</td>
                        <td className="c">{actions(e) ?? <span className="muted small">—</span>}</td>
                      </tr>
                    );
                  })}
                  {list.length === 0 && <tr><td colSpan={8} className="muted c">Nenhum serviço neste dia.</td></tr>}
                </tbody>
              </table>
              {editable && <button className="add-row" onClick={() => addRow(dayDate)}><Icon.plus /> Adicionar serviço</button>}
            </div>

            <div className="entry-cards">
              {list.map((e) => {
                const iss = issuesByEntry.get(e.id) ?? [];
                const c = cells(e);
                return (
                  <div key={e.id} className={`entry-card ${shiftTone(e.shiftName)}`}>
                    <div className="ec-top">
                      <span className="ec-time">{e.startTime} - {e.endTime}</span>
                      {actions(e)}
                    </div>
                    {editable ? (
                      <div className="ec-grid">
                        <label>Linha{c.line}</label><label>Ônibus{c.bus}</label>
                        <label>Horário{c.time}</label><label>Turno{c.shift}</label>
                      </div>
                    ) : (
                      <>
                        <div className="ec-line">Linha {e.lineCode}</div>
                        <div className="muted small">{e.busFleet ? `${e.busFleet}${e.busPlate ? ` - ${e.busPlate}` : ''}` : 'carro a definir'} · {e.shiftName}</div>
                      </>
                    )}
                    <div className="ec-people">
                      <span className="ec-ico blue"><Icon.user /></span>{personSelect(e, 'driver', iss.filter((x) => x.role === 'driver'))}
                      <span className="ec-ico amber"><Icon.user /></span>{personSelect(e, 'conductor', iss.filter((x) => x.role === 'conductor'))}
                    </div>
                    {iss.length > 0 && <ul className="small entry-issues">{iss.map((x, k) => <li key={k} className={x.severity === 'error' ? 'cell-err' : ''}>{x.message}</li>)}</ul>}
                  </div>
                );
              })}
              {editable && <button className="btn btn-block" onClick={() => addRow(dayDate)}><Icon.plus /> Adicionar serviço</button>}
            </div>
          </>
        )}
        <datalist id="shift-list">{shiftNames.map((s) => <option key={s} value={s} />)}</datalist>
      </div>

      {pending && (
        <div className="save-bar no-print">
          <div className="save-bar-text">
            <strong>{proposal ? 'Sorteio não salvo' : 'Alterações não salvas'}</strong>
            <span>{errorsCount ? `${errorsCount} regra(s) violada(s) — corrija para salvar` : openCount ? `${openCount} pendência(s): pode salvar como rascunho` : 'Tudo certo'}</span>
          </div>
          <button className="btn" onClick={discard}>Descartar</button>
          <button className="btn btn-primary" disabled={busy || !online || errorsCount > 0 || (st === 'confirmada' && !canConfirm(issues))} onClick={() => void save()}>
            {st === 'confirmada' ? 'Salvar alterações' : schedule ? 'Salvar rascunho' : 'Salvar escala'}
          </button>
        </div>
      )}

      {swapping && ctx && (
        <SwapDialog source={swapping} entries={shown} ctx={ctx} onClose={() => setSwapping(null)}
          onApply={(next, label) => { mutate(() => next); setSwapping(null); toast(`Troca de ${label} aplicada. Salve para gravar.`); }} />
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
      {wa && <WhatsAppDialog saturday={sat} entries={shown} recipients={catalog.recipients} companyName={catalog.settings.companyName} demo={me?.mode === 'demo'} onClose={() => setWa(false)} />}
    </div>
  );
}

function ProposalSummary({ p }: { p: GenerateResponse }) {
  return (
    <div className="card proposal">
      <strong>Proposta de sorteio</strong> — {p.entries.length} serviço(s), {p.unfilled.length === 0 ? 'todas as vagas preenchidas.' : `${p.unfilled.length} vaga(s) sem preenchimento.`}
      {' '}Nada foi salvo ainda.
      {!p.exhaustive && <p className="muted small">A busca atingiu o limite de tentativas; pode existir distribuição melhor. Tente sortear novamente.</p>}
      {p.skipped.length > 0 && <p className="muted small">Serviços ignorados: {p.skipped.map((s) => s.reason).join('; ')}.</p>}
      {p.unfilled.length > 0 && (
        <details className="alert alert-warn">
          <summary><strong>Ver as {p.unfilled.length} vaga(s) sem preenchimento e as causas</strong> (nenhuma regra foi burlada)</summary>
          <ul>{p.unfilled.map((u) => (
            <li key={u.entryId + u.role}><strong>{u.description}</strong>
              <ul>{u.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </li>
          ))}</ul>
          <p className="small">Você pode salvar como rascunho incompleto e completar depois; a confirmação fica bloqueada até preencher todas as vagas.</p>
        </details>
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
