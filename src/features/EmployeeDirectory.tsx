import { useState, type FormEvent } from 'react'
import { BriefcaseBusiness, ChevronLeft, ChevronRight, FileText, RefreshCw, Search, UserRound, X } from 'lucide-react'
import { adminProntuario, searchEmployees } from '../lib/api'
import type { EmployeeRow, EmployeeSearchPage, ProntuarioResponse } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, StatusPill, formatDate, formatMoney } from '../components/ui'
import './employee-directory.css'

type Filters = { busca: string; situacao: string; tipoVinculo: string; cargo: string; salarioMin: string; salarioMax: string }
type DetailTab = 'resumo' | 'holerites' | 'beneficios' | 'descontos' | 'advertencias' | 'ferias' | 'documentos' | 'ponto' | 'timeline'

const emptyFilters: Filters = { busca: '', situacao: '', tipoVinculo: '', cargo: '', salarioMin: '', salarioMax: '' }
const tabLabels: Array<[DetailTab, string]> = [['resumo', 'Resumo'], ['holerites', 'Holerites'], ['beneficios', 'Benefícios'], ['descontos', 'Descontos'], ['advertencias', 'Advertências'], ['ferias', 'Férias'], ['documentos', 'Documentos'], ['ponto', 'Ponto'], ['timeline', 'Timeline']]

