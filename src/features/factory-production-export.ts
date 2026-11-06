import type { FactoryProductionLot, FactoryProductionSummary, FactoryProductionTrend } from '../lib/types'

type FactoryStage = { label: string; count: number }
type FactoryAlert = { label: string; count: number; detail: string; tone: 'danger' | 'warning' | 'info' }

export interface FactoryProductionExportContext {
  summary: FactoryProductionSummary
  allLots: FactoryProductionLot[]
  lots: FactoryProductionLot[]
  trend: FactoryProductionTrend[]
  stages: FactoryStage[]
  alerts: FactoryAlert[]
  attentionLots: FactoryProductionLot[]
  filterLabel: string
  query: string
  generatedAt: Date
}

const number = (value: number) => Number(value || 0).toLocaleString('pt-BR')
const statusLabel: Record<string, string> = {
  recebida: 'Aguardando início', em_producao: 'Em produção', costurada: 'Pronta para entrega',
  expedida: 'Entrega parcial', entregue: 'Entregue', cancelada: 'Cancelada',
}
function dateLabel(value: string | null | undefined) {
  if (!value) return 'Sem prazo'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR')
}
function lotTotals(lot: FactoryProductionLot) {
  return (lot.tamanhos || []).reduce((sum, row) => ({
    requested: sum.requested + Number(row.quantidade || 0),
    produced: sum.produced + Number(row.quantidade_produzida || 0),
    sewn: sum.sewn + Number(row.quantidade_costurada || 0),
    delivered: sum.delivered + Number(row.quantidade_entregue || 0),
  }), { requested: 0, produced: 0, sewn: 0, delivered: 0 })
}
function isLate(lot: FactoryProductionLot) {
  return Boolean(lot.prazo && lot.prazo < new Date().toLocaleDateString('sv-SE') && !['entregue', 'cancelada'].includes(lot.status))
}
function isDueSoon(lot: FactoryProductionLot) {
  if (!lot.prazo || ['entregue', 'cancelada'].includes(lot.status) || isLate(lot)) return false
  const limit = new Date()
  limit.setDate(limit.getDate() + 7)
  return lot.prazo <= limit.toLocaleDateString('sv-SE')
}
function alertLabel(lot: FactoryProductionLot) {
  if (isLate(lot)) return 'Prazo vencido'
  if (isDueSoon(lot)) return 'Vence em até 7 dias'
  return 'Sem prazo definido'
}
function safeFilename(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'producao'
}
function localDateStamp(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function safeExcelCell(value: string | number | null | undefined) {
  if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(value)) return `'${value}`
  return value ?? ''
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function productionPercent(summary: FactoryProductionSummary) {
  return summary.unidades_solicitadas ? Math.min(100, Math.round(summary.unidades_produzidas / summary.unidades_solicitadas * 100)) : 0
}
function contextLabel(context: FactoryProductionExportContext) {
  const parts = [`Etapa: ${context.filterLabel}`, `Lotes no recorte: ${context.lots.length}`]
  if (context.query.trim()) parts.push(`Busca: ${context.query.trim()}`)
  return parts.join(' · ')
}

export async function exportFactoryProductionPdf(context: FactoryProductionExportContext) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const margin = 13
  const pageWidth = doc.internal.pageSize.getWidth()
  const summary = context.summary
  const progress = productionPercent(summary)
  const generatedAt = context.generatedAt.toLocaleString('pt-BR')

  doc.setFillColor(250, 247, 249)
  doc.rect(0, 0, pageWidth, 30, 'F')
  doc.setFillColor(197, 32, 123)
  doc.roundedRect(margin, 7, 17, 15, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('RF', margin + 5.5, 17)
  doc.setTextColor(38, 43, 40)
  doc.setFontSize(10)
  doc.text('RF Gestão · Operação fabril', margin + 22, 12)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 108, 102)
  doc.setFontSize(7.5)
  doc.text(`Relatório gerencial de produção · gerado em ${generatedAt}`, margin + 22, 18)
  doc.setTextColor(55, 82, 63)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('VISÃO OPERACIONAL', pageWidth - margin, 12, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 108, 102)
  doc.setFontSize(7)
  doc.text(contextLabel(context), pageWidth - margin, 18, { align: 'right', maxWidth: 105 })

  autoTable(doc, {
    head: [['Indicador', 'Valor', 'Contexto de gestão']],
    body: [
      ['Lotes ativos', number(summary.lotes_ativos), `${number(summary.lotes_aguardando_inicio)} aguardando início · ${number(summary.lotes_em_producao)} em produção`],
      ['Produção realizada', `${number(summary.unidades_produzidas)} / ${number(summary.unidades_solicitadas)} unidades`, `${progress}% do volume solicitado`],
      ['Aguardando costura', number(summary.unidades_aguardando_costura), 'Produzidas menos costuradas; volume agregado'],
      ['Prontas para entrega', `${number(summary.unidades_prontas_entrega)} unidades`, `${number(summary.lotes_prontos_entrega)} lote(s) na etapa`],
      ['Lotes atrasados', number(summary.lotes_atrasados), 'Prazo previsto ultrapassado; exclui entregues/cancelados'],
      ['Liberados ao financeiro', number(context.allLots.filter((lot) => Boolean(lot.financeiro_liberado_em)).length), 'Marco de encaminhamento, não confirmação de pagamento'],
    ],
    startY: 34,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.1, cellPadding: 2.2, textColor: [49, 57, 52], lineColor: [224, 229, 224], lineWidth: .15 },
    headStyles: { fillColor: [55, 112, 83], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [249, 251, 249] },
    margin: { left: margin, right: margin },
  })
  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 80) + 6

  if (context.alerts.length) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(44, 51, 46)
    doc.text('Pontos de atenção', margin, y)
    autoTable(doc, {
      head: [['Alerta', 'Quantidade', 'Contexto']],
      body: context.alerts.map((alert) => [alert.label, number(alert.count), alert.detail]),
      startY: y + 2,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 2, textColor: [49, 57, 52], lineColor: [224, 229, 224], lineWidth: .15 },
      headStyles: { fillColor: [151, 92, 37], textColor: [255, 255, 255], fontStyle: 'bold' },
      margin: { left: margin, right: margin },
    })
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 15) + 6
    if (context.attentionLots.length) {
      if (y > 150) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(44, 51, 46)
      doc.text('Lotes em alerta · visão completa do painel, independente do filtro da lista', margin, y)
      autoTable(doc, {
        head: [['Alerta', 'Lote / cliente', 'Produto', 'Prazo', 'Produzidas / solicitadas']],
        body: context.attentionLots.map((lot) => {
          const totals = lotTotals(lot)
          return [alertLabel(lot), `${lot.numero} · ${lot.cliente || 'Cliente não informado'}`, lot.descricao, dateLabel(lot.prazo), `${number(totals.produced)} / ${number(totals.requested)}`]
        }),
        startY: y + 3,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 6.8, cellPadding: 1.8, textColor: [49, 57, 52], lineColor: [224, 229, 224], lineWidth: .12 },
        headStyles: { fillColor: [151, 92, 37], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 251, 250] },
        margin: { left: margin, right: margin, bottom: 14 },
      })
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 15) + 6
    }
  }

  if (y > 150) { doc.addPage(); y = 18 }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(44, 51, 46)
  doc.text(`Lotes no recorte atual · ${number(context.lots.length)}`, margin, y)
  const rows = context.lots.map((lot) => {
    const totals = lotTotals(lot)
    const pct = totals.requested ? Math.min(100, Math.round(totals.produced / totals.requested * 100)) : 0
    const product = [lot.descricao, lot.referencia ? `Ref. ${lot.referencia}` : ''].filter(Boolean).join(' · ')
    return [`${lot.numero}\n${lot.cliente || 'Cliente não informado'}`, product, statusLabel[lot.status] || lot.status.replaceAll('_', ' '), dateLabel(lot.prazo), number(totals.requested), number(totals.produced), number(totals.sewn), number(totals.delivered), `${pct}%`]
  })
  autoTable(doc, {
    head: [['Lote / cliente', 'Produto / referência', 'Etapa', 'Prazo', 'Solicitadas', 'Produzidas', 'Costuradas', 'Entregues', 'Progresso']],
    body: rows.length ? rows : [['—', 'Nenhum lote no recorte selecionado', '—', '—', '—', '—', '—', '—', '—']],
    startY: y + 3,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 6.6, cellPadding: 1.8, textColor: [49, 57, 52], lineColor: [224, 229, 224], lineWidth: .12, overflow: 'linebreak' },
    headStyles: { fillColor: [52, 65, 56], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 250] },
    columnStyles: { 0: { cellWidth: 39 }, 1: { cellWidth: 48 }, 2: { cellWidth: 25 }, 3: { cellWidth: 21 } },
    margin: { left: margin, right: margin, bottom: 14 },
    didDrawPage: () => {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(128, 136, 130)
      doc.setFontSize(6.5)
      doc.text('Resumo agregado da fábrica. “Aguardando costura” é diferença de unidades, não status individual da ordem.', margin, doc.internal.pageSize.getHeight() - 7)
    },
  })
  const pages = doc.internal.pages.length - 1
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(128, 136, 130)
    doc.setFontSize(6.5)
    doc.text(`${page}/${pages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 7, { align: 'right' })
  }
  doc.save(`producao-${safeFilename(context.filterLabel)}-${localDateStamp(context.generatedAt)}.pdf`)
}

export async function exportFactoryProductionXlsx(context: FactoryProductionExportContext) {
  const XLSX = await import('xlsx')
  const summary = context.summary
  const rows = context.lots
  const stageRows = context.stages.map((stage) => [stage.label, stage.count])
  const alertRows = context.alerts.map((alert) => [alert.label, alert.count, alert.detail])
  const summaryRows: Array<Array<string | number | null>> = [
    ['RF Gestão · Produção fabril'],
    ['Gerado em', context.generatedAt.toLocaleString('pt-BR')],
    ['Escopo', contextLabel(context)],
    [],
    ['Indicadores gerais', 'Valor', 'Contexto'],
    ['Lotes ativos', summary.lotes_ativos, `${summary.lotes_aguardando_inicio} aguardando início · ${summary.lotes_em_producao} em produção`],
    ['Unidades solicitadas', summary.unidades_solicitadas, 'Volume carregado do painel'],
    ['Unidades produzidas', summary.unidades_produzidas, `${productionPercent(summary)}% do solicitado`],
    ['Aguardando costura', summary.unidades_aguardando_costura, 'Produzidas menos costuradas; indicador agregado'],
    ['Prontas para entrega', summary.unidades_prontas_entrega, `${summary.lotes_prontos_entrega} lote(s) na etapa`],
    ['Unidades entregues', summary.unidades_entregues, 'Acumulado do painel fabril'],
    ['Lotes atrasados', summary.lotes_atrasados, 'Prazo ultrapassado; exclui entregues/cancelados'],
    ['Liberados ao financeiro', context.allLots.filter((lot) => Boolean(lot.financeiro_liberado_em)).length, 'Encaminhados ao financeiro; não significa pagamento confirmado'],
    [],
    ['Fluxo dos lotes carregados', 'Quantidade'],
    ...stageRows,
    [],
    ['Pontos de atenção', 'Quantidade', 'Contexto'],
    ...(alertRows.length ? alertRows : [['Nenhum alerta ativo', 0, 'Sem prazos vencidos/próximos ou sem prazo no conjunto carregado']]),
  ]
  const lotHeaders = ['Número do lote', 'Cliente', 'Produto / descrição', 'Fornecedor', 'Referência', 'Prioridade', 'Etapa', 'Prazo', 'Dias até o prazo', 'Solicitadas', 'Produzidas', 'Costuradas', 'Entregues', 'Progresso (%)', 'Preço unitário', 'Liberado ao financeiro', 'Data de entrada', 'Início da produção', 'Conclusão da produção']
  const today = new Date().toLocaleDateString('sv-SE')
  const lotRows = rows.map((lot) => {
    const totals = lotTotals(lot)
    const daysToDeadline = lot.prazo ? Math.round((Date.parse(`${lot.prazo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null
    return [
      lot.numero, lot.cliente || 'Cliente não informado', lot.descricao, lot.fornecedor || '', lot.referencia || '', lot.prioridade,
      statusLabel[lot.status] || lot.status.replaceAll('_', ' '), lot.prazo || '', daysToDeadline,
      totals.requested, totals.produced, totals.sewn, totals.delivered,
      totals.requested ? Math.min(100, Math.round(totals.produced / totals.requested * 100)) : 0,
      lot.valor_unitario_peca ?? '', lot.financeiro_liberado_em ? 'Sim' : 'Não', lot.data_entrada || '',
      lot.producao_iniciada_em || '', lot.producao_concluida_em || '',
    ]
  })
  const sizeRows = rows.flatMap((lot) => (lot.tamanhos || []).map((size) => [
    lot.numero, lot.cliente || 'Cliente não informado', lot.descricao, size.tamanho,
    Number(size.quantidade || 0), Number(size.quantidade_produzida || 0),
    Number(size.quantidade_costurada || 0), Number(size.quantidade_entregue || 0),
  ]))
  const trendRows = context.trend.map((day) => [day.data, Number(day.produzidas || 0), Number(day.costuradas || 0), Number(day.entregues || 0)])
  const attentionRows = context.attentionLots.map((lot) => {
    const totals = lotTotals(lot)
    return [alertLabel(lot), lot.numero, lot.cliente || 'Cliente não informado', lot.descricao, lot.prazo || '', statusLabel[lot.status] || lot.status.replaceAll('_', ' '), totals.produced, totals.requested]
  })
  const sheets: Array<[string, Array<Array<string | number | null>>, number[]]> = [
    ['Resumo', summaryRows, [31, 16, 74]],
    ['Lotes', [lotHeaders, ...lotRows], [17, 30, 36, 24, 18, 14, 22, 14, 16, 14, 14, 14, 14, 15, 17, 21, 16, 19, 20]],
    ['Grade por tamanho', [['Lote', 'Cliente', 'Produto / descrição', 'Tamanho', 'Solicitadas', 'Produzidas', 'Costuradas', 'Entregues'], ...sizeRows], [17, 30, 36, 15, 15, 15, 15, 15]],
    ['Tendência 14 dias', [['Data', 'Produzidas', 'Costuradas', 'Entregues'], ...trendRows], [16, 16, 16, 16]],
    ['Alertas', [['Alerta', 'Lote', 'Cliente', 'Produto / descrição', 'Prazo', 'Etapa', 'Produzidas', 'Solicitadas'], ...attentionRows], [22, 17, 30, 36, 14, 22, 15, 15]],
  ]
  const workbook = XLSX.utils.book_new()
  sheets.forEach(([name, data, widths]) => {
    const safeData = data.map((row) => row.map((cell) => safeExcelCell(cell as string | number | null)))
    const worksheet = XLSX.utils.aoa_to_sheet(safeData)
    worksheet['!cols'] = widths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  })
  XLSX.writeFile(workbook, `producao-${safeFilename(context.filterLabel)}-${localDateStamp(context.generatedAt)}.xlsx`)
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}
function wrapText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 2) {
  const words = value.split(/\s+/)
  let line = ''
  let lineIndex = 0
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight)
      lineIndex += 1
      line = word
      if (lineIndex >= maxLines) break
    } else line = candidate
  }
  if (lineIndex < maxLines && line) ctx.fillText(line, x, y + lineIndex * lineHeight)
}

