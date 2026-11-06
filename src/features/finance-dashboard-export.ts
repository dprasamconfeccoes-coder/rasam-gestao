import type { FinanceiroExecutivoDashboard } from '../lib/types'
import { formatMoney } from '../components/ui'

export type FinanceImageFormat = 'png' | 'jpg'

type KpiDefinition = { label: string; value: number; detail: string }

const number = (value: unknown) => Number(value || 0)
const safeText = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
}
const safeFilename = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'financeiro'
const dateLabel = (value?: string) => {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR')
}

function dashboardKpis(data: FinanceiroExecutivoDashboard): KpiDefinition[] {
  const kpis = data.kpis || {}
  return [
    { label: 'Saldo projetado', value: number(kpis.saldo_projetado), detail: 'Realizado e compromissos futuros' },
    { label: 'Receitas realizadas', value: number(kpis.receitas_realizadas), detail: `${formatMoney(number(kpis.receitas_a_receber))} a receber` },
    { label: 'Despesas realizadas', value: number(kpis.despesas_realizadas), detail: `${formatMoney(number(kpis.despesas_vencidas))} vencidas` },
    { label: 'Resultado operacional', value: number(kpis.resultado_realizado), detail: 'Receitas menos despesas realizadas' },
  ]
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
  if (!maxWidth) { ctx.fillText(text, x, y); return }
  let visible = text
  while (visible.length > 3 && ctx.measureText(visible).width > maxWidth) visible = `${visible.slice(0, -2)}…`
  ctx.fillText(visible, x, y)
}

