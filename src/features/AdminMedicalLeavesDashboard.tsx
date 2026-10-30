import { useEffect, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Eye, RefreshCw, X } from 'lucide-react'
import { adminMedicalLeavesPage, decideMedicalLeave } from '../lib/api'
import type { AdminMedicalLeaveDashboardSummary, AdminMedicalLeaveRow } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, SectionCard, StatusPill, formatDate } from '../components/ui'
import { AuditTimeline, openSecureDocument } from './MedicalLeavesWorkflow'
import './medical-leaves.css'

const PAGE_SIZE = 30
type StatusFilter = 'todos' | 'pendentes' | 'aceitos' | 'recusados'

const emptySummary: AdminMedicalLeaveDashboardSummary = {
  total: 0,
  pendentes: 0,
  aceitos: 0,
  recusados: 0,
}

function currentLocalMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function isPending(row: AdminMedicalLeaveRow) {
  return ['aguardando', 'pendente', 'em_analise'].includes(row.status.trim().toLowerCase())
}

function periodLabel(month: string) {
  if (!month) return 'Todo o histórico'
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export function AdminMedicalLeavesDashboard({ token, onRefresh }: { token: string; onRefresh: () => Promise<void> }) {
  const [month, setMonth] = useState(currentLocalMonth)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [page, setPage] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [rows, setRows] = useState<AdminMedicalLeaveRow[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<AdminMedicalLeaveDashboardSummary>(emptySummary)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function loadPage() {
      setLoading(true)
      setError('')
      try {
        const result = await adminMedicalLeavesPage(token, month, statusFilter, page * PAGE_SIZE, PAGE_SIZE)
        if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar os atestados da empresa.')
        if (!active) return
        setRows(result.atestados || [])
        setTotal(result.total || 0)
        setSummary(result.resumo || emptySummary)
        if (page > 0 && result.total <= page * PAGE_SIZE) {
          setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1))
        }
      } catch (err) {
        if (!active) return
        setRows([])
        setTotal(0)
        setSummary(emptySummary)
        setError(err instanceof Error ? err.message : 'Falha ao carregar a visão de atestados.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadPage()
    return () => { active = false }
  }, [token, month, statusFilter, page, refreshKey])

  async function decide(row: AdminMedicalLeaveRow, status: 'aceito' | 'recusado') {
    const reason = (reasons[row.id] || '').trim()
    if (status === 'recusado' && reason.length < 5) {
      setError('Para recusar, informe uma justificativa com pelo menos 5 caracteres.')
      return
    }
    setBusyId(row.id)
    setError('')
    setMessage('')
    try {
      const result = await decideMedicalLeave(token, row.id, status, reason)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar a decisão.')
      setMessage(status === 'aceito' ? 'Atestado aceito; a decisão foi registrada na auditoria.' : 'Atestado recusado; a justificativa foi registrada na auditoria.')
      setReasons((current) => ({ ...current, [row.id]: '' }))
      await onRefresh()
      setRefreshKey((current) => current + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a decisão.')
    } finally {
      setBusyId('')
    }
  }

  async function viewDocument(id: string) {
    setError('')
    try {
      await openSecureDocument(token, id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o documento.')
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstRecord = total === 0 ? 0 : page * PAGE_SIZE + 1
  const lastRecord = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <SectionCard title="Saúde e gestão de atestados" caption="Visão de todos os funcionários da empresa; CID e documentos só são exibidos a administradores autorizados.">
      <div className="medical-dashboard-grid">
        <article className="medical-dashboard-card"><span>Atestados no período</span><strong>{summary.total}</strong><small>{periodLabel(month)}</small></article>
        <article className="medical-dashboard-card is-pending"><span>Pendentes de análise</span><strong>{summary.pendentes}</strong><small>Precisam de decisão do RH</small></article>
        <article className="medical-dashboard-card is-approved"><span>Aceitos</span><strong>{summary.aceitos}</strong><small>Decisão registrada</small></article>
        <article className="medical-dashboard-card is-rejected"><span>Recusados</span><strong>{summary.recusados}</strong><small>Justificativa disponível</small></article>
      </div>

      <div className="medical-admin-controls">
        <label>Mês da consulta
          <span className="medical-month-control"><CalendarDays size={15} /><input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPage(0) }} /></span>
        </label>
        <button className="secondary-button" type="button" onClick={() => { setMonth(''); setPage(0) }}>Todos os meses</button>
        <label>Situação
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setPage(0) }}>
            <option value="todos">Todas</option>
            <option value="pendentes">Pendentes</option>
            <option value="aceitos">Aceitos</option>
            <option value="recusados">Recusados</option>
          </select>
        </label>
        <button className="secondary-button medical-refresh-button" type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}><RefreshCw size={15} /> Atualizar</button>
      </div>
      <p className="medical-period-note">Filtro por mês da consulta: <strong>{periodLabel(month)}</strong>. Os indicadores resumem todos os status do período; a tabela respeita também o filtro de situação.</p>

      {error && <ErrorState message={error} />}
      {message && <div className="medical-inline-success" role="status">{message}</div>}
      {loading ? <LoadingState label="Carregando resumo e atestados da empresa…" /> : rows.length === 0 ? (
        <EmptyState title={statusFilter === 'todos' ? 'Nenhum atestado neste período' : `Nenhum atestado ${statusFilter} neste período`} description="Altere o mês ou o filtro de situação para consultar outros registros." />
      ) : (
        <div className="medical-record-list">
          {rows.map((row) => (
            <article className="medical-record-card" key={row.id}>
              <div className="medical-record-heading">
                <div><strong>{row.nome} · {row.tipo}</strong><small>Consulta em {formatDate(row.data_atendimento)} · {row.dias} dia(s) de afastamento · enviado em {formatDate(row.created_at)}</small></div>
                <StatusPill value={row.status_label || row.status} />
              </div>
              <div className="medical-record-meta">
                <span><b>CID:</b> {row.cid || 'Não informado'}</span>
                <span><b>Arquivo:</b> {row.arquivo_nome || 'Anexo enviado'}</span>
              </div>
              {row.observacao && <div className="medical-review-result"><strong>Observação do funcionário</strong><p>{row.observacao}</p></div>}
              {row.observacao_rh && <div className="medical-review-result"><strong>Retorno do RH / motivo da recusa</strong><p>{row.observacao_rh}</p></div>}
              <button className="secondary-button medical-open-file" type="button" onClick={() => void viewDocument(row.id)}><Eye size={16} /> Abrir anexo privado</button>
              <details className="medical-audit-details">
                <summary><Clock size={15} /> Auditoria ({row.timeline?.length || 0})</summary>
                <AuditTimeline events={row.timeline} />
              </details>
              {isPending(row) && (
                <div className="medical-decision-form">
                  <label>Justificativa / observação da análise
                    <textarea rows={3} maxLength={1000} value={reasons[row.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Obrigatória para recusar; ficará visível ao funcionário" />
                  </label>
                  <div className="medical-decision-actions">
                    <button className="primary-button" type="button" disabled={busyId === row.id} onClick={() => void decide(row, 'aceito')}><Check size={16} /> Aceitar</button>
                    <button className="secondary-button danger-button" type="button" disabled={busyId === row.id} onClick={() => void decide(row, 'recusado')}><X size={16} /> Recusar</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="medical-pagination" aria-live="polite">
        <span>{firstRecord}–{lastRecord} de {total} registro(s)</span>
        <div>
          <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || loading}><ChevronLeft size={15} /> Anterior</button>
          <span>Página {page + 1} de {pageCount}</span>
          <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1 || loading}>Próxima <ChevronRight size={15} /></button>
        </div>
      </div>
    </SectionCard>
  )
}
