import { useMemo, useState } from 'react';
import { Field, Modal } from './ui';
import type { Entry, Person, Recipient } from '../../shared/types';
import { buildPersonMessage, buildScheduleMessage, formatPhone, normalizePhone, phoneProblem, waLink } from '../../shared/whatsapp';
import { buildReportDay } from '../../shared/report';
import { fmtDate, sundayOf } from '../../shared/time';

const LONG = 3500; // mensagens muito longas podem falhar ao abrir pelo link

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/** Fluxo: destinatário → sábado/domingo/fim de semana (ou turno) → pré-visualização → abrir wa.me. */
export function WhatsAppDialog({ saturday, entries, recipients, companyName, demo, onClose }: {
  saturday: string; entries: Entry[]; recipients: Recipient[]; companyName: string; demo: boolean; onClose: () => void;
}) {
  const sun = sundayOf(saturday);
  const [rid, setRid] = useState<string>(recipients[0] ? String(recipients[0].id) : '');
  const [manual, setManual] = useState('');
  const [scope, setScope] = useState<'sat' | 'sun' | 'both'>('both');
  const [shift, setShift] = useState('');
  const [copied, setCopied] = useState(false);

  const dates = scope === 'sat' ? [saturday] : scope === 'sun' ? [sun] : [saturday, sun];
  const shifts = useMemo(() => [...new Set(dates.flatMap((d) => buildReportDay(entries, d).sections.map((s) => s.shiftName)))], [entries, scope]); // eslint-disable-line
  const text = useMemo(() => buildScheduleMessage(entries, { companyName, dates, shiftName: shift || undefined, demo }), [entries, companyName, scope, shift, demo]); // eslint-disable-line
  const phone = rid === 'manual' ? manual : recipients.find((r) => String(r.id) === rid)?.phone ?? '';
  const pErr = phone ? phoneProblem(phone) : 'Escolha um destinatário.';

  return (
    <Modal title="Enviar pelo WhatsApp" onClose={onClose} wide footer={<>
      <button className="btn" onClick={async () => { setCopied(await copy(text)); }}>{copied ? '✔ Copiado' : 'Copiar mensagem'}</button>
      <a className={`btn btn-whatsapp ${pErr ? 'disabled' : ''}`} aria-disabled={!!pErr} href={pErr ? undefined : waLink(phone, text)} target="_blank" rel="noopener noreferrer"
        onClick={(e) => { if (pErr) e.preventDefault(); }}>Abrir no WhatsApp</a>
    </>}>
      <div className="form-grid two">
        <Field label="1. Destinatário" error={rid ? pErr : null}>
          <select value={rid} onChange={(e) => setRid(e.target.value)}>
            <option value="">— escolha —</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.name} · {formatPhone(r.phone)}</option>)}
            <option value="manual">Outro número…</option>
          </select>
        </Field>
        {rid === 'manual' && <Field label="Número (país + DDD)"><input type="tel" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="+55 11 98765-4321" /></Field>}
        <Field label="2. Período">
          <select value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setShift(''); }}>
            <option value="both">Fim de semana completo</option>
            <option value="sat">Sábado {fmtDate(saturday)}</option>
            <option value="sun">Domingo {fmtDate(sun)}</option>
          </select>
        </Field>
        <Field label="Turno (para dividir mensagens grandes)">
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">Todos os turnos</option>
            {shifts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label={`3. Pré-visualização (${text.length} caracteres)`}>
        <textarea className="wa-preview" readOnly value={text} rows={14} />
      </Field>
      {text.length > LONG && <div className="alert alert-warn">Mensagem grande: se o WhatsApp não abrir com o texto completo, envie por dia ou por turno, ou use "Copiar mensagem".</div>}
      <p className="muted small">4. O botão apenas abre a conversa com a mensagem pronta; você confirma o envio no WhatsApp. O link wa.me não anexa PDF — use "Baixar PDF" ou "Compartilhar PDF".</p>
      {!pErr && <p className="muted small">Número usado: {normalizePhone(phone)}</p>}
    </Modal>
  );
}

/** Envio individual: a escala de cada pessoa para o WhatsApp cadastrado nela. */
export function PersonWhatsAppDialog({ entries, people, companyName, demo, onClose }: {
  entries: Entry[]; people: Person[]; companyName: string; demo: boolean; onClose: () => void;
}) {
  const ids = new Set(entries.flatMap((e) => [e.driverId, e.conductorId]).filter((x): x is number => x != null));
  const list = [...ids].map((id) => {
    const p = people.find((x) => x.id === id);
    const e = entries.find((x) => x.driverId === id || x.conductorId === id)!;
    return { id, name: p?.name ?? (e.driverId === id ? e.driverName : e.conductorName), phone: p?.whatsapp ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const [sel, setSel] = useState<number | null>(null);
  const cur = list.find((x) => x.id === sel);
  const text = cur ? buildPersonMessage(cur.id, cur.name, entries, { companyName, demo }) : '';
  return (
    <Modal title="Enviar escala individual" onClose={onClose} wide>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Pessoa</th><th>WhatsApp</th><th></th></tr></thead>
        <tbody>{list.map((p) => {
          const bad = !p.phone || !!phoneProblem(p.phone);
          return (
            <tr key={p.id} className={sel === p.id ? 'row-sel' : ''}>
              <td>{p.name}</td><td>{p.phone ? formatPhone(p.phone) : <span className="muted">sem WhatsApp cadastrado</span>}</td>
              <td className="actions">
                <button className="btn btn-sm" onClick={() => setSel(p.id)}>Ver mensagem</button>
                {!bad && <a className="btn btn-sm btn-whatsapp" target="_blank" rel="noopener noreferrer" href={waLink(p.phone!, buildPersonMessage(p.id, p.name, entries, { companyName, demo }))}>WhatsApp</a>}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {cur && <Field label={`Mensagem para ${cur.name}`}><textarea className="wa-preview" readOnly rows={8} value={text} /></Field>}
    </Modal>
  );
}
