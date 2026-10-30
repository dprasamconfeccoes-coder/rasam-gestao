import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Clock, Eye, ShieldCheck, Upload, X } from 'lucide-react'
import { getMedicalLeaveDocumentUrl, listMedicalLeaves, uploadMedicalLeave } from '../lib/api'
import type { MedicalLeaveAuditEvent, MedicalLeaveRow } from '../lib/types'
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

function medicalLeaveStatusGroup(status: string) {
  const normalized = status.trim().toLowerCase()
  if (['aguardando', 'pendente', 'em_analise'].includes(normalized)) return 'pendentes'
  if (['aceito', 'aceita', 'aprovado', 'aprovada'].includes(normalized)) return 'aceitos'
  if (['recusado', 'recusada', 'reprovado', 'reprovada'].includes(normalized)) return 'recusados'
  return 'outros'
}

export async function openSecureDocument(token: string, atestadoId: string) {
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

export function AuditTimeline({ events }: { events?: MedicalLeaveAuditEvent[] }) {
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

  const summary = rows.reduce((counts, row) => {
    const group = medicalLeaveStatusGroup(row.status)
    if (group === 'pendentes') counts.pendentes += 1
    if (group === 'aceitos') counts.aceitos += 1
    if (group === 'recusados') counts.recusados += 1
    return counts
  }, { total: rows.length, pendentes: 0, aceitos: 0, recusados: 0 })

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

      <SectionCard title="Resumo dos seus atestados" caption="Indicadores calculados somente com os seus próprios envios">
        {loading ? <LoadingState label="Calculando seu resumo…" /> : (
          <div className="medical-dashboard-grid employee-medical-summary">
            <article className="medical-dashboard-card"><span>Total enviados</span><strong>{summary.total}</strong></article>
            <article className="medical-dashboard-card is-pending"><span>Em análise</span><strong>{summary.pendentes}</strong></article>
            <article className="medical-dashboard-card is-approved"><span>Aprovados</span><strong>{summary.aceitos}</strong></article>
            <article className="medical-dashboard-card is-rejected"><span>Reprovados</span><strong>{summary.recusados}</strong></article>
          </div>
        )}
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
