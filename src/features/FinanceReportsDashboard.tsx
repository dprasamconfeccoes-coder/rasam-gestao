import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Download,
  FileBarChart,
  FileText,
  Landmark,
  PieChart,
  Printer,
  RefreshCw,
  ShieldAlert,
  Table2,
  WalletCards,
} from 'lucide-react'
import { adminFinanceiroRelatorio, adminRegistrarRelatorio } from '../lib/api'
import type { FinanceiroRelatorioResponse } from '../lib/types'
import { EmptyState, ErrorState, LoadingState, PageHeading, SectionCard, formatDate, formatMoney } from '../components/ui'
import './finance-reports.css'

type ReportType =
  | 'fluxo'
  | 'categorias'
  | 'contas_pagar'
  | 'contas_receber'
  | 'producao'
  | 'dre'
  | 'inadimplencia'
  | 'recorrencias'
  | 'orcamento'
  | 'producao_status'
  | 'producao_clientes'
  | 'produtividade'
  | 'producao_fluxo_diario'
  | 'controle_tamanhos_lotes'
  | 'quadro_funcionarios'
  | 'ponto_jornada'
  | 'absenteismo'
  | 'ferias_afastamentos'
  | 'dividas_posicao'
  | 'dividas_credores'

type ReportDefinition = {
  key: ReportType
  label: string
  description: string
  area: 'Financeiro' | 'Produção' | 'Pessoas' | 'Dívidas'
  icon: 'chart' | 'table' | 'file' | 'alert' | 'briefcase' | 'calendar'
}

const reportOptions: ReportDefinition[] = [
  { key: 'fluxo', label: 'Fluxo de caixa', description: 'Realizado, previsto e saldo por competência.', area: 'Financeiro', icon: 'chart' },
  { key: 'contas_pagar', label: 'Contas a pagar', description: 'Obrigações, vencimentos e contratos.', area: 'Financeiro', icon: 'file' },
  { key: 'contas_receber', label: 'Contas a receber', description: 'Receitas manuais e recebimentos previstos.', area: 'Financeiro', icon: 'file' },
  { key: 'categorias', label: 'Despesas por categoria', description: 'Composição e concentração dos gastos.', area: 'Financeiro', icon: 'table' },
  { key: 'producao', label: 'Receitas da produção', description: 'Ordens entregues e pagamentos esperados.', area: 'Financeiro', icon: 'briefcase' },
  { key: 'dre', label: 'DRE gerencial', description: 'Receitas, despesas e participação sobre as receitas do período.', area: 'Financeiro', icon: 'chart' },
  { key: 'inadimplencia', label: 'Inadimplência', description: 'Títulos com vencimento no intervalo selecionado; faixas calculadas até a data final.', area: 'Financeiro', icon: 'alert' },
  { key: 'recorrencias', label: 'Compromissos recorrentes', description: 'Compromissos cujo próximo vencimento cai no período.', area: 'Financeiro', icon: 'file' },
  { key: 'orcamento', label: 'Orçamento versus realizado', description: 'Planejado, realizado e desvio por categoria.', area: 'Financeiro', icon: 'table' },
  { key: 'producao_status', label: 'Ordens por status', description: 'Ordens do período de entrada agrupadas pelo status atual.', area: 'Produção', icon: 'chart' },
  { key: 'producao_clientes', label: 'Ordens por cliente', description: 'Volume, quantidade e valor das ordens recebidas no período.', area: 'Produção', icon: 'briefcase' },
  { key: 'produtividade', label: 'Resumo de ordens recebidas', description: 'Ordens, peças e valor total das ordens recebidas; não mede produção física.', area: 'Produção', icon: 'chart' },
  { key: 'producao_fluxo_diario', label: 'Fluxo fabril por dia', description: 'Unidades produzidas, costuradas e entregues a partir dos eventos fabris.', area: 'Produção', icon: 'chart' },
  { key: 'controle_tamanhos_lotes', label: 'Controle por tamanho e lote', description: 'Ordens recebidas no período; etapas atuais de produção, costura e entrega por tamanho.', area: 'Produção', icon: 'table' },
  { key: 'quadro_funcionarios', label: 'Quadro de funcionários', description: 'Vínculos e cargos considerados ativos na data final do período.', area: 'Pessoas', icon: 'file' },
  { key: 'ponto_jornada', label: 'Ponto e jornada', description: 'Presenças, faltas e registros do período.', area: 'Pessoas', icon: 'chart' },
  { key: 'absenteismo', label: 'Absenteísmo', description: 'Faltas registradas e registros totais por período.', area: 'Pessoas', icon: 'alert' },
  { key: 'ferias_afastamentos', label: 'Férias e afastamentos', description: 'Períodos sobrepostos e inícios dentro do intervalo escolhido.', area: 'Pessoas', icon: 'calendar' },
  { key: 'dividas_posicao', label: 'Contratos cadastrados no período', description: 'Contratos por status; saldo atual, filtrados pela data de contratação ou cadastro.', area: 'Dívidas', icon: 'alert' },
  { key: 'dividas_credores', label: 'Contratos por credor cadastrados no período', description: 'Contratos e saldo atual por credor; não representa posição histórica.', area: 'Dívidas', icon: 'table' },
]

