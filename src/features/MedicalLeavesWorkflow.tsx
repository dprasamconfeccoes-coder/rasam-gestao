import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Clock, Eye, ShieldCheck, Upload, X } from 'lucide-react'
import { decideMedicalLeave, getMedicalLeaveDocumentUrl, listMedicalLeaves, uploadMedicalLeave } from '../lib/api'
import type { AdminMedicalLeaveRow, MedicalLeaveAuditEvent, MedicalLeaveRow } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, SectionCard, StatusPill, formatDate } from '../components/ui'
import './medical-leaves.css'

const leaveTypes = [
  'Atestado médico',
  'Declaração de comparecimento',
  'Atestado de acompanhante',
  'Justificativa',
  'Outro',
]

function eventTitle(event: MedicalLeaveAuditEvent) {
  if (event.evento === 'enviado') return 'Atestado enviado'
  if (event.evento === 'aceito') return 'Atestado aceito'
  if (event.evento === 'recusado') return 'Atestado recusado'
  return 'Registro anterior à trilha de auditoria'
}

async function openSecureDocument(token: string, atestadoId: string) {
  const popup = window.open('about:blank', '_blank')
  try {
    const url = await getMedicalLeaveDocumentUrl(token, atestadoId)
    if (!popup) throw new Error('Permita a abertura de pop-ups para visualizar o documento.')
    popup.opener = null
    popup.location.replace(url)
  } catch (error) {
    popup?.close()
    throw error
  }
}

