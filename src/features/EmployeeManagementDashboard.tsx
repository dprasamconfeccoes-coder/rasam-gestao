import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BriefcaseBusiness, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, UserPlus, UserRound, X } from 'lucide-react'
import { adminCadastrarFuncionario, adminFichaCompleta, adminProntuario, searchEmployees } from '../lib/api'
import type { EmployeeRow, EmployeeSearchPage, ProntuarioResponse, Profile } from '../lib/types'
import { displayValue, EmployeeFichaPanel, fieldGroups, type FieldDefinition } from './EmployeeFichaPanel'
import { EmptyState, ErrorState, LoadingState, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import { EmployeeTimeline } from './EmployeeTimeline'
import { clearPersistentState, usePersistentState } from '../lib/persistent-state'
import './employee-directory.css'

type FilterState = { busca: string; situacao: string; tipoVinculo: string; cargo: string; salarioMin: string; salarioMax: string }
type FormState = { fields: Record<string, string>; tipoVinculo: string; liberarAcesso: boolean }
type TabKey = 'resumo' | 'ficha' | 'atestados' | 'afastamentos' | 'justificativas' | 'advertencias' | 'ferias' | 'documentos' | 'ponto' | 'holerites' | 'beneficios' | 'descontos' | 'timeline'

const emptyFilters: FilterState = { busca: '', situacao: '', tipoVinculo: '', cargo: '', salarioMin: '', salarioMax: '' }
const fichaFields = fieldGroups.flatMap((group) => group.fields)
const registrationFieldGroups = fieldGroups.map((group) => ({
  ...group,
  fields: group.fields.filter((field) => !['nome', 'cpf', 'data_nascimento', 'data_saida', 'tipo_desligamento', 'valor_diaria'].includes(field.key)),
})).filter((group) => group.fields.length > 0)

function createInitialForm(): FormState {
  const fields = Object.fromEntries(fichaFields.map((field): [string, string] => [field.key, ''])) as Record<string, string>
  fields.valor_diaria = ''
  return { fields, tipoVinculo: '', liberarAcesso: false }
}

const tabs: Array<[TabKey, string]> = [
  ['resumo', 'Resumo'], ['ficha', 'Ficha completa'], ['timeline', 'Linha do tempo'], ['ponto', 'Ponto'], ['atestados', 'Atestados'], ['afastamentos', 'Afastamentos'],
  ['justificativas', 'Justificativas'], ['advertencias', 'Advertências'], ['ferias', 'Férias'], ['documentos', 'Documentos'],
  ['holerites', 'Holerites'], ['beneficios', 'Benefícios'], ['descontos', 'Descontos'],
]

function parseMoney(value: string) {
  if (!value.trim()) return null
  const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function maskedCpf(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : value
}

function employeeCompensation(employee: EmployeeRow) {
  if (employee.tipo_vinculo === 'diarista') return employee.valor_diaria == null ? 'Diária não informada' : `${formatMoney(Number(employee.valor_diaria))} / diária`
  const monthly = employee.valor_mensal ?? employee.salario
  return monthly == null ? 'Remuneração não informada' : `${formatMoney(Number(monthly))} / mês`
}

function employeeContractLabel(value: string | null | undefined) {
  const labels: Record<string, string> = { formal: 'Formal / CLT', informal: 'Informal', experiencia: 'Experiência', diarista: 'Diarista' }
  const key = (value || '').trim().toLowerCase()
  return labels[key] || value || 'Vínculo não informado'
}

function readText(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key]
    if (value !== null && value !== undefined && String(value).trim()) return String(value)
  }
  return '—'
}

function RecordList({ items }: { items: Array<Record<string, unknown>> }) {
  if (!items.length) return <EmptyState title="Nenhum registro nesta seção" description="Novos registros vinculados ao funcionário aparecerão aqui." />
  return <div className="employee-record-list">{items.map((item, index) => {
    const title = readText(item, ['beneficio_nome', 'nome', 'titulo', 'tipo', 'evento', 'arquivo_nome', 'status_label', 'status'])
    const date = readText(item, ['competencia', 'data_atendimento', 'data_registro', 'data', 'data_evento', 'data_ocorrencia', 'inicio', 'created_at'])
    const description = readText(item, ['descricao', 'motivo', 'observacao', 'medida', 'resposta_rh', 'observacoes', 'arquivo_nome'])
    const status = readText(item, ['status_label', 'status', 'situacao'])
    return <article className="employee-record-item" key={String(item.id || index)}><div><strong>{title}</strong><small>{formatDate(date)}{description !== '—' ? ` · ${description}` : ''}{item.fim ? ` · até ${formatDate(String(item.fim))}` : ''}</small></div><span className="employee-record-value">{item.valor !== undefined && item.valor !== null ? formatMoney(Number(item.valor)) : <StatusPill value={status === '—' ? null : status} />}</span></article>
  })}</div>
}

