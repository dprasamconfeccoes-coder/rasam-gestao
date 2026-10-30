import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  FileCheck2,
  FileText,
  Factory,
  PackageCheck,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Truck,
  X,
} from 'lucide-react'
import {
  createWorkOrder,
  getWorkOrderDashboard,
  updateWorkOrderFinance,
  updateWorkOrderProgress,
  updateWorkOrderStatus,
} from '../lib/api'
import type { OrderRow, OrderSizeRow, WorkOrderProgressPayload, WorkOrderSummary } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import './work-orders.css'

type FilterKey = 'todas' | 'recebida' | 'em_producao' | 'costurada' | 'expedida' | 'entregue' | 'vencida' | 'vence_7_dias' | 'pagamento_pendente' | 'pago' | 'sem_nf'
type SizeDraft = { id?: string; tamanho: string; quantidade: string }

const orderStatusLabels: Record<string, string> = {
  recebida: 'Recebida',
  em_producao: 'Em produção',
  costurada: 'Costurada',
  expedida: 'Expedida',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
}
const orderStatusOptions = Object.entries(orderStatusLabels)
const filterLabels: Record<FilterKey, string> = {
  todas: 'Todas as ordens',
  recebida: 'Aguardando início',
  em_producao: 'Em produção',
  costurada: 'Costuradas',
  expedida: 'Expedidas',
  entregue: 'Entregues',
  vencida: 'Com prazo vencido',
  vence_7_dias: 'Vencem em até 7 dias',
  pagamento_pendente: 'Aguardando pagamento',
  pago: 'Pagas',
  sem_nf: 'Sem nota fiscal',
}
const auditLabels: Record<string, string> = {
  ordem_criada: 'Ordem criada',
  status_alterado: 'Etapa operacional alterada',
  financeiro_nf_atualizado: 'Pagamento ou nota fiscal atualizados',
  progresso_atualizado: 'Progresso por tamanho atualizado',
}
const emptySummary: WorkOrderSummary = {
  total_ordens: 0, ordens_ativas: 0, recebidas: 0, em_producao: 0, costuradas: 0, expedidas: 0, entregues: 0,
  pagas: 0, aguardando_pagamento: 0, notas_fiscais_emitidas: 0, sem_nota_fiscal: 0, vencidas: 0, vencem_em_7_dias: 0,
  valor_ordens_ativas: 0, valor_aguardando_pagamento: 0, valor_pago: 0, unidades_total: 0, unidades_produzidas: 0,
  unidades_costuradas: 0, aguardando_costura: 0, unidades_entregues: 0,
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isOverdue(order: OrderRow) {
  return Boolean(order.prazo && order.prazo < localDateKey() && !['entregue', 'cancelada'].includes(order.status))
}

function isDueWithin7Days(order: OrderRow) {
  return Boolean(order.prazo && order.prazo >= localDateKey() && order.prazo <= localDateKey(new Date(Date.now() + 7 * 86400000)) && !['entregue', 'cancelada'].includes(order.status))
}

function orderProgress(order: OrderRow) {
  const sizes = order.tamanhos || []
  return sizes.reduce((acc, item) => ({
    total: acc.total + Number(item.quantidade || 0),
    produced: acc.produced + Number(item.quantidade_produzida || 0),
    sewn: acc.sewn + Number(item.quantidade_costurada || 0),
    delivered: acc.delivered + Number(item.quantidade_entregue || 0),
  }), { total: 0, produced: 0, sewn: 0, delivered: 0 })
}

function orderAlertText(order: OrderRow) {
  if (isOverdue(order)) return 'Prazo vencido'
  if (order.prazo) {
    const due = new Date(`${order.prazo}T00:00:00`)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const days = Math.ceil((due.getTime() - today.getTime()) / 86400000)
    if (days >= 0 && days <= 7 && !['entregue', 'cancelada'].includes(order.status)) return days === 0 ? 'Vence hoje' : `Vence em ${days} dia${days === 1 ? '' : 's'}`
  }
  return ''
}

export function WorkOrdersDashboard({ token }: { token: string }) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [summary, setSummary] = useState<WorkOrderSummary>(emptySummary)
  const [progressDrafts, setProgressDrafts] = useState<Record<string, WorkOrderProgressPayload[]>>({})
  const [invoiceDrafts, setInvoiceDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('todas')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ cliente: '', descricao: '', prioridade: 'normal', prazo: '', valor: '', observacoes: '' })
  const [sizes, setSizes] = useState<SizeDraft[]>([{ tamanho: 'M', quantidade: '1' }])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getWorkOrderDashboard(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível consultar as ordens de serviço.')
      const rows = result.ordens || []
      setOrders(rows)
      setSummary({ ...emptySummary, ...(result.resumo || {}) })
      setProgressDrafts(Object.fromEntries(rows.map((order) => [order.id, (order.tamanhos || []).map((size) => ({
        id: size.id,
        quantidade_produzida: Number(size.quantidade_produzida || 0),
        quantidade_costurada: Number(size.quantidade_costurada || 0),
        quantidade_entregue: Number(size.quantidade_entregue || 0),
      }))])))
      setInvoiceDrafts(Object.fromEntries(rows.map((order) => [order.id, order.nota_fiscal_numero || ''])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o painel de ordens.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void reload() }, [reload])

  const filteredOrders = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR')
    return orders.filter((order) => {
      const matchesText = !term || [order.numero, order.cliente, order.descricao].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term))
      const matchesFilter = filter === 'todas'
        || order.status === filter
        || (filter === 'vencida' && isOverdue(order))
        || (filter === 'vence_7_dias' && isDueWithin7Days(order))
        || (filter === 'pagamento_pendente' && order.status_pagamento === 'pendente' && order.status !== 'cancelada')
        || (filter === 'pago' && order.status_pagamento === 'pago')
        || (filter === 'sem_nf' && !order.nota_fiscal_emitida_em && order.status !== 'cancelada')
      return matchesText && matchesFilter
    })
  }, [orders, query, filter])

  async function runAction(key: string, action: () => Promise<{ sucesso: boolean; erro?: string }>, success: string) {
    setSaving(key)
    setError('')
    setNotice('')
    try {
      const result = await action()
      if (!result.sucesso) throw new Error(result.erro || 'A alteração não foi concluída.')
      setNotice(success)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar alteração.')
    } finally {
      setSaving('')
    }
  }

  function changeProgress(orderId: string, index: number, field: keyof Omit<WorkOrderProgressPayload, 'id'>, value: number) {
    setProgressDrafts((current) => ({
      ...current,
      [orderId]: (current[orderId] || []).map((item, rowIndex) => rowIndex === index ? { ...item, [field]: Math.max(0, value) } : item),
    }))
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const normalized = sizes.map((item) => ({ tamanho: item.tamanho.trim().toUpperCase(), quantidade: Number(item.quantidade) }))
    const labels = normalized.map((item) => item.tamanho)
    if (normalized.some((item) => !item.tamanho || !Number.isInteger(item.quantidade) || item.quantidade < 1)) {
      setError('Informe um tamanho e uma quantidade inteira maior que zero em cada linha.')
      return
    }
    if (new Set(labels).size !== labels.length) {
      setError('Cada tamanho deve aparecer apenas uma vez na grade.')
      return
    }
    if (!form.valor || !Number.isFinite(Number(form.valor)) || Number(form.valor) <= 0) {
      setError('Informe o valor total do lote.')
      return
    }
    setSaving('create')
    try {
      const result = await createWorkOrder(token, {
        clienteNome: form.cliente.trim(),
        descricao: form.descricao.trim(),
        prioridade: form.prioridade,
        prazo: form.prazo,
        valorTotal: Number(form.valor),
        observacoes: form.observacoes.trim(),
        tamanhos: normalized,
      })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível cadastrar a ordem.')
      setNotice(`Ordem ${result.numero || ''} criada com ${result.quantidade || normalized.reduce((total, item) => total + item.quantidade, 0)} unidades.`)
      setForm({ cliente: '', descricao: '', prioridade: 'normal', prazo: '', valor: '', observacoes: '' })
      setSizes([{ tamanho: 'M', quantidade: '1' }])
      setShowForm(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cadastrar ordem.')
    } finally {
      setSaving('')
    }
  }

  async function saveProgress(order: OrderRow) {
    const items = progressDrafts[order.id] || []
    const sizesForOrder = order.tamanhos || []
    if (items.length !== sizesForOrder.length || items.some((item, index) =>
      item.quantidade_entregue > item.quantidade_costurada
      || item.quantidade_costurada > item.quantidade_produzida
      || item.quantidade_produzida > sizesForOrder[index].quantidade
    )) {
      setError('Revise a grade: entregue ≤ costurada ≤ produzida ≤ quantidade solicitada.')
      return
    }
    await runAction(`progress-${order.id}`, () => updateWorkOrderProgress(token, order.id, items), `Progresso da ordem ${order.numero} atualizado e auditado.`)
  }

  const stageRows = [
    { key: 'recebida', label: 'Aguardando início', value: summary.recebidas, tone: 'slate' },
    { key: 'em_producao', label: 'Em produção', value: summary.em_producao, tone: 'gold' },
    { key: 'costurada', label: 'Costuradas', value: summary.costuradas, tone: 'blue' },
    { key: 'expedida', label: 'Expedidas', value: summary.expedidas, tone: 'violet' },
    { key: 'entregue', label: 'Entregues', value: summary.entregues, tone: 'green' },
  ]
  const maxStage = Math.max(1, ...stageRows.map((item) => item.value))

  return <div className="work-orders-page">
    <PageHeading
      eyebrow="Operação · fábrica"
      title="Ordens de serviço"
      description="Acompanhe cada lote do recebimento à entrega, com produção, costura, pagamento e nota fiscal no mesmo painel."
      action={<div className="work-orders-heading-actions"><button className="secondary-button" onClick={() => void reload()} disabled={loading || Boolean(saving)}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button><button className="primary-button" onClick={() => { setShowForm((value) => !value); setError('') }}><Plus size={17} /> {showForm ? 'Fechar cadastro' : 'Nova ordem'}</button></div>}
    />

    {notice && <div className="work-orders-notice" role="status"><Check size={17} />{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {error && <div className="work-orders-error"><ErrorState message={error} /><button className="text-button" onClick={() => setError('')}>Fechar</button></div>}

    {summary.vencidas > 0 || summary.vencem_em_7_dias > 0 || summary.aguardando_pagamento > 0 || summary.sem_nota_fiscal > 0 ? <section className="work-orders-alerts" aria-label="Alertas operacionais">
      {summary.vencidas > 0 && <button className="work-orders-alert is-danger" onClick={() => setFilter('vencida')}><AlertTriangle size={18} /><span><strong>{summary.vencidas} ordem(ns) com prazo vencido</strong><small>Priorize os lotes atrasados.</small></span><ChevronDown size={16} /></button>}
      {summary.vencem_em_7_dias > 0 && <button className="work-orders-alert is-warning" onClick={() => setFilter('vence_7_dias')}><Clock3 size={18} /><span><strong>{summary.vencem_em_7_dias} vencem nos próximos 7 dias</strong><small>Confira capacidade e andamento.</small></span><ChevronDown size={16} /></button>}
      {summary.aguardando_pagamento > 0 && <button className="work-orders-alert is-neutral" onClick={() => setFilter('pagamento_pendente')}><CircleDollarSign size={18} /><span><strong>{summary.aguardando_pagamento} aguardando pagamento</strong><small>{formatMoney(summary.valor_aguardando_pagamento)} em ordens pendentes.</small></span><ChevronDown size={16} /></button>}
      {summary.sem_nota_fiscal > 0 && <button className="work-orders-alert is-neutral" onClick={() => setFilter('sem_nf')}><FileText size={18} /><span><strong>{summary.sem_nota_fiscal} sem nota fiscal registrada</strong><small>Revise a emissão antes do fechamento.</small></span><ChevronDown size={16} /></button>}
    </section> : null}

    <section className="work-orders-metrics" aria-label="Indicadores das ordens">
      <article className="work-orders-metric metric-orders"><div className="work-orders-metric-icon"><ClipboardList size={19} /></div><span>Ordens em aberto</span><strong>{summary.ordens_ativas}</strong><small>{summary.recebidas} aguardando início · {summary.em_producao} em produção</small></article>
      <article className="work-orders-metric metric-production"><div className="work-orders-metric-icon"><Factory size={19} /></div><span>Produção realizada</span><strong>{summary.unidades_produzidas.toLocaleString('pt-BR')} <i>un.</i></strong><small>de {summary.unidades_total.toLocaleString('pt-BR')} unidades solicitadas</small></article>
      <article className="work-orders-metric metric-sewing"><div className="work-orders-metric-icon"><Scissors size={19} /></div><span>Costura e fila</span><strong>{summary.unidades_costuradas.toLocaleString('pt-BR')} <i>costuradas</i></strong><small>{summary.aguardando_costura.toLocaleString('pt-BR')} produzidas aguardando costura</small></article>
      <article className="work-orders-metric metric-delivered"><div className="work-orders-metric-icon"><Truck size={19} /></div><span>Unidades entregues</span><strong>{summary.unidades_entregues.toLocaleString('pt-BR')} <i>un.</i></strong><small>{summary.entregues} ordem(ns) marcadas como entregues</small></article>
      <article className="work-orders-metric metric-payment"><div className="work-orders-metric-icon"><CircleDollarSign size={19} /></div><span>Financeiro</span><strong>{formatMoney(summary.valor_aguardando_pagamento)}</strong><small>{summary.pagas} ordem(ns) pagas · {summary.aguardando_pagamento} pendentes</small></article>
      <article className="work-orders-metric metric-invoice"><div className="work-orders-metric-icon"><FileCheck2 size={19} /></div><span>Nota fiscal</span><strong>{summary.notas_fiscais_emitidas} <i>emitidas</i></strong><small>{summary.sem_nota_fiscal} ordem(ns) sem NF</small></article>
    </section>

    <div className="work-orders-overview-grid">
      <SectionCard title="Saúde dos lotes" caption="Ordens por etapa operacional">
        <div className="work-orders-stage-chart">{stageRows.map((item) => <button className="work-orders-stage-row" key={item.key} onClick={() => setFilter(item.key as FilterKey)}>
          <span className="work-orders-stage-label">{item.label}<b>{item.value}</b></span><span className="work-orders-stage-track"><i className={`tone-${item.tone}`} style={{ width: `${Math.max(item.value > 0 ? 7 : 0, (item.value / maxStage) * 100)}%` }} /></span>
        </button>)}</div>
        <div className="work-orders-chart-foot"><span><PackageCheck size={15} /> {summary.unidades_costuradas.toLocaleString('pt-BR')} unidades costuradas</span><span><ArrowUpRight size={15} /> {summary.entregues} ordens concluídas</span></div>
      </SectionCard>
      <SectionCard title="Leitura financeira" caption="Valores registrados nas ordens">
        <div className="work-orders-finance-total"><span>Valor das ordens em andamento</span><strong>{formatMoney(summary.valor_ordens_ativas)}</strong></div>
        <div className="work-orders-finance-line"><span><i className="dot dot-paid" /> Pago</span><strong>{formatMoney(summary.valor_pago)}</strong></div>
        <div className="work-orders-finance-line"><span><i className="dot dot-pending" /> Aguardando pagamento</span><strong>{formatMoney(summary.valor_aguardando_pagamento)}</strong></div>
        <div className="work-orders-finance-note"><ArrowDownRight size={15} /> A situação de pagamento é acompanhada separadamente da etapa de produção.</div>
      </SectionCard>
    </div>

    {showForm && <SectionCard title="Cadastrar lote de produção" caption="O número da ordem será gerado automaticamente ao salvar.">
      <form className="work-order-form" onSubmit={submitOrder}>
        <div className="work-order-form-grid">
          <label>Cliente<input required maxLength={180} value={form.cliente} onChange={(event) => setForm({ ...form, cliente: event.target.value })} placeholder="Nome do cliente" /></label>
          <label>Produto / descrição<input required maxLength={500} value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} placeholder="Ex.: Calça masculina · lote de inverno" /></label>
          <label>Prazo previsto<input required type="date" value={form.prazo} onChange={(event) => setForm({ ...form, prazo: event.target.value })} /></label>
          <label>Valor total do lote<input required type="number" min="0.01" step="0.01" value={form.valor} onChange={(event) => setForm({ ...form, valor: event.target.value })} placeholder="0,00" /></label>
          <label>Prioridade<select value={form.prioridade} onChange={(event) => setForm({ ...form, prioridade: event.target.value })}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
          <div className="work-order-number-hint"><ClipboardList size={17} /><span><strong>Identificação automática</strong><small>Uma numeração única será reservada pelo sistema.</small></span></div>
        </div>
        <div className="work-order-size-editor">
          <div className="work-order-size-head"><div><strong>Grade de tamanhos</strong><small>Informe quantidades diferentes para cada tamanho.</small></div><button type="button" className="secondary-button" onClick={() => setSizes((current) => [...current, { tamanho: '', quantidade: '1' }])}><Plus size={15} /> Adicionar tamanho</button></div>
          {sizes.map((item, index) => <div className="work-order-size-row" key={index}>
            <label>Tamanho<input required maxLength={24} value={item.tamanho} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, tamanho: event.target.value } : size))} placeholder="Ex.: P, M, 40" /></label>
            <label>Quantidade<input required type="number" min="1" max="1000000" step="1" value={item.quantidade} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, quantidade: event.target.value } : size))} /></label>
            <button type="button" className="work-order-remove-size" aria-label={`Remover tamanho ${item.tamanho || index + 1}`} disabled={sizes.length === 1} onClick={() => setSizes((current) => current.filter((_, row) => row !== index))}><X size={16} /></button>
          </div>)}
          <div className="work-order-size-total"><span>Quantidade total do lote</span><strong>{sizes.reduce((total, item) => total + (Number(item.quantidade) || 0), 0).toLocaleString('pt-BR')} un.</strong></div>
        </div>
        <label>Observações<textarea rows={3} maxLength={5000} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} placeholder="Detalhes de produção, material ou combinação." /></label>
        <div className="work-order-form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving === 'create'}>{saving === 'create' ? <><RefreshCw size={16} className="spin" /> Salvando…</> : <><Check size={16} /> Criar ordem de serviço</>}</button></div>
      </form>
    </SectionCard>}

    <SectionCard title="Ordens e lotes" caption="Acompanhe status, quantidades, pagamento e documentação fiscal por ordem.">
      <div className="work-orders-toolbar">
        <label className="work-orders-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por ordem, cliente ou produto" /></label>
        <label className="work-orders-filter"><span>Exibir</span><select value={filter} onChange={(event) => setFilter(event.target.value as FilterKey)}>{Object.entries(filterLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      {loading ? <LoadingState /> : filteredOrders.length === 0 ? <EmptyState title={orders.length ? 'Nenhuma ordem corresponde aos filtros' : 'Nenhuma ordem cadastrada'} description={orders.length ? 'Ajuste a busca ou o filtro para visualizar outros lotes.' : 'Cadastre o primeiro lote para iniciar o acompanhamento operacional.'} /> : <div className="work-orders-list">
        {filteredOrders.map((order) => {
          const progress = orderProgress(order)
          const alert = orderAlertText(order)
          const draft = progressDrafts[order.id] || []
          return <article className={`work-order-card ${isOverdue(order) ? 'is-overdue' : ''}`} key={order.id}>
            <header className="work-order-card-header">
              <div className="work-order-title-block"><div className="work-order-identity"><span className="work-order-number">{order.numero}</span><StatusPill value={orderStatusLabels[order.status] || order.status.replaceAll('_', ' ')} /></div><h3>{order.cliente || 'Cliente não informado'}</h3><p>{order.descricao}</p></div>
              <div className="work-order-value"><small>Valor do lote</small><strong>{formatMoney(order.valor_total)}</strong><span className={`work-order-deadline ${isOverdue(order) ? 'is-late' : ''}`}>{alert && <AlertTriangle size={13} />}{order.prazo ? `Prazo ${formatDate(order.prazo)}${alert ? ` · ${alert}` : ''}` : 'Sem prazo informado'}</span></div>
            </header>
            <div className="work-order-progress-summary">
              <div><span>Solicitadas</span><strong>{progress.total.toLocaleString('pt-BR')}</strong></div><div><span>Produzidas</span><strong>{progress.produced.toLocaleString('pt-BR')}</strong></div><div><span>Costuradas</span><strong>{progress.sewn.toLocaleString('pt-BR')}</strong></div><div><span>Entregues</span><strong>{progress.delivered.toLocaleString('pt-BR')}</strong></div>
            </div>
            <div className="work-order-management-grid">
              <label className="work-order-control"><span>Etapa operacional</span><select value={order.status} disabled={saving === `status-${order.id}`} onChange={(event) => void runAction(`status-${order.id}`, () => updateWorkOrderStatus(token, order.id, event.target.value), `Status da ordem ${order.numero} atualizado.`)}>{orderStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="work-order-control"><span>Pagamento</span><select value={order.status_pagamento} disabled={saving === `pay-${order.id}`} onChange={(event) => void runAction(`pay-${order.id}`, () => updateWorkOrderFinance(token, order.id, event.target.value as 'pendente' | 'pago', order.nota_fiscal_numero || ''), `Pagamento da ordem ${order.numero} atualizado.`)}><option value="pendente">Aguardando pagamento</option><option value="pago">Pago</option></select><small>{order.pago_em ? `Baixado em ${formatDate(order.pago_em)}` : 'A baixa é registrada na data da alteração.'}</small></label>
              <div className="work-order-control work-order-invoice-control"><span>Nota fiscal {order.nota_fiscal_emitida_em ? <em className="work-order-issued">Emitida em {formatDate(order.nota_fiscal_emitida_em)}</em> : <em className="work-order-missing">Pendente</em>}</span><div className="work-order-invoice-input"><input maxLength={40} value={invoiceDrafts[order.id] || ''} onChange={(event) => setInvoiceDrafts((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="Número da NF" /><button className="secondary-button" disabled={saving === `nf-${order.id}`} onClick={() => void runAction(`nf-${order.id}`, () => updateWorkOrderFinance(token, order.id, order.status_pagamento, invoiceDrafts[order.id] || ''), invoiceDrafts[order.id]?.trim() ? `Nota fiscal da ordem ${order.numero} registrada.` : `Nota fiscal removida da ordem ${order.numero}.`)}><FileCheck2 size={15} /> Salvar NF</button></div></div>
            </div>
            <details className="work-order-details">
              <summary><span><Scissors size={16} /> Grade e acompanhamento por tamanho</span><span className="work-order-details-summary">{order.tamanhos?.length || 0} tamanho(s) <ChevronDown size={15} /></span></summary>
              {(order.tamanhos || []).length === 0 ? <p className="work-order-no-sizes">Esta ordem antiga ainda não possui grade cadastrada.</p> : <>
                <div className="work-order-size-table"><div className="work-order-size-table-head"><span>Tamanho</span><span>Solicitadas</span><span>Produzidas</span><span>Costuradas</span><span>Entregues</span></div>
                  {(order.tamanhos || []).map((size: OrderSizeRow, index) => <div className="work-order-size-table-row" key={size.id}><strong>{size.tamanho}</strong><span>{size.quantidade.toLocaleString('pt-BR')}</span>
                    {(['quantidade_produzida', 'quantidade_costurada', 'quantidade_entregue'] as const).map((field) => <input key={field} aria-label={`${field === 'quantidade_produzida' ? 'Produzidas' : field === 'quantidade_costurada' ? 'Costuradas' : 'Entregues'} · ${size.tamanho}`} type="number" min="0" max={size.quantidade} step="1" value={draft[index]?.[field] ?? 0} onChange={(event) => changeProgress(order.id, index, field, Number(event.target.value))} />)}
                  </div>)}
                </div>
                <div className="work-order-progress-actions"><small>Validação: entregue ≤ costurada ≤ produzida ≤ solicitada.</small><button className="secondary-button" disabled={saving === `progress-${order.id}`} onClick={() => void saveProgress(order)}>{saving === `progress-${order.id}` ? <><RefreshCw size={14} className="spin" /> Salvando…</> : <><Check size={15} /> Salvar progresso</>}</button></div>
              </>}
            </details>
            <details className="work-order-history"><summary><span><Clock3 size={15} /> Histórico de auditoria</span><span>{order.historico?.length || 0} registro(s)</span></summary>{order.historico?.length ? <ol>{order.historico.map((event, index) => <li key={`${event.created_at}-${index}`}><span className="work-order-history-dot" /><div><strong>{auditLabels[event.evento] || event.evento.replaceAll('_', ' ')}</strong><small>{formatDate(event.created_at)} · {event.responsavel || 'Administrador'}</small></div></li>)}</ol> : <p>Nenhuma alteração registrada até o momento.</p>}</details>
          </article>
        })}
      </div>}
      {!loading && orders.length > 0 && <div className="work-orders-list-foot">Exibindo {filteredOrders.length} de {orders.length} ordens. Indicadores calculados sobre o conjunto completo da empresa.</div>}
    </SectionCard>
  </div>
}
