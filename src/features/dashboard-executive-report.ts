import type {
  AgreementInstallment,
  DashboardResponse,
  FactoryProductionSummary,
  ManagedDebt,
  SessionUser,
} from '../lib/types'
import rfLogoUrl from '../assets/rf-logo.png'

export interface OverviewReportEnrichment {
  agreements?: AgreementInstallment[]
  debts?: ManagedDebt[]
  production?: FactoryProductionSummary
  periodLabel?: string
  periodStart?: string
  periodEnd?: string
}

export interface OverviewReportRow {
  grupo: string
  indicador: string
  valor: string
  unidade: 'quantidade' | 'moeda' | 'percentual' | 'texto'
  status: 'informativo' | 'atencao' | 'urgente' | 'positivo'
  contexto: string
  modulo: string
}

const money = (value: number | undefined | null) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
const number = (value: number | undefined | null) => new Intl.NumberFormat('pt-BR').format(Number(value || 0))
const percent = (value: number | undefined | null) => `${Number(value || 0).toFixed(1).replace('.', ',')}%`
const asNumber = (value: unknown) => Number(value || 0)
const safeFileName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
const brand = { plum: [145, 36, 111] as [number, number, number], ink: [37, 38, 43] as [number, number, number], muted: [103, 106, 112] as [number, number, number], line: [226, 228, 231] as [number, number, number], gold: [183, 139, 48] as [number, number, number] }
const isoToday = () => new Date().toISOString().slice(0, 10)
const daysFrom = (date: string | null | undefined, start: string) => {
  if (!date) return null
  const target = new Date(`${date.slice(0, 10)}T12:00:00`).getTime()
  return Math.ceil((target - new Date(`${start}T12:00:00`).getTime()) / 86400000)
}

const isInWindow = (date: string | null | undefined, start: string, end: string) => {
  if (!date) return false
  const value = date.slice(0, 10)
  return value >= start && value <= end
}