export function EmployeeRegistrationWizard({ open, token, onClose, onCreated }: { open: boolean; token: string; onClose: () => void; onCreated: (id: string, cpf: string) => void }) {
  const draftKey = 'rf-gestao-draft-funcionario-v1'
  const [form, setForm] = usePersistentState<FormState>(draftKey, createInitialForm())
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setStep(0); setError('') }
  }, [open])

  if (!open) return null

  const isClt = form.tipoVinculo === 'formal'
  const isDiarista = form.tipoVinculo === 'diarista'
  const typeLabel = isClt ? 'CLT / vínculo formal' : isDiarista ? 'Diarista' : form.tipoVinculo === 'experiencia' ? 'Experiência' : 'Informal'
  const stepLabels = isClt
    ? ['Tipo e identificação', 'Ficha CLT', 'Revisão']
    : isDiarista
      ? ['Tipo e identificação', 'Revisão']
      : ['Tipo e identificação', 'Vínculo e contato', 'Revisão']
  const finalStep = stepLabels.length - 1

  function setField(key: string, value: string) {
    setForm((current) => ({ ...current, fields: { ...current.fields, [key]: value } }))
  }

  function validateStep() {
    setError('')
    if (step === 0) {
      if (!form.tipoVinculo) return setError('Selecione o tipo de vínculo.')
      if ((form.fields.nome || '').trim().length < 2) return setError('Informe o nome completo.')
      if ((form.fields.cpf || '').replace(/\D/g, '').length !== 11) return setError('Informe um CPF com 11 dígitos.')
      if (isClt && !form.fields.data_nascimento) return setError('Informe a data de nascimento para o cadastro CLT.')
      if (isDiarista && !form.fields.data_nascimento) return setError('Informe a data de nascimento para o cadastro da diarista.')
      if (isDiarista && !(form.fields.cargo || '').trim()) return setError('Informe o cargo ou função da diarista.')
      if (isDiarista) {
        const dailyRate = parseMoney(form.fields.valor_diaria || '')
        if (!(dailyRate && dailyRate > 0)) return setError('Informe o valor individual da diária, maior que zero.')
      }
    }
    if (step === 1 && isClt) {
      const salary = parseMoney(form.fields.salario || '')
      if (!form.fields.data_admissao) return setError('Informe a data de admissão para o cadastro CLT.')
      if (!(salary && salary > 0)) return setError('Informe o salário mensal para o cadastro CLT.')
    }
    setStep((current) => Math.min(finalStep, current + 1))
  }

  function renderFichaField(field: FieldDefinition) {
    return <label className={`employee-ficha-field${field.kind === 'textarea' ? ' is-wide' : ''}`} key={field.key}>
      <span>{field.label}{field.required ? ' *' : ''}</span>
      {field.kind === 'textarea' ? <textarea rows={3} maxLength={field.maxLength} value={form.fields[field.key] || ''} onChange={(event) => setField(field.key, event.target.value)} /> : <input
        type={field.kind === 'date' ? 'date' : 'text'}
        inputMode={field.kind === 'number' ? 'decimal' : field.key === 'cpf' ? 'numeric' : undefined}
        maxLength={field.kind === 'text' || field.kind === undefined ? field.maxLength : undefined}
        value={form.fields[field.key] || ''}
        onChange={(event) => setField(field.key, field.kind === 'number' ? event.target.value.replace(/[^0-9,.]/g, '') : event.target.value)}
      />}
    </label>
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (step < finalStep) { validateStep(); return }
    setError('')
    const cpf = (form.fields.cpf || '').replace(/\D/g, '')
    if (form.liberarAcesso && !form.fields.data_nascimento) return setError('Informe a data de nascimento para criar o acesso ao portal.')
    if (isDiarista && !form.fields.data_nascimento) return setError('Informe a data de nascimento para o cadastro da diarista.')
    if (isDiarista && !(form.fields.cargo || '').trim()) return setError('Informe o cargo ou função da diarista.')
    if (isDiarista && !((parseMoney(form.fields.valor_diaria || '') || 0) > 0)) return setError('Informe o valor individual da diária, maior que zero.')
    setSaving(true)
    try {
      const ficha = Object.fromEntries(fichaFields.map((field) => {
        const value = (form.fields[field.key] || '').trim()
        return [field.key, field.kind === 'number' ? parseMoney(value) : value || null]
      })) as Record<string, string | number | null>
      const basicFields: Record<string, string | number | boolean | null> = isDiarista
        ? {
            nome: (form.fields.nome || '').trim(),
            cpf,
            data_nascimento: form.fields.data_nascimento || null,
            cargo: (form.fields.cargo || '').trim(),
            valor_diaria: parseMoney(form.fields.valor_diaria || ''),
          }
        : isClt
          ? { ...ficha }
          : {
              nome: (form.fields.nome || '').trim(),
              cpf,
              data_nascimento: form.fields.data_nascimento || null,
              cargo: (form.fields.cargo || '').trim() || null,
              endereco: (form.fields.endereco || '').trim() || null,
              telefone_celular: (form.fields.telefone_celular || '').trim() || null,
              salario: parseMoney(form.fields.salario || ''),
            }
      const payload = { ...basicFields, tipo_vinculo: form.tipoVinculo, liberar_acesso: form.liberarAcesso }
      const result = await adminCadastrarFuncionario(token, payload)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível cadastrar o funcionário.')
      onCreated(result.funcionario_id || '', cpf)
      clearPersistentState(draftKey)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao cadastrar funcionário.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="employee-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <section className={`employee-create-modal employee-wizard${isClt ? ' is-clt' : ''}`} role="dialog" aria-modal="true" aria-labelledby="employee-wizard-title">
      <div className="employee-create-heading"><div><span className="eyebrow">Novo cadastro · departamento pessoal</span><h2 id="employee-wizard-title">Cadastrar funcionário</h2><p>Para diarista, informe nome, CPF, nascimento, cargo e valor individual da diária.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Fechar cadastro"><X size={18} /></button></div>
      <div className="employee-wizard-progress" aria-label={`Etapa ${step + 1} de ${stepLabels.length}`}>{stepLabels.map((label, index) => <div className={index <= step ? 'is-current' : ''} key={label}><span>{index + 1}</span><small>{label}</small></div>)}</div>
      <form className="employee-create-form" onSubmit={(event) => void submit(event)}>
        {step === 0 ? <div className="employee-form-section"><strong>Tipo e identificação</strong><div className="employee-form-grid">
          <label className="employee-form-wide">Tipo de vínculo *<select required autoFocus value={form.tipoVinculo} onChange={(event) => { setForm((current) => ({ ...current, tipoVinculo: event.target.value })); setStep(0); setError('') }}><option value="">Selecione o vínculo</option><option value="formal">CLT / Formal</option><option value="diarista">Diarista</option><option value="informal">Informal (legado)</option><option value="experiencia">Experiência (legado)</option></select></label>
          <label>Nome completo *<input required autoComplete="name" value={form.fields.nome || ''} onChange={(event) => setField('nome', event.target.value)} placeholder="Nome e sobrenome" /></label>
          <label>CPF *<input required inputMode="numeric" maxLength={14} autoComplete="off" value={form.fields.cpf || ''} onChange={(event) => setField('cpf', event.target.value)} placeholder="000.000.000-00" /></label>
          {isClt || isDiarista ? <label>Data de nascimento *<input required type="date" value={form.fields.data_nascimento || ''} onChange={(event) => setField('data_nascimento', event.target.value)} /></label> : null}
          {isDiarista ? <label>Cargo / função *<input required maxLength={50} value={form.fields.cargo || ''} onChange={(event) => setField('cargo', event.target.value)} placeholder="Ex.: Costureira" /></label> : null}
          {isDiarista ? <label>Valor individual da diária *<input required type="number" inputMode="decimal" min="0.01" step="0.01" value={form.fields.valor_diaria || ''} onChange={(event) => setField('valor_diaria', event.target.value)} placeholder="R$ 0,00" /></label> : null}
        </div><small className="employee-form-help">O CPF será validado novamente pelo servidor. O valor é específico desta diarista e não é convertido em salário mensal.</small></div> : null}
        {step === 1 && isClt ? <div className="employee-form-section"><strong>Ficha completa do vínculo CLT</strong><p className="employee-form-help">Campos organizados conforme a ficha funcional disponível no sistema. Para concluir o cadastro CLT, informe admissão e salário mensal; os demais dados podem ficar vazios e ser completados depois.</p><div className="employee-ficha-groups employee-create-clt-groups">
          {registrationFieldGroups.map((group, groupIndex) => <details className="employee-ficha-group" key={group.title} open={groupIndex === 0 || group.title.includes('Vínculo')}><summary>{group.title}</summary><div className="employee-ficha-grid">{group.fields.map(renderFichaField)}</div></details>)}
        </div></div> : null}
        {step === 1 && !isClt && !isDiarista ? <div className="employee-form-section"><strong>Vínculo e contato</strong><div className="employee-form-grid">
          <label>Cargo<input value={form.fields.cargo || ''} onChange={(event) => setField('cargo', event.target.value)} placeholder="Ex.: Costureira" /></label>
          <label>Valor mensal (opcional)<input inputMode="decimal" value={form.fields.salario || ''} onChange={(event) => setField('salario', event.target.value.replace(/[^0-9,.]/g, ''))} placeholder="R$ 0,00" /></label>
          <label>Telefone<input autoComplete="tel" value={form.fields.telefone_celular || ''} onChange={(event) => setField('telefone_celular', event.target.value)} placeholder="(00) 00000-0000" /></label>
          <label className="employee-form-wide">Endereço<input autoComplete="street-address" value={form.fields.endereco || ''} onChange={(event) => setField('endereco', event.target.value)} placeholder="Rua, número, bairro e cidade" /></label>
        </div></div> : null}
        {step === finalStep ? <>
          <SectionCard title="Revisão do cadastro" caption="Confira o tipo de vínculo e os dados antes de concluir"><div className="employee-wizard-review"><p><strong>Nome:</strong> {form.fields.nome || '—'}</p><p><strong>CPF:</strong> {maskedCpf(form.fields.cpf || '')}</p><p><strong>Vínculo:</strong> {typeLabel}</p>{isClt ? <><p><strong>Admissão:</strong> {formatDate(form.fields.data_admissao || '')}</p><p><strong>Salário mensal:</strong> {form.fields.salario ? formatMoney(parseMoney(form.fields.salario) || 0) : 'Não informado'}</p><p><strong>Campos da ficha:</strong> {registrationFieldGroups.flatMap((group) => group.fields).filter((field) => Boolean(form.fields[field.key]?.trim())).length} preenchido(s)</p></> : isDiarista ? <><p><strong>Nascimento:</strong> {formatDate(form.fields.data_nascimento || '')}</p><p><strong>Cargo / função:</strong> {form.fields.cargo || '—'}</p><p><strong>Valor da diária:</strong> {formatMoney(parseMoney(form.fields.valor_diaria || '') || 0)}</p></> : <><p><strong>Cargo:</strong> {form.fields.cargo || 'Não informado'}</p><p><strong>Remuneração mensal:</strong> {form.fields.salario ? formatMoney(parseMoney(form.fields.salario) || 0) : 'Não informada'}</p></>}</div></SectionCard>
          <div className="employee-form-section"><strong>Portal do funcionário</strong><label className="check-line employee-access-toggle"><input type="checkbox" checked={form.liberarAcesso} onChange={(event) => setForm((current) => ({ ...current, liberarAcesso: event.target.checked }))} /> Criar acesso ao portal agora</label>{form.liberarAcesso && !form.fields.data_nascimento ? <label>Data de nascimento *<input required type="date" value={form.fields.data_nascimento || ''} onChange={(event) => setField('data_nascimento', event.target.value)} /></label> : null}<small className="employee-form-help">O acesso é opcional e começa desativado. O fluxo atual usa a data de nascimento como senha inicial e exige troca no primeiro acesso; entregue a credencial por canal privado.</small></div>
        </> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="employee-create-actions"><button className="secondary-button" type="button" onClick={step === 0 ? onClose : () => { setError(''); setStep((current) => Math.max(0, current - 1)) }} disabled={saving}>{step === 0 ? 'Fechar e salvar rascunho' : 'Voltar'}</button><button className="primary-button" type={step < finalStep ? 'button' : 'submit'} onClick={step < finalStep ? validateStep : undefined} disabled={saving}>{saving ? <><RefreshCw size={16} className="spin" /> Salvando…</> : step < finalStep ? <>Continuar <ChevronRight size={16} /></> : <><Plus size={16} /> Concluir cadastro</>}</button></div>
      </form>
    </section>
  </div>
}

export function EmployeeManagementDashboard({ token, profile }: { token: string; profile: Profile }) {
  const [filters, setFilters] = usePersistentState<FilterState>('rf-gestao-context-employees-v1', emptyFilters)
  const [activeFilters, setActiveFilters] = useState<FilterState>(emptyFilters)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [page, setPage] = useState<EmployeeSearchPage | null>(null)
  const [pageNumber, setPageNumber] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<EmployeeRow | null>(null)
  const [record, setRecord] = useState<ProntuarioResponse | null>(null)
  const [recordLoading, setRecordLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [tab, setTab] = useState<TabKey>('resumo')
  const [suggestions, setSuggestions] = useState<EmployeeRow[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editFichaOpen, setEditFichaOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const searchSequence = useRef(0)
  const recordSequence = useRef(0)
  const recordPanelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const query = filters.busca.trim()
    if (query.length < 2 || !suggestionsOpen) { setSuggestions([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true)
      try {
        const result = await searchEmployees(token, { busca: query, limite: 8 })
        if (!cancelled && result.sucesso) setSuggestions(result.registros || [])
      } catch { if (!cancelled) setSuggestions([]) }
      finally { if (!cancelled) setSuggestionsLoading(false) }
    }, 280)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [filters.busca, suggestionsOpen, token])

  async function runSearch(nextFilters: FilterState = filters, nextPage = 0) {
    const requestId = ++searchSequence.current
    setLoading(true); setError(''); setNotice(''); setPage(null); setActiveFilters(nextFilters); setPageNumber(nextPage)
    try {
      const result = await searchEmployees(token, { busca: nextFilters.busca, situacao: nextFilters.situacao, tipoVinculo: nextFilters.tipoVinculo, cargo: nextFilters.cargo, salarioMin: parseMoney(nextFilters.salarioMin), salarioMax: parseMoney(nextFilters.salarioMax), offset: nextPage * 20, limite: 20 })
      if (requestId !== searchSequence.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Falha ao buscar funcionários.')
      setPage(result)
    } catch (cause) { if (requestId === searchSequence.current) setError(cause instanceof Error ? cause.message : 'Falha ao buscar funcionários.') }
    finally { if (requestId === searchSequence.current) setLoading(false) }
  }

  async function openRecord(employee: EmployeeRow) {
    const requestId = ++recordSequence.current
    setSelected(employee); setRecord(null); setRecordError(''); setRecordLoading(true); setTab('resumo')
    try {
      const [result, ficha] = await Promise.all([adminProntuario(token, employee.id), adminFichaCompleta(token, employee.id)])
      if (requestId !== recordSequence.current) return
      if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível abrir o prontuário.')
      if (!ficha.sucesso || !ficha.funcionario) throw new Error(ficha.erro || 'Não foi possível carregar a ficha completa do funcionário.')
      setRecord({ ...result, funcionario: ficha.funcionario })
    } catch (cause) { if (requestId === recordSequence.current) setRecordError(cause instanceof Error ? cause.message : 'Falha ao abrir o prontuário.') }
    finally { if (requestId === recordSequence.current) setRecordLoading(false) }
  }

  const closeRecord = () => { recordSequence.current += 1; setSelected(null); setRecord(null); setRecordError('') }
  function resetSearch() {
    searchSequence.current += 1
    setLoading(false); setFilters(emptyFilters); setActiveFilters(emptyFilters); setPage(null); setError(''); setNotice(''); setSuggestionsOpen(false); setAdvancedFiltersOpen(false)
  }
  const advancedFilterCount = [filters.situacao, filters.tipoVinculo, filters.cargo, filters.salarioMin, filters.salarioMax].filter((value) => value.trim() !== '').length
  const totalPages = page ? Math.max(1, Math.ceil(page.total / 20)) : 0
  const recordData = record as unknown as Record<string, unknown> | null
  const employeeFicha = record?.funcionario as import('../lib/types').EmployeeFichaRecord | undefined
  const collection = (key: string) => Array.isArray(recordData?.[key]) ? recordData[key] as Array<Record<string, unknown>> : []
  const items = tab === 'resumo' || tab === 'timeline' ? [] : collection(tab)
  const title = tabs.find(([key]) => key === tab)?.[1] || 'Registros'
  const summaryLinks: Array<{ key: TabKey; label: string; total: number; context: string; empty: string }> = [
    { key: 'ponto', label: 'Ponto', total: collection('ponto').length, context: 'Marcações e eventos de jornada', empty: 'Nenhuma marcação vinculada' },
    { key: 'atestados', label: 'Atestados', total: collection('atestados').length, context: 'Documentos médicos vinculados', empty: 'Nenhum atestado cadastrado' },
    { key: 'afastamentos', label: 'Afastamentos', total: collection('afastamentos').length, context: 'Períodos de afastamento registrados', empty: 'Nenhum afastamento cadastrado' },
    { key: 'ferias', label: 'Férias', total: collection('ferias').length, context: 'Períodos de férias registrados', empty: 'Nenhum período cadastrado' },
    { key: 'documentos', label: 'Documentos', total: collection('documentos').length, context: 'Arquivos anexados ao prontuário', empty: 'Nenhum documento anexado' },
    { key: 'holerites', label: 'Holerites', total: collection('holerites').length, context: 'Comprovantes de pagamento disponíveis', empty: 'Nenhum holerite disponível' },
  ]
  const recordPanel = selected ? <section className="employee-record-inline" ref={recordPanelRef} role="region" aria-labelledby="employee-record-title" tabIndex={-1}><div className="employee-record-shell">
    <div className="employee-record-heading">
      <div className="employee-record-identity">
        <div className="employee-record-photo">{selected.avatar_url ? <img src={selected.avatar_url} alt={`Foto de ${selected.nome}`} /> : <UserRound size={30} aria-hidden="true" />}</div>
        <div className="employee-record-heading-copy"><span className="eyebrow">Prontuário individual</span><h2 id="employee-record-title">{selected.nome}</h2><p>{selected.cargo || 'Cargo não informado'}</p><small>{employeeContractLabel(selected.tipo_vinculo)} · CPF {maskedCpf(selected.cpf)}</small></div>
      </div>
      <div className="employee-record-profile-actions"><div className="employee-record-current-status"><span>Situação atual</span><StatusPill value={selected.situacao} /></div><button className="secondary-button" type="button" onClick={closeRecord}><X size={16} /> Fechar prontuário</button></div>
    </div>
    {recordLoading ? <LoadingState label="Montando prontuário…" /> : recordError ? <ErrorState message={recordError} /> : record ? <>
      <div className="employee-record-tabs">{tabs.map(([key, label]) => { const count = key === 'resumo' || key === 'ficha' || key === 'timeline' ? null : collection(key).length; return <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}{count !== null ? <small>{count}</small> : null}</button> })}</div>
      {tab === 'resumo' ? <div className="employee-record-summary">
        <SectionCard title="Vínculo e remuneração" caption="Dados cadastrais essenciais para uma leitura rápida da situação profissional."><div className="employee-record-facts">
          <div><span>Tipo de vínculo</span><strong>{employeeContractLabel(selected.tipo_vinculo)}</strong><small>Modalidade registrada no cadastro</small></div>
          <div><span>Remuneração cadastrada</span><strong>{employeeCompensation(selected)}</strong><small>{selected.tipo_vinculo === 'diarista' ? 'Valor informado por diária' : 'Valor informado por mês'}</small></div>
          <div><span>Data de admissão</span><strong>{formatDate(selected.data_admissao)}</strong><small>Data registrada para início do vínculo</small></div>
        </div></SectionCard>
        <SectionCard title="Acompanhamento do prontuário" caption="Os totais mostram os registros vinculados; selecione uma categoria para abrir sua lista de origem."><div className="employee-record-followup-grid">
          {summaryLinks.map((link) => <button className="employee-record-followup-card" type="button" key={link.key} onClick={() => setTab(link.key)} aria-label={`${link.label}: ${link.total} registros. Abrir detalhes.`}>
            <span className="employee-record-followup-count">{link.total}</span><span className="employee-record-followup-copy"><strong>{link.label}</strong><small>{link.total ? link.context : link.empty}</small><em>Ver registros</em></span><ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div></SectionCard>
      </div> : tab === 'ficha' ? <SectionCard title="Ficha completa do funcionário" caption="Dados cadastrais e trabalhistas vinculados a este funcionário.">
        {employeeFicha ? <><div className="employee-ficha-groups">{fieldGroups.map((group) => <details className="employee-ficha-group" key={group.title} open={group.title.includes('Identificação') || group.title.includes('Vínculo')}><summary>{group.title}</summary><div className="employee-ficha-grid">{group.fields.filter((field) => field.key !== 'valor_diaria' || selected.tipo_vinculo === 'diarista').map((field) => <div className={`employee-ficha-value${field.kind === 'textarea' ? ' is-wide' : ''}`} key={field.key}><span>{field.label}</span><strong>{displayValue(field, employeeFicha[field.key])}</strong></div>)}</div></details>)}</div><div className="employee-create-actions"><button className="primary-button" type="button" onClick={() => setEditFichaOpen(true)}>Editar ficha completa</button></div></> : <EmptyState title="Ficha indisponível" description="Não foi possível obter os dados completos deste cadastro." />}
      </SectionCard> : tab === 'timeline' ? <EmployeeTimeline token={token} funcionarioId={selected.id} /> : <SectionCard title={title} caption={`${items.length} registro(s) carregado(s) · a linha do tempo tem paginação independente`}><RecordList items={items} /></SectionCard>}
    </> : null}
  </div></section> : null

  useEffect(() => {
    if (!selected) return
    const frame = window.requestAnimationFrame(() => recordPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [selected?.id])

  if (!['admin', 'administrador', 'gestor'].includes(profile)) return <ErrorState message="A lista geral e os prontuários da equipe estão disponíveis somente para perfis administrativos." />

  return <div className="employee-directory-page">
    {notice ? <div className="form-success employee-directory-notice" role="status">{notice}</div> : null}
    <SectionCard className="employee-search-card" title="Encontrar funcionário" caption="Busque por nome, CPF ou cargo. Use filtros avançados quando necessário." action={<button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><UserPlus size={16} /> Novo funcionário</button>}>
      <form className="employee-directory-search" onSubmit={(event) => { event.preventDefault(); setSuggestionsOpen(false); void runSearch(filters, 0) }}>
        <div className="employee-directory-search-main">
          <label className="employee-search-autocomplete">Nome, CPF ou cargo
            <input value={filters.busca} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 160)} onChange={(event) => { setFilters({ ...filters, busca: event.target.value }); setSuggestionsOpen(true) }} placeholder="Digite um nome, CPF ou cargo" />
            {suggestionsOpen && filters.busca.trim().length >= 2 ? <div className="employee-suggestions" role="listbox">{suggestionsLoading ? <div className="employee-suggestion-status"><RefreshCw size={14} className="spin" /> Buscando…</div> : suggestions.length ? suggestions.map((employee) => <button type="button" key={employee.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSuggestionsOpen(false); void openRecord(employee) }}><span className="employee-suggestion-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : <UserRound size={15} />}</span><span><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'} · CPF {maskedCpf(employee.cpf)}</small></span><ChevronRight size={14} /></button>) : <div className="employee-suggestion-status">Nenhuma pessoa encontrada.</div>}</div> : null}
          </label>
          <button className="primary-button employee-search-submit" type="submit" disabled={loading}>{loading ? <><RefreshCw size={16} className="spin" /> Buscando…</> : <><Search size={16} /> Buscar</>}</button>
          <button className={`employee-filter-toggle${advancedFiltersOpen ? ' is-open' : ''}`} type="button" aria-expanded={advancedFiltersOpen} onClick={() => setAdvancedFiltersOpen((value) => !value)}><SlidersHorizontal size={16} /> Filtros avançados {advancedFilterCount > 0 ? <b>{advancedFilterCount}</b> : null}<ChevronDown size={15} /></button>
        </div>
        {advancedFiltersOpen ? <div className="employee-directory-advanced" role="region" aria-label="Filtros avançados">
          <div className="employee-directory-advanced-grid">
            <label>Situação<select value={filters.situacao} onChange={(event) => setFilters({ ...filters, situacao: event.target.value })}><option value="">Todas</option><option value="Trabalhando">Trabalhando</option><option value="Em férias">Em férias</option><option value="Afastado">Afastado</option><option value="Inativo">Inativo</option></select></label>
            <label>Vínculo<select value={filters.tipoVinculo} onChange={(event) => setFilters({ ...filters, tipoVinculo: event.target.value })}><option value="">Todos</option><option value="formal">Formal / CLT</option><option value="informal">Informal</option><option value="experiencia">Experiência</option><option value="diarista">Diarista</option></select></label>
            <label>Cargo<input value={filters.cargo} onChange={(event) => setFilters({ ...filters, cargo: event.target.value })} placeholder="Ex.: costureira" /></label>
            <label>Remuneração mínima<input inputMode="decimal" value={filters.salarioMin} onChange={(event) => setFilters({ ...filters, salarioMin: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label>
            <label>Remuneração máxima<input inputMode="decimal" value={filters.salarioMax} onChange={(event) => setFilters({ ...filters, salarioMax: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="Sem limite" /></label>
          </div>
          <div className="employee-directory-advanced-footer"><small>Os filtros são aplicados ao iniciar a busca.</small><button className="secondary-button compact-button" type="button" onClick={resetSearch} disabled={advancedFilterCount === 0 && !filters.busca}><X size={14} /> Limpar</button></div>
        </div> : null}
      </form>
    </SectionCard>
    {error ? <ErrorState message={error} /> : null}
    {loading ? <LoadingState label="Consultando cadastros com segurança…" /> : null}
    {!page && !loading && !error ? <SectionCard title="Diretório da equipe" caption={selected ? 'Prontuário individual selecionado · use os atalhos para consultar os registros de origem.' : 'A lista é consultada quando você inicia uma busca.'}>{!selected ? <div className="employee-directory-empty"><Search size={30} /><strong>Pesquise para abrir um prontuário</strong><p>Digite um nome, CPF ou cargo, ou abra os filtros avançados para reduzir os resultados.</p></div> : null}{recordPanel}</SectionCard> : null}
    {page && !loading ? <SectionCard title={`Diretório da equipe · ${page.total} funcionário(s)`} caption={`Página ${pageNumber + 1} de ${totalPages} · CPF oculto nos resultados; selecione uma pessoa para abrir o prontuário nesta área.`}>
      <div className="employee-directory-results">{page.registros.length ? page.registros.map((employee) => <button className="employee-directory-result" type="button" key={employee.id} onClick={() => void openRecord(employee)}>
        <span className="employee-directory-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : <UserRound size={20} />}</span>
        <span className="employee-directory-main"><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'} · {employee.tipo_vinculo || 'Vínculo não informado'}</small><small>CPF {maskedCpf(employee.cpf)} · admissão {formatDate(employee.data_admissao)}</small><span className="employee-directory-mobile-meta"><StatusPill value={employee.situacao} /><small>{employeeCompensation(employee)}</small></span></span>
        <span className="employee-directory-meta"><b>{employeeCompensation(employee)}</b><StatusPill value={employee.situacao} /></span><ChevronRight size={17} />
      </button>) : <EmptyState title="Nenhum funcionário encontrado" description="Ajuste os filtros e faça uma nova busca." />}</div>
      {page.total > 20 ? <div className="employee-directory-pagination"><button className="secondary-button compact-button" type="button" disabled={pageNumber === 0} onClick={() => void runSearch(activeFilters, pageNumber - 1)}><ChevronLeft size={15} /> Anterior</button><span>Página {pageNumber + 1} de {totalPages}</span><button className="secondary-button compact-button" type="button" disabled={pageNumber + 1 >= totalPages} onClick={() => void runSearch(activeFilters, pageNumber + 1)}>Próxima <ChevronRight size={15} /></button></div> : null}
      {recordPanel}
    </SectionCard> : null}
    {editFichaOpen && employeeFicha ? <EmployeeFichaPanel token={token} employee={employeeFicha} onClose={() => setEditFichaOpen(false)} onSaved={(updated) => { setRecord((current) => current ? { ...current, funcionario: updated } : current); setEditFichaOpen(false); void runSearch(activeFilters, pageNumber) }} /> : null}
    <EmployeeRegistrationWizard open={createOpen} token={token} onClose={() => setCreateOpen(false)} onCreated={(_id, cpf) => { const next = { ...filters, busca: cpf }; setFilters(next); void runSearch(next, 0).then(() => setNotice('Funcionário cadastrado e disponível para consulta.')) }} />
  </div>
}
