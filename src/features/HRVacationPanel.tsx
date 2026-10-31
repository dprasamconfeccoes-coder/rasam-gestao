import { Check, FileText, Plus, RefreshCw, Upload, X } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { AdminVacationManagementRow, EmployeeRow } from '../lib/types'
import { EmptyState, SectionCard, StatusPill, formatDate } from '../components/ui'
import { createAdminVacation, getVacationDocumentUrl, updateAdminVacation, uploadVacationDocument } from '../lib/api'

const emptyForm = { funcionarioId: '', periodoAquisitivoInicio: '', periodoAquisitivoFim: '', inicio: '', fim: '', status: 'agendada', observacoes: '' }
type VacationDocumentType = 'aviso' | 'recibo'
type VacationUploads = Record<VacationDocumentType, File | null>
const emptyUploads: VacationUploads = { aviso: null, recibo: null }
const maxPdfBytes = 10 * 1024 * 1024
const documentLabel: Record<VacationDocumentType, string> = { aviso: 'Aviso', recibo: 'Recibo' }
const statusLabel: Record<string, string> = { agendada: 'Agendada', em_gozo: 'Em gozo', concluida: 'Concluída', cancelada: 'Cancelada' }

function pdfIssue(file: File) {
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) return 'Selecione um arquivo PDF.'
  if (file.size < 1 || file.size > maxPdfBytes) return 'O PDF deve ter até 10 MB.'
  return ''
}

function effectiveStatus(row: AdminVacationManagementRow, today = new Date().toISOString().slice(0, 10)) {
  if (row.status === 'cancelada' || row.status === 'concluida') return row.status
  if (!row.inicio || today < row.inicio) return 'agendada'
  if (row.fim && today > row.fim) return 'concluida'
  return 'em_gozo'
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || '?').toUpperCase()
}

function vacationDays(start: string, end: string) {
  return Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1
}