async function loadLogo() {
  try {
    const response = await fetch(rfLogoUrl)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function row(grupo: string, indicador: string, valor: string, unidade: OverviewReportRow['unidade'], status: OverviewReportRow['status'], contexto: string, modulo: string): OverviewReportRow {
  return { grupo, indicador, valor, unidade, status, contexto, modulo }
}

function agreementRows(items: AgreementInstallment[], enrichment: OverviewReportEnrichment): OverviewReportRow[] {
  const start = enrichment.periodStart || isoToday()
  const end = enrichment.periodEnd || start
  const open = items.filter((item) => item.status !== 'quitada')
  const overdue = items.filter((item) => item.status === 'atrasada')
  const next7 = open.filter((item) => isInWindow(item.vencimento, start, end))
  const next30 = next7
  const agreementIds = new Set(items.map((item) => item.acordo_id))
  const balance = open.reduce((sum, item) => sum + asNumber(item.valor), 0)
  return [
    row('Acordos', 'Acordos ativos', number(agreementIds.size), 'quantidade', agreementIds.size ? 'informativo' : 'positivo', 'Processos com parcelas registradas', 'acordos'),
    row('Acordos', 'Parcelas em aberto', number(open.length), 'quantidade', open.length ? 'atencao' : 'positivo', `${money(balance)} ainda comprometidos`, 'acordos'),
    row('Acordos', 'Parcelas vencidas', number(overdue.length), 'quantidade', overdue.length ? 'urgente' : 'positivo', money(overdue.reduce((sum, item) => sum + asNumber(item.valor), 0)), 'acordos'),
    row('Acordos', 'Vencimentos no período', number(next7.length), 'quantidade', next7.length ? 'atencao' : 'positivo', money(next7.reduce((sum, item) => sum + asNumber(item.valor), 0)), 'acordos'),
    row('Acordos', 'Janela consultada', enrichment.periodLabel || 'Período selecionado', 'texto', 'informativo', 'Parcelas com vencimento dentro da janela', 'acordos'),
    row('Acordos', 'Saldo parcelado em aberto', money(balance), 'moeda', balance ? 'atencao' : 'positivo', 'Soma das parcelas não quitadas', 'acordos'),
  ]
}

function debtRows(items: ManagedDebt[], enrichment: OverviewReportEnrichment): OverviewReportRow[] {
  const start = enrichment.periodStart || isoToday()
  const end = enrichment.periodEnd || start
  const active = items.filter((item) => item.status === 'ativa')
  const openInstallments = active.flatMap((item) => item.parcelas.filter((installment) => installment.ativo && installment.status !== 'paga'))
  const overdue = openInstallments.filter((item) => { const days = daysFrom(item.vencimento, start); return days !== null && days < 0 })
  const next7 = openInstallments.filter((item) => isInWindow(item.vencimento, start, end))
  const balance = active.reduce((sum, item) => sum + asNumber(item.saldo_devedor), 0)
  const creditors = new Set(active.map((item) => item.credor).filter(Boolean))
  return [
    row('Dívidas', 'Dívidas ativas', number(active.length), 'quantidade', active.length ? 'atencao' : 'positivo', `${number(creditors.size)} credor(es)`, 'dividas'),
    row('Dívidas', 'Saldo devedor', money(balance), 'moeda', balance ? 'atencao' : 'positivo', 'Posição ativa cadastrada', 'dividas'),
    row('Dívidas', 'Parcelas em aberto', number(openInstallments.length), 'quantidade', openInstallments.length ? 'atencao' : 'positivo', 'Parcelas ainda não quitadas', 'dividas'),
    row('Dívidas', 'Parcelas vencidas', number(overdue.length), 'quantidade', overdue.length ? 'urgente' : 'positivo', money(overdue.reduce((sum, item) => sum + asNumber(item.valor), 0)), 'dividas'),
    row('Dívidas', 'Vencimentos no período', number(next7.length), 'quantidade', next7.length ? 'atencao' : 'positivo', money(next7.reduce((sum, item) => sum + asNumber(item.valor), 0)), 'dividas'),
  ]
}

export function buildOverviewReportRows(data: DashboardResponse, enrichment: OverviewReportEnrichment = {}): OverviewReportRow[] {
  const indicators = data.indicadores || {} as NonNullable<DashboardResponse['indicadores']>
  const intelligence = data.inteligencia || {}
  const funnel = data.funil || { recebidas: 0, em_producao: 0, costuradas: 0, entregues: 0, pagas: 0 }
  const production = enrichment.production
  const activeOrders = production?.lotes_ativos ?? indicators.ordens_ativas
  const produced = production?.unidades_produzidas ?? 0
  const requested = production?.unidades_solicitadas ?? 0
  const delivered = production?.unidades_entregues ?? 0
  const deliveredPct = requested ? delivered / requested * 100 : 0
  const rows: OverviewReportRow[] = [
    row('Pessoas', 'Funcionários ativos', number(indicators.funcionarios_ativos), 'quantidade', 'informativo', 'Quadro ativo atual', 'funcionarios'),
    row('Pessoas', 'Em férias', number(indicators.em_ferias), 'quantidade', indicators.em_ferias ? 'atencao' : 'positivo', 'Ausências programadas', 'rh'),
    row('Pessoas', 'Em afastamento', number(indicators.em_afastamento), 'quantidade', indicators.em_afastamento ? 'atencao' : 'positivo', 'Ausências que impactam a rotina', 'afastamentos'),
    row('Pessoas', 'Ponto e ocorrências pendentes', number(data.comparativos?.ponto_inconsistencias_mes), 'quantidade', data.comparativos?.ponto_inconsistencias_mes ? 'atencao' : 'positivo', 'Inconsistências do mês', 'ponto'),
    row('Produção', 'Ordens ativas', number(activeOrders), 'quantidade', activeOrders ? 'informativo' : 'positivo', `${number(funnel.em_producao)} em produção`, 'ordens'),
    row('Produção', 'Ordens atrasadas', number(intelligence.operacao?.ordens_atrasadas), 'quantidade', intelligence.operacao?.ordens_atrasadas ? 'urgente' : 'positivo', 'Exigem ação imediata', 'ordens'),
    row('Produção', 'Lotes sem movimentação', number(intelligence.operacao?.lotes_parados), 'quantidade', intelligence.operacao?.lotes_parados ? 'atencao' : 'positivo', 'Mais de 3 dias sem atualização', 'producao'),
    row('Produção', 'Unidades produzidas', number(produced), 'quantidade', 'informativo', requested ? `${number(requested)} solicitadas` : 'Resumo detalhado indisponível', 'producao'),
    row('Produção', 'Percentual entregue', percent(deliveredPct), 'percentual', deliveredPct >= 80 ? 'positivo' : deliveredPct ? 'atencao' : 'informativo', requested ? `${number(delivered)} unidades entregues` : 'Resumo detalhado indisponível', 'producao'),
    row('Financeiro', 'Contas pendentes', number(indicators.contas_pendentes), 'quantidade', indicators.contas_pendentes ? 'atencao' : 'positivo', 'Compromissos que exigem acompanhamento', 'financeiro'),
    row('Financeiro', 'Contas vencidas', number(intelligence.financeiro?.vencidas_qtd), 'quantidade', intelligence.financeiro?.vencidas_qtd ? 'urgente' : 'positivo', money(intelligence.financeiro?.vencidas_valor), 'financeiro'),
    row('Financeiro', 'Próximos 7 dias', number(intelligence.financeiro?.proximas_qtd), 'quantidade', intelligence.financeiro?.proximas_qtd ? 'atencao' : 'positivo', money(intelligence.financeiro?.proximas_valor), 'financeiro'),
    row('Financeiro', 'Saldo de dívidas', money(indicators.saldo_dividas), 'moeda', indicators.saldo_dividas ? 'atencao' : 'positivo', 'Posição atual', 'dividas'),
  ]
  if (enrichment.agreements) rows.push(...agreementRows(enrichment.agreements, enrichment))
  if (enrichment.debts) rows.push(...debtRows(enrichment.debts, enrichment))
  return rows
}

export function downloadDashboardCsv(data: DashboardResponse, user: SessionUser, enrichment: OverviewReportEnrichment = {}) {
  const generatedAt = new Date().toLocaleString('pt-BR')
  const rows = buildOverviewReportRows(data, enrichment)
  const csvRows = [
    ['Grupo', 'Indicador', 'Valor', 'Unidade', 'Status', 'Contexto', 'Módulo', 'Período', 'Gerado em'],
    ...rows.map((item) => [item.grupo, item.indicador, item.valor, item.unidade, item.status, item.contexto, item.modulo, enrichment.periodLabel || 'Visão atual', generatedAt]),
  ]
  const csv = csvRows.map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `relatorio-situacao-geral-${safeFileName(user.nome)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function exportDashboardPdf(data: DashboardResponse, user: SessionUser, enrichment: OverviewReportEnrichment = {}) {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadLogo()])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const rows = buildOverviewReportRows(data, enrichment)
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 15
  const indicators = data.indicadores || {} as NonNullable<DashboardResponse['indicadores']>
  const intelligence = data.inteligencia || {}
  const generatedAt = new Date().toLocaleString('pt-BR')
  const grouped = rows.reduce<Record<string, OverviewReportRow[]>>((acc, item) => { (acc[item.grupo] ||= []).push(item); return acc }, {})
  const colors: Record<string, [number, number, number]> = { Pessoas: [162, 63, 105], Produção: [55, 112, 83], Financeiro: [190, 151, 74], Acordos: [117, 91, 139], Dívidas: [148, 76, 70] }

  const header = () => {
    doc.setFillColor(250, 249, 250); doc.rect(0, 0, pageWidth, 31, 'F'); doc.setDrawColor(...brand.line); doc.setLineWidth(.25); doc.line(margin, 31, pageWidth - margin, 31)
    if (logo) doc.addImage(logo, 'PNG', margin, 6, 21, 15.4, undefined, 'FAST')
    else { doc.setFillColor(...brand.plum); doc.roundedRect(margin, 7, 20, 14, 1.4, 1.4, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('RF', margin + 6, 16) }
    doc.setTextColor(...brand.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('RF Gestão', margin + 26, 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...brand.muted); doc.text('Relatório rápido · situação geral', margin + 26, 16)
    doc.setTextColor(...brand.gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text('DOCUMENTO OFICIAL', pageWidth - margin, 11, { align: 'right' })
    doc.setTextColor(...brand.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.text(`Emitido em ${generatedAt}`, pageWidth - margin, 16, { align: 'right' })
    doc.setTextColor(...brand.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(`Responsável: ${user.nome}`, margin, 41)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...brand.muted); doc.setFontSize(8); doc.text(`${enrichment.periodLabel || 'Visão atual'} · Pessoas, produção, caixa e compromissos`, margin, 47)
  }
  const section = (title: string, items: OverviewReportRow[], startY: number) => {
    const color = colors[title] || [91, 79, 85]
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(55, 45, 50); doc.text(title, margin, startY)
    autoTable(doc, { head: [['Indicador', 'Valor', 'Contexto']], body: items.map((item) => [item.indicador, item.valor, item.contexto]), startY: startY + 3, theme: 'grid', styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 2.5, textColor: [55, 45, 50], lineColor: [225, 218, 214], lineWidth: .15 }, headStyles: { fillColor: color, textColor: [255, 255, 255], fontStyle: 'bold' }, alternateRowStyles: { fillColor: [251, 249, 246] }, margin: { left: margin, right: margin } })
    return ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || startY + 20) + 7
  }

  header()
  let y = 56
  const kpis = [
    ['Equipe ativa', number(indicators.funcionarios_ativos)],
    ['Ordens ativas', number(indicators.ordens_ativas)],
    ['Contas pendentes', number(indicators.contas_pendentes)],
    ['Saldo de dívidas', money(indicators.saldo_dividas)],
  ]
  autoTable(doc, { head: [['Indicador', 'Valor']], body: kpis, startY: y, theme: 'grid', styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [55, 45, 50] }, headStyles: { fillColor: [190, 151, 74], textColor: [255, 255, 255] }, margin: { left: margin, right: margin } })
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 9
  y = section('Pessoas', grouped.Pessoas || [], y)
  y = section('Produção', grouped.Produção || [], y)
  if (y > 260) { doc.addPage(); header(); y = 56 }
  y = section('Financeiro', grouped.Financeiro || [], y)
  y = section('Acordos', grouped.Acordos || [], y)
  y = section('Dívidas', grouped.Dívidas || [], y)
  if (y > 265) { doc.addPage(); y = 20 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(55, 45, 50); doc.text('Alertas prioritários', margin, y)
  const alerts = (data.alertas || []).slice(0, 8).map((item) => [item.titulo, String(item.valor), item.detalhe])
  autoTable(doc, { head: [['Prioridade', 'Quantidade', 'Detalhe']], body: alerts.length ? alerts : [['Operação sob controle', '0', 'Nenhum alerta prioritário retornado']], startY: y + 3, theme: 'grid', styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 2.5, textColor: [55, 45, 50], lineColor: [225, 218, 214], lineWidth: .15 }, headStyles: { fillColor: [91, 79, 85], textColor: [255, 255, 255] }, margin: { left: margin, right: margin } })
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setFontSize(7); doc.setTextColor(130, 119, 125); doc.text('Documento gerado pelo RF Gestão · Resumo gerencial · Consulte os relatórios detalhados para conferência.', margin, pageHeight - 9)
  void intelligence
  doc.save(`relatorio-situacao-geral-${safeFileName(user.nome)}.pdf`)
}
