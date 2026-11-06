import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Download,
  FileText,
  Image,
  RefreshCw,
  WalletCards,
} from 'lucide-react'
import { adminFinanceiroExecutivo } from '../lib/api'
import { saoPauloToday } from '../lib/business-date'
import { FinanceHealthDashboard } from './FinanceHealthDashboard'
import type { FinanceiroExecutivoDashboard, FinanceiroExecutivoEvolucao, FinanceiroExecutivoKpis } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, MetricCard, PageHeading, SectionCard, formatDate, formatMoney } from '../components/ui'
import {
  downloadFinanceDashboardImage,
  downloadFinanceDashboardPdf,
  downloadFinanceDashboardXlsx,
} from './finance-dashboard-export'
import './debt-management.css'
import './finance-executive.css'

const num = (value: unknown) => Number(value || 0)
const monthLabel = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value.slice(0, 7) : date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}
type RangeKey = 'mes' | 'trimestre' | 'ano'
const ranges: Record<RangeKey, { label: string; months: number }> = {
  mes: { label: 'Este mês', months: 1 },
  trimestre: { label: '3 meses', months: 3 },
  ano: { label: 'Este ano', months: 12 },
}
type FinanceFilter = 'todos' | 'pagar' | 'receber' | 'atrasados'
function alertFilter(alert: { titulo?: string; detalhe?: string }): FinanceFilter {
  const text = `${alert.titulo || ''} ${alert.detalhe || ''}`.toLocaleLowerCase('pt-BR')
  if (/receber|receita|cliente|entrada/.test(text)) return 'receber'
  if (/atras|vencid|vencimento|hoje|prazo/.test(text)) return 'atrasados'
  if (/despesa|pagar|conta|compromisso|saída/.test(text)) return 'pagar'
  return 'todos'
}
function rangeDates(key: RangeKey) {
  const [year, month] = saoPauloToday().split('-').map(Number)
  const end = new Date(Date.UTC(year, month, 0))
  const start = key === 'ano' ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(year, month - 1 - (ranges[key].months - 1), 1))
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

function EvolutionChart({ rows }: { rows: FinanceiroExecutivoEvolucao[] }) {
  const max = Math.max(1, ...rows.flatMap((row) => [num(row.receitas_realizadas), num(row.despesas_realizadas), num(row.receitas_previstas), num(row.despesas_previstas)]))
  return (
    <div className="finance-evolution-chart" role="img" aria-label="Evolução mensal de receitas e despesas">
      {rows.map((row) => (
        <div className="finance-month-column" key={row.mes}>
          <div className="finance-bars">
            <span className="is-income" style={{ height: `${Math.max(3, num(row.receitas_realizadas) / max * 100)}%` }} title={`Receitas realizadas ${formatMoney(num(row.receitas_realizadas))}`} />
            <span className="is-expense" style={{ height: `${Math.max(3, num(row.despesas_realizadas) / max * 100)}%` }} title={`Despesas realizadas ${formatMoney(num(row.despesas_realizadas))}`} />
            <span className="is-income-soft" style={{ height: `${Math.max(3, num(row.receitas_previstas) / max * 100)}%` }} title={`Receitas previstas ${formatMoney(num(row.receitas_previstas))}`} />
            <span className="is-expense-soft" style={{ height: `${Math.max(3, num(row.despesas_previstas) / max * 100)}%` }} title={`Despesas previstas ${formatMoney(num(row.despesas_previstas))}`} />
          </div>
          <small>{monthLabel(row.mes)}</small>
        </div>
      ))}
    </div>
  )
}

