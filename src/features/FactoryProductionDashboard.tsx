import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Check, ChevronDown, Clock3, Factory, PackageCheck, RefreshCw, Scissors, Search, Truck } from 'lucide-react'
import { getFactoryProduction, releaseWorkOrderForFinance, saveFactoryProduction, startWorkOrderProduction } from '../lib/api'
import type { FactoryProductionLot, FactoryProductionResponse, FactoryProductionSummary, WorkOrderProgressPayload } from '../lib/types'
import { ConfirmationModal, EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate } from '../components/ui'
import './factory-production.css'

type FilterKey = 'todas' | 'recebida' | 'em_producao' | 'costurada' | 'expedida' | 'entregue' | 'aguardando_pagamento'
type ProductionConfirmation = { title: string; description: string; confirmLabel: string; detail: string; run: () => Promise<boolean> }

const blankSummary: FactoryProductionSummary = {
  lotes_ativos: 0, lotes_aguardando_inicio: 0, lotes_em_producao: 0, lotes_prontos_entrega: 0,
  lotes_entregues: 0, lotes_atrasados: 0, lotes_aguardando_pagamento: 0,
  unidades_solicitadas: 0, unidades_produzidas: 0, unidades_costuradas: 0, unidades_entregues: 0,
  unidades_aguardando_costura: 0, unidades_prontas_entrega: 0,
}

const statusLabels: Record<string, string> = {
  recebida: 'Aguardando início', em_producao: 'Em produção', costurada: 'Pronta para entrega',
  expedida: 'Entrega parcial', entregue: 'Entregue', cancelada: 'Cancelada',
}
const filterLabels: Record<FilterKey, string> = {
  todas: 'Todos os lotes', recebida: 'Aguardando início', em_producao: 'Em produção',
  costurada: 'Prontos para entrega', expedida: 'Entrega parcial', entregue: 'Entregues',
  aguardando_pagamento: 'Liberados para financeiro',
}

function totals(lot: FactoryProductionLot) {
  return (lot.tamanhos || []).reduce((acc, row) => ({
    requested: acc.requested + Number(row.quantidade || 0),
    produced: acc.produced + Number(row.quantidade_produzida || 0),
    sewn: acc.sewn + Number(row.quantidade_costurada || 0),
    delivered: acc.delivered + Number(row.quantidade_entregue || 0),
  }), { requested: 0, produced: 0, sewn: 0, delivered: 0 })
}

