import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Entry } from '../shared/types';
import { buildReportDay } from '../shared/report';
import { crossesMidnight } from '../shared/time';

export interface PdfOptions {
  companyName: string;
  dates: string[];
  detailed: boolean;
  status: string;
  demo: boolean;
}

/**
 * Gera o relatório em PDF A4 (retrato): um dia por página inicial, seções por turno,
 * cabeçalho da tabela repetido em cada seção e em páginas adicionais, nomes com quebra de linha (sem corte).
 */
export function buildPdf(entries: Entry[], opt: PdfOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const margin = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const head = opt.detailed
    ? ['SEQ', 'CARRO', 'PLACA', 'HORA', 'LINHA', 'REND.', 'MOTORISTA', 'COBRADOR']
    : ['SEQ', 'CARRO', 'HORA', 'LINHA', 'REND.', 'MOTORISTA', 'COBRADOR'];
  const narrow = opt.detailed
    ? { 0: 10, 1: 14, 2: 19, 3: 13, 4: 16, 5: 17 }
    : { 0: 10, 1: 15, 2: 13, 3: 17, 4: 18 };

  // Larguras fixas: colunas alinhadas entre os turnos; nomes quebram linha em vez de serem cortados.
  const usable = pageW - 2 * margin;
  const nameW = (usable - Object.values(narrow).reduce((a, b) => a + b, 0)) / 2;
  const nameCols = opt.detailed ? [6, 7] : [5, 6];

  opt.dates.forEach((date, di) => {
    if (di > 0) doc.addPage();
    const day = buildReportDay(entries, date);
    const currentTitle = day.title;
    const drawHeader = (cont: boolean) => {
      doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(opt.companyName, margin, 9);
      const flags = [opt.status !== 'confirmada' ? opt.status.toUpperCase() + ' – NÃO CONFIRMADA' : '', opt.demo ? 'DEMONSTRAÇÃO – DADOS FICTÍCIOS' : ''].filter(Boolean).join(' · ');
      if (flags) doc.text(flags, pageW - margin, 9, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(currentTitle + (cont ? ' (continuação)' : ''), pageW / 2, 16, { align: 'center' });
    };
    drawHeader(false);
    let y = 21;
    if (day.sections.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text('Sem serviços neste dia.', margin, y + 6);
      return;
    }
    let lastHeaderPage = doc.getNumberOfPages();
    for (const s of day.sections) {
      if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); drawHeader(true); lastHeaderPage = doc.getNumberOfPages(); y = 21; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(`TURNO: ${s.shiftName.toUpperCase()}`, margin, y + 4);
      autoTable(doc, {
        startY: y + 6,
        margin: { left: margin, right: margin, top: 21 },
        head: [head],
        body: s.rows.map(({ seq, entry: e }) => {
          const rend = e.endTime + (crossesMidnight(e.startTime, e.endTime) ? '*' : '');
          return opt.detailed
            ? [seq, e.busFleet, e.busPlate, e.startTime, e.lineCode, rend, e.driverName || '—', e.conductorName || '—']
            : [seq, e.busFleet, e.startTime, e.lineCode, rend, e.driverName || '—', e.conductorName || '—'];
        }),
        showHead: 'everyPage',
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, textColor: 0, fillColor: [255, 255, 255], lineColor: [0, 0, 0], lineWidth: 0.15, cellPadding: 1.2, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: 0, halign: 'center' },
        columnStyles: {
          ...Object.fromEntries(Object.entries(narrow).map(([k, w]) => [k, { cellWidth: w, halign: 'center' as const }])),
          ...Object.fromEntries(nameCols.map((k) => [k, { cellWidth: nameW }])),
        },
        didDrawPage: () => {
          if (doc.getNumberOfPages() > lastHeaderPage) { drawHeader(true); lastHeaderPage = doc.getNumberOfPages(); }
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    }
    const hasMidnight = day.sections.some((s) => s.rows.some((r) => crossesMidnight(r.entry.startTime, r.entry.endTime)));
    if (hasMidnight) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text('* rendição no dia seguinte', margin, Math.min(y + 2, doc.internal.pageSize.getHeight() - 8));
    }
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(`Página ${i} de ${n} · Gerado em ${new Date().toLocaleString('pt-BR')}`, pageW / 2, doc.internal.pageSize.getHeight() - 5, { align: 'center' });
  }
  return doc;
}

export function pdfFileName(dates: string[], demo: boolean) {
  const p = (d: string) => d.split('-').reverse().join('-');
  return `escala-${dates.map(p).join('_')}${demo ? '-DEMO' : ''}.pdf`;
}
