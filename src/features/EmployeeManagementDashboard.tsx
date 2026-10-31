import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, Search, ShieldCheck, UserPlus, UserRound, X } from 'lucide-react'
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
    if (step === 1 && form.tipoVinculo === 'formal' && !(monthly && monthly > 0) && !(daily && daily > 0)) {
      return setError('Para vínculo formal, informe o valor mensal ou a diária.')
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
          <label>Tipo de vínculo *<select required value={form.tipoVinculo} onChange={(event) => setForm({ ...form, tipoVinculo: event.target.value })}><option value="formal">Formal / CLT</option><option value="informal">Informal</option><option value="experiencia">Experiência</option></select></label>
          <label>Cargo<input value={form.cargo} onChange={(event) => setForm({ ...form, cargo: event.target.value })} placeholder="Ex.: Costureira" /></label>
          <label>Valor mensal<input inputMode="decimal" value={form.valorMensal} onChange={(event) => setForm({ ...form, valorMensal: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label>
          <label>Valor da diária<input inputMode="decimal" value={form.valorDiaria} onChange={(event) => setForm({ ...form, valorDiaria: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label>
        </div><small className="employee-form-help">Para vínculo formal, informe remuneração mensal ou diária; o sistema mantém os dois valores separados.</small></div> : null}
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
    setSelected(employee); setRecord(null); setRecordError(''); setRecordLoading(true); setTab('resumo')
    try {
      const result = await adminProntuario(token, employee.id)
      if (requestId !== recordSequence.current) return
      if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível abrir o prontuário.')
      setRecord(result)
    } catch (cause) { if (requestId === recordSequence.current) setRecordError(cause instanceof Error ? cause.message : 'Falha ao abrir o prontuário.') }
    finally { if (requestId === recordSequence.current) setRecordLoading(false) }
  }

  const closeRecord = () => { recordSequence.current += 1; setSelected(null); setRecord(null); setRecordError('') }
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
    <SectionCard title="Busca inteligente" caption="Pesquise por nome, CPF ou cargo e combine com os filtros de situação, vínculo e remuneração">
      <form className="employee-directory-search" onSubmit={(event) => { event.preventDefault(); setSuggestionsOpen(false); void runSearch(filters, 0) }}>
        <label className="employee-search-wide employee-search-autocomplete">Nome, CPF ou cargo
          <input value={filters.busca} onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 160)} onChange={(event) => { setFilters({ ...filters, busca: event.target.value }); setSuggestionsOpen(true) }} placeholder="Digite ao menos 2 caracteres para sugestões" />
          {suggestionsOpen && filters.busca.trim().length >= 2 ? <div className="employee-suggestions" role="listbox">{suggestionsLoading ? <div className="employee-suggestion-status"><RefreshCw size={14} className="spin" /> Buscando…</div> : suggestions.length ? suggestions.map((employee) => <button type="button" key={employee.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSuggestionsOpen(false); void openRecord(employee) }}><span className="employee-suggestion-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : <UserRound size={15} />}</span><span><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'} · CPF {maskedCpf(employee.cpf)}</small></span><ChevronRight size={14} /></button>) : <div className="employee-suggestion-status">Nenhuma pessoa encontrada.</div>}</div> : null}
        </label>
        <label>Situação<select value={filters.situacao} onChange={(event) => setFilters({ ...filters, situacao: event.target.value })}><option value="">Todas</option><option value="Trabalhando">Trabalhando</option><option value="Em férias">Em férias</option><option value="Afastado">Afastado</option><option value="Inativo">Inativo</option></select></label>
        <label>Vínculo<select value={filters.tipoVinculo} onChange={(event) => setFilters({ ...filters, tipoVinculo: event.target.value })}><option value="">Todos</option><option value="formal">Formal / CLT</option><option value="informal">Informal</option><option value="experiencia">Experiência</option></select></label>
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
        <span className="employee-directory-meta"><b>{employee.salario === null ? 'Remuneração não informada' : formatMoney(employee.salario)}</b><StatusPill value={employee.situacao} /></span><ChevronRight size={17} />
      </button>) : <EmptyState title="Nenhum funcionário encontrado" description="Ajuste os filtros e faça uma nova busca." />}</div>
      {page.total > 20 ? <div className="employee-directory-pagination"><button className="secondary-button compact-button" type="button" disabled={pageNumber === 0} onClick={() => void runSearch(activeFilters, pageNumber - 1)}><ChevronLeft size={15} /> Anterior</button><span>{pageNumber + 1} / {totalPages}</span><button className="secondary-button compact-button" type="button" disabled={pageNumber + 1 >= totalPages} onClick={() => void runSearch(activeFilters, pageNumber + 1)}>Próxima <ChevronRight size={15} /></button></div> : null}
    </SectionCard> : null}

    {selected ? <div className="employee-record-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRecord() }}><div className="employee-record-modal"><div className="employee-record-shell">
      <div className="employee-record-heading"><div><span className="eyebrow">Prontuário individual</span><h2>{selected.nome}</h2><p>{selected.cargo || 'Cargo não informado'} · {selected.tipo_vinculo || 'Vínculo não informado'} · CPF {selected.cpf}</p></div><button className="secondary-button" type="button" onClick={closeRecord}><X size={16} /> Fechar prontuário</button></div>
      {recordLoading ? <LoadingState label="Montando prontuário…" /> : recordError ? <ErrorState message={recordError} /> : record ? <>
        <div className="employee-record-tabs">{tabs.map(([key, label]) => { const count = key === 'resumo' || key === 'timeline' ? null : collection(key).length; return <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}{count !== null ? <small>{count}</small> : null}</button> })}</div>
        {tab === 'resumo' ? <div className="employee-record-summary">
          <SectionCard title="Resumo funcional" caption="Dados principais do vínculo"><div className="employee-record-metrics"><div><span>Situação</span><StatusPill value={selected.situacao} /></div><div><span>Remuneração cadastrada</span><strong>{selected.salario === null ? 'Não informada' : formatMoney(selected.salario)}</strong></div><div><span>Admissão</span><strong>{formatDate(selected.data_admissao)}</strong></div><div><span>Vínculo</span><strong>{selected.tipo_vinculo || 'Não informado'}</strong></div><div><span>Atestados</span><strong>{collection('atestados').length}</strong></div><div><span>Afastamentos</span><strong>{collection('afastamentos').length}</strong></div></div></SectionCard>
          <SectionCard title="Movimentos recentes" caption="O histórico completo fica na linha do tempo"><div className="employee-record-attention"><p><BriefcaseBusiness size={17} /> {collection('advertencias').length} advertência(s) e {collection('justificativas').length} justificativa(s).</p><p><CalendarDays size={17} /> {collection('ferias').length} período(s) de férias e {collection('ponto').length} registros recentes de ponto.</p><p><FileText size={17} /> {collection('documentos').length} documento(s) e {collection('holerites').length} holerite(s).</p></div></SectionCard>
        </div> : tab === 'timeline' ? <EmployeeTimeline token={token} funcionarioId={selected.id} /> : <SectionCard title={title} caption={`${items.length} registro(s) carregado(s) · a linha do tempo tem paginação independente`}><RecordList items={items} /></SectionCard>}
      </> : null}
    </div></div></div> : null}
    <RegistrationWizard open={createOpen} token={token} onClose={() => setCreateOpen(false)} onCreated={(_id, cpf) => { const next = { ...filters, busca: cpf }; setFilters(next); void runSearch(next, 0).then(() => setNotice('Funcionário cadastrado e disponível para consulta.')) }} />
  </div>
}
