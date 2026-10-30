import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, X } from 'lucide-react'
import { adminRequestsPage, answerRequest } from '../lib/api'
import type { AdminRequestRow, AdminRequestsSummary, EmployeeRow } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, SectionCard, StatusPill, formatDate } from '../components/ui'
import './hr-requests.css'

const pageSize = 30
const requestTypes = ['Dúvida ao RH', 'Correção cadastral', 'Solicitação de férias', 'Solicitação de documento', 'Benefício', 'Outro assunto']
const statusOptions = [
  ['todos', 'Todos os status'],
  ['pendentes', 'Aguardando RH'],
  ['em_analise', 'Em análise'],
  ['atendidas', 'Atendidas / aprovadas'],
  ['recusadas', 'Recusadas'],
  ['canceladas', 'Canceladas'],
] as const

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pendente: 'Aguardando RH', aberta: 'Aguardando RH', nova: 'Aguardando RH',
    em_analise: 'Em análise', atendida: 'Atendida', concluida: 'Concluída', aprovada: 'Atendida',
    recusada: 'Recusada', reprovada: 'Recusada', cancelada: 'Cancelada',
  }
  return labels[status] || status.replaceAll('_', ' ')
}

function eventLabel(evento: string, novoStatus: string) {
  if (evento === 'solicitacao_aberta') return 'Solicitação recebida'
  if (evento === 'status_alterado') return `Status atualizado para ${statusLabel(novoStatus)}`
  if (evento === 'resposta_atualizada') return 'Resposta atualizada'
  return 'Histórico anterior registrado'
}

