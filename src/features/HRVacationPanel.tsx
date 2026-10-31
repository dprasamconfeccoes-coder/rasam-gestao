import { AlertTriangle, BellRing, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Plus, RefreshCw, Save, Search, Upload, WalletCards, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import type { AdminVacationManagementRow, EmployeeRow } from '../lib/types'
import { EmptyState, SectionCard, StatusPill, formatDate } from '../components/ui'
import { createAdminVacation, getVacationDocumentUrl, updateAdminVacation, uploadVacationDocument } from '../lib/api'
import { downloadVacationRecordPdf } from './vacation-record-pdf'

const emptyForm = { funcionarioId: '', periodoAquisitivoInicio: '', periodoAquisitivoFim: '', inicio: '', dias: '', fim: '', retorno: '', status: 'agendada', observacoes: '' }
type VacationDocumentType = 'aviso' | 'recibo' | 'comprovante_pagamento'
type VacationUploads = Record<VacationDocumentType, File | null>
const emptyUploads: VacationUploads = { aviso: null, recibo: null, comprovante_pagamento: null }
const maxPdfBytes = 10 * 1024 * 1024
const pageSize = 15
const documentLabel: Record<VacationDocumentType, string> = { aviso: 'Aviso', recibo: 'Recibo', comprovante_pagamento: 'Comprovante de pagamento' }
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
function addDays(value: string, days: number) {
  if (!value || !Number.isFinite(days)) return ''
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function isOverdueAcquisition(row: AdminVacationManagementRow, today: string) {
  return Boolean(row.periodo_aquisitivo_fim && row.periodo_aquisitivo_fim < today && row.status !== 'cancelada' && row.status !== 'concluida')
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
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [expandedPeriodId, setExpandedPeriodId] = useState<string | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [statusFilter, setStatusFilter] = useState('todos')
  const [documentFilter, setDocumentFilter] = useState('todos')
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [scheduleDraft, setScheduleDraft] = useState({ inicio: '', fim: '' })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const overdueByEmployee = useMemo(() => {
    const counts = new Map<string, number>()
    vacations.forEach((row) => { if (isOverdueAcquisition(row, today)) counts.set(row.funcionario_id, (counts.get(row.funcionario_id) || 0) + 1) })
    return counts
  }, [today, vacations])

  const usedVacationCountByEmployee = useMemo(() => {
    const counts = new Map<string, number>()
    vacations.forEach((row) => {
      if (row.status === 'concluida' || (row.fim && row.fim < today && row.status !== 'cancelada')) counts.set(row.funcionario_id, (counts.get(row.funcionario_id) || 0) + 1)
    })
    return counts
  }, [today, vacations])

  const currentAcquisitionByEmployee = useMemo(() => {
    const current = new Map<string, AdminVacationManagementRow>()
    vacations.forEach((row) => {
      const previous = current.get(row.funcionario_id)
      if (!previous || row.periodo_aquisitivo_fim > previous.periodo_aquisitivo_fim) current.set(row.funcionario_id, row)
    })
    return current
  }, [vacations])

  const lastUsedVacationByEmployee = useMemo(() => {
    const last = new Map<string, AdminVacationManagementRow>()
    vacations.forEach((row) => {
      if (row.status === 'cancelada' || !row.fim || row.fim >= today) return
      const previous = last.get(row.funcionario_id)
      if (!previous || (previous.fim || '') < row.fim) last.set(row.funcionario_id, row)
    })
    return last
  }, [today, vacations])

  const employeeSearchResults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return []
    return employees.filter((employee) => [employee.nome, employee.cpf, employee.cargo || ''].some((value) => value.toLocaleLowerCase('pt-BR').includes(term)))
  }, [employees, search])
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) || null
  const selectedEmployeeRows = selectedEmployeeId ? vacations.filter((row) => row.funcionario_id === selectedEmployeeId) : []
  const selectedCurrentAcquisition = selectedEmployeeId ? currentAcquisitionByEmployee.get(selectedEmployeeId) : null
  const selectedLastUsed = selectedEmployeeId ? lastUsedVacationByEmployee.get(selectedEmployeeId) : null
  const selectedUsedCount = selectedEmployeeId ? usedVacationCountByEmployee.get(selectedEmployeeId) || 0 : 0

  const acquisitionOptions = useMemo(() => {
    const byPeriod = new Map<string, { inicio: string; fim: string; used: number }>()
    vacations.filter((row) => row.funcionario_id === form.funcionarioId && row.status !== 'cancelada').forEach((row) => {
      const key = `${row.periodo_aquisitivo_inicio}|${row.periodo_aquisitivo_fim}`
      const current = byPeriod.get(key) || { inicio: row.periodo_aquisitivo_inicio, fim: row.periodo_aquisitivo_fim, used: 0 }
      current.used += row.inicio && row.fim ? Math.max(0, vacationDays(row.inicio, row.fim)) : 0
      byPeriod.set(key, current)
    })
    return [...byPeriod.values()].sort((a, b) => a.inicio.localeCompare(b.inicio))
  }, [form.funcionarioId, vacations])
  const selectedAcquisition = acquisitionOptions.find((item) => item.inicio === form.periodoAquisitivoInicio && item.fim === form.periodoAquisitivoFim) || null

  const filteredVacations = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return vacations.filter((row) => {
      if (!term || !selectedEmployeeId || row.funcionario_id !== selectedEmployeeId) return false
      const status = effectiveStatus(row, today)
      const employeeMatch = !term || [row.nome, row.cpf, row.cargo || ''].some((value) => value.toLocaleLowerCase('pt-BR').includes(term))
      const statusMatch = statusFilter === 'todos' || (statusFilter === 'prioridade' ? overdueByEmployee.get(row.funcionario_id)! >= 2 || ['em_gozo', 'agendada'].includes(status) : statusFilter === 'vencidas' ? isOverdueAcquisition(row, today) : status === statusFilter)
      const documents = [row.aviso_documento, row.recibo_documento, row.comprovante_pagamento_documento]
      const documentMatch = documentFilter === 'todos' || (documentFilter === 'pendentes' ? documents.some((item) => !item) : documents.every(Boolean))
      return employeeMatch && statusMatch && documentMatch
    }).sort((a, b) => b.periodo_aquisitivo_fim.localeCompare(a.periodo_aquisitivo_fim) || (b.fim || '').localeCompare(a.fim || ''))
  }, [documentFilter, overdueByEmployee, search, selectedEmployeeId, statusFilter, today, vacations])

  const pageCount = Math.max(1, Math.ceil(filteredVacations.length / pageSize))
  const visibleVacations = filteredVacations.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => { setPage(1); setExpandedPeriodId(null) }, [documentFilter, search, selectedEmployeeId, statusFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  function selectLaunchFile(tipo: VacationDocumentType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] || null
    if (!file) return
    const issue = pdfIssue(file)
    if (issue) { setUploads((current) => ({ ...current, [tipo]: null })); setError(issue); return }
    setError('')
    setUploads((current) => ({ ...current, [tipo]: file }))
  }

  function chooseLaunchEmployee(funcionarioId: string) {
    const grouped = new Map<string, AdminVacationManagementRow[]>()
    vacations.filter((row) => row.funcionario_id === funcionarioId && row.status !== 'cancelada').forEach((row) => {
      const key = `${row.periodo_aquisitivo_inicio}|${row.periodo_aquisitivo_fim}`
      grouped.set(key, [...(grouped.get(key) || []), row])
    })
    const oldest = [...grouped.values()].sort((a, b) => a[0].periodo_aquisitivo_inicio.localeCompare(b[0].periodo_aquisitivo_inicio)).find((period) => period.reduce((sum, row) => sum + (row.inicio && row.fim ? vacationDays(row.inicio, row.fim) : 0), 0) < 30)?.[0]
    setForm((current) => ({ ...current, funcionarioId, periodoAquisitivoInicio: oldest?.periodo_aquisitivo_inicio || '', periodoAquisitivoFim: oldest?.periodo_aquisitivo_fim || '', inicio: '', dias: '', fim: '', retorno: '' }))
    setError(oldest ? '' : 'Este funcionário ainda não possui um período aquisitivo disponível no sistema.')
  }

  function changeLaunchStart(inicio: string) {
    const days = Number(form.dias)
    const fim = inicio && Number.isInteger(days) && days > 0 ? addDays(inicio, days - 1) : ''
    setForm((current) => ({ ...current, inicio, fim, retorno: fim ? addDays(fim, 1) : '' }))
  }

  function changeLaunchDays(raw: string) {
    const days = Number(raw)
    const fim = form.inicio && Number.isInteger(days) && days > 0 ? addDays(form.inicio, days - 1) : ''
    setForm((current) => ({ ...current, dias: raw, fim, retorno: fim ? addDays(fim, 1) : '' }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      if (!form.funcionarioId || !form.periodoAquisitivoInicio || !form.periodoAquisitivoFim) throw new Error('Selecione um funcionário com período aquisitivo disponível.')
      if (!form.inicio || !form.dias || !form.fim) throw new Error('Informe o início e a quantidade de dias das férias.')
      if (form.inicio > form.fim) throw new Error('O fim das férias não pode ser anterior ao início.')
      const days = vacationDays(form.inicio, form.fim)
      if (days < 5 || days > 30) throw new Error(`O período deve ter entre 5 e 30 dias corridos. Este lançamento tem ${days} dias.`)
      if (form.periodoAquisitivoInicio > form.periodoAquisitivoFim) throw new Error('O período aquisitivo está invertido.')
      const sameAcquisition = vacations.filter((row) => row.funcionario_id === form.funcionarioId && row.periodo_aquisitivo_inicio === form.periodoAquisitivoInicio && row.periodo_aquisitivo_fim === form.periodoAquisitivoFim && row.status !== 'cancelada')
      if (sameAcquisition.length >= 3) throw new Error('A CLT permite no máximo três períodos de gozo para o mesmo período aquisitivo.')
      const usedDays = sameAcquisition.reduce((sum, row) => sum + (row.inicio && row.fim ? vacationDays(row.inicio, row.fim) : 0), 0)
      if (usedDays + days > 30) throw new Error(`O período aquisitivo selecionado tem apenas ${30 - usedDays} dia(s) disponível(eis).`)
      const existingLongPeriod = sameAcquisition.some((row) => row.inicio && row.fim && vacationDays(row.inicio, row.fim) >= 14)
      if (!existingLongPeriod && sameAcquisition.length === 0 && days < 14) throw new Error('No fracionamento, ao menos um período deve ter 14 dias corridos. Lance primeiro um período de 14 dias ou mais.')
      const selectedFiles = (Object.keys(uploads) as VacationDocumentType[]).flatMap((tipo) => uploads[tipo] ? [{ tipo, file: uploads[tipo] as File }] : [])
      selectedFiles.forEach(({ file }) => { const issue = pdfIssue(file); if (issue) throw new Error(issue) })
      const result = await createAdminVacation(token, form)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível lançar as férias')
      if (selectedFiles.length && !result.id) { setForm(emptyForm); setUploads({ ...emptyUploads }); setShowForm(false); await onDone(); setError('As férias foram lançadas, mas o servidor não retornou o identificador para anexar os PDFs.'); return }
      const failedUploads: string[] = []
      if (result.id) for (const { tipo, file } of selectedFiles) { try { await uploadVacationDocument(token, result.id, tipo, file) } catch (uploadError) { failedUploads.push(documentLabel[tipo] + (uploadError instanceof Error ? ` (${uploadError.message})` : '')) } }
      setForm(emptyForm); setUploads({ ...emptyUploads }); setShowForm(false); await onDone()
      setMessage(failedUploads.length ? `Férias lançadas, mas não foi possível anexar ${failedUploads.join(' e ')}.` : selectedFiles.length ? 'Férias lançadas; documentos salvos no Storage privado do Supabase.' : 'Férias lançadas com sucesso.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível lançar as férias') } finally { setSaving(false) }
  }

  function notifyEmployeeDraft() {
    if (!form.funcionarioId) { setError('Selecione o funcionário antes de preparar a notificação.'); return }
    setError(''); setMessage('Notificação preparada para a próxima etapa de envio ao funcionário. Nenhuma mensagem foi enviada ainda.')
  }

  async function update(row: AdminVacationManagementRow, status: string) {
    setBusyId(row.id); setError(''); setMessage('')
    try { const result = await updateAdminVacation(token, row.id, { inicio: row.inicio || '', fim: row.fim || '', status, observacoes: row.observacoes || '' }); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atualizar as férias'); setMessage('Status de férias atualizado.'); await onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar as férias') } finally { setBusyId(null) }
  }

  function startReschedule(row: AdminVacationManagementRow) {
    setEditingScheduleId(row.id)
    setScheduleDraft({ inicio: row.inicio || '', fim: row.fim || '' })
    setError('')
    setMessage('')
  }

  async function saveReschedule(row: AdminVacationManagementRow) {
    if (!scheduleDraft.inicio || !scheduleDraft.fim || scheduleDraft.inicio > scheduleDraft.fim) {
      setError('Informe um novo início e fim válidos para o reagendamento.')
      return
    }
    setSavingSchedule(true)
    setError('')
    setMessage('')
    try {
      const result = await updateAdminVacation(token, row.id, { inicio: scheduleDraft.inicio, fim: scheduleDraft.fim, status: 'agendada', observacoes: row.observacoes || '' })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível reagendar as férias')
      setEditingScheduleId(null)
      setMessage(`Férias de ${row.nome} reagendadas para ${formatDate(scheduleDraft.inicio)} até ${formatDate(scheduleDraft.fim)}.`)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível reagendar as férias')
    } finally {
      setSavingSchedule(false)
    }
  }

  async function openDocument(documentId: string, download = false) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) { setError('O navegador bloqueou a abertura do PDF. Permita pop-ups para visualizar o documento.'); return }
    tab.opener = null; setOpeningDocumentId(documentId); setError(''); setMessage('')
    try { const signed = await getVacationDocumentUrl(token, documentId, download); if (!tab.closed) tab.location.replace(signed.url!) } catch (err) { tab.close(); setError(err instanceof Error ? err.message : 'Não foi possível abrir o PDF') } finally { setOpeningDocumentId(null) }
  }

  async function uploadToExisting(rowId: string, tipo: VacationDocumentType, file: File) {
    const issue = pdfIssue(file); if (issue) { setError(issue); return }
    const key = `${rowId}:${tipo}`; setUploadingDocumentKey(key); setError(''); setMessage('')
    try { await uploadVacationDocument(token, rowId, tipo, file); setMessage(`${documentLabel[tipo]} anexado e salvo no Supabase.`); await onDone() } catch (err) { setError(err instanceof Error ? err.message : `Não foi possível anexar o ${documentLabel[tipo].toLowerCase()}`) } finally { setUploadingDocumentKey(null) }
  }

  function documentControl(row: AdminVacationManagementRow, tipo: VacationDocumentType) {
    const document = tipo === 'aviso' ? row.aviso_documento : tipo === 'recibo' ? row.recibo_documento : row.comprovante_pagamento_documento
    const shortLabel = tipo === 'comprovante_pagamento' ? 'Pagamento' : documentLabel[tipo]
    if (document) { const busy = openingDocumentId === document.id; return <button className="vacation-document-action" type="button" onClick={() => void openDocument(document.id)} disabled={busy} title={`Abrir ${document.arquivo_nome}`}>{busy ? <RefreshCw className="spin" size={13} /> : tipo === 'comprovante_pagamento' ? <WalletCards size={13} /> : <FileText size={13} />} {busy ? 'Abrindo…' : shortLabel}</button> }
    const key = `${row.id}:${tipo}`; const busy = uploadingDocumentKey === key
    return <span className="vacation-document-missing"><button className="vacation-document-action is-missing" type="button" disabled title={`Sem comprovante de ${documentLabel[tipo].toLowerCase()}`}><AlertTriangle size={13} /> Sem {shortLabel.toLowerCase()}</button><label className={`vacation-document-upload${busy ? ' is-busy' : ''}`} title={`Anexar ${documentLabel[tipo].toLowerCase()}`}>{busy ? <RefreshCw className="spin" size={13} /> : <Upload size={13} />} {busy ? 'Enviando…' : 'Anexar'}<input className="vacation-document-file-input" type="file" accept="application/pdf,.pdf" disabled={busy} aria-label={`Anexar ${documentLabel[tipo].toLowerCase()}`} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; input.value = ''; if (file) void uploadToExisting(row.id, tipo, file) }} /></label></span>
  }

  async function exportVacationRecord(row?: AdminVacationManagementRow) {
    if (!selectedEmployee) return
    setError(''); setMessage(''); setShowExportMenu(false)
    try { await downloadVacationRecordPdf(selectedEmployee, selectedEmployeeRows, row); setMessage(row ? 'Prontuário do período gerado em PDF.' : 'Prontuário completo gerado em PDF.') } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível gerar o prontuário em PDF') }
  }

  return <SectionCard title="Gestão de férias" caption={search.trim() ? `${filteredVacations.length} de ${vacations.length} período(s) · 15 por página` : 'Digite nome, CPF ou cargo para consultar · 15 por página'}>
    <div className="hr-panel-toolbar"><div><strong>Períodos aquisitivos e de gozo</strong><small>Digite nome, CPF ou cargo para consultar os períodos e documentos do funcionário.</small></div><button className="primary-button" type="button" onClick={() => { setShowForm(!showForm); setError(''); setMessage(''); if (showForm) setUploads({ ...emptyUploads }) }}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? 'Fechar lançamento' : 'Lançar férias'}</button></div>
    <div className="vacation-filter-panel"><label className="vacation-search"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedEmployeeId(null); setExpandedPeriodId(null); setShowExportMenu(false) }} placeholder="Buscar funcionário, CPF ou cargo" /></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="prioridade">Prioridade inicial</option><option value="todos">Todos os períodos</option><option value="vencidas">Aquisitivo vencido</option><option value="agendada">Agendadas</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluídas</option><option value="cancelada">Canceladas</option></select></label><label>Documentação<select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}><option value="todos">Todos</option><option value="pendentes">Com pendência</option><option value="completos">Completos</option></select></label></div>
    {showForm && <form className="form-stack hr-vacation-form" onSubmit={submit}><div className="form-row"><label>Funcionário<select required value={form.funcionarioId} onChange={(e) => chooseLaunchEmployee(e.target.value)}><option value="">Selecione</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {employee.cpf}</option>)}</select></label><label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="agendada">Agendada</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select></label></div><div className="form-row"><label>Período aquisitivo debitado<input type="date" required readOnly disabled value={form.periodoAquisitivoInicio} /></label><label>Até<input type="date" required readOnly disabled value={form.periodoAquisitivoFim} />{selectedAcquisition && <small>{Math.max(0, 30 - selectedAcquisition.used)} dia(s) disponível(eis) neste período.</small>}</label></div><div className="form-row"><label>Início das férias<input required type="date" value={form.inicio} onChange={(e) => changeLaunchStart(e.target.value)} /></label><label>Dias de férias<input required min="5" max="30" step="1" type="number" value={form.dias} onChange={(e) => changeLaunchDays(e.target.value)} placeholder="Ex.: 15" /><small>Entre 5 e 30 dias corridos.</small></label><label>Fim calculado<input type="date" readOnly disabled value={form.fim} /></label><label>Retorno ao trabalho<input type="date" readOnly disabled value={form.retorno} /></label></div><div className="form-row vacation-upload-row"><label>PDF do aviso (opcional)<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectLaunchFile('aviso', event)} /><small>Até 10 MB, bucket privado.</small>{uploads.aviso && <small className="vacation-upload-selection">Selecionado: {uploads.aviso.name}</small>}</label><label>PDF do recibo (opcional)<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectLaunchFile('recibo', event)} /><small>Até 10 MB, bucket privado.</small>{uploads.recibo && <small className="vacation-upload-selection">Selecionado: {uploads.recibo.name}</small>}</label><label>Comprovante de pagamento (opcional)<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectLaunchFile('comprovante_pagamento', event)} /><small>Transferência ou pagamento ao funcionário.</small>{uploads.comprovante_pagamento && <small className="vacation-upload-selection">Selecionado: {uploads.comprovante_pagamento.name}</small>}</label></div><label>Observações<textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Abono, programação ou observações do RH" /></label><div className="hr-vacation-form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <RefreshCw className="spin" size={16} /> : <Check size={16} />} {saving ? 'Salvando…' : 'Salvar período de férias'}</button><button className="secondary-button" type="button" onClick={notifyEmployeeDraft}><BellRing size={16} /> Notificar funcionário</button></div></form>}
    {error && <div className="form-error"><X size={16} />{error}</div>}{message && <div className="form-success"><Check size={16} />{message}</div>}
    {selectedEmployee && <><div className="selected-vacation-employee"><div className="selected-vacation-identity"><div className="employee-avatar">{selectedEmployee.avatar_url ? <img src={selectedEmployee.avatar_url} alt={`Foto de ${selectedEmployee.nome}`} /> : initials(selectedEmployee.nome)}</div><div><strong>{selectedEmployee.nome}</strong><small>{selectedEmployee.cpf} · {selectedEmployee.cargo || 'Cargo não informado'} · Admissão: {formatDate(selectedEmployee.data_admissao || null)}</small></div></div><div className="vacation-record-toolbar"><div className="vacation-export-menu"><button className="secondary-button" type="button" onClick={() => setShowExportMenu((value) => !value)}><Download size={14} /> Exportar PDF <ChevronDown size={13} /></button>{showExportMenu && <div className="vacation-export-options"><button type="button" onClick={() => void exportVacationRecord()}>PDF do prontuário completo</button>{[...selectedEmployeeRows].sort((a, b) => b.periodo_aquisitivo_fim.localeCompare(a.periodo_aquisitivo_fim)).map((row) => <button type="button" key={row.id} onClick={() => void exportVacationRecord(row)}>PDF do período · {formatDate(row.periodo_aquisitivo_inicio)} a {formatDate(row.periodo_aquisitivo_fim)}</button>)}</div>}</div><button className="secondary-button" type="button" onClick={() => { setSelectedEmployeeId(null); setExpandedPeriodId(null); setShowExportMenu(false) }}>Trocar funcionário</button></div></div><div className="vacation-employee-summary"><div><span>Período aquisitivo atual</span><strong>{formatDate(selectedCurrentAcquisition?.periodo_aquisitivo_inicio || null)} até {formatDate(selectedCurrentAcquisition?.periodo_aquisitivo_fim || null)}</strong><small>Base de contagem vigente</small></div><div><span>Última fruição</span><strong>{selectedLastUsed ? `${formatDate(selectedLastUsed.inicio)} até ${formatDate(selectedLastUsed.fim)}` : 'Nenhuma registrada'}</strong><small>{selectedLastUsed ? `${selectedLastUsed.dias_gozo ?? '—'} dia(s) lançados` : 'Ainda não há férias concluídas'}</small></div><div><span>Histórico do funcionário</span><strong>{selectedEmployeeRows.length} período(s) cadastrado(s)</strong><small>{selectedUsedCount} fruição(ões) concluída(s)</small></div></div></>}
    {search.trim() && !selectedEmployeeId ? <div className="vacation-employee-results">{employeeSearchResults.length ? employeeSearchResults.map((employee) => { const periods = vacations.filter((row) => row.funcionario_id === employee.id); return <button type="button" className="vacation-employee-result" key={employee.id} onClick={() => setSelectedEmployeeId(employee.id)}><div className="employee-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt={`Foto de ${employee.nome}`} /> : initials(employee.nome)}</div><span><strong>{employee.nome}</strong><small>{employee.cpf} · {employee.cargo || 'Cargo não informado'}</small></span><b>{periods.length} período(s)</b><ChevronRight size={17} /></button> }) : <EmptyState title="Nenhum funcionário encontrado" description="Confira o nome, CPF ou cargo digitado." />}</div> : filteredVacations.length === 0 ? <EmptyState title={search.trim() ? 'Nenhum período encontrado' : 'Pesquise um funcionário'} description={search.trim() ? 'Ajuste o nome, CPF, cargo ou os filtros para visualizar os períodos.' : 'Digite nome, CPF ou cargo para carregar os períodos e documentos relacionados.'} /> : <><div className="vacation-period-section-heading"><div><span>Prontuário de férias</span><strong>{selectedEmployee?.nome || 'Funcionário selecionado'}</strong></div><small>Abra um período para consultar informações complementares e documentos.</small></div><div className="hr-vacation-list">{visibleVacations.map((row) => { const currentStatus = effectiveStatus(row, today); const employee = employees.find((item) => item.id === row.funcionario_id); const overdueCount = overdueByEmployee.get(row.funcionario_id) || 0; const editing = editingScheduleId === row.id; const expanded = expandedPeriodId === row.id; return <article className={`hr-vacation-row status-${currentStatus}${expanded ? ' is-expanded' : ''}`} key={row.id}><div className="employee-avatar">{employee?.avatar_url ? <img src={employee.avatar_url} alt={`Foto de ${row.nome}`} /> : initials(row.nome)}</div><div className="hr-vacation-main"><div className="vacation-period-heading"><div><span>Período aquisitivo</span><strong>{formatDate(row.periodo_aquisitivo_inicio)} até {formatDate(row.periodo_aquisitivo_fim)}</strong></div><div><span>Gozo lançado</span><strong>{formatDate(row.inicio)} até {formatDate(row.fim)} · {row.dias_gozo ?? '—'} dia(s)</strong></div></div>{overdueCount >= 2 && <small className="vacation-overdue-note"><AlertTriangle size={12} /> {overdueCount} períodos aquisitivos vencidos</small>}<div className="vacation-row-actions"><button type="button" className="secondary-button" onClick={() => setExpandedPeriodId(expanded ? null : row.id)}><FileText size={13} /> {expanded ? 'Fechar prontuário' : 'Abrir prontuário'}</button><button type="button" className="secondary-button" onClick={() => startReschedule(row)}><CalendarClock size={13} /> Reagendar</button>{editing && <div className="vacation-reschedule-editor"><label>Novo início<input type="date" value={scheduleDraft.inicio} onChange={(event) => setScheduleDraft((current) => ({ ...current, inicio: event.target.value }))} /></label><label>Novo fim<input type="date" value={scheduleDraft.fim} onChange={(event) => setScheduleDraft((current) => ({ ...current, fim: event.target.value }))} /></label><button type="button" className="primary-button" disabled={savingSchedule} onClick={() => void saveReschedule(row)}>{savingSchedule ? <RefreshCw className="spin" size={13} /> : <Save size={13} />} Salvar</button><button type="button" className="secondary-button" onClick={() => setEditingScheduleId(null)}>Cancelar</button></div>}</div>{expanded && <div className="vacation-period-record"><div className="vacation-record-status"><span>Status do período</span><strong>{statusLabel[currentStatus]}</strong></div><div><span>Pagamento previsto</span><strong>{formatDate(row.pagamento_previsto_em)}</strong></div><div><span>Pagamento efetivo</span><strong>{formatDate(row.pagamento_efetivo_em)}</strong></div><div><span>Retorno ao trabalho</span><strong>{formatDate(row.retorno_em)}</strong></div><div><span>Abono pecuniário</span><strong>{row.abono_solicitado ? `Sim${row.dias_abono ? ` · ${row.dias_abono} dia(s)` : ''}` : 'Não'}</strong></div><div><span>Observações</span><strong>{row.observacoes || 'Nenhuma observação registrada'}</strong></div><div className="vacation-record-documents"><span>Documentos deste período</span><div>{documentControl(row, 'aviso')}{documentControl(row, 'recibo')}{documentControl(row, 'comprovante_pagamento')}</div></div></div>}</div><StatusPill value={statusLabel[currentStatus] || currentStatus} /><select className={`vacation-status-select status-${currentStatus}`} value={currentStatus} disabled={busyId === row.id} onChange={(e) => void update(row, e.target.value)} aria-label={`Atualizar férias de ${row.nome}`}><option value="agendada">Agendada</option><option value="em_gozo">Em gozo</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select></article> })}</div><div className="vacation-pagination"><small>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredVacations.length)} de {filteredVacations.length}</small><div><button type="button" className="secondary-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} /> Anterior</button><strong>Página {page} de {pageCount}</strong><button type="button" className="secondary-button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Próxima <ChevronRight size={15} /></button></div></div></>}
  </SectionCard>
}
