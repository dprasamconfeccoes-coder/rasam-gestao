import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Image,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { adminFinanceiroExecutivo } from '../lib/api'
import { saoPauloToday } from '../lib/business-date'
import { FinanceHealthDashboard } from './FinanceHealthDashboard'
import type { FinanceiroExecutivoDashboard, FinanceiroExecutivoEvolucao, FinanceiroExecutivoKpis } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, formatDate, formatMoney } from '../components/ui'
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

function KpiCard({ label, value, detail, tone, trend, icon: Icon }: { label: string; value: string; detail: string; tone: string; trend?: string; icon: typeof TrendingUp }) {
  return (
    <article className={`finance-executive-kpi ${tone}`}>
      <div className="finance-kpi-top"><span>{label}</span><Icon size={17} /></div>
      <strong>{value}</strong>
      <small>{detail}</small>
      {trend && <em>{trend}</em>}
    </article>
  )
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
      <summary><Download size={15} /> Exportar</summary>
      <div className="finance-export-options" role="group" aria-label="Exportar resumo financeiro">
        <button type="button" onClick={() => data && void exportFile(() => downloadFinanceDashboardPdf(data, periodLabel))} disabled={disabled}><FileText size={15} /> PDF gerencial</button>
        <button type="button" onClick={() => data && void exportFile(() => downloadFinanceDashboardXlsx(data, periodLabel))} disabled={disabled}><BarChart3 size={15} /> Excel (.xlsx)</button>
        <button type="button" onClick={() => data && void exportFile(() => downloadFinanceDashboardImage(data, periodLabel, 'png'))} disabled={disabled}><Image size={15} /> Imagem (.png)</button>
        <button type="button" onClick={() => data && void exportFile(() => downloadFinanceDashboardImage(data, periodLabel, 'jpg'))} disabled={disabled}><Image size={15} /> Imagem (.jpg)</button>
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

  const header = (
    <header className="finance-workspace-header">
      <div className="finance-workspace-title">
        <span className="finance-workspace-icon"><WalletCards size={21} /></span>
        <div><h1>Financeiro</h1><span>{periodLabel}{dataReady && updatedAt ? ` · atualizado ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
      </div>
      <div className="finance-workspace-toolbar">
        <div className="finance-range-switch" role="group" aria-label="Período financeiro">
          {(Object.entries(ranges) as [RangeKey, { label: string }][]).map(([key, item]) => <button key={key} className={range === key ? 'active' : ''} onClick={() => setRange(key)} aria-pressed={range === key}>{item.label}</button>)}
        </div>
        <button className="secondary-button finance-toolbar-button" onClick={() => setShowOperations(true)}><WalletCards size={15} /> Movimentações</button>
        {onNavigateToReports && <button className="secondary-button finance-toolbar-button" onClick={onNavigateToReports}><BarChart3 size={15} /> Relatórios</button>}
        <button className="secondary-button finance-toolbar-button finance-refresh-button" onClick={() => void load()} disabled={loading} aria-label="Atualizar dados"><RefreshCw size={15} className={loading ? 'spin' : ''} /><span>Atualizar</span></button>
        <ExportMenu data={dataReady ? data : null} periodLabel={periodLabel} disabled={!dataReady || loading} onError={setError} />
      </div>
    </header>
  )

  if (loading && !dataReady) return <div className="debt-management-page finance-executive-page">{header}<LoadingState label="Carregando financeiro…" /></div>
  if (error && !dataReady) return <div className="debt-management-page finance-executive-page">{header}<ErrorState message={error} /><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Tentar novamente</button></div>

  return (
    <div className="debt-management-page finance-executive-page">
      {header}
      {error && <div className="finance-inline-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Fechar erro">×</button></div>}
      {topAlert ? (
        <button type="button" className={`finance-priority-alert ${topAlert.nivel === 'critico' ? 'is-critical' : 'is-attention'}`} onClick={() => openOperations(alertFilter(topAlert))}>
          <span className="finance-priority-icon">{topAlert.nivel === 'critico' ? <AlertTriangle size={17} /> : <Clock3 size={17} />}</span>
          <span className="finance-priority-copy"><strong>{topAlert.titulo || 'Atenção financeira'}</strong><small>{topAlert.detalhe || 'Há um item que requer acompanhamento.'}</small></span>
          {alerts.length > 1 && <b>{alerts.length} alertas</b>}
          <ChevronRight size={16} className="finance-priority-arrow" />
        </button>
      ) : (
        <div className="finance-period-context"><CalendarDays size={14} /><span>Competências consideradas: <strong>{periodLabel}</strong></span><span className="finance-context-status"><CheckCircle2 size={14} /> Sem alertas de atenção</span></div>
      )}

      <section className="finance-executive-kpis" aria-label="Indicadores financeiros">
        <KpiCard label="Saldo projetado" value={formatMoney(projected)} detail="Realizado + compromissos futuros" tone={projected >= 0 ? 'is-positive' : 'is-negative'} trend={projected >= 0 ? 'Projeção positiva' : 'Projeção negativa'} icon={projected >= 0 ? TrendingUp : TrendingDown} />
        <KpiCard label="Receitas realizadas" value={formatMoney(num(kpis.receitas_realizadas))} detail={`${formatMoney(num(kpis.receitas_a_receber))} a receber`} tone="is-green" icon={ArrowUpRight} />
        <KpiCard label="Despesas realizadas" value={formatMoney(num(kpis.despesas_realizadas))} detail={`${formatMoney(num(kpis.despesas_vencidas))} vencidas`} tone="is-red" icon={ArrowDownRight} />
        <KpiCard label="Resultado operacional" value={formatMoney(result)} detail="Receitas menos despesas realizadas" tone={result >= 0 ? 'is-positive' : 'is-negative'} icon={WalletCards} />
      </section>

      <div className="finance-executive-grid">
        <section className="finance-visual-card finance-evolution-card">
          <div className="finance-card-heading"><div><h2>Movimentação por competência</h2><span>Valores realizados e previstos</span></div><BarChart3 size={18} /></div>
          <div className="finance-chart-legend"><span><i className="is-income" />Receita realizada</span><span><i className="is-expense" />Despesa realizada</span><span><i className="is-income-soft" />A receber</span><span><i className="is-expense-soft" />A pagar</span></div>
          {rows.length ? <EvolutionChart rows={rows} /> : <EmptyState title="Sem histórico neste período" description="A evolução será exibida quando houver movimentações financeiras registradas." />}
        </section>
        <section className="finance-visual-card finance-projection-card">
          <div className="finance-card-heading"><div><h2>Fluxo de caixa</h2><span>Saldo operacional por competência</span></div><WalletCards size={18} /></div>
          <div className="finance-projection-highlight"><div><small>Saldo projetado</small><strong className={projected >= 0 ? 'positive-value' : 'negative-value'}>{formatMoney(projected)}</strong></div><span>{projected >= 0 ? 'Compatível com os compromissos modelados.' : 'O caixa projetado requer priorização.'}</span></div>
          {rows.length ? <CashflowChart rows={rows} /> : <EmptyState title="Sem projeção disponível" description="Cadastre receitas e despesas para visualizar o fluxo por competência." />}
        </section>
      </div>

      <div className="finance-executive-grid finance-secondary-grid">
        <section className="finance-visual-card">
          <div className="finance-card-heading"><div><h2>Despesas por categoria</h2><span>Composição no período selecionado</span></div><TrendingDown size={18} /></div>
          {categories.length ? <div className="finance-category-list">{categories.slice(0, 8).map((item) => <div className="finance-category-row" key={item.categoria}><div><span>{item.categoria}</span><strong>{formatMoney(num(item.valor))}</strong></div><div className="finance-category-track"><i style={{ width: `${Math.max(3, num(item.valor) / maxCategory * 100)}%` }} /></div><small>{num(item.quantidade)} lançamento(s)</small></div>)}</div> : <EmptyState title="Sem despesas categorizadas" description="Não há composição por categoria disponível neste período." />}
        </section>
        <section className="finance-visual-card">
          <div className="finance-card-heading"><div><h2>Agenda de vencimentos</h2><span>Contas a pagar por faixa de risco</span></div><CalendarDays size={18} /></div>
          <div className="finance-aging-list">{[['Vencido', 'vencido', 'is-critical'], ['Hoje', 'hoje', 'is-today'], ['Próximos 7 dias', 'sete_dias', 'is-warning'], ['8 a 30 dias', 'trinta_dias', 'is-normal']].map(([label, key, tone]) => { const bucket = aging[key as keyof typeof aging] || {}; return <button type="button" className={`finance-aging-row ${tone}`} key={key} onClick={() => openOperations(key === 'vencido' ? 'atrasados' : 'pagar')}><span>{label}</span><strong>{formatMoney(num(bucket.valor))}</strong><small>{num(bucket.quantidade)} conta(s)</small><ChevronRight size={14} /></button> })}</div>
        </section>
      </div>

      <section className="finance-visual-card finance-alerts-card">
        <div className="finance-card-heading"><div><h2>Acompanhamento</h2><span>Alertas relevantes para o período</span></div>{alerts.length ? <span className="finance-alert-count">{alerts.length} sinal(is)</span> : <CheckCircle2 size={18} />}</div>
        <div className="finance-alert-list">{alerts.length ? alerts.map((alert, index) => <button type="button" className={`finance-alert ${alert?.nivel === 'critico' ? 'critico' : 'atencao'}`} key={`${alert?.titulo || 'alerta'}-${index}`} onClick={() => alert && openOperations(alertFilter(alert))}><span>{alert?.nivel === 'critico' ? <AlertTriangle size={17} /> : <Clock3 size={17} />}</span><span className="finance-alert-copy"><strong>{alert?.titulo || 'Atenção financeira'}</strong><small>{alert?.detalhe || 'Verifique este indicador.'}</small></span><ChevronRight size={15} /></button>) : <div className="finance-no-alert"><CheckCircle2 size={18} /><span><strong>Nenhum alerta de atenção</strong><small>Não há sinais críticos ou de atenção no período informado.</small></span></div>}</div>
      </section>

      <footer className="finance-executive-foot"><span><strong>{num(kpis.recorrencias_ativas)}</strong> recorrências ativas</span><span><strong>{formatMoney(num(kpis.compromissos_recorrentes))}</strong> compromissos recorrentes</span><span><strong>{formatMoney(num(kpis.receitas_a_receber))}</strong> receitas a receber</span><span><strong>{formatMoney(num(kpis.despesas_a_pagar))}</strong> despesas a pagar</span></footer>
    </div>
  )
}
