import { Activity, ArrowRight, BriefcaseBusiness, CalendarDays, Check, Clock3, FileCheck2, HeartPulse, ShieldAlert, TrendingUp, UserPlus, UserRound, UsersRound } from 'lucide-react'
import type { AdminJustificationRow, AdminLeaveRow, AdminMedicalLeaveRow, AdminPointRow, AdminRequestRow, AdminVacationRow, EmployeeRow } from '../lib/types'
import { EmptyState, SectionCard, formatDate, formatMoney } from '../components/ui'

type OpenTab = (tab: string) => void
type AlertTone = 'danger' | 'gold' | 'pink' | 'blue'
type AlertPriority = 'Urgente' | 'Atenção' | 'Informativo'
type AlertItem = { id: string; title: string; detail: string; tone: AlertTone; priority: AlertPriority; tab: string; action: string }

function parseMinutes(value?: string | null) {
  if (!value) return 0
  const text = String(value).trim().replace(',', '.')
  if (text.includes(':')) {
    const [hours, minutes] = text.split(':').map(Number)
    return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)
  }
  const number = Number(text)
  return Number.isFinite(number) ? Math.round(number * 60) : 0
}

function formatMinutes(value: number) {
  const hours = Math.floor(Math.max(0, value) / 60)
  const minutes = Math.max(0, value) % 60
  return `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}`
}

function isCurrentMonth(value?: string | null) {
  if (!value) return false
  const now = new Date()
  return value.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function isWithinDays(value?: string | null, days = 30) {
  if (!value) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${value.slice(0, 10)}T12:00:00`)
  const limit = new Date(today)
  limit.setDate(limit.getDate() + days)
  return target >= today && target <= limit
}

function isWithinPastDays(value?: string | null, days = 90) {
  if (!value) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${value.slice(0, 10)}T12:00:00`)
  const limit = new Date(today)
  limit.setDate(limit.getDate() - days)
  return target <= today && target >= limit
}

