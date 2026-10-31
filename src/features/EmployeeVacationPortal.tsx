import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Download, FileText, History, LockKeyhole, Plane, Search, WalletCards } from 'lucide-react'
import { getVacationDocumentUrl, listEmployees, listVacationPortal } from '../lib/api'
import type { EmployeeRow, VacationPortalRow } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, MetricCard, PageHeading, SectionCard, StatusPill, formatDate } from '../components/ui'

type Props = { token: string; isAdministrative: boolean }

function days(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia${Number(value || 0) === 1 ? '' : 's'}`
}

function documentLabel(tipo: string) {
  if (tipo === 'aviso') return 'Aviso de férias'
  if (tipo === 'recibo') return 'Recibo de férias'
  return 'Comprovante de pagamento'
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || '?').toUpperCase()
}

function VacationAvatar({ name, url }: { name: string; url?: string | null }) {
  return <span className="vacation-portal-avatar" aria-label={`Foto de ${name}`}>{url ? <img src={url} alt={`Foto de ${name}`} /> : initials(name)}</span>
}

export function EmployeeVacationPortal({ token, isAdministrative }: Props) {
  const [rows, setRows] = useState<VacationPortalRow[]>([])
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState('')

  async function load(selectedId = '') {
    setLoading(true); setError('')
    try {
      const result = await listVacationPortal(token, isAdministrative ? (selectedId || null) : null)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível consultar suas férias.')
      setRows(result.ferias || [])
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível consultar suas férias.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (isAdministrative) listEmployees(token).then((result) => setEmployees(Array.isArray(result) ? result : [])).catch(() => undefined)
    void load()
  }, [token, isAdministrative])

  const selectedEmployee = useMemo(() => employees.find((item) => item.id === employeeId), [employees, employeeId])
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) => `${row.nome} ${row.cpf} ${row.cargo || ''}`.toLowerCase().includes(term))
  }, [rows, search])
  const summary = useMemo(() => ({
    available: rows.reduce((sum, row) => sum + Number(row.dias_disponiveis || 0), 0),
    used: rows.reduce((sum, row) => sum + Number(row.dias_gozados_relatorio || 0) + Number(row.dias_gozados_sistema || 0), 0),
    scheduled: rows.reduce((sum, row) => sum + row.usufrutos.filter((item) => item.status === 'agendada').reduce((total, item) => total + Number(item.dias_gozo || 0), 0), 0),
    periods: rows.length,
  }), [rows])

  async function openDocument(id: string, download = false) {
    setOpening(id)
    try {
      const result = await getVacationDocumentUrl(token, id, download)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível abrir o documento.') }
    finally { setOpening('') }
  }

  return <div className="vacation-portal-page">
    <PageHeading eyebrow="Minha área · pessoas" title="Férias" description={isAdministrative ? 'Consulta consolidada dos períodos aquisitivos e documentos de férias da empresa.' : 'Acompanhe seus períodos aquisitivos, saldo disponível e documentos publicados pelo RH.'} action={isAdministrative ? <select className="vacation-portal-employee-select" value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); void load(event.target.value) }}><option value="">Toda a empresa</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome}</option>)}</select> : undefined} />
    {isAdministrative && <div className="vacation-portal-toolbar"><label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por nome, CPF ou cargo" /></label><span>{selectedEmployee ? `Visualizando ${selectedEmployee.nome}` : 'Visão geral da empresa'}</span></div>}
    {error && <div className="form-error vacation-portal-error"><LockKeyhole size={16} />{error}</div>}
    {loading ? <LoadingState label="Consultando histórico de férias…" /> : <>
      <div className="metric-grid vacation-portal-metrics"><MetricCard label="Saldo disponível" value={days(summary.available)} detail="Dias que ainda podem ser programados" tone="green" /><MetricCard label="Dias usufruídos" value={days(summary.used)} detail="Histórico consolidado" tone="blue" /><MetricCard label="Agendados" value={days(summary.scheduled)} detail="Períodos futuros" tone="gold" /><MetricCard label="Períodos" value={summary.periods} detail="Períodos aquisitivos localizados" tone="pink" /></div>
      {filteredRows.length === 0 ? <SectionCard title="Histórico de férias" caption="Dados atualizados diretamente do sistema"><EmptyState title="Nenhum período localizado" description={isAdministrative ? 'Ajuste o funcionário ou o filtro para consultar outro cadastro.' : 'Quando houver um período cadastrado, ele aparecerá aqui.'} /></SectionCard> : <SectionCard title="Histórico por período aquisitivo" caption="Abra cada período para consultar usufrutos, saldo e documentos"><div className="vacation-portal-periods">{filteredRows.map((row) => <details className="vacation-portal-period" key={`${row.funcionario_id}-${row.periodo_inicio}-${row.periodo_fim}`}><summary><VacationAvatar name={row.nome} url={row.avatar_url} /><span className="vacation-period-main"><strong>{formatDate(row.periodo_inicio)} a {formatDate(row.periodo_fim)}</strong><small>{isAdministrative ? `${row.nome} · ` : ''}{days(row.dias_direito)} de direito</small></span><span className="vacation-period-balance"><b>{days(row.dias_disponiveis)}</b><small>disponíveis</small></span><StatusPill value={row.situacao === 'disponivel' ? 'Disponível' : row.situacao === 'vencido' ? 'Vencido' : 'Utilizado'} /></summary><div className="vacation-period-body"><div className="vacation-portal-detail-grid"><div><span>Direito do período</span><strong>{days(row.dias_direito)}</strong></div><div><span>Já usufruído</span><strong>{days(Number(row.dias_gozados_relatorio || 0) + Number(row.dias_gozados_sistema || 0))}</strong></div><div><span>Saldo disponível</span><strong>{days(row.dias_disponiveis)}</strong></div><div><span>Excedente</span><strong>{days(row.dias_excedentes)}</strong></div></div>{row.usufrutos.length > 0 && <div className="vacation-portal-subsection"><h3><History size={16} /> Usufrutos registrados</h3><div className="vacation-portal-uses">{row.usufrutos.map((item) => <div className="vacation-portal-use" key={item.id}><span><strong>{formatDate(item.inicio)} a {formatDate(item.fim)}</strong><small>{item.retorno_em ? `Retorno em ${formatDate(item.retorno_em)}` : 'Retorno não informado'}</small></span><StatusPill value={item.status} /><b>{days(item.dias_gozo)}</b></div>)}</div></div>}<div className="vacation-portal-subsection"><h3><FileText size={16} /> Documentos publicados</h3>{row.documentos.length === 0 ? <p className="vacation-portal-muted">Nenhum documento publicado para este período.</p> : <div className="vacation-portal-documents">{row.documentos.map((doc) => <button className="vacation-portal-document" key={doc.id} type="button" onClick={() => void openDocument(doc.id)} disabled={opening === doc.id}><span><FileText size={17} /><strong>{documentLabel(doc.tipo)}</strong><small>{doc.arquivo_nome}</small></span><Download size={16} /></button>)}</div>}</div></div></details>)}</div></SectionCard>}
      <div className="callout vacation-portal-security"><CheckCircle2 size={18} /><p>Os documentos são privados. Cada abertura gera uma URL temporária e o sistema valida o acesso antes de liberar o PDF.</p></div>
    </>}
  </div>
}