export async function exportFactoryProductionImage(context: FactoryProductionExportContext, format: 'png' | 'jpg') {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1120
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar a imagem do relatório neste navegador.')
  const width = canvas.width
  const margin = 70
  const summary = context.summary
  const generatedAt = context.generatedAt.toLocaleString('pt-BR')
  const colors = { ink: '#252a27', muted: '#6e7971', line: '#e3e8e2', green: '#31704e', gold: '#94701e', red: '#a6404a', amber: '#a56820', paper: '#f6f8f5', white: '#ffffff' }
  ctx.fillStyle = colors.paper
  ctx.fillRect(0, 0, width, canvas.height)
  ctx.fillStyle = '#c5207b'
  roundedRect(ctx, margin, 48, 82, 72, 16)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 42px Inter, Arial, sans-serif'
  ctx.fillText('RF', margin + 23, 96)
  ctx.fillStyle = colors.ink
  ctx.font = '700 32px Inter, Arial, sans-serif'
  ctx.fillText('RF Gestão', margin + 108, 74)
  ctx.font = '500 18px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.muted
  ctx.fillText('OPERAÇÃO · CHÃO DE FÁBRICA', margin + 108, 106)
  ctx.textAlign = 'right'
  ctx.font = '600 17px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.ink
  ctx.fillText(generatedAt, width - margin, 72)
  ctx.font = '500 16px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.muted
  ctx.fillText(contextLabel(context), width - margin, 103)
  ctx.textAlign = 'left'

  const cardY = 154
  const cardGap = 18
  const cardW = (width - margin * 2 - cardGap * 3) / 4
  const cards = [
    { title: 'LOTES ATIVOS', value: number(summary.lotes_ativos), note: `${number(summary.lotes_aguardando_inicio)} aguardando início`, tone: colors.gold },
    { title: 'UNIDADES PRODUZIDAS', value: number(summary.unidades_produzidas), note: `${productionPercent(summary)}% de ${number(summary.unidades_solicitadas)} solicitadas`, tone: colors.green },
    { title: 'AGUARDANDO COSTURA', value: number(summary.unidades_aguardando_costura), note: 'Diferença entre produzidas e costuradas', tone: colors.amber },
    { title: 'LOTES ATRASADOS', value: number(summary.lotes_atrasados), note: 'Prazo ultrapassado', tone: summary.lotes_atrasados ? colors.red : colors.green },
  ]
  cards.forEach((card, index) => {
    const x = margin + index * (cardW + cardGap)
    ctx.fillStyle = colors.white
    roundedRect(ctx, x, cardY, cardW, 150, 17)
    ctx.fill()
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = card.tone
    ctx.fillRect(x, cardY, 6, 150)
    ctx.font = '700 15px Inter, Arial, sans-serif'
    ctx.fillStyle = colors.muted
    ctx.fillText(card.title, x + 23, cardY + 31)
    ctx.font = '700 39px Inter, Arial, sans-serif'
    ctx.fillStyle = colors.ink
    ctx.fillText(card.value, x + 23, cardY + 86)
    ctx.font = '500 15px Inter, Arial, sans-serif'
    ctx.fillStyle = colors.muted
    wrapText(ctx, card.note, x + 23, cardY + 118, cardW - 45, 21, 2)
  })

  const alertY = 326
  ctx.fillStyle = colors.white
  roundedRect(ctx, margin, alertY, width - margin * 2, 104, 16)
  ctx.fill()
  ctx.strokeStyle = colors.line
  ctx.stroke()
  ctx.font = '700 18px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.ink
  ctx.fillText(context.alerts.length ? 'ATENÇÃO OPERACIONAL' : 'SITUAÇÃO OPERACIONAL', margin + 24, alertY + 34)
  const alertText = context.alerts.length
    ? context.alerts.slice(0, 3).map((alert) => `${alert.label}: ${number(alert.count)} · ${alert.detail}`).join('   |   ')
    : 'Nenhum prazo vencido, próximo ou lote ativo sem prazo no conjunto carregado.'
  ctx.font = '500 16px Inter, Arial, sans-serif'
  ctx.fillStyle = context.alerts.some((alert) => alert.tone === 'danger') ? colors.red : context.alerts.length ? colors.amber : colors.green
  wrapText(ctx, alertText, margin + 24, alertY + 64, width - margin * 2 - 48, 22, 2)

  const panelY = 456
  const leftW = 640
  const panelH = 300
  ctx.fillStyle = colors.white
  roundedRect(ctx, margin, panelY, leftW, panelH, 16)
  ctx.fill()
  ctx.strokeStyle = colors.line
  ctx.stroke()
  ctx.fillStyle = colors.ink
  ctx.font = '700 21px Inter, Arial, sans-serif'
  ctx.fillText('Fluxo dos lotes carregados', margin + 24, panelY + 36)
  const maxCount = Math.max(1, ...context.stages.map((stage) => stage.count))
  context.stages.forEach((stage, index) => {
    const y = panelY + 77 + index * 39
    ctx.fillStyle = colors.muted
    ctx.font = '500 15px Inter, Arial, sans-serif'
    ctx.fillText(stage.label, margin + 24, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.ink
    ctx.font = '700 15px Inter, Arial, sans-serif'
    ctx.fillText(number(stage.count), margin + leftW - 24, y)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#edf1ed'
    roundedRect(ctx, margin + 24, y + 9, leftW - 48, 9, 5)
    ctx.fill()
    ctx.fillStyle = index === 0 ? colors.gold : index === 1 ? colors.green : index === 2 ? '#5c87a8' : index === 3 ? '#8372ad' : '#4d8d67'
    const barWidth = stage.count ? Math.max(6, (stage.count / maxCount) * (leftW - 48)) : 0
    roundedRect(ctx, margin + 24, y + 9, barWidth, 9, 5)
    ctx.fill()
  })

  const rightX = margin + leftW + 20
  const rightW = width - rightX - margin
  ctx.fillStyle = colors.white
  roundedRect(ctx, rightX, panelY, rightW, panelH, 16)
  ctx.fill()
  ctx.strokeStyle = colors.line
  ctx.stroke()
  ctx.fillStyle = colors.ink
  ctx.font = '700 21px Inter, Arial, sans-serif'
  ctx.fillText('Ritmo · últimos 14 dias', rightX + 24, panelY + 36)
  const trendTotals = context.trend.reduce((sum, day) => ({
    produced: sum.produced + Number(day.produzidas || 0), sewn: sum.sewn + Number(day.costuradas || 0), delivered: sum.delivered + Number(day.entregues || 0),
  }), { produced: 0, sewn: 0, delivered: 0 })
  const trendLines = [
    ['Produzidas', trendTotals.produced, '#b48b31'],
    ['Costuradas', trendTotals.sewn, '#5d8eb2'],
    ['Entregues', trendTotals.delivered, '#4c936a'],
  ] as const
  trendLines.forEach(([label, value, color], index) => {
    const y = panelY + 91 + index * 58
    ctx.fillStyle = color
    roundedRect(ctx, rightX + 24, y - 17, 14, 14, 4)
    ctx.fill()
    ctx.fillStyle = colors.muted
    ctx.font = '500 17px Inter, Arial, sans-serif'
    ctx.fillText(label, rightX + 50, y - 3)
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.ink
    ctx.font = '700 21px Inter, Arial, sans-serif'
    ctx.fillText(number(value), rightX + rightW - 25, y - 2)
    ctx.textAlign = 'left'
    if (index < trendLines.length - 1) {
      ctx.strokeStyle = '#edf0ed'
      ctx.beginPath()
      ctx.moveTo(rightX + 24, y + 21)
      ctx.lineTo(rightX + rightW - 24, y + 21)
      ctx.stroke()
    }
  })
  ctx.font = '500 13px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.muted
  ctx.fillText('Unidades movimentadas por dia no período informado pelo painel.', rightX + 24, panelY + 259)

  const listY = 778
  ctx.fillStyle = colors.white
  roundedRect(ctx, margin, listY, width - margin * 2, 250, 16)
  ctx.fill()
  ctx.strokeStyle = colors.line
  ctx.stroke()
  ctx.fillStyle = colors.ink
  ctx.font = '700 21px Inter, Arial, sans-serif'
  ctx.fillText(`Amostra do recorte · ${number(context.lots.length)} lote(s)`, margin + 24, listY + 36)
  const headerY = listY + 71
  ctx.fillStyle = '#f2f5f2'
  ctx.fillRect(margin + 18, headerY - 19, width - margin * 2 - 36, 31)
  ctx.font = '700 12px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.muted
  ctx.fillText('LOTE / CLIENTE', margin + 29, headerY)
  ctx.fillText('PRODUTO', margin + 390, headerY)
  ctx.fillText('ETAPA', margin + 880, headerY)
  ctx.fillText('PRAZO', margin + 1110, headerY)
  ctx.textAlign = 'right'
  ctx.fillText('PRODUÇÃO', width - margin - 28, headerY)
  ctx.textAlign = 'left'
  const sample = [...context.lots].sort((a, b) => (a.prazo || '9999-12-31').localeCompare(b.prazo || '9999-12-31')).slice(0, 5)
  sample.forEach((lot, index) => {
    const y = headerY + 35 + index * 31
    if (index % 2 === 1) {
      ctx.fillStyle = '#fbfcfb'
      ctx.fillRect(margin + 18, y - 18, width - margin * 2 - 36, 29)
    }
    const totals = lotTotals(lot)
    ctx.fillStyle = colors.ink
    ctx.font = '700 13px Inter, Arial, sans-serif'
    ctx.fillText(lot.numero, margin + 29, y)
    ctx.font = '500 12px Inter, Arial, sans-serif'
    ctx.fillStyle = colors.muted
    wrapText(ctx, lot.cliente || 'Cliente não informado', margin + 29, y + 14, 320, 13, 1)
    ctx.fillStyle = colors.ink
    wrapText(ctx, lot.descricao, margin + 390, y, 455, 13, 2)
    ctx.fillStyle = colors.muted
    ctx.fillText(statusLabel[lot.status] || lot.status.replaceAll('_', ' '), margin + 880, y)
    ctx.fillText(dateLabel(lot.prazo), margin + 1110, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = colors.ink
    ctx.fillText(`${number(totals.produced)} / ${number(totals.requested)} un.`, width - margin - 28, y)
    ctx.textAlign = 'left'
  })
  if (context.lots.length > sample.length) {
    ctx.font = '500 12px Inter, Arial, sans-serif'
    ctx.fillStyle = colors.muted
    ctx.fillText(`Exibindo ${sample.length} de ${number(context.lots.length)} lotes. O PDF e a planilha incluem todos os lotes do recorte.`, margin + 25, listY + 236)
  }
  ctx.font = '500 12px Inter, Arial, sans-serif'
  ctx.fillStyle = colors.muted
  ctx.fillText('Relatório agregado; a lista de produção não contém vínculo individual de funcionários nem fotos de produto.', margin, 1070)

  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('O navegador não conseguiu criar a imagem.')), mime, format === 'jpg' ? 0.92 : undefined)
  })
  downloadBlob(blob, `producao-${safeFilename(context.filterLabel)}-${localDateStamp(context.generatedAt)}.${format}`)
}
