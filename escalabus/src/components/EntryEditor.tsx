import { useMemo, useState } from 'react';
import { Field, Modal } from './ui';
import type { AssignRole, Entry, Person } from '../../shared/types';
import { candidateProblem, validateSchedule, type RuleContext, indexConfirmed } from '../../shared/rules';
import { crossesMidnight, dayLabel, fmtDate, sundayOf } from '../../shared/time';
import type { Catalog } from '../types';

/** Opções de pessoas para uma vaga, com o motivo de inelegibilidade (quando houver). */
export function personOptions(entry: Entry, role: AssignRole, entries: Entry[], ctx: RuleContext, catalog: Catalog, historyCounts: Record<number, number>) {
  const roleName = role === 'driver' ? 'motorista' : 'cobrador';
  const current = role === 'driver' ? entry.driverId : entry.conductorId;
  const base = ctx.baseline?.find((b) => b.id === entry.id);
  const confirmedIdx = indexConfirmed(ctx.otherConfirmed);
  const others = entries.filter((e) => e.id !== entry.id);
  const people = catalog.people.filter((p) => p.role === roleName && (p.active || p.id === current));
  return people.map((p) => {
    const keep = !!base && (role === 'driver' ? base.driverId : base.conductorId) === p.id &&
      base.date === entry.date && base.startTime === entry.startTime && base.endTime === entry.endTime;
    const pr = candidateProblem(entry, role, p, { settings: ctx.settings, confirmedIdx }, others, { skipCadastro: keep });
    return { person: p, problem: pr?.text ?? null, count: historyCounts[p.id] ?? 0 };
  }).sort((a, b) => Number(!!a.problem) - Number(!!b.problem) || a.count - b.count || a.person.name.localeCompare(b.person.name, 'pt-BR'));
}

