import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Calculator, Check, ExternalLink, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { LoadingState, PageHeading, SectionCard, formatMoney } from '../components/ui'
import './payroll-management.css'
import { adminFolhaDadosListar, adminFolhaDadosSalvar, adminFolhaSimular } from '../lib/api'
import type { PayrollCompetenceEmployee, PayrollSimulationResponse } from '../lib/types'
import { PayrollBenefitsDiscounts } from './PayrollBenefitsDiscounts'

type PayrollTab = 'simulacao' | 'dados' | 'beneficios'
type PayrollDraft = {
  salario_base: string
  dependentes_irrf: string
  outros_vinculos: '' | 'nao' | 'sim'
  outras_fontes_rendimento: '' | 'nao' | 'sim'
  pensao_alimenticia: string
  pensao_confirmada: boolean
  declaracao_confirmada: boolean
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').includes(',')
    ? value.trim().replace(/\./g, '').replace(',', '.')
    : value.trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function monthLabel(value: string) {
  const date = new Date(`${value}-01T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function emptyDraft(): PayrollDraft {
  return {
    salario_base: '',
    dependentes_irrf: '',
    outros_vinculos: '',
    outras_fontes_rendimento: '',
    pensao_alimenticia: '',
    pensao_confirmada: false,
    declaracao_confirmada: false,
  }
}

function draftFromEmployee(employee: PayrollCompetenceEmployee): PayrollDraft {
  return {
    salario_base: employee.salario_base == null ? '' : String(employee.salario_base).replace('.', ','),
    dependentes_irrf: employee.dependentes_irrf == null ? '' : String(employee.dependentes_irrf),
    outros_vinculos: employee.outros_vinculos || '',
    outras_fontes_rendimento: employee.outras_fontes_rendimento || '',
    pensao_alimenticia: employee.pensao_alimenticia == null ? '' : String(employee.pensao_alimenticia).replace('.', ','),
    pensao_confirmada: employee.pensao_confirmada,
    declaracao_confirmada: employee.declaracao_confirmada,
  }
}

export function PayrollManagementDashboard({
  token,
  initialTab = 'simulacao',
  onNavigateToHR,
}: {
  token: string
  initialTab?: PayrollTab
  onNavigateToHR?: () => void
}) {
  const [tab, setTab] = useState<PayrollTab>(initialTab)
  const [competencia, setCompetencia] = useState(currentMonth)
  const [employees, setEmployees] = useState<PayrollCompetenceEmployee[]>([])
  const [drafts, setDrafts] = useState<Record<string, PayrollDraft>>({})
  const [simulation, setSimulation] = useState<PayrollSimulationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const loadRequestRef = useRef(0)
  const simulationRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const competenceRef = useRef(competencia)
  competenceRef.current = competencia

  async function loadData() {
    const requestId = ++loadRequestRef.current
    setLoading(true)
    setError('')
    setEmployees([])
    setDrafts({})
    setSimulation(null)
    try {
      const result = await adminFolhaDadosListar(token, competencia)
      if (requestId !== loadRequestRef.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível carregar os dados fiscais da competência')
      const rows = result.funcionarios || []
      setEmployees(rows)
      setDrafts(Object.fromEntries(rows.map((employee) => [employee.funcionario_id, draftFromEmployee(employee)])))
    } catch (cause) {
      if (requestId === loadRequestRef.current) setError(cause instanceof Error ? cause.message : 'Falha ao carregar a gestão da folha')
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    setSimulation(null)
    setSimulating(false)
    setMessage('')
    void loadData()
    return () => { loadRequestRef.current += 1; simulationRequestRef.current += 1; saveRequestRef.current += 1 }
  }, [token, competencia])

  function updateDraft(id: string, patch: Partial<PayrollDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] || emptyDraft()), ...patch } }))
    setSimulation(null)
    setMessage('')
  }

  async function saveEmployee(employee: PayrollCompetenceEmployee) {
    const requestId = ++saveRequestRef.current
    const requestCompetence = competencia
    const draft = drafts[employee.funcionario_id] || emptyDraft()
    const salary = parseMoney(draft.salario_base)
    const dependents = draft.dependentes_irrf.trim() === '' ? Number.NaN : Number(draft.dependentes_irrf)
    const pension = parseMoney(draft.pensao_alimenticia)
    if (salary === null || salary <= 0) return setError(`Informe o salário mensal de ${employee.nome}.`)
    if (!Number.isInteger(dependents) || dependents < 0 || dependents > 30) return setError(`Informe o número confirmado de dependentes de ${employee.nome} (0 a 30).`)
    if (draft.outros_vinculos === '') return setError(`Confirme se ${employee.nome} teve outro vínculo empregatício na competência.`)
    if (draft.outras_fontes_rendimento === '') return setError(`Confirme se ${employee.nome} teve outra fonte de rendimentos na competência.`)
    if (pension === null || pension < 0) return setError(`Informe o valor de pensão alimentícia de ${employee.nome}; use 0 se não houver.`)
    if (!draft.pensao_confirmada) return setError(`Confirme o valor da pensão ou que não há pensão para ${employee.nome}.`)
    if (!draft.declaracao_confirmada) return setError(`Confirme a conferência do salário e das informações de ${employee.nome}.`)

    setSavingId(employee.funcionario_id)
    setError('')
    setMessage('')
    try {
      const result = await adminFolhaDadosSalvar(token, {
        funcionarioId: employee.funcionario_id,
        competencia,
        salarioBase: salary,
        dependentesIrrf: dependents,
        outrosVinculos: draft.outros_vinculos,
        outrasFontesRendimento: draft.outras_fontes_rendimento,
        pensaoAlimenticia: pension,
      })
      if (requestId !== saveRequestRef.current || competenceRef.current !== requestCompetence) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar a conferência')
      setMessage(`Dados fiscais de ${employee.nome} salvos para ${monthLabel(competencia)}.`)
      setSimulation(null)
      setEmployees((current) => current.map((row) => row.funcionario_id === employee.funcionario_id ? {
        ...row, salario_base: salary, dependentes_irrf: dependents, outros_vinculos: draft.outros_vinculos as 'nao' | 'sim',
        outras_fontes_rendimento: draft.outras_fontes_rendimento as 'nao' | 'sim', pensao_alimenticia: pension,
        pensao_confirmada: true, declaracao_confirmada: true, dados_confirmados: true, confirmado_em: new Date().toISOString(),
      } : row))
    } catch (cause) {
      if (requestId === saveRequestRef.current && competenceRef.current === requestCompetence) {
        setError(cause instanceof Error ? cause.message : 'Falha ao salvar os dados fiscais')
      }
    } finally {
      if (requestId === saveRequestRef.current) setSavingId('')
    }
  }

  async function simulate() {
    const requestId = ++simulationRequestRef.current
    setSimulating(true)
    setError('')
    setMessage('')
    try {
      const result = await adminFolhaSimular(token, competencia)
      if (requestId !== simulationRequestRef.current) return
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível calcular a simulação')
      setSimulation(result)
    } catch (cause) {
      if (requestId === simulationRequestRef.current) setError(cause instanceof Error ? cause.message : 'Falha ao calcular a simulação')
    } finally {
      if (requestId === simulationRequestRef.current) setSimulating(false)
    }
  }

  const confirmedCount = employees.filter((employee) => employee.dados_confirmados).length
  const readyItems = simulation?.itens?.filter((item) => item.status === 'simulado').length || 0
  const pendingItems = simulation?.itens?.filter((item) => item.status !== 'simulado').length || 0
  const tabs: Array<{ id: PayrollTab; label: string }> = [
    { id: 'simulacao', label: 'Prévia mensal' },
    { id: 'dados', label: 'Dados fiscais' },
    { id: 'beneficios', label: 'Benefícios e descontos' },
  ]

  if (loading && employees.length === 0 && tab !== 'beneficios') return <div className="payroll-management-page"><LoadingState label="Carregando dados da folha…" /></div>

  return <div className="payroll-management-page">
    {tab !== 'beneficios' && <PageHeading
      eyebrow="Controle · acesso administrativo"
      title="Folha de pagamento"
      description="Simulação mensal CLT com regras 2026 versionadas. Esta etapa não confirma folha nem gera pagamentos."
      action={<label className="payroll-competence-picker">Competência
        <input type="month" min="2026-01" max="2026-12" value={competencia} onChange={(event) => setCompetencia(event.target.value)} />
      </label>}
    />}
    <nav className="payroll-management-tabs" aria-label="Áreas da folha">
      {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => { setTab(item.id); setError(''); setMessage('') }}>{item.label}</button>)}
    </nav>

    {error && <div className="payroll-inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
    {message && <div className="payroll-inline-success" role="status"><Check size={17} />{message}</div>}

    {tab === 'beneficios' && <PayrollBenefitsDiscounts token={token} />}

    {tab === 'dados' && <>
      <div className="payroll-disclaimer" role="note">
        <ShieldCheck size={20} />
        <div><strong>Declarações por competência — sem preenchimento automático</strong><p>Confirme salário, dependentes, vínculos/rendimentos e pensão para cada pessoa. Campos vazios permanecem pendentes; o sistema não presume zero dependentes nem ausência de outras fontes.</p></div>
      </div>
      {loading ? <LoadingState label="Atualizando declarações…" /> : employees.length === 0 ? <SectionCard title="Nenhum CLT elegível" caption="A competência selecionada não retornou vínculos formais ativos."><p>Verifique a competência e a situação cadastral dos vínculos.</p></SectionCard> : <>
        <div className="payroll-readiness-strip"><strong>{confirmedCount} de {employees.length}</strong><span>declarações salvas para {monthLabel(competencia)}</span><button type="button" className="secondary-button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar</button></div>
        <div className="payroll-employee-input-list">
          {employees.map((employee) => {
            const draft = drafts[employee.funcionario_id] || emptyDraft()
            const complete = employee.dados_confirmados
            const saving = savingId === employee.funcionario_id
            return <details className="payroll-employee-input-card" key={employee.funcionario_id}>
              <summary>
                <span className="payroll-employee-summary"><strong>{employee.nome}</strong><small>{employee.cargo || 'Cargo não informado'}</small></span>
                <span className="payroll-employee-salary">Salário cadastrado: <strong>{formatMoney(employee.salario_atual)}</strong></span>
                <span className={`payroll-input-status ${complete ? 'is-complete' : 'is-pending'}`}>{complete ? 'Conferido' : 'Pendente'}</span>
              </summary>
              <div className="payroll-input-form">
                <label>Salário-base da competência (R$)<input inputMode="decimal" value={draft.salario_base} onChange={(event) => updateDraft(employee.funcionario_id, { salario_base: event.target.value })} placeholder="Informe e confirme" /><button type="button" className="payroll-use-salary" onClick={() => updateDraft(employee.funcionario_id, { salario_base: employee.salario_atual == null ? '' : String(employee.salario_atual).replace('.', ',') })} disabled={employee.salario_atual == null}>Usar salário do cadastro ({formatMoney(employee.salario_atual)})</button></label>
                <label>Dependentes para IRRF<input type="number" min="0" max="30" step="1" value={draft.dependentes_irrf} onChange={(event) => updateDraft(employee.funcionario_id, { dependentes_irrf: event.target.value })} placeholder="Confirmar quantidade" /></label>
                <label>Outro vínculo empregatício?<select value={draft.outros_vinculos} onChange={(event) => updateDraft(employee.funcionario_id, { outros_vinculos: event.target.value as PayrollDraft['outros_vinculos'] })}><option value="">Selecione — obrigatório</option><option value="nao">Não</option><option value="sim">Sim</option></select></label>
                <label>Outra fonte de rendimentos?<select value={draft.outras_fontes_rendimento} onChange={(event) => updateDraft(employee.funcionario_id, { outras_fontes_rendimento: event.target.value as PayrollDraft['outras_fontes_rendimento'] })}><option value="">Selecione — obrigatório</option><option value="nao">Não</option><option value="sim">Sim</option></select></label>
                <label>Pensão alimentícia desta competência (R$)<input inputMode="decimal" value={draft.pensao_alimenticia} onChange={(event) => updateDraft(employee.funcionario_id, { pensao_alimenticia: event.target.value })} placeholder="Informe o valor ou 0" /></label>
                <label className="payroll-checkbox"><input type="checkbox" checked={draft.pensao_confirmada} onChange={(event) => updateDraft(employee.funcionario_id, { pensao_confirmada: event.target.checked })} /><span>Conferi a pensão aplicável ou confirmei que não há pensão.</span></label>
                <label className="payroll-checkbox"><input type="checkbox" checked={draft.declaracao_confirmada} onChange={(event) => updateDraft(employee.funcionario_id, { declaracao_confirmada: event.target.checked })} /><span>Conferi o salário e os dados desta competência com a documentação.</span></label>
                <div className="payroll-input-actions"><small>{employee.confirmado_em ? `Última conferência: ${new Date(employee.confirmado_em).toLocaleString('pt-BR')}` : 'Ainda não conferido nesta competência.'}</small><button type="button" className="primary-button" onClick={() => void saveEmployee(employee)} disabled={saving}>{saving ? 'Salvando…' : <><Save size={16} /> Salvar conferência</>}</button></div>
              </div>
            </details>
          })}
        </div>
      </>}
    </>}

    {tab === 'simulacao' && <>
      <div className="payroll-disclaimer payroll-disclaimer-warning" role="note">
        <AlertTriangle size={20} />
        <div><strong>Estimativa interna — não usar para pagar, declarar ou recolher</strong><p>Inclui INSS progressivo e IRRF 2026 apenas para vínculo formal mensal, salário cadastrado sem alteração no mês, jornada CLT 44h válida, prévia atualizada, sem falta/atraso/férias/afastamento, sem outro vínculo/rendimento e sem lançamentos de benefícios/descontos. Parcelas de acordos/dívidas e outras rubricas não integradas também não entram no valor; situações não cobertas ficam bloqueadas, não estimadas.</p></div>
      </div>
      <div className="payroll-action-row"><div><strong>Competência: {monthLabel(competencia)}</strong><small>Primeiro confira os dados fiscais e gere a prévia 44h/DSR em Recursos humanos → Fechamento mensal.</small></div><div className="payroll-action-buttons">{onNavigateToHR && <button type="button" className="secondary-button" onClick={onNavigateToHR}>Abrir Recursos humanos <ArrowRight size={15} /></button>}<button type="button" className="primary-button" onClick={() => void simulate()} disabled={simulating}><Calculator size={16} />{simulating ? 'Calculando…' : 'Simular INSS / IRRF'}</button></div></div>

      {simulation && <>
        {simulation.bloqueio_geral && <div className="payroll-inline-error" role="status"><AlertTriangle size={17} />{simulation.bloqueio_geral}</div>}
        <div className="payroll-simulation-summary">
          <div><small>CLT analisados</small><strong>{simulation.quantidade_funcionarios ?? 0}</strong></div>
          <div><small>Simulados</small><strong>{readyItems}</strong></div>
          <div><small>Pendentes / bloqueados</small><strong>{pendingItems}</strong></div>
          <div className="payroll-simulation-state"><small>Estado</small><strong>{simulation.status === 'simulacao_preliminar_completa' ? 'Preliminar completa' : 'Com pendências'}</strong></div>
        </div>
        {simulation.totais && <div className="payroll-estimated-totals">
          <div><small>INSS estimado</small><strong>{formatMoney(simulation.totais.inss_estimado)}</strong></div>
          <div><small>IRRF estimado</small><strong>{formatMoney(simulation.totais.irrf_estimado)}</strong></div>
          <div><small>Líquido tributário estimado*</small><strong>{formatMoney(simulation.totais.liquido_estimado)}</strong></div>
        </div>}
        <SectionCard title="Resultado por funcionário" caption="DSR e horas vêm da prévia 44h; impostos só aparecem quando os pré-requisitos passam.">
          {(simulation.itens || []).length === 0 ? <p>Nenhum vínculo CLT retornado para esta competência.</p> : <div className="payroll-simulation-table-wrap"><table className="payroll-simulation-table"><thead><tr><th>Funcionário / jornada</th><th>DSR da prévia</th><th>HE 50% + 100%</th><th>Remuneração simulada</th><th>INSS</th><th>IRRF</th><th>Líquido tributário estimado</th><th>Situação</th></tr></thead><tbody>{(simulation.itens || []).map((item) => <tr key={item.funcionario_id}>
            <td><strong>{item.nome}</strong><small>{item.jornada_nome || 'Jornada não informada'}</small></td>
            <td>{formatMoney(item.dsr_desconto)}<small>{item.dsr_semanas_perdidas} ocorrência(s)</small></td>
            <td>{formatMoney((item.horas_extras_50_valor || 0) + (item.horas_extras_100_valor || 0))}</td>
            <td>{item.remuneracao_tributavel_estimada == null ? '—' : formatMoney(item.remuneracao_tributavel_estimada)}</td>
            <td>{item.inss_estimado == null ? '—' : formatMoney(item.inss_estimado)}</td>
            <td>{item.irrf_estimado == null ? '—' : formatMoney(item.irrf_estimado)}</td>
            <td>{item.liquido_estimado == null ? '—' : formatMoney(item.liquido_estimado)}</td>
            <td><span className={`payroll-input-status ${item.status === 'simulado' ? 'is-complete' : 'is-pending'}`}>{item.status === 'simulado' ? 'Simulação' : 'Bloqueado'}</span>{item.bloqueios.length > 0 && <ul className="payroll-blocker-list">{item.bloqueios.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</td>
          </tr>)}</tbody></table></div>}
        </SectionCard>
        <div className="payroll-simulation-footnote"><AlertTriangle size={16} /><span>{simulation.aviso || 'Simulação preliminar; não gera pagamento.'} {simulation.source_fingerprint && <small>Prévia de ponto vinculada por fingerprint.</small>}</span></div>
      </>}

      <SectionCard title="Regras e fontes 2026" caption="Tabelas oficiais; incidências e arredondamento ainda precisam de homologação contábil.">
        <div className="payroll-source-links"><a href="https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal" target="_blank" rel="noreferrer">Tabela mensal do INSS <ExternalLink size={14} /></a><a href="https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026" target="_blank" rel="noreferrer">Tabela IRRF 2026 <ExternalLink size={14} /></a><a href="https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm" target="_blank" rel="noreferrer">Lei 15.270/2025 <ExternalLink size={14} /></a></div>
        <p className="payroll-legal-note">A simulação separa rendimentos tributáveis, deduções legais, desconto simplificado e redutor de IRRF. A referência oficial consultada contém exemplos de IRRF 2026 que usam valores de INSS da tabela de 2025; por isso o módulo usa a tabela INSS 2026 e mantém a divergência documentada para validação profissional. Não há botão de confirmar folha ou gerar contas a pagar nesta fase.</p>
      </SectionCard>
    </>}
  </div>
}
