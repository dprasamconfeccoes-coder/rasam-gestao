import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, Search, ShieldCheck, UserPlus, UserRound, X } from 'lucide-react'
import { adminCadastrarFuncionario, adminProntuario, searchEmployees } from '../lib/api'
import type { EmployeeRow, EmployeeSearchPage, ProntuarioResponse, Profile } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import { EmployeeTimeline } from './EmployeeTimeline'
import './employee-directory.css'

type FilterState = { busca: string; situacao: string; tipoVinculo: string; cargo: string; salarioMin: string; salarioMax: string }
type FormState = { nome: string; cpf: string; dataNascimento: string; tipoVinculo: string; cargo: string; telefone: string; endereco: string; valorMensal: string; valorDiaria: string; liberarAcesso: boolean }
type TabKey = 'resumo' | 'atestados' | 'afastamentos' | 'justificativas' | 'advertencias' | 'ferias' | 'documentos' | 'ponto' | 'holerites' | 'beneficios' | 'descontos' | 'timeline'

const emptyFilters: FilterState = { busca: '', situacao: '', tipoVinculo: '', cargo: '', salarioMin: '', salarioMax: '' }
const initialForm: FormState = { nome: '', cpf: '', dataNascimento: '', tipoVinculo: 'formal', cargo: '', telefone: '', endereco: '', valorMensal: '', valorDiaria: '', liberarAcesso: false }
const tabs: Array<[TabKey, string]> = [
  ['resumo', 'Resumo'], ['timeline', 'Linha do tempo'], ['ponto', 'Ponto'], ['atestados', 'Atestados'], ['afastamentos', 'Afastamentos'],
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

function remunerationLabel(employee: Pick<EmployeeRow, 'tipo_vinculo' | 'salario' | 'valor_mensal' | 'valor_diaria' | 'salario_periodo'>) {
  if (employee.tipo_vinculo === 'diarista') {
    return employee.valor_diaria != null ? `Diária · ${formatMoney(employee.valor_diaria)}` : 'Diária não informada'
  }
  const amount = employee.valor_mensal ?? employee.salario
  return amount == null ? 'Remuneração não informada' : `${employee.salario_periodo || 'Mês'} · ${formatMoney(amount)}`
}

function asNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function durationValue(value: unknown) {
  const direct = asNumber(value)
  if (direct !== null) return direct
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return 0
  return Number(match[1]) + Number(match[2]) / 60 + Number(match[3] || 0) / 3600
}

function hoursValue(item: Record<string, unknown>) {
  return durationValue(item.horas_trabalhadas ?? item.horas ?? item.total_horas ?? item.total_normais)
}

function extraHoursValue(item: Record<string, unknown>) {
  const direct = item.horas_extras ?? item.extra_horas ?? item.extras
  if (direct !== undefined && direct !== null && String(direct).trim()) return durationValue(direct)
  return durationValue(item.extra_50) + durationValue(item.extra_100)
}

function absenceValue(item: Record<string, unknown>) {
  const value = String(item.dia_falta ?? item.falta ?? item.falta_apontada ?? '').trim().toLowerCase()
  return (value && !['não', 'nao', 'n', '0', 'false', 'normal'].includes(value)) || String(item.status ?? '').toLowerCase() === 'falta'
}

function isRelevantPoint(item: Record<string, unknown>) {
  const status = String(item.status ?? item.situacao ?? item.inconsistencia ?? '').toLowerCase()
  const extra = extraHoursValue(item)
  const late = durationValue(item.horas_atraso)
  const absence = absenceValue(item)
  const abono = String(item.abono ?? '').toLowerCase()
  return extra > 0 || late > 0 || absence || Boolean(abono && !['não', 'nao', 'n', '0', 'false'].includes(abono)) || Boolean(status && !['normal', 'encontrado', 'regular', 'aprovado'].includes(status))
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function latestPointMonth(items: Array<Record<string, unknown>>) {
  const months = items.map((item) => readText(item, ['data', 'data_ponto', 'dia']).slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)).sort()
  return months.at(-1) || currentMonth()
}

function readText(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key]
    if (value !== null && value !== undefined && String(value).trim()) return String(value)
  }
  return '—'
}

