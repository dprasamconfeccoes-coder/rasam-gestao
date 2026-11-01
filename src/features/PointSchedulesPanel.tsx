import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, CalendarClock, Check, ChevronDown, Clock3, LoaderCircle, Plus, RefreshCw, Save, Search, ShieldCheck, UserRound, X } from 'lucide-react'
import { ConfirmationModal, EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate } from '../components/ui'
import { assignPointSchedule, deactivatePointSchedule, listEmployeePointSchedules, listPointSchedules, savePointSchedule, searchEmployees } from '../lib/api'
import type { EmployeeRow, PointScheduleAssignment, PointScheduleMode, PointScheduleTemplate } from '../lib/types'
import { createEmptyScheduleWeek, distributeWeeklyMinutes, formatDuration, periodMinutes, scheduleWeeklyMinutes, validateSchedule, WEEK_DAYS, type WorkPeriod, type WorkScheduleWeek } from '../lib/point-schedules'
import './point-schedules.css'

type EditorState = { id: string | null; name: string; description: string; mode: PointScheduleMode; weeklyTarget: number; days: WorkScheduleWeek }
const newEditor = (): EditorState => ({ id: null, name: '', description: '', mode: 'horarios_fixos', weeklyTarget: 0, days: createEmptyScheduleWeek() })

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function maskedCpf(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : 'CPF não informado'
}

function employeeTypeLabel(value: string | null) {
  const labels: Record<string, string> = { formal: 'Formal / CLT', informal: 'Informal', experiencia: 'Experiência', diarista: 'Diarista' }
  return value ? labels[value] || value : 'Vínculo não informado'
}

function toEditor(template: PointScheduleTemplate): EditorState {
  const days = createEmptyScheduleWeek()
  Object.entries(template.dias_semana || {}).forEach(([key, value]) => {
    if (days[key]) days[key] = { ativo: Boolean(value.ativo), periodos: Array.isArray(value.periodos) ? value.periodos.map((item) => ({ inicio: item.inicio || '', fim: item.fim || '' })) : [], minutos: Number(value.minutos || 0) }
  })
  return { id: template.id, name: template.nome, description: template.descricao || '', mode: template.modo, weeklyTarget: Number(template.carga_semanal_minutos || 0), days }
}

function assignmentLabel(item: PointScheduleAssignment) {
  return `${item.jornada_nome} · versão ${item.jornada_versao}`
}