function AuditTimeline({ events }: { events?: MedicalLeaveAuditEvent[] }) {
  if (!events?.length) return <p className="medical-muted">A trilha de auditoria começa neste envio.</p>
  return (
    <ol className="medical-timeline">
      {events.map((event, index) => (
        <li key={`${event.created_at}-${event.evento}-${index}`}>
          <span className="medical-timeline-marker" />
          <div className="medical-timeline-entry">
            <strong>{eventTitle(event)}</strong>
            <small>{formatDate(event.created_at)} · {event.responsavel || 'Recursos Humanos'}</small>
            {event.justificativa && <p>{event.justificativa}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function EmployeeMedicalLeaves({ token }: { token: string }) {
  const [rows, setRows] = useState<MedicalLeaveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tipo, setTipo] = useState(leaveTypes[0])
  const [dataAtendimento, setDataAtendimento] = useState('')
  const [dias, setDias] = useState('1')
  const [cid, setCid] = useState('')
  const [observacao, setObservacao] = useState('')
  const [file, setFile] = useState<File | null>(null)

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const result = await listMedicalLeaves(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar os atestados.')
      setRows(result.atestados || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o histórico.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) {
      setError('Selecione a foto ou o PDF do atestado.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('O arquivo deve ter no máximo 10 MB.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await uploadMedicalLeave(token, {
        tipo,
        dataAtendimento,
        dias: Number(dias),
        cid: cid.trim().toUpperCase(),
        observacao,
        file,
      })
      setMessage('Atestado enviado para análise do RH. Você poderá acompanhar cada atualização na linha do tempo.')
      setTipo(leaveTypes[0])
      setDataAtendimento('')
      setDias('1')
      setCid('')
      setObservacao('')
      setFile(null)
      const input = document.getElementById('medical-leave-file') as HTMLInputElement | null
      if (input) input.value = ''
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o atestado.')
    } finally {
      setSaving(false)
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

  return (
    <>
      <SectionCard title="Enviar atestado" caption="Anexe uma foto legível ou um PDF. O documento será analisado pelo RH.">
        <form className="medical-form" onSubmit={submit}>
          <div className="medical-form-grid">
            <label>Tipo de documento
              <select value={tipo} onChange={(event) => setTipo(event.target.value)}>
                {leaveTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>Data da consulta
              <input type="date" required value={dataAtendimento} onChange={(event) => setDataAtendimento(event.target.value)} />
            </label>
            <label>Dias de afastamento
              <input type="number" min="1" max="365" required value={dias} onChange={(event) => setDias(event.target.value)} />
            </label>
            <label>CID <span className="medical-optional">(se constar no documento)</span>
              <input value={cid} onChange={(event) => setCid(event.target.value.toUpperCase())} maxLength={10} pattern="[A-Za-z][0-9]{2}(\.[A-Za-z0-9]{1,4})?" placeholder="Ex.: M54.5" />
            </label>
            <label className="medical-file-field">Foto ou PDF do atestado
              <input id="medical-leave-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required onChange={(event) => setFile(event.target.files?.[0] || null)} />
              <small>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PDF, JPG, PNG ou WebP · máximo 10 MB'}</small>
            </label>
            <label className="medical-wide">Observação <span className="medical-optional">(opcional)</span>
              <textarea rows={3} maxLength={1000} value={observacao} onChange={(event) => setObservacao(event.target.value)} placeholder="Informação objetiva para o RH, se necessário" />
            </label>
          </div>
          <p className="medical-privacy-note"><ShieldCheck size={16} /> Informe o CID somente se estiver indicado no atestado. O anexo é privado e só pode ser aberto pelo funcionário e por administradores autorizados.</p>
          {error && <div className="medical-inline-error" role="alert">{error}</div>}
          {message && <div className="medical-inline-success" role="status">{message}</div>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Enviando…' : <><Upload size={16} /> Enviar para análise</>}</button>
        </form>
      </SectionCard>

      <SectionCard title="Histórico de atestados" caption="Acompanhe os envios e cada decisão registrada pelo RH">
        {loading ? <LoadingState label="Carregando sua linha do tempo…" /> : error && rows.length === 0 ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum atestado enviado" description="Quando você enviar um atestado, o status e as atualizações aparecerão aqui." /> : (
          <div className="medical-record-list">
            {rows.map((row) => (
              <article className="medical-record-card" key={row.id}>
                <div className="medical-record-heading">
                  <div><strong>{row.tipo}</strong><small>Consulta em {formatDate(row.data_atendimento)} · {row.dias} dia(s) de afastamento</small></div>
                  <StatusPill value={row.status_label || row.status} />
                </div>
                <div className="medical-record-meta">
                  <span><b>CID:</b> {row.cid || 'Não informado'}</span>
                  <span><b>Arquivo:</b> {row.arquivo_nome || 'Anexo enviado'}</span>
                </div>
                {row.observacao_rh && <div className="medical-review-result"><strong>Retorno do RH</strong><p>{row.observacao_rh}</p></div>}
                <button className="secondary-button medical-open-file" type="button" onClick={() => void viewDocument(row.id)}><Eye size={16} /> Abrir documento</button>
                <details className="medical-audit-details">
                  <summary><Clock size={15} /> Linha do tempo ({row.timeline?.length || 0})</summary>
                  <AuditTimeline events={row.timeline} />
                </details>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  )
}

export function AdminMedicalLeavesPanel({
  token,
  leaves,
  onRefresh,
}: {
  token: string
  leaves: AdminMedicalLeaveRow[]
  onRefresh: () => Promise<void>
}) {
  const [filter, setFilter] = useState<'pendentes' | 'todos'>('pendentes')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const isPending = (row: AdminMedicalLeaveRow) => ['aguardando', 'pendente'].includes(row.status.toLowerCase())
  const visibleLeaves = filter === 'pendentes' ? leaves.filter(isPending) : leaves

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

  return (
    <SectionCard title="Revisão de atestados" caption="Apenas administradores autorizados podem abrir os anexos e decidir. Toda decisão é auditada.">
      <div className="medical-review-toolbar">
        <span>{leaves.filter(isPending).length} pendente(s) · {leaves.length} registro(s)</span>
        <div className="medical-filter-buttons">
          <button type="button" className={filter === 'pendentes' ? 'active' : ''} onClick={() => setFilter('pendentes')}>Pendentes</button>
          <button type="button" className={filter === 'todos' ? 'active' : ''} onClick={() => setFilter('todos')}>Todos</button>
        </div>
      </div>
      {error && <div className="medical-inline-error" role="alert">{error}</div>}
      {message && <div className="medical-inline-success" role="status">{message}</div>}
      {visibleLeaves.length === 0 ? <EmptyState title={filter === 'pendentes' ? 'Nenhum atestado pendente' : 'Nenhum atestado registrado'} description={filter === 'pendentes' ? 'Novos envios aparecerão aqui para análise.' : 'Os atestados enviados aparecerão aqui.'} /> : (
        <div className="medical-record-list">
          {visibleLeaves.map((row) => (
            <article className="medical-record-card" key={row.id}>
              <div className="medical-record-heading">
                <div><strong>{row.nome} · {row.tipo}</strong><small>Consulta em {formatDate(row.data_atendimento)} · {row.dias} dia(s) de afastamento</small></div>
                <StatusPill value={row.status_label || row.status} />
              </div>
              <div className="medical-record-meta">
                <span><b>CID:</b> {row.cid || 'Não informado'}</span>
                <span><b>Arquivo:</b> {row.arquivo_nome || 'Anexo enviado'}</span>
                <span><b>Enviado:</b> {formatDate(row.created_at)}</span>
              </div>
              {row.observacao && <div className="medical-review-result"><strong>Observação do funcionário</strong><p>{row.observacao}</p></div>}
              {row.observacao_rh && <div className="medical-review-result"><strong>Retorno anterior do RH</strong><p>{row.observacao_rh}</p></div>}
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
    </SectionCard>
  )
}