function paintCard(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = '#ffffff', stroke = '#e5ebe5') {
  roundedRect(ctx, x, y, width, height, 18)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function buildSnapshot(data: FinanceiroExecutivoDashboard, periodLabel: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1040
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar a imagem do painel financeiro.')

  ctx.fillStyle = '#f5f7f4'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#173d2c'
  ctx.fillRect(0, 0, canvas.width, 12)
  ctx.fillStyle = '#24362d'
  ctx.font = '700 40px system-ui, sans-serif'
  ctx.fillText('RF Gestão  /  Financeiro', 72, 86)
  ctx.fillStyle = '#6f7f75'
  ctx.font = '500 20px system-ui, sans-serif'
  ctx.fillText(periodLabel, 74, 124)
  ctx.textAlign = 'right'
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.fillText(`Emitido em ${new Date().toLocaleString('pt-BR')}`, 1528, 119)
  ctx.textAlign = 'left'

  const kpis = dashboardKpis(data)
  const cardGap = 18
  const cardWidth = (1456 - cardGap * 3) / 4
  kpis.forEach((item, index) => {
    const x = 72 + index * (cardWidth + cardGap)
    paintCard(ctx, x, 158, cardWidth, 142)
    ctx.fillStyle = index === 0 ? '#547c61' : index === 2 ? '#a95d54' : '#728076'
    ctx.fillRect(x + 1, 159, 5, 140)
    ctx.fillStyle = '#718078'
    ctx.font = '650 16px system-ui, sans-serif'
    ctx.fillText(item.label, x + 23, 192)
    ctx.fillStyle = item.value < 0 ? '#a64e47' : '#20352a'
    ctx.font = '700 29px system-ui, sans-serif'
    drawText(ctx, formatMoney(item.value), x + 23, 237, cardWidth - 46)
    ctx.fillStyle = '#89958d'
    ctx.font = '500 13px system-ui, sans-serif'
    drawText(ctx, item.detail, x + 23, 272, cardWidth - 46)
  })

  const evolution = data.evolucao || []
  const maxValue = Math.max(1, ...evolution.flatMap((row) => [number(row.receitas_realizadas), number(row.despesas_realizadas), number(row.receitas_previstas), number(row.despesas_previstas)]))
  const chartX = 72, chartY = 328, chartW = 900, chartH = 350
  paintCard(ctx, chartX, chartY, chartW, chartH)
  ctx.fillStyle = '#273b30'
  ctx.font = '700 20px system-ui, sans-serif'
  ctx.fillText('Movimentação por competência', chartX + 28, chartY + 42)
  ctx.fillStyle = '#849188'
  ctx.font = '500 13px system-ui, sans-serif'
  ctx.fillText('Realizado e previsto', chartX + 28, chartY + 67)
  const legend = [
    ['Recebido', '#3d8b62'], ['Pago', '#c36b62'], ['A receber', '#9dc7a7'], ['A pagar', '#e2aaa4'],
  ]
  let legendX = chartX + 28
  legend.forEach(([label, color]) => {
    ctx.fillStyle = color
    roundedRect(ctx, legendX, chartY + 91, 12, 12, 3)
    ctx.fill()
    ctx.fillStyle = '#718078'
    ctx.font = '500 12px system-ui, sans-serif'
    ctx.fillText(label, legendX + 18, chartY + 102)
    legendX += ctx.measureText(label).width + 48
  })
  const plotX = chartX + 42, plotY = chartY + 128, plotW = chartW - 82, plotH = 165
  ctx.strokeStyle = '#edf1ed'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i += 1) {
    const y = plotY + (plotH / 4) * i
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke()
  }
  const barColors = ['#3d8b62', '#c36b62', '#9dc7a7', '#e2aaa4']
  const barGroup = plotW / Math.max(1, evolution.length)
  const barWidth = Math.max(5, Math.min(15, barGroup / 7))
  evolution.forEach((row, index) => {
    const vals = [number(row.receitas_realizadas), number(row.despesas_realizadas), number(row.receitas_previstas), number(row.despesas_previstas)]
    const totalBarsWidth = barWidth * 4 + 5 * 3
    const startX = plotX + index * barGroup + (barGroup - totalBarsWidth) / 2
    vals.forEach((value, itemIndex) => {
      const height = Math.max(2, value / maxValue * plotH)
      ctx.fillStyle = barColors[itemIndex]
      roundedRect(ctx, startX + itemIndex * (barWidth + 5), plotY + plotH - height, barWidth, height, 4)
      ctx.fill()
    })
    const month = new Date(`${row.mes.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
    ctx.fillStyle = '#839087'
    ctx.font = '500 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(month, plotX + index * barGroup + barGroup / 2, plotY + plotH + 25)
    ctx.textAlign = 'left'
  })
  if (!evolution.length) {
    ctx.fillStyle = '#88948c'; ctx.font = '500 15px system-ui, sans-serif'; ctx.fillText('Sem histórico suficiente no período.', plotX, plotY + 82)
  }

  const categoryX = 996, categoryY = 328, categoryW = 532, categoryH = 350
  paintCard(ctx, categoryX, categoryY, categoryW, categoryH)
  ctx.fillStyle = '#273b30'; ctx.font = '700 20px system-ui, sans-serif'; ctx.fillText('Despesas por categoria', categoryX + 26, categoryY + 42)
  ctx.fillStyle = '#849188'; ctx.font = '500 13px system-ui, sans-serif'; ctx.fillText('Principais grupos no período', categoryX + 26, categoryY + 67)
  const categories = (data.categorias || []).slice(0, 6)
  const maxCategory = Math.max(1, ...categories.map((item) => number(item.valor)))
  categories.forEach((item, index) => {
    const y = categoryY + 112 + index * 35
    ctx.fillStyle = '#516258'; ctx.font = '600 13px system-ui, sans-serif'; drawText(ctx, item.categoria || 'Sem categoria', categoryX + 26, y, 230)
    ctx.textAlign = 'right'; ctx.fillStyle = '#2d4335'; ctx.font = '650 13px system-ui, sans-serif'; ctx.fillText(formatMoney(number(item.valor)), categoryX + categoryW - 26, y); ctx.textAlign = 'left'
    ctx.fillStyle = '#edf2ed'; roundedRect(ctx, categoryX + 26, y + 9, categoryW - 52, 7, 4); ctx.fill()
    ctx.fillStyle = '#6ba17b'; roundedRect(ctx, categoryX + 26, y + 9, Math.max(7, (categoryW - 52) * number(item.valor) / maxCategory), 7, 4); ctx.fill()
  })
  if (!categories.length) { ctx.fillStyle = '#88948c'; ctx.font = '500 14px system-ui, sans-serif'; ctx.fillText('Sem despesas categorizadas.', categoryX + 26, categoryY + 126) }

  const agingX = 72, agingY = 704, agingW = 690, agingH = 260
  paintCard(ctx, agingX, agingY, agingW, agingH)
  ctx.fillStyle = '#273b30'; ctx.font = '700 20px system-ui, sans-serif'; ctx.fillText('Agenda de vencimentos', agingX + 26, agingY + 42)
  ctx.fillStyle = '#849188'; ctx.font = '500 13px system-ui, sans-serif'; ctx.fillText('Contas a pagar por faixa de risco', agingX + 26, agingY + 67)
  const aging = data.aging || {}
  const buckets: Array<[string, keyof typeof aging, string]> = [['Vencido', 'vencido', '#ad514b'], ['Hoje', 'hoje', '#a17a2d'], ['Próximos 7 dias', 'sete_dias', '#a17a2d'], ['8 a 30 dias', 'trinta_dias', '#547c61']]
  buckets.forEach(([label, key, color], index) => {
    const y = agingY + 111 + index * 34
    const item = aging[key] || {}
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(agingX + 32, y - 4, 5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#536359'; ctx.font = '600 13px system-ui, sans-serif'; ctx.fillText(label, agingX + 49, y)
    ctx.textAlign = 'right'; ctx.fillStyle = '#2d4335'; ctx.font = '700 13px system-ui, sans-serif'; ctx.fillText(formatMoney(number(item.valor)), agingX + agingW - 28, y); ctx.textAlign = 'left'
    ctx.fillStyle = '#89958d'; ctx.font = '500 11px system-ui, sans-serif'; ctx.fillText(`${number(item.quantidade)} conta(s)`, agingX + 49, y + 14)
  })

  const alertX = 786, alertY = 704, alertW = 742, alertH = 260
  paintCard(ctx, alertX, alertY, alertW, alertH)
  ctx.fillStyle = '#273b30'; ctx.font = '700 20px system-ui, sans-serif'; ctx.fillText('Acompanhamento', alertX + 26, alertY + 42)
  ctx.fillStyle = '#849188'; ctx.font = '500 13px system-ui, sans-serif'; ctx.fillText('Alertas gerados para o período', alertX + 26, alertY + 67)
  const alerts = (data.alertas || []).filter((item) => item && item.nivel !== 'informativo').slice(0, 3)
  alerts.forEach((item, index) => {
    const y = alertY + 93 + index * 48
    const critical = item?.nivel === 'critico'
    ctx.fillStyle = critical ? '#fff4f2' : '#fff9ed'
    roundedRect(ctx, alertX + 22, y, alertW - 44, 40, 9); ctx.fill()
    ctx.fillStyle = critical ? '#b6554e' : '#a37c28'; ctx.beginPath(); ctx.arc(alertX + 39, y + 20, 5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#405449'; ctx.font = '700 13px system-ui, sans-serif'; drawText(ctx, safeText(item?.titulo || 'Alerta'), alertX + 55, y + 17, alertW - 98)
    ctx.fillStyle = '#738178'; ctx.font = '500 11px system-ui, sans-serif'; drawText(ctx, safeText(item?.detalhe || ''), alertX + 55, y + 32, alertW - 98)
  })
  if (!alerts.length) {
    ctx.fillStyle = '#f1f7f2'; roundedRect(ctx, alertX + 22, alertY + 100, alertW - 44, 54, 10); ctx.fill()
    ctx.fillStyle = '#437754'; ctx.font = '650 14px system-ui, sans-serif'; ctx.fillText('Sem alertas de atenção neste período.', alertX + 42, alertY + 133)
  }
  ctx.fillStyle = '#94a097'; ctx.font = '500 11px system-ui, sans-serif'
  ctx.textAlign = 'right'; ctx.fillText('RF Gestão · visão administrativa', 1528, 1008); ctx.textAlign = 'left'
  return canvas
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadFinanceDashboardImage(data: FinanceiroExecutivoDashboard, periodLabel: string, format: FinanceImageFormat) {
  const canvas = buildSnapshot(data, periodLabel)
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Não foi possível gerar a imagem do painel.')), mime, .94))
  downloadBlob(blob, `rf-gestao-financeiro-${safeFilename(periodLabel)}.${format}`)
}

export async function downloadFinanceDashboardPdf(data: FinanceiroExecutivoDashboard, periodLabel: string) {
  const canvas = buildSnapshot(data, periodLabel)
  const image = canvas.toDataURL('image/png')
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  doc.setProperties({ title: `RF Gestão · Financeiro · ${periodLabel}`, subject: 'Resumo executivo financeiro', author: 'RF Gestão', creator: 'RF Gestão' })
  doc.addImage(image, 'PNG', 0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), undefined, 'FAST')
  doc.save(`rf-gestao-financeiro-${safeFilename(periodLabel)}.pdf`)
}

export async function downloadFinanceDashboardXlsx(data: FinanceiroExecutivoDashboard, periodLabel: string) {
  const XLSX = await import('xlsx')
  const kpis = data.kpis || {}
  const aging = data.aging || {}
  const book = XLSX.utils.book_new()
  const summaryRows: Array<Array<string | number | null>> = [
    ['RF Gestão · Resumo financeiro'],
    ['Período', periodLabel],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    [],
    ['Indicador', 'Valor', 'Contexto'],
    ['Saldo projetado', number(kpis.saldo_projetado), 'Realizado e compromissos futuros'],
    ['Receitas realizadas', number(kpis.receitas_realizadas), `${formatMoney(number(kpis.receitas_a_receber))} a receber`],
    ['Despesas realizadas', number(kpis.despesas_realizadas), `${formatMoney(number(kpis.despesas_vencidas))} vencidas`],
    ['Ordens aguardando pagamento', number(kpis.ordens_aguardando_pagamento), 'Quantidade de ordens'],
    ['Resultado operacional', number(kpis.resultado_realizado), 'Receitas menos despesas realizadas'],
    ['Receitas a receber', number(kpis.receitas_a_receber), 'Compromissos a receber'],
    ['Despesas a pagar', number(kpis.despesas_a_pagar), 'Compromissos a pagar'],
    ['Compromissos recorrentes', number(kpis.compromissos_recorrentes), `${number(kpis.recorrencias_ativas)} recorrência(s) ativa(s)`],
  ]
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(summaryRows.map((row) => row.map((cell) => typeof cell === 'string' ? safeText(cell) : cell))), 'Resumo')

  const evolutionRows = (data.evolucao || []).map((item) => ({
    Competência: safeText(dateLabel(item.mes)),
    'Receitas realizadas': number(item.receitas_realizadas),
    'Despesas realizadas': number(item.despesas_realizadas),
    'Receitas previstas': number(item.receitas_previstas),
    'Despesas previstas': number(item.despesas_previstas),
  }))
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(evolutionRows), 'Evolução')

  const categoryRows = (data.categorias || []).map((item) => ({ Categoria: safeText(item.categoria), Valor: number(item.valor), Lançamentos: number(item.quantidade) }))
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(categoryRows), 'Categorias')

  const agingRows = [
    ['Faixa', 'Contas', 'Valor'],
    ['Vencido', number(aging.vencido?.quantidade), number(aging.vencido?.valor)],
    ['Hoje', number(aging.hoje?.quantidade), number(aging.hoje?.valor)],
    ['Próximos 7 dias', number(aging.sete_dias?.quantidade), number(aging.sete_dias?.valor)],
    ['8 a 30 dias', number(aging.trinta_dias?.quantidade), number(aging.trinta_dias?.valor)],
  ]
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(agingRows), 'Vencimentos')

  const alertRows = (data.alertas || []).filter((item) => item).map((item) => ({ Nível: safeText(item?.nivel), Alerta: safeText(item?.titulo), Detalhe: safeText(item?.detalhe) }))
  if (alertRows.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(alertRows), 'Alertas')

  book.SheetNames.forEach((name) => {
    const sheet = book.Sheets[name]
    if (sheet) sheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 48 }, { wch: 22 }, { wch: 22 }]
  })
  XLSX.writeFile(book, `rf-gestao-financeiro-${safeFilename(periodLabel)}.xlsx`)
}
