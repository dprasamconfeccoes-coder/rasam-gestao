import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ChevronDown, CircleDollarSign, ClipboardList, Clock3, Download, FileCheck2, FileText, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { createOrderClient, createWorkOrder, getWorkOrderDashboard, getWorkOrderDocumentUrl, searchOrderClients, updateWorkOrderFinance, uploadWorkOrderDocument } from '../lib/api'
import type { CreateWorkOrderPayload, OrderDocumentRow, OrderRow, WorkOrderSummary } from '../lib/types'
import { ConfirmationModal, EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import './work-orders.css'

type FilterKey = 'todas' | 'recebida' | 'em_producao' | 'costurada' | 'expedida' | 'entregue' | 'vencida' | 'vence_7_dias' | 'pagamento_pendente' | 'pago' | 'sem_nf'
type SizeDraft = { tamanho: string; quantidade: string; valor_unitario: string }
type ClientChoice = { id: string; nome: string }
type WorkOrderConfirmation =
  | { kind: 'client'; name: string }
  | { kind: 'order'; payload: CreateWorkOrderPayload }
  | { kind: 'finance'; order: OrderRow; statusPagamento: 'pendente' | 'pago'; notaFiscalNumero: string; success: string }
  | { kind: 'document'; order: OrderRow; type: OrderDocumentRow['tipo']; file: File }

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
const MAX_ORDER_TOTAL = 999999999999.99

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
function parseUnitPrice(value: string) {
  const normalized = value.trim().replace(',', '.')
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? Number(normalized) : Number.NaN
}
function moneyRound(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100 }

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
  const [selectedClient, setSelectedClient] = useState<ClientChoice | null>(null)
  const [clientMatches, setClientMatches] = useState<ClientChoice[]>([])
  const [clientSearchLoading, setClientSearchLoading] = useState(false)
  const [clientSearchError, setClientSearchError] = useState('')
  const [formError, setFormError] = useState('')
  const [confirmation, setConfirmation] = useState<WorkOrderConfirmation | null>(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const formAnchorRef = useRef<HTMLDivElement>(null)
  const formErrorRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({ cliente: '', descricao: '', prioridade: 'normal', prazo: '', observacoes: '' })
  const [sizes, setSizes] = useState<SizeDraft[]>([{ tamanho: 'M', quantidade: '1', valor_unitario: '' }])

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
  useEffect(() => {
    if (!showForm) return
    let focusFrame = 0
    const frame = requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      focusFrame = requestAnimationFrame(() => document.getElementById('work-order-client-search')?.focus({ preventScroll: true }))
    })
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame) }
  }, [showForm])
  useEffect(() => { if (formError) formErrorRef.current?.focus() }, [formError])
  useEffect(() => {
    const search = form.cliente.trim()
    if (!showForm || search.length < 2 || selectedClient?.nome === search) {
      setClientMatches([]); setClientSearchLoading(false); setClientSearchError('')
      return
    }
    let cancelled = false
    setClientMatches([]); setClientSearchError(''); setClientSearchLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchOrderClients(token, search.slice(0, 120))
        if (!result.sucesso) throw new Error(result.erro || 'Não foi possível pesquisar clientes.')
        if (!cancelled) setClientMatches(result.clientes || [])
      } catch (err) {
        if (!cancelled) setClientSearchError(err instanceof Error ? err.message : 'Falha ao pesquisar clientes.')
      } finally {
        if (!cancelled) setClientSearchLoading(false)
      }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [token, form.cliente, selectedClient, showForm])

  const sizeCalculations = sizes.map((item) => {
    const quantity = Number(item.quantidade) || 0
    const unitPrice = parseUnitPrice(item.valor_unitario)
    const subtotal = Number.isFinite(unitPrice) ? moneyRound(quantity * unitPrice) : 0
    return { quantity, unitPrice, subtotal }
  })
  const orderQuantity = sizeCalculations.reduce((sum, item) => sum + item.quantity, 0)
  const orderTotal = moneyRound(sizeCalculations.reduce((sum, item) => sum + item.subtotal, 0))

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

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFormError(''); setNotice('')
    const rejectForm = (message: string) => { setError(message); setFormError(message) }
    if (!selectedClient || selectedClient.nome !== form.cliente.trim()) { rejectForm('Pesquise e selecione um cliente da lista ou cadastre o nome antes de continuar.'); return }
    if (!form.descricao.trim()) { rejectForm('Informe o produto ou a descrição do lote.'); return }
    if (form.descricao.trim().length > 500) { rejectForm('A descrição deve ter até 500 caracteres.'); return }
    if (!form.prazo) { rejectForm('Informe o prazo previsto para entrega.'); return }
    if (form.observacoes.length > 5000) { rejectForm('As observações devem ter até 5.000 caracteres.'); return }
    const normalized = sizes.map((item) => ({ tamanho: item.tamanho.trim().toUpperCase(), quantidade: Number(item.quantidade), unitPrice: parseUnitPrice(item.valor_unitario) }))
    const labels = normalized.map((item) => item.tamanho)
    if (normalized.some((item) => !item.tamanho || !Number.isInteger(item.quantidade) || item.quantidade < 1)) {
      rejectForm('Informe um tamanho e uma quantidade inteira maior que zero em cada linha.'); return
    }
    if (new Set(labels).size !== labels.length) { rejectForm('Cada tamanho deve aparecer apenas uma vez na grade.'); return }
    if (normalized.reduce((sum, item) => sum + item.quantidade, 0) > 1000000) { rejectForm('A quantidade total do lote não pode exceder 1.000.000 de peças.'); return }
    if (normalized.some((item) => !Number.isFinite(item.unitPrice) || item.unitPrice <= 0 || item.unitPrice > 9999999999.99)) { rejectForm('Informe um valor por peça válido, maior que zero e dentro do limite permitido.'); return }
    if (!Number.isFinite(orderTotal) || orderTotal > MAX_ORDER_TOTAL) { rejectForm('O valor total calculado excede o limite de R$ 999.999.999.999,99 do sistema.'); return }
    const payload: CreateWorkOrderPayload = {
      clienteId: selectedClient.id,
      clienteNome: selectedClient.nome,
      descricao: form.descricao.trim(),
      prioridade: form.prioridade,
      prazo: form.prazo,
      observacoes: form.observacoes.trim(),
      tamanhos: normalized.map(({ tamanho, quantidade, unitPrice }) => ({ tamanho, quantidade, valor_unitario: Number(unitPrice.toFixed(2)) })),
    }
    setConfirmation({ kind: 'order', payload })
  }

  async function confirmPendingAction() {
    if (!confirmation) return
    setConfirmationBusy(true); setSaving('confirmation'); setError(''); setNotice('')
    try {
      if (confirmation.kind === 'client') {
        const result = await createOrderClient(token, confirmation.name)
        if (!result.sucesso || !result.id || !result.nome) throw new Error(result.erro || 'Não foi possível cadastrar o cliente.')
        setSelectedClient({ id: result.id, nome: result.nome })
        setForm((current) => ({ ...current, cliente: result.nome || confirmation.name }))
        setNotice(result.existente ? `O cliente ${result.nome} já existia e foi selecionado.` : `Cliente ${result.nome} cadastrado e selecionado.`)
      } else if (confirmation.kind === 'order') {
        const result = await createWorkOrder(token, confirmation.payload)
        if (!result.sucesso) throw new Error(result.erro || 'Não foi possível cadastrar a ordem.')
        setNotice(`Ordem ${result.numero || ''} criada com ${(result.quantidade || orderQuantity).toLocaleString('pt-BR')} unidades · ${formatMoney(result.valor_total ?? orderTotal)}.`)
        setForm({ cliente: '', descricao: '', prioridade: 'normal', prazo: '', observacoes: '' })
        setSelectedClient(null); setClientMatches([])
        setSizes([{ tamanho: 'M', quantidade: '1', valor_unitario: '' }]); setShowForm(false)
        await reload(false)
      } else if (confirmation.kind === 'finance') {
        const result = await updateWorkOrderFinance(token, confirmation.order.id, confirmation.statusPagamento, confirmation.notaFiscalNumero)
        if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar os dados financeiros.')
        setNotice(confirmation.success)
        await reload(false)
      } else {
        await uploadWorkOrderDocument(token, confirmation.order.id, confirmation.type, confirmation.file)
        setNotice(`${confirmation.type === 'nota_fiscal' ? 'Nota fiscal' : 'Comprovante'} anexado à ordem ${confirmation.order.numero}.`)
        await reload(false)
      }
      setConfirmation(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a alteração.')
    } finally {
      setConfirmationBusy(false); setSaving('')
    }
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

  const confirmationTitle = confirmation?.kind === 'client' ? 'Confirmar cadastro de cliente'
    : confirmation?.kind === 'order' ? 'Confirmar criação do lote'
      : confirmation?.kind === 'finance' ? 'Confirmar atualização financeira'
        : confirmation?.kind === 'document' ? 'Confirmar envio do documento' : ''
  const confirmationDescription = confirmation?.kind === 'client' ? 'O cliente será registrado na lista da empresa usando somente o nome informado.'
    : confirmation?.kind === 'order' ? 'Confira cliente, produto, grade e memória de cálculo. O lote só será criado depois da sua confirmação.'
      : confirmation?.kind === 'finance' ? `A ordem ${confirmation.order.numero} será atualizada no banco e o evento ficará registrado no histórico.`
        : confirmation?.kind === 'document' ? `O arquivo selecionado será enviado ao armazenamento privado e associado à ordem ${confirmation.order.numero}.` : ''
  const confirmationLabel = confirmation?.kind === 'client' ? 'Cadastrar cliente'
    : confirmation?.kind === 'order' ? 'Criar lote'
      : confirmation?.kind === 'finance' ? 'Confirmar alteração'
        : confirmation?.kind === 'document' ? 'Enviar documento' : 'Confirmar'

  return <div className="work-orders-page">
    <PageHeading eyebrow="Gestão · ordens e financeiro" title="Ordens de serviço" description="Cadastre e consulte lotes. O acompanhamento de produção fica no painel fabril; aqui você registra pagamento, nota fiscal e comprovantes." action={<div className="work-orders-heading-actions"><button className="secondary-button" onClick={() => void reload(true)} disabled={loading || Boolean(saving)}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>{onGoToProduction && <button className="secondary-button" onClick={onGoToProduction}><ArrowRight size={16} /> Produção</button>}<button className="primary-button" onClick={() => { setShowForm((value) => !value); setError(''); setFormError('') }}><Plus size={17} /> {showForm ? 'Fechar cadastro' : 'Nova ordem'}</button></div>} />
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

    {showForm && <div ref={formAnchorRef} className="work-order-form-anchor" tabIndex={-1}><SectionCard title="Cadastrar lote de produção" caption="O número da ordem será gerado automaticamente ao salvar.">
      <form className="work-order-form" noValidate onSubmit={submitOrder} onInput={() => { if (formError) { setFormError(''); setError('') } }}>
        {formError && <div ref={formErrorRef} className="work-order-form-error" role="alert" tabIndex={-1}>{formError}</div>}
        <div className="work-order-form-grid">
          <div className="work-order-client-field">
            <label htmlFor="work-order-client-search">Cliente</label>
            <input id="work-order-client-search" required maxLength={180} autoComplete="off" value={form.cliente} onChange={(event) => { setForm((current) => ({ ...current, cliente: event.target.value })); setSelectedClient(null) }} placeholder="Digite para pesquisar clientes" />
            {clientSearchLoading && <small className="work-order-client-hint">Pesquisando clientes…</small>}
            {clientSearchError && <small className="work-order-client-error">{clientSearchError}</small>}
            {selectedClient && <small className="work-order-client-selected"><Check size={13} /> Cliente vinculado: {selectedClient.nome}</small>}
            {!selectedClient && clientMatches.length > 0 && <div className="work-order-client-options" role="group" aria-label="Clientes encontrados">{clientMatches.map((client) => <button type="button" key={client.id} onClick={() => { setSelectedClient(client); setForm((current) => ({ ...current, cliente: client.nome })); setClientMatches([]) }}><span>{client.nome}</span><small>Selecionar cliente</small></button>)}</div>}
            {!selectedClient && form.cliente.trim().length >= 2 && !clientSearchLoading && <div className="work-order-client-create"><span>{clientMatches.length ? 'Não encontrou o cliente desejado?' : 'Nenhum cliente correspondente foi encontrado.'}</span><button type="button" className="text-button" onClick={() => { setError(''); setConfirmation({ kind: 'client', name: form.cliente.trim() }) }}><Plus size={14} /> Cadastrar cliente “{form.cliente.trim()}”</button></div>}
          </div>
          <label>Produto / descrição<input required maxLength={500} value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} placeholder="Ex.: Calça masculina · lote de inverno" /></label>
          <label>Prazo previsto<input required type="date" value={form.prazo} onChange={(event) => setForm({ ...form, prazo: event.target.value })} /></label>
          <label>Prioridade<select value={form.prioridade} onChange={(event) => setForm({ ...form, prioridade: event.target.value })}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
          <div className="work-order-number-hint"><ClipboardList size={17} /><span><strong>Identificação automática</strong><small>Uma numeração única será reservada pelo sistema.</small></span></div>
        </div>
        <div className="work-order-size-editor"><div className="work-order-size-head"><div><strong>Grade de tamanhos e valores</strong><small>Defina a quantidade e o preço por peça para cada tamanho.</small></div><button type="button" className="secondary-button" onClick={() => setSizes((current) => [...current, { tamanho: '', quantidade: '1', valor_unitario: '' }])}><Plus size={15} /> Adicionar tamanho</button></div>
          {sizes.map((item, index) => <div className="work-order-size-row" key={index}><label>Tamanho<input required maxLength={24} value={item.tamanho} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, tamanho: event.target.value } : size))} placeholder="Ex.: P, M, 40" /></label><label>Quantidade (peças)<input required type="number" min="1" max="1000000" step="1" value={item.quantidade} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, quantidade: event.target.value } : size))} /></label><label>Valor por peça<input required type="text" inputMode="decimal" value={item.valor_unitario} onChange={(event) => setSizes((current) => current.map((size, row) => row === index ? { ...size, valor_unitario: event.target.value } : size))} placeholder="0,00" /></label><div className="work-order-size-subtotal"><span>Subtotal</span><strong>{(sizeCalculations[index]?.subtotal || 0) > MAX_ORDER_TOTAL ? 'Acima do limite' : formatMoney(sizeCalculations[index]?.subtotal || 0)}</strong></div><button type="button" className="work-order-remove-size" aria-label={`Remover tamanho ${item.tamanho || index + 1}`} disabled={sizes.length === 1} onClick={() => setSizes((current) => current.filter((_, row) => row !== index))}><X size={16} /></button></div>)}
          <div className="work-order-size-total"><span>Quantidade total do lote</span><strong>{orderQuantity.toLocaleString('pt-BR')} peças</strong></div>
          <div className="work-order-cost-audit"><div className="work-order-cost-audit-heading"><div><strong>Memória de cálculo</strong><small>Quantidade por tamanho × valor por peça</small></div><span>Auditoria do lote</span></div>{sizes.map((item, index) => <div className="work-order-cost-line" key={`${item.tamanho}-${index}`}><span>{item.tamanho.trim() || `Tamanho ${index + 1}`}</span><strong>{sizeCalculations[index].quantity.toLocaleString('pt-BR')} × {formatMoney(Number.isFinite(sizeCalculations[index].unitPrice) ? sizeCalculations[index].unitPrice : 0)}</strong><b>{sizeCalculations[index].subtotal > MAX_ORDER_TOTAL ? 'Acima do limite' : formatMoney(sizeCalculations[index].subtotal)}</b></div>)}<div className="work-order-cost-total"><span>Valor total do lote <small>Soma dos subtotais calculados acima</small></span><strong>{orderTotal > MAX_ORDER_TOTAL ? 'Acima do limite' : formatMoney(orderTotal)}</strong></div></div>
        </div>
        <label>Observações<textarea rows={3} maxLength={5000} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} placeholder="Detalhes de produção, material ou combinação." /></label>
        <div className="work-order-form-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); setFormError(''); setError('') }}>Cancelar</button><button type="submit" className="primary-button" disabled={confirmationBusy}><Check size={16} /> Revisar e criar ordem</button></div>
      </form>
    </SectionCard></div>}

    <SectionCard title="Ordens e lotes" caption="Consulta comercial e financeira; quantidades operacionais são somente leitura nesta tela.">
      <div className="work-orders-toolbar"><label className="work-orders-search"><Search size={17} /><input aria-label="Buscar ordens por número, cliente ou produto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por ordem, cliente ou produto" /></label><label className="work-orders-filter"><span>Exibir</span><select value={filter} onChange={(event) => setFilter(event.target.value as FilterKey)}>{Object.entries(filterLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {loading ? <LoadingState /> : filteredOrders.length === 0 ? <EmptyState title={orders.length ? 'Nenhuma ordem corresponde aos filtros' : 'Nenhuma ordem cadastrada'} description={orders.length ? 'Ajuste a busca ou o filtro para visualizar outros lotes.' : 'Cadastre o primeiro lote para iniciar o acompanhamento.'} /> : <div className="work-orders-list">
        {filteredOrders.map((order) => {
          const progress = orderProgress(order)
          const ready = isFinanceReady(order)
          const documents = order.documentos || []
          const financialSaving = saving === 'confirmation' || confirmationBusy
          return <article className={`work-order-card ${isOverdue(order) ? 'is-overdue' : ''}`} key={order.id}>
            <header className="work-order-card-header"><div className="work-order-title-block"><div className="work-order-identity"><span className="work-order-number">{order.numero}</span><StatusPill value={orderStatusLabels[order.status] || order.status.replaceAll('_', ' ')} />{order.status !== 'cancelada' && <StatusPill value={order.status_pagamento === 'pago' ? 'Pago' : ready ? 'Aguardando pagamento' : order.status === 'entregue' ? 'Aguardando liberação' : 'Sem baixa financeira'} />}</div><h3>{order.cliente || 'Cliente não informado'}</h3><p>{order.descricao}{order.prioridade ? ` · prioridade ${order.prioridade}` : ''}</p></div><div className="work-order-value"><small>Valor do lote</small><strong>{formatMoney(Number(order.valor_total || 0))}</strong><span className={`work-order-deadline ${isOverdue(order) ? 'is-late' : ''}`}>{order.prazo ? `Prazo ${formatDate(order.prazo)}` : 'Sem prazo'}</span></div></header>
            <div className="work-order-progress-summary"><div><span>Solicitadas</span><strong>{progress.total.toLocaleString('pt-BR')}</strong></div><div><span>Produzidas</span><strong>{progress.produced.toLocaleString('pt-BR')}</strong></div><div><span>Costuradas</span><strong>{progress.sewn.toLocaleString('pt-BR')}</strong></div><div><span>Entregues</span><strong>{progress.delivered.toLocaleString('pt-BR')}</strong></div></div>
            <div className="work-order-financial-grid">
              <label className="work-order-control"><span>Pagamento</span><select value={order.status_pagamento} disabled={financialSaving || !ready} onChange={(event) => setConfirmation({ kind: 'finance', order, statusPagamento: event.target.value as 'pendente' | 'pago', notaFiscalNumero: order.nota_fiscal_numero || '', success: `Pagamento da ordem ${order.numero} atualizado.` })}><option value="pendente">Aguardando pagamento</option><option value="pago">Pago</option></select><small>{order.pago_em ? `Baixado em ${formatDate(order.pago_em)}` : ready ? 'A baixa é registrada na data da alteração.' : 'Aguarde a liberação da Produção.'}</small></label>
              <div className="work-order-control work-order-invoice-control"><span>Nota fiscal {order.nota_fiscal_emitida_em ? <em className="work-order-issued">Emitida em {formatDate(order.nota_fiscal_emitida_em)}</em> : <em className="work-order-missing">Pendente</em>}</span><div className="work-order-invoice-input"><input aria-label={`Número da nota fiscal da ordem ${order.numero}`} maxLength={40} value={invoiceDrafts[order.id] || ''} disabled={!ready || financialSaving} onChange={(event) => setInvoiceDrafts((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="Número da NF" /><button type="button" className="secondary-button" disabled={!ready || financialSaving} onClick={() => setConfirmation({ kind: 'finance', order, statusPagamento: order.status_pagamento, notaFiscalNumero: invoiceDrafts[order.id] || '', success: invoiceDrafts[order.id]?.trim() ? `Nota fiscal da ordem ${order.numero} registrada.` : `Número da NF removido da ordem ${order.numero}.` })}><FileCheck2 size={14} /> Salvar NF</button></div></div>
            </div>
            {onGoToProduction && !['entregue', 'cancelada'].includes(order.status) && <button className="work-order-production-link" onClick={onGoToProduction}><ArrowRight size={14} /> Gerenciar andamento no painel Produção</button>}
            <details className="work-order-details"><summary><span><ClipboardList size={15} /> Grade, valores e progresso do lote</span><span className="work-order-details-summary">{order.tamanhos?.length || 0} tamanho(s) <ChevronDown size={14} /></span></summary>{(order.tamanhos || []).length === 0 ? <p className="work-order-no-sizes">Esta ordem antiga ainda não possui grade cadastrada.</p> : <div className="work-order-size-table"><div className="work-order-size-table-head"><span>Tamanho</span><span>Solicitadas</span><span>Valor/peça</span><span>Subtotal</span><span>Produzidas</span><span>Costuradas</span><span>Entregues</span></div>{order.tamanhos.map((size) => <div className="work-order-size-table-row read-only" key={size.id}><strong>{size.tamanho}</strong><span>{size.quantidade.toLocaleString('pt-BR')}</span><span>{Number(size.valor_unitario || 0) > 0 ? formatMoney(Number(size.valor_unitario)) : '—'}</span><span>{Number(size.valor_unitario || 0) > 0 ? formatMoney(Number(size.quantidade) * Number(size.valor_unitario)) : '—'}</span><span>{size.quantidade_produzida.toLocaleString('pt-BR')}</span><span>{size.quantidade_costurada.toLocaleString('pt-BR')}</span><span>{size.quantidade_entregue.toLocaleString('pt-BR')}</span></div>)}</div>}</details>
            <details className="work-order-documents"><summary><span><FileText size={15} /> Notas fiscais e comprovantes</span><span className="work-order-details-summary">{documents.length} arquivo(s) <ChevronDown size={14} /></span></summary>
              {!ready && <p className="work-order-documents-note">Os documentos ficam disponíveis após a Produção concluir a entrega e liberar o lote.</p>}
              {ready && <div className="work-order-document-actions"><label className="work-order-upload"><Upload size={14} /><span>Anexar nota fiscal</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" disabled={financialSaving} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) setConfirmation({ kind: 'document', order, type: 'nota_fiscal', file }) }} /></label><label className="work-order-upload"><Upload size={14} /><span>Anexar comprovante de pagamento</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" disabled={financialSaving} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) setConfirmation({ kind: 'document', order, type: 'comprovante_pagamento', file }) }} /></label><small>PDF, JPG, PNG ou WebP · até 10 MB · será solicitada confirmação antes do envio</small></div>}
              {documents.length > 0 && <div className="work-order-document-list">{documents.map((document) => <button className="work-order-document-row" key={document.id} disabled={saving === `open-${document.id}`} onClick={() => void openDocument(document)}><span className="document-icon"><FileText size={16} /></span><span><strong>{document.nome_arquivo}</strong><small>{document.tipo === 'nota_fiscal' ? 'Nota fiscal' : 'Comprovante de pagamento'} · {fileSize(Number(document.tamanho_bytes || 0))} · {formatDate(document.created_at)}</small></span>{saving === `open-${document.id}` ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}</button>)}</div>}
            </details>
            <details className="work-order-history"><summary><span><Clock3 size={15} /> Histórico de auditoria</span><span>{order.historico?.length || 0} registro(s)</span></summary>{order.historico?.length ? <ol>{order.historico.map((event, index) => <li key={`${event.created_at}-${index}`}><span className="work-order-history-dot" /><div><strong>{auditLabels[event.evento] || event.evento.replaceAll('_', ' ')}</strong><small>{formatDate(event.created_at)}{event.responsavel ? ` · ${event.responsavel}` : ''}</small></div></li>)}</ol> : <p>Nenhuma alteração registrada até o momento.</p>}</details>
          </article>
        })}
      </div>}
      {!loading && orders.length > 0 && <div className="work-orders-list-foot">Exibindo {filteredOrders.length} de {orders.length} ordens. Os anexos são acessados por links temporários e privados.</div>}
    </SectionCard>
    {confirmation && <ConfirmationModal title={confirmationTitle} description={confirmationDescription} confirmLabel={confirmationLabel} busy={confirmationBusy} onCancel={() => { if (!confirmationBusy) { setConfirmation(null); setError('') } }} onConfirm={() => void confirmPendingAction()}>
      {error && <p className="confirmation-modal-error" role="alert">{error}</p>}
      {confirmation.kind === 'client' && <div className="confirmation-summary"><span>Nome do cliente</span><strong>{confirmation.name}</strong><small>Sem CNPJ ou outros dados obrigatórios neste cadastro rápido.</small></div>}
      {confirmation.kind === 'order' && <div className="confirmation-summary"><div className="confirmation-summary-row"><span>Cliente</span><strong>{confirmation.payload.clienteNome}</strong></div><div className="confirmation-summary-row"><span>Produto</span><strong>{confirmation.payload.descricao}</strong></div><div className="confirmation-summary-row"><span>Prazo previsto</span><strong>{formatDate(confirmation.payload.prazo)}</strong></div><div className="confirmation-summary-row"><span>Prioridade</span><strong>{confirmation.payload.prioridade}</strong></div><div className="confirmation-calculation-list"><strong>Memória de cálculo por tamanho</strong>{confirmation.payload.tamanhos.map((size) => <div className="confirmation-calculation-row" key={size.tamanho}><span>{size.tamanho}</span><span>{size.quantidade.toLocaleString('pt-BR')} peças × {formatMoney(size.valor_unitario)}</span><strong>{formatMoney(moneyRound(size.quantidade * size.valor_unitario))}</strong></div>)}</div><div className="confirmation-summary-total"><span>{confirmation.payload.tamanhos.reduce((sum, size) => sum + size.quantidade, 0).toLocaleString('pt-BR')} peças · total calculado</span><strong>{formatMoney(confirmation.payload.tamanhos.reduce((sum, size) => sum + moneyRound(size.quantidade * size.valor_unitario), 0))}</strong></div></div>}
      {confirmation.kind === 'finance' && <div className="confirmation-summary"><div className="confirmation-summary-row"><span>Ordem</span><strong>{confirmation.order.numero} · {confirmation.order.cliente || 'Cliente não informado'}</strong></div><div className="confirmation-summary-row"><span>Pagamento</span><strong>{confirmation.statusPagamento === 'pago' ? 'Pago' : 'Aguardando pagamento'}</strong></div><div className="confirmation-summary-row"><span>Número da NF</span><strong>{confirmation.notaFiscalNumero.trim() || 'Sem alteração / removido'}</strong></div></div>}
      {confirmation.kind === 'document' && <div className="confirmation-summary"><div className="confirmation-summary-row"><span>Ordem</span><strong>{confirmation.order.numero} · {confirmation.order.cliente || 'Cliente não informado'}</strong></div><div className="confirmation-summary-row"><span>Tipo</span><strong>{confirmation.type === 'nota_fiscal' ? 'Nota fiscal' : 'Comprovante de pagamento'}</strong></div><div className="confirmation-summary-row"><span>Arquivo</span><strong>{confirmation.file.name}</strong></div><div className="confirmation-summary-row"><span>Tamanho</span><strong>{fileSize(confirmation.file.size)}</strong></div></div>}
    </ConfirmationModal>}
  </div>
}