export function EntryEditor({ initial, entries, ctx, catalog, historyCounts, onClose, onApply }: {
  initial: Entry; entries: Entry[]; ctx: RuleContext; catalog: Catalog; historyCounts: Record<number, number>;
  onClose: () => void; onApply: (e: Entry) => void;
}) {
  const [e, setE] = useState<Entry>(initial);
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setE((x) => ({ ...x, [k]: v }));
  const sat = ctx.saturday, sun = sundayOf(sat);
  const merged = useMemo(() => {
    const exists = entries.some((x) => x.id === e.id);
    return exists ? entries.map((x) => (x.id === e.id ? e : x)) : [...entries, e];
  }, [entries, e]);
  const myIssues = useMemo(() => validateSchedule(merged, ctx).filter((i) => i.entryId === e.id), [merged, ctx, e.id]);
  const drivers = useMemo(() => personOptions(e, 'driver', merged, ctx, catalog, historyCounts), [e, merged, ctx, catalog, historyCounts]);
  const conductors = useMemo(() => personOptions(e, 'conductor', merged, ctx, catalog, historyCounts), [e, merged, ctx, catalog, historyCounts]);

  const pick = (role: AssignRole, id: string) => {
    const pid = id ? Number(id) : null;
    const p: Person | undefined = catalog.people.find((x) => x.id === pid);
    if (role === 'driver') setE((x) => ({ ...x, driverId: pid, driverName: p?.name ?? '' }));
    else setE((x) => ({ ...x, conductorId: pid, conductorName: p?.name ?? '' }));
  };
  const errors = myIssues.filter((i) => i.severity === 'error');

  return (
    <Modal title="Editar serviço da escala" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={errors.length > 0} onClick={() => onApply(e)} title={errors.length ? 'Corrija as regras violadas' : ''}>Aplicar</button>
    </>}>
      <div className="form-grid two">
        <Field label="Dia / data">
          <select value={e.date} onChange={(ev) => set('date', ev.target.value)}>
            <option value={sat}>Sábado {fmtDate(sat)}</option>
            <option value={sun}>Domingo {fmtDate(sun)}</option>
          </select>
        </Field>
        <Field label="Turno">
          <input value={e.shiftName} onChange={(ev) => set('shiftName', ev.target.value)} list="entry-shifts" maxLength={60} />
          <datalist id="entry-shifts">{[...new Set(catalog.services.map((s) => s.shiftName))].map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Linha">
          <select value={e.lineId ?? ''} onChange={(ev) => {
            const l = catalog.lines.find((x) => x.id === Number(ev.target.value));
            setE((x) => ({ ...x, lineId: l?.id ?? null, lineCode: l?.code ?? '', lineDescription: l?.description ?? null }));
          }}>
            <option value="">— selecione —</option>
            {catalog.lines.filter((l) => l.active || l.id === e.lineId).map((l) => <option key={l.id} value={l.id}>{l.code}{l.active ? '' : ' (inativa)'}{l.description ? ` – ${l.description}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Ônibus (carro / placa)">
          <select value={e.busId ?? ''} onChange={(ev) => {
            const b = catalog.buses.find((x) => x.id === Number(ev.target.value));
            setE((x) => ({ ...x, busId: b?.id ?? null, busFleet: b?.fleetNumber ?? '', busPlate: b?.plate ?? '' }));
          }}>
            <option value="">— selecione —</option>
            {catalog.buses.filter((b) => b.active || b.id === e.busId).map((b) => <option key={b.id} value={b.id}>{b.fleetNumber} – {b.plate}{b.active ? '' : ' (inativo)'}</option>)}
          </select>
        </Field>
        <Field label="Horário inicial"><input type="time" value={e.startTime} onChange={(ev) => set('startTime', ev.target.value)} /></Field>
        <Field label="Horário final (rendição)" hint={e.startTime && e.endTime && crossesMidnight(e.startTime, e.endTime) ? 'Termina no dia seguinte' : undefined}>
          <input type="time" value={e.endTime} onChange={(ev) => set('endTime', ev.target.value)} />
        </Field>
        <Field label="Motorista">
          <select value={e.driverId ?? ''} onChange={(ev) => pick('driver', ev.target.value)}>
            <option value="">— vaga aberta —</option>
            {drivers.map(({ person: p, problem, count }) => (
              <option key={p.id} value={p.id} disabled={!!problem && p.id !== e.driverId}>
                {p.name} · {p.shiftName} · {count} esc.{problem ? ` — ${problem}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cobrador">
          <select value={e.conductorId ?? ''} onChange={(ev) => pick('conductor', ev.target.value)}>
            <option value="">— vaga aberta —</option>
            {conductors.map(({ person: p, problem, count }) => (
              <option key={p.id} value={p.id} disabled={!!problem && p.id !== e.conductorId}>
                {p.name} · {p.shiftName} · {count} esc.{problem ? ` — ${problem}` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted small">Pessoas indisponíveis aparecem desativadas com o motivo. "esc." = participações confirmadas no histórico.</p>
      {myIssues.length > 0 && (
        <div className={`alert ${errors.length ? 'alert-err' : 'alert-warn'}`}>
          <ul>{myIssues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

export function SwapDialog({ source, entries, ctx, onClose, onApply }: {
  source: Entry; entries: Entry[]; ctx: RuleContext; onClose: () => void; onApply: (entries: Entry[], label: string) => void;
}) {
  const [field, setField] = useState<'driver' | 'conductor' | 'line' | 'bus'>('driver');
  const [target, setTarget] = useState('');
  const labels = { driver: 'motoristas', conductor: 'cobradores', line: 'linhas', bus: 'ônibus' };
  const result = useMemo(() => {
    if (!target) return null;
    const t = entries.find((x) => x.id === target)!;
    const keys: Record<typeof field, (keyof Entry)[]> = {
      driver: ['driverId', 'driverName'], conductor: ['conductorId', 'conductorName'],
      line: ['lineId', 'lineCode', 'lineDescription'], bus: ['busId', 'busFleet', 'busPlate'],
    };
    // As duas alterações são aplicadas juntas e só o estado final é validado (troca atômica).
    const next = entries.map((x) => {
      if (x.id !== source.id && x.id !== t.id) return x;
      const other = x.id === source.id ? t : source;
      const c = { ...x } as Record<string, unknown>;
      for (const k of keys[field]) c[k] = other[k];
      return c as unknown as Entry;
    });
    const before = new Set(validateSchedule(entries, ctx).filter((i) => i.severity === 'error').map((i) => i.message));
    const errs = validateSchedule(next, ctx).filter((i) => i.severity === 'error' && !before.has(i.message));
    return { next, errs };
  }, [target, field, entries, source, ctx]);

  const desc = (x: Entry) => `${dayLabel(x.date)} ${x.startTime}–${x.endTime} · linha ${x.lineCode || '?'} · carro ${x.busFleet || '?'} · ${field === 'driver' ? x.driverName || '(vazio)' : field === 'conductor' ? x.conductorName || '(vazio)' : ''}`;
  return (
    <Modal title="Trocar entre duas vagas" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={!result || result.errs.length > 0} onClick={() => result && onApply(result.next, labels[field])}>Trocar</button>
    </>}>
      <p><strong>Vaga de origem:</strong> {desc(source)}</p>
      <div className="form-grid two">
        <Field label="O que trocar">
          <select value={field} onChange={(e) => setField(e.target.value as typeof field)}>
            <option value="driver">Motoristas</option><option value="conductor">Cobradores</option><option value="line">Linhas</option><option value="bus">Ônibus</option>
          </select>
        </Field>
        <Field label="Com a vaga">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— escolha —</option>
            {entries.filter((x) => x.id !== source.id).map((x) => <option key={x.id} value={x.id}>{desc(x)}</option>)}
          </select>
        </Field>
      </div>
      {result && (result.errs.length ? (
        <div className="alert alert-err"><strong>A troca violaria regras:</strong><ul>{result.errs.map((i, k) => <li key={k}>{i.message}</li>)}</ul></div>
      ) : <div className="alert alert-ok">Troca válida. As duas vagas serão alteradas juntas.</div>)}
    </Modal>
  );
}