export function HRDashboardPanel({ point, justifications, leaves, requests, vacations, employees, hrLeaves, onOpenTab }: {
  point: AdminPointRow[]
  justifications: AdminJustificationRow[]
  leaves: AdminMedicalLeaveRow[]
  requests: AdminRequestRow[]
  vacations: AdminVacationRow[]
  hrLeaves: AdminLeaveRow[]
  employees: EmployeeRow[]
  onOpenTab: OpenTab
}) {
  const pendingJustifications = justifications.filter((row) => row.status === 'pendente')
  const pendingLeaves = leaves.filter((row) => ['aguardando', 'pendente', 'em_analise'].includes(row.status))
  const openRequests = requests.filter((row) => !['atendida', 'concluida', 'recusada', 'cancelada'].includes(row.status))
  const inconsistencies = point.filter((row) => Boolean(row.inconsistencia_tipo || row.dia_falta || row.horas_atraso))
  const unjustified = inconsistencies.filter((row) => !row.justificativa_id && row.inconsistencia_status !== 'aprovada')
  const delayRows = point.filter((row) => Boolean(row.horas_atraso))
  const delayMinutes = delayRows.reduce((total, row) => total + parseMinutes(row.horas_atraso), 0)
  const extraMinutes = point.reduce((total, row) => total + parseMinutes(row.extra_50) + parseMinutes(row.extra_100), 0)
  const activeEmployees = employees.filter((row) => row.ativo !== false)
  const inactiveEmployees = employees.filter((row) => row.ativo === false)
  const workingNow = activeEmployees.filter((row) => row.situacao === 'Trabalhando').length
  const onVacation = activeEmployees.filter((row) => row.situacao === 'Em férias').length
  const onLeave = activeEmployees.filter((row) => row.situacao === 'Afastado').length
  const incompleteEmployees = activeEmployees.filter((row) => !row.data_admissao || !row.cargo || row.salario === null).length
  const admissionsThisMonth = employees.filter((row) => isCurrentMonth(row.data_admissao)).length
  const dismissalsThisMonth = employees.filter((row) => isCurrentMonth(row.data_demissao)).length
  const upcomingVacations = vacations.filter((row) => row.status !== 'cancelada' && isWithinDays(row.inicio, 30)).length
  const activeLeaves = hrLeaves.filter((row) => row.status === 'ativo').length
  const salaryEmployees = activeEmployees.filter((row) => Number(row.salario) > 0)
  const salaryByEmployee = new Map(activeEmployees.map((row) => [row.id, Number(row.salario) || 0]))
  const projectedPayroll = salaryEmployees.reduce((total, row) => total + Number(row.salario), 0)
  const vacationProvision = projectedPayroll / 9
  const absenceRows = point.filter((row) => Boolean(row.dia_falta || row.inconsistencia_tipo === 'falta'))
  const unjustifiedAbsenceRows = absenceRows.filter((row) => !row.justificativa_id && row.inconsistencia_status !== 'aprovada' && row.justificativa_status !== 'aceita')
  const absenceImpact = unjustifiedAbsenceRows.reduce((total, row) => total + (salaryByEmployee.get(row.funcionario_id) || 0) / 30, 0)
  const delayImpact = point.reduce((total, row) => total + ((salaryByEmployee.get(row.funcionario_id) || 0) / 220) * parseMinutes(row.horas_atraso) / 60, 0)
  const extraImpact = point.reduce((total, row) => {
    const hourly = (salaryByEmployee.get(row.funcionario_id) || 0) / 220
    return total + hourly * (parseMinutes(row.extra_50) / 60) * 1.5 + hourly * (parseMinutes(row.extra_100) / 60) * 2
  }, 0)
  const observedDays = new Set(point.map((row) => row.data.slice(0, 10))).size
  const absenteeismRate = activeEmployees.length && observedDays ? (absenceRows.length / (activeEmployees.length * observedDays)) * 100 : 0
  const totalVariableImpact = absenceImpact + delayImpact + extraImpact
  const today = new Date()
  const twelveMonthsAgo = new Date(today)
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
  const recentAdmissions = employees.filter((row) => row.data_admissao && new Date(`${row.data_admissao.slice(0, 10)}T12:00:00`) >= twelveMonthsAgo && new Date(`${row.data_admissao.slice(0, 10)}T12:00:00`) <= today)
  const recentDismissals = employees.filter((row) => row.data_demissao && new Date(`${row.data_demissao.slice(0, 10)}T12:00:00`) >= twelveMonthsAgo && new Date(`${row.data_demissao.slice(0, 10)}T12:00:00`) <= today)
  const estimatedOpeningHeadcount = Math.max(0, activeEmployees.length + recentDismissals.length - recentAdmissions.length)
  const estimatedAverageHeadcount = Math.max(1, (estimatedOpeningHeadcount + activeEmployees.length) / 2)
  const turnoverRate = (((recentAdmissions.length + recentDismissals.length) / 2) / estimatedAverageHeadcount) * 100
  const retentionRate = Math.max(0, 100 - (recentDismissals.length / estimatedAverageHeadcount) * 100)
  const tenureMonths = activeEmployees.filter((row) => row.data_admissao).reduce((total, row) => total + Math.max(0, (today.getTime() - new Date(`${row.data_admissao!.slice(0, 10)}T12:00:00`).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)), 0)
  const averageTenureMonths = activeEmployees.filter((row) => row.data_admissao).length ? tenureMonths / activeEmployees.filter((row) => row.data_admissao).length : 0
  const probationaryEmployees = activeEmployees.filter((row) => isWithinPastDays(row.data_admissao, 90)).length
  const recentMovements = [...recentAdmissions.map((row) => ({ id: `admission-${row.id}`, date: row.data_admissao!, name: row.nome, type: 'Admissão', tone: 'is-admission' })), ...recentDismissals.map((row) => ({ id: `dismissal-${row.id}`, date: row.data_demissao!, name: row.nome, type: 'Demissão', tone: 'is-dismissal' }))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
  const periodLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date())

  const alerts: AlertItem[] = [
    ...unjustified.slice(0, 4).map((row) => ({ id: `unjustified-${row.id}`, title: `${row.nome} tem uma inconsistência sem justificativa`, detail: `${row.inconsistencia_tipo === 'falta' ? 'Falta' : 'Atraso'} · ${formatDate(row.data)} · requer decisão`, tone: 'danger' as const, priority: 'Urgente' as const, tab: 'ponto', action: 'Revisar ponto' })),
    ...pendingJustifications.slice(0, 4).map((row) => ({ id: `just-${row.id}`, title: `${row.nome} enviou uma justificativa`, detail: `${row.tipo} · ${formatDate(row.data_registro)} · aguardando análise`, tone: 'danger' as const, priority: 'Urgente' as const, tab: 'justificativas', action: 'Analisar' })),
    ...pendingLeaves.slice(0, 4).map((row) => ({ id: `leave-${row.id}`, title: `${row.nome} enviou um atestado`, detail: `${row.tipo} · ${formatDate(row.data_atendimento)} · ${row.dias} dia(s)`, tone: 'gold' as const, priority: 'Atenção' as const, tab: 'atestados', action: 'Conferir' })),
    ...openRequests.slice(0, 4).map((row) => ({ id: `request-${row.id}`, title: `${row.nome} abriu uma solicitação`, detail: `${row.tipo} · ${formatDate(row.created_at)}`, tone: 'pink' as const, priority: 'Atenção' as const, tab: 'solicitacoes', action: 'Responder' })),
    ...(incompleteEmployees > 0 ? [{ id: 'incomplete-employees', title: `${incompleteEmployees} cadastro(s) precisam de revisão`, detail: 'Admissão, cargo ou salário não preenchido', tone: 'blue' as const, priority: 'Informativo' as const, tab: 'admissoes', action: 'Ver cadastros' }] : []),
  ].slice(0, 8)

  const cards = [
    { label: 'Quadro ativo', value: activeEmployees.length, detail: `${inactiveEmployees.length} inativo(s) no cadastro`, tone: 'blue', tab: 'admissoes', icon: <UsersRound size={17} /> },
    { label: 'Disponibilidade hoje', value: workingNow, detail: `${onVacation} em férias · ${onLeave} afastado(s)`, tone: 'green', tab: 'prontuario', icon: <Activity size={17} /> },
    { label: 'Pendências críticas', value: pendingJustifications.length + pendingLeaves.length + unjustified.length, detail: `${unjustified.length} sem justificativa no ponto`, tone: 'danger', tab: 'ponto', icon: <ShieldAlert size={17} /> },
    { label: 'Atrasos acumulados', value: formatMinutes(delayMinutes), detail: `${delayRows.length} dia(s) com atraso`, tone: 'gold', tab: 'ponto', icon: <Clock3 size={17} /> },
    { label: 'Horas extras', value: formatMinutes(extraMinutes), detail: 'Soma de extras 50% e 100%', tone: 'pink', tab: 'ponto', icon: <TrendingUp size={17} /> },
    { label: 'Movimentações', value: admissionsThisMonth + dismissalsThisMonth, detail: `${admissionsThisMonth} admissão(ões) · ${dismissalsThisMonth} demissão(ões)`, tone: 'gold', tab: 'admissoes', icon: <BriefcaseBusiness size={17} /> },
  ]

  return <div className="hr-dashboard">
    <div className="hr-dashboard-intro"><div><span className="eyebrow">Pessoas · decisão operacional</span><h2>Painel executivo do RH</h2><p>Indicadores atuais da equipe e pendências que exigem atenção no período.</p></div><div className="hr-dashboard-period"><span>Referência</span><strong>{periodLabel}</strong><small>Atualizado com os registros disponíveis</small></div><button className="secondary-button" type="button" onClick={() => onOpenTab('prontuario')}><UserRound size={16} /> Abrir prontuários</button></div>
    <div className="hr-metric-grid hr-executive-grid">{cards.map((card) => <button key={card.label} className={`hr-metric-card is-${card.tone}`} type="button" onClick={() => onOpenTab(card.tab)}><span>{card.icon} {card.label}</span><strong>{card.value}</strong><small>{card.detail}</small></button>)}</div>
    <div className="hr-dashboard-columns">
      <SectionCard title="Central de alertas prioritários" caption={`${alerts.length} alertas selecionados por urgência`}>
        {alerts.length === 0 ? <EmptyState title="Tudo em dia" description="Não há justificativas, atestados, solicitações ou inconsistências aguardando análise." /> : <div className="hr-alert-list">{alerts.map((alert) => <div className={`hr-alert-item is-${alert.tone}`} key={alert.id}><span className="hr-alert-icon">{alert.tone === 'danger' ? <ShieldAlert size={17} /> : alert.tone === 'gold' ? <HeartPulse size={17} /> : alert.tone === 'blue' ? <UsersRound size={17} /> : <FileCheck2 size={17} />}</span><div className="hr-alert-copy"><strong>{alert.title}</strong><small><b className={`hr-alert-priority is-${alert.priority === 'Urgente' ? 'urgent' : alert.priority === 'Atenção' ? 'attention' : 'info'}`}>{alert.priority}</b> · {alert.detail}</small></div><button className="icon-button" type="button" onClick={() => onOpenTab(alert.tab)} aria-label={alert.action} title={alert.action}><ArrowRight size={16} /></button></div>)}</div>}
      </SectionCard>
      <SectionCard title="Atalhos de operação" caption="Ações frequentes do departamento pessoal"><div className="hr-quick-actions"><button type="button" onClick={() => onOpenTab('cadastro')}><UserPlus size={18} /><span><strong>Cadastrar vínculo</strong><small>Admissão e acesso inicial</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('ferias')}><CalendarDays size={18} /><span><strong>Gerenciar férias</strong><small>{upcomingVacations} início(s) nos próximos 30 dias</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('fechamento')}><CalendarDays size={18} /><span><strong>Fechamento mensal</strong><small>Conferir ponto e valores</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('avisos')}><Check size={18} /><span><strong>Publicar aviso</strong><small>Comunicar a equipe</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('prontuario')}><UsersRound size={18} /><span><strong>Consultar funcionário</strong><small>{activeEmployees.length} ativos no cadastro</small></span><ArrowRight size={15} /></button></div></SectionCard>
    </div>
    <SectionCard title="Leitura rápida da equipe" caption="Disponibilidade e qualidade dos registros atuais"><div className="hr-overview-strip"><div><span>Trabalhando hoje</span><strong>{workingNow}</strong></div><div><span>Em férias</span><strong>{onVacation}</strong></div><div><span>Em afastamento</span><strong>{onLeave}</strong></div><div><span>Cadastros a revisar</span><strong>{incompleteEmployees}</strong></div></div></SectionCard>
    <div className="hr-cost-grid"><button className="hr-analysis-card is-money" type="button" onClick={() => onOpenTab('fechamento')}><span><BriefcaseBusiness size={17} /> Folha projetada</span><strong>{formatMoney(projectedPayroll)}</strong><small>{salaryEmployees.length} de {activeEmployees.length} ativos com salário informado</small></button><button className="hr-analysis-card is-gold" type="button" onClick={() => onOpenTab('ferias')}><span><CalendarDays size={17} /> Provisão mensal de férias</span><strong>{formatMoney(vacationProvision)}</strong><small>Estimativa de salário + 1/3, distribuída em 12 meses</small></button><button className="hr-analysis-card is-danger" type="button" onClick={() => onOpenTab('ponto')}><span><ShieldAlert size={17} /> Impacto variável estimado</span><strong>{formatMoney(totalVariableImpact)}</strong><small>Faltas, atrasos e horas extras · referência gerencial</small></button><button className="hr-analysis-card is-blue" type="button" onClick={() => onOpenTab('ponto')}><span><Activity size={17} /> Taxa de absenteísmo</span><strong>{absenteeismRate.toFixed(1).replace('.', ',')}%</strong><small>{absenceRows.length} falta(s) em {observedDays} dia(s) observados</small></button></div>
    <div className="hr-finance-analysis"><SectionCard title="Projeção de custos da equipe" caption="Estimativa com salário cadastrado; não substitui o fechamento oficial"><div className="hr-analysis-list"><div><span>Salários base projetados</span><strong>{formatMoney(projectedPayroll)}</strong></div><div><span>Provisão de férias + 1/3</span><strong>{formatMoney(vacationProvision)}</strong></div><div><span>Custo estimado de faltas injustificadas</span><strong>{formatMoney(absenceImpact)}</strong></div><div><span>Custo estimado de atrasos</span><strong>{formatMoney(delayImpact)}</strong></div><div><span>Valor estimado de horas extras</span><strong>{formatMoney(extraImpact)}</strong></div></div></SectionCard><SectionCard title="Análise de absenteísmo" caption="Base calculada sobre os dias de ponto observados"><div className="hr-analysis-list"><div><span>Dias com falta registrados</span><strong>{absenceRows.length}</strong></div><div><span>Faltas sem justificativa aceita</span><strong>{unjustifiedAbsenceRows.length}</strong></div><div><span>Dias com atraso</span><strong>{delayRows.length}</strong></div><div><span>Minutos de atraso acumulados</span><strong>{formatMinutes(delayMinutes)}</strong></div><div><span>Dias de ponto observados</span><strong>{observedDays}</strong></div></div></SectionCard></div>
    <div className="hr-turnover-grid"><button className="hr-analysis-card is-pink" type="button" onClick={() => onOpenTab('admissoes')}><span><TrendingUp size={17} /> Turnover estimado · 12 meses</span><strong>{turnoverRate.toFixed(1).replace('.', ',')}%</strong><small>{recentAdmissions.length} admissão(ões) e {recentDismissals.length} demissão(ões) no período</small></button><button className="hr-analysis-card is-green" type="button" onClick={() => onOpenTab('admissoes')}><span><UsersRound size={17} /> Retenção do quadro</span><strong>{retentionRate.toFixed(1).replace('.', ',')}%</strong><small>Proxy de permanência baseado nas demissões dos últimos 12 meses</small></button><button className="hr-analysis-card is-blue" type="button" onClick={() => onOpenTab('admissoes')}><span><BriefcaseBusiness size={17} /> Permanência média</span><strong>{averageTenureMonths.toFixed(1).replace('.', ',')} meses</strong><small>Entre funcionários ativos com data de admissão</small></button><button className="hr-analysis-card is-gold" type="button" onClick={() => onOpenTab('admissoes')}><span><UserPlus size={17} /> Em experiência</span><strong>{probationaryEmployees}</strong><small>Admitidos nos últimos 90 dias</small></button></div>
    <div className="hr-turnover-analysis"><SectionCard title="Movimentação do quadro" caption="Histórico disponível de admissões e demissões"><div className="hr-analysis-list"><div><span>Quadro inicial estimado</span><strong>{estimatedOpeningHeadcount}</strong></div><div><span>Média estimada de funcionários</span><strong>{estimatedAverageHeadcount.toFixed(1).replace('.', ',')}</strong></div><div><span>Saldo de movimentações</span><strong>{recentAdmissions.length - recentDismissals.length >= 0 ? '+' : ''}{recentAdmissions.length - recentDismissals.length}</strong></div><div><span>Admissões nos últimos 12 meses</span><strong>{recentAdmissions.length}</strong></div><div><span>Demissões nos últimos 12 meses</span><strong>{recentDismissals.length}</strong></div></div></SectionCard><SectionCard title="Movimentações recentes" caption="Últimos registros disponíveis na base"><div className="hr-movement-list">{recentMovements.length === 0 ? <EmptyState title="Nenhuma movimentação recente" description="Admissões e demissões aparecerão aqui quando registradas." /> : recentMovements.map((movement) => <div className="hr-movement-row" key={movement.id}><span className={`hr-movement-dot ${movement.tone}`} /><div><strong>{movement.name}</strong><small>{movement.type} · {formatDate(movement.date)}</small></div></div>)}</div></SectionCard></div>
    <div className="hr-insight-grid"><SectionCard title="Jornada e ocorrências" caption="Sinais que impactam a rotina"><div className="hr-insight-list"><button type="button" onClick={() => onOpenTab('ponto')}><Clock3 size={17} /><span><strong>{inconsistencies.length} inconsistência(s) de ponto</strong><small>{unjustified.length} ainda sem decisão administrativa</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('ponto')}><TrendingUp size={17} /><span><strong>{formatMinutes(extraMinutes)} de horas extras</strong><small>Somatório dos adicionais registrados</small></span><ArrowRight size={15} /></button></div></SectionCard><SectionCard title="Planejamento de pessoas" caption="Próximos movimentos do quadro"><div className="hr-insight-list"><button type="button" onClick={() => onOpenTab('ferias')}><CalendarDays size={17} /><span><strong>{upcomingVacations} férias iniciando em até 30 dias</strong><small>{vacations.length} período(s) lançado(s) no histórico</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('afastamentos')}><HeartPulse size={17} /><span><strong>{activeLeaves} afastamento(s) ativo(s)</strong><small>Períodos que impactam ponto e fechamento</small></span><ArrowRight size={15} /></button></div></SectionCard></div>
  </div>
}