const columns: Record<ReportType, Array<[string, string]>> = {
  fluxo: [['mes', 'Competência'], ['receitas_recebidas', 'Receitas recebidas'], ['despesas_pagas', 'Despesas pagas'], ['receitas_previstas', 'Receitas previstas'], ['despesas_previstas', 'Despesas previstas']],
  categorias: [['categoria', 'Categoria'], ['quantidade', 'Lançamentos'], ['valor', 'Valor']],
  contas_pagar: [['vencimento', 'Vencimento'], ['descricao', 'Descrição'], ['categoria', 'Categoria'], ['fornecedor', 'Fornecedor'], ['valor', 'Valor'], ['status', 'Status']],
  contas_receber: [['vencimento', 'Vencimento'], ['descricao', 'Descrição'], ['categoria', 'Categoria'], ['valor', 'Valor'], ['status', 'Status']],
  producao: [['prazo', 'Prazo'], ['numero', 'Ordem'], ['descricao', 'Descrição'], ['cliente_nome', 'Cliente'], ['valor_total', 'Valor'], ['status_pagamento', 'Pagamento']],
  dre: [['grupo', 'Grupo'], ['valor', 'Valor'], ['participacao', 'Participação sobre receitas']],
  inadimplencia: [['faixa', 'Faixa de atraso'], ['quantidade', 'Contas'], ['valor', 'Valor em aberto']],
  recorrencias: [['descricao', 'Compromisso'], ['categoria', 'Categoria'], ['fornecedor', 'Fornecedor'], ['periodicidade', 'Periodicidade'], ['valor', 'Valor'], ['projecao_anual', 'Projeção anual'], ['proximo_vencimento', 'Próximo vencimento']],
  orcamento: [['categoria', 'Categoria'], ['orcado', 'Orçado'], ['realizado', 'Realizado'], ['desvio', 'Desvio'], ['execucao', 'Execução']],
  producao_status: [['status', 'Status atual'], ['quantidade', 'Ordens'], ['valor_total', 'Valor']],
  producao_clientes: [['cliente', 'Cliente'], ['ordens', 'Ordens'], ['quantidade', 'Peças'], ['valor_total', 'Valor']],
  produtividade: [['indicador', 'Indicador'], ['valor', 'Valor']],
  producao_fluxo_diario: [['data', 'Dia'], ['ordens_com_evento', 'Ordens com evento'], ['produzidas', 'Produção líquida'], ['costuradas', 'Costura líquida'], ['entregues', 'Entrega líquida']],
  controle_tamanhos_lotes: [['numero', 'Lote'], ['cliente', 'Cliente'], ['descricao', 'Produto / descrição'], ['status', 'Status'], ['prioridade', 'Prioridade'], ['prazo', 'Prazo'], ['tamanho', 'Tamanho'], ['solicitadas', 'Solicitadas'], ['produzidas', 'Produzidas'], ['costuradas', 'Costuradas'], ['entregues', 'Entregues'], ['faltam_produzir', 'Faltam produzir'], ['faltam_costurar', 'Faltam costurar'], ['faltam_entregar', 'Faltam entregar']],
  quadro_funcionarios: [['grupo', 'Grupo'], ['quantidade', 'Quantidade']],
  ponto_jornada: [['status', 'Status'], ['quantidade', 'Registros']],
  absenteismo: [['tipo', 'Tipo'], ['quantidade', 'Ocorrências'], ['dias', 'Dias']],
  ferias_afastamentos: [['tipo', 'Tipo'], ['quantidade', 'Períodos sobrepostos'], ['inicios_no_periodo', 'Inícios no período']],
  dividas_posicao: [['status', 'Status'], ['quantidade', 'Contratos'], ['valor', 'Saldo atual']],
  dividas_credores: [['credor', 'Credor'], ['contratos', 'Contratos'], ['saldo', 'Saldo atual']],
}

