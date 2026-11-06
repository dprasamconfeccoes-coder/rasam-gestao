import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  WalletCards,
  X,
} from 'lucide-react'
import {
  adminCriarRecorrencia,
  adminFinanceiroLancamentoExcluir,
  adminFinanceiroLancamentoSalvar,
  adminFinanceiroLancamentoStatus,
  adminFinanceiroLancamentosSerieSalvar,
  adminFinanceiroWorkspace,
  financePaymentDocumentDownload,
  settleFinancePayment,
  uploadFinancePaymentInstruction,
} from '../lib/api'
import type { DebtPaymentMethod, FinanceiroLancamento, FinanceiroWorkspace } from '../lib/types'
import { saoPauloToday } from '../lib/business-date'
import { EmptyState, ErrorState, LoadingState, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import { PaymentDocuments } from './PaymentDocuments'
import './debt-management.css'
import './finance-health.css'
import { downloadFinanceiroLancamentoPdf } from './financeiro-lancamento-pdf'
import { downloadReportPdf, downloadReportXlsx, type ReportCell, type ReportExportColumn } from '../lib/report-export'

type Periodicidade = 'semanal' | 'mensal' | 'anual'
type Draft = {
  id?: string
  tipo: 'pagar' | 'receber'
  categoria: string
  descricao: string
  valor: string
  vencimento: string
  observacoes: string
  modo: 'unico' | 'serie'
  quantidade: string
  periodicidade: Periodicidade
}
type Confirmation = { title: string; description: string; confirmLabel: string; action: () => Promise<void> }

const emptyDraft: Draft = {
  tipo: 'pagar', categoria: 'Operacional', descricao: '', valor: '', vencimento: '', observacoes: '',
  modo: 'unico', quantidade: '12', periodicidade: 'mensal',
}
const paymentLabels: Record<DebtPaymentMethod, string> = {
  pix: 'PIX', transferencia: 'Transferência', boleto: 'Boleto', outro: 'Outro',
}
const str = (value: unknown) => value === null || value === undefined ? '' : String(value)
const periodicityLabels: Record<Periodicidade, string> = { semanal: 'semanal', mensal: 'mensal', anual: 'anual' }

function dateForSeries(start: string, index: number, periodicidade: Periodicidade) {
  const [year, month, day] = start.split('-').map(Number)
  if (!year || !month || !day) return ''
  if (periodicidade === 'semanal') {
    const date = new Date(Date.UTC(year, month - 1, day + index * 7))
    return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-')
  }
  const monthIndex = year * 12 + month - 1 + index * (periodicidade === 'anual' ? 12 : 1)
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonth = monthIndex % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return [targetYear, String(targetMonth + 1).padStart(2, '0'), String(Math.min(day, lastDay)).padStart(2, '0')].join('-')
}

export function FinanceHealthDashboard({ token, onBack, initialFilter = 'todos' }: { token: string; onBack?: () => void; initialFilter?: 'todos' | 'pagar' | 'receber' | 'atrasados' }) {
  const [workspace, setWorkspace] = useState<FinanceiroWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<'todos' | 'pagar' | 'receber' | 'atrasados'>(initialFilter)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [pdfGenerating, setPdfGenerating] = useState('')
  const [expandedDocumentsId, setExpandedDocumentsId] = useState('')
  const [paymentTarget, setPaymentTarget] = useState<FinanceiroLancamento | null>(null)
  const [paymentDate, setPaymentDate] = useState(saoPauloToday)
  const [paymentMethod, setPaymentMethod] = useState<DebtPaymentMethod>('pix')
  const [paymentReason, setPaymentReason] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [rec, setRec] = useState({ descricao: '', categoria: 'Operacional', fornecedor: '', valor: '', periodicidade: 'mensal' as Periodicidade, proximoVencimento: '' })
  const [recOpen, setRecOpen] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const result = await adminFinanceiroWorkspace(token)
      if (!result.sucesso) throw new Error(result.erro || 'Acesso negado')
      setWorkspace(result)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Falha ao carregar o painel financeiro')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [token])

  useEffect(() => {
    if (!showForm && !confirmation && !paymentTarget) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setShowForm(false)
        setConfirmation(null)
        setPaymentTarget(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [showForm, confirmation, paymentTarget, busy])

  const resumo = workspace?.resumo || {}
  const contas = workspace?.contas || []
  const today = saoPauloToday()
  const overdue = (entry: FinanceiroLancamento) => {
    const status = str(entry.status).toLowerCase()
    return status !== 'pago' && status !== 'cancelado' && Boolean(entry.vencimento && str(entry.vencimento).slice(0, 10) < today)
  }
  const visible = useMemo(() => contas
    .filter((item) => filter === 'todos' || (filter === 'atrasados' ? overdue(item) : item.tipo === filter))
    .sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || str(a.vencimento).localeCompare(str(b.vencimento))), [contas, filter, today])
  const receivables = useMemo(() => contas.filter((item) => item.tipo === 'receber' && !['pago', 'cancelado'].includes(str(item.status).toLowerCase())), [contas])
  const receivablesTotal = receivables.reduce((total, item) => total + Number(item.valor || 0), 0)

  async function run(fn: () => Promise<{ sucesso: boolean; erro?: string }>, successMessage: string) {
    const result = await fn()
    if (!result.sucesso) throw new Error(result.erro || 'Operação não concluída')
    setMessage(successMessage)
    setDraft(emptyDraft)
    setShowForm(false)
    await load()
  }

  function askConfirmation(next: Confirmation) {
    setError('')
    setConfirmation(next)
  }

  async function executeConfirmation() {
    if (!confirmation) return
    setBusy(true)
    setError('')
    try {
      await confirmation.action()
      setConfirmation(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operação não concluída')
    } finally {
      setBusy(false)
    }
  }

  async function generatePdf(entry: FinanceiroLancamento) {
    if (!entry.id) return
    setPdfGenerating(entry.id)
    setError('')
    try {
      await downloadFinanceiroLancamentoPdf(entry)
      setMessage('Relatório PDF gerado com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o relatório PDF.')
    } finally {
      setPdfGenerating('')
    }
  }

  function edit(entry: FinanceiroLancamento) {
    setDraft({
      id: str(entry.id), tipo: entry.tipo === 'receber' ? 'receber' : 'pagar', categoria: str(entry.categoria),
      descricao: str(entry.descricao), valor: str(entry.valor), vencimento: str(entry.vencimento).slice(0, 10),
      observacoes: str(entry.observacoes), modo: 'unico', quantidade: '1', periodicidade: 'mensal',
    })
    setShowForm(true)
  }

  function openNew() {
    setDraft(emptyDraft)
    setMessage('')
    setError('')
    setShowForm(true)
  }

  function openPayment(entry: FinanceiroLancamento) {
    if (!entry.id) return
    setError('')
    setPaymentDate(saoPauloToday())
    setPaymentMethod(entry.forma_pagamento || 'pix')
    setPaymentReason('')
    setProofFile(null)
    setPaymentTarget(entry)
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!paymentTarget?.id) return
    setBusy(true)
    setError('')
    try {
      const result = await settleFinancePayment(token, 'lancamento', paymentTarget.id, paymentDate, paymentMethod, paymentReason, proofFile)
      setMessage(result.erro || 'Pagamento registrado com sucesso.')
      setPaymentTarget(null)
      setProofFile(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar o pagamento.')
    } finally {
      setBusy(false)
    }
  }

  const quantity = Math.max(1, Math.min(120, Number(draft.quantidade) || 1))
  const isSeries = !draft.id && draft.modo === 'serie' && quantity >= 2
  const previewRows = Array.from({ length: isSeries ? quantity : 1 }, (_, index) => ({ number: index + 1, date: dateForSeries(draft.vencimento, index, draft.periodicidade), value: Number(draft.valor) || 0 }))
  const receitaPrevista = Number(resumo.receitas_ordens_previstas || 0) + Number(resumo.receitas_pendentes || 0)
  const despesas = Number(resumo.despesas_pendentes || 0)
  const overdueCount = contas.filter(overdue).length
  const ledgerColumns: ReportExportColumn[] = [
    { key: 'tipo', label: 'Tipo' }, { key: 'status', label: 'Status' }, { key: 'descricao', label: 'Descrição' },
    { key: 'categoria', label: 'Categoria' }, { key: 'vencimento', label: 'Vencimento' }, { key: 'valor', label: 'Valor (R$)' },
    { key: 'pago_em', label: 'Pago em' }, { key: 'forma_pagamento', label: 'Forma de pagamento' }, { key: 'observacoes', label: 'Observações' },
  ]
  const ledgerRows: Array<Record<string, ReportCell>> = visible.map((item) => ({
    tipo: item.tipo === 'receber' ? 'Receita' : 'Despesa', status: str(item.status), descricao: str(item.descricao), categoria: str(item.categoria),
    vencimento: str(item.vencimento).slice(0, 10), valor: Number(item.valor || 0), pago_em: str(item.pago_em).slice(0, 10),
    forma_pagamento: item.forma_pagamento ? paymentLabels[item.forma_pagamento] || str(item.forma_pagamento) : '', observacoes: str(item.observacoes),
  }))
  const exportMetadata: Array<[string, string]> = [['Itens exportados', `${visible.length} de ${contas.length}`], ['Gerado em', new Date().toLocaleString('pt-BR')]]
  async function exportLedger(format: 'xlsx' | 'pdf') {
    setExporting(true)
    setError('')
    try {
      if (format === 'xlsx') await downloadReportXlsx('Movimentacoes financeiras', ledgerColumns, ledgerRows, exportMetadata)
      else await downloadReportPdf('Movimentações financeiras', ledgerColumns, ledgerRows.map((row) => ({ ...row, vencimento: formatDate(String(row.vencimento || '')), pago_em: formatDate(String(row.pago_em || '')), valor: formatMoney(Number(row.valor || 0)) })), exportMetadata)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível exportar as movimentações.')
    } finally { setExporting(false) }
  }
  const header = (
    <header className="finance-operations-topbar">
      <div className="finance-operations-title">
        {onBack && <button className="finance-back-link" type="button" onClick={onBack}><ArrowLeft size={15} /> Resumo</button>}
        <h1>Movimentações</h1>
        <span>{visible.length} de {contas.length} registros</span>
      </div>
      <div className="finance-operations-actions">
        <button className="secondary-button" onClick={() => void exportLedger('xlsx')} disabled={!visible.length || exporting}><FileSpreadsheet size={15} /> Excel</button>
        <button className="secondary-button" onClick={() => void exportLedger('pdf')} disabled={!visible.length || exporting}><FileText size={15} /> PDF</button>
        <button className="secondary-button finance-refresh-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar</button>
        <button className="primary-button" onClick={openNew}><Plus size={16} /> Novo lançamento</button>
      </div>
    </header>
  )

  function submitDraft(event: FormEvent) {
    event.preventDefault()
    if (!draft.descricao || !draft.categoria || !draft.valor || !draft.vencimento) {
      setError('Preencha categoria, descrição, valor e vencimento.')
      return
    }
    if (isSeries && quantity < 2) {
      setError('Para uma série, informe pelo menos 2 lançamentos.')
      return
    }
    const seriesText = isSeries ? `${quantity} lançamentos ${periodicityLabels[draft.periodicidade]}` : '1 lançamento'
    askConfirmation({
      title: isSeries ? 'Confirmar série financeira' : 'Confirmar lançamento financeiro',
      description: isSeries
        ? `Serão criadas ${quantity} ${draft.tipo === 'pagar' ? 'despesas' : 'receitas'} de ${formatMoney(Number(draft.valor))} cada, começando em ${formatDate(draft.vencimento)}.`
        : `Será criado 1 ${draft.tipo === 'pagar' ? 'despesa' : 'receita'} de ${formatMoney(Number(draft.valor))}.`,
      confirmLabel: isSeries ? `Gerar ${quantity} lançamentos` : 'Cadastrar lançamento',
      action: async () => {
        if (isSeries) {
          await run(() => adminFinanceiroLancamentosSerieSalvar(token, {
            tipo: draft.tipo, categoria: draft.categoria, descricao: draft.descricao, valor: Number(draft.valor),
            primeiroVencimento: draft.vencimento, quantidade: quantity, periodicidade: draft.periodicidade, observacoes: draft.observacoes,
          }), `${seriesText} gerados com sucesso.`)
        } else {
          await run(() => adminFinanceiroLancamentoSalvar(token, {
            id: draft.id, tipo: draft.tipo, categoria: draft.categoria, descricao: draft.descricao, valor: Number(draft.valor),
            vencimento: draft.vencimento, observacoes: draft.observacoes,
          }), 'Lançamento salvo.')
        }
      },
    })
  }

  if (loading && !workspace) return <div className="debt-management-page finance-health-page">{header}<LoadingState label="Carregando painel seguro do financeiro…" /></div>
  if (loadError && !workspace) return <div className="debt-management-page finance-health-page">{header}<ErrorState message={loadError} /></div>

  return <div className="debt-management-page finance-health-page">
    {header}
    {message && <div className="debt-flash success"><Check size={17} />{message}<button aria-label="Fechar aviso" onClick={() => setMessage('')}><X size={15} /></button></div>}
    {error && <div className="debt-flash error"><AlertCircle size={17} />{error}<button aria-label="Fechar aviso" onClick={() => setError('')}><X size={15} /></button></div>}

    <section className="debt-metrics" aria-label="Indicadores da saúde financeira">
      <article className="debt-metric green"><span className="debt-metric-icon"><ArrowUpRight size={19} /></span><div><small>Receitas previstas</small><strong>{formatMoney(receitaPrevista)}</strong><span>{Number(resumo.ordens_aguardando_pagamento || 0)} ordem(ns) aguardando pagamento</span></div></article>
      <article className="debt-metric red"><span className="debt-metric-icon"><ArrowDownLeft size={19} /></span><div><small>Despesas a pagar</small><strong>{formatMoney(despesas)}</strong><span>{formatMoney(Number(resumo.despesas_vencidas || 0))} vencidas</span></div></article>
      <article className="debt-metric blue"><span className="debt-metric-icon"><WalletCards size={19} /></span><div><small>Saldo projetado</small><strong>{formatMoney(receitaPrevista - despesas)}</strong><span>Receitas menos despesas pendentes</span></div></article>
      <article className="debt-metric gold"><span className="debt-metric-icon"><CheckCircle2 size={19} /></span><div><small>Receitas recebidas</small><strong>{formatMoney(Number(resumo.receitas_recebidas || 0))}</strong><span>Baixas registradas</span></div></article>
    </section>

    <div className="two-column">
      <SectionCard title="Lançamentos">
        <div className="debt-filters finance-filters" role="group" aria-label="Filtrar movimentações"><button className={filter === 'todos' ? 'active' : ''} onClick={() => setFilter('todos')}>Todos</button><button className={filter === 'pagar' ? 'active' : ''} onClick={() => setFilter('pagar')}>Despesas</button><button className={filter === 'receber' ? 'active' : ''} onClick={() => setFilter('receber')}>Receitas</button><button className={filter === 'atrasados' ? 'active overdue-filter' : ''} onClick={() => setFilter('atrasados')}>Em atraso <span>{overdueCount}</span></button></div>
        {visible.length ? <div className="table-wrap"><table><thead><tr><th>Tipo / status</th><th>Descrição</th><th>Vencimento / valor</th><th>Ações</th></tr></thead><tbody>
          {visible.map((entry, index) => {
            const id = str(entry.id)
            const status = str(entry.status)
            const isLedgerEntry = entry.fonte_registro === 'ledger'
            const documents = entry.documentos || []
            return <Fragment key={id || index}>
              <tr className={overdue(entry) ? 'finance-row-overdue' : ''}>
                <td><div className="finance-cell-stack"><span className={`finance-type ${entry.tipo === 'receber' ? 'income' : 'expense'}`}>{entry.tipo === 'receber' ? 'Receita' : 'Despesa'}</span><small className="finance-status-under-type"><StatusPill value={status} /></small></div></td>
                <td><strong>{str(entry.descricao)}</strong><small>{str(entry.categoria)}{entry.observacoes ? ` · ${entry.observacoes}` : ''}{isLedgerEntry && entry.forma_pagamento ? ` · ${paymentLabels[entry.forma_pagamento]}` : ''}{entry.pago_em ? ` · pago em ${formatDate(entry.pago_em)}` : ''}{!isLedgerEntry ? entry.fonte_registro === 'divida_parcela' ? ' · Gerenciar no módulo Dívidas' : ' · Registro legado (consulta)' : ''}</small></td>
                <td><div className="finance-cell-stack finance-due-value"><time>{formatDate(str(entry.vencimento))}</time>{overdue(entry) && <small className="finance-overdue-flag">Em atraso</small>}<strong className="money-cell">{formatMoney(Number(entry.valor || 0))}</strong></div></td>
                <td><div className="row-actions">
                  <button className="icon-button" title="Editar lançamento" aria-label="Editar lançamento" onClick={() => edit(entry)} disabled={!isLedgerEntry || status === 'pago'}><Pencil size={15} /></button>
                  {isLedgerEntry && status !== 'pago' && status !== 'cancelado' && <>
                    <button className="icon-button finance-pay-action" title="Registrar pagamento" aria-label="Registrar pagamento" onClick={() => openPayment(entry)}><CheckCircle2 size={15} /></button>
                    <button className="icon-button danger" title="Inativar lançamento" aria-label="Inativar lançamento" onClick={() => askConfirmation({ title: 'Inativar lançamento', description: `Inativar “${str(entry.descricao)}”? O histórico será preservado, mas ele deixará de compor os pendentes.`, confirmLabel: 'Inativar lançamento', action: () => run(() => adminFinanceiroLancamentoStatus(token, id, 'cancelado'), 'Lançamento inativado.') })}><Ban size={15} /></button>
                  </>}
                  {isLedgerEntry && <button className="icon-button" title="Documentos do pagamento" aria-label="Documentos do pagamento" aria-expanded={expandedDocumentsId === id} onClick={() => setExpandedDocumentsId((current) => current === id ? '' : id)}><Paperclip size={15} /></button>}
                  <button className="icon-button finance-pdf-action" title="Gerar relatório PDF" aria-label="Gerar relatório PDF" onClick={() => void generatePdf(entry)} disabled={pdfGenerating === id}>{pdfGenerating === id ? <RefreshCw size={15} className="spin" /> : <FileText size={15} />}</button>
                </div></td>
              </tr>
              {isLedgerEntry && expandedDocumentsId === id && <tr className="finance-documents-table-row"><td colSpan={4}><PaymentDocuments
                documents={documents}
                canAttachInstruction={status !== 'pago' && status !== 'cancelado'}
                onUploadInstruction={async (file) => {
                  await uploadFinancePaymentInstruction(token, 'lancamento', id, file)
                  await load()
                }}
                onDownload={async (documentId) => {
                  const result = await financePaymentDocumentDownload(token, documentId)
                  if (!result.url) throw new Error('O link temporário não foi recebido.')
                  return { url: result.url, arquivo_nome: result.arquivo_nome }
                }}
              /></td></tr>}
            </Fragment>
          })}
        </tbody></table></div> : <EmptyState title="Nenhum lançamento" description="Cadastre uma despesa ou receita para começar a acompanhar o caixa." />}
      </SectionCard>

      <SectionCard title="Contas a receber" caption="Receitas pendentes e vencidas">
        <div className="finance-receivables-summary"><span>Em aberto</span><strong>{receivables.length} conta(s) · {formatMoney(receivablesTotal)}</strong></div>
        {receivables.length ? <div className="document-list">{receivables.slice(0, 8).map((entry, index) => <div className="document-row" key={str(entry.id) || index}><div><strong>{str(entry.descricao)}</strong><small>{str(entry.categoria)} · vencimento {formatDate(str(entry.vencimento))}</small></div><strong>{formatMoney(Number(entry.valor || 0))}</strong><StatusPill value={str(entry.status)} /></div>)}</div> : <EmptyState title="Nenhuma conta a receber" description="Receitas pendentes aparecerão aqui quando forem registradas." />}
        {receivables.length > 8 && <div className="finance-receivables-more">Exibindo 8 de {receivables.length} contas. Para exportar todas, aplique o filtro Receitas na lista principal.</div>}
      </SectionCard>
    </div>

    <SectionCard title="Despesas recorrentes" caption="Água, internet, energia, aluguel e honorários podem ser acompanhados por periodicidade">
      {(workspace?.recorrencias || []).length ? <div className="document-list">{(workspace?.recorrencias || []).map((entry, index) => <div className="document-row" key={str(entry.id) || index}><div><strong>{str(entry.descricao)}</strong><small>{str(entry.categoria)} · {str(entry.periodicidade)} · próximo vencimento {formatDate(str(entry.proximo_vencimento))}</small></div><strong>{formatMoney(Number(entry.valor || 0))}</strong><StatusPill value={entry.ativo ? 'ativa' : 'inativa'} /></div>)}</div> : <EmptyState title="Nenhuma despesa recorrente" description="Cadastre um compromisso fixo para acompanhar o próximo vencimento." />}
      <div className="finance-recurring-actions"><div><strong>Adicionar nova despesa recorrente</strong><small>Abra somente quando precisar cadastrar água, internet, energia ou outro compromisso fixo.</small></div><button className="secondary-button" type="button" onClick={() => setRecOpen(!recOpen)}>{recOpen ? 'Fechar cadastro' : 'Nova recorrência'}</button></div>
      {recOpen && <form className="form-stack compact-rec-form" onSubmit={(event) => {
        event.preventDefault()
        askConfirmation({ title: 'Cadastrar despesa recorrente', description: `Cadastrar “${rec.descricao}” como compromisso ${rec.periodicidade}?`, confirmLabel: 'Cadastrar recorrência', action: () => run(() => adminCriarRecorrencia(token, { descricao: rec.descricao, categoria: rec.categoria, fornecedor: rec.fornecedor, valor: Number(rec.valor), periodicidade: rec.periodicidade, proximoVencimento: rec.proximoVencimento }), 'Despesa recorrente cadastrada.') })
      }}>
        <h3>Nova despesa recorrente</h3>
        <div className="form-row"><label>Descrição<input required value={rec.descricao} onChange={(event) => setRec({ ...rec, descricao: event.target.value })} placeholder="Ex.: Energia" /></label><label>Categoria<input required value={rec.categoria} onChange={(event) => setRec({ ...rec, categoria: event.target.value })} /></label><label>Valor<input required type="number" min="0.01" step="0.01" value={rec.valor} onChange={(event) => setRec({ ...rec, valor: event.target.value })} /></label></div>
        <div className="form-row"><label>Fornecedor<input value={rec.fornecedor} onChange={(event) => setRec({ ...rec, fornecedor: event.target.value })} /></label><label>Periodicidade<select value={rec.periodicidade} onChange={(event) => setRec({ ...rec, periodicidade: event.target.value as Periodicidade })}><option value="mensal">Mensal</option><option value="semanal">Semanal</option><option value="anual">Anual</option></select></label><label>Próximo vencimento<input required type="date" value={rec.proximoVencimento} onChange={(event) => setRec({ ...rec, proximoVencimento: event.target.value })} /></label></div>
        <button className="secondary-button" type="submit"><Plus size={16} /> Revisar e cadastrar</button>
      </form>}
    </SectionCard>

    {showForm && <div className="finance-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowForm(false) }}><section className="finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-modal-title">
      <div className="finance-modal-header"><div><span className="eyebrow">Novo movimento · planejamento</span><h2 id="finance-modal-title">{draft.id ? 'Editar' : 'Cadastrar'} {draft.tipo === 'pagar' ? 'despesa' : 'receita'}</h2><p>Crie um lançamento único ou simule uma série antes de gravar.</p></div><button className="finance-modal-close" aria-label="Fechar cadastro" onClick={() => setShowForm(false)} disabled={busy}><X size={18} /></button></div>
      <form className="finance-modal-form" onSubmit={submitDraft}>
        <div className="finance-modal-segmented" role="group" aria-label="Tipo de movimento"><button type="button" className={draft.tipo === 'pagar' ? 'active expense' : ''} onClick={() => setDraft({ ...draft, tipo: 'pagar' })}><ArrowDownLeft size={15} /> Despesa</button><button type="button" className={draft.tipo === 'receber' ? 'active income' : ''} onClick={() => setDraft({ ...draft, tipo: 'receber' })}><ArrowUpRight size={15} /> Receita</button></div>
        <div className="finance-modal-grid"><label>Categoria<input required value={draft.categoria} onChange={(event) => setDraft({ ...draft, categoria: event.target.value })} placeholder="Internet, medicina do trabalho…" /></label><label>Descrição do contrato<input required value={draft.descricao} onChange={(event) => setDraft({ ...draft, descricao: event.target.value })} placeholder="Ex.: Contrato de internet empresarial" /></label><label>Valor por lançamento (R$)<input required min="0.01" step="0.01" type="number" value={draft.valor} onChange={(event) => setDraft({ ...draft, valor: event.target.value })} placeholder="0,00" /></label><label>Primeiro vencimento<input required type="date" value={draft.vencimento} onChange={(event) => setDraft({ ...draft, vencimento: event.target.value })} /></label><label className="finance-modal-wide">Observações<textarea rows={2} value={draft.observacoes} onChange={(event) => setDraft({ ...draft, observacoes: event.target.value })} placeholder="Fornecedor, contrato, centro de custo…" /></label></div>
        {!draft.id && <div className="finance-mode-switch"><button type="button" className={draft.modo === 'unico' ? 'active' : ''} onClick={() => setDraft({ ...draft, modo: 'unico' })}><CalendarDays size={15} /> Lançamento único</button><button type="button" className={draft.modo === 'serie' ? 'active' : ''} onClick={() => setDraft({ ...draft, modo: 'serie' })}><Repeat2 size={15} /> Série de lançamentos</button></div>}
        {!draft.id && draft.modo === 'serie' && <div className="finance-series-config"><label>Quantidade de lançamentos<input min="2" max="120" type="number" value={draft.quantidade} onChange={(event) => setDraft({ ...draft, quantidade: event.target.value })} /></label><label>Periodicidade<select value={draft.periodicidade} onChange={(event) => setDraft({ ...draft, periodicidade: event.target.value as Periodicidade })}><option value="mensal">Mensal</option><option value="semanal">Semanal</option><option value="anual">Anual</option></select></label><div className="finance-series-total"><small>Total projetado</small><strong>{formatMoney((Number(draft.valor) || 0) * quantity)}</strong></div></div>}
        {isSeries && <div className="finance-preview"><div className="finance-preview-heading"><div><strong>Prévia dos lançamentos</strong><small>Confira datas e valores antes de gravar no banco.</small></div><span>{quantity} itens</span></div><div className="finance-preview-list">{previewRows.map((row) => <div className="finance-preview-row" key={row.number}><span>{row.number}</span><time>{formatDate(row.date)}</time><strong>{formatMoney(row.value)}</strong></div>)}</div></div>}
        {error && <div className="finance-modal-error"><AlertCircle size={16} />{error}</div>}
        <div className="finance-modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)} disabled={busy}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? <RefreshCw size={16} className="spin" /> : <Check size={16} />} {isSeries ? 'Revisar e gerar série' : draft.id ? 'Revisar alterações' : 'Revisar lançamento'}</button></div>
      </form>
    </section></div>}

    {paymentTarget && <div className="finance-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPaymentTarget(null) }}><section className="finance-modal finance-payment-modal" role="dialog" aria-modal="true" aria-labelledby="finance-payment-title">
      <div className="finance-modal-header"><div><span className="eyebrow">Baixa financeira</span><h2 id="finance-payment-title">Registrar pagamento</h2><p>{str(paymentTarget.descricao)} · {formatMoney(Number(paymentTarget.valor || 0))}</p></div><button className="finance-modal-close" aria-label="Fechar pagamento" onClick={() => setPaymentTarget(null)} disabled={busy}><X size={18} /></button></div>
      <form className="finance-modal-form" onSubmit={(event) => void submitPayment(event)}>
        <div className="finance-modal-grid"><label>Data efetiva do pagamento<input required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label><label>Forma de pagamento<select required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as DebtPaymentMethod)}>{Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="finance-modal-wide">Referência / observação <span className="field-note">Opcional</span><input maxLength={500} value={paymentReason} onChange={(event) => setPaymentReason(event.target.value)} placeholder="Identificação da baixa" /></label><label className="finance-modal-wide">Comprovante de pagamento <span className="field-note">Opcional · PDF, JPG, PNG ou WEBP · até 10 MB</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setProofFile(event.target.files?.[0] || null)} /><small>{proofFile ? proofFile.name : 'Nenhum comprovante selecionado'}</small></label></div>
        {error && <div className="finance-modal-error"><AlertCircle size={16} />{error}</div>}
        <div className="finance-modal-actions"><button type="button" className="secondary-button" onClick={() => setPaymentTarget(null)} disabled={busy}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? <RefreshCw size={16} className="spin" /> : <CheckCircle2 size={16} />} Confirmar pagamento</button></div>
      </form>
    </section></div>}

    {confirmation && <div className="finance-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmation(null) }}><section className="finance-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="finance-confirm-title"><div className="finance-confirm-icon"><AlertCircle size={22} /></div><div><span className="eyebrow">Confirmação necessária</span><h2 id="finance-confirm-title">{confirmation.title}</h2><p>{confirmation.description}</p></div><div className="finance-modal-actions"><button className="secondary-button" onClick={() => setConfirmation(null)} disabled={busy}>Voltar</button><button className="primary-button" onClick={() => void executeConfirmation()} disabled={busy}>{busy ? <RefreshCw size={16} className="spin" /> : <Check size={16} />} {confirmation.confirmLabel}</button></div></section></div>}
  </div>
}
