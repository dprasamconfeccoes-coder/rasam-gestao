import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Clock3, RefreshCw } from 'lucide-react'
import { getProntuarioTimeline } from '../lib/api'
import type { EmployeeTimelineEvent } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, SectionCard, StatusPill, formatDate } from '../components/ui'

type Props = {
  token: string
  funcionarioId?: string | null
}

const eventTypes: Array<[string, string]> = [
  ['', 'Todos os movimentos'],
  ['cadastro', 'Cadastro e histórico'],
  ['admissao', 'Admissão'],
  ['desligamento', 'Desligamento'],
  ['advertencia', 'Advertências'],
  ['atestado', 'Atestados'],
  ['afastamento', 'Afastamentos'],
  ['ferias', 'Férias'],
  ['justificativa', 'Justificativas'],
  ['ponto', 'Ponto'],
  ['documento', 'Documentos'],
]

export function EmployeeTimeline({ token, funcionarioId = null }: Props) {
  const [tipo, setTipo] = useState('')
  const [eventos, setEventos] = useState<EmployeeTimelineEvent[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)

  useEffect(() => {
    const requestId = ++requestSequence.current
    let cancelled = false
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setEventos([])
    setOffset(0)
    getProntuarioTimeline(token, funcionarioId, { tipo: tipo || null, offset: 0, limite: 50 })
      .then((result) => {
        if (cancelled || requestId !== requestSequence.current) return
        if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar a linha do tempo.')
        setEventos(result.eventos || [])
        setTotal(result.total || 0)
        setOffset((result.eventos || []).length)
      })
      .catch((cause) => {
        if (!cancelled && requestId === requestSequence.current) setError(cause instanceof Error ? cause.message : 'Falha ao carregar a linha do tempo.')
      })
      .finally(() => {
        if (!cancelled && requestId === requestSequence.current) setLoading(false)
      })
    return () => { cancelled = true }
  }, [token, funcionarioId, tipo])

  async function loadMore() {
    if (loadingMore || offset >= total) return
    const requestId = requestSequence.current
    setLoadingMore(true)
    setError('')
    try {
      const result = await getProntuarioTimeline(token, funcionarioId, { tipo: tipo || null, offset, limite: 50 })
      if (requestId !== requestSequence.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar mais eventos.')
      setEventos((current) => [...current, ...(result.eventos || [])])
      setOffset((current) => current + (result.eventos || []).length)
    } catch (cause) {
      if (requestId === requestSequence.current) setError(cause instanceof Error ? cause.message : 'Falha ao carregar mais eventos.')
    } finally {
      if (requestId === requestSequence.current) setLoadingMore(false)
    }
  }

  return (
    <SectionCard title="Linha do tempo funcional" caption={`${total} evento(s) · mais recentes primeiro · histórico consultado em páginas`}>
      <div className="employee-timeline-toolbar">
        <label htmlFor="employee-timeline-type">Filtrar por tipo</label>
        <select id="employee-timeline-type" value={tipo} onChange={(event) => { requestSequence.current += 1; setTipo(event.target.value) }}>
          {eventTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Carregando histórico funcional…" /> : eventos.length ? (
        <>
          <ol className="employee-timeline-list">
            {eventos.map((evento) => (
              <li className="employee-timeline-item" key={`${evento.tipo}-${evento.id}`}>
                <span className="employee-timeline-marker"><Clock3 size={15} /></span>
                <div className="employee-timeline-content">
                  <div className="employee-timeline-heading">
                    <strong>{evento.titulo}</strong>
                    <time dateTime={evento.data}>{formatDate(evento.data)}</time>
                  </div>
                  <p>{evento.descricao || 'Sem observações adicionais.'}</p>
                  <div className="employee-timeline-meta">
                    <span>{evento.origem}</span>
                    {evento.status ? <StatusPill value={evento.status} /> : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {offset < total ? (
            <button className="secondary-button employee-timeline-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <><RefreshCw size={15} className="spin" /> Carregando…</> : <><ChevronDown size={15} /> Carregar mais ({total - offset})</>}
            </button>
          ) : null}
        </>
      ) : !error ? <EmptyState title="Nenhum movimento encontrado" description="Não há eventos para o filtro selecionado." /> : null}
    </SectionCard>
  )
}