export function HRVacationPanel({ token, employees, vacations, onDone }: { token: string; employees: EmployeeRow[]; vacations: AdminVacationManagementRow[]; onDone: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [uploads, setUploads] = useState<VacationUploads>({ ...emptyUploads })
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploadingDocumentKey, setUploadingDocumentKey] = useState<string | null>(null)
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function selectLaunchFile(tipo: VacationDocumentType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] || null
    if (!file) return
    const issue = pdfIssue(file)
    if (issue) {
      setUploads((current) => ({ ...current, [tipo]: null }))
      setError(issue)
      return
    }
    setError('')
    setUploads((current) => ({ ...current, [tipo]: file }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      if (form.inicio > form.fim) throw new Error('O fim das férias não pode ser anterior ao início.')
      const days = vacationDays(form.inicio, form.fim)
      if (days < 5 || days > 30) throw new Error(`O período deve ter entre 5 e 30 dias corridos. Este lançamento tem ${days} dias.`)
      if (form.periodoAquisitivoInicio > form.periodoAquisitivoFim) throw new Error('O período aquisitivo está invertido.')
      const sameAcquisition = vacations.filter((row) => row.funcionario_id === form.funcionarioId && row.periodo_aquisitivo_inicio === form.periodoAquisitivoInicio && row.periodo_aquisitivo_fim === form.periodoAquisitivoFim && row.status !== 'cancelada')
      if (sameAcquisition.length >= 3) throw new Error('A CLT permite no máximo três períodos de gozo para o mesmo período aquisitivo.')
      const existingLongPeriod = sameAcquisition.some((row) => row.inicio && row.fim && vacationDays(row.inicio, row.fim) >= 14)
      if (!existingLongPeriod && sameAcquisition.length === 0 && days < 14) throw new Error('No fracionamento, ao menos um período deve ter 14 dias corridos. Lance primeiro um período de 14 dias ou mais.')

      const selectedFiles = (Object.keys(uploads) as VacationDocumentType[])
        .flatMap((tipo) => uploads[tipo] ? [{ tipo, file: uploads[tipo] as File }] : [])
      for (const { file } of selectedFiles) {
        const issue = pdfIssue(file)
        if (issue) throw new Error(issue)
      }

      const result = await createAdminVacation(token, form)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível lançar as férias')
      if (selectedFiles.length && !result.id) {
        setForm(emptyForm)
        setUploads({ ...emptyUploads })
        setShowForm(false)
        await onDone()
        setError('As férias foram lançadas, mas o servidor não retornou o identificador para anexar os PDFs. Anexe os documentos na linha do período.')
        return
      }

      const failedUploads: string[] = []
      if (result.id) {
        for (const { tipo, file } of selectedFiles) {
          try {
            await uploadVacationDocument(token, result.id, tipo, file)
          } catch (uploadError) {
            const detail = uploadError instanceof Error ? ` (${uploadError.message})` : ''
            failedUploads.push(`${documentLabel[tipo]}${detail}`)
          }
        }
      }

      setForm(emptyForm)
      setUploads({ ...emptyUploads })
      setShowForm(false)
      await onDone()
      if (failedUploads.length) {
        setError(`Férias lançadas, mas não foi possível anexar ${failedUploads.join(' e ')}. Use a opção de anexar na linha do período para tentar novamente.`)
      } else {
        setMessage(selectedFiles.length ? 'Férias lançadas; PDFs salvos no Storage privado do Supabase.' : 'Férias lançadas com sucesso.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível lançar as férias')
    } finally {
      setSaving(false)
    }
  }

  async function update(row: AdminVacationManagementRow, status: string) {
    setBusyId(row.id)
    setError('')
    setMessage('')
    try {
      const result = await updateAdminVacation(token, row.id, { inicio: row.inicio || '', fim: row.fim || '', status, observacoes: row.observacoes || '' })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar as férias')
      setMessage('Status de férias atualizado.')
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar as férias')
    } finally {
      setBusyId(null)
    }
  }

  async function openDocument(documentId: string) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setError('O navegador bloqueou a abertura do PDF. Permita pop-ups para visualizar o documento.')
      return
    }
    tab.opener = null
    setOpeningDocumentId(documentId)
    setError('')
    setMessage('')
    try {
      const signed = await getVacationDocumentUrl(token, documentId)
      if (!tab.closed) tab.location.replace(signed.url!)
    } catch (err) {
      tab.close()
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o PDF')
    } finally {
      setOpeningDocumentId(null)
    }
  }

  async function uploadToExisting(rowId: string, tipo: VacationDocumentType, file: File) {
    const issue = pdfIssue(file)
    if (issue) {
      setError(issue)
      return
    }
    const key = `${rowId}:${tipo}`
    setUploadingDocumentKey(key)
    setError('')
    setMessage('')
    try {
      await uploadVacationDocument(token, rowId, tipo, file)
      setMessage(`${documentLabel[tipo]} anexado e salvo no Supabase.`)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Não foi possível anexar o ${documentLabel[tipo].toLowerCase()}`)
    } finally {
      setUploadingDocumentKey(null)
    }
  }

  function documentControl(row: AdminVacationManagementRow, tipo: VacationDocumentType) {
    const document = tipo === 'aviso' ? row.aviso_documento : row.recibo_documento
    if (document) {
      const busy = openingDocumentId === document.id
      return <button className="vacation-document-action" type="button" onClick={() => void openDocument(document.id)} disabled={busy} title={`Abrir ${document.arquivo_nome}`}>
        {busy ? <RefreshCw className="spin" size={13} /> : <FileText size={13} />} {busy ? 'Abrindo…' : documentLabel[tipo]}
      </button>
    }
    const key = `${row.id}:${tipo}`
    const busy = uploadingDocumentKey === key
    return <label className={`vacation-document-upload${busy ? ' is-busy' : ''}`} title={`Anexar PDF do ${documentLabel[tipo].toLowerCase()}`}>
      {busy ? <RefreshCw className="spin" size={13} /> : <Upload size={13} />} {busy ? 'Enviando…' : `Anexar ${documentLabel[tipo].toLowerCase()}`}
      <input className="vacation-document-file-input" type="file" accept="application/pdf,.pdf" disabled={busy} aria-label={`Anexar PDF do ${documentLabel[tipo].toLowerCase()}`} onChange={(event) => {
        const input = event.currentTarget
        const file = input.files?.[0]
        input.value = ''
        if (file) void uploadToExisting(row.id, tipo, file)
      }} />
    </label>
  }

  return <>
    <SectionCard title="Gestão de férias" caption={`${vacations.length} período(s) lançado(s)`}>
      <div className="hr-panel-toolbar"><div><strong>Períodos aquisitivos e de gozo</strong><small>O status é sugerido automaticamente pela data atual; cancelamentos e conclusões manuais são preservados.</small></div><button className="primary-button" type="button" onClick={() => { setShowForm(!showForm); setError(''); setMessage(''); if (showForm) setUploads({ ...emptyUploads }) }}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? 'Fechar lançamento' : 'Lançar férias'}</button></div>
      {showForm && <form className="form-stack hr-vacation-form" onSubmit={submit}>
        <div className="form-row"><label>Funcionário<select required value={form.funcionarioId} onChange={(e) => setForm({ ...form, funcionarioId: e.target.value })}><option value="">Selecione</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select></label><label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="agendada">Agendada</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select></label></div>
        <div className="form-row"><label>Início do período aquisitivo<input required type="date" value={form.periodoAquisitivoInicio} onChange={(e) => setForm({ ...form, periodoAquisitivoInicio: e.target.value })} /></label><label>Fim do período aquisitivo<input required type="date" value={form.periodoAquisitivoFim} onChange={(e) => setForm({ ...form, periodoAquisitivoFim: e.target.value })} /></label></div>
        <div className="form-row"><label>Início das férias<input required type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label><label>Fim das férias<input required type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label></div>
        <div className="form-row vacation-upload-row">
          <label>PDF do aviso (opcional)<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectLaunchFile('aviso', event)} /><small>PDF de até 10 MB, armazenado em bucket privado.</small>{uploads.aviso && <small className="vacation-upload-selection">Selecionado: {uploads.aviso.name}</small>}</label>
          <label>PDF do recibo (opcional)<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectLaunchFile('recibo', event)} /><small>PDF de até 10 MB, armazenado em bucket privado.</small>{uploads.recibo && <small className="vacation-upload-selection">Selecionado: {uploads.recibo.name}</small>}</label>
        </div>
        <label>Observações<textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Abono, programação ou observações do RH" /></label>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? <RefreshCw className="spin" size={16} /> : <Check size={16} />} {saving ? 'Salvando…' : 'Salvar período de férias'}</button>
      </form>}
      {error && <div className="form-error"><X size={16} />{error}</div>}{message && <div className="form-success"><Check size={16} />{message}</div>}
      {vacations.length === 0 ? <EmptyState title="Nenhuma férias lançada" description="Use o botão acima para registrar o primeiro período." /> : <div className="hr-vacation-list">{vacations.map((row) => {
        const currentStatus = effectiveStatus(row)
        const employee = employees.find((item) => item.id === row.funcionario_id)
        return <article className={`hr-vacation-row status-${currentStatus}`} key={row.id}>
          <div className="employee-avatar">{employee?.avatar_url ? <img src={employee.avatar_url} alt={`Foto de ${row.nome}`} /> : initials(row.nome)}</div>
          <div className="hr-vacation-main"><strong>{row.nome}</strong><small>{formatDate(row.inicio)} até {formatDate(row.fim)} · período aquisitivo {formatDate(row.periodo_aquisitivo_inicio)} até {formatDate(row.periodo_aquisitivo_fim)}</small>{row.observacoes && <small>{row.observacoes}</small>}
            <div className="vacation-document-links"><span>Documentos:</span>{documentControl(row, 'aviso')}{documentControl(row, 'recibo')}</div>
          </div>
          <StatusPill value={statusLabel[currentStatus] || currentStatus} />
          <select className={`vacation-status-select status-${currentStatus}`} value={currentStatus} disabled={busyId === row.id} onChange={(e) => void update(row, e.target.value)} aria-label={`Atualizar férias de ${row.nome}`}><option value="agendada">Agendada</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select>
        </article>
      })}</div>}
    </SectionCard>
  </>
}
