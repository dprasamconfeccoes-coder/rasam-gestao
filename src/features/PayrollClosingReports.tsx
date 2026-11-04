import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Download, FileSpreadsheet, Printer, RefreshCw, Search } from 'lucide-react'
import { adminRelatorioFechamento, getPayrollCatalog, getPayrollReport, simulateValeCesta } from '../lib/api'
import { EmptyState, ErrorState, LoadingState, formatDate, formatMoney } from '../components/ui'
import { downloadReportCsv, downloadReportXlsx, printReport, type ReportExportColumn, type ReportCell } from '../lib/report-export'
import './finance-reports.css'

export type SpecialReportType = 'payroll' | 'closing_office' | 'closing_voucher' | 'vale_simulation'

export const specialReportOptions: Array<{ key: SpecialReportType; label: string; description: string; icon: 'chart' | 'calendar' | 'file' }> = [
  { key: 'payroll', label: 'Benefícios e descontos por competência', description: 'Totais por tipo, sem detalhamento individual de valores.', icon: 'chart' },
  { key: 'closing_office', label: 'Fechamento de escritório', description: 'Relatório mensal consolidado para revisão administrativa.', icon: 'calendar' },
  { key: 'closing_voucher', label: 'Fechamento de vale', description: 'Relatório mensal de vale, com opção de incluir vínculos informais.', icon: 'file' },
  { key: 'vale_simulation', label: 'Simulação de Vale Cesta', description: 'Elegibilidade e custo estimado pela regra vigente.', icon: 'chart' },
]

type TableRow = Record<string, ReportCell>
type ReportResult = { rows: TableRow[]; columns: ReportExportColumn[]; summary?: Array<{ label: string; value: string; note?: string }> }

const currentMonth = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
const monthDate = (month: string) => `${month}-01`
const humanize = (key: string) => ({ funcionario_nome: 'Funcionário', funcionario: 'Funcionário', resultado: 'Elegibilidade', motivo: 'Motivo', valor: 'Valor' }[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))

