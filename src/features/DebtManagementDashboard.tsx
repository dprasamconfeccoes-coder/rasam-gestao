import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowDownToLine, Banknote, CalendarClock, Check, ChevronDown, CircleAlert, FilePlus2, FileText, History, Pencil, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, WalletCards, X } from 'lucide-react'
import {
  addDebtInstallment,
  adminDebtAccess,
  changeDebtInstallment,
  changeManagedDebtStatus,
  createManagedDebt,
  debtAttachmentDownload,
  managedDebts,
  settleDebtInstallment,
  updateDebtInstallment,
  updateManagedDebt,
  uploadDebtPaymentDocument,
} from '../lib/api'
import type { DebtCategory, DebtInstallment, DebtPaymentMethod, ManagedDebt } from '../lib/types'
import { ConfirmationModal, EmptyState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import { downloadManagedDebtPdf } from './debt-management-pdf'
import './debt-management.css'

type ScheduleMode = 'equal' | 'custom'
type DebtDraft = {
  credor: string
  categoria: DebtCategory
  descricao: string
  dataContratacao: string
  observacoes: string
  valorTotal: string
  entrada: string
  vencimentoEntrada: string
  quantidade: string
  primeiroVencimento: string
  modo: ScheduleMode
  parcelas: Array<{ valor: string; vencimento: string }>
  formaPagamento: DebtPaymentMethod
  chavePix: string
  dadosTransferencia: string
}
type InstallmentDraft = { valor: string; vencimento: string; formaPagamento: DebtPaymentMethod; chavePix: string; dadosTransferencia: string }
type PendingAction =
  | { kind: 'create'; draft: DebtDraft }
  | { kind: 'update-debt'; id: string; draft: DebtDraft }
  | { kind: 'add-installment'; debtId: string; draft: InstallmentDraft }
  | { kind: 'update-installment'; id: string; draft: InstallmentDraft }
  | { kind: 'settle'; id: string; paidOn: string; method: DebtPaymentMethod; reason: string; proof: File | null }
  | { kind: 'change-installment'; id: string; action: 'inativar' | 'restaurar' | 'reabrir'; reason: string }
  | { kind: 'change-debt'; id: string; action: 'inativar' | 'restaurar'; reason: string }
  | { kind: 'upload-instruction'; id: string; file: File }

const categoryLabels: Record<DebtCategory, string> = {
  trabalhista: 'Trabalhista',
  previdenciaria: 'Previdenciária',
  emprestimo_pessoal: 'Empréstimo particular',
  consignado: 'Empréstimo consignado',
  outros: 'Outros / revisar',
}
const paymentLabels: Record<DebtPaymentMethod, string> = {
  pix: 'Pix', transferencia: 'Transferência bancária', boleto: 'Boleto', outro: 'Outro meio',
}
const statusLabels: Record<ManagedDebt['status'], string> = {
  ativa: 'Ativa', quitada: 'Quitada', renegociada: 'Renegociada', inativa: 'Inativa',
}
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const amountCents = (value: string | number) => Math.round((Number(value) || 0) * 100)

function addMonths(base: string, offset: number) {
  if (!base) return ''
  const [year, month, day] = base.split('-').map(Number)
  if (!year || !month || !day) return ''
  const first = new Date(Date.UTC(year, month - 1 + offset, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const safeDay = Math.min(day, lastDay)
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function equalSchedule(count: number, total: string, entry: string, firstDue: string) {
  const safeCount = Math.min(240, Math.max(1, count || 1))
  const remainder = amountCents(total) - amountCents(entry)
  if (remainder <= 0) return Array.from({ length: safeCount }, (_, index) => ({ valor: '', vencimento: addMonths(firstDue, index) }))
  const base = Math.floor(remainder / safeCount)
  const extra = remainder % safeCount
  return Array.from({ length: safeCount }, (_, index) => ({
    valor: ((base + (index < extra ? 1 : 0)) / 100).toFixed(2),
    vencimento: addMonths(firstDue, index),
  }))
}

function blankDebtDraft(): DebtDraft {
  return {
    credor: '', categoria: 'trabalhista', descricao: '', dataContratacao: '', observacoes: '',
    valorTotal: '', entrada: '0', vencimentoEntrada: '', quantidade: '12', primeiroVencimento: '',
    modo: 'equal', parcelas: equalSchedule(12, '', '0', ''), formaPagamento: 'outro', chavePix: '', dadosTransferencia: '',
  }
}

function draftPayload(draft: DebtDraft) {
  return {
    credor: draft.credor.trim(), descricao: draft.descricao.trim(), categoria: draft.categoria,
    data_contratacao: draft.dataContratacao || null, observacoes: draft.observacoes.trim(),
    valor_total: Number(draft.valorTotal),
    entrada: {
      valor: Number(draft.entrada || 0), vencimento: draft.vencimentoEntrada || null,
      forma_pagamento: draft.formaPagamento, chave_pix: draft.chavePix.trim(), dados_transferencia: draft.dadosTransferencia.trim(),
    },
    forma_pagamento: draft.formaPagamento, chave_pix: draft.chavePix.trim(), dados_transferencia: draft.dadosTransferencia.trim(),
    parcelas: draft.parcelas.map((item) => ({ valor: Number(item.valor), vencimento: item.vencimento })),
  }
}

function validateDraft(draft: DebtDraft) {
  if (draft.credor.trim().length < 2) return 'Informe o credor ou beneficiário.'
  if (draft.descricao.trim().length < 2) return 'Informe uma descrição para a dívida.'
  if (amountCents(draft.valorTotal) <= 0) return 'O valor total precisa ser maior que zero.'
  if (amountCents(draft.entrada) < 0 || amountCents(draft.entrada) > amountCents(draft.valorTotal)) return 'Confira o valor da entrada.'
  if (!draft.parcelas.length || draft.parcelas.length > 240) return 'Informe de 1 a 240 parcelas.'
  if (draft.parcelas.some((item) => amountCents(item.valor) <= 0 || !item.vencimento)) return 'Todas as parcelas precisam ter valor positivo e vencimento.'
  const sum = amountCents(draft.entrada) + draft.parcelas.reduce((total, item) => total + amountCents(item.valor), 0)
  if (Math.abs(sum - amountCents(draft.valorTotal)) > 1) return 'A entrada somada às parcelas deve fechar o valor total contratado.'
  if (draft.formaPagamento === 'pix' && !draft.chavePix.trim()) return 'Informe a chave Pix.'
  if (draft.formaPagamento === 'transferencia' && !draft.dadosTransferencia.trim()) return 'Informe os dados bancários para transferência.'
  return ''
}

function toInstallmentDraft(item: DebtInstallment): InstallmentDraft {
  return { valor: String(item.valor), vencimento: item.vencimento || '', formaPagamento: item.forma_pagamento, chavePix: item.chave_pix || '', dadosTransferencia: item.dados_transferencia || '' }
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '')
}
function compactMoney(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
function isLate(item: DebtInstallment) {
  return item.ativo && item.status === 'pendente' && !!item.vencimento && item.vencimento < today()
}
function dueText(item: DebtInstallment) {
  if (item.tipo_item === 'saldo_legado' && !item.vencimento) return 'Vencimento não registrado'
  return `Vencimento ${formatDate(item.vencimento)}`
}
function auditLabel(event: string) {
  const labels: Record<string, string> = {
    divida_migrada: 'Registro legado preservado', divida_criada: 'Dívida cadastrada', dados_divida_atualizados: 'Dados da dívida atualizados',
    parcela_adicionada: 'Parcela adicionada', parcela_atualizada: 'Parcela atualizada', parcela_inativar: 'Parcela inativada',
    parcela_restaurar: 'Parcela restaurada', parcela_reabrir: 'Quitação reaberta', parcela_quitada: 'Parcela quitada',
    documento_pagamento_anexado: 'Documento de pagamento anexado', divida_inativar: 'Dívida inativada', divida_restaurar: 'Dívida restaurada',
  }
  return labels[event] || event.replaceAll('_', ' ')
}
function auditDetailText(details: Record<string, unknown>) {
  return Object.entries(details || {}).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ')
}

export function DebtManagementDashboard({ token }: { token: string }) {
  const [debts, setDebts] = useState<ManagedDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<DebtCategory | 'todas'>('todas')
  const [statusFilter, setStatusFilter] = useState<'todas' | ManagedDebt['status']>('todas')
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<DebtDraft>(blankDebtDraft)
  const [draftError, setDraftError] = useState('')
  const [editingDebt, setEditingDebt] = useState<string | null>(null)
  const [editDebtDraft, setEditDebtDraft] = useState<DebtDraft | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingInstallment, setEditingInstallment] = useState<string | null>(null)
  const [installmentDraft, setInstallmentDraft] = useState<InstallmentDraft | null>(null)
  const [addingInstallment, setAddingInstallment] = useState<string | null>(null)
  const [newInstallmentDraft, setNewInstallmentDraft] = useState<InstallmentDraft>({ valor: '', vencimento: '', formaPagamento: 'outro', chavePix: '', dadosTransferencia: '' })
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [downloading, setDownloading] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState('')

  const reload = useCallback(async (withSpinner = true) => {
    if (withSpinner) setLoading(true)
    setError('')
    try {
      const access = await adminDebtAccess(token)
      if (!access) throw new Error('Esta tela está disponível somente para administradores.')
      const result = await managedDebts(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar as dívidas.')
      setDebts(result.dividas || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a gestão de dívidas.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void reload() }, [reload])

  const visibleDebts = useMemo(() => debts.filter((debt) => {
    if (categoryFilter !== 'todas' && debt.categoria !== categoryFilter) return false
    if (statusFilter !== 'todas' && debt.status !== statusFilter) return false
    const haystack = `${debt.credor} ${debt.descricao} ${categoryLabels[debt.categoria]}`.toLocaleLowerCase('pt-BR')
    return haystack.includes(query.trim().toLocaleLowerCase('pt-BR'))
  }), [debts, categoryFilter, statusFilter, query])

  const metrics = useMemo(() => {
    const active = debts.filter((debt) => debt.status !== 'inativa' && debt.status !== 'quitada')
    const openBalance = debts.filter((debt) => debt.status !== 'inativa').reduce((sum, debt) => sum + Number(debt.saldo_devedor || 0), 0)
    const paid = debts.reduce((sum, debt) => sum + debt.parcelas.filter((item) => item.status === 'paga').reduce((subtotal, item) => subtotal + Number(item.valor || 0), 0), 0)
    const dueItems = debts.flatMap((debt) => debt.parcelas.filter((item) => item.ativo && item.status === 'pendente'))
    const overdue = dueItems.filter(isLate)
    const in30 = dueItems.filter((item) => item.vencimento && item.vencimento >= today() && item.vencimento <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
    return { active: active.length, openBalance, paid, overdueValue: overdue.reduce((sum, item) => sum + Number(item.valor || 0), 0), overdueCount: overdue.length, next30Value: in30.reduce((sum, item) => sum + Number(item.valor || 0), 0) }
  }, [debts])

  const scheduleByMonth = useMemo(() => {
    const start = new Date()
    const firstOfThisMonth = new Date(start.getFullYear(), start.getMonth(), 1)
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() + index, 1)
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
      const amount = debts.filter((debt) => debt.status !== 'inativa').flatMap((debt) => debt.parcelas)
        .filter((item) => item.ativo && item.status === 'pendente' && item.vencimento?.slice(0, 7) === key)
        .reduce((sum, item) => sum + Number(item.valor || 0), 0)
      return { key, label: monthLabel(month), amount }
    })
  }, [debts])
  const maxMonthly = Math.max(1, ...scheduleByMonth.map((item) => item.amount))
  const projectedBalanceByMonth = useMemo(() => {
    let balance = Math.max(0, metrics.openBalance)
    return scheduleByMonth.map((item) => {
      balance = Math.max(0, Math.round((balance - item.amount) * 100) / 100)
      return { ...item, projectedBalance: balance }
    })
  }, [metrics.openBalance, scheduleByMonth])
  const maxProjectedBalance = Math.max(1, metrics.openBalance, ...projectedBalanceByMonth.map((item) => item.projectedBalance))
  const debtEvolutionPoints = projectedBalanceByMonth.map((item, index) => {
    const x = 50 + index * 100
    const y = 105 - (item.projectedBalance / maxProjectedBalance) * 78
    return { ...item, x, y }
  })
  const debtEvolutionPath = debtEvolutionPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  function updateDraft<K extends keyof DebtDraft>(key: K, value: DebtDraft[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value } as DebtDraft
      if (next.modo === 'equal' && ['valorTotal', 'entrada', 'quantidade', 'primeiroVencimento'].includes(String(key))) {
        next.parcelas = equalSchedule(Number(next.quantidade), next.valorTotal, next.entrada, next.primeiroVencimento)
      }
      return next
    })
    setDraftError('')
  }

  function setInstallmentCount(value: string) {
    const count = Math.min(240, Math.max(1, Number(value) || 1))
    setDraft((current) => {
      const calculated = equalSchedule(count, current.valorTotal, current.entrada, current.primeiroVencimento)
      const rows = current.modo === 'equal' ? calculated : Array.from({ length: count }, (_, index) => current.parcelas[index] || calculated[index])
      return { ...current, quantidade: String(count), parcelas: rows }
    })
    setDraftError('')
  }

  function changeMode(mode: ScheduleMode) {
    setDraft((current) => ({
      ...current,
      modo: mode,
      parcelas: mode === 'equal' ? equalSchedule(Number(current.quantidade), current.valorTotal, current.entrada, current.primeiroVencimento) : current.parcelas,
    }))
    setDraftError('')
  }

  function beginEditDebt(debt: ManagedDebt) {
    const base = blankDebtDraft()
    base.credor = debt.credor
    base.categoria = debt.categoria
    base.descricao = debt.descricao
    base.dataContratacao = debt.data_contratacao || ''
    base.observacoes = debt.observacoes || ''
    setEditingDebt(debt.id)
    setEditDebtDraft(base)
  }

  function beginAddInstallment(debt: ManagedDebt) {
    setAddingInstallment(debt.id)
    setNewInstallmentDraft({ valor: '', vencimento: '', formaPagamento: 'outro', chavePix: '', dadosTransferencia: '' })
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function downloadAttachment(id: string) {
    setDownloading(id)
    setError('')
    try {
      const result = await debtAttachmentDownload(token, id)
      if (!result.url) throw new Error('O link temporário não foi retornado.')
      const link = document.createElement('a')
      link.href = result.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.download = result.arquivo_nome || 'documento'
      document.body.append(link)
      link.click()
      link.remove()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível baixar o anexo.')
    } finally {
      setDownloading('')
    }
  }

  async function generateDebtReport(debt: ManagedDebt) {
    setPdfGenerating(debt.id)
    setError('')
    try {
      await downloadManagedDebtPdf(debt)
      setMessage(`Relatório detalhado de ${debt.credor} gerado.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o relatório PDF.')
    } finally {
      setPdfGenerating('')
    }
  }

  async function confirmPending() {
    if (!pending) return
    if ((pending.kind === 'change-debt' || pending.kind === 'change-installment') && pending.action !== 'restaurar' && !pending.reason.trim()) {
      setError(pending.action === 'reabrir' ? 'Informe o motivo para reabrir a quitação.' : 'Informe o motivo para inativar este registro.')
      return
    }
    setSaving(true)
    setError('')
    try {
      let result: { sucesso: boolean; erro?: string } | undefined
      let successMessage = ''
      switch (pending.kind) {
        case 'create': {
          const invalid = validateDraft(pending.draft)
          if (invalid) { setDraftError(invalid); setSaving(false); return }
          result = await createManagedDebt(token, draftPayload(pending.draft))
          successMessage = 'Dívida cadastrada com agenda e auditoria.'
          break
        }
        case 'update-debt': {
          const d = pending.draft
          result = await updateManagedDebt(token, pending.id, { credor: d.credor, descricao: d.descricao, categoria: d.categoria, data_contratacao: d.dataContratacao || null, observacoes: d.observacoes })
          successMessage = 'Dados da dívida atualizados.'
          break
        }
        case 'add-installment': {
          result = await addDebtInstallment(token, pending.debtId, { valor: Number(pending.draft.valor), vencimento: pending.draft.vencimento, forma_pagamento: pending.draft.formaPagamento, chave_pix: pending.draft.chavePix, dados_transferencia: pending.draft.dadosTransferencia })
          successMessage = 'Parcela adicionada ao plano.'
          break
        }
        case 'update-installment': {
          result = await updateDebtInstallment(token, pending.id, { valor: Number(pending.draft.valor), vencimento: pending.draft.vencimento, forma_pagamento: pending.draft.formaPagamento, chave_pix: pending.draft.chavePix, dados_transferencia: pending.draft.dadosTransferencia })
          successMessage = 'Parcela atualizada.'
          break
        }
        case 'settle': {
          result = await settleDebtInstallment(token, pending.id, pending.paidOn, pending.method, pending.reason, pending.proof)
          successMessage = 'Quitação registrada com trilha de auditoria.'
          break
        }
        case 'change-installment': {
          result = await changeDebtInstallment(token, pending.id, pending.action, pending.reason)
          successMessage = pending.action === 'inativar' ? 'Parcela inativada sem apagar o histórico.' : pending.action === 'restaurar' ? 'Parcela restaurada.' : 'Quitação reaberta com motivo registrado.'
          break
        }
        case 'change-debt': {
          result = await changeManagedDebtStatus(token, pending.id, pending.action, pending.reason)
          successMessage = pending.action === 'inativar' ? 'Dívida inativada de forma reversível.' : 'Dívida restaurada.'
          break
        }
        case 'upload-instruction': {
          await uploadDebtPaymentDocument(token, pending.id, pending.file)
          successMessage = 'Documento de pagamento anexado com acesso privado.'
          break
        }
      }
      if (result && !result.sucesso) throw new Error(result.erro || 'A operação não foi concluída.')
      setPending(null)
      setMessage(successMessage)
      setCreateOpen(false)
      setDraft(blankDebtDraft())
      setDraftError('')
      setEditingDebt(null); setEditDebtDraft(null)
      setEditingInstallment(null); setInstallmentDraft(null)
      setAddingInstallment(null)
      await reload(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a operação.')
    } finally {
      setSaving(false)
    }
  }

  function closePending() { if (!saving) setPending(null) }
  function fileLabel(file?: File | null) { return file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'Nenhum arquivo selecionado' }

  return <div className="debt-management-page">
    <PageHeading eyebrow="Controle financeiro · acesso administrativo" title="Gestão de dívidas" description="Organize obrigações, parcelas, vencimentos, formas de pagamento e comprovantes em um único painel auditável." action={<div className="debt-heading-actions"><button className="secondary-button" onClick={() => void reload()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button><button className="primary-button" onClick={() => { setCreateOpen(true); setDraft(blankDebtDraft()); setDraftError(''); setMessage('') }}><Plus size={17} /> Nova dívida</button></div>} />

    {message && <div className="debt-flash success"><Check size={17} />{message}<button aria-label="Fechar aviso" onClick={() => setMessage('')}><X size={15} /></button></div>}
    {error && <div className="debt-flash error"><AlertCircle size={17} />{error}<button aria-label="Fechar aviso" onClick={() => setError('')}><X size={15} /></button></div>}

    {loading ? <LoadingState label="Carregando painel seguro de dívidas…" /> : <>
      <section className="debt-metrics" aria-label="Indicadores da saúde das dívidas">
        <article className="debt-metric gold"><span className="debt-metric-icon"><WalletCards size={19} /></span><div><small>Saldo em dívidas ativas</small><strong>{formatMoney(metrics.openBalance)}</strong><span>{metrics.active} compromisso(s) ativo(s)</span></div></article>
        <article className="debt-metric red"><span className="debt-metric-icon"><CircleAlert size={19} /></span><div><small>Parcelas vencidas</small><strong>{formatMoney(metrics.overdueValue)}</strong><span>{metrics.overdueCount} parcela(s) em atraso</span></div></article>
        <article className="debt-metric blue"><span className="debt-metric-icon"><CalendarClock size={19} /></span><div><small>Vence nos próximos 30 dias</small><strong>{formatMoney(metrics.next30Value)}</strong><span>Parcelas ativas e pendentes</span></div></article>
        <article className="debt-metric green"><span className="debt-metric-icon"><Check size={19} /></span><div><small>Total já quitado</small><strong>{formatMoney(metrics.paid)}</strong><span>Valores de parcelas pagas</span></div></article>
      </section>

      <section className="debt-insights">
        <SectionCard title="Agenda de vencimentos" caption="Pagamentos previstos e evolução estimada do saldo · próximos 6 meses">
          <div className="debt-chart-stack">
            <section className="debt-chart-series" aria-label="Valores mensais previstos">
              <h3><span className="debt-series-symbol debt-series-symbol-bars" />Parcelas previstas para pagamento</h3>
              <div className="debt-chart" role="img" aria-label={`Valores de parcelas pendentes em seis meses: ${scheduleByMonth.map((item) => `${item.label}, ${formatMoney(item.amount)}`).join('; ')}`}>
                {scheduleByMonth.map((item) => <div className="debt-chart-column" key={item.key}>
                  <strong>{item.amount ? formatMoney(item.amount) : '—'}</strong>
                  <div className="debt-chart-track"><span style={{ height: `${Math.max(item.amount ? 8 : 3, Math.round(item.amount / maxMonthly * 100))}%` }} /></div>
                </div>)}
              </div>
            </section>
            <section className="debt-chart-series debt-evolution-series" aria-label="Saldo devedor projetado">
              <h3><span className="debt-series-symbol debt-series-symbol-line" />Saldo devedor projetado após pagamentos previstos</h3>
              <svg className="debt-evolution-chart" viewBox="0 0 600 132" preserveAspectRatio="none" role="img" aria-label={`Projeção condicional do saldo: ${projectedBalanceByMonth.map((item) => `${item.label}, ${formatMoney(item.projectedBalance)}`).join('; ')}`}>
                {[27, 66, 105].map((y) => <line key={y} x1="24" x2="576" y1={y} y2={y} className="debt-evolution-gridline" />)}
                <path d={debtEvolutionPath} className="debt-evolution-path" />
                {debtEvolutionPoints.map((point) => <g key={point.key} className="debt-evolution-point">
                  <text x={point.x} y={Math.max(13, point.y - 10)} textAnchor="middle">{compactMoney(point.projectedBalance)}</text>
                  <circle cx={point.x} cy={point.y} r="4"><title>{point.label}: {formatMoney(point.projectedBalance)} projetados</title></circle>
                </g>)}
              </svg>
            </section>
            <div className="debt-chart-month-legend" aria-label="Meses apresentados nos dois gráficos">
              {scheduleByMonth.map((item) => <span key={item.key}>{item.label}</span>)}
            </div>
            <p className="debt-projection-note">Projeção estimada: considera o pagamento integral das parcelas ativas previstas em cada mês. Atrasos, renegociações e novos lançamentos podem alterar o saldo real.</p>
          </div>
        </SectionCard>
        <SectionCard title="Visão do passivo" caption="Saldo em aberto por natureza · registros inativos excluídos">
          <div className="debt-health-list">
            {(() => {
              const activeDebts = debts.filter((debt) => debt.status !== 'inativa')
              const totalBalance = activeDebts.reduce((sum, debt) => sum + Number(debt.saldo_devedor || 0), 0)
              const pendingReview = debts.filter((debt) => debt.revisao_pendente).length
              return <>
                <div className="debt-health-summary"><span>Exposição ativa</span><strong>{formatMoney(totalBalance)}</strong><small>{activeDebts.length} dívida(s) · {pendingReview} revisão(ões) pendente(s)</small></div>
                <div className="debt-health-breakdown" aria-label="Distribuição do saldo por natureza">
                  {(Object.keys(categoryLabels) as DebtCategory[]).map((category) => {
                    const categoryDebts = activeDebts.filter((debt) => debt.categoria === category)
                    const count = categoryDebts.length
                    const balance = categoryDebts.reduce((sum, debt) => sum + Number(debt.saldo_devedor || 0), 0)
                    const share = totalBalance > 0 ? Math.min(100, balance / totalBalance * 100) : 0
                    return <div className={`debt-health-row cat-${category}`} key={category}><div className="debt-health-row-copy"><span>{categoryLabels[category]}<small>{count} registro(s)</small></span><strong>{formatMoney(balance)}</strong></div><div className="debt-health-track" aria-label={`${share.toFixed(1)}% do saldo total`}><span style={{ width: `${share}%` }} /></div></div>
                  })}
                </div>
                <div className="debt-review-note"><ShieldCheck size={16} /><span>{pendingReview} registro(s) legado(s) aguardam revisão de categoria ou condições.</span></div>
              </>
            })()}
          </div>
        </SectionCard>
      </section>

      {createOpen && <SectionCard title="Cadastrar dívida" caption="Informe os dados econômicos; datas retroativas são permitidas. A data real de inclusão permanece auditada." className="debt-editor-card">
        <form className="debt-form" noValidate onSubmit={(event) => { event.preventDefault(); const invalid = validateDraft(draft); setDraftError(invalid); if (!invalid) setPending({ kind: 'create', draft }) }}>
          <div className="debt-form-section"><h3><span>1</span> Identificação</h3><div className="debt-form-grid">
            <label>Credor / beneficiário<input value={draft.credor} maxLength={180} onChange={(event) => updateDraft('credor', event.target.value)} placeholder="Escritório, órgão, instituição ou pessoa" /></label>
            <label>Natureza da dívida<select value={draft.categoria} onChange={(event) => updateDraft('categoria', event.target.value as DebtCategory)}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="debt-span-two">Descrição<input value={draft.descricao} maxLength={500} onChange={(event) => updateDraft('descricao', event.target.value)} placeholder="Ex.: parcelamento de encargos previdenciários" /></label>
            <label>Data da contratação / origem<input type="date" value={draft.dataContratacao} onChange={(event) => updateDraft('dataContratacao', event.target.value)} /><small>Permite registrar data retroativa.</small></label>
            <label>Observações<textarea rows={3} value={draft.observacoes} onChange={(event) => updateDraft('observacoes', event.target.value)} placeholder="Referência, número do processo, condições negociadas…" /></label>
          </div></div>
          <div className="debt-form-section"><h3><span>2</span> Valor e agenda</h3><div className="debt-form-grid">
            <label>Valor total contratado (R$)<input type="number" min="0.01" step="0.01" value={draft.valorTotal} onChange={(event) => updateDraft('valorTotal', event.target.value)} placeholder="0,00" /></label>
            <label>Entrada (R$)<input type="number" min="0" step="0.01" value={draft.entrada} onChange={(event) => updateDraft('entrada', event.target.value)} placeholder="0,00" /></label>
            <label>Vencimento da entrada<input type="date" value={draft.vencimentoEntrada} onChange={(event) => updateDraft('vencimentoEntrada', event.target.value)} /><small>Opcional; pode ser retroativo.</small></label>
            <label>Quantidade de parcelas<input type="number" min="1" max="240" value={draft.quantidade} onChange={(event) => setInstallmentCount(event.target.value)} /></label>
            <label>Primeiro vencimento<input type="date" value={draft.primeiroVencimento} onChange={(event) => updateDraft('primeiroVencimento', event.target.value)} /></label>
            <label>Distribuição<select value={draft.modo} onChange={(event) => changeMode(event.target.value as ScheduleMode)}><option value="equal">Parcelas com mesmo valor</option><option value="custom">Editar valores individualmente</option></select></label>
          </div>
          <div className="debt-schedule-summary"><div><small>Entrada</small><strong>{formatMoney(Number(draft.entrada || 0))}</strong></div><div><small>Parcelas</small><strong>{draft.parcelas.length}</strong></div><div><small>Total calculado</small><strong>{formatMoney((amountCents(draft.entrada) + draft.parcelas.reduce((sum, item) => sum + amountCents(item.valor), 0)) / 100)}</strong></div><div><small>Valor contratado</small><strong>{formatMoney(Number(draft.valorTotal || 0))}</strong></div></div>
          {draft.modo === 'custom' && <div className="debt-schedule-editor"><div className="debt-schedule-heading"><strong>Valores e vencimentos por parcela</strong><span>Ajuste cada linha; a soma precisa fechar o valor contratado.</span></div><div className="debt-schedule-rows">{draft.parcelas.map((item, index) => <div className="debt-schedule-row" key={index}><strong>Parcela {index + 1}</strong><label>Valor<input type="number" min="0.01" step="0.01" value={item.valor} onChange={(event) => setDraft((current) => ({ ...current, parcelas: current.parcelas.map((row, rowIndex) => rowIndex === index ? { ...row, valor: event.target.value } : row) }))} /></label><label>Vencimento<input type="date" value={item.vencimento} onChange={(event) => setDraft((current) => ({ ...current, parcelas: current.parcelas.map((row, rowIndex) => rowIndex === index ? { ...row, vencimento: event.target.value } : row) }))} /></label></div>)}</div></div>}
          </div>
          <div className="debt-form-section"><h3><span>3</span> Instruções de pagamento</h3><div className="debt-form-grid">
            <label>Forma de pagamento<select value={draft.formaPagamento} onChange={(event) => updateDraft('formaPagamento', event.target.value as DebtPaymentMethod)}>{Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>Aplicada às parcelas; pode ser ajustada em cada uma.</small></label>
            {draft.formaPagamento === 'pix' && <label>Chave Pix<input value={draft.chavePix} onChange={(event) => updateDraft('chavePix', event.target.value)} placeholder="Chave Pix do beneficiário" /></label>}
            {draft.formaPagamento === 'transferencia' && <label className="debt-span-two">Dados bancários<textarea rows={2} value={draft.dadosTransferencia} onChange={(event) => updateDraft('dadosTransferencia', event.target.value)} placeholder="Banco, agência, conta, titular e documento" /></label>}
            {draft.formaPagamento === 'boleto' && <div className="debt-form-note debt-span-two"><FilePlus2 size={17} /><span>Após salvar, anexe o boleto à parcela correspondente. Arquivos ficam no Storage privado e são baixados por link temporário.</span></div>}
          </div></div>
          {draftError && <div className="debt-inline-error"><AlertCircle size={16} />{draftError}</div>}
          <div className="debt-form-actions"><button type="button" className="secondary-button" onClick={() => { setCreateOpen(false); setDraftError('') }}>Cancelar</button><button type="submit" className="primary-button"><ShieldCheck size={16} /> Revisar e confirmar cadastro</button></div>
        </form>
      </SectionCard>}

      <section className="debt-list-section">
        <div className="debt-list-heading"><div><span className="eyebrow">Carteira de obrigações</span><h2>Dívidas e parcelamentos</h2><p>{visibleDebts.length} de {debts.length} registro(s) · alterações somente por administradores</p></div></div>
        <div className="debt-filters">
          <label className="debt-search"><Search size={17} /><input aria-label="Buscar dívida" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por credor ou descrição" /></label>
          <label>Natureza<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as DebtCategory | 'todas')}><option value="todas">Todas</option>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="todas">Todos</option><option value="ativa">Ativas</option><option value="renegociada">Renegociadas</option><option value="quitada">Quitadas</option><option value="inativa">Inativas</option></select></label>
        </div>
        {visibleDebts.length === 0 ? <EmptyState title={debts.length ? 'Nenhuma dívida neste filtro' : 'Ainda não há dívidas cadastradas'} description={debts.length ? 'Altere os filtros ou a busca.' : 'Cadastre uma dívida para acompanhar saldo, parcelas, vencimentos e comprovantes.'} /> : <div className="debt-record-list">
          {visibleDebts.map((debt) => {
            const expandedRecord = expanded.has(debt.id)
            const nextInstallment = debt.parcelas.filter((item) => item.ativo && item.status === 'pendente' && item.vencimento).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))[0]
            const lateCount = debt.parcelas.filter(isLate).length
            return <article className={`debt-record ${debt.status === 'inativa' ? 'is-inactive' : ''}`} key={debt.id}>
              <div className="debt-record-main">
                <div className="debt-record-copy"><div className="debt-record-tags"><span className={`debt-category-chip cat-${debt.categoria}`}>{categoryLabels[debt.categoria]}</span><StatusPill value={statusLabels[debt.status]} />{debt.revisao_pendente && <span className="debt-review-chip"><CircleAlert size={13} /> Revisar legado</span>}{debt.origem_legada && <span className="debt-legacy-chip">Migrado · {debt.origem_legada}</span>}</div><h3>{debt.credor}</h3><p>{debt.descricao}</p><small>{debt.data_contratacao ? `Origem ${formatDate(debt.data_contratacao)}` : 'Data de origem não informada'} · {debt.parcelas.length} item(ns) de agenda</small></div>
                <div className="debt-record-amounts"><div><small>Saldo em aberto</small><strong>{formatMoney(debt.saldo_devedor)}</strong></div><div><small>Valor original</small><strong>{formatMoney(debt.valor_original)}</strong></div><div className={lateCount ? 'has-late' : ''}><small>{lateCount ? 'Parcelas vencidas' : 'Próximo vencimento'}</small><strong>{lateCount ? `${lateCount} em atraso` : nextInstallment ? formatDate(nextInstallment.vencimento) : '—'}</strong></div></div>
                <div className="debt-record-controls" role="group" aria-label={`Ações para ${debt.credor}`}>
                  <button type="button" className={`secondary-button debt-action debt-action-expand ${expandedRecord ? 'is-active' : ''}`} onClick={() => toggleExpanded(debt.id)} aria-expanded={expandedRecord}><ChevronDown size={15} className={expandedRecord ? 'rotated' : ''} /> {expandedRecord ? 'Ocultar parcelas' : 'Ver parcelas'}</button>
                  <button type="button" className="secondary-button debt-action debt-action-edit" aria-label="Editar dados da dívida" disabled={debt.status === 'inativa'} onClick={() => beginEditDebt(debt)}><Pencil size={14} /> Editar</button>
                  <button type="button" className="secondary-button debt-action debt-action-pdf" onClick={() => void generateDebtReport(debt)} disabled={pdfGenerating === debt.id} aria-label={`Gerar relatório PDF de ${debt.credor}`}><FileText size={14} /> {pdfGenerating === debt.id ? 'Gerando PDF…' : 'Gerar PDF'}</button>
                  <button type="button" className={`secondary-button debt-action ${debt.status === 'inativa' ? 'debt-action-restore' : 'debt-action-inactivate'}`} onClick={() => setPending({ kind: 'change-debt', id: debt.id, action: debt.status === 'inativa' ? 'restaurar' : 'inativar', reason: '' })}>{debt.status === 'inativa' ? <><RotateCcw size={14} /> Restaurar</> : <><X size={14} /> Inativar</>}</button>
                </div>
              </div>
              {debt.status === 'inativa' && <div className="debt-inactive-banner"><AlertCircle size={15} />Registro inativo · saldo e histórico preservados; não entra nos totais ativos.</div>}
              {editingDebt === debt.id && editDebtDraft && <form className="debt-inline-editor" noValidate onSubmit={(event) => { event.preventDefault(); setPending({ kind: 'update-debt', id: debt.id, draft: editDebtDraft }) }}><h4>Editar dados da dívida</h4><div className="debt-form-grid"><label>Credor<input value={editDebtDraft.credor} onChange={(event) => setEditDebtDraft({ ...editDebtDraft, credor: event.target.value })} /></label><label>Natureza<select value={editDebtDraft.categoria} onChange={(event) => setEditDebtDraft({ ...editDebtDraft, categoria: event.target.value as DebtCategory })}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="debt-span-two">Descrição<input value={editDebtDraft.descricao} onChange={(event) => setEditDebtDraft({ ...editDebtDraft, descricao: event.target.value })} /></label><label>Data de contratação<input type="date" value={editDebtDraft.dataContratacao} onChange={(event) => setEditDebtDraft({ ...editDebtDraft, dataContratacao: event.target.value })} /></label><label className="debt-span-two">Observações<textarea rows={2} value={editDebtDraft.observacoes} onChange={(event) => setEditDebtDraft({ ...editDebtDraft, observacoes: event.target.value })} /></label></div><div className="debt-form-actions"><button type="button" className="secondary-button" onClick={() => { setEditingDebt(null); setEditDebtDraft(null) }}>Cancelar</button><button type="submit" className="primary-button">Revisar alteração</button></div></form>}
              {expandedRecord && <div className="debt-installments-panel">
                <div className="debt-installments-heading"><div><h4>Agenda de pagamento</h4><p>Inativar preserva o saldo e a trilha; quitar registra data, meio e comprovante.</p></div>{debt.status !== 'inativa' && debt.modelo_agenda !== 'legado' && <button className="secondary-button" onClick={() => beginAddInstallment(debt)}><Plus size={15} /> Adicionar parcela</button>}</div>
                {debt.observacoes && <div className="debt-note"><strong>Observações</strong><span>{debt.observacoes}</span></div>}
                {debt.parcelas.length === 0 ? <EmptyState title="Sem agenda detalhada" description="Este registro legado não possui parcelas associadas." /> : <div className="debt-installments-list">{debt.parcelas.map((item) => {
                  const attachments = item.arquivos || []
                  const isBeingEdited = editingInstallment === item.id && installmentDraft
                  return <div className={`debt-installment ${isLate(item) ? 'is-late' : ''} ${!item.ativo ? 'is-disabled' : ''}`} key={item.id}>
                    <div className="debt-installment-top"><div><span className="debt-installment-number">{item.tipo_item === 'entrada' ? 'Entrada' : item.tipo_item === 'saldo_legado' ? 'Saldo legado' : `Parcela ${item.numero}`}</span><strong>{formatMoney(item.valor)}</strong></div><div className="debt-installment-status"><StatusPill value={!item.ativo ? 'Inativa' : item.status === 'paga' ? 'Paga' : isLate(item) ? 'Vencida' : 'Pendente'} /><small>{item.status === 'paga' ? `Paga em ${formatDate(item.pago_em)}` : dueText(item)}</small></div></div>
                    <div className="debt-payment-details"><span><Banknote size={14} />{paymentLabels[item.forma_pagamento]}</span>{item.forma_pagamento === 'pix' && item.chave_pix && <span className="debt-payment-value">Chave Pix: {item.chave_pix}</span>}{item.forma_pagamento === 'transferencia' && item.dados_transferencia && <span className="debt-payment-value">{item.dados_transferencia}</span>}</div>
                    {attachments.length > 0 && <div className="debt-attachment-list">{attachments.map((file) => <button className="debt-file-link" key={file.id} onClick={() => void downloadAttachment(file.id)} disabled={downloading === file.id}><ArrowDownToLine size={14} />{downloading === file.id ? 'Preparando…' : file.arquivo_nome}<small>{file.tipo === 'documento_pagamento' ? 'Instrução / boleto' : 'Comprovante'}</small></button>)}</div>}
                    {item.legacy_comprovante_nome && <div className="debt-legacy-proof"><AlertCircle size={14} />Comprovante legado registrado como “{item.legacy_comprovante_nome}”; a referência original foi preservada.</div>}
                    {isBeingEdited && <form className="debt-inline-editor" noValidate onSubmit={(event) => { event.preventDefault(); setPending({ kind: 'update-installment', id: item.id, draft: installmentDraft }) }}><h5>Editar parcela pendente</h5><InstallmentFields draft={installmentDraft} onChange={setInstallmentDraft} allowNoDueDate={item.tipo_item === 'entrada' || item.tipo_item === 'saldo_legado'} /><div className="debt-form-actions"><button type="button" className="secondary-button" onClick={() => { setEditingInstallment(null); setInstallmentDraft(null) }}>Cancelar</button><button type="submit" className="primary-button">Revisar atualização</button></div></form>}
                    {addingInstallment === debt.id && <form className="debt-inline-editor" noValidate onSubmit={(event) => { event.preventDefault(); if (amountCents(newInstallmentDraft.valor) <= 0 || !newInstallmentDraft.vencimento) { setError('Informe um valor positivo e o vencimento da parcela.'); return } setPending({ kind: 'add-installment', debtId: debt.id, draft: newInstallmentDraft }) }}><h5>Adicionar parcela</h5><InstallmentFields draft={newInstallmentDraft} onChange={setNewInstallmentDraft} /><div className="debt-form-actions"><button type="button" className="secondary-button" onClick={() => setAddingInstallment(null)}>Cancelar</button><button type="submit" className="primary-button">Revisar parcela</button></div></form>}
                    <div className="debt-installment-actions">
                      {debt.status !== 'inativa' && item.status === 'pendente' && item.ativo && <><button className="primary-button debt-pay-button" onClick={() => setPending({ kind: 'settle', id: item.id, paidOn: today(), method: item.forma_pagamento, reason: '', proof: null })}><Check size={15} /> Registrar quitação</button><button className="secondary-button" onClick={() => { setEditingInstallment(item.id); setInstallmentDraft(toInstallmentDraft(item)) }}>Editar parcela</button><label className="secondary-button debt-upload-button"><FilePlus2 size={15} /> Anexar boleto<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPending({ kind: 'upload-instruction', id: item.id, file }); event.currentTarget.value = '' }} /></label>{item.ativo && <button className="text-button danger" onClick={() => setPending({ kind: 'change-installment', id: item.id, action: 'inativar', reason: '' })}>Inativar parcela</button>}</>}
                      {debt.status !== 'inativa' && item.status === 'pendente' && !item.ativo && <button className="secondary-button" onClick={() => setPending({ kind: 'change-installment', id: item.id, action: 'restaurar', reason: '' })}><RotateCcw size={14} /> Restaurar parcela</button>}
                      {debt.status !== 'inativa' && item.status === 'paga' && <button className="secondary-button" onClick={() => setPending({ kind: 'change-installment', id: item.id, action: 'reabrir', reason: '' })}>Reabrir quitação</button>}
                    </div>
                  </div>
                })}</div>}
                <div className="debt-audit-panel"><div className="debt-audit-heading"><div><History size={16} /><h4>Trilha de auditoria</h4></div><span>{debt.auditoria?.length || 0} evento(s)</span></div>{debt.auditoria?.length ? <ol className="debt-audit-list">{debt.auditoria.map((entry) => <li key={entry.id}><span className="debt-audit-marker" /><div><strong>{auditLabel(entry.evento)}</strong><small>{entry.usuario_nome || 'Administrador'} · {new Date(entry.created_at).toLocaleString('pt-BR')}</small>{auditDetailText(entry.detalhes || {}) && <p>{auditDetailText(entry.detalhes || {})}</p>}</div></li>)}</ol> : <p className="debt-audit-empty">Nenhuma alteração registrada para este item.</p>}</div>
              </div>}
            </article>
          })}
        </div>}
      </section>
    </>}

    {pending && <ConfirmationModal
      title={pending.kind === 'create' ? 'Confirmar cadastro da dívida' : pending.kind === 'update-debt' ? 'Confirmar alteração da dívida' : pending.kind === 'add-installment' ? 'Confirmar nova parcela' : pending.kind === 'update-installment' ? 'Confirmar atualização da parcela' : pending.kind === 'settle' ? 'Confirmar quitação' : pending.kind === 'upload-instruction' ? 'Confirmar anexo do documento' : pending.kind === 'change-debt' ? pending.action === 'inativar' ? 'Inativar dívida' : 'Restaurar dívida' : pending.action === 'reabrir' ? 'Reabrir quitação' : pending.action === 'inativar' ? 'Inativar parcela' : 'Restaurar parcela'}
      description={pending.kind === 'create' ? 'A dívida e sua agenda serão salvas no banco. A ação será registrada na auditoria.' : pending.kind === 'settle' ? 'A parcela será marcada como paga na data informada; o comprovante, se enviado, ficará privado.' : pending.kind === 'upload-instruction' ? 'O arquivo será enviado ao Storage privado e associado à parcela selecionada.' : pending.kind === 'change-debt' || pending.kind === 'change-installment' ? 'O histórico não será apagado. A alteração ficará registrada com o motivo informado quando aplicável.' : 'Revise os dados: a alteração será persistida e auditada no Supabase.'}
      confirmLabel={pending.kind === 'change-debt' && pending.action === 'inativar' || pending.kind === 'change-installment' && pending.action === 'inativar' ? 'Inativar' : pending.kind === 'settle' ? 'Registrar pagamento' : pending.kind === 'upload-instruction' ? 'Enviar documento' : 'Confirmar e salvar'}
      busy={saving}
      onCancel={closePending}
      onConfirm={() => void confirmPending()}
    >
      {pending.kind === 'create' && <div className="debt-confirm-summary"><span>{pending.draft.credor || 'Credor'} · {categoryLabels[pending.draft.categoria]}</span><strong>{formatMoney(Number(pending.draft.valorTotal || 0))}</strong><small>{formatMoney(Number(pending.draft.entrada || 0))} de entrada + {pending.draft.parcelas.length} parcela(s) · {paymentLabels[pending.draft.formaPagamento]}</small></div>}
      {pending.kind === 'settle' && <div className="debt-confirm-fields"><label>Data efetiva do pagamento<input type="date" value={pending.paidOn} onChange={(event) => setPending({ ...pending, paidOn: event.target.value })} /></label><label>Forma de pagamento<select value={pending.method} onChange={(event) => setPending({ ...pending, method: event.target.value as DebtPaymentMethod })}>{Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Observação opcional<input value={pending.reason} onChange={(event) => setPending({ ...pending, reason: event.target.value })} placeholder="Referência da baixa" /></label><label className="debt-modal-file">Comprovante de pagamento<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setPending({ ...pending, proof: event.target.files?.[0] || null })} /><small>{fileLabel(pending.proof)}</small></label></div>}
      {pending.kind === 'upload-instruction' && <div className="debt-confirm-summary"><span>Arquivo selecionado</span><strong>{pending.file.name}</strong><small>{(pending.file.size / 1024).toFixed(0)} KB · arquivo privado</small></div>}
      {(pending.kind === 'change-debt' || pending.kind === 'change-installment') && pending.action === 'inativar' && <div className="debt-confirm-fields"><label>Motivo da alteração<input value={pending.reason} onChange={(event) => setPending({ ...pending, reason: event.target.value })} placeholder="Informe o motivo para auditoria" /></label><small>O motivo é obrigatório e ficará no histórico.</small></div>}
      {pending.kind === 'change-installment' && pending.action === 'reabrir' && <div className="debt-confirm-fields"><label>Motivo para reabrir<input value={pending.reason} onChange={(event) => setPending({ ...pending, reason: event.target.value })} placeholder="Ex.: baixa lançada por engano" /></label></div>}
      {(pending.kind === 'change-debt' || pending.kind === 'change-installment') && pending.action !== 'restaurar' && <p className="debt-confirm-warning">A operação é reversível, mas não altera nem elimina documentos já registrados.</p>}
    </ConfirmationModal>}
  </div>
}

function InstallmentFields({ draft, onChange, allowNoDueDate = false }: { draft: InstallmentDraft; onChange: (draft: InstallmentDraft) => void; allowNoDueDate?: boolean }) {
  return <div className="debt-form-grid"><label>Valor (R$)<input type="number" min="0.01" step="0.01" value={draft.valor} onChange={(event) => onChange({ ...draft, valor: event.target.value })} /></label><label>Vencimento<input type="date" value={draft.vencimento} onChange={(event) => onChange({ ...draft, vencimento: event.target.value })} />{allowNoDueDate && <small>Opcional para saldos legados sem data registrada.</small>}</label><label>Forma de pagamento<select value={draft.formaPagamento} onChange={(event) => onChange({ ...draft, formaPagamento: event.target.value as DebtPaymentMethod })}>{Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{draft.formaPagamento === 'pix' && <label>Chave Pix<input value={draft.chavePix} onChange={(event) => onChange({ ...draft, chavePix: event.target.value })} /></label>}{draft.formaPagamento === 'transferencia' && <label className="debt-span-two">Dados bancários<textarea rows={2} value={draft.dadosTransferencia} onChange={(event) => onChange({ ...draft, dadosTransferencia: event.target.value })} /></label>}</div>
}