export function PointSchedulesPanel({ token }: { token: string }) {
  const [templates, setTemplates] = useState<PointScheduleTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templateError, setTemplateError] = useState('')
  const [editor, setEditor] = useState<EditorState>(newEditor)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<PointScheduleTemplate | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('')
  const [employeeResults, setEmployeeResults] = useState<EmployeeRow[]>([])
  const [employeeResultsTotal, setEmployeeResultsTotal] = useState(0)
  const [employeeLoading, setEmployeeLoading] = useState(false)
  const [employeeLoadingMore, setEmployeeLoadingMore] = useState(false)
  const [employeeError, setEmployeeError] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null)
  const [assignments, setAssignments] = useState<PointScheduleAssignment[]>([])
  const selectionRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const editorDialogRef = useRef<HTMLElement | null>(null)
  const savingRef = useRef(saving)
  savingRef.current = saving
  const [historyLoading, setHistoryLoading] = useState(false)
  const [assignmentId, setAssignmentId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(localDate)
  const [assigning, setAssigning] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')
  const [assignmentNotice, setAssignmentNotice] = useState('')

  async function reloadTemplates() {
    setTemplatesLoading(true)
    setTemplateError('')
    try {
      const result = await listPointSchedules(token)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível consultar as jornadas.')
      setTemplates(result.jornadas || [])
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : 'Falha ao consultar jornadas.')
    } finally { setTemplatesLoading(false) }
  }

  useEffect(() => { void reloadTemplates() }, [token])

  useEffect(() => {
    if (!editorOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = editorDialogRef.current
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : []
    focusables[0]?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!savingRef.current) { event.preventDefault(); setEditorOpen(false) }
        return
      }
      if (event.key !== 'Tab' || !focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocus?.focus() }
  }, [editorOpen])

  async function runEmployeeSearch(event: FormEvent) {
    event.preventDefault()
    if (employeeLoadingMore) return
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    const query = employeeQuery.trim()
    selectionRequestRef.current += 1
    setEmployeeLoading(true)
    setEmployeeLoadingMore(false)
    setEmployeeError('')
    setSelectedEmployee(null)
    setAssignments([])
    setHistoryLoading(false)
    setEmployeeResults([])
    setEmployeeResultsTotal(0)
    setEmployeeSearchTerm(query)
    try {
      const result = await searchEmployees(token, { busca: query, offset: 0, limite: 20 })
      if (requestId !== searchRequestRef.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível buscar funcionários.')
      setEmployeeResults(result.registros || [])
      setEmployeeResultsTotal(result.total || 0)
      if (!result.registros?.length) setEmployeeError('Nenhum funcionário encontrado. Tente outro nome ou CPF.')
    } catch (cause) {
      if (requestId !== searchRequestRef.current) return
      setEmployeeResults([])
      setEmployeeError(cause instanceof Error ? cause.message : 'Falha ao buscar funcionários.')
    } finally { if (requestId === searchRequestRef.current) setEmployeeLoading(false) }
  }

  async function loadMoreEmployees() {
    if (employeeLoadingMore || employeeLoading || employeeResults.length >= employeeResultsTotal) return
    const requestId = searchRequestRef.current
    const query = employeeSearchTerm
    const offset = employeeResults.length
    setEmployeeLoadingMore(true)
    setEmployeeError('')
    try {
      const result = await searchEmployees(token, { busca: query, offset, limite: 20 })
      if (requestId !== searchRequestRef.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar mais funcionários.')
      setEmployeeResults((current) => [...current, ...(result.registros || [])])
      setEmployeeResultsTotal(result.total || 0)
    } catch (cause) {
      if (requestId !== searchRequestRef.current) return
      setEmployeeError(cause instanceof Error ? cause.message : 'Falha ao carregar mais funcionários.')
    } finally { if (requestId === searchRequestRef.current) setEmployeeLoadingMore(false) }
  }

  async function selectEmployee(employee: EmployeeRow) {
    const requestId = selectionRequestRef.current + 1
    selectionRequestRef.current = requestId
    setSelectedEmployee(employee)
    setAssignmentError('')
    setAssignmentNotice('')
    setAssignmentId('')
    setHistoryLoading(true)
    setAssignments([])
    try {
      const result = await listEmployeePointSchedules(token, employee.id)
      if (requestId !== selectionRequestRef.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível consultar o histórico da jornada.')
      setAssignments(result.atribuicoes || [])
    } catch (cause) {
      if (requestId === selectionRequestRef.current) setAssignmentError(cause instanceof Error ? cause.message : 'Falha ao consultar o histórico da jornada.')
    } finally { if (requestId === selectionRequestRef.current) setHistoryLoading(false) }
  }

  function openNewEditor() {
    setEditor(newEditor())
    setError('')
    setNotice('')
    setEditorOpen(true)
  }

  function openEditEditor(template: PointScheduleTemplate) {
    setEditor(toEditor(template))
    setError('')
    setNotice('')
    setEditorOpen(true)
  }

  function setDayActive(dayKey: string, active: boolean) {
    setEditor((current) => ({ ...current, days: { ...current.days, [dayKey]: { ...current.days[dayKey], ativo: active, periodos: active && current.mode === 'horarios_fixos' && !current.days[dayKey].periodos.length ? [{ inicio: '', fim: '' }] : current.days[dayKey].periodos, minutos: active ? current.days[dayKey].minutos : 0 } } }))
  }

  function updatePeriod(dayKey: string, index: number, field: keyof WorkPeriod, value: string) {
    setEditor((current) => {
      const periods = current.days[dayKey].periodos.map((period, periodIndex) => periodIndex === index ? { ...period, [field]: value } : period)
      return { ...current, days: { ...current.days, [dayKey]: { ...current.days[dayKey], periodos: periods } } }
    })
  }

  function addPeriod(dayKey: string) {
    setEditor((current) => ({ ...current, days: { ...current.days, [dayKey]: { ...current.days[dayKey], periodos: [...current.days[dayKey].periodos, { inicio: '', fim: '' }] } } }))
  }

  function removePeriod(dayKey: string, index: number) {
    setEditor((current) => ({ ...current, days: { ...current.days, [dayKey]: { ...current.days[dayKey], periodos: current.days[dayKey].periodos.filter((_, periodIndex) => periodIndex !== index) } } }))
  }

  function setWeeklyTarget(value: number) {
    const normalized = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
    setEditor((current) => ({ ...current, weeklyTarget: normalized }))
  }

  function distributeLoad() {
    setEditor((current) => {
      const activeKeys = WEEK_DAYS.filter(({ key }) => current.days[key].ativo).map(({ key }) => key)
      const allocation = distributeWeeklyMinutes(current.weeklyTarget, activeKeys)
      const days = { ...current.days }
      WEEK_DAYS.forEach(({ key }) => { days[key] = { ...days[key], minutos: allocation[key] || 0 } })
      return { ...current, days }
    })
  }

  function setDailyLoad(dayKey: string, field: 'hours' | 'minutes', value: number) {
    setEditor((current) => {
      const old = current.days[dayKey].minutos
      const hours = field === 'hours' ? Math.max(0, Math.min(168, Math.trunc(value || 0))) : Math.floor(old / 60)
      const minutes = field === 'minutes' ? Math.max(0, Math.min(59, Math.trunc(value || 0))) : old % 60
      return { ...current, days: { ...current.days, [dayKey]: { ...current.days[dayKey], minutos: hours * 60 + minutes } } }
    })
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (editor.name.trim().length < 2) { setError('Informe um nome de jornada com pelo menos 2 caracteres.'); return }
    const invalid = validateSchedule(editor.mode, editor.days, editor.weeklyTarget)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    try {
      const weeklyMinutes = scheduleWeeklyMinutes(editor.mode, editor.days)
      const result = await savePointSchedule(token, {
        id: editor.id,
        nome: editor.name.trim(),
        descricao: editor.description.trim() || null,
        modo: editor.mode,
        cargaSemanalMinutos: weeklyMinutes,
        diasSemana: editor.days,
      })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar a jornada.')
      setEditorOpen(false)
      setNotice(editor.id ? 'Nova versão criada. As atribuições existentes continuam vinculadas à versão anterior até que você programe a mudança.' : 'Jornada criada e disponível para atribuição.')
      await reloadTemplates()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar a jornada.')
    } finally { setSaving(false) }
  }

  async function confirmDeactivate() {
    if (!confirmation) return
    setDeactivating(true)
    setTemplateError('')
    try {
      const result = await deactivatePointSchedule(token, confirmation.id)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível inativar a jornada.')
      setConfirmation(null)
      setNotice('Modelo inativado. O histórico e as jornadas já atribuídas foram preservados.')
      await reloadTemplates()
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : 'Falha ao inativar a jornada.')
    } finally { setDeactivating(false) }
  }

  async function submitAssignment(event: FormEvent) {
    event.preventDefault()
    if (!selectedEmployee) return
    setAssignmentError('')
    setAssignmentNotice('')
    if (!assignmentId) { setAssignmentError('Selecione uma jornada ativa.'); return }
    if (!effectiveDate) { setAssignmentError('Informe a data de vigência.'); return }
    setAssigning(true)
    try {
      const result = await assignPointSchedule(token, selectedEmployee.id, assignmentId, effectiveDate)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível atribuir a jornada.')
      const successMessage = `Jornada registrada com vigência a partir de ${formatDate(effectiveDate)}.`
      await selectEmployee(selectedEmployee)
      setAssignmentNotice(successMessage)
    } catch (cause) {
      setAssignmentError(cause instanceof Error ? cause.message : 'Falha ao atribuir jornada.')
    } finally { setAssigning(false) }
  }

  const weeklyTotal = useMemo(() => scheduleWeeklyMinutes(editor.mode, editor.days), [editor.mode, editor.days])
  const currentAssignment = assignments.find((item) => !item.vigencia_fim || item.vigencia_fim >= localDate())

  return <>
    <PageHeading eyebrow="Gestão de ponto · organização" title="Jornadas de trabalho" description="Cadastre modelos semanais, atribua-os por vigência e preserve o histórico de cada mudança." action={<button type="button" className="primary-button" onClick={openNewEditor}><Plus size={16} /> Nova jornada</button>} />
    <div className="schedule-disclaimer"><ShieldCheck size={17} /><span><strong>Comparação operacional.</strong> Os horários e cargas configurados servem para consulta de previsto versus realizado; não calculam adicional legal, banco de horas ou desconto. Os campos legados de horário em texto não são alterados nem convertidos automaticamente.</span></div>
    {notice ? <div className="schedule-feedback is-success" role="status"><Check size={16} />{notice}<button type="button" className="icon-button" onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15} /></button></div> : null}
    <div className="schedule-management-grid">
      <SectionCard title="Modelos de jornada" caption="Editar cria uma nova versão e preserva as versões já atribuídas.">
        {templatesLoading ? <LoadingState label="Carregando modelos de jornada…" /> : templateError ? <ErrorState message={templateError} /> : templates.length === 0 ? <EmptyState title="Nenhuma jornada cadastrada" description="Crie um modelo semanal por horários fixos ou por carga horária distribuída." /> : <div className="schedule-template-list">{templates.map((template) => <article className="schedule-template-card" key={template.id}>
          <div className="schedule-template-main"><div className="schedule-template-icon"><CalendarClock size={19} /></div><div><strong>{template.nome}</strong><small>Versão {template.versao} · {template.modo === 'horarios_fixos' ? 'Horários fixos' : 'Carga semanal'} · {formatDuration(template.carga_semanal_minutos)} por semana</small>{template.descricao ? <p>{template.descricao}</p> : null}</div></div>
          <div className="schedule-template-actions"><button type="button" className="secondary-button" onClick={() => openEditEditor(template)}><Save size={14} /> Editar</button><button type="button" className="text-button schedule-deactivate" onClick={() => setConfirmation(template)}>Inativar</button></div>
        </article>)}</div>}
      </SectionCard>
      <SectionCard title="Atribuir jornada" caption="Escolha uma pessoa e a data de início; o sistema mantém as vigências anteriores.">
        <form className="schedule-employee-search" onSubmit={(event) => void runEmployeeSearch(event)}><label>Buscar funcionário<input value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Nome ou CPF" autoComplete="off" disabled={employeeLoading || employeeLoadingMore} /></label><button type="submit" className="secondary-button" disabled={employeeLoading || employeeLoadingMore}>{employeeLoading || employeeLoadingMore ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />} Buscar</button></form>
        {employeeError ? <div className="form-error schedule-inline-error" role="alert"><AlertCircle size={15} />{employeeError}</div> : null}
        {employeeResults.length ? <div className="schedule-employee-results" aria-label="Resultados da busca">{employeeResults.map((employee) => <button key={employee.id} type="button" className={`schedule-employee-result${selectedEmployee?.id === employee.id ? ' is-selected' : ''}`} onClick={() => void selectEmployee(employee)} disabled={assigning}><span className="schedule-employee-avatar"><UserRound size={16} /></span><span><strong>{employee.nome}</strong><small>{employeeTypeLabel(employee.tipo_vinculo)} · {maskedCpf(employee.cpf)}</small></span><StatusPill value={employee.situacao} /></button>)}</div> : null}
        {employeeResults.length > 0 && employeeResults.length < employeeResultsTotal ? <button type="button" className="secondary-button schedule-load-more" onClick={() => void loadMoreEmployees()} disabled={employeeLoadingMore || employeeLoading}><ChevronDown size={15} className={employeeLoadingMore ? 'spin' : ''} /> {employeeLoadingMore ? 'Carregando…' : `Carregar mais (${employeeResults.length} de ${employeeResultsTotal})`}</button> : null}
        {selectedEmployee ? <div className="schedule-employee-detail"><div className="schedule-selected-employee"><div><span className="eyebrow">Funcionário selecionado</span><strong>{selectedEmployee.nome}</strong><small>{employeeTypeLabel(selectedEmployee.tipo_vinculo)} · {selectedEmployee.cargo || 'Cargo não informado'}</small></div><button type="button" className="icon-button" onClick={() => { selectionRequestRef.current += 1; setHistoryLoading(false); setSelectedEmployee(null); setAssignments([]); setAssignmentNotice(''); setAssignmentError('') }} disabled={assigning} aria-label="Limpar funcionário selecionado"><X size={15} /></button></div>
          {currentAssignment ? <div className="schedule-current-assignment"><span>Jornada vigente ou futura</span><strong>{assignmentLabel(currentAssignment)}</strong><small>Desde {formatDate(currentAssignment.vigencia_inicio)}{currentAssignment.vigencia_fim ? ` até ${formatDate(currentAssignment.vigencia_fim)}` : ''}</small></div> : <div className="schedule-legacy-note">Sem jornada estruturada no período. Se houver horários legados no cadastro, eles continuam preservados e não são interpretados automaticamente.</div>}
          <form className="schedule-assign-form" onSubmit={(event) => void submitAssignment(event)}><label>Jornada ativa<select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)} required><option value="">Selecione um modelo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.nome} · v{template.versao} · {formatDuration(template.carga_semanal_minutos)}</option>)}</select></label><label>Vigência a partir de<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required /></label><button type="submit" className="primary-button" disabled={assigning || historyLoading || templates.length === 0}>{assigning ? <RefreshCw size={15} className="spin" /> : <Check size={15} />} Atribuir jornada</button></form>
          {assignmentNotice ? <div className="schedule-feedback is-success" role="status"><Check size={15} />{assignmentNotice}</div> : null}
          {assignmentError ? <div className="form-error schedule-inline-error" role="alert"><AlertCircle size={15} />{assignmentError}</div> : null}
          {historyLoading ? <LoadingState label="Carregando histórico de jornadas…" /> : assignments.length ? <div className="schedule-history"><strong>Histórico de vigências</strong>{assignments.map((item) => <div className="schedule-history-row" key={item.id}><Clock3 size={15} /><span><b>{assignmentLabel(item)}</b><small>{formatDate(item.vigencia_inicio)}{item.vigencia_fim ? ` – ${formatDate(item.vigencia_fim)}` : ' – vigente'}</small></span></div>)}</div> : null}
        </div> : null}
      </SectionCard>
    </div>
    {editorOpen ? <div className="schedule-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditorOpen(false) }}><section ref={editorDialogRef} className="schedule-editor-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-editor-title"><div className="schedule-editor-heading"><div><span className="eyebrow">{editor.id ? 'Nova versão do modelo' : 'Novo modelo semanal'}</span><h2 id="schedule-editor-title">{editor.id ? 'Editar jornada' : 'Criar jornada'}</h2><p>Configure o formato, a semana de trabalho e confira a carga calculada antes de salvar.</p></div><button className="icon-button" type="button" onClick={() => setEditorOpen(false)} disabled={saving} aria-label="Fechar formulário"><X size={18} /></button></div>
      <form className="schedule-editor-form" onSubmit={(event) => void saveTemplate(event)}><div className="schedule-editor-fields"><label>Nome da jornada<input value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} maxLength={100} placeholder="Ex.: Jornada de produção" required /></label><label>Descrição (opcional)<input value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))} maxLength={500} placeholder="Observações de uso deste modelo" /></label></div>
        <div className="schedule-mode-switch" role="radiogroup" aria-label="Modelo de jornada"><label className={editor.mode === 'horarios_fixos' ? 'is-selected' : ''}><input type="radio" name="schedule-mode" value="horarios_fixos" checked={editor.mode === 'horarios_fixos'} onChange={() => setEditor((current) => ({ ...current, mode: 'horarios_fixos' }))} /><Clock3 size={17} /><span><strong>Horários fixos</strong><small>Entrada, saída e intervalos por dia</small></span></label><label className={editor.mode === 'carga_semanal' ? 'is-selected' : ''}><input type="radio" name="schedule-mode" value="carga_semanal" checked={editor.mode === 'carga_semanal'} onChange={() => setEditor((current) => ({ ...current, mode: 'carga_semanal' }))} /><CalendarClock size={17} /><span><strong>Carga semanal</strong><small>Distribuição de horas por dia</small></span></label></div>
        {editor.mode === 'carga_semanal' ? <div className="schedule-weekly-target"><label>Carga total semanal (horas)<input type="number" min={0} max={168} step={1} value={Math.floor(editor.weeklyTarget / 60)} onChange={(event) => setWeeklyTarget(Number(event.target.value || 0) * 60 + (editor.weeklyTarget % 60))} /></label><label>Minutos adicionais<input type="number" min={0} max={59} step={1} value={editor.weeklyTarget % 60} onChange={(event) => setWeeklyTarget(Math.floor(editor.weeklyTarget / 60) * 60 + Number(event.target.value || 0))} /></label><button type="button" className="secondary-button" onClick={distributeLoad}><CalendarClock size={15} /> Distribuir entre dias ativos</button><small>Exemplo: 44 horas em 5 dias distribuem 8h48 por dia; você pode ajustar os dias e corrigir a soma manualmente.</small></div> : null}
        <div className="schedule-days-grid">{WEEK_DAYS.map(({ key, label }) => { const day = editor.days[key]; return <article className={`schedule-day-card${day.ativo ? ' is-active' : ''}`} key={key}><label className="schedule-day-toggle"><input type="checkbox" checked={day.ativo} onChange={(event) => setDayActive(key, event.target.checked)} /><strong>{label}</strong><span>{day.ativo ? 'Trabalho previsto' : 'Descanso'}</span></label>{day.ativo && editor.mode === 'horarios_fixos' ? <div className="schedule-period-list">{day.periodos.map((period, index) => <div className="schedule-period-row" key={`${key}-${index}`}><label><span>Início {index + 1}</span><input type="time" value={period.inicio} onChange={(event) => updatePeriod(key, index, 'inicio', event.target.value)} required /></label><label><span>Fim {index + 1}</span><input type="time" value={period.fim} onChange={(event) => updatePeriod(key, index, 'fim', event.target.value)} required /></label>{day.periodos.length > 1 ? <button type="button" className="icon-button schedule-remove-period" onClick={() => removePeriod(key, index)} aria-label={`Remover período ${index + 1} de ${label}`}><X size={14} /></button> : null}</div>)}{day.periodos.length < 4 ? <button type="button" className="text-button schedule-add-period" onClick={() => addPeriod(key)}><Plus size={14} /> Adicionar período</button> : null}<small className="schedule-day-total">{formatDuration(day.periodos.reduce((sum, period) => sum + periodMinutes(period), 0))} no dia</small></div> : null}{day.ativo && editor.mode === 'carga_semanal' ? <div className="schedule-day-load"><label><span>Horas</span><input type="number" min={0} max={168} step={1} value={Math.floor(day.minutos / 60)} onChange={(event) => setDailyLoad(key, 'hours', Number(event.target.value || 0))} /></label><label><span>Minutos</span><input type="number" min={0} max={59} step={1} value={day.minutos % 60} onChange={(event) => setDailyLoad(key, 'minutes', Number(event.target.value || 0))} /></label></div> : null}</article> })}</div>
        <div className="schedule-editor-summary"><span><Clock3 size={16} /> Carga semanal calculada</span><strong>{formatDuration(weeklyTotal)}</strong>{editor.mode === 'carga_semanal' && weeklyTotal !== editor.weeklyTarget ? <small>Faltam {formatDuration(Math.abs(editor.weeklyTarget - weeklyTotal))} para fechar a carga informada.</small> : null}</div>
        {error ? <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div> : null}
        <div className="schedule-editor-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)} disabled={saving}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <RefreshCw size={16} className="spin" /> : <Save size={16} />} {editor.id ? 'Criar nova versão' : 'Salvar jornada'}</button></div>
      </form></section></div> : null}
    {confirmation ? <ConfirmationModal title="Inativar modelo de jornada?" description={`“${confirmation.nome}” deixará de aparecer para novas atribuições. Os vínculos e os registros históricos existentes serão mantidos.`} confirmLabel="Inativar modelo" busy={deactivating} onCancel={() => setConfirmation(null)} onConfirm={() => void confirmDeactivate()} /> : null}
  </>
}