export function AdminHRRequestsDashboard({ token, employees, onRefresh }: { token: string; employees: EmployeeRow[]; onRefresh: () => Promise<void> }) {
  const [rows, setRows] = useState<AdminRequestRow[]>([])
  const [summary, setSummary] = useState<AdminRequestsSummary>({ total: 0, pendentes: 0, em_analise: 0, abertas: 0, atendidas: 0, recusadas: 0, canceladas: 0 })
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [month, setMonth] = useState('')
  const [status, setStatus] = useState('todos')
  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await adminRequestsPage(token, month || null, status, employeeId || null, type || null, offset, pageSize)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar as solicitações do RH')
      setRows(result.solicitacoes || [])
      setSummary(result.resumo || { total: 0, pendentes: 0, em_analise: 0, abertas: 0, atendidas: 0, recusadas: 0, canceladas: 0 })
      setTotal(result.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar solicitações')
    } finally {
      setLoading(false)
    }
  }, [token, month, status, employeeId, type, offset, revision])

  useEffect(() => { void load() }, [load])

  async function decide(row: AdminRequestRow, nextStatus: 'em_analise' | 'atendida' | 'recusada') {
    const response = (reply[row.id] || '').trim()
    if (nextStatus !== 'em_analise' && response.length < 5) {
      setError(nextStatus === 'recusada' ? 'A justificativa da recusa é obrigatória (mínimo de 5 caracteres).' : 'Informe uma resposta ao funcionário (mínimo de 5 caracteres).')
      return
    }
    setSavingId(row.id)
    setError('')
    setMessage('')
    try {
      const result = await answerRequest(token, row.id, nextStatus, response)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar a solicitação')
      setMessage(nextStatus === 'em_analise' ? 'Solicitação marcada como em análise.' : nextStatus === 'atendida' ? 'Solicitação atendida e registrada no histórico.' : 'Solicitação recusada com justificativa registrada.')
      setReply((current) => ({ ...current, [row.id]: '' }))
      await onRefresh()
      setRevision((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar solicitação')
    } finally {
      setSavingId('')
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.floor(offset / pageSize) + 1
  const metricCards = [
    { label: 'No período', value: summary.total, tone: 'total' },
    { label: 'Em aberto', value: summary.abertas, tone: 'open' },
    { label: 'Aguardando RH', value: summary.pendentes, tone: 'pending' },
    { label: 'Em análise', value: summary.em_analise, tone: 'review' },
    { label: 'Atendidas', value: summary.atendidas, tone: 'done' },
    { label: 'Recusadas', value: summary.recusadas, tone: 'rejected' },
  ]

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value)
    setOffset(0)
    setMessage('')
  }

  return <div className="hr-requests-dashboard">
    <div className="hr-request-dashboard-intro"><div><span className="hr-request-eyebrow">Departamento pessoal · gestão</span><h2>Gestão de solicitações</h2><p>Acompanhe o volume, priorize os pedidos em aberto e registre respostas para cada funcionário.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button></div>

    <div className="hr-request-metrics admin-request-metrics" aria-label="Indicadores de solicitações">
      {metricCards.map((metric) => <div className={`hr-request-metric is-${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
    </div>

    {error && <ErrorState message={error} />}
    {message && <div className="form-success hr-request-feedback"><Check size={16} />{message}</div>}

    <SectionCard title="Filtros" caption="Indicadores e resultados respeitam a competência e o escopo da empresa">
      <div className="hr-request-filters">
        <label>Competência<input type="month" value={month} onChange={(event) => changeFilter(setMonth, event.target.value)} /><small>Em branco: todo o histórico</small></label>
        <label>Funcionário<select value={employeeId} onChange={(event) => changeFilter(setEmployeeId, event.target.value)}><option value="">Todos os funcionários</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome}</option>)}</select></label>
        <label>Tipo<select value={type} onChange={(event) => changeFilter(setType, event.target.value)}><option value="">Todos os tipos</option>{requestTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => changeFilter(setStatus, event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="secondary-button hr-request-reset" type="button" onClick={() => { setMonth(''); setEmployeeId(''); setType(''); setStatus('todos'); setOffset(0); setMessage('') }}><Search size={15} /> Ver tudo</button>
      </div>
    </SectionCard>

    <SectionCard title="Solicitações recebidas" caption={`${total} resultado(s) no filtro atual · pendências aparecem primeiro`}>
      {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="Nenhuma solicitação encontrada" description="Ajuste os filtros ou aguarde novos pedidos dos funcionários." /> : <div className="hr-request-list admin-hr-request-list">
        {rows.map((row) => <article className="hr-request-card admin-hr-request-card" key={row.id}>
          <div className="hr-request-card-head">
            <div className="hr-request-card-title"><span className="hr-request-kind">{row.nome} <span className="hr-request-separator">·</span> {row.tipo}</span><small>Enviada em {formatDate(row.created_at)}</small></div>
            <StatusPill value={statusLabel(row.status)} />
          </div>
          <p className="hr-request-description">{row.descricao}</p>
          {row.anexo_nome && <div className="hr-request-attachment">Documento vinculado: <strong>{row.anexo_nome}</strong></div>}
          {row.resposta && <div className={`hr-request-answer ${['recusada', 'reprovada'].includes(row.status) ? 'is-rejected' : ''}`}><strong>Último retorno ao funcionário</strong><p>{row.resposta}</p>{row.analisado_em && <small>Atualizado em {formatDate(row.analisado_em)}</small>}</div>}

          {['pendente', 'aberta', 'nova', 'em_analise'].includes(row.status) && <div className="hr-request-review">
            <label>Resposta ao funcionário{row.status === 'pendente' && <small> · obrigatória para atender ou recusar</small>}
              <textarea rows={3} maxLength={2000} value={reply[row.id] || ''} onChange={(event) => setReply((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Escreva a orientação, a confirmação ou a justificativa da decisão." />
            </label>
            <div className="hr-request-actions">
              <button className="secondary-button" type="button" disabled={savingId === row.id} onClick={() => void decide(row, 'em_analise')}><Clock3 size={15} /> Em análise</button>
              <button className="primary-button" type="button" disabled={savingId === row.id} onClick={() => void decide(row, 'atendida')}><Check size={15} /> Atender</button>
              <button className="danger-button" type="button" disabled={savingId === row.id} onClick={() => void decide(row, 'recusada')}><X size={15} /> Recusar</button>
              {savingId === row.id && <span className="hr-request-saving"><RefreshCw size={14} className="spin" /> Salvando…</span>}
            </div>
          </div>}

          <details className="hr-request-timeline">
            <summary><Clock3 size={15} /> Auditoria do pedido <span>{row.timeline?.length || 0}</span></summary>
            {row.timeline?.length ? <ol>{row.timeline.map((event, index) => <li key={`${row.id}-${event.created_at}-${index}`}>
              <span className="hr-timeline-dot" />
              <div><strong>{eventLabel(event.evento, event.status_novo)}</strong><small>{formatDate(event.created_at)}{event.responsavel ? ` · ${event.responsavel === 'funcionario' ? 'Funcionário' : event.responsavel === 'registro_anterior' ? 'Sistema' : 'Administrador do RH'}` : ''}</small>{event.comentario && <p>{event.comentario}</p>}</div>
            </li>)}</ol> : <p className="hr-request-no-timeline">Ainda não há eventos registrados.</p>}
          </details>
        </article>)}
      </div>}
      {!loading && total > pageSize && <div className="hr-request-pagination"><span>Página {currentPage} de {pageCount}</span><div><button className="secondary-button" type="button" disabled={offset <= 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}><ChevronLeft size={16} /> Anterior</button><button className="secondary-button" type="button" disabled={currentPage >= pageCount} onClick={() => setOffset((value) => value + pageSize)}>Próxima <ChevronRight size={16} /></button></div></div>}
    </SectionCard>
  </div>
}
