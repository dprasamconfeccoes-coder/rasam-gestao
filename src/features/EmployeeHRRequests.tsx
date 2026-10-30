import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Check, Clock3, FileCheck2, RefreshCw, Send } from 'lucide-react'
import { createRequest, listRequests } from '../lib/api'
import type { RequestAuditEvent, RequestRow } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate } from '../components/ui'
import './hr-requests.css'

const requestTypes = [
  { value: 'Dúvida ao RH', description: 'Perguntas sobre rotinas, pagamentos, ponto ou políticas.' },
  { value: 'Correção cadastral', description: 'Atualização ou correção de dados do seu cadastro.' },
  { value: 'Solicitação de férias', description: 'Pedido ou dúvida sobre programação de férias.' },
  { value: 'Solicitação de documento', description: 'Solicite declaração, comprovante ou outro documento.' },
  { value: 'Benefício', description: 'Dúvidas ou solicitações relacionadas a benefícios.' },
  { value: 'Outro assunto', description: 'Use quando o assunto não se encaixar nas opções acima.' },
]

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pendente: 'Aguardando RH', aberta: 'Aguardando RH', nova: 'Aguardando RH',
    em_analise: 'Em análise', atendida: 'Atendida', concluida: 'Concluída', aprovada: 'Atendida',
    recusada: 'Recusada', reprovada: 'Recusada', cancelada: 'Cancelada',
  }
  return labels[status] || status.replaceAll('_', ' ')
}

function eventLabel(event: RequestAuditEvent) {
  if (event.evento === 'solicitacao_aberta') return 'Solicitação enviada ao RH'
  if (event.evento === 'status_alterado') return `Status alterado: ${statusLabel(event.status_anterior || 'pendente')} → ${statusLabel(event.status_novo)}`
  if (event.evento === 'resposta_atualizada') return 'Resposta do RH atualizada'
  return `Histórico registrado · ${statusLabel(event.status_novo)}`
}

export function EmployeeHRRequests({ token }: { token: string }) {
  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [type, setType] = useState(requestTypes[0].value)
  const [description, setDescription] = useState('')
  const selectedType = requestTypes.find((item) => item.value === type) || requestTypes[0]

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const result = await listRequests(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar suas solicitações')
      setRows(result.solicitacoes || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar suas solicitações')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [token])

  const metrics = useMemo(() => ({
    total: rows.length,
    abertas: rows.filter((row) => ['pendente', 'aberta', 'nova', 'em_analise'].includes(row.status)).length,
    atendidas: rows.filter((row) => ['atendida', 'concluida', 'aprovada'].includes(row.status)).length,
    recusadas: rows.filter((row) => ['recusada', 'reprovada'].includes(row.status)).length,
  }), [rows])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSuccess('')
    setError('')
    try {
      const result = await createRequest(token, type, description.trim())
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível registrar a solicitação')
      setDescription('')
      setSuccess('Solicitação enviada. Você pode acompanhar as atualizações nesta página.')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a solicitação')
    } finally {
      setSaving(false)
    }
  }

  return <div className="hr-requests-page">
    <PageHeading eyebrow="Minha área · relacionamento" title="Solicitações ao RH" description="Abra um pedido e acompanhe o andamento, as respostas e o histórico de atualizações." action={<button className="secondary-button" type="button" onClick={() => void reload()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>} />

    <div className="hr-request-metrics employee-request-metrics" aria-label="Resumo das minhas solicitações">
      <div className="hr-request-metric"><span>Total enviado</span><strong>{metrics.total}</strong></div>
      <div className="hr-request-metric is-open"><span>Em aberto</span><strong>{metrics.abertas}</strong></div>
      <div className="hr-request-metric is-done"><span>Atendidas</span><strong>{metrics.atendidas}</strong></div>
      <div className="hr-request-metric is-rejected"><span>Recusadas</span><strong>{metrics.recusadas}</strong></div>
    </div>

    {error && <ErrorState message={error} />}
    {success && <div className="form-success hr-request-feedback"><Check size={16} />{success}</div>}

    <div className="hr-requests-layout">
      <SectionCard title="Nova solicitação" caption="Escolha o assunto e conte ao RH como pode ajudar">
        <form className="hr-request-form" onSubmit={submit}>
          <label>Tipo de solicitação
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {requestTypes.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
            <small className="hr-request-help">{selectedType.description}</small>
          </label>
          <label>Descrição
            <textarea required minLength={10} maxLength={2500} rows={6} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explique seu pedido com detalhes para que o RH consiga analisar." />
            <small className="hr-request-help hr-request-counter">Mínimo de 10 caracteres · {description.length}/2.500</small>
          </label>
          <div className="hr-request-form-note"><Clock3 size={16} /><span>Após o envio, o pedido ficará registrado no seu histórico e o RH atualizará o status por aqui.</span></div>
          <button className="primary-button hr-request-submit" type="submit" disabled={saving || description.trim().length < 10}>
            {saving ? <><RefreshCw size={16} className="spin" /> Enviando…</> : <><Send size={16} /> Enviar solicitação</>}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Meu histórico" caption="Somente solicitações vinculadas ao seu usuário">
        {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="Seu histórico está vazio" description="Quando você enviar um pedido ao RH, ele aparecerá aqui com o status e as respostas." /> : <div className="hr-request-list">
          {rows.map((row) => <article className="hr-request-card" key={row.id}>
            <div className="hr-request-card-head">
              <div className="hr-request-card-title"><span className="hr-request-kind"><FileCheck2 size={15} />{row.tipo}</span><small>Enviada em {formatDate(row.created_at)}</small></div>
              <StatusPill value={statusLabel(row.status)} />
            </div>
            <p className="hr-request-description">{row.descricao}</p>
            {row.anexo_nome && <div className="hr-request-attachment">Documento vinculado: <strong>{row.anexo_nome}</strong></div>}
            {row.resposta && <div className={`hr-request-answer ${['recusada', 'reprovada'].includes(row.status) ? 'is-rejected' : ''}`}><strong>{['recusada', 'reprovada'].includes(row.status) ? 'Retorno / justificativa do RH' : 'Retorno do RH'}</strong><p>{row.resposta}</p>{row.analisado_em && <small>Atualizado em {formatDate(row.analisado_em)}</small>}</div>}
            <details className="hr-request-timeline">
              <summary><Clock3 size={15} /> Histórico de atualizações <span>{row.timeline?.length || 0}</span></summary>
              {row.timeline?.length ? <ol>{row.timeline.map((event, index) => <li key={`${row.id}-${event.created_at}-${index}`}>
                <span className="hr-timeline-dot" />
                <div><strong>{eventLabel(event)}</strong><small>{formatDate(event.created_at)}{event.responsavel ? ` · ${event.responsavel === 'funcionario' ? 'Funcionário' : event.responsavel === 'registro_anterior' ? 'Sistema' : 'RH'}` : ''}</small>{event.comentario && <p>{event.comentario}</p>}</div>
              </li>)}</ol> : <p className="hr-request-no-timeline">Ainda não há eventos adicionais.</p>}
            </details>
          </article>)}
        </div>}
      </SectionCard>
    </div>
    <div className="hr-request-security-note"><ArrowRight size={15} /><span>Seu histórico é privado e contém apenas solicitações vinculadas ao seu próprio cadastro.</span></div>
  </div>
}
