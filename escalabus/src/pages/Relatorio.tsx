import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getCached, recallLast } from '../api';
import { useApp } from '../state';
import { PageHeader } from '../components/PageHeader';
import { Empty, Field, fmtDateTime, StatusBadge } from '../components/ui';
import { PersonWhatsAppDialog, WhatsAppDialog } from '../components/WhatsAppDialog';
import { buildPdf, pdfFileName } from '../pdf';
import type { WeekendData } from '../types';
import { buildReportDay } from '../../shared/report';
import { addDays, crossesMidnight, isSaturday, nextSaturday, sundayOf, todayLocal } from '../../shared/time';

export function RelatorioPage() {
  const { catalog, me, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const init = params.get('sabado');
  const [saturday, setSaturday] = useState(init && isSaturday(init) ? init : (recallLast('saturday') ?? nextSaturday(todayLocal())));
  const [scope, setScope] = useState<'sat' | 'sun' | 'both'>('both');
  const [detailed, setDetailed] = useState(false);
  const [data, setData] = useState<WeekendData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wa, setWa] = useState<null | 'group' | 'person'>(null);

  useEffect(() => {
    setParams({ sabado: saturday }, { replace: true });
    setErr(null);
    getCached<WeekendData>(`/api/weekend/${saturday}`)
      .then((r) => { setData(r.data); setSavedAt(r.savedAt); setFromCache(r.fromCache); })
      .catch((e) => { setData(null); setErr(e.message); });
  }, [saturday, setParams]);

  const schedule = data?.schedule;
  const dates = scope === 'sat' ? [saturday] : scope === 'sun' ? [sundayOf(saturday)] : [saturday, sundayOf(saturday)];
  const days = useMemo(() => (schedule ? dates.map((d) => buildReportDay(schedule.entries, d)) : []), [schedule, scope, saturday]); // eslint-disable-line
  const company = catalog?.settings.companyName ?? '';
  const demo = me?.mode === 'demo';
  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator;

  const makePdf = () => buildPdf(schedule!.entries, { companyName: company, dates, detailed, status: schedule!.status, demo });
  const download = () => makePdf().save(pdfFileName(dates, demo));
  const share = async () => {
    const blob = makePdf().output('blob');
    const file = new File([blob], pdfFileName(dates, demo), { type: 'application/pdf' });
    if (!navigator.canShare?.({ files: [file] })) { toast('Este dispositivo não permite compartilhar arquivos. Use "Baixar PDF".', 'err'); return; }
    try { await navigator.share({ files: [file], title: days.map((d) => d.title).join(' / ') }); } catch { /* cancelado */ }
  };

  return (
    <div>
      <div className="no-print"><PageHeader title="Relatórios" subtitle="Escala para impressão, PDF A4 e envio pelo WhatsApp" /></div>
      <div className="toolbar card no-print">
        <div className="weekend-picker">
          <button className="btn btn-sm" onClick={() => setSaturday(addDays(saturday, -7))}>◀</button>
          <Field label="Sábado"><input type="date" value={saturday} onChange={(e) => { if (isSaturday(e.target.value)) setSaturday(e.target.value); else toast('Escolha um sábado.', 'err'); }} /></Field>
          <button className="btn btn-sm" onClick={() => setSaturday(addDays(saturday, 7))}>▶</button>
        </div>
        <Field label="Dias">
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="both">Sábado e domingo</option><option value="sat">Somente sábado</option><option value="sun">Somente domingo</option>
          </select>
        </Field>
        <label className="check"><input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} /> Detalhado (com placa)</label>
        {schedule && <StatusBadge status={schedule.status} />}
        {fromCache && <span className="muted small">Cópia offline de {fmtDateTime(savedAt)}</span>}
      </div>
      {err && <div className="alert alert-err no-print">{err}</div>}
      {data && !schedule && <Empty>Não há escala salva para este fim de semana. <Link to={`/escala?sabado=${saturday}`}>Ir para a escala</Link></Empty>}
      {schedule && (
        <>
          <div className="actionbar no-print">
            <button className="btn btn-primary" onClick={() => window.print()}>🖨 Imprimir</button>
            <button className="btn" onClick={download}>⬇ Baixar PDF (A4)</button>
            {canShare && <button className="btn" onClick={() => void share()}>Compartilhar PDF</button>}
            <button className="btn btn-whatsapp" onClick={() => setWa('group')}>Enviar pelo WhatsApp</button>
            <button className="btn" onClick={() => setWa('person')}>Envio individual</button>
          </div>
          {schedule.status !== 'confirmada' && <div className="alert alert-warn no-print">Esta escala está como <strong>{schedule.status}</strong> e ainda não foi confirmada.</div>}
          <div className="report">
            {days.map((d) => (
              <article className="report-day" key={d.date}>
                <header className="report-head">
                  <div className="report-company">{company}{demo ? ' · DEMONSTRAÇÃO – DADOS FICTÍCIOS' : ''}{schedule.status !== 'confirmada' ? ` · ${schedule.status.toUpperCase()}` : ''}</div>
                  <h2 className="report-title">{d.title}</h2>
                </header>
                {d.sections.length === 0 && <p>Sem serviços neste dia.</p>}
                {d.sections.map((s) => (
                  <table className="report-table" key={s.shiftName}>
                    <colgroup>
                      <col style={{ width: '5%' }} /><col style={{ width: '8%' }} />{detailed && <col style={{ width: '10%' }} />}
                      <col style={{ width: '7%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col /><col />
                    </colgroup>
                    <thead>
                      <tr><th colSpan={detailed ? 8 : 7} className="report-shift">TURNO: {s.shiftName.toUpperCase()}</th></tr>
                      <tr><th>SEQ</th><th>CARRO</th>{detailed && <th>PLACA</th>}<th>HORA</th><th>LINHA</th><th>REND.</th><th>MOTORISTA</th><th>COBRADOR</th></tr>
                    </thead>
                    <tbody>
                      {s.rows.map(({ seq, entry: e }) => (
                        <tr key={e.id}>
                          <td className="c">{seq}</td><td className="c">{e.busFleet}</td>{detailed && <td className="c">{e.busPlate}</td>}
                          <td className="c">{e.startTime}</td><td className="c">{e.lineCode}</td>
                          <td className="c">{e.endTime}{crossesMidnight(e.startTime, e.endTime) ? '*' : ''}</td>
                          <td>{e.driverName || '—'}</td><td>{e.conductorName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
                {d.sections.some((s) => s.rows.some((r) => crossesMidnight(r.entry.startTime, r.entry.endTime))) && <p className="report-note">* rendição no dia seguinte</p>}
              </article>
            ))}
          </div>
          {wa === 'group' && catalog && <WhatsAppDialog saturday={saturday} entries={schedule.entries} recipients={catalog.recipients} companyName={company} demo={demo} onClose={() => setWa(null)} />}
          {wa === 'person' && catalog && <PersonWhatsAppDialog entries={schedule.entries.filter((e) => dates.includes(e.date))} people={catalog.people} companyName={company} demo={demo} onClose={() => setWa(null)} />}
        </>
      )}
    </div>
  );
}