function moneyInput(value: string) {
  if (!value) return null
  const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
function field(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (item[key] !== null && item[key] !== undefined && String(item[key]).trim() !== '') return String(item[key])
  return '—'
}
function listDate(item: Record<string, unknown>) {
  return field(item, ['data', 'data_evento', 'data_ocorrencia', 'inicio', 'created_at'])
}

export function EmployeeDirectory({ token }: { token: string }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [activeFilters, setActiveFilters] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState<EmployeeSearchPage | null>(null)
  const [pageNumber, setPageNumber] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<EmployeeRow | null>(null)
  const [record, setRecord] = useState<ProntuarioResponse | null>(null)
  const [recordLoading, setRecordLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [tab, setTab] = useState<DetailTab>('resumo')

  async function runSearch(nextFilters: Filters = filters, nextPage = 0) {
    setLoading(true); setError(''); setActiveFilters(nextFilters); setPageNumber(nextPage)
    try {
      const result = await searchEmployees(token, { busca: nextFilters.busca, situacao: nextFilters.situacao, tipoVinculo: nextFilters.tipoVinculo, cargo: nextFilters.cargo, salarioMin: moneyInput(nextFilters.salarioMin), salarioMax: moneyInput(nextFilters.salarioMax), offset: nextPage * 20, limite: 20 })
      if (!result.sucesso) throw new Error(result.erro || 'Falha ao buscar funcionários')
      setPage(result)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao buscar funcionários') } finally { setLoading(false) }
  }

  async function submit(event: FormEvent) { event.preventDefault(); await runSearch(filters, 0) }
  async function openRecord(employee: EmployeeRow) {
    setSelected(employee); setRecord(null); setRecordError(''); setRecordLoading(true); setTab('resumo')
    try {
      const result = await adminProntuario(token, employee.id)
      if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível abrir o prontuário')
      setRecord(result)
    } catch (err) { setRecordError(err instanceof Error ? err.message : 'Falha ao abrir o prontuário') } finally { setRecordLoading(false) }
  }
  function clearFilters() { setFilters(emptyFilters); setPage(null); setError('') }
  const totalPages = page ? Math.max(1, Math.ceil(page.total / 20)) : 0
  const recordData = record as unknown as Record<string, unknown> | null
  const collection = (key: string) => Array.isArray(recordData?.[key]) ? recordData[key] as Array<Record<string, unknown>> : []
  const items = tab === 'resumo' ? [] : collection(tab)

  return <>
    <PageHeading eyebrow="Pessoas · prontuários" title="Funcionários" description="Pesquise uma pessoa para abrir seu prontuário operacional. Nenhum cadastro é carregado antes da busca." />
    <SectionCard title="Buscar funcionário" caption="A consulta é protegida por perfil, empresa e paginação no servidor">
      <form className="employee-directory-search" onSubmit={submit}>
        <label className="employee-search-wide">Nome ou CPF<input autoFocus value={filters.busca} onChange={(event) => setFilters({ ...filters, busca: event.target.value })} placeholder="Digite nome, CPF ou parte do cargo" /></label>
        <label>Situação<select value={filters.situacao} onChange={(event) => setFilters({ ...filters, situacao: event.target.value })}><option value="">Todas</option><option value="Trabalhando">Trabalhando</option><option value="Em férias">Em férias</option><option value="Afastado">Afastado</option><option value="Inativo">Inativo</option></select></label>
        <label>Vínculo<select value={filters.tipoVinculo} onChange={(event) => setFilters({ ...filters, tipoVinculo: event.target.value })}><option value="">Todos</option><option value="formal">Formal / CLT</option><option value="informal">Informal</option><option value="experiencia">Experiência</option></select></label>
        <label>Cargo<input value={filters.cargo} onChange={(event) => setFilters({ ...filters, cargo: event.target.value })} placeholder="Ex.: costureira" /></label>
        <label>Salário mínimo<input inputMode="decimal" value={filters.salarioMin} onChange={(event) => setFilters({ ...filters, salarioMin: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="R$ 0,00" /></label>
        <label>Salário máximo<input inputMode="decimal" value={filters.salarioMax} onChange={(event) => setFilters({ ...filters, salarioMax: event.target.value.replace(/[^0-9,.]/g, '') })} placeholder="Sem limite" /></label>
        <div className="employee-search-actions"><button className="secondary-button" type="button" onClick={clearFilters} disabled={!Object.values(filters).some(Boolean) && !page}><X size={16} /> Limpar</button><button className="primary-button" type="submit" disabled={loading}>{loading ? <><RefreshCw size={16} className="spin" /> Buscando…</> : <><Search size={16} /> Buscar funcionários</>}</button></div>
      </form>
    </SectionCard>

    {!page && !loading && !error ? <SectionCard title="Aguardando busca" caption="Use um ou mais filtros para localizar um cadastro"><div className="employee-directory-empty"><Search size={30} /><strong>Nenhum funcionário foi carregado</strong><p>Escolha nome, CPF, situação, vínculo, cargo ou faixa salarial e clique em Buscar.</p></div></SectionCard> : null}
    {error ? <ErrorState message={error} /> : null}
    {loading ? <LoadingState label="Consultando cadastros com segurança…" /> : null}
    {page && !loading ? <SectionCard title={`${page.total} funcionário(s) encontrado(s)`} caption={`Página ${pageNumber + 1} de ${totalPages} · selecione uma pessoa para abrir o prontuário`}><div className="employee-directory-results">{page.registros.length === 0 ? <EmptyState title="Nenhum funcionário encontrado" description="Ajuste os filtros e faça uma nova busca." /> : page.registros.map((employee) => <button className="employee-directory-result" type="button" key={employee.id} onClick={() => void openRecord(employee)}><span className="employee-directory-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : <UserRound size={20} />}</span><span className="employee-directory-main"><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'} · CPF {employee.cpf}</small><small>{employee.tipo_vinculo || 'Vínculo não informado'} · admissão {formatDate(employee.data_admissao)}</small></span><span className="employee-directory-meta"><b>{employee.salario === null || employee.salario === undefined ? 'Salário não informado' : formatMoney(employee.salario)}</b><StatusPill value={employee.situacao} /></span><ChevronRight size={17} /></button>)}</div>{page.total > 20 ? <div className="employee-directory-pagination"><button className="secondary-button compact-button" type="button" disabled={pageNumber === 0} onClick={() => void runSearch(activeFilters, pageNumber - 1)}><ChevronLeft size={15} /> Anterior</button><span>{pageNumber + 1} / {totalPages}</span><button className="secondary-button compact-button" type="button" disabled={pageNumber + 1 >= totalPages} onClick={() => void runSearch(activeFilters, pageNumber + 1)}>Próxima <ChevronRight size={15} /></button></div> : null}</SectionCard> : null}

    {selected ? <div className="employee-record-shell"><div className="employee-record-heading"><div><span className="eyebrow">Prontuário individual</span><h2>{selected.nome}</h2><p>{selected.cargo || 'Cargo não informado'} · {selected.tipo_vinculo || 'Vínculo não informado'} · CPF {selected.cpf}</p></div><button className="secondary-button" type="button" onClick={() => { setSelected(null); setRecord(null) }}><X size={16} /> Fechar prontuário</button></div>{recordLoading ? <LoadingState label="Montando prontuário…" /> : recordError ? <ErrorState message={recordError} /> : record ? <><div className="employee-record-tabs">{tabLabels.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}<small>{key === 'resumo' ? 'Dados' : collection(key).length}</small></button>)}</div>{tab === 'resumo' ? <div className="employee-record-summary"><SectionCard title="Resumo funcional" caption="Dados principais do vínculo"><div className="employee-record-metrics"><div><span>Situação</span><StatusPill value={selected.situacao} /></div><div><span>Salário</span><strong>{selected.salario === null || selected.salario === undefined ? 'Não informado' : formatMoney(selected.salario)}</strong></div><div><span>Admissão</span><strong>{formatDate(selected.data_admissao)}</strong></div><div><span>Registros na ficha</span><strong>{record.documentos.length + record.advertencias.length + record.holerites.length + record.ferias.length + record.ponto.length}</strong></div></div></SectionCard><SectionCard title="Próximos pontos de atenção" caption="Dados já registrados no sistema"><div className="employee-record-attention"><p><BriefcaseBusiness size={17} /> {record.ferias.length ? `${record.ferias.length} período(s) de férias na ficha.` : 'Nenhum período de férias registrado.'}</p><p><FileText size={17} /> {record.holerites.length} holerite(s) e {record.documentos.length} documento(s) vinculados.</p><p><UserRound size={17} /> {record.advertencias.length} advertência(s) e {record.afastamentos.length} afastamento(s) registrados.</p></div></SectionCard></div> : <SectionCard title={tabLabels.find(([key]) => key === tab)?.[1] || 'Registros'} caption={`${items.length} registro(s) nesta seção`}>{items.length ? <div className="employee-record-list">{items.map((item, index) => <div className="employee-record-item" key={String(item.id || index)}><div><strong>{field(item, ['titulo', 'tipo', 'evento', 'arquivo_nome', 'status'])}</strong><small>{listDate(item)} · {field(item, ['descricao', 'motivo', 'medida', 'nome', 'observacoes', 'arquivo_nome'])}</small></div><StatusPill value={field(item, ['status', 'justificativa_status'])} /></div>)}</div> : <EmptyState title="Nenhum registro nesta seção" description="Novos lançamentos vinculados ao funcionário aparecerão aqui." />}</SectionCard>}</> : null}</div> : null}
  </>
}