const num = (value: unknown) => Number(value || 0)
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function displayValue(key: string, row: Record<string, unknown>) {
  const raw = row[key]
  if (['valor', 'valor_total', 'orcado', 'realizado', 'desvio', 'receitas_recebidas', 'despesas_pagas', 'receitas_previstas', 'despesas_previstas', 'projecao_anual', 'saldo'].includes(key)) {
    return formatMoney(num(raw))
  }
  if (['participacao', 'execucao'].includes(key)) return `${num(raw).toFixed(1)}%`
  if (['data', 'mes', 'vencimento', 'prazo', 'proximo_vencimento', 'competencia', 'pago_em'].includes(key)) {
    return formatDate(raw ? String(raw) : '')
  }
  return raw === null || raw === undefined || raw === '' ? '—' : String(raw)
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return value.replace(/[&<>"']/g, (character) => entities[character])
}

function iconFor(icon: ReportDefinition['icon']) {
  if (icon === 'chart') return <BarChart3 size={17} />
  if (icon === 'table') return <Table2 size={17} />
  if (icon === 'alert') return <ShieldAlert size={17} />
  if (icon === 'briefcase') return <BriefcaseBusiness size={17} />
  if (icon === 'calendar') return <CalendarDays size={17} />
  return <FileText size={17} />
}

export function FinanceReportsDashboard({ token }: { token: string }) {
  const today = new Date()
  const [start, setStart] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`)
  const [end, setEnd] = useState(localDate(today))
  const [type, setType] = useState<ReportType>('fluxo')
  const [data, setData] = useState<FinanceiroRelatorioResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCatalog, setShowCatalog] = useState(true)
  const requestId = useRef(0)

  async function load(nextType: ReportType = type, openDetail = true) {
    const currentRequest = ++requestId.current
    if (start > end) {
      setError('A data inicial não pode ser posterior à data final.')
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setData(null)
    try {
      const result = await adminFinanceiroRelatorio(token, nextType, start, end)
      if (currentRequest !== requestId.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível gerar o relatório.')
      setData(result)
      setType(nextType)
      setShowCatalog(!openDetail)
      void adminRegistrarRelatorio(token, nextType, start, end)
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : 'Falha ao gerar relatório.')
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  function updatePeriodStart(value: string) {
    requestId.current += 1
    setLoading(false)
    setData(null)
    setError('')
    setStart(value)
  }

  function updatePeriodEnd(value: string) {
    requestId.current += 1
    setLoading(false)
    setData(null)
    setError('')
    setEnd(value)
  }

  useEffect(() => {
    void load('fluxo', false)
    // O relatório inicial deve ser carregado quando a sessão muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const option = reportOptions.find((item) => item.key === type)!
  const rows = data?.linhas || []
  const fields = columns[type]
  const financeOptions = reportOptions.filter((item) => item.area === 'Financeiro')
  const isFactoryFlow = type === 'producao_fluxo_diario'
  const isSizeControl = type === 'controle_tamanhos_lotes'
  const isDre = type === 'dre'
  const isFinancialReport = option.area === 'Financeiro'
  const isNewFactoryReport = isFactoryFlow || isSizeControl
  const totalRows = rows.length

  const summary = useMemo(() => {
    const sum = (keys: string[]) => rows.reduce((total, row) => total + keys.reduce((subtotal, key) => subtotal + num(row[key]), 0), 0)
    const daysWithMovement = rows.filter((row) => num(row.produzidas) !== 0 || num(row.costuradas) !== 0 || num(row.entregues) !== 0).length
    const dreValue = (group: string) => num(rows.find((row) => row.grupo === group)?.valor)
    return {
      receitas: sum(['receitas_recebidas', 'receitas_previstas']),
      despesas: sum(['despesas_pagas', 'despesas_previstas', 'valor']),
      abertos: rows.filter((row) => ['pendente', 'vencido'].includes(String(row.status))).length,
      dreReceitasRealizadas: dreValue('Receitas realizadas'),
      dreReceitasPrevistas: dreValue('Receitas previstas'),
      dreDespesasPagas: dreValue('Despesas pagas'),
      dreDespesasPrevistas: dreValue('Despesas previstas'),
      quantidadeGenerica: sum(['quantidade', 'ordens', 'contratos']),
      solicitadas: isSizeControl ? num(data?.totais?.solicitadas) : sum(['solicitadas']),
      faltamProduzir: isSizeControl ? num(data?.totais?.faltam_produzir) : sum(['faltam_produzir']),
      faltamCosturar: isSizeControl ? num(data?.totais?.faltam_costurar) : sum(['faltam_costurar']),
      faltamEntregar: isSizeControl ? num(data?.totais?.faltam_entregar) : sum(['faltam_entregar']),
      produzidas: sum(['produzidas']),
      costuradas: sum(['costuradas']),
      entregues: sum(['entregues']),
      daysWithMovement,
    }
  }, [rows, data?.totais, isSizeControl])

  function exportCsv() {
    const header = fields.map(([, label]) => label).join(';')
    const body = rows.map((row) => fields.map(([key]) => `"${displayValue(key, row).replaceAll('"', '""')}"`).join(';')).join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `relatorio-${type}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function print() {
    const title = `${option.label} · ${formatDate(start)} a ${formatDate(end)}`
    const safeTitle = escapeHtml(title)
    const html = `<html><head><title>${safeTitle}</title><style>body{font:12px Arial;padding:28px;color:#252b28}h1{font-size:21px}p{color:#66736b}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d9ded9;padding:7px;text-align:left}th{background:#eef3ed}</style></head><body><h1>${safeTitle}</h1><p>RF Gestão · relatório gerencial · ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr>${fields.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${fields.map(([key]) => `<td>${escapeHtml(displayValue(key, row))}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`
    const windowRef = window.open('', '_blank')
    if (windowRef) {
      windowRef.document.write(html)
      windowRef.document.close()
    }
  }

  const header = (
    <PageHeading
      eyebrow="Centro de inteligência · RF Gestão"
      title="Relatórios"
      description="Catálogo gerencial de financeiro, produção, pessoas e compromissos da empresa."
      action={(
        <div className="finance-report-actions">
          <button className="secondary-button" onClick={() => setShowCatalog(!showCatalog)}>
            <FileBarChart size={15} /> {showCatalog ? 'Abrir relatório' : 'Catálogo'}
          </button>
          {!showCatalog && <>
            <button className="secondary-button" onClick={exportCsv} disabled={!rows.length}><Download size={15} /> CSV</button>
            <button className="secondary-button" onClick={print} disabled={!rows.length}><Printer size={15} /> Imprimir / PDF</button>
          </>}
        </div>
      )}
    />
  )

  if (error && !data) return <div className="finance-reports-page">{header}<ErrorState message={error} /></div>

  return (
    <div className="finance-reports-page">
      {header}
      {error && <div className="report-inline-error" role="alert">{error}</div>}
      {showCatalog ? <>
        <section className="reports-overview">
          <div className="reports-overview-copy">
            <span className="eyebrow">Visão geral executiva</span>
            <h2>Uma leitura única para cada decisão</h2>
            <p>Escolha uma área, abra um relatório e exporte uma visão pronta para gestão. Os dados são filtrados pelo período informado.</p>
          </div>
          <div className="reports-overview-metrics">
            <article><WalletCards size={17} /><strong>{formatMoney(summary.receitas)}</strong><small>Movimentação de receitas</small></article>
            <article><PieChart size={17} /><strong>{formatMoney(summary.despesas)}</strong><small>Movimentação de despesas</small></article>
            <article><FileText size={17} /><strong>{financeOptions.length}</strong><small>Relatórios financeiros</small></article>
            <article><AlertTriangle size={17} /><strong>{summary.abertos}</strong><small>Itens pendentes na prévia</small></article>
          </div>
        </section>
        <div className="reports-catalog-toolbar">
          <label>Período inicial<input type="date" value={start} onChange={(event) => updatePeriodStart(event.target.value)} /></label>
          <label>Período final<input type="date" value={end} onChange={(event) => updatePeriodEnd(event.target.value)} /></label>
          <button className="primary-button" onClick={() => void load(type)} disabled={loading}><RefreshCw size={15} /> Atualizar catálogo</button>
        </div>
        {['Financeiro', 'Produção', 'Pessoas', 'Dívidas'].map((area) => (
          <section className="report-catalog-section" key={area}>
            <div className="report-catalog-heading">
              <div><span className="eyebrow">Catálogo</span><h2>{area}</h2></div>
              <small>{area === 'Financeiro' ? 'Indicadores, caixa, compromissos e resultado.' : area === 'Produção' ? 'Ordens, fluxo diário e controle das etapas por tamanho.' : area === 'Pessoas' ? 'Jornada, custos e movimentações de pessoal.' : 'Contratos, credores e comprometimento financeiro.'}</small>
            </div>
            <div className="report-catalog-grid">
              {reportOptions.filter((item) => item.area === area).map((item) => (
                <button className="report-catalog-card" key={item.key} onClick={() => void load(item.key)}>
                  <span>{iconFor(item.icon)}</span><div><strong>{item.label}</strong><small>{item.description}</small></div><b>Consultar</b>
                </button>
              ))}
              {!reportOptions.some((item) => item.area === area) && <div className="report-catalog-coming"><Landmark size={18} /><span>Catálogo preparado para receber os próximos relatórios desta área.</span></div>}
            </div>
          </section>
        ))}
      </> : <>
        <div className="finance-report-toolbar">
          <button className="secondary-button" onClick={() => setShowCatalog(true)}>← Voltar ao catálogo</button>
          <div className="report-current-label"><span>{iconFor(option.icon)}</span><div><strong>{option.label}</strong><small>{option.description}</small></div></div>
          <label>Início<input type="date" value={start} onChange={(event) => updatePeriodStart(event.target.value)} /></label>
          <label>Fim<input type="date" value={end} onChange={(event) => updatePeriodEnd(event.target.value)} /></label>
          <button className="primary-button" onClick={() => void load(type)} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar</button>
        </div>
        {isFactoryFlow ? <div className="report-kpi-strip">
          <article><span>Produção líquida no período</span><strong>{summary.produzidas.toLocaleString('pt-BR')}</strong><small>Deltas somados nos eventos fabris</small></article>
          <article><span>Costura líquida no período</span><strong>{summary.costuradas.toLocaleString('pt-BR')}</strong><small>Deltas somados nos eventos fabris</small></article>
          <article><span>Entrega líquida no período</span><strong>{summary.entregues.toLocaleString('pt-BR')}</strong><small>Deltas somados nos eventos fabris</small></article>
          <article><span>Dias com movimento</span><strong>{summary.daysWithMovement}</strong><small>Eventos diferentes de zero</small></article>
        </div> : isSizeControl ? <div className="report-kpi-strip">
          <article><span>Peças solicitadas</span><strong>{summary.solicitadas.toLocaleString('pt-BR')}</strong><small>Nos lotes não cancelados do período</small></article>
          <article><span>Faltam produzir</span><strong>{summary.faltamProduzir.toLocaleString('pt-BR')}</strong><small>Solicitado menos produzido</small></article>
          <article><span>Faltam costurar</span><strong>{summary.faltamCosturar.toLocaleString('pt-BR')}</strong><small>Produzido menos costurado</small></article>
          <article><span>Faltam entregar</span><strong>{summary.faltamEntregar.toLocaleString('pt-BR')}</strong><small>Costurado menos entregue</small></article>
        </div> : isDre ? <div className="report-kpi-strip">
          <article><span>Receitas realizadas</span><strong>{formatMoney(summary.dreReceitasRealizadas)}</strong><small>Pagamentos recebidos no período</small></article>
          <article><span>Receitas previstas</span><strong>{formatMoney(summary.dreReceitasPrevistas)}</strong><small>Títulos pendentes/vencidos no período</small></article>
          <article><span>Despesas pagas</span><strong>{formatMoney(summary.dreDespesasPagas)}</strong><small>Pagamentos realizados no período</small></article>
          <article><span>Despesas previstas</span><strong>{formatMoney(summary.dreDespesasPrevistas)}</strong><small>Títulos pendentes/vencidos no período</small></article>
        </div> : !isFinancialReport ? <div className="report-kpi-strip">
          <article><span>Linhas / grupos</span><strong>{totalRows}</strong><small>Resultado agregado</small></article>
          <article><span>Itens contados</span><strong>{summary.quantidadeGenerica.toLocaleString('pt-BR')}</strong><small>Contagens disponíveis no relatório</small></article>
          <article><span>Período</span><strong>{formatDate(start)} – {formatDate(end)}</strong><small>Intervalo selecionado</small></article>
          <article><span>Gerado em</span><strong>{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><small>Dados do tenant autorizado</small></article>
        </div> : <div className="report-kpi-strip">
          <article><span>Linhas encontradas</span><strong>{totalRows}</strong><small>No período selecionado</small></article>
          <article><span>Receitas / previsto</span><strong>{formatMoney(summary.receitas)}</strong><small>Consolidação da prévia</small></article>
          <article><span>Despesas / compromissos</span><strong>{formatMoney(summary.despesas)}</strong><small>Consolidação da prévia</small></article>
          <article><span>Gerado em</span><strong>{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><small>Dados do tenant autorizado</small></article>
        </div>}
        <SectionCard title={option.label} caption={`${formatDate(start)} a ${formatDate(end)} · ${totalRows} registro(s)`}>
          {loading ? <LoadingState label="Gerando relatório…" /> : rows.length ? <div className="finance-report-table"><table><thead><tr>{fields.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || row.numero || row.data || row.categoria || index)}>{fields.map(([key]) => <td key={key}>{displayValue(key, row)}</td>)}</tr>)}</tbody></table></div> : <EmptyState title="Nenhum dado no período" description={isNewFactoryReport ? 'Ajuste o intervalo de datas ou verifique se há ordens e eventos fabris registrados nesse período.' : 'Ajuste o intervalo ou verifique se há movimentações registradas nesse período.'} />}
        </SectionCard>
        {isSizeControl && totalRows >= 2000 && <p className="report-limit-note" role="note">A consulta atingiu o limite de 2.000 linhas. Reduza o período para conferir os demais lotes.</p>}
      </>}
      <div className="finance-report-foot"><CalendarDays size={15} /><span>Fonte: Supabase · empresa e usuário autorizados · relatório gerado em {new Date().toLocaleString('pt-BR')}</span></div>
    </div>
  )
}