function shortDay(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function isLate(lot: FactoryProductionLot) {
  return Boolean(lot.prazo && lot.prazo < new Date().toLocaleDateString('sv-SE') && !['entregue', 'cancelada'].includes(lot.status))
}

export function FactoryProductionDashboard({ token }: { token: string }) {
  const [data, setData] = useState<FactoryProductionResponse>()
  const [drafts, setDrafts] = useState<Record<string, WorkOrderProgressPayload[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('todas')
  const [confirmation, setConfirmation] = useState<ProductionConfirmation | null>(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)

  const reload = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    setError('')
    try {
      const response = await getFactoryProduction(token)
      if (!response.sucesso) throw new Error(response.erro || 'Não foi possível carregar o painel fabril.')
      setData(response)
      setDrafts(Object.fromEntries((response.lotes || []).map((lot) => [lot.id, (lot.tamanhos || []).map((size) => ({
        id: size.id,
        quantidade_produzida: Number(size.quantidade_produzida || 0),
        quantidade_costurada: Number(size.quantidade_costurada || 0),
        quantidade_entregue: Number(size.quantidade_entregue || 0),
      }))])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar Produção.')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [token])

  useEffect(() => { void reload(true) }, [reload])

  const lots = data?.lotes || []
  const summary = { ...blankSummary, ...(data?.resumo || {}) }
  const filteredLots = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR')
    return lots.filter((lot) => {
      const matchText = !term || [lot.numero, lot.cliente, lot.descricao].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term))
      const matchStatus = filter === 'todas'
        || (filter === 'aguardando_pagamento' && Boolean(lot.financeiro_liberado_em))
        || lot.status === filter
      return matchText && matchStatus
    })
  }, [lots, query, filter])

  async function runAction(key: string, action: () => Promise<{ sucesso: boolean; erro?: string }>, success: string): Promise<boolean> {
    setSaving(key)
    setError('')
    setNotice('')
    try {
      const result = await action()
      if (!result.sucesso) throw new Error(result.erro || 'A alteração não foi concluída.')
      setNotice(success)
      await reload(false)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar alteração.')
      return false
    } finally {
      setSaving('')
    }
  }

  function changeProgress(lotId: string, index: number, field: keyof Omit<WorkOrderProgressPayload, 'id'>, value: number) {
    setDrafts((current) => ({
      ...current,
      [lotId]: (current[lotId] || []).map((row, rowIndex) => rowIndex === index ? { ...row, [field]: Math.max(0, Math.floor(value || 0)) } : row),
    }))
  }

  function fillProduction(lot: FactoryProductionLot, mode: 'produzir' | 'costurar' | 'entregar') {
    setDrafts((current) => ({
      ...current,
      [lot.id]: (lot.tamanhos || []).map((size, index) => {
        const draft = current[lot.id]?.[index]
        const max = Number(size.quantidade || 0)
        if (mode === 'produzir') return { id: size.id, quantidade_produzida: max, quantidade_costurada: draft?.quantidade_costurada || 0, quantidade_entregue: draft?.quantidade_entregue || 0 }
        if (mode === 'costurar') return { id: size.id, quantidade_produzida: max, quantidade_costurada: max, quantidade_entregue: draft?.quantidade_entregue || 0 }
        return { id: size.id, quantidade_produzida: max, quantidade_costurada: max, quantidade_entregue: max }
      }),
    }))
    setExpanded((current) => ({ ...current, [lot.id]: true }))
  }

  async function saveProgress(lot: FactoryProductionLot) {
    const items = drafts[lot.id] || []
    if (items.length !== lot.tamanhos.length || items.some((item, index) =>
      !Number.isInteger(item.quantidade_produzida) || !Number.isInteger(item.quantidade_costurada) || !Number.isInteger(item.quantidade_entregue)
      || item.quantidade_entregue > item.quantidade_costurada
      || item.quantidade_costurada > item.quantidade_produzida
      || item.quantidade_produzida > lot.tamanhos[index].quantidade
    )) {
      setError('Revise a grade por tamanho: entregue ≤ costurada ≤ produzida ≤ solicitada.')
      return
    }
    const produced = items.reduce((sum, item) => sum + item.quantidade_produzida, 0)
    const sewn = items.reduce((sum, item) => sum + item.quantidade_costurada, 0)
    const delivered = items.reduce((sum, item) => sum + item.quantidade_entregue, 0)
    setError('')
    setConfirmation({
      title: 'Confirmar atualização da produção',
      description: `A grade do lote ${lot.numero} será atualizada e a movimentação ficará registrada no histórico de auditoria.`,
      confirmLabel: 'Salvar produção',
      detail: `${lot.cliente || 'Cliente não informado'} · ${lot.descricao}\nProduzidas: ${produced} · Costuradas: ${sewn} · Entregues: ${delivered}`,
      run: () => runAction(`progresso-${lot.id}`, () => saveFactoryProduction(token, lot.id, items), `Progresso do lote ${lot.numero} salvo e auditado.`),
    })
  }

  async function confirmProductionAction() {
    if (!confirmation) return
    setConfirmationBusy(true)
    const completed = await confirmation.run()
    if (completed) setConfirmation(null)
    setConfirmationBusy(false)
  }

  const stageCounts = [
    { label: 'Aguardando início', count: lots.filter((lot) => lot.status === 'recebida').length, tone: 'slate' },
    { label: 'Em produção', count: lots.filter((lot) => lot.status === 'em_producao').length, tone: 'gold' },
    { label: 'Prontos para entrega', count: lots.filter((lot) => lot.status === 'costurada').length, tone: 'blue' },
    { label: 'Entrega parcial', count: lots.filter((lot) => lot.status === 'expedida').length, tone: 'violet' },
    { label: 'Entregues', count: lots.filter((lot) => lot.status === 'entregue').length, tone: 'green' },
  ]
  const maxStage = Math.max(1, ...stageCounts.map((stage) => stage.count))
  const trend = data?.tendencia || []
  const maxTrend = Math.max(1, ...trend.flatMap((day) => [day.produzidas, day.costuradas, day.entregues].map((value) => Math.max(0, value))))

  return <div className="factory-production-page">
    <PageHeading eyebrow="Operação · chão de fábrica" title="Produção" description="Visão agregada da fábrica: lotes, fluxo e unidades produzidas — sem indicadores individuais por funcionário." action={<button className="secondary-button" onClick={() => void reload(true)} disabled={loading || Boolean(saving)}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>} />
    {notice && <div className="factory-notice" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></div>}
    {error && <div className="factory-error"><ErrorState message={error} /><button className="text-button" onClick={() => setError('')}>Fechar</button></div>}
    {loading ? <LoadingState /> : <>
      <section className="factory-kpis" aria-label="Indicadores agregados da fábrica">
        <article className="factory-kpi kpi-active"><span>Lotes ativos</span><strong>{summary.lotes_ativos}</strong><small>{summary.lotes_aguardando_inicio} aguardando início</small><Factory size={19} /></article>
        <article className="factory-kpi kpi-produced"><span>Unidades produzidas</span><strong>{summary.unidades_produzidas.toLocaleString('pt-BR')}</strong><small>de {summary.unidades_solicitadas.toLocaleString('pt-BR')} solicitadas</small><Activity size={19} /></article>
        <article className="factory-kpi kpi-sewing"><span>Aguardando costura</span><strong>{summary.unidades_aguardando_costura.toLocaleString('pt-BR')}</strong><small>já produzidas, ainda não costuradas</small><Scissors size={19} /></article>
        <article className="factory-kpi kpi-delivery"><span>Prontas para entrega</span><strong>{summary.unidades_prontas_entrega.toLocaleString('pt-BR')}</strong><small>{summary.lotes_prontos_entrega} lote(s) na etapa</small><PackageCheck size={19} /></article>
        <article className="factory-kpi kpi-delivered"><span>Unidades entregues</span><strong>{summary.unidades_entregues.toLocaleString('pt-BR')}</strong><small>acumulado dos lotes não cancelados</small><Truck size={19} /></article>
        <article className="factory-kpi kpi-late"><span>Lotes atrasados</span><strong>{summary.lotes_atrasados}</strong><small>prazo previsto ultrapassado</small><AlertTriangle size={19} /></article>
      </section>

      <div className="factory-analytics-grid">
        <SectionCard title="Fluxo dos lotes" caption="Distribuição operacional da fábrica">
          <div className="factory-stage-chart">{stageCounts.map((stage) => <div className="factory-stage-row" key={stage.label}>
            <div><span>{stage.label}</span><strong>{stage.count}</strong></div>
            <div className="factory-stage-track"><i className={`tone-${stage.tone}`} style={{ width: `${stage.count ? Math.max(7, (stage.count / maxStage) * 100) : 0}%` }} /></div>
          </div>)}</div>
        </SectionCard>
        <SectionCard title="Ritmo diário" caption="Movimentações líquidas nos últimos 14 dias">
          {trend.some((day) => day.produzidas || day.costuradas || day.entregues) ? <>
            <div className="factory-chart-legend"><span><i className="legend-produced" />Produção</span><span><i className="legend-sewn" />Costura</span><span><i className="legend-delivered" />Entrega</span></div>
            <div className="factory-trend-chart" role="img" aria-label="Gráfico de unidades produzidas, costuradas e entregues nos últimos 14 dias">{trend.map((day) => <div className="factory-trend-day" key={day.data} title={`${shortDay(day.data)} · produção ${day.produzidas}, costura ${day.costuradas}, entrega ${day.entregues}`}>
              <div className="factory-trend-bars"><i className="bar-produced" style={{ height: `${Math.max(0, day.produzidas) / maxTrend * 100}%` }} /><i className="bar-sewn" style={{ height: `${Math.max(0, day.costuradas) / maxTrend * 100}%` }} /><i className="bar-delivered" style={{ height: `${Math.max(0, day.entregues) / maxTrend * 100}%` }} /></div>
              <small>{shortDay(day.data)}</small>
            </div>)}</div>
          </> : <div className="factory-chart-empty"><Activity size={23} /><strong>A série começa com os novos registros</strong><span>As movimentações diárias serão preenchidas quando a equipe iniciar e atualizar lotes.</span></div>}
        </SectionCard>
      </div>

      <SectionCard title="Lotes da fábrica" caption={`${filteredLots.length} lote(s) · ${lots.filter((lot) => Boolean(lot.financeiro_liberado_em)).length} liberado(s) para financeiro · sem painel individual`}>
        <div className="factory-toolbar">
          <label className="factory-search"><Search size={16} /><input aria-label="Buscar lotes por número, cliente ou produto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por ordem, cliente ou produto" /></label>
          <label className="factory-filter"><span>Etapa</span><select value={filter} onChange={(event) => setFilter(event.target.value as FilterKey)}>{Object.entries(filterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {filteredLots.length === 0 ? <EmptyState title={lots.length ? 'Nenhum lote corresponde aos filtros' : 'Nenhum lote cadastrado'} description={lots.length ? 'Ajuste a busca ou a etapa.' : 'Cadastre um lote em Ordens de Serviço para começar.'} /> : <div className="factory-lot-list">
          {filteredLots.map((lot) => {
            const sum = totals(lot)
            const progress = sum.requested ? Math.round(sum.produced / sum.requested * 100) : 0
            const isEditable = !['recebida', 'cancelada', 'entregue'].includes(lot.status) && !lot.financeiro_liberado_em
            const currentDraft = drafts[lot.id] || []
            return <article className={`factory-lot-card ${isLate(lot) ? 'is-late' : ''}`} key={lot.id}>
              <header className="factory-lot-header"><div className="factory-lot-main"><div className="factory-lot-identity"><strong>{lot.numero}</strong><StatusPill value={statusLabels[lot.status] || lot.status.replaceAll('_', ' ')} />{lot.financeiro_liberado_em && <span className="factory-finance-badge">Liberado para financeiro</span>}</div><h3>{lot.cliente || 'Cliente não informado'}</h3><p>{lot.descricao}</p></div><div className="factory-lot-deadline"><small>Prazo</small><strong className={isLate(lot) ? 'late' : ''}>{lot.prazo ? formatDate(lot.prazo) : 'Sem prazo'}</strong>{isLate(lot) && <span><AlertTriangle size={13} /> Atrasado</span>}</div></header>
              <div className="factory-progress-summary"><div><span>Solicitadas</span><strong>{sum.requested.toLocaleString('pt-BR')}</strong></div><div><span>Produzidas</span><strong>{sum.produced.toLocaleString('pt-BR')}</strong></div><div><span>Costuradas</span><strong>{sum.sewn.toLocaleString('pt-BR')}</strong></div><div><span>Entregues</span><strong>{sum.delivered.toLocaleString('pt-BR')}</strong></div></div>
              <div className="factory-lot-progress"><div><span>Produção do lote</span><b>{progress}%</b></div><span className="factory-progress-track"><i style={{ width: `${progress}%` }} /></span></div>
              <div className="factory-lot-actions">
                {lot.status === 'recebida' && <button className="primary-button" disabled={Boolean(saving) || confirmationBusy} onClick={() => { setError(''); setConfirmation({ title: 'Confirmar início da produção', description: `O lote ${lot.numero} passará de “Aguardando início” para “Em produção”.`, confirmLabel: 'Iniciar lote', detail: `${lot.cliente || 'Cliente não informado'} · ${lot.descricao}\n${sum.requested.toLocaleString('pt-BR')} peças solicitadas`, run: () => runAction(`start-${lot.id}`, () => startWorkOrderProduction(token, lot.id), `Produção do lote ${lot.numero} iniciada.`) }) }}><Factory size={15} /> Iniciar produção</button>}
                {isEditable && <button className="secondary-button" onClick={() => setExpanded((current) => ({ ...current, [lot.id]: !current[lot.id] }))}><Scissors size={15} /> {expanded[lot.id] ? 'Fechar grade' : 'Gerenciar produção e entregas'} <ChevronDown size={14} className={expanded[lot.id] ? 'is-open' : ''} /></button>}
                {lot.status === 'entregue' && !lot.financeiro_liberado_em && <button className="primary-button" disabled={Boolean(saving) || confirmationBusy} onClick={() => { setError(''); setConfirmation({ title: 'Confirmar liberação para financeiro', description: `O lote ${lot.numero} ficará disponível em Ordens de Serviço para registrar pagamento e anexar nota fiscal/comprovantes.`, confirmLabel: 'Liberar lote', detail: `${lot.cliente || 'Cliente não informado'} · ${lot.descricao}\n${sum.delivered.toLocaleString('pt-BR')} peças entregues`, run: () => runAction(`release-${lot.id}`, () => releaseWorkOrderForFinance(token, lot.id), `Lote ${lot.numero} liberado para o financeiro.`) }) }}><Check size={15} /> Liberar para financeiro</button>}
                {lot.financeiro_liberado_em && <span className="factory-release-note"><Check size={15} /> Liberado para financeiro em {formatDate(lot.financeiro_liberado_em)}</span>}
              </div>
              {expanded[lot.id] && isEditable && <div className="factory-editor">
                <div className="factory-editor-heading"><div><strong>Produção parcial ou completa por tamanho</strong><small>Entregue ≤ costurada ≤ produzida ≤ solicitada.</small></div><div className="factory-quick-actions"><button type="button" className="text-button" onClick={() => fillProduction(lot, 'produzir')}>Completar produção</button><button type="button" className="text-button" onClick={() => fillProduction(lot, 'costurar')}>Completar costura</button><button type="button" className="text-button" onClick={() => fillProduction(lot, 'entregar')}>Preencher entrega total</button></div></div>
                {lot.tamanhos.length === 0 ? <p className="factory-no-sizes">Este lote não tem grade por tamanho disponível.</p> : <div className="factory-size-table"><div className="factory-size-head"><span>Tamanho</span><span>Solicitadas</span><span>Produzidas</span><span>Costuradas</span><span>Entregues</span></div>{lot.tamanhos.map((size, index) => {
                  const draft = currentDraft[index] || { id: size.id, quantidade_produzida: 0, quantidade_costurada: 0, quantidade_entregue: 0 }
                  return <div className="factory-size-row" key={size.id}><strong>{size.tamanho}</strong><span>{size.quantidade.toLocaleString('pt-BR')}</span>
                    {(['quantidade_produzida', 'quantidade_costurada', 'quantidade_entregue'] as const).map((field) => <input key={field} aria-label={`${field === 'quantidade_produzida' ? 'Produzidas' : field === 'quantidade_costurada' ? 'Costuradas' : 'Entregues'} · ${size.tamanho}`} type="number" min="0" max={size.quantidade} step="1" value={draft[field]} onChange={(event) => changeProgress(lot.id, index, field, Number(event.target.value))} />)}
                  </div>
                })}</div>}
                <div className="factory-editor-footer"><span>O status do lote avança automaticamente conforme os totais registrados.</span><button className="primary-button" disabled={Boolean(saving) || confirmationBusy} onClick={() => void saveProgress(lot)}><Check size={15} /> Revisar atualização</button></div>
              </div>}
            </article>
          })}
        </div>}
      </SectionCard>
    </>}
    {confirmation && <ConfirmationModal title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} busy={confirmationBusy} onCancel={() => { if (!confirmationBusy) { setConfirmation(null); setError('') } }} onConfirm={() => void confirmProductionAction()}><div className="confirmation-summary production-confirmation-summary">{confirmation.detail.split('\n').map((line, index) => <p key={index}>{line}</p>)}</div>{error && <p className="confirmation-modal-error" role="alert">{error}</p>}</ConfirmationModal>}
  </div>
}
