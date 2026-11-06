import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, HeartPulse, Printer, RefreshCw, Search } from 'lucide-react'
import { adminMedicalLeavesReport, adminRequestsReport } from '../lib/api'
import { EmptyState, ErrorState, SectionCard, StatusPill, formatDate } from '../components/ui'
import './hr-reports.css'

type ReportKind = 'atestados' | 'solicitacoes'
type ReportRow = Record<string, unknown>
type ReportResponse = {
  sucesso: boolean
  erro?: string
  resumo?: Record<string, number>
  linhas?: ReportRow[]
}

const currentDate = () => new Date().toISOString().slice(0, 10)
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`
const labels: Record<string, string> = {
  nome: 'Funcionário', tipo: 'Tipo', data_atendimento: 'Atendimento', dias: 'Dias', status: 'Status',
  arquivo_nome: 'Arquivo', created_at: 'Recebido em', descricao: 'Descrição', resposta: 'Resposta',
  analisado_em: 'Analisado em', cid: 'CID',
}
const humanize = (key: string) => labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const display = (key: string, value: unknown) => {
  if (value === null || value === undefined || value === '') return '—'
  if (/data|created_at|analisado_em/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return formatDate(String(value))
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

function downloadCsv(title: string, columns: string[], rows: ReportRow[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  const content = [columns.map((key) => escape(humanize(key))).join(';'), ...rows.map((row) => columns.map((key) => escape(display(key, row[key]))).join(';'))].join('\n')
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function printReport(title: string, columns: string[], rows: ReportRow[]) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
  const windowRef = window.open('', '_blank')
  if (!windowRef) throw new Error('Permita pop-ups para imprimir o relatório.')
  windowRef.document.write(`<html><head><title>${escape(title)}</title><style>body{font:12px Arial;padding:24px;color:#18212f}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left;vertical-align:top}th{background:#f1f5f9}</style></head><body><h1>${escape(title)}</h1><table><thead><tr>${columns.map((key) => `<th>${escape(humanize(key))}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td>${escape(display(key, row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
  windowRef.document.close()
}

export function HRReportsPanel({ token }: { token: string }) {
  const [kind, setKind] = useState<ReportKind>('atestados')
  const [inicio, setInicio] = useState(monthStart)
  const [fim, setFim] = useState(currentDate)
  const [result, setResult] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const columns = useMemo(() => {
    const rows = result?.linhas || []
    const preferred = kind === 'atestados'
      ? ['nome', 'tipo', 'data_atendimento', 'dias', 'status', 'arquivo_nome']
      : ['nome', 'tipo', 'descricao', 'status', 'created_at', 'resposta']
    return preferred.filter((key) => rows.some((row) => key in row))
  }, [kind, result])
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    if (!query) return result?.linhas || []
    return (result?.linhas || []).filter((row) => columns.some((key) => display(key, row[key]).toLocaleLowerCase('pt-BR').includes(query)))
  }, [columns, result, search])

  async function generate() {
    if (!inicio || !fim || inicio > fim) { setError('Informe um intervalo de datas válido.'); return }
    setLoading(true); setError('')
    try {
      const response = kind === 'atestados' ? await adminMedicalLeavesReport(token, inicio, fim) : await adminRequestsReport(token, inicio, fim)
      if (!response.sucesso) throw new Error(response.erro || 'Não foi possível gerar o relatório.')
      setResult(response); setSearch('')
    } catch (cause) {
      setResult(null); setError(cause instanceof Error ? cause.message : 'Falha ao gerar relatório.')
    } finally { setLoading(false) }
  }

  const title = kind === 'atestados' ? 'Relatório de atestados' : 'Relatório de solicitações RH'
  const summary = result?.resumo || {}

  return <div className="hr-reports-panel">
    <SectionCard title="Relatórios de RH" caption="Visões administrativas de atestados e solicitações, restritas ao escopo da empresa.">
      <div className="hr-report-toolbar">
        <label>Relatório<select value={kind} onChange={(event) => { setKind(event.target.value as ReportKind); setResult(null); setError('') }}><option value="atestados">Atestados</option><option value="solicitacoes">Solicitações RH</option></select></label>
        <label>Início<input type="date" value={inicio} onChange={(event) => setInicio(event.target.value)} /></label>
        <label>Fim<input type="date" value={fim} onChange={(event) => setFim(event.target.value)} /></label>
        <button className="primary-button" type="button" onClick={() => void generate()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'Gerando…' : 'Gerar relatório'}</button>
      </div>
      <div className="hr-report-description"><HeartPulse size={17} /><span><strong>{title}</strong><small>Use o intervalo para conferir volume, pendências e decisões registradas pelo RH.</small></span></div>
      {error && <ErrorState message={error} />}
    </SectionCard>

    {result && <>
      <div className="hr-report-kpis">{Object.entries(summary).map(([key, value]) => <article key={key}><span>{humanize(key)}</span><strong>{Number(value).toLocaleString('pt-BR')}</strong></article>)}</div>
      <SectionCard title={title} caption={`${filteredRows.length} de ${(result.linhas || []).length} registro(s) no filtro atual`}>
        <div className="hr-report-actions"><label className="hr-report-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar funcionário, tipo ou status" /></label><button className="secondary-button" type="button" onClick={() => downloadCsv(title, columns, filteredRows)} disabled={!filteredRows.length}><Download size={15} /> CSV</button><button className="secondary-button" type="button" onClick={() => printReport(title, columns, filteredRows)} disabled={!filteredRows.length}><Printer size={15} /> Imprimir / PDF</button><button className="secondary-button" type="button" onClick={() => void generate()} disabled={loading}><FileSpreadsheet size={15} /> Atualizar</button></div>
        {filteredRows.length ? <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead><tbody>{filteredRows.map((row, index) => <tr key={String(row.id || index)}>{columns.map((column) => <td key={column}>{column === 'status' ? <StatusPill value={display(column, row[column])} /> : display(column, row[column])}</td>)}</tr>)}</tbody></table></div> : <EmptyState title="Nenhum registro encontrado" description="Ajuste o intervalo ou limpe o filtro de busca." />}
      </SectionCard>
    </>}
    {!result && !loading && !error && <EmptyState title="Pronto para gerar" description="Escolha o relatório e o período para carregar os indicadores administrativos." />}
  </div>
}
