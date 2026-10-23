import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, send } from '../api';
import { useApp } from '../state';
import { PageHeader, IconAction } from '../components/PageHeader';
import { Icon } from '../components/Icons';
import { Empty, Field, Modal, fmtDateTime } from '../components/ui';
import { emptyRow, parseTable, type ExtraRow, type ExtraSchedule } from '../../shared/extras';
import { fmtDate, fmtHours, serviceMinutes, todayLocal, weekdayOf, WEEKDAY_LABEL } from '../../shared/time';

interface ListItem { id: number; title: string; date: string; status: 'rascunho' | 'publicada'; updatedAt: string; rows: number; files: number }

const ExtraBadge = ({ status }: { status: string }) =>
  <span className={`badge ${status === 'publicada' ? 'badge-ok' : 'badge-rascunho'}`}>{status === 'publicada' ? 'Publicada' : 'Rascunho'}</span>;

/** Escalas feitas fora do sistema (foto, PDF, planilha), publicadas para o app da equipe. */
export function ImportadasPage() {
  const { id } = useParams();
  return id ? <Editor id={Number(id)} /> : <Lista />;
}

function Lista() {
  const { online, toast } = useApp();
  const nav = useNavigate();
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('ESCALA');
  const [date, setDate] = useState(todayLocal());

  useEffect(() => { get<{ items: ListItem[] }>('/api/extras').then((r) => setItems(r.items)).catch((e) => setErr(e.message)); }, []);

  const create = async () => {
    try {
      const s = await send<ExtraSchedule>('POST', '/api/extras', { title: title.trim().toUpperCase(), date });
      nav(`/importadas/${s.id}`);
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div>
      <PageHeader title="Escalas importadas" subtitle="Escalas feitas fora do sistema (foto, PDF ou planilha) para a equipe ver no app"
        right={<button className="btn btn-primary" disabled={!online} onClick={() => setCreating(true)}><Icon.upload /> Nova escala importada</button>} />
      <div className="alert alert-info">
        Envie a <b>foto</b> ou o <b>PDF</b> da escala, confira as linhas na tabela e toque em <b>Publicar</b>. Os funcionários veem a escala no app da equipe,
        com os serviços deles em destaque. Estas escalas não alteram as escalas de fim de semana nem as regras do gerador.
      </div>
      {err && <div className="alert alert-err">{err}</div>}
      {!items ? <p className="muted">Carregando…</p> : items.length === 0 ? <Empty>Nenhuma escala importada ainda.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Data</th><th>Título</th><th>Linhas</th><th>Arquivos</th><th>Status</th><th>Atualizada</th><th /></tr></thead>
            <tbody>{items.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/importadas/${s.id}`)}>
                <td className="strong">{fmtDate(s.date)} <span className="muted small">{WEEKDAY_LABEL[weekdayOf(s.date)]}</span></td>
                <td>{s.title}</td><td>{s.rows}</td><td>{s.files}</td><td><ExtraBadge status={s.status} /></td>
                <td className="muted small">{fmtDateTime(s.updatedAt)}</td>
                <td><IconAction title="Abrir" onClick={() => nav(`/importadas/${s.id}`)}><Icon.edit /></IconAction></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && (
        <Modal title="Nova escala importada" onClose={() => setCreating(false)} footer={<>
          <button className="btn" onClick={() => setCreating(false)}>Cancelar</button>
          <button className="btn btn-primary" disabled={!title.trim() || !date} onClick={() => void create()}>Criar e enviar arquivo</button>
        </>}>
          <div className="form-grid">
            <Field label="Título" hint="Ex.: ESCALA DE ELEIÇÃO"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- arquivos ---------- */
const MAX = 3 * 1024 * 1024;
const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** Fotos do celular são grandes: reduz para no máximo 2400 px e JPEG, mantendo a tabela legível. */
async function prepareImage(file: File): Promise<{ mime: string; data: string; name: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= MAX) return { mime: 'image/jpeg', data: toB64(await blob.arrayBuffer()), name: file.name.replace(/\.\w+$/, '') + '.jpg' };
  }
  throw new Error('A foto ficou grande demais mesmo reduzida.');
}
const mimeOf = (f: File) => f.type || (/\.csv$/i.test(f.name) ? 'text/csv' : /\.xlsx$/i.test(f.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.pdf$/i.test(f.name) ? 'application/pdf' : '');

const COLS: { key: keyof ExtraRow; label: string; w: number }[] = [
  { key: 'seq', label: 'Seq', w: 64 }, { key: 'bus', label: 'Carro', w: 100 }, { key: 'start', label: 'Hora', w: 82 },
  { key: 'line', label: 'Linha', w: 88 }, { key: 'end', label: 'Rend.', w: 82 },
];

function Editor({ id }: { id: number }) {
  const { online, toast, catalog, me, reloadCatalog } = useApp();
  const [autoCreate, setAutoCreate] = useState(() => { try { return localStorage.getItem('eb-imp-autocreate') !== '0'; } catch { return true; } });
  const [created, setCreated] = useState<{ id: number; name: string; role: string; shiftName: string }[]>([]);
  const nav = useNavigate();
  const [s, setS] = useState<ExtraSchedule | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ExtraRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (x: ExtraSchedule) => { setS(x); setTitle(x.title); setDate(x.date); setNotes(x.notes ?? ''); setRows(x.rows); setDirty(false); };
  useEffect(() => {
    get<ExtraSchedule>(`/api/extras/${id}`).then(load).catch((e) => setErr(e.message));
    get<{ aiEnabled: boolean }>('/api/extras').then((r) => setAiOn(r.aiEnabled)).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const people = catalog?.people ?? [];
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const drivers = people.filter((p) => p.role === 'motorista' && p.active);
  const conductors = people.filter((p) => p.role === 'cobrador' && p.active);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  /** Grava; com "cadastrar nomes novos", quem não existe vira pessoa nova no cadastro. */
  const put = async () => {
    const x = await send<ExtraSchedule & { created: typeof created }>('PUT', `/api/extras/${id}`,
      { title: title.trim().toUpperCase(), date, notes: notes.trim() || null, rows, createMissing: autoCreate });
    if (x.created.length) { setCreated((c) => [...c, ...x.created]); void reloadCatalog(); }
    return x;
  };
  const save = () => run('Salvando…', async () => {
    const x = await put();
    load(x);
    const missing = x.rows.filter((r) => (r.driverName && r.driverId == null) || (r.conductorName && r.conductorId == null)).length;
    toast([x.created.length ? `${x.created.length} pessoa(s) cadastrada(s).` : '', missing ? `${missing} linha(s) com nome sem cadastro.` : ''].filter(Boolean).join(' ') || 'Escala salva.');
  });
  const setStatus = (status: 'rascunho' | 'publicada') => run(status === 'publicada' ? 'Publicando…' : 'Removendo…', async () => {
    if (dirty) await put();
    load(await send<ExtraSchedule>('POST', `/api/extras/${id}/status`, { status }));
    toast(status === 'publicada' ? 'Publicada! A equipe já vê no app.' : 'Escala retirada do app da equipe.');
  });
  const remove = () => {
    if (!confirm('Excluir esta escala importada e os arquivos dela?')) return;
    void run('Excluindo…', async () => { await send('DELETE', `/api/extras/${id}`); setDirty(false); nav('/importadas'); });
  };

  const applyRows = (incoming: ExtraRow[], how: 'replace' | 'append') => {
    setRows((cur) => (how === 'replace' ? incoming : [...cur, ...incoming]));
    setDirty(true);
  };
  const askApply = (incoming: ExtraRow[]) => {
    if (!incoming.length) { toast('Nenhuma linha reconhecida.', 'err'); return; }
    const how = rows.length && !confirm(`Foram lidas ${incoming.length} linhas.\n\nOK = substituir as ${rows.length} linhas atuais\nCancelar = acrescentar no fim`) ? 'append' : 'replace';
    applyRows(incoming, how);
    toast(`${incoming.length} linhas carregadas. Confira e salve.`);
  };

  const upload = (list: FileList | null) => {
    if (!list?.length) return;
    void run('Enviando arquivo…', async () => {
      let last: ExtraSchedule | null = null;
      for (const f of Array.from(list)) {
        const mime = mimeOf(f);
        let payload: { mime: string; data: string; name: string };
        if (mime.startsWith('image/')) payload = await prepareImage(f);
        else {
          if (f.size > MAX) throw new Error(`"${f.name}" passa de 3 MB.`);
          payload = { mime, data: toB64(await f.arrayBuffer()), name: f.name };
        }
        last = await send<ExtraSchedule>('POST', `/api/extras/${id}/files`, payload);
        if (mime === 'text/csv' || mime === 'text/plain') askApply(parseTable(await f.text()));
      }
      if (last) setS((cur) => (cur ? { ...cur, files: last!.files } : last));
      toast('Arquivo enviado.');
    });
  };
  const readAi = (fid: number) => run('Lendo a tabela… (até 1 minuto)', async () => {
    const r = await send<{ title: string; date: string; rows: ExtraRow[] }>('POST', `/api/extras/files/${fid}/read`);
    if (r.title && (!title.trim() || title.trim() === 'ESCALA')) setTitle(r.title);
    if (r.date && r.date !== date && confirm(`A data escrita na escala é ${fmtDate(r.date)}. Usar essa data?`)) setDate(r.date);
    askApply(r.rows);
  });
  const delFile = (fid: number) => {
    if (!confirm('Remover este arquivo?')) return;
    void run('Removendo…', async () => { await send('DELETE', `/api/extras/files/${fid}`); setS((cur) => cur && { ...cur, files: cur.files.filter((f) => f.id !== fid) }); });
  };

  const edit = (i: number, patch: Partial<ExtraRow>) => { setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r))); setDirty(true); };
  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // célula única: colagem normal
    e.preventDefault();
    const incoming = parseTable(text);
    if (!incoming.length) return;
    setRows((cur) => [...cur.slice(0, i), ...incoming, ...cur.slice(i + incoming.length)]);
    setDirty(true);
    toast(`${incoming.length} linhas coladas.`);
  };

  if (err && !s) return <div className="alert alert-err">{err}</div>;
  if (!s) return <p className="muted">Carregando…</p>;
  const linked = rows.filter((r) => r.driverId != null).length + rows.filter((r) => r.conductorId != null).length;
  const names = rows.filter((r) => r.driverName).length + rows.filter((r) => r.conductorName).length;
  const canEdit = online && !busy;

  return (
    <div>
      <PageHeader title={title || 'Escala importada'} subtitle={date ? `${WEEKDAY_LABEL[weekdayOf(date)]}, ${fmtDate(date)}` : ''}
        right={<>
          <button className="btn" onClick={() => { if (!dirty || confirm('Sair sem salvar as alterações?')) nav('/importadas'); }}><Icon.chevronLeft /> Voltar</button>
          {me?.isAdmin && <button className="btn btn-danger-ghost" disabled={!canEdit} onClick={remove}><Icon.trash /> Excluir</button>}
          {s.status === 'publicada'
            ? <button className="btn" disabled={!canEdit} onClick={() => void setStatus('rascunho')}>Retirar do app</button>
            : <button className="btn btn-success" disabled={!canEdit} onClick={() => void setStatus('publicada')}><Icon.check /> Publicar para a equipe</button>}
          <button className="btn btn-primary" disabled={!canEdit || (!dirty && !(autoCreate && linked < names))} onClick={() => void save()}>Salvar</button>
        </>} />
      <div className="imp-status">
        <ExtraBadge status={s.status} />
        {s.status === 'publicada' && s.publishedAt && <span className="muted small">Publicada em {fmtDateTime(s.publishedAt)}</span>}
        {dirty && <span className="badge badge-rascunho">Alterações não salvas</span>}
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {err && <div className="alert alert-err">{err}</div>}

      <div className="imp-grid">
        <section className="panel">
          <h2 className="panel-title">Dados da escala</h2>
          <div className="form-grid">
            <Field label="Título"><input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></Field>
            <Field label="Data"><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setDirty(true); }} /></Field>
          </div>
          <Field label="Observação para a equipe (opcional)"><textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} /></Field>
        </section>

        <section className="panel">
          <h2 className="panel-title">Arquivo original</h2>
          <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.pdf,.csv,text/csv,.xlsx" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          <button className="imp-drop" disabled={!canEdit} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
            <Icon.upload />
            <strong>Enviar foto, PDF ou planilha</strong>
            <span>Toque para escolher ou tirar foto · arraste o arquivo aqui</span>
          </button>
          {s.files.map((f) => (
            <div key={f.id} className="imp-file">
              {f.mime.startsWith('image/') ? <img src={`/api/extras/files/${f.id}`} alt="" /> : <span className="imp-file-icon"><Icon.pdf /></span>}
              <div className="imp-file-text">
                <a href={`/api/extras/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a>
                <span className="muted small">{(f.size / 1024).toFixed(0)} KB</span>
              </div>
              {(f.mime.startsWith('image/') || f.mime === 'application/pdf') && (
                aiOn
                  ? <button className="btn btn-sm btn-primary" disabled={!canEdit} onClick={() => void readAi(f.id)}><Icon.dice /> Ler tabela</button>
                  : <span className="muted small" title="Configure ANTHROPIC_API_KEY no servidor para ler fotos automaticamente">Leitura automática desligada</span>
              )}
              <IconAction kind="danger" title="Remover arquivo" disabled={!canEdit} onClick={() => delFile(f.id)}><Icon.trash /></IconAction>
            </div>
          ))}
        </section>
      </div>

      <section className="sheet">
        <div className="imp-sheet-head">
          <div>
            <h2>Linhas da escala <span className="muted small">({rows.length})</span></h2>
            <p className="muted small">Edite direto na tabela. Para trazer do Excel, copie as células e cole em qualquer célula (ou use "Colar do Excel").
              {names > 0 && <> · <b>{linked}</b> de {names} nomes ligados ao cadastro</>}</p>
          </div>
          <div className="imp-actions">
            <button className="btn btn-sm" disabled={!canEdit} onClick={() => setPasteOpen(true)}>Colar do Excel</button>
            <button className="btn btn-sm" disabled={!canEdit} onClick={() => { setRows((c) => [...c, { ...emptyRow(), seq: String(c.length + 1) }]); setDirty(true); }}><Icon.plus /> Linha</button>
            {rows.length > 0 && <button className="btn btn-sm" disabled={!canEdit} onClick={() => { if (confirm('Apagar todas as linhas da tabela?')) { setRows([]); setDirty(true); } }}><Icon.eraser /> Limpar</button>}
          </div>
        </div>
        <label className="check imp-auto">
          <input type="checkbox" checked={autoCreate} onChange={(e) => { setAutoCreate(e.target.checked); try { localStorage.setItem('eb-imp-autocreate', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
          <span>Ao salvar, <b>cadastrar automaticamente</b> em Pessoas os nomes que não existem (função pela coluna; turno Manhã se começa antes das 10h, senão Tarde). Nomes com uma palavra só ou parecidos com alguém do cadastro não são criados — escolha na lista.</span>
        </label>
        {created.length > 0 && (
          <div className="alert alert-ok">
            <b>{created.length} pessoa(s) cadastrada(s) automaticamente:</b> {created.map((c) => `${c.name} (${c.role === 'motorista' ? 'motorista' : 'cobrador'}, ${c.shiftName})`).join(' · ')}.
            {' '}Confira em <Link to="/pessoas">Pessoas</Link> (telefone, turno e disponibilidade).
          </div>
        )}
        <datalist id="imp-drivers">{drivers.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        <datalist id="imp-conductors">{conductors.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        {rows.length === 0 ? <Empty>Sem linhas. Envie a foto e toque em "Ler tabela", cole do Excel ou adicione linha por linha.</Empty> : (
          <div className="table-wrap">
            <table className="table sheet-table imp-table">
              <colgroup>{COLS.map((c) => <col key={c.key} style={{ width: c.w }} />)}<col style={{ width: 64 }} /><col /><col /><col style={{ width: 52 }} /></colgroup>
              <thead><tr>{COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th title="Horas estimadas: de HORA até REND.">Horas</th><th>Motorista</th><th>Cobrador</th><th /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>
                  {COLS.map((c) => (
                    <td key={c.key}>
                      <input className="cell-input" value={r[c.key] as string} disabled={!canEdit} onPaste={onPaste(i)}
                        onChange={(e) => edit(i, { [c.key]: e.target.value } as Partial<ExtraRow>)} />
                    </td>
                  ))}
                  <td className="muted nowrap">{serviceMinutes(r.start, r.end) ? fmtHours(serviceMinutes(r.start, r.end)) : '—'}</td>
                  <NameCell value={r.driverName} id={r.driverId} list="imp-drivers" nameOf={nameOf} disabled={!canEdit} onPaste={onPaste(i)}
                    onChange={(v) => edit(i, { driverName: v.toUpperCase(), driverId: null })} />
                  <NameCell value={r.conductorName} id={r.conductorId} list="imp-conductors" nameOf={nameOf} disabled={!canEdit} onPaste={onPaste(i)}
                    onChange={(v) => edit(i, { conductorName: v.toUpperCase(), conductorId: null })} />
                  <td><IconAction kind="danger" title="Remover linha" disabled={!canEdit} onClick={() => { setRows((c) => c.filter((_, k) => k !== i)); setDirty(true); }}><Icon.trash /></IconAction></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: '.6rem' }}>
          <span className="imp-dot ok" /> ligado ao cadastro (aparece em "Meus serviços" no app) · <span className="imp-dot no" /> nome não encontrado no cadastro
        </p>
      </section>

      {pasteOpen && (
        <Modal title="Colar do Excel" onClose={() => setPasteOpen(false)} wide footer={<>
          <button className="btn" onClick={() => setPasteOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" disabled={!pasteText.trim()} onClick={() => { askApply(parseTable(pasteText)); setPasteOpen(false); setPasteText(''); }}>Carregar linhas</button>
        </>}>
          <p className="muted small">No Excel ou Google Planilhas, selecione a tabela (com ou sem o cabeçalho SEQ, CARRO, HORA, LINHA, REND., MOTORISTA, COBRADOR), copie e cole aqui. Também aceita CSV.</p>
          <textarea rows={12} className="mono" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'1\t541681\t04:45\t0.783\t11:36\tFRANCISCO IVANILDO\tYASMIM GOMES'} />
        </Modal>
      )}
    </div>
  );
}

function NameCell({ value, id, list, nameOf, disabled, onChange, onPaste }: {
  value: string; id: number | null; list: string; nameOf: Map<number, string>; disabled: boolean;
  onChange: (v: string) => void; onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
}) {
  const state = !value.trim() ? '' : id != null ? 'ok' : 'no';
  const title = id != null ? `Cadastro: ${nameOf.get(id) ?? '#' + id}` : value.trim() ? 'Nome não encontrado no cadastro de pessoas (salve para verificar)' : '';
  return (
    <td className="imp-name">
      <span className={`imp-dot ${state}`} title={title} />
      <input className="cell-input" list={list} value={value} disabled={disabled} title={title} onPaste={onPaste} onChange={(e) => onChange(e.target.value)} />
    </td>
  );
}