function CashflowChart({ rows }: { rows: FinanceiroExecutivoEvolucao[] }) {
  const values = rows.map((row) => num(row.receitas_realizadas) - num(row.despesas_realizadas) + num(row.receitas_previstas) - num(row.despesas_previstas))
  const max = Math.max(1, ...values.map(Math.abs))
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1) * 100).toFixed(2)},${(50 - value / max * 43).toFixed(2)}`).join(' ')
  return (
    <div className="finance-cashflow-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Fluxo de caixa projetado">
        <line x1="0" x2="100" y1="50" y2="50" className="finance-zero-line" />
        <polyline points={points} className="finance-cashflow-line" />
      </svg>
      <div className="finance-chart-labels">{rows.map((row) => <span key={row.mes}>{monthLabel(row.mes)}</span>)}</div>
    </div>
  )
}

function ExportMenu({ data, periodLabel, disabled, onError }: { data: FinanceiroExecutivoDashboard | null; periodLabel: string; disabled: boolean; onError: (message: string) => void }) {
  async function exportFile(action: () => Promise<void>) {
    onError('')
    try { await action() } catch (cause) { onError(cause instanceof Error ? cause.message : 'Não foi possível gerar o arquivo.') }
  }
  return (
    <details className="finance-export-dropdown">
      <summary className="secondary-button finance-toolbar-button"><Download size={15} /> Exportar</summary>
      <div className="finance-export-options" role="group" aria-label="Exportar resumo financeiro">
        <button type="button" className="secondary-button" onClick={() => data && void exportFile(() => downloadFinanceDashboardPdf(data, periodLabel))} disabled={disabled}><FileText size={15} /> PDF gerencial</button>
        <button type="button" className="secondary-button" onClick={() => data && void exportFile(() => downloadFinanceDashboardXlsx(data, periodLabel))} disabled={disabled}><BarChart3 size={15} /> Excel (.xlsx)</button>
        <button type="button" className="secondary-button" onClick={() => data && void exportFile(() => downloadFinanceDashboardImage(data, periodLabel, 'png'))} disabled={disabled}><Image size={15} /> Imagem (.png)</button>
        <button type="button" className="secondary-button" onClick={() => data && void exportFile(() => downloadFinanceDashboardImage(data, periodLabel, 'jpg'))} disabled={disabled}><Image size={15} /> Imagem (.jpg)</button>
      </div>
    </details>
  )
}

export function FinanceExecutiveDashboard({ token, onNavigateToReports }: { token: string; onNavigateToReports?: () => void }) {
  const [range, setRange] = useState<RangeKey>('trimestre')
  const [showOperations, setShowOperations] = useState(false)
  const [operationsFilter, setOperationsFilter] = useState<FinanceFilter>('todos')
  const [data, setData] = useState<FinanceiroExecutivoDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loadedRange, setLoadedRange] = useState<RangeKey | null>(null)
  const requestId = useRef(0)
  const dates = useMemo(() => rangeDates(range), [range])

  async function load() {
    const request = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const result = await adminFinanceiroExecutivo(token, dates.start, dates.end)
      if (request !== requestId.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar a visão financeira')
      setData(result)
      setLoadedRange(range)
      setUpdatedAt(new Date())
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : 'Falha ao carregar o dashboard financeiro')
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }

  useEffect(() => { void load(); return () => { requestId.current += 1 } }, [token, range])

  const kpis = data?.kpis || {} as FinanceiroExecutivoKpis
  const rows = data?.evolucao || []
  const alerts = (data?.alertas || []).filter((alert) => alert && alert.nivel !== 'informativo')
  const categories = data?.categorias || []
  const aging = data?.aging || {}
  const result = num(kpis.resultado_realizado)
  const maxCategory = Math.max(1, ...categories.map((item) => num(item.valor)))
  const projected = num(kpis.saldo_projetado)
  const dataReady = Boolean(data && loadedRange === range)
  const periodLabel = useMemo(() => `${formatDate(dataReady ? data?.periodo?.inicio || dates.start : dates.start)} a ${formatDate(dataReady ? data?.periodo?.fim || dates.end : dates.end)}`, [data, dataReady, dates.start, dates.end])
  const topAlert = alerts[0]

  const openOperations = (filter: FinanceFilter) => { setOperationsFilter(filter); setShowOperations(true) }
  if (showOperations) return <FinanceHealthDashboard token={token} initialFilter={operationsFilter} onBack={() => setShowOperations(false)} />

  const header = <PageHeading eyebrow="CONTROLE" title="Financeiro" description={`${periodLabel}${dataReady && updatedAt ? ` · atualizado ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`} action={
    <div className="finance-workspace-toolbar">
      <div className="overview-segmented finance-range-switch" role="group" aria-label="Período financeiro">
        {(Object.entries(ranges) as [RangeKey, { label: string }][]).map(([key, item]) => <button type="button" key={key} className={range === key ? 'is-active' : ''} onClick={() => setRange(key)} aria-pressed={range === key}>{item.label}</button>)}
      </div>
      <button type="button" className="secondary-button finance-toolbar-button" onClick={() => openOperations('todos')}><WalletCards size={15} /> Movimentações</button>
      {onNavigateToReports && <button type="button" className="secondary-button finance-toolbar-button" onClick={onNavigateToReports}><BarChart3 size={15} /> Relatórios</button>}
      <button type="button" className="secondary-button finance-toolbar-button" onClick={() => void load()} disabled={loading} aria-label="Atualizar dados"><RefreshCw size={15} className={loading ? 'spin' : ''} /><span>Atualizar</span></button>
      <ExportMenu data={dataReady ? data : null} periodLabel={periodLabel} disabled={!dataReady || loading} onError={setError} />
    </div>
  } />

  if (loading && !dataReady) return <div className="overview-page finance-executive-page">{header}<LoadingState label="Carregando financeiro…" /></div>
  if (error && !dataReady) return <div className="overview-page finance-executive-page">{header}<ErrorState message={error} /><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Tentar novamente</button></div>

  return (
    <div className="overview-page finance-executive-page">
      {header}
      {error && <div className="overview-data-warning" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fechar erro">×</button></div>}
      {topAlert ? (
        <div className="overview-alert-list finance-priority-list" aria-label="Alertas financeiros prioritários">
          <button type="button" className={`overview-alert-item ${topAlert.nivel === 'critico' ? 'is-urgente' : 'is-atencao'}`} onClick={() => openOperations(alertFilter(topAlert))}>
            <span>{topAlert.nivel === 'critico' ? <AlertTriangle size={18} /> : <Clock3 size={18} />}</span>
            <div><strong>{topAlert.titulo || 'Atenção financeira'}{alerts.length > 1 && <b>{alerts.length} alertas</b>}</strong><small>{topAlert.detalhe || 'Há um item que requer acompanhamento.'}</small></div>
            <ChevronRight size={16} />
          </button>
        </div>
      ) : (
        <div className="overview-alert-list finance-priority-list" aria-label="Situação financeira"><div className="overview-alert-item is-success" role="status"><span><CheckCircle2 size={18} /></span><div><strong>Sem alertas de atenção</strong><small>Competências consideradas: {periodLabel}</small></div></div></div>
      )}

      <div className="metric-grid overview-metrics finance-executive-kpis" aria-label="Indicadores financeiros">
        <MetricCard label="Saldo projetado" value={formatMoney(projected)} detail="Realizado + compromissos futuros" tone={projected >= 0 ? 'green' : 'pink'} onClick={() => openOperations('todos')} />
        <MetricCard label="Receitas realizadas" value={formatMoney(num(kpis.receitas_realizadas))} detail={`${formatMoney(num(kpis.receitas_a_receber))} a receber`} tone="green" onClick={() => openOperations('receber')} />
        <MetricCard label="Despesas realizadas" value={formatMoney(num(kpis.despesas_realizadas))} detail={`${formatMoney(num(kpis.despesas_vencidas))} vencidas`} tone="pink" onClick={() => openOperations('pagar')} />
        <MetricCard label="Resultado operacional" value={formatMoney(result)} detail="Receitas menos despesas realizadas" tone={result >= 0 ? 'green' : 'pink'} onClick={() => openOperations('todos')} />
      </div>

      <div className="overview-main-grid finance-executive-grid">
        <SectionCard title="Movimentação por competência" caption="Valores realizados e previstos" className="finance-visual-card finance-evolution-card">
          <div className="finance-chart-legend"><span><i className="is-income" />Receita realizada</span><span><i className="is-expense" />Despesa realizada</span><span><i className="is-income-soft" />A receber</span><span><i className="is-expense-soft" />A pagar</span></div>
          {rows.length ? <EvolutionChart rows={rows} /> : <EmptyState title="Sem histórico neste período" description="A evolução será exibida quando houver movimentações financeiras registradas." />}
        </SectionCard>
        <SectionCard title="Fluxo de caixa" caption="Saldo operacional por competência" className="finance-visual-card finance-projection-card">
          <div className="finance-projection-highlight"><div><small>Saldo projetado</small><strong className={projected >= 0 ? 'positive-value' : 'negative-value'}>{formatMoney(projected)}</strong></div><span>{projected >= 0 ? 'Compatível com os compromissos modelados.' : 'O caixa projetado requer priorização.'}</span></div>
          {rows.length ? <CashflowChart rows={rows} /> : <EmptyState title="Sem projeção disponível" description="Cadastre receitas e despesas para visualizar o fluxo por competência." />}
        </SectionCard>
      </div>

      <div className="overview-stage2-grid finance-secondary-grid">
        <SectionCard title="Despesas por categoria" caption="Composição no período selecionado" className="finance-visual-card">
          {categories.length ? <div className="finance-category-list">{categories.slice(0, 8).map((item) => <div className="finance-category-row" key={item.categoria}><div><span>{item.categoria}</span><strong>{formatMoney(num(item.valor))}</strong></div><div className="finance-category-track"><i style={{ width: `${Math.max(3, num(item.valor) / maxCategory * 100)}%` }} /></div><small>{num(item.quantidade)} lançamento(s)</small></div>)}</div> : <EmptyState title="Sem despesas categorizadas" description="Não há composição por categoria disponível neste período." />}
        </SectionCard>
        <SectionCard title="Agenda de vencimentos" caption="Contas a pagar por faixa de risco" className="finance-visual-card">
          <div className="overview-summary-list finance-aging-list">{[['Vencido', 'vencido', 'is-urgente'], ['Hoje', 'hoje', 'is-atencao'], ['Próximos 7 dias', 'sete_dias', 'is-atencao'], ['8 a 30 dias', 'trinta_dias', 'is-informacao']].map(([label, key, tone]) => { const bucket = aging[key as keyof typeof aging] || {}; return <button type="button" className={tone} key={key} onClick={() => openOperations(key === 'vencido' ? 'atrasados' : 'pagar')}><span><strong>{label}</strong><small>{num(bucket.quantidade)} conta(s)</small></span><b>{formatMoney(num(bucket.valor))}</b><ChevronRight size={14} /></button> })}</div>
        </SectionCard>
      </div>

      <SectionCard title="Acompanhamento" caption={`${alerts.length} alerta(s) relevante(s) para o período`} className="finance-visual-card finance-alerts-card">
        <div className="overview-alert-list">{alerts.length ? alerts.map((alert, index) => <button type="button" className={`overview-alert-item ${alert?.nivel === 'critico' ? 'is-urgente' : 'is-atencao'}`} key={`${alert?.titulo || 'alerta'}-${index}`} onClick={() => alert && openOperations(alertFilter(alert))}><span>{alert?.nivel === 'critico' ? <AlertTriangle size={18} /> : <Clock3 size={18} />}</span><div><strong>{alert?.titulo || 'Atenção financeira'}</strong><small>{alert?.detalhe || 'Verifique este indicador.'}</small></div><ChevronRight size={16} /></button>) : <EmptyState title="Nenhum alerta de atenção" description="Não há sinais críticos ou de atenção no período informado." />}</div>
      </SectionCard>

      <SectionCard title="Compromissos e recorrências" caption="Valores e cadastros que compõem o acompanhamento financeiro"><div className="overview-summary-list finance-commitments-list">
        <button type="button" onClick={() => openOperations('todos')}><span><strong>Recorrências ativas</strong><small>Compromissos cadastrados</small></span><b>{num(kpis.recorrencias_ativas).toLocaleString('pt-BR')}</b><ChevronRight size={14} /></button>
        <button type="button" onClick={() => openOperations('pagar')}><span><strong>Compromissos recorrentes</strong><small>Valor previsto</small></span><b>{formatMoney(num(kpis.compromissos_recorrentes))}</b><ChevronRight size={14} /></button>
        <button type="button" onClick={() => openOperations('receber')}><span><strong>Receitas a receber</strong><small>Valores em aberto</small></span><b>{formatMoney(num(kpis.receitas_a_receber))}</b><ChevronRight size={14} /></button>
        <button type="button" onClick={() => openOperations('pagar')}><span><strong>Despesas a pagar</strong><small>Valores em aberto</small></span><b>{formatMoney(num(kpis.despesas_a_pagar))}</b><ChevronRight size={14} /></button>
      </div></SectionCard>
    </div>
  )
}
