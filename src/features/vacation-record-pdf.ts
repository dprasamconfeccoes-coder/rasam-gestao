import rfLogoUrl from '../assets/rf-logo.png'
import type { AdminVacationManagementRow, EmployeeRow } from '../lib/types'

const margin = 16

type VacationRecordEmployee = Pick<EmployeeRow, 'nome' | 'cpf' | 'cargo' | 'data_admissao' | 'avatar_url'>

function text(value: unknown) { return value === null || value === undefined || String(value).trim() === '' ? 'Não informado' : String(value).trim() }
function date(value: unknown) { const raw = String(value || '').slice(0, 10); if (!raw) return 'Não informado'; const parsed = new Date(`${raw}T00:00:00`); return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('pt-BR') }
function safeName(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'funcionario' }
async function imageData(url: string | null | undefined) { if (!url) return null; try { const response = await fetch(url); if (!response.ok) return null; const blob = await response.blob(); return await new Promise<string | null>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null); reader.onerror = () => resolve(null); reader.readAsDataURL(blob) }) } catch { return null } }
async function logoData() { return imageData(rfLogoUrl) }
function status(value: string) { return value === 'concluida' ? 'Concluída' : value === 'em_gozo' ? 'Em gozo' : value === 'cancelada' ? 'Cancelada' : 'Agendada' }
function documentStatus(row: AdminVacationManagementRow, kind: 'aviso' | 'recibo' | 'pagamento') { const item = kind === 'aviso' ? row.aviso_documento : kind === 'recibo' ? row.recibo_documento : row.comprovante_pagamento_documento; return item ? `Anexado · ${item.arquivo_nome}` : 'Não anexado' }

export async function downloadVacationRecordPdf(employee: VacationRecordEmployee, rows: AdminVacationManagementRow[], selected?: AdminVacationManagementRow) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth(); const pageHeight = doc.internal.pageSize.getHeight(); const name = text(employee.nome); const logo = await logoData(); const avatar = await imageData(employee.avatar_url)
  const ordered = [...(selected ? [selected] : rows)].sort((a, b) => b.periodo_aquisitivo_fim.localeCompare(a.periodo_aquisitivo_fim) || (b.fim || '').localeCompare(a.fim || ''))
  const generated = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
  doc.setProperties({ title: `Prontuário de Férias - ${name}`, subject: 'Prontuário oficial de férias', author: 'RF Gestão' })
  doc.setFillColor(250, 248, 244); doc.rect(0, 0, pageWidth, 40, 'F'); doc.setDrawColor(137, 98, 15); doc.setLineWidth(.7); doc.line(margin, 40, pageWidth - margin, 40)
  if (logo) doc.addImage(logo, 'PNG', margin, 8, 24, 20, undefined, 'FAST'); else { doc.setFillColor(137, 98, 15); doc.roundedRect(margin, 9, 23, 19, 2, 2, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('RF', margin + 7, 22) }
  doc.setTextColor(38, 32, 36); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('RF Gestão', margin + 30, 14); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(102, 90, 96); doc.text('Recursos humanos · prontuário oficial de férias', margin + 30, 19)
  doc.setTextColor(162, 63, 105); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('PRONTUÁRIO DE FÉRIAS', pageWidth - margin - (avatar ? 28 : 0), 13, { align: 'right' }); doc.setTextColor(102, 90, 96); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(`Emitido em ${generated}`, pageWidth - margin - (avatar ? 28 : 0), 19, { align: 'right' })
  if (avatar) doc.addImage(avatar, avatar.startsWith('data:image/png') ? 'PNG' : 'JPEG', pageWidth - margin - 22, 8, 20, 22, undefined, 'FAST')
  let y = 49
  doc.setFillColor(246, 241, 231); doc.roundedRect(margin, y, pageWidth - margin * 2, 9, 1.5, 1.5, 'F'); doc.setTextColor(48, 38, 43); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(name, margin + 5, y + 6); y += 13
  autoTable(doc, { startY: y, body: [['CPF', text(employee.cpf)], ['Cargo', text(employee.cargo)], ['Data de admissão', date(employee.data_admissao)], ['Escopo do documento', selected ? 'Período aquisitivo selecionado' : 'Prontuário completo']], theme: 'grid', margin: { left: margin, right: margin, top: 14, bottom: 20 }, styles: { font: 'helvetica', fontSize: 8, textColor: [45, 37, 41], lineColor: [230, 224, 216], lineWidth: .15, cellPadding: 2.8, overflow: 'linebreak', valign: 'top' }, columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold', textColor: [92, 77, 84], fillColor: [250, 248, 244] } }, rowPageBreak: 'avoid' })
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 35) + 8
  ordered.forEach((row, index) => {
    if (y > pageHeight - 70) { doc.addPage(); y = 20 }
    doc.setFillColor(246, 241, 231); doc.roundedRect(margin, y, pageWidth - margin * 2, 8, 1.5, 1.5, 'F'); doc.setFillColor(162, 63, 105); doc.roundedRect(margin, y, 1.2, 8, .5, .5, 'F'); doc.setTextColor(48, 38, 43); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(`Período ${index + 1} · ${date(row.periodo_aquisitivo_inicio)} a ${date(row.periodo_aquisitivo_fim)}`, margin + 5, y + 5.3); y += 10
    autoTable(doc, { startY: y, body: [['Período de gozo', `${date(row.inicio)} a ${date(row.fim)} · ${row.dias_gozo ?? '—'} dia(s)`], ['Situação', status(row.status)], ['Pagamento previsto', date(row.pagamento_previsto_em)], ['Pagamento efetivo', date(row.pagamento_efetivo_em)], ['Retorno ao trabalho', date(row.retorno_em)], ['Abono pecuniário', row.abono_solicitado ? `Sim${row.dias_abono ? ` · ${row.dias_abono} dia(s)` : ''}` : 'Não'], ['Observações', text(row.observacoes)], ['Aviso', documentStatus(row, 'aviso')], ['Recibo', documentStatus(row, 'recibo')], ['Comprovante de pagamento', documentStatus(row, 'pagamento')]], theme: 'grid', margin: { left: margin, right: margin, top: 14, bottom: 20 }, styles: { font: 'helvetica', fontSize: 7.6, textColor: [45, 37, 41], lineColor: [230, 224, 216], lineWidth: .15, cellPadding: 2.5, overflow: 'linebreak', valign: 'top' }, columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', textColor: [92, 77, 84], fillColor: [250, 248, 244] } }, alternateRowStyles: { fillColor: [255, 255, 255] }, rowPageBreak: 'avoid' })
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 65) + 8
  })
  const pages = doc.getNumberOfPages(); for (let page = 1; page <= pages; page += 1) { doc.setPage(page); doc.setDrawColor(224, 217, 207); doc.setLineWidth(.25); doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13); doc.setTextColor(110, 99, 104); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(`RF Gestão · Prontuário de Férias · ${name}`, margin, pageHeight - 8); doc.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 8, { align: 'right' }) }
  doc.save(`Prontuario-de-Ferias-${safeName(name)}${selected ? `-${safeName(selected.periodo_aquisitivo_inicio)}` : ''}.pdf`)
}
