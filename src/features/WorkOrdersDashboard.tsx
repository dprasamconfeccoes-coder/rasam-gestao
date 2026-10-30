import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ChevronDown, CircleDollarSign, ClipboardList, Clock3, Download, FileCheck2, FileText, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { createWorkOrder, getWorkOrderDashboard, getWorkOrderDocumentUrl, updateWorkOrderFinance, uploadWorkOrderDocument } from '../lib/api'
import type { OrderDocumentRow, OrderRow, WorkOrderSummary } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import './work-orders.css'

type FilterKey = 'todas' | 'recebida' | 'em_producao' | 'costurada' | 'expedida' | 'entregue' | 'vencida' | 'vence_7_dias' | 'pagamento_pendente' | 'pago' | 'sem_nf'
type SizeDraft = { tamanho: string; quantidade: string }

const orderStatusLabels: Record<string, string> = {
  recebida: 'Aguardando início', em_producao: 'Em produção', costurada: 'Costurada',
  expedida: 'Entrega parcial', entregue: 'Entregue', cancelada: 'Cancelada',
}
const filterLabels: Record<FilterKey, string> = {
  todas: 'Todas as ordens', recebida: 'Aguardando início', em_producao: 'Em produção',
  costurada: 'Costuradas', expedida: 'Entrega parcial', entregue: 'Entregues',
  vencida: 'Com prazo vencido', vence_7_dias: 'Vencem em até 7 dias',
  pagamento_pendente: 'Aguardando pagamento', pago: 'Pagas', sem_nf: 'Sem nota fiscal',
}
const auditLabels: Record<string, string> = {
  ordem_criada: 'Ordem criada', status_alterado: 'Etapa operacional atualizada',
  financeiro_nf_atualizado: 'Pagamento ou nota fiscal atualizados',
  progresso_atualizado: 'Progresso por tamanho atualizado',
  financeiro_liberado: 'Lote liberado para financeiro', documento_adicionado: 'Documento anexado',
}
const emptySummary: WorkOrderSummary = {
  total_ordens: 0, ordens_ativas: 0, recebidas: 0, em_producao: 0, costuradas: 0, expedidas: 0, entregues: 0,
  pagas: 0, aguardando_pagamento: 0, notas_fiscais_emitidas: 0, sem_nota_fiscal: 0, vencidas: 0, vencem_em_7_dias: 0,
  valor_ordens_ativas: 0, valor_aguardando_pagamento: 0, valor_pago: 0, unidades_total: 0,
  unidades_produzidas: 0, unidades_costuradas: 0, aguardando_costura: 0, unidades_entregues: 0,
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
  return (order.tamanhos || []).reduce((acc, item) => ({
    total: acc.total + Number(item.quantidade || 0),
    produced: acc.produced + Number(item.quantidade_produzida || 0),
    sewn: acc.sewn + Number(item.quantidade_costurada || 0),
    delivered: acc.delivered + Number(item.quantidade_entregue || 0),
  }), { total: 0, produced: 0, sewn: 0, delivered: 0 })
}
function isFinanceReady(order: OrderRow) {
  return Boolean(order.financeiro_liberado_em)
}
function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function WorkOrdersDashboard({ token, onGoToProduction }: { token: string; onGoToProduction?: () => void }) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [summary, setSummary] = useState<WorkOrderSummary>(emptySummary)
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

  const reload = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    setError('')
    try {
      const result = await getWorkOrderDashboard(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível consultar as ordens de serviço.')
      const rows = result.ordens || []
      setOrders(rows)
      setSummary({ ...emptySummary, ...(result.resumo || {}) })
      setInvoiceDrafts(Object.fromEntries(rows.map((order) => [order.id, order.nota_fiscal_numero || ''])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o painel de ordens.')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [token])
  useEffect(() => { void reload(true) }, [reload])

  const readyOrders = useMemo(() => orders.filter((order) => isFinanceReady(order) && order.status !== 'cancelada'), [orders])
  const pendingPayment = useMemo(() => readyOrders.filter((order) => order.status_pagamento === 'pendente'), [readyOrders])
  const paidOrders = useMemo(() => orders.filter((order) => order.status_pagamento === 'pago' && order.status !== 'cancelada'), [orders])
  const pendingValue = pendingPayment.reduce((sum, order) => sum + Number(order.valor_total || 0), 0)
  const paidValue = paidOrders.reduce((sum, order) => sum + Number(order.valor_total || 0), 0)
  const invoiceCount = orders.reduce((sum, order) => sum + (order.documentos || []).filter((doc) => doc.tipo === 'nota_fiscal').length, 0)
  const docsCount = orders.reduce((sum, order) => sum + (order.documentos || []).length, 0)
  const ordersWithoutInvoice = readyOrders.filter((order) => !(order.documentos || []).some((doc) => doc.tipo === 'nota_fiscal')).length

  const filteredOrders = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR')
    return orders.filter((order) => {
      const matchesText = !term || [order.numero, order.cliente, order.descricao].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term))
      const matchesFilter = filter === 'todas'
        || order.status === filter
        || (filter === 'vencida' && isOverdue(order))
        || (filter === 'vence_7_dias' && isDueWithin7Days(order))
        || (filter === 'pagamento_pendente' && isFinanceReady(order) && order.status_pagamento === 'pendente')
        || (filter === 'pago' && order.status_pagamento === 'pago')
        || (filter === 'sem_nf' && isFinanceReady(order) && !(order.documentos || []).some((doc) => doc.tipo === 'nota_fiscal'))
      return matchesText && matchesFilter
    })
  }, [orders, query, filter])

  async function runAction(key: string, action: () => Promise<{ sucesso: boolean; erro?: string }>, success: string) {
    setSaving(key); setError(''); setNotice('')
    try {
      const result = await action()
      if (!result.sucesso) throw new Error(result.erro || 'A alteração não foi concluída.')
      setNotice(success)
      await reload(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar alteração.')
    } finally { setSaving('') }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('')
    const normalized = sizes.map((item) => ({ tamanho: item.tamanho.trim().toUpperCase(), quantidade: Number(item.quantidade) }))
    const labels = normalized.map((item) => item.tamanho)
    if (normalized.some((item) => !item.tamanho || !Number.isInteger(item.quantidade) || item.quantidade < 1)) {
      setError('Informe um tamanho e uma quantidade inteira maior que zero em cada linha.'); return
    }
    if (new Set(labels).size !== labels.length) { setError('Cada tamanho deve aparecer apenas uma vez na grade.'); return }
    if (!form.valor || !Number.isFinite(Number(form.valor)) || Number(form.valor) <= 0) { setError('Informe o valor total do lote.'); return }
    setSaving('create')
    try {
      const result = await createWorkOrder(token, {
        clienteNome: form.cliente.trim(), descricao: form.descricao.trim(), prioridade: form.prioridade,
        prazo: form.prazo, valorTotal: Number(form.valor), observacoes: form.observacoes.trim(), tamanhos: normalized,
      })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível cadastrar a ordem.')
      setNotice(`Ordem ${result.numero || ''} criada com ${result.quantidade || normalized.reduce((total, item) => total + item.quantidade, 0)} unidades.`)
      setForm({ cliente: '', descricao: '', prioridade: 'normal', prazo: '', valor: '', observacoes: '' })
      setSizes([{ tamanho: 'M', quantidade: '1' }]); setShowForm(false)
      await reload(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao cadastrar ordem.') }
    finally { setSaving('') }
  }

  async function attachDocument(order: OrderRow, type: OrderDocumentRow['tipo'], file: File) {
    setSaving(`doc-${order.id}`); setError(''); setNotice('')
    try {
      await uploadWorkOrderDocument(token, order.id, type, file)
      setNotice(`${type === 'nota_fiscal' ? 'Nota fiscal' : 'Comprovante'} anexado à ordem ${order.numero}.`)
      await reload(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível anexar o arquivo.') }
    finally { setSaving('') }
  }

  async function openDocument(document: OrderDocumentRow) {
    setSaving(`open-${document.id}`); setError('')
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null
    try {
      const result = await getWorkOrderDocumentUrl(token, document.id, true)
      if (popup) popup.location.href = result.url || ''
      else window.location.href = result.url || ''
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o documento.')
    } finally { setSaving('') }
  }

  return <div className="work-orders-page">
    <PageHeading eyebrow="Gestão · ordens e financeiro" title="Ordens de serviço" description="Cadastre e consulte lotes. O acompanhamento de produção fica no painel fabril; aqui você registra pagamento, nota fiscal e comprovantes." action={<div className="work-orders-heading-actions"><button className="secondary-button" onClick={() => void reload(true)} disabled={loading || Boolean(saving)}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>{onGoToProduction && <button className="secondary-button" onClick={onGoToProduction}><ArrowRight size={16} /> Produção</button>}<button className="primary-button" onClick={() => { setShowForm((value) => !value); setError('') }}><Plus size={17} /> {showForm ? 'Fechar cadastro' : 'Nova ordem'}</button></div>} />
    {notice && <div className="work-orders-notice" role="status"><Check size={16} />{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {error && <div className="work-orders-error"><ErrorState message={error} /><button className="text-button" onClick={() => setError('')}>Fechar</button></div>}

    {summary.vencidas > 0 || summary.vencem_em_7_dias > 0 || pendingPayment.length > 0 || ordersWithoutInvoice > 0 ? <section className="work-orders-alerts" aria-label="Alertas de ordens e financeiro">
      {summary.vencidas > 0 && <button className="work-orders-alert is-danger" onClick={() => setFilter('vencida')}><Clock3 size={18} /><span><strong>{summary.vencidas} ordem(ns) com prazo vencido</strong><small>Consulte o andamento no módulo Produção.</small></span><ChevronDown size={16} /></button>}
      {summary.vencem_em_7_dias > 0 && <button className="work-orders-alert is-warning" onClick={() => setFilter('vence_7_dias')}><Clock3 size={18} /><span><strong>{summary.vencem_em_7_dias} vencem nos próximos 7 dias</strong><small>Confira capacidade e andamento.</small></span><ChevronDown size={16} /></button>}
      {pendingPayment.length > 0 && <button className="work-orders-alert is-neutral" onClick={() => setFilter('pagamento_pendente')}><CircleDollarSign size={18} /><span><strong>{pendingPayment.length} aguardando pagamento</strong><small>{formatMoney(pendingValue)} em lotes liberados pela Produção.</small></span><ChevronDown size={16} /></button>}
      {ordersWithoutInvoice > 0 && <button className="work-orders-alert is-neutral" onClick={() => setFilter('sem_nf')}><FileText size={18} /><span><strong>{ordersWithoutInvoice} ordem(ns) sem NF anexada</strong><small>Anexe o arquivo depois que a Produção liberar o lote.</small></span><ChevronDown size={16} /></button>}
    </section> : null}

    <section className="work-orders-metrics financial-metrics" aria-label="Indicadores financeiros das ordens">
      <article className="work-orders-metric metric-orders"><div className="work-orders-metric-icon"><ClipboardList size={19} /></div><span>Ordens cadastradas</span><strong>{orders.length}</strong><small>{summary.ordens_ativas} em andamento · {summary.entregues} entregues</small></article>
      <article className="work-orders-metric metric-payment"><div className="work-orders-metric-icon"><CircleDollarSign size={19} /></div><span>Aguardando pagamento</span><strong>{formatMoney(pendingValue)}</strong><small>{pendingPayment.length} lote(s) liberados para financeiro</small></article>
      <article className="work-orders-metric metric-delivered"><div className="work-orders-metric-icon"><Check size={19} /></div><span>Pagamentos registrados</span><strong>{formatMoney(paidValue)}</strong><small>{paidOrders.length} ordem(ns) baixadas</small></article>
      <article className="work-orders-metric metric-invoice"><div className="work-orders-metric-icon"><FileCheck2 size={19} /></div><span>Notas fiscais anexadas</span><strong>{invoiceCount}</strong><small>{docsCount} documento(s) privado(s) registrados</small></article>
    </section>

    <div className="work-orders-finance-note finance-separation-note"><FileText size={15} /> Pagamento só fica disponível depois de a Produção concluir a entrega e liberar o lote para o financeiro.</div>

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
        <div className="work-order-size-editor"><div className="work-order-size-head"><div><strong>Grade de tamanhos</strong><small>Informe quantidades diferentes para cada tamanho.</small></div><button type="button" className="secondary-button" onClick={() => setSizes((current) => [...current, { tamanho: '', quantidade: '1' }])}><Plus size={15} /> Adicionar tamanho</button></div>
          {sizes.map((item, index) => <div className="work-order-size-row" key={index}><label>Tamanho<input required maxLength={24} value={item.tamanho} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, tamanho: event.target.value } : size))} placeholder="Ex.: P, M, 40" /></label><label>Quantidade<input required type="number" min="1" max="1000000" step="1" value={item.quantidade} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, quantidade: event.target.value } : size))} /></label><button type="button" className="work-order-remove-size" aria-label={`Remover tamanho ${item.tamanho || index + 1}`} disabled={sizes.length === 1} onClick={() => setSizes((current) => current.filter((_, row) => row !== index))}><X size={16} /></button></div>)}
          <div className="work-order-size-total"><span>Quantidade total do lote</span><strong>{sizes.reduce((total, item) => total + (Number(item.quantidade) || 0), 0).toLocaleString('pt-BR')} un.</strong></div>
        </div>
        <label>Observações<textarea rows={3} maxLength={5000} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} placeholder="Detalhes de produção, material ou combinação." /></label>
        <div className="work-order-form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving === 'create'}>{saving === 'create' ? <><RefreshCw size={16} className="spin" /> Salvando…</> : <><Check size={16} /> Criar ordem de serviço</>}</button></div>
      </form>
    </SectionCard>}

    <SectionCard title="Ordens e lotes" caption="Consulta comercial e financeira; quantidades operacionais são somente leitura nesta tela.">
      <div className="work-orders-toolbar"><label className="work-orders-search"><Search size={17} /><input aria-label="Buscar ordens por número, cliente ou produto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por ordem, cliente ou produto" /></label><label className="work-orders-filter"><span>Exibir</span><select value={filter} onChange={(event) => setFilter(event.target.value as FilterKey)}>{Object.entries(filterLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {loading ? <LoadingState /> : filteredOrders.length === 0 ? <EmptyState title={orders.length ? 'Nenhuma ordem corresponde aos filtros' : 'Nenhuma ordem cadastrada'} description={orders.length ? 'Ajuste a busca ou o filtro para visualizar outros lotes.' : 'Cadastre o primeiro lote para iniciar o acompanhamento.'} /> : <div className="work-orders-list">
        {filteredOrders.map((order) => {
          const progress = orderProgress(order)
          const ready = isFinanceReady(order)
          const documents = order.documentos || []
          const financialSaving = saving.startsWith('pay-') || saving.startsWith('nf-')
          return <article className={`work-order-card ${isOverdue(order) ? 'is-overdue' : ''}`} key={order.id}>
            <header className="work-order-card-header"><div className="work-order-title-block"><div className="work-order-identity"><span className="work-order-number">{order.numero}</span><StatusPill value={orderStatusLabels[order.status] || order.status.replaceAll('_', ' ')} />{order.status !== 'cancelada' && <StatusPill value={order.status_pagamento === 'pago' ? 'Pago' : ready ? 'Aguardando pagamento' : order.status === 'entregue' ? 'Aguardando liberação' : 'Sem baixa financeira'} />}</div><h3>{order.cliente || 'Cliente não informado'}</h3><p>{order.descricao}{order.prioridade ? ` · prioridade ${order.prioridade}` : ''}</p></div><div className="work-order-value"><small>Valor do lote</small><strong>{formatMoney(Number(order.valor_total || 0))}</strong><span className={`work-order-deadline ${isOverdue(order) ? 'is-late' : ''}`}>{order.prazo ? `Prazo ${formatDate(order.prazo)}` : 'Sem prazo'}</span></div></header>
            <div className="work-order-progress-summary"><div><span>Solicitadas</span><strong>{progress.total.toLocaleString('pt-BR')}</strong></div><div><span>Produzidas</span><strong>{progress.produced.toLocaleString('pt-BR')}</strong></div><div><span>Costuradas</span><strong>{progress.sewn.toLocaleString('pt-BR')}</strong></div><div><span>Entregues</span><strong>{progress.delivered.toLocaleString('pt-BR')}</strong></div></div>
            <div className="work-order-financial-grid">
              <label className="work-order-control"><span>Pagamento</span><select value={order.status_pagamento} disabled={financialSaving || !ready} onChange={(event) => void runAction(`pay-${order.id}`, () => updateWorkOrderFinance(token, order.id, event.target.value as 'pendente' | 'pago', order.nota_fiscal_numero || ''), `Pagamento da ordem ${order.numero} atualizado.`)}><option value="pendente">Aguardando pagamento</option><option value="pago">Pago</option></select><small>{order.pago_em ? `Baixado em ${formatDate(order.pago_em)}` : ready ? 'A baixa é registrada na data da alteração.' : 'Aguarde a liberação da Produção.'}</small></label>
              <div className="work-order-control work-order-invoice-control"><span>Nota fiscal {order.nota_fiscal_emitida_em ? <em className="work-order-issued">Emitida em {formatDate(order.nota_fiscal_emitida_em)}</em> : <em className="work-order-missing">Pendente</em>}</span><div className="work-order-invoice-input"><input aria-label={`Número da nota fiscal da ordem ${order.numero}`} maxLength={40} value={invoiceDrafts[order.id] || ''} disabled={!ready || financialSaving} onChange={(event) => setInvoiceDrafts((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="Número da NF" /><button className="secondary-button" disabled={!ready || financialSaving} onClick={() => void runAction(`nf-${order.id}`, () => updateWorkOrderFinance(token, order.id, order.status_pagamento, invoiceDrafts[order.id] || ''), invoiceDrafts[order.id]?.trim() ? `Nota fiscal da ordem ${order.numero} registrada.` : `Número da NF removido da ordem ${order.numero}.`)}><FileCheck2 size={14} /> Salvar NF</button></div></div>
            </div>
            {onGoToProduction && !['entregue', 'cancelada'].includes(order.status) && <button className="work-order-production-link" onClick={onGoToProduction}><ArrowRight size={14} /> Gerenciar andamento no painel Produção</button>}
            <details className="work-order-details"><summary><span><ClipboardList size={15} /> Grade e progresso do lote</span><span className="work-order-details-summary">{order.tamanhos?.length || 0} tamanho(s) <ChevronDown size={14} /></span></summary>{(order.tamanhos || []).length === 0 ? <p className="work-order-no-sizes">Esta ordem antiga ainda não possui grade cadastrada.</p> : <div className="work-order-size-table"><div className="work-order-size-table-head"><span>Tamanho</span><span>Solicitadas</span><span>Produzidas</span><span>Costuradas</span><span>Entregues</span></div>{order.tamanhos.map((size) => <div className="work-order-size-table-row read-only" key={size.id}><strong>{size.tamanho}</strong><span>{size.quantidade.toLocaleString('pt-BR')}</span><span>{size.quantidade_produzida.toLocaleString('pt-BR')}</span><span>{size.quantidade_costurada.toLocaleString('pt-BR')}</span><span>{size.quantidade_entregue.toLocaleString('pt-BR')}</span></div>)}</div>}</details>
            <details className="work-order-documents"><summary><span><FileText size={15} /> Notas fiscais e comprovantes</span><span className="work-order-details-summary">{documents.length} arquivo(s) <ChevronDown size={14} /></span></summary>
              {!ready && <p className="work-order-documents-note">Os documentos ficam disponíveis após a Produção concluir a entrega e liberar o lote.</p>}
              {ready && <div className="work-order-document-actions"><label className="work-order-upload"><Upload size={14} /><span>Anexar nota fiscal</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" disabled={saving === `doc-${order.id}`} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void attachDocument(order, 'nota_fiscal', file) }} /></label><label className="work-order-upload"><Upload size={14} /><span>Anexar comprovante de pagamento</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" disabled={saving === `doc-${order.id}`} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void attachDocument(order, 'comprovante_pagamento', file) }} /></label><small>PDF, JPG, PNG ou WebP · até 10 MB · armazenamento privado</small></div>}
              {documents.length > 0 && <div className="work-order-document-list">{documents.map((document) => <button className="work-order-document-row" key={document.id} disabled={saving === `open-${document.id}`} onClick={() => void openDocument(document)}><span className="document-icon"><FileText size={16} /></span><span><strong>{document.nome_arquivo}</strong><small>{document.tipo === 'nota_fiscal' ? 'Nota fiscal' : 'Comprovante de pagamento'} · {fileSize(Number(document.tamanho_bytes || 0))} · {formatDate(document.created_at)}</small></span>{saving === `open-${document.id}` ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}</button>)}</div>}
            </details>
            <details className="work-order-history"><summary><span><Clock3 size={15} /> Histórico de auditoria</span><span>{order.historico?.length || 0} registro(s)</span></summary>{order.historico?.length ? <ol>{order.historico.map((event, index) => <li key={`${event.created_at}-${index}`}><span className="work-order-history-dot" /><div><strong>{auditLabels[event.evento] || event.evento.replaceAll('_', ' ')}</strong><small>{formatDate(event.created_at)}{event.responsavel ? ` · ${event.responsavel}` : ''}</small></div></li>)}</ol> : <p>Nenhuma alteração registrada até o momento.</p>}</details>
          </article>
        })}
      </div>}
      {!loading && orders.length > 0 && <div className="work-orders-list-foot">Exibindo {filteredOrders.length} de {orders.length} ordens. Os anexos são acessados por links temporários e privados.</div>}
    </SectionCard>
  </div>
}
