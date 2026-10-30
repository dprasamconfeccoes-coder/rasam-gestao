import { AlertCircle, ArrowRight, CalendarDays, Check, FileCheck2, HeartPulse, ShieldAlert, UserRound, UsersRound } from 'lucide-react'
import type { AdminJustificationRow, AdminMedicalLeaveRow, AdminPointRow, AdminRequestRow, EmployeeRow } from '../lib/types'
import { EmptyState, SectionCard, StatusPill, formatDate } from '../components/ui'

type OpenTab = (tab: string) => void

type AlertItem = {
  id: string
  title: string
  detail: string
  tone: 'danger' | 'gold' | 'pink'
  tab: string
  action: string
}

export function HRDashboardPanel({
  point,
  justifications,
  leaves,
  requests,
  employees,
  onOpenTab,
}: {
  point: AdminPointRow[]
  justifications: AdminJustificationRow[]
  leaves: AdminMedicalLeaveRow[]
  requests: AdminRequestRow[]
  employees: EmployeeRow[]
  onOpenTab: OpenTab
}) {
  const pendingJustifications = justifications.filter((row) => row.status === 'pendente')
  const pendingLeaves = leaves.filter((row) => ['aguardando', 'pendente', 'em_analise'].includes(row.status))
  const openRequests = requests.filter((row) => !['atendida', 'concluida', 'recusada', 'cancelada'].includes(row.status))
  const inconsistencies = point.filter((row) => Boolean(row.inconsistencia_tipo || row.dia_falta || row.horas_atraso))
  const unjustified = inconsistencies.filter((row) => !row.justificativa_id && row.inconsistencia_status !== 'aprovada')
  const activeEmployees = employees.filter((row) => row.ativo !== false).length

  const alerts: AlertItem[] = [
    ...pendingJustifications.slice(0, 4).map((row) => ({
      id: `just-${row.id}`,
      title: `${row.nome} enviou uma justificativa`,
      detail: `${row.tipo} · ${formatDate(row.data_registro)} · aguardando análise`,
      tone: 'danger' as const,
      tab: 'justificativas',
      action: 'Analisar',
    })),
    ...pendingLeaves.slice(0, 4).map((row) => ({
      id: `leave-${row.id}`,
      title: `${row.nome} enviou um atestado`,
      detail: `${row.tipo} · ${formatDate(row.data_atendimento)} · ${row.dias} dia(s)`,
      tone: 'gold' as const,
      tab: 'atestados',
      action: 'Conferir',
    })),
    ...openRequests.slice(0, 4).map((row) => ({
      id: `request-${row.id}`,
      title: `${row.nome} abriu uma solicitação`,
      detail: `${row.tipo} · ${formatDate(row.created_at)}`,
      tone: 'pink' as const,
      tab: 'solicitacoes',
      action: 'Responder',
    })),
  ].slice(0, 8)

  return <div className="hr-dashboard">
    <div className="hr-dashboard-intro"><div><span className="eyebrow">Pessoas · departamento pessoal</span><h2>Painel de atenção do RH</h2><p>Uma visão rápida do que precisa de análise na empresa hoje.</p></div><button className="secondary-button" type="button" onClick={() => onOpenTab('prontuario')}><UserRound size={16} /> Abrir prontuários</button></div>
    <div className="hr-metric-grid">
      <button className="hr-metric-card is-danger" type="button" onClick={() => onOpenTab('justificativas')}><span><FileCheck2 size={17} /> Justificativas</span><strong>{pendingJustifications.length}</strong><small>Aguardando análise</small></button>
      <button className="hr-metric-card is-gold" type="button" onClick={() => onOpenTab('atestados')}><span><HeartPulse size={17} /> Atestados</span><strong>{pendingLeaves.length}</strong><small>Aguardando conferência</small></button>
      <button className="hr-metric-card is-pink" type="button" onClick={() => onOpenTab('solicitacoes')}><span><FileCheck2 size={17} /> Solicitações</span><strong>{openRequests.length}</strong><small>Pedidos em aberto</small></button>
      <button className="hr-metric-card is-blue" type="button" onClick={() => onOpenTab('ponto')}><span><ShieldAlert size={17} /> Ponto</span><strong>{unjustified.length}</strong><small>Inconsistências sem justificativa</small></button>
    </div>
    <div className="hr-dashboard-columns">
      <SectionCard title="Central de alertas" caption={`${alerts.length} alertas prioritários encontrados`}>
        {alerts.length === 0 ? <EmptyState title="Tudo em dia" description="Não há justificativas, atestados ou solicitações aguardando análise." /> : <div className="hr-alert-list">{alerts.map((alert) => <div className={`hr-alert-item is-${alert.tone}`} key={alert.id}><span className="hr-alert-icon">{alert.tone === 'danger' ? <ShieldAlert size={17} /> : alert.tone === 'gold' ? <HeartPulse size={17} /> : <FileCheck2 size={17} />}</span><div className="hr-alert-copy"><strong>{alert.title}</strong><small>{alert.detail}</small></div><button className="icon-button" type="button" onClick={() => onOpenTab(alert.tab)} aria-label={alert.action} title={alert.action}><ArrowRight size={16} /></button></div>)}</div>}
      </SectionCard>
      <SectionCard title="Atalhos de operação" caption="Ações frequentes do departamento pessoal"><div className="hr-quick-actions"><button type="button" onClick={() => onOpenTab('cadastro')}><UserRound size={18} /><span><strong>Cadastrar vínculo</strong><small>Admissão e acesso inicial</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('fechamento')}><CalendarDays size={18} /><span><strong>Fechamento mensal</strong><small>Conferir ponto e valores</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('avisos')}><Check size={18} /><span><strong>Publicar aviso</strong><small>Comunicar a equipe</small></span><ArrowRight size={15} /></button><button type="button" onClick={() => onOpenTab('prontuario')}><UsersRound size={18} /><span><strong>Consultar funcionário</strong><small>{activeEmployees} ativos no cadastro</small></span><ArrowRight size={15} /></button></div></SectionCard>
    </div>
    <SectionCard title="Leitura rápida da equipe" caption="Indicadores conectados aos registros atuais"><div className="hr-overview-strip"><div><span>Funcionários ativos</span><strong>{activeEmployees}</strong></div><div><span>Inconsistências de ponto</span><strong>{inconsistencies.length}</strong></div><div><span>Sem justificativa</span><strong>{unjustified.length}</strong></div><div><span>Solicitações abertas</span><strong>{openRequests.length}</strong></div></div></SectionCard>
  </div>
}