function formatHours(value: number) {
  const totalMinutes = Math.max(0, Math.round(value * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  return `${hours} h ${minutes} min`
}

function pointDate(item: Record<string, unknown>) {
  return readText(item, ['data', 'data_ponto', 'dia', 'data_ocorrencia'])
}

function pointStatus(item: Record<string, unknown>) {
  const status = readText(item, ['status_label', 'status', 'situacao', 'inconsistencia'])
  const absence = readText(item, ['dia_falta', 'falta'])
  if (absence !== '—' && !['não', 'nao', 'n', '0', 'false'].includes(absence.toLowerCase())) return absence
  return status
}

function PointRecordList({ items }: { items: Array<Record<string, unknown>> }) {
  if (!items.length) return <EmptyState title="Nenhum registro de ponto" description="Não há marcações disponíveis para este funcionário." />
  return <div className="point-record-list">{items.map((item, index) => {
    const worked = hoursValue(item)
    const extras = extraHoursValue(item)
    const status = pointStatus(item)
    const entrance = readText(item, ['entrada', 'hora_entrada', 'inicio', 'batida_entrada'])
    const exit = readText(item, ['saida', 'hora_saida', 'fim', 'batida_saida'])
    return <article className="point-record-row" key={String(item.id || `${pointDate(item)}-${index}`)}>
      <div className="point-record-date"><strong>{formatDate(pointDate(item))}</strong><small>{readText(item, ['dia_semana', 'jornada', 'escala'])}</small></div>
      <div className="point-record-times"><span><small>Entrada</small><b>{entrance}</b></span><span><small>Saída</small><b>{exit}</b></span><span><small>Trabalhadas</small><b>{formatHours(worked)}</b></span></div>
      <div className="point-record-status">{extras > 0 ? <span className="point-tag point-tag-warning">+{formatHours(extras)}</span> : null}<span className={`point-tag ${status !== '—' ? 'point-tag-alert' : 'point-tag-neutral'}`}>{status}</span></div>
    </article>
  })}</div>
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

function RegistrationWizard({ open, token, onClose, onCreated }: { open: boolean; token: string; onClose: () => void; onCreated: (id: string, cpf: string) => void }) {
  const [form, setForm] = useState<FormState>(initialForm)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setForm(initialForm); setStep(0); setError('') }
  }, [open])

  if (!open) return null

  function validateStep() {
    setError('')
    if (step === 0) {
      if (form.nome.trim().length < 2) return setError('Informe o nome completo.')
      if (form.cpf.replace(/\D/g, '').length !== 11) return setError('Informe um CPF com 11 dígitos.')
      if (!form.dataNascimento) return setError('Informe a data de nascimento.')
    }
    const monthly = parseMoney(form.valorMensal)
    const daily = parseMoney(form.valorDiaria)
    if (step === 1 && form.tipoVinculo === 'formal' && !(monthly && monthly > 0)) {
      return setError('Para vínculo formal, informe o valor mensal.')
    }
    if (step === 1 && form.tipoVinculo === 'diarista' && !(daily && daily > 0)) {
      return setError('Para vínculo diarista, informe o valor da diária.')
    }
    setStep((current) => Math.min(2, current + 1))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (step < 2) { validateStep(); return }
    setSaving(true)
    setError('')
    const cpf = form.cpf.replace(/\D/g, '')
    try {
      const result = await adminCadastrarFuncionario(token, {
        nome: form.nome.trim(), cpf, dataNascimento: form.dataNascimento, tipoVinculo: form.tipoVinculo,
        cargo: form.cargo.trim(), telefone: form.telefone.trim(), endereco: form.endereco.trim(),
        valorMensal: parseMoney(form.valorMensal), valorDiaria: parseMoney(form.valorDiaria), liberarAcesso: form.liberarAcesso,
      })
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível cadastrar o funcionário.')
      onCreated(result.funcionario_id || '', cpf)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao cadastrar funcionário.')
    } finally {
      setSaving(false)
    }
  }

  const stepLabels = ['Identificação', 'Vínculo e remuneração', 'Contato e revisão']
  return <div className="employee-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <section className="employee-create-modal employee-wizard" role="dialog" aria-modal="true" aria-labelledby="employee-wizard-title">
      <div className="employee-create-heading"><div><span className="eyebrow">Novo cadastro · departamento pessoal</span><h2 id="employee-wizard-title">Cadastrar funcionário</h2><p>Preencha os dados em etapas; você pode revisar tudo antes de concluir.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Fechar cadastro"><X size={18} /></button></div>
      <div className="employee-wizard-progress" aria-label={`Etapa ${step + 1} de 3`}>{stepLabels.map((label, index) => <div className={index <= step ? 'is-current' : ''} key={label}><span>{index + 1}</span><small>{label}</small></div>)}</div>
      <form className="employee-create-form" onSubmit={(event) => void submit(event)}>
        {step === 0 ? <div className="employee-form-section"><strong>Identificação</strong><div className="employee-form-grid">
          <label>Nome completo *<input required autoFocus autoComplete="name" value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} placeholder="Nome e sobrenome" /></label>
          <label>CPF *<input required inputMode="numeric" maxLength={14} autoComplete="off" value={form.cpf} onChange={(event) => setForm({ ...form, cpf: event.target.value })} placeholder="000.000.000-00" /></label>
          <label>Data de nascimento *<input required type="date" value={form.dataNascimento} onChange={(event) => setForm({ ...form, dataNascimento: event.target.value })} /></label>
        </div><small className="employee-form-help">O CPF será validado novamente pelo servidor antes de salvar.</small></div> : null}
        {step === 1 ? <div className="employee-form-section"><strong>Vínculo e remuneração</strong><div className="employee-form-grid">
          <label>Tipo de vínculo *<select required value={form.tipoVinculo} onChange={(event) => { const tipoVinculo = event.target.value; setForm({ ...form, tipoVinculo, valorMensal: tipoVinculo === 'diarista' ? '' : form.valorMensal, valorDiaria: tipoVinculo === 'diarista' ? form.valorDiaria : '' }) }}><option value="formal">Formal / CLT</option><option value="informal">Informal</option><option value="experiencia">Experiência</option><option value="diarista">Diarista · pagamento por dia</option></select></label>
          <label>Cargo<input value={form.cargo} onChange={(event) => setForm({ ...form, cargo: event.target.value })} placeholder="Ex.: Costureira" /></label>
          {form.tipoVinculo !== 'diarista' ? <label>Valor mensal{form.tipoVinculo === 'formal' ? ' *' : ''}<input inputMode="decimal" required={form.tipoVinculo === 'formal'} value={form.valorMensal} onChange={(event) => setForm({ ...form, valorMensal: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label> : null}
          {form.tipoVinculo === 'diarista' ? <label>Valor da diária *<input inputMode="decimal" required value={form.valorDiaria} onChange={(event) => setForm({ ...form, valorDiaria: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label> : null}
        </div><small className="employee-form-help">Vínculo formal exige valor mensal. A diária só é aceita para o vínculo diarista; informal e experiência não recebem diária automaticamente.</small></div> : null}
        {step === 2 ? <><div className="employee-form-section"><strong>Contato e acesso</strong><div className="employee-form-grid">
          <label>Telefone<input autoComplete="tel" value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} placeholder="(00) 00000-0000" /></label>
          <label className="employee-form-wide">Endereço<input autoComplete="street-address" value={form.endereco} onChange={(event) => setForm({ ...form, endereco: event.target.value })} placeholder="Rua, número, bairro e cidade" /></label>
        </div><label className="check-line employee-access-toggle"><input type="checkbox" checked={form.liberarAcesso} onChange={(event) => setForm({ ...form, liberarAcesso: event.target.checked })} /> Criar acesso ao portal agora</label><small className="employee-form-help">Por segurança, o acesso é opcional e começa desativado. Se ativado, o fluxo atual usa a data de nascimento como senha inicial e exige troca no primeiro acesso; recomendamos entregar essa credencial por canal privado.</small></div>
          <SectionCard title="Revisão do cadastro" caption="Confira os dados antes de concluir"><div className="employee-wizard-review"><p><strong>Nome:</strong> {form.nome || '—'}</p><p><strong>CPF:</strong> {maskedCpf(form.cpf)}</p><p><strong>Vínculo / cargo:</strong> {form.tipoVinculo} · {form.cargo || 'Não informado'}</p><p><strong>Remuneração:</strong> {form.valorMensal ? `Mensal ${form.valorMensal}` : ''}{form.valorMensal && form.valorDiaria ? ' · ' : ''}{form.valorDiaria ? `Diária ${form.valorDiaria}` : ''}{!form.valorMensal && !form.valorDiaria ? 'Não informada' : ''}</p></div></SectionCard>
        </> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="employee-create-actions"><button className="secondary-button" type="button" onClick={step === 0 ? onClose : () => { setError(''); setStep((current) => Math.max(0, current - 1)) }} disabled={saving}>{step === 0 ? 'Cancelar' : 'Voltar'}</button><button className="primary-button" type={step < 2 ? 'button' : 'submit'} onClick={step < 2 ? validateStep : undefined} disabled={saving}>{saving ? <><RefreshCw size={16} className="spin" /> Salvando…</> : step < 2 ? <>Continuar <ChevronRight size={16} /></> : <><Plus size={16} /> Concluir cadastro</>}</button></div>
      </form>
    </section>
  </div>
}

export function EmployeeManagementDashboard({ token, profile }: { token: string; profile: Profile }) {
  const [filters, setFilters] = useState<FilterState>(emptyFilters)
  const [activeFilters, setActiveFilters] = useState<FilterState>(emptyFilters)
  const [page, setPage] = useState<EmployeeSearchPage | null>(null)
  const [pageNumber, setPageNumber] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<EmployeeRow | null>(null)
  const [record, setRecord] = useState<ProntuarioResponse | null>(null)
  const [recordLoading, setRecordLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [tab, setTab] = useState<TabKey>('resumo')
  const [fullRecordOpen, setFullRecordOpen] = useState(false)
  const [previewMonth, setPreviewMonth] = useState(currentMonth)
  const [suggestions, setSuggestions] = useState<EmployeeRow[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const searchSequence = useRef(0)
  const recordSequence = useRef(0)

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
    setSelected(employee); setRecord(null); setRecordError(''); setRecordLoading(true); setTab('resumo'); setFullRecordOpen(false); setPreviewMonth(currentMonth())
    try {
      const result = await adminProntuario(token, employee.id)
      if (requestId !== recordSequence.current) return
      if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível abrir o prontuário.')
      setRecord(result)
      setPreviewMonth(latestPointMonth(result.ponto || []))
    } catch (cause) { if (requestId === recordSequence.current) setRecordError(cause instanceof Error ? cause.message : 'Falha ao abrir o prontuário.') }
    finally { if (requestId === recordSequence.current) setRecordLoading(false) }
  }

  const closeRecord = () => { recordSequence.current += 1; setSelected(null); setRecord(null); setRecordError(''); setFullRecordOpen(false) }
  function resetSearch() {
    searchSequence.current += 1
    setLoading(false); setFilters(emptyFilters); setActiveFilters(emptyFilters); setPage(null); setError(''); setNotice('')
  }
  const totalPages = page ? Math.max(1, Math.ceil(page.total / 20)) : 0
  const recordData = record as unknown as Record<string, unknown> | null
  const collection = (key: string) => Array.isArray(recordData?.[key]) ? recordData[key] as Array<Record<string, unknown>> : []
  const items = tab === 'resumo' || tab === 'timeline' ? [] : collection(tab)
  const title = tabs.find(([key]) => key === tab)?.[1] || 'Registros'

  if (!['admin', 'administrador', 'gestor'].includes(profile)) return <><PageHeading eyebrow="Acesso restrito" title="Gestão de funcionários" /><ErrorState message="A lista geral e os prontuários da equipe estão disponíveis somente para perfis administrativos." /></>

  return <div className="employee-directory-page">
    <PageHeading eyebrow="Pessoas · gestão de equipe" title="Funcionários" description="Localize cadastros com filtros, consulte prontuários e registre novas pessoas em etapas." action={<button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><UserPlus size={16} /> Novo funcionário</button>} />
    <div className="employee-access-note"><ShieldCheck size={16} /><span>Busca e prontuário geral restritos a perfis administrativos autorizados; consultas são paginadas e verificadas no Supabase.</span></div>
    {notice ? <div className="form-success employee-directory-notice" role="status">{notice}</div> : null}
    {!selected ? <>
    <SectionCard title="Busca inteligente" caption="Pesquise por nome, CPF ou cargo e combine com os filtros de situação, vínculo e remuneração">
      <form className="employee-directory-search" onSubmit={(event) => { event.preventDefault(); setSuggestionsOpen(false); void runSearch(filters, 0) }}>
        <label className="employee-search-wide employee-search-autocomplete">Nome, CPF ou cargo
          <input value={filters.busca} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 160)} onChange={(event) => { setFilters({ ...filters, busca: event.target.value }); setSuggestionsOpen(true) }} placeholder="Digite ao menos 2 caracteres para sugestões" />
          {suggestionsOpen && filters.busca.trim().length >= 2 ? <div className="employee-suggestions" role="listbox">{suggestionsLoading ? <div className="employee-suggestion-status"><RefreshCw size={14} className="spin" /> Buscando…</div> : suggestions.length ? suggestions.map((employee) => <button type="button" key={employee.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSuggestionsOpen(false); void openRecord(employee) }}><span className="employee-suggestion-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : <UserRound size={15} />}</span><span><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'} · CPF {maskedCpf(employee.cpf)}</small></span><ChevronRight size={14} /></button>) : <div className="employee-suggestion-status">Nenhuma pessoa encontrada.</div>}</div> : null}
        </label>
        <label>Situação<select value={filters.situacao} onChange={(event) => setFilters({ ...filters, situacao: event.target.value })}><option value="">Todas</option><option value="Trabalhando">Trabalhando</option><option value="Em férias">Em férias</option><option value="Afastado">Afastado</option><option value="Inativo">Inativo</option></select></label>
        <label>Vínculo<select value={filters.tipoVinculo} onChange={(event) => setFilters({ ...filters, tipoVinculo: event.target.value })}><option value="">Todos</option><option value="formal">Formal / CLT</option><option value="informal">Informal</option><option value="experiencia">Experiência</option><option value="diarista">Diarista</option></select></label>
        <label>Cargo<input value={filters.cargo} onChange={(event) => setFilters({ ...filters, cargo: event.target.value })} placeholder="Ex.: costureira" /></label>
        <label>Remuneração mínima<input inputMode="decimal" value={filters.salarioMin} onChange={(event) => setFilters({ ...filters, salarioMin: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label>
        <label>Remuneração máxima<input inputMode="decimal" value={filters.salarioMax} onChange={(event) => setFilters({ ...filters, salarioMax: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="Sem limite" /></label>
        <div className="employee-search-actions"><button className="secondary-button" type="button" onClick={resetSearch}><X size={16} /> Limpar filtros</button><button className="primary-button" type="submit" disabled={loading}>{loading ? <><RefreshCw size={16} className="spin" /> Buscando…</> : <><Search size={16} /> Buscar equipe</>}</button></div>
      </form>
    </SectionCard>
    {error ? <ErrorState message={error} /> : null}
    {loading ? <LoadingState label="Consultando cadastros com segurança…" /> : null}
    {!page && !loading && !error ? <SectionCard title="Diretório da equipe" caption="A busca é intencional: nenhum cadastro é carregado automaticamente"><div className="employee-directory-empty"><Search size={30} /><strong>Pesquise para abrir um prontuário</strong><p>Use um nome, CPF, cargo ou filtro. O resultado é paginado para facilitar a navegação em equipes maiores.</p></div></SectionCard> : null}
    {page && !loading ? <SectionCard title={`${page.total} funcionário(s) encontrado(s)`} caption={`Página ${pageNumber + 1} de ${totalPages} · CPF parcialmente oculto na lista; abra o prontuário para ver dados autorizados`}>
      <div className="employee-directory-results">{page.registros.length ? page.registros.map((employee) => <button className="employee-directory-result" type="button" key={employee.id} onClick={() => void openRecord(employee)}>
        <span className="employee-directory-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : <UserRound size={20} />}</span>
        <span className="employee-directory-main"><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'} · CPF {maskedCpf(employee.cpf)}</small><small>{employee.tipo_vinculo || 'Vínculo não informado'} · admissão {formatDate(employee.data_admissao)}</small></span>
        <span className="employee-directory-meta"><b>{remunerationLabel(employee)}</b><StatusPill value={employee.situacao} /></span><ChevronRight size={17} />
      </button>) : <EmptyState title="Nenhum funcionário encontrado" description="Ajuste os filtros e faça uma nova busca." />}</div>
      {page.total > 20 ? <div className="employee-directory-pagination"><button className="secondary-button compact-button" type="button" disabled={pageNumber === 0} onClick={() => void runSearch(activeFilters, pageNumber - 1)}><ChevronLeft size={15} /> Anterior</button><span>{pageNumber + 1} / {totalPages}</span><button className="secondary-button compact-button" type="button" disabled={pageNumber + 1 >= totalPages} onClick={() => void runSearch(activeFilters, pageNumber + 1)}>Próxima <ChevronRight size={15} /></button></div> : null}
    </SectionCard> : null}

    </> : <button className="secondary-button employee-return-search" type="button" onClick={closeRecord}><ChevronLeft size={16} /> Voltar para a busca</button>}

    {selected ? <SectionCard title="Prévia do funcionário" caption="Seleção atual · altere a competência para consultar a saúde do mês" className="employee-preview-card">
      {recordLoading ? <LoadingState label="Montando prévia mensal…" /> : recordError ? <ErrorState message={recordError} /> : record ? (() => {
        const monthPoints = collection('ponto').filter((item) => String(item.data ?? item.data_ponto ?? item.dia ?? '').slice(0, 7) === previewMonth)
        const worked = monthPoints.reduce((sum, item) => sum + hoursValue(item), 0)
        const extras = monthPoints.reduce((sum, item) => sum + extraHoursValue(item), 0)
        const absences = monthPoints.filter(absenceValue).length
        const relevant = monthPoints.filter(isRelevantPoint).length
        const relevantItems = monthPoints.filter(isRelevantPoint).slice(0, 3)
        return <div className="employee-preview">
          <div className="employee-preview-heading"><div className="employee-preview-identity"><span className="employee-preview-avatar">{selected.avatar_url ? <img src={selected.avatar_url} alt="" /> : <UserRound size={26} />}</span><div><span className="eyebrow">Visão executiva · prontuário prévio</span><h2>{selected.nome}</h2><p>{selected.cargo || 'Cargo não informado'} · {selected.tipo_vinculo || 'Vínculo não informado'} · <StatusPill value={selected.situacao} /></p></div></div><div className="employee-preview-actions"><label>Competência<input type="month" value={previewMonth} onChange={(event) => setPreviewMonth(event.target.value)} /></label><button className="secondary-button" type="button" onClick={() => setFullRecordOpen(true)}><FileText size={16} /> Abrir prontuário completo</button><button className="icon-button" type="button" onClick={closeRecord} aria-label="Fechar prévia"><X size={17} /></button></div></div>
          <div className="employee-preview-context"><div><span>Vínculo e função</span><strong>{selected.tipo_vinculo || 'Não informado'} · {selected.cargo || 'Cargo não informado'}</strong></div><div><span>Remuneração</span><strong>{remunerationLabel(selected)}</strong></div><div><span>Admissão</span><strong>{formatDate(selected.data_admissao)}</strong></div></div>
          <div className="employee-preview-section-heading"><div><span className="eyebrow">Leitura do mês</span><h3>Indicadores de jornada</h3></div><span className={`employee-month-state ${relevant ? 'has-alert' : 'is-ok'}`}>{relevant ? <><AlertTriangle size={14} /> Requer revisão</> : <><CheckCircle2 size={14} /> Sem alertas relevantes</>}</span></div>
          <div className="employee-preview-metrics"><div><span>Horas trabalhadas</span><strong>{formatHours(worked)}</strong><small>{monthPoints.length} registro(s) de ponto</small></div><div><span>Horas extras</span><strong className={extras > 0 ? 'is-attention' : ''}>{formatHours(extras)}</strong><small>{extras > 0 ? 'Acima da jornada registrada' : 'Nenhuma hora extra registrada'}</small></div><div><span>Faltas / ausências</span><strong className={absences > 0 ? 'is-danger' : ''}>{absences}</strong><small>{absences > 0 ? 'Verificar justificativas' : 'Nenhuma ausência informada'}</small></div><div><span>Ocorrências relevantes</span><strong className={relevant > 0 ? 'is-attention' : ''}>{relevant}</strong><small>{relevant > 0 ? 'Exigem atenção do gestor' : 'Rotina sem inconsistências'}</small></div></div>
          <div className="employee-preview-bottom"><div className="employee-preview-note">{relevant ? `${relevant} ocorrência(s) relevante(s) exigem atenção na competência selecionada.` : 'A competência selecionada não possui inconsistências, faltas ou horas extras sinalizadas.'}</div><div className="employee-preview-alerts"><div className="employee-preview-subheading"><strong>O que merece atenção</strong><span>{relevantItems.length ? `até ${relevantItems.length} destaque(s)` : 'Tudo regular'}</span></div>{relevantItems.length ? relevantItems.map((item, index) => <div className="employee-preview-alert" key={String(item.id || index)}><span><AlertTriangle size={14} /></span><div><strong>{readText(item, ['status_label', 'status', 'tipo', 'inconsistencia', 'evento'])}</strong><small>{formatDate(pointDate(item))} · {readText(item, ['descricao', 'observacao', 'motivo'])}</small></div></div>) : <div className="employee-preview-clear"><CheckCircle2 size={16} /><span>Nenhum registro exige ação imediata neste mês.</span></div>}</div></div>
        </div>
      })() : null}
    </SectionCard> : null}

    {selected && fullRecordOpen ? <div className="employee-record-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFullRecordOpen(false) }}><div className="employee-record-modal"><div className="employee-record-shell">
      <div className="employee-record-heading"><div className="employee-record-identity"><span className="employee-record-avatar">{selected.avatar_url ? <img src={selected.avatar_url} alt="" /> : <UserRound size={26} />}</span><div><span className="eyebrow">Prontuário individual</span><h2>{selected.nome}</h2><p>{selected.cargo || 'Cargo não informado'} · {selected.tipo_vinculo || 'Vínculo não informado'} · CPF {maskedCpf(selected.cpf)}</p></div></div><button className="secondary-button" type="button" onClick={() => setFullRecordOpen(false)}><X size={16} /> Fechar prontuário</button></div>
      {record ? <><div className="employee-record-tabs">{tabs.map(([key, label]) => { const count = key === 'resumo' || key === 'timeline' ? null : collection(key).length; return <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}{count !== null ? <small>{count}</small> : null}</button> })}</div>
        {tab === 'resumo' ? <div className="employee-record-summary"><SectionCard title="Resumo funcional" caption="Dados principais do vínculo"><div className="employee-record-metrics"><div><span>Situação</span><StatusPill value={selected.situacao} /></div><div><span>Remuneração cadastrada</span><strong>{remunerationLabel(selected)}</strong></div><div><span>Admissão</span><strong>{formatDate(selected.data_admissao)}</strong></div><div><span>Vínculo</span><strong>{selected.tipo_vinculo || 'Não informado'}</strong></div><div><span>Atestados</span><strong>{collection('atestados').length}</strong></div><div><span>Afastamentos</span><strong>{collection('afastamentos').length}</strong></div></div></SectionCard><SectionCard title="Movimentos recentes" caption="A linha do tempo mostra apenas ocorrências relevantes"><div className="employee-record-attention"><p><BriefcaseBusiness size={17} /> {collection('advertencias').length} advertência(s) e {collection('justificativas').length} justificativa(s).</p><p><CalendarDays size={17} /> {collection('ferias').length} período(s) de férias e {collection('ponto').filter(isRelevantPoint).length} ocorrência(s) de ponto relevantes.</p><p><FileText size={17} /> {collection('documentos').length} documento(s) e {collection('holerites').length} holerite(s).</p></div></SectionCard></div> : tab === 'timeline' ? <EmployeeTimeline token={token} funcionarioId={selected.id} relevantOnly /> : <SectionCard title={title} caption={`${items.length} registro(s) carregado(s)`}>{tab === 'ponto' ? <PointRecordList items={items} /> : <RecordList items={items} />}</SectionCard>}
      </> : <LoadingState label="Montando prontuário…" />}
    </div></div></div> : null}
    <RegistrationWizard open={createOpen} token={token} onClose={() => setCreateOpen(false)} onCreated={(_id, cpf) => { const next = { ...filters, busca: cpf }; setFilters(next); void runSearch(next, 0).then(() => setNotice('Funcionário cadastrado e disponível para consulta.')) }} />
  </div>
}
