import type { DashboardResponse, SessionUser } from '../lib/types'

function money(value: number | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
}

function safeFileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
}

export function downloadDashboardCsv(data: DashboardResponse, user: SessionUser) {
  const indicators = data.indicadores || {} as NonNullable<DashboardResponse['indicadores']>
  const intelligence = data.inteligencia || {}
  const rows = [
    ['Indicador', 'Valor'],
    ['Equipe ativa', String(indicators.funcionarios_ativos || 0)],
    ['Ordens ativas', String(indicators.ordens_ativas || 0)],
    ['Lotes em costura', String(indicators.lotes_em_costura || 0)],
    ['Contas pendentes', String(indicators.contas_pendentes || 0)],
    ['Saldo de dívidas', money(indicators.saldo_dividas)],
    ['Ordens atrasadas', String(intelligence.operacao?.ordens_atrasadas || 0)],
    ['Lotes sem movimentação', String(intelligence.operacao?.lotes_parados || 0)],
    ['Contas vencidas', String(intelligence.financeiro?.vencidas_qtd || 0)],
    ['Valor vencido', money(intelligence.financeiro?.vencidas_valor)],
    ['Contas nos próximos 7 dias', String(intelligence.financeiro?.proximas_qtd || 0)],
    ['Valor nos próximos 7 dias', money(intelligence.financeiro?.proximas_valor)],
    ...(intelligence.evolucao || []).map((point) => [`Evolução ${point.periodo}`, `Recebidas: ${point.ordens}; Entregues: ${point.entregues}`]),
  ]
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(';')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `visao-geral-${safeFileName(user.nome)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function exportDashboardPdf(data: DashboardResponse, user: SessionUser) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const indicators = data.indicadores || {} as NonNullable<DashboardResponse['indicadores']>
  const intelligence = data.inteligencia || {}
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 17
  doc.setFillColor(57, 44, 49)
  doc.rect(0, 0, pageWidth, 29, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('RF Gestão', margin, 12)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Relatório executivo · Visão geral', margin, 19)
  doc.text(new Date().toLocaleDateString('pt-BR'), pageWidth - margin, 19, { align: 'right' })
  doc.setTextColor(55, 45, 50)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(`Responsável: ${user.nome}`, margin, 40)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(112, 101, 108)
  doc.text('Resumo consolidado de operação, financeiro e prioridades do período.', margin, 46)
  autoTable(doc, {
    head: [['Indicador', 'Valor', 'Contexto']],
    body: [
      ['Equipe ativa', String(indicators.funcionarios_ativos || 0), `${(indicators.em_ferias || 0) + (indicators.em_afastamento || 0)} ausente(s)`],
      ['Ordens ativas', String(indicators.ordens_ativas || 0), `${intelligence.operacao?.ordens_atrasadas || 0} atrasada(s)`],
      ['Lotes em costura', String(indicators.lotes_em_costura || 0), `${intelligence.operacao?.lotes_parados || 0} parado(s)`],
      ['Contas pendentes', String(indicators.contas_pendentes || 0), `${intelligence.financeiro?.vencidas_qtd || 0} vencida(s)`],
      ['Saldo de dívidas', money(indicators.saldo_dividas), 'Posição atual'],
    ],
    startY: 54, theme: 'grid', styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [55, 45, 50], lineColor: [225, 218, 214], lineWidth: .15 }, headStyles: { fillColor: [190, 151, 74], textColor: [255, 255, 255], fontStyle: 'bold' }, alternateRowStyles: { fillColor: [251, 249, 246] }, margin: { left: margin, right: margin },
  })
  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 54) + 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(55, 45, 50); doc.text('Riscos operacionais', margin, y); y += 5
  autoTable(doc, { head: [['Risco', 'Quantidade / valor']], body: [['Ordens atrasadas', String(intelligence.operacao?.ordens_atrasadas || 0)], ['Lotes sem movimentação', String(intelligence.operacao?.lotes_parados || 0)], ['Contas vencidas', `${intelligence.financeiro?.vencidas_qtd || 0} · ${money(intelligence.financeiro?.vencidas_valor)}`], ['Contas nos próximos 7 dias', `${intelligence.financeiro?.proximas_qtd || 0} · ${money(intelligence.financeiro?.proximas_valor)}`]], startY: y + 2, theme: 'grid', styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [55, 45, 50], lineColor: [225, 218, 214], lineWidth: .15 }, headStyles: { fillColor: [91, 79, 85], textColor: [255, 255, 255] }, margin: { left: margin, right: margin } })
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Agenda dos próximos 7 dias', margin, y); y += 5
  const agenda = intelligence.agenda || []
  autoTable(doc, { head: [['Compromisso', 'Quantidade', 'Ação']], body: agenda.length ? agenda.map((item) => [item.titulo, String(item.valor), item.detalhe]) : [['Nenhum compromisso crítico', '0', 'Agenda sem pendências registradas']], startY: y + 2, theme: 'grid', styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [55, 45, 50], lineColor: [225, 218, 214], lineWidth: .15, overflow: 'linebreak' }, headStyles: { fillColor: [91, 79, 85], textColor: [255, 255, 255] }, margin: { left: margin, right: margin } })
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setFontSize(7); doc.setTextColor(130, 119, 125); doc.text('Documento gerado pelo RF Gestão · Uso interno', margin, pageHeight - 10)
  doc.save(`relatorio-visao-geral-${safeFileName(user.nome)}.pdf`)
}