function valueForDisplay(key: string, value: ReportCell) {
  if (value === null || value === undefined || value === '') return '—'
  const normalizedKey = key.toLowerCase()
  if (['data', 'competencia', 'vencimento', 'inicio', 'fim', 'data_admissao'].some((part) => normalizedKey.includes(part)) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return formatDate(String(value))
  if (typeof value === 'number' && /valor|saldo|total|custo|desconto|extra|orcado|realizado/i.test(key)) return formatMoney(value)
  if (typeof value === 'number') return value.toLocaleString('pt-BR')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

export function PayrollClosingReports({ token, isAdmin, initialReport, onBack }: { token: string; isAdmin: boolean; initialReport: SpecialReportType; onBack: () => void }) {
  const [mode, setMode] = useState<SpecialReportType>(initialReport)
  const [competencia, setCompetencia] = useState(currentMonth)
  const [incluirInformais, setIncluirInformais] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')

  useEffect(() => {
    setMode(initialReport)
    setResult(null)
    setError('')
    setSearch('')
  }, [initialReport])

  const option = specialReportOptions.find((item) => item.key === mode)!
  const filteredRows = useMemo(() => {
    if (!result) return []
    const query = normalizeText(search.trim())
    if (!query) return result.rows
    return result.rows.filter((row) => result.columns.some((column) => normalizeText(valueForDisplay(column.key, row[column.key])).includes(query)))
  }, [result, search])

  async function generate() {
    if (!isAdmin) { setError('Este relatório está disponível somente para administradores.'); return }
    if (!/^\d{4}-\d{2}$/.test(competencia)) { setError('Informe uma competência válida.'); return }
    setLoading(true)
    setError('')
    try {
      const date = monthDate(competencia)
      let next: ReportResult
      if (mode === 'payroll') {
        const report = await getPayrollReport(token, date)
        if (!report.sucesso) throw new Error(report.erro || 'Não foi possível gerar o relatório de folha.')
        const rows: TableRow[] = [
          ...(report.beneficios || []).map((item) => ({ grupo: 'Benefício', item: String(item.nome || '—'), pessoas: Number(item.pessoas || 0), total: Number(item.total || 0) })),
          ...(report.descontos || []).map((item) => ({ grupo: 'Desconto', item: `${String(item.tipo || '—')} · ${String(item.descricao || '')}`.trim(), pessoas: Number(item.pessoas || 0), total: Number(item.total || 0) })),
        ]
        next = {
          columns: [{ key: 'grupo', label: 'Grupo' }, { key: 'item', label: 'Tipo / item' }, { key: 'pessoas', label: 'Pessoas' }, { key: 'total', label: 'Total' }],
          rows,
          summary: [
            { label: 'Total de benefícios', value: formatMoney(report.total_beneficios || 0) },
            { label: 'Total de descontos', value: formatMoney(report.total_descontos || 0) },
            { label: 'Saldo líquido', value: formatMoney((report.total_beneficios || 0) - (report.total_descontos || 0)) },
          ],
        }
      } else if (mode === 'vale_simulation') {
        const catalog = await getPayrollCatalog(token)
        if (!catalog.sucesso) throw new Error(catalog.erro || 'Não foi possível consultar o catálogo de benefícios.')
        const benefit = (catalog.beneficios || []).find((item) => item.codigo_regra === 'vale_cesta_cct_2025_2026') || (catalog.beneficios || []).find((item) => /vale cesta/i.test(String(item.nome || '')))
        const simulation = await simulateValeCesta(token, date, String(benefit?.id || '') || null)
        if (!simulation.sucesso) throw new Error(simulation.erro || 'Não foi possível simular o Vale Cesta.')
        const items = simulation.itens || []
        next = {
          columns: [{ key: 'nome', label: 'Funcionário' }, { key: 'resultado', label: 'Elegibilidade' }, { key: 'motivo', label: 'Motivo' }, { key: 'valor', label: 'Valor' }],
          rows: items.map((item) => ({ nome: String(item.nome || '—'), resultado: String(item.resultado || '—'), motivo: String(item.motivo || '—'), valor: Number(item.valor || 0) })),
          summary: [
            { label: 'Elegíveis', value: String(items.filter((item) => item.resultado === 'elegivel').length) },
            { label: 'Não elegíveis', value: String(items.filter((item) => item.resultado !== 'elegivel').length) },
            { label: 'Custo estimado', value: formatMoney(items.reduce((sum, item) => sum + Number(item.valor || 0), 0)), note: `Regra: ${String(simulation.regra?.nome || 'Vale Cesta')}` },
          ],
        }
      } else {
        const report = await adminRelatorioFechamento(token, date, mode === 'closing_office' ? 'escritorio' : 'vale', mode === 'closing_voucher' && incluirInformais)
        if (!report.sucesso) throw new Error(report.erro || 'Não foi possível gerar o relatório de fechamento.')
        const rawRows = report.linhas || []
        const keys = Array.from(new Set(rawRows.flatMap((row) => Object.keys(row))))
          .filter((key) => !/(^|_)id($|_)|cpf|token|email|telefone|endereco|nascimento|documento|uuid|senha/i.test(key))
        next = { columns: keys.map((key) => ({ key, label: humanize(key) })), rows: rawRows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key] as ReportCell]))) }
      }
      setResult(next)
      setGeneratedAt(new Date().toISOString())
      setSearch('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao gerar o relatório.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const exportRows = filteredRows.map((row) => Object.fromEntries((result?.columns || []).map((column) => [column.key, valueForDisplay(column.key, row[column.key])])) as TableRow)
  const title = `${option.label} · ${competencia}`
  const metadata: Array<[string, string]> = [['Competência', competencia], ['Emitido em', generatedAt ? new Date(generatedAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')], ['Linhas exportadas', String(filteredRows.length)]]

  async function exportXlsx() {
    if (!result) return
    setExporting(true)
    setError('')
    try { await downloadReportXlsx(title, result.columns, filteredRows, metadata) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível exportar para Excel.') }
    finally { setExporting(false) }
  }

  function printCurrentReport() {
    if (!result) return
    setError('')
    try { printReport(title, result.columns, exportRows, metadata) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a impressão.') }
  }

  if (!isAdmin) return <ErrorState message="Os relatórios de folha e fechamento estão disponíveis somente para administradores." />

  return <div className="payroll-closing-reports">
    <div className="payroll-closing-toolbar">
      <button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={15} /> Voltar ao catálogo</button>
      <label>Relatório<select value={mode} onChange={(event) => { setMode(event.target.value as SpecialReportType); setResult(null); setError('') }}>{specialReportOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>Competência<input type="month" value={competencia} onChange={(event) => { setCompetencia(event.target.value); setResult(null) }} /></label>
      {mode === 'closing_voucher' && <label className="payroll-closing-checkbox"><input type="checkbox" checked={incluirInformais} onChange={(event) => setIncluirInformais(event.target.checked)} /> Incluir informais</label>}
      <button className="primary-button" type="button" onClick={() => void generate()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'Gerando…' : 'Gerar relatório'}</button>
    </div>
    <div className="payroll-closing-intro"><BarChart3 size={18} /><span><strong>{option.label}</strong><small>{option.description} A saída é restrita a perfis administradores.</small></span></div>
    {error && <ErrorState message={error} />}
    {loading && result && <div className="report-refresh-note"><RefreshCw size={14} className="spin" /> Atualizando. A última consulta permanece visível até a nova resposta.</div>}
    {result?.summary && <div className="report-kpi-strip">{result.summary.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.note && <small>{item.note}</small>}</article>)}</div>}
    {result && <>
      <div className="payroll-closing-filterbar"><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar nome, motivo, tipo ou valor…" /></label><span>{filteredRows.length} de {result.rows.length} linha(s)</span><div className="finance-report-actions"><button className="secondary-button" type="button" onClick={() => downloadReportCsv(title, result.columns, exportRows, metadata)} disabled={!filteredRows.length}><Download size={15} /> CSV</button><button className="secondary-button" type="button" onClick={() => void exportXlsx()} disabled={!filteredRows.length || exporting}><FileSpreadsheet size={15} /> {exporting ? 'Exportando…' : 'Excel'}</button><button className="secondary-button" type="button" onClick={printCurrentReport} disabled={!filteredRows.length}><Printer size={15} /> Imprimir / PDF</button></div></div>
      {filteredRows.length ? <div className="finance-report-table"><table><thead><tr>{result.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{filteredRows.map((row, index) => <tr key={String(row.id || row.numero || row.nome || index)}>{result.columns.map((column) => <td key={column.key}>{valueForDisplay(column.key, row[column.key])}</td>)}</tr>)}</tbody></table></div> : <EmptyState title="Nenhum resultado para o filtro" description="Limpe a busca ou gere o relatório para outra competência." />}
    </>}
    {!result && !loading && !error && <EmptyState title="Pronto para gerar" description="Escolha a competência e gere o relatório centralizado neste catálogo." />}
  </div>
}
