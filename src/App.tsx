import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BellOff,
  BellRing,
  BookOpen,
  Download,
  FileSpreadsheet,
  Scale,
  Upload,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Factory,
  FileCheck2,
  FileText,
  Fingerprint,
  Gauge,
  HardHat,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  PauseCircle,
  Receipt,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react'
import rfLogo from './assets/rf-logo.png'
import {
  clearToken,
  createPointJustification,
  decidePointJustification,
  decidePointInconsistency,
  applyPointImport,
  importPoint,
  ignorePointImport,
  listImportedPoint,
  listPointImports,
  dashboard,
  getFactoryProduction,
  listAgreements,
  managedDebts,
  adminProntuario,
  getSession,
  getToken,
  listEmployees,
  listMedicalLeaves,
  listNotices,
  listNoticeAttachments,
  markNoticeRead,
  listPayslips,
  listPoint,
  unreadNoticeCount,
  login,
  logout,
  myProfile,
  setPassword,
  setToken,
  updateAvatar,
  uploadMedicalLeave,
} from './lib/api'
import { EmployeeMedicalLeaves } from './features/MedicalLeavesWorkflow'
import { EmployeeHRRequests } from './features/EmployeeHRRequests'
import { NoticeAttachments } from './features/NoticeAttachments'
import { AgreementsDashboard } from './features/AgreementsDashboard'
import { WorkOrdersDashboard } from './features/WorkOrdersDashboard'
import { FactoryProductionDashboard } from './features/FactoryProductionDashboard'
import type {
  DashboardResponse,
  EmployeeProfile,
  EmployeeRow,
  LoginResponse,
  MedicalLeaveRow,
  ModuleKey,
  NoticeRow,
  PayslipRow,
  PointRow,
  Profile,
  SessionUser,
  PointImportRow,
  PointImportSummary,
} from './lib/types'
import { getNotificationPermission, requestNotificationPermission, showDashboardNotification, subscribeDashboardRealtime, type DashboardLiveEvent } from './lib/dashboard-realtime'
import { buildOverviewReportRows, downloadDashboardCsv, exportDashboardPdf, type OverviewReportEnrichment } from './features/dashboard-executive-report'
import { AdminCenterV2 as AdminCenter } from './features/AdminCenterV2'
import { DebtManagementDashboard } from './features/DebtManagementDashboard'
import { FinanceExecutiveDashboard } from './features/FinanceExecutiveDashboard'
import { FinanceReportsDashboard } from './features/FinanceReportsDashboard'
import { InternalDocumentsDashboard } from './features/InternalDocumentsDashboard'
import { EmployeeFichaPanel } from './features/EmployeeFichaPanel'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeading,
  SectionCard,
  StatusPill,
  formatDate,
  formatMoney,
} from './components/ui'
import './styles.css'
import './overview-dashboard.css'

const managerProfiles: Profile[] = ['gestor', 'administrador', 'admin']
const adminProfiles: Profile[] = ['administrador', 'admin']

type NavItem = { key: ModuleKey; label: string; description: string; icon: typeof Gauge; group: string; profiles: Profile[] }

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Visão geral', description: 'O que precisa de atenção hoje', icon: LayoutDashboard, group: 'Operação', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'funcionarios', label: 'Funcionários', description: 'Equipe e acessos', icon: UsersRound, group: 'Operação', profiles: managerProfiles },
  { key: 'ordens', label: 'Ordens de serviço', description: 'Cadastro de lotes e financeiro', icon: ClipboardList, group: 'Operação', profiles: adminProfiles },
  { key: 'producao', label: 'Produção', description: 'Lotes e costura', icon: Factory, group: 'Operação', profiles: managerProfiles },
  { key: 'financeiro', label: 'Financeiro', description: 'Fluxo e compromissos', icon: CircleDollarSign, group: 'Controle', profiles: managerProfiles },
  { key: 'acordos', label: 'Acordos e parcelas', description: 'Pagamentos trabalhistas', icon: Scale, group: 'Controle', profiles: adminProfiles },
  { key: 'dividas', label: 'Dívidas', description: 'Saldos e vencimentos', icon: WalletCards, group: 'Controle', profiles: adminProfiles },
  { key: 'relatorios', label: 'Relatórios', description: 'Leituras da operação', icon: BarChart3, group: 'Controle', profiles: managerProfiles },
  { key: 'importacoes', label: 'Importar ponto', description: 'CSV diário e mensal', icon: FileSpreadsheet, group: 'Controle', profiles: managerProfiles },
  { key: 'rh', label: 'Recursos humanos', description: 'Painel e operações de RH', icon: BriefcaseBusiness, group: 'Pessoas', profiles: adminProfiles },
  { key: 'perfil', label: 'Meu perfil', description: 'Dados cadastrais', icon: UserRound, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'ponto', label: 'Meu ponto', description: 'Jornada registrada', icon: Fingerprint, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'holerites', label: 'Holerites', description: 'Comprovantes disponíveis', icon: Receipt, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'atestados', label: 'Atestados', description: 'Histórico e conferência', icon: HeartPulse, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'solicitacoes', label: 'Solicitações ao RH', description: 'Acompanhe seus pedidos', icon: FileCheck2, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'avisos', label: 'Avisos', description: 'Comunicados da empresa', icon: Bell, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'documentos', label: 'Documentos internos', description: 'Biblioteca compartilhada da empresa', icon: BookOpen, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
]

function profileLabel(profile: Profile) {
  if (profile === 'admin' || profile === 'administrador') return 'Administrador'
  if (profile === 'gestor') return 'Gestor'
  return 'Funcionário'
}

function maskCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '')
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : cpf
}

function normalizeCpf(value: string) {
  return value.replace(/\D/g, '').slice(0, 11)
}

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'RF'
}

function UserAvatar({ name, url, className = '' }: { name: string; url?: string | null; className?: string }) {
  return <div className={`user-avatar ${className}`} aria-label={`Foto de ${name}`}>
    {url ? <img src={url} alt={`Foto de ${name}`} /> : initials(name)}
  </div>
}

async function compressAvatar(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Selecione uma imagem válida.')
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    image.src = URL.createObjectURL(file)
  })
  const size = Math.min(Math.max(source.naturalWidth, source.naturalHeight), 512)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Seu navegador não suporta o processamento da imagem.')
  const scale = Math.max(size / source.naturalWidth, size / source.naturalHeight)
  const width = source.naturalWidth * scale
  const height = source.naturalHeight * scale
  context.fillStyle = '#f3f0eb'
  context.fillRect(0, 0, size, size)
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height)
  URL.revokeObjectURL(source.src)
  return canvas.toDataURL('image/jpeg', 0.78)
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (response: LoginResponse) => void }) {
  const [cpf, setCpf] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (normalizeCpf(cpf).length !== 11 || password.trim().length === 0) {
      setError('Informe um CPF válido e a senha.')
      return
    }
    setLoading(true)
    try {
      const response = await login(normalizeCpf(cpf), password)
      if (!response.sucesso || !response.token) {
        setError(response.erro || 'Não foi possível iniciar a sessão.')
        return
      }
      setToken(response.token)
      onLoggedIn(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de comunicação com o Supabase.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-grid" />
      <section className="auth-panel">
        <div className="brand-lockup"><img className="brand-logo" src={rfLogo} alt="RF — Rafaela Fernandes" /><div><strong>RF</strong><span>Rafaela Fernandes</span></div></div>
        <div className="auth-copy"><span className="eyebrow">Rafaela Fernandes · acesso único</span><h1>Operação clara.<br /><em>Decisões no tempo certo.</em></h1><p>Gestão, liderança e portal do funcionário em um só ambiente protegido.</p></div>
        <div className="auth-feature"><ShieldCheck size={18} /><span>Seu perfil libera somente o que você precisa acessar.</span></div>
      </section>
      <section className="auth-card">
        <div className="auth-card-head"><div className="mobile-brand"><img className="brand-logo compact" src={rfLogo} alt="RF — Rafaela Fernandes" /><strong>RF Gestão</strong></div><span className="eyebrow">Entrar no sistema</span><h2>Acesso da equipe</h2><p>Use seu CPF e sua senha para continuar.</p></div>
        <form onSubmit={submit} className="form-stack">
          <label>CPF<input value={cpf} onChange={(event) => setCpf(normalizeCpf(event.target.value))} inputMode="numeric" autoComplete="username" placeholder="CPF com 11 dígitos" maxLength={11} /></label>
          <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Sua senha" /></label>
          <div className="form-hint"><Fingerprint size={15} /> Na primeira entrada, use sua data de nascimento no formato DDMMAAAA.</div>
          {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? <><RefreshCw className="spin" size={17} /> Conferindo acesso…</> : <>Entrar na RF Gestão <ArrowRight size={17} /></>}</button>
        </form>
        <div className="auth-footer"><span>Ambiente protegido por Supabase</span><span className="live-dot">● online</span></div>
      </section>
    </main>
  )
}

function FirstAccessScreen({ token, user, onDone, onLogout }: { token: string; user: SessionUser; onDone: () => void; onLogout: () => void }) {
  const [password, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 8) return setError('A nova senha precisa ter pelo menos 8 caracteres.')
    if (password !== confirmation) return setError('As senhas não conferem.')
    setLoading(true)
    try {
      const response = await setPassword(token, password)
      if (!response.sucesso) return setError(response.erro || 'Não foi possível atualizar a senha.')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de comunicação com o Supabase.')
    } finally { setLoading(false) }
  }
  return (
    <main className="auth-page first-access-page">
      <section className="first-access-card">
        <div className="brand-lockup"><img className="brand-logo" src={rfLogo} alt="RF — Rafaela Fernandes" /><div><strong>RF</strong><span>Rafaela Fernandes</span></div></div>
        <span className="eyebrow">Primeiro acesso · {profileLabel(user.perfil)}</span>
        <h1>Vamos proteger<br /><em>seu acesso.</em></h1>
        <p>Olá, <strong>{user.nome.split(' ')[0]}</strong>. A senha temporária da ficha já foi reconhecida. Defina uma senha pessoal para continuar.</p>
        <form onSubmit={submit} className="form-stack">
          <label>Nova senha<input type="password" value={password} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" autoComplete="new-password" /></label>
          <label>Confirme a nova senha<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repita a senha" autoComplete="new-password" /></label>
          {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? <><RefreshCw className="spin" size={17} /> Salvando…</> : <>Salvar e acessar <ArrowRight size={17} /></>}</button>
        </form>
        <button className="text-button" onClick={onLogout}><LogOut size={15} /> Sair e voltar depois</button>
      </section>
    </main>
  )
}

function DashboardView({ token, user, onNavigate }: { token: string; user: SessionUser; onNavigate: (key: ModuleKey) => void }) {
  const [state, setState] = useState<{ loading: boolean; data?: DashboardResponse; enrichment?: OverviewReportEnrichment; error?: string }>({ loading: true })
  const [liveEvents, setLiveEvents] = useState<DashboardLiveEvent[]>([])
  const [liveConnected, setLiveConnected] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(getNotificationPermission())
  const [chartMetric, setChartMetric] = useState<'ordens' | 'entregues'>('ordens')
  const [chartRange, setChartRange] = useState<3 | 6>(6)
  const [reportLoading, setReportLoading] = useState(false)
  const [periodPreset, setPeriodPreset] = useState<'hoje' | '7d' | 'mes' | 'anterior' | '6m' | 'custom'>('6m')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  useEffect(() => {
    async function loadOverview() {
      try {
        const data = await dashboard(token)
        const enrichment: OverviewReportEnrichment = {}
        if (adminProfiles.includes(user.perfil)) {
          const [productionResult, agreementsResult, debtsResult] = await Promise.allSettled([
            getFactoryProduction(token),
            listAgreements(token),
            managedDebts(token),
          ])
          if (productionResult.status === 'fulfilled' && productionResult.value.sucesso) enrichment.production = productionResult.value.resumo
          if (agreementsResult.status === 'fulfilled' && agreementsResult.value.sucesso) enrichment.agreements = agreementsResult.value.parcelas
          if (debtsResult.status === 'fulfilled' && debtsResult.value.sucesso) enrichment.debts = debtsResult.value.dividas
        }
        setState({ loading: false, data, enrichment })
      } catch (err) {
        setState({ loading: false, error: err instanceof Error ? err.message : 'Erro desconhecido' })
      }
    }
    void loadOverview()
  }, [token, user.perfil])
  useEffect(() => {
    setLiveConnected(true)
    const unsubscribe = subscribeDashboardRealtime((event) => {
      setLiveEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 5))
      showDashboardNotification(event)
      dashboard(token).then((data) => setState((current) => ({ ...current, loading: false, data }))).catch(() => undefined)
    })
    return () => { unsubscribe(); setLiveConnected(false) }
  }, [token])
  async function enableNotifications() {
    const permission = await requestNotificationPermission()
    setNotificationPermission(permission)
  }
  function exportCsv() {
    if (state.data) downloadDashboardCsv(state.data, user, { ...state.enrichment, periodLabel })
  }
  async function exportPdf() {
    if (!state.data) return
    setReportLoading(true)
    try { await exportDashboardPdf(state.data, user, { ...state.enrichment, periodLabel }) } finally { setReportLoading(false) }
  }
  if (state.loading) return <><PageHeading eyebrow="Centro de comando" title="Visão geral" description={`Bom dia, ${user.nome.split(' ')[0]}.`} /><LoadingState label="Preparando seu painel de atenção…" /></>
  if (state.error || !state.data?.sucesso) return <><PageHeading eyebrow="Centro de comando" title="Visão geral" /><ErrorState message={state.error || state.data?.erro || 'Sessão inválida'} /></>
  const data = state.data; const isEmployee = user.perfil === 'funcionario'; const isAdmin = adminProfiles.includes(user.perfil); const indicators = data.indicadores!; const personal = data.pessoal || {}; const alerts = data.alertas || []; const funnel: DashboardResponse['funil'] = data.funil; const comparisons = data.comparativos || {}; const intelligence = data.inteligencia || {}; const agenda = intelligence.agenda || []; const evolution = intelligence.evolucao || []; const maxEvolution = Math.max(1, ...evolution.flatMap((point) => [point.ordens, point.entregues])); const variation = (current = 0, previous = 0) => previous === 0 ? (current > 0 ? 'Novo no período' : 'Sem movimentação') : `${current - previous >= 0 ? '+' : ''}${current - previous} versus mês anterior`;
  const reportRows = buildOverviewReportRows(data, state.enrichment)
  const reportGroups = ['Pessoas', 'Produção', 'Financeiro', 'Acordos', 'Dívidas'].map((group) => ({ group, rows: reportRows.filter((item) => item.grupo === group) })).filter((item) => item.rows.length)
  const reportDestination = (module: string): ModuleKey => module === 'dividas' ? 'dividas' : module === 'acordos' ? 'acordos' : module === 'rh' || module === 'afastamentos' ? 'rh' : module === 'producao' ? 'producao' : module === 'ponto' ? 'ponto' : module === 'ordens' ? 'ordens' : 'financeiro'
  const selectedPeriodMonths = periodPreset === 'hoje' || periodPreset === '7d' || periodPreset === 'mes' || periodPreset === 'anterior' ? 1 : periodPreset === '6m' ? 6 : customStart && customEnd ? Math.min(12, Math.max(1, Math.ceil((new Date(`${customEnd}T12:00:00`).getTime() - new Date(`${customStart}T12:00:00`).getTime()) / (30 * 24 * 60 * 60 * 1000)))) : 6
  const filteredEvolution = evolution.slice(-Math.min(chartRange, selectedPeriodMonths))
  const periodLabel = periodPreset === 'hoje' ? 'Hoje' : periodPreset === '7d' ? 'Últimos 7 dias' : periodPreset === 'mes' ? 'Mês atual' : periodPreset === 'anterior' ? 'Mês anterior' : periodPreset === '6m' ? 'Últimos 6 meses' : customStart && customEnd ? `${new Date(`${customStart}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${customEnd}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Últimos 6 meses'
  const alertDestination = (value: string) => ['financeiro','ordens','producao','rh','importacoes'].includes(value) ? value as ModuleKey : 'dashboard'
  return <div className={`overview-page ${isEmployee ? 'is-personal' : 'is-executive'}`}>
    <PageHeading eyebrow={isEmployee ? 'Meu espaço · atenção pessoal' : 'Centro de comando · gestão empresarial'} title="Visão geral" description={isEmployee ? `Olá, ${user.nome.split(' ')[0]}. Aqui estão as suas pendências e próximos passos.` : `Bom dia, ${user.nome.split(' ')[0]}. Uma leitura objetiva do que merece atenção hoje.`} action={<span className="date-chip"><CalendarDays size={15} /> {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</span>} />
    <div className="overview-live-toolbar"><span className="overview-live-status"><span className={`overview-live-dot ${liveConnected ? 'is-connected' : ''}`} /><Radio size={14} /> {liveConnected ? 'Atualização automática ativa' : 'Conectando ao painel…'}</span><button type="button" className="overview-notification-button" onClick={() => void enableNotifications()} disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'}>{notificationPermission === 'granted' ? <BellRing size={15} /> : <BellOff size={15} />} {notificationPermission === 'granted' ? 'Notificações ativas' : notificationPermission === 'denied' ? 'Notificações bloqueadas' : 'Ativar notificações'}</button></div>
    <div className="overview-report-toolbar"><div><span className="eyebrow">Relatórios rápidos</span><small>Exporte o retrato atual da gestão para compartilhar ou arquivar.</small></div><div className="overview-report-actions"><button type="button" onClick={exportCsv}><Download size={14} /> CSV</button><button type="button" onClick={() => void exportPdf()} disabled={reportLoading}><FileText size={14} /> {reportLoading ? 'Gerando…' : 'PDF executivo'}</button></div></div>
    <div className="overview-period-toolbar"><div className="overview-period-title"><CalendarDays size={16} /><span><strong>Período de análise</strong><small>{periodLabel} · aplicado à evolução operacional</small></span></div><div className="overview-period-controls"><select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as typeof periodPreset)} aria-label="Selecionar período"><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option><option value="mes">Mês atual</option><option value="anterior">Mês anterior</option><option value="6m">Últimos 6 meses</option><option value="custom">Personalizado</option></select>{periodPreset === 'custom' && <><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="Início do período" /><span>até</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="Fim do período" /></>}</div></div>
    <div className="overview-welcome"><div><span className="eyebrow">{isEmployee ? 'Seu painel pessoal' : 'Prioridade do dia'}</span><h2>{isEmployee ? 'Tudo o que depende de você, em um só lugar.' : 'Decida primeiro. Aprofunde depois.'}</h2><p>{isEmployee ? 'Consulte sua jornada, acompanhe documentos e mantenha suas solicitações em dia.' : 'Indicadores operacionais e alertas priorizados para iniciar o dia com clareza.'}</p></div><div className="overview-welcome-symbol"><Gauge size={32}/></div></div>
    <div className="metric-grid overview-metrics">{isEmployee ? <><MetricCard label="Ponto a revisar" value={personal.ponto_sem_justificativa || 0} detail="Registros sem justificativa" tone="gold" onClick={() => onNavigate('ponto')} /><MetricCard label="Atestados" value={personal.atestados_em_analise || 0} detail="Em análise pelo RH" tone="pink" onClick={() => onNavigate('atestados')} /><MetricCard label="Solicitações" value={personal.solicitacoes_abertas || 0} detail="Pedidos em aberto" tone="green" onClick={() => onNavigate('solicitacoes')} /><MetricCard label="Avisos novos" value={personal.avisos_nao_lidos || 0} detail="Comunicados não lidos" tone="blue" onClick={() => onNavigate('avisos')} /></> : <><MetricCard label="Equipe ativa" value={indicators.funcionarios_ativos} detail="Pessoas no quadro" tone="gold" onClick={() => onNavigate('funcionarios')} /><MetricCard label="Ordens ativas" value={indicators.ordens_ativas} detail="Em operação" tone="pink" onClick={() => onNavigate(isAdmin ? 'ordens' : 'producao')} /><MetricCard label="Lotes em costura" value={indicators.lotes_em_costura} detail="Acompanhar produção" tone="green" onClick={() => onNavigate('producao')} /><MetricCard label="Contas pendentes" value={indicators.contas_pendentes} detail="Financeiro exige atenção" tone="blue" onClick={() => onNavigate('financeiro')} /></>}</div>
    {!isEmployee && <section className="overview-quick-report" aria-label="Resumo executivo por área"><div className="overview-quick-report-heading"><div><span className="eyebrow">Leitura rápida · situação geral</span><h2>Pessoas, produção, caixa e compromissos em uma só visão</h2><p>Indicadores resumidos para decidir primeiro e aprofundar depois nos módulos detalhados.</p></div><span className="overview-quick-report-period">Atualizado agora</span></div><div className="overview-quick-report-grid">{reportGroups.map(({ group, rows }) => <article className="overview-quick-report-card" key={group}><div className="overview-quick-report-card-heading"><strong>{group}</strong><small>{rows.length} indicador(es)</small></div><div className="overview-quick-report-list">{rows.slice(0, 5).map((item) => <button type="button" key={`${item.grupo}-${item.indicador}`} onClick={() => onNavigate(reportDestination(item.modulo))}><span><strong>{item.indicador}</strong><small>{item.contexto}</small></span><b className={`is-${item.status}`}>{item.valor}</b><ChevronRight size={14} /></button>)}</div></article>)}</div></section>}
    <div className="overview-main-grid"><SectionCard title={isEmployee ? 'Pendências pessoais' : 'Alertas prioritários'} caption={isEmployee ? 'Resolva o que pode bloquear sua rotina' : `${alerts.length} ponto(s) selecionado(s) por urgência`}><div className="overview-alert-list">{isEmployee ? <><button className="overview-alert-item is-attention" onClick={() => onNavigate('ponto')}><span><Fingerprint size={18}/></span><div><strong>{personal.ponto_sem_justificativa || 0} registro(s) de ponto precisam de revisão</strong><small>Confira sua jornada e envie justificativa quando necessário.</small></div><ChevronRight size={16}/></button><button className="overview-alert-item is-info" onClick={() => onNavigate('atestados')}><span><HeartPulse size={18}/></span><div><strong>{personal.atestados_em_analise || 0} atestado(s) em análise</strong><small>Acompanhe o status dos documentos enviados ao RH.</small></div><ChevronRight size={16}/></button><button className="overview-alert-item is-success" onClick={() => onNavigate('solicitacoes')}><span><FileCheck2 size={18}/></span><div><strong>{personal.solicitacoes_abertas || 0} solicitação(ões) em aberto</strong><small>Veja respostas ou complemente seus pedidos.</small></div><ChevronRight size={16}/></button></> : alerts.length === 0 ? <EmptyState title="Operação sob controle" description="Não há alertas prioritários para este momento." /> : alerts.map((alert) => <button className={`overview-alert-item is-${alert.prioridade}`} key={alert.id} onClick={() => onNavigate(alertDestination(alert.destino))}><span>{alert.prioridade === 'urgente' ? <AlertCircle size={18}/> : alert.destino === 'producao' ? <Factory size={18}/> : alert.destino === 'financeiro' ? <CircleDollarSign size={18}/> : <ShieldCheck size={18}/>}</span><div><strong>{alert.titulo} <b>{alert.valor}</b></strong><small>{alert.detalhe}</small></div><ChevronRight size={16}/></button>)}</div></SectionCard><SectionCard title={isEmployee ? 'Acesso rápido' : 'Resumo executivo'} caption={isEmployee ? 'Atalhos para sua rotina' : 'Contexto para a primeira decisão do dia'}><div className="overview-summary-list">{isEmployee ? <><button onClick={() => onNavigate('ponto')}><Fingerprint size={17}/><span><strong>Minha jornada</strong><small>Registros, atrasos e justificativas</small></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('avisos')}><Bell size={17}/><span><strong>Avisos da empresa</strong><small>{personal.avisos_nao_lidos || 0} comunicado(s) aguardando leitura</small></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('holerites')}><Receipt size={17}/><span><strong>Comprovantes</strong><small>{personal.holerites_disponiveis || 0} holerite(s) disponíveis</small></span><ChevronRight size={15}/></button></> : <><div><span>Saldo de dívidas ativo</span><strong>{isAdmin ? formatMoney(indicators.saldo_dividas) : 'Disponível para administradores'}</strong></div><div><span>Pessoas ausentes hoje</span><strong>{indicators.em_ferias + indicators.em_afastamento}</strong></div><div><span>Compromissos financeiros</span><strong>{indicators.contas_pendentes}</strong></div><div><span>Próximo passo recomendado</span><strong>{alerts[0]?.titulo || 'Revisar o fechamento do dia'}</strong></div></>}</div></SectionCard></div>
    <SectionCard title="Alertas em tempo real" caption={liveEvents.length ? `${liveEvents.length} atualização(ões) recebida(s) nesta sessão` : 'As próximas alterações importantes aparecerão aqui'}><div className="overview-live-events">{liveEvents.length === 0 ? <div className="overview-live-empty"><Radio size={17} /><span><strong>Monitoramento ativo</strong><small>Novas movimentações de financeiro, ordens, produção, RH e ponto serão sinalizadas sem recarregar a página.</small></span></div> : liveEvents.map((event) => <button key={event.id} onClick={() => onNavigate(event.destination)}><span className={`overview-live-event-icon is-${event.priority}`}><BellRing size={15} /></span><span><strong>{event.title}</strong><small>{event.detail}</small></span><time>{new Date(event.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><ChevronRight size={15} /></button>)}</div></SectionCard>
    {!isEmployee && <>
      <div className="overview-stage2-grid"><SectionCard title="Leitura operacional" caption="Riscos que podem afetar prazo, produção e caixa"><div className="overview-risk-grid"><button onClick={() => onNavigate('ordens')}><span className="overview-risk-icon is-red"><AlertTriangle size={17}/></span><span><small>Ordens atrasadas</small><strong>{intelligence.operacao?.ordens_atrasadas || 0}</strong><em>Exigem ação imediata</em></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('producao')}><span className="overview-risk-icon is-gold"><PauseCircle size={17}/></span><span><small>Lotes sem movimentação</small><strong>{intelligence.operacao?.lotes_parados || 0}</strong><em>Mais de 3 dias sem atualização</em></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('financeiro')}><span className="overview-risk-icon is-blue"><CircleDollarSign size={17}/></span><span><small>Contas vencidas</small><strong>{intelligence.financeiro?.vencidas_qtd || 0}</strong><em>{formatMoney(intelligence.financeiro?.vencidas_valor || 0)} em aberto</em></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('financeiro')}><span className="overview-risk-icon is-green"><CalendarClock size={17}/></span><span><small>Contas em 7 dias</small><strong>{intelligence.financeiro?.proximas_qtd || 0}</strong><em>{formatMoney(intelligence.financeiro?.proximas_valor || 0)} previstos</em></span><ChevronRight size={15}/></button></div></SectionCard><SectionCard title="Evolução dos últimos meses" caption="Explore o volume por métrica e período"><div className="overview-chart-controls"><div className="overview-segmented"><button className={chartMetric === 'ordens' ? 'is-active' : ''} onClick={() => setChartMetric('ordens')}>Recebidas</button><button className={chartMetric === 'entregues' ? 'is-active' : ''} onClick={() => setChartMetric('entregues')}>Entregues</button></div><div className="overview-segmented overview-segmented-small"><button className={chartRange === 3 ? 'is-active' : ''} onClick={() => setChartRange(3)}>3M</button><button className={chartRange === 6 ? 'is-active' : ''} onClick={() => setChartRange(6)}>6M</button></div></div><div className="overview-interactive-chart">{filteredEvolution.map((point) => { const value = point[chartMetric]; const maxVisible = Math.max(1, ...filteredEvolution.map((item) => item[chartMetric])); return <button className="overview-chart-column" key={point.periodo} title={`${point.periodo}: ${value} ${chartMetric === 'ordens' ? 'recebidas' : 'entregues'}`}><span className="overview-chart-value">{value}</span><span className={`overview-chart-bar is-${chartMetric}`} style={{ height: `${Math.max(5, value / maxVisible * 100)}%` }} /><small>{point.periodo}</small></button> })}</div><div className="overview-trend-legend"><span><i className={`is-${chartMetric}`} /> {chartMetric === 'ordens' ? 'Ordens recebidas' : 'Ordens entregues'}</span><span className="overview-chart-help">Passe o cursor para ver detalhes</span></div></SectionCard></div>
      <div className="overview-stage2-lower"><SectionCard title="Agenda dos próximos 7 dias" caption="Prazos e compromissos que merecem planejamento"><div className="overview-agenda">{agenda.length === 0 ? <EmptyState title="Agenda livre" description="Não há prazos críticos registrados para os próximos 7 dias." /> : agenda.map((item) => <button key={item.id} onClick={() => onNavigate(item.destino)}><span className={`overview-agenda-dot is-${item.prioridade}`} /><span><strong>{item.titulo}</strong><small>{item.detalhe}</small></span><b>{item.valor}</b><ChevronRight size={15}/></button>)}</div></SectionCard><SectionCard title="Pendências por área" caption="Concentração de itens que pedem acompanhamento"><div className="overview-area-list">{([['financeiro','Financeiro','financeiro'],['operacao','Operação','ordens'],['producao','Produção','producao'],['rh','Pessoas','funcionarios']] as const).map(([key, label, destination]) => <button key={key} onClick={() => onNavigate(destination as ModuleKey)}><span><strong>{label}</strong><small>{intelligence.pendencias_area?.[key] || 0} pendência(s)</small></span><div><i style={{ width: `${Math.min(100, ((intelligence.pendencias_area?.[key] || 0) / Math.max(1, ...Object.values(intelligence.pendencias_area || {}))) * 100)}%` }} /></div><ChevronRight size={15}/></button>)}</div></SectionCard></div>
    </>}
    {!isEmployee && <>
      <SectionCard title="Funil operacional" caption="Acompanhe onde as ordens estão concentradas hoje">
        <div className="overview-funnel">{([['recebidas','Recebidas','ordens'],['em_producao','Em produção','producao'],['costuradas','Costuradas','producao'],['entregues','Entregues','ordens'],['pagas','Pagas','financeiro']] as const).map(([key, label, destination], index) => <button key={key} className="overview-funnel-step" onClick={() => onNavigate(destination as ModuleKey)}><span className="overview-funnel-index">0{index + 1}</span><span className="overview-funnel-copy"><small>{label}</small><strong>{funnel?.[key] || 0}</strong></span>{index < 4 && <ChevronRight className="overview-funnel-arrow" size={16} />}</button>)}</div>
      </SectionCard>
      <div className="overview-comparison-strip"><article><span>Ordens recebidas no mês</span><strong>{comparisons.ordens_entrada_mes || 0}</strong><small>{variation(comparisons.ordens_entrada_mes, comparisons.ordens_entrada_mes_anterior)}</small></article><article><span>Inconsistências de ponto</span><strong>{comparisons.ponto_inconsistencias_mes || 0}</strong><small>{variation(comparisons.ponto_inconsistencias_mes, comparisons.ponto_inconsistencias_mes_anterior)}</small></article><article><span>Ausências hoje</span><strong>{indicators.em_ferias + indicators.em_afastamento}</strong><small>{indicators.em_ferias} em férias · {indicators.em_afastamento} afastado(s)</small></article></div>
    </>}
    {!isEmployee && <SectionCard title="Radar de atenção" caption="Indicadores que ajudam a decidir onde investir tempo agora"><div className="overview-radar"><button onClick={() => onNavigate('funcionarios')}><UsersRound size={18}/><span><strong>{indicators.funcionarios_ativos} ativos</strong><small>Equipe disponível no quadro</small></span></button><button onClick={() => onNavigate('producao')}><Factory size={18}/><span><strong>{indicators.lotes_em_costura} em costura</strong><small>Lotes que precisam de acompanhamento</small></span></button><button onClick={() => onNavigate('financeiro')}><CircleDollarSign size={18}/><span><strong>{indicators.contas_pendentes} pendentes</strong><small>Obrigações sem baixa financeira</small></span></button><button onClick={() => onNavigate('relatorios')}><BarChart3 size={18}/><span><strong>Relatórios gerenciais</strong><small>Aprofundar a análise por período</small></span></button></div></SectionCard>}
  </div>
}
function EmployeesView({ token }: { token: string }) {
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportError, setReportError] = useState('')
  const [fichaError, setFichaError] = useState('')
  const [search, setSearch] = useState('')
  const [situacaoFilter, setSituacaoFilter] = useState('')
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [selected, setSelected] = useState<import('./lib/types').ProntuarioResponse | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [generatingReportId, setGeneratingReportId] = useState('')

  useEffect(() => {
    listEmployees(token)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta'))
      .finally(() => setLoading(false))
  }, [token])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const parseSalary = (value: string) => {
      if (!value) return null
      const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
      const parsed = Number(normalized)
      return Number.isFinite(parsed) ? parsed : null
    }
    const min = parseSalary(salaryMin)
    const max = parseSalary(salaryMax)
    return rows.filter((row) => {
      const searchable = `${row.nome} ${row.cargo || ''} ${row.cpf}`.toLowerCase()
      const salary = Number(row.salario)
      const matchesQuery = !query || searchable.includes(query)
      const matchesSituation = !situacaoFilter || row.situacao === situacaoFilter
      const matchesMin = min === null || (Number.isFinite(salary) && salary >= min)
      const matchesMax = max === null || (Number.isFinite(salary) && salary <= max)
      return matchesQuery && matchesSituation && matchesMin && matchesMax
    })
  }, [rows, search, situacaoFilter, salaryMin, salaryMax])

  const activeFilterCount = [search, situacaoFilter, salaryMin, salaryMax].filter(Boolean).length
  function clearEmployeeFilters() {
    setSearch(''); setSituacaoFilter(''); setSalaryMin(''); setSalaryMax('')
  }

  async function openEmployee(id: string) {
    setSelectedId(id)
    setSelected(null)
    setFichaError('')
    try {
      const result = await adminProntuario(token, id)
      if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível abrir a ficha')
      const row = rows.find((item) => item.id === id)
      setSelected({ ...result, funcionario: { ...result.funcionario, avatar_url: row?.avatar_url || result.funcionario.avatar_url, situacao: row?.situacao || 'Trabalhando' } })
    } catch (err) {
      setFichaError(err instanceof Error ? err.message : 'Falha ao abrir a ficha')
    } finally {
      setSelectedId('')
    }
  }

  async function generateEmployeeReport(id: string) {
    setGeneratingReportId(id)
    setReportError('')
    try {
      const result = await adminProntuario(token, id)
      if (!result.sucesso || !result.funcionario) throw new Error(result.erro || 'Não foi possível consultar a ficha do funcionário.')
      const { downloadEmployeeFichaPdf } = await import('./features/employee-ficha-pdf')
      const row = rows.find((item) => item.id === id)
      await downloadEmployeeFichaPdf({ ...result.funcionario, avatar_url: row?.avatar_url || result.funcionario.avatar_url, situacao: row?.situacao || 'Trabalhando' })
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Não foi possível gerar o relatório.')
    } finally {
      setGeneratingReportId('')
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Pessoas · equipe"
        title="Funcionários"
        description="Consulte a equipe, abra a ficha completa ou gere o relatório individual."
        action={
          <div className="search-box">
            <Search size={16} />
            <input placeholder="Buscar pessoa ou cargo" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        }
      />
      <div className="employee-filter-panel">
        <div className="employee-filter-header"><div><strong>Filtros da equipe</strong><span>Combine situação, salário e busca para encontrar rapidamente os registros.</span></div><button className="text-button" type="button" onClick={clearEmployeeFilters} disabled={!activeFilterCount}>Limpar filtros{activeFilterCount ? ` (${activeFilterCount})` : ''}</button></div>
        <div className="employee-filter-fields">
          <label>Situação<select value={situacaoFilter} onChange={(event) => setSituacaoFilter(event.target.value)}><option value="">Todas as situações</option><option value="Trabalhando">Trabalhando</option><option value="Em férias">Em férias</option><option value="Afastado">Afastado</option><option value="Inativo">Inativo</option></select></label>
          <label>Salário mínimo<input inputMode="decimal" value={salaryMin} onChange={(event) => setSalaryMin(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder="R$ 0,00" /></label>
          <label>Salário máximo<input inputMode="decimal" value={salaryMax} onChange={(event) => setSalaryMax(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder="Sem limite" /></label>
          <div className="employee-filter-presets"><span>Atalhos</span><button type="button" onClick={() => { setSalaryMin(''); setSalaryMax('2000') }}>Até R$ 2 mil</button><button type="button" onClick={() => { setSalaryMin('2000'); setSalaryMax('4000') }}>R$ 2–4 mil</button><button type="button" onClick={() => { setSalaryMin('4000'); setSalaryMax('') }}>Acima de R$ 4 mil</button></div>
        </div>
      </div>
      <SectionCard title={`${filtered.length} registros visíveis`} caption="Abra a ficha no modal ou gere o PDF individual">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhum funcionário encontrado" description={activeFilterCount ? 'Ajuste ou limpe os filtros para ampliar o resultado.' : 'Ainda não existem registros para exibir.'} />
        ) : (
          <div className="table-wrap">
            <p className="table-scroll-hint">Deslize para o lado para ver todas as colunas.</p>
            <table className="employees-table">
              <thead>
                <tr><th>Nome</th><th>CPF</th><th>Cargo</th><th>Salário</th><th>Admissão</th><th>Situação</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="employee-name-cell">
                        <span className="employee-avatar-cell" aria-hidden="true">{row.avatar_url ? <img src={row.avatar_url} alt="" /> : null}</span>
                        <strong>{row.nome}</strong>
                      </div>
                    </td>
                    <td className="mono">{maskCpf(row.cpf)}</td>
                    <td>{row.cargo || 'Não informado'}</td>
                    <td>{row.salario === null || row.salario === undefined ? 'Não informado' : formatMoney(row.salario)}</td>
                    <td>{formatDate(row.data_admissao)}</td>
                    <td><StatusPill value={row.situacao || (row.ativo ? 'Trabalhando' : 'Inativo')} /></td>
                    <td>
                      <div className="employee-row-actions">
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => void openEmployee(row.id)}
                          disabled={Boolean(selectedId)}
                          aria-label={`Abrir ficha de ${row.nome}`}
                        >
                          <FileText size={15} />{selectedId === row.id ? 'Abrindo…' : 'Abrir ficha'}
                        </button>
                        <button
                          className="secondary-button compact-button employee-pdf-button"
                          type="button"
                          onClick={() => void generateEmployeeReport(row.id)}
                          disabled={Boolean(generatingReportId)}
                          aria-label={`Gerar PDF da ficha de ${row.nome}`}
                        >
                          {generatingReportId === row.id ? <RefreshCw className="spin" size={15} /> : <Download size={15} />}
                          {generatingReportId === row.id ? 'Gerando…' : 'Gerar PDF'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fichaError ? <div className="form-error employee-report-error" role="alert"><AlertCircle size={16} />{fichaError}</div> : null}
        {reportError ? <div className="form-error employee-report-error" role="alert"><AlertCircle size={16} />{reportError}</div> : null}
        {selected?.funcionario ? (
          <EmployeeFichaPanel
            token={token}
            employee={selected.funcionario}
            onDownloadPdf={() => void generateEmployeeReport(String(selected.funcionario?.id || ''))}
            downloadingPdf={generatingReportId === String(selected.funcionario.id)}
            onClose={() => { setSelected(null); setSelectedId('') }}
            onSaved={(updated) => {
              setSelected((current) => current ? { ...current, funcionario: updated } : current)
              void listEmployees(token).then(setRows).catch(() => undefined)
            }}
          >
            <div className="employee-ficha-summary employee-action-panel">
              <div className="employee-ficha-identity">
                <UserAvatar name={String(selected.funcionario.nome)} url={String(selected.funcionario.avatar_url || '') || null} className="employee-ficha-avatar" />
                <div>
                  <span className="eyebrow">Ficha operacional</span>
                  <h3>{String(selected.funcionario.nome)}</h3>
                  <p>{String(selected.funcionario.cargo || 'Cargo não informado')} · {String(selected.funcionario.tipo_vinculo || 'vínculo')}</p>
                </div>
              </div>
              <div className="employee-ficha-highlights">
                <div><span>Salário atual</span><strong>{selected.funcionario.salario === null || selected.funcionario.salario === undefined ? 'Não informado' : formatMoney(Number(selected.funcionario.salario))}</strong></div>
                <div><span>Situação</span><StatusPill value={String(selected.funcionario.situacao || 'Trabalhando')} /></div>
              </div>
              <div className="metric-grid compact">
                <div><b>{selected.ponto.length}</b><small>pontos</small></div>
                <div><b>{selected.atestados.length}</b><small>atestados</small></div>
                <div><b>{selected.ferias.length}</b><small>férias lançadas</small></div>
                <div><b>{selected.afastamentos.length}</b><small>afastamentos</small></div>
              </div>
              <div className="quick-list">
                <div className="quick-item">
                  <span><strong>Próximas férias</strong><small>{selected.ferias[0] ? `${formatDate(String(selected.ferias[0].inicio))} até ${formatDate(String(selected.ferias[0].fim))} · ${String(selected.ferias[0].status || 'sem status')}` : 'Nenhum período lançado'}</small></span>
                </div>
                <div className="quick-item">
                  <span><strong>Retorno / situação</strong><small>{selected.afastamentos[0] ? `${String(selected.afastamentos[0].tipo)} até ${formatDate(String(selected.afastamentos[0].fim))}` : 'Sem afastamento vigente'}</small></span>
                </div>
              </div>
            </div>
          </EmployeeFichaPanel>
        ) : null}
      </SectionCard>
    </>
  )
}

function EmployeeProfileView({ token, onProfileUpdated }: { token: string; onProfileUpdated: (profile: EmployeeProfile) => void }) {
  const [profile, setProfile] = useState<EmployeeProfile>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingAvatar, setSavingAvatar] = useState(false)
  useEffect(() => { myProfile(token).then((data) => { if (!data.sucesso || !data.funcionario) throw new Error(data.erro || 'Falha de sessão'); setProfile(data.funcionario); onProfileUpdated(data.funcionario) }).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')).finally(() => setLoading(false)) }, [token])
  async function changeAvatar(file: File | undefined) {
    if (!file || !profile) return
    setSavingAvatar(true); setError('')
    try {
      const avatarUrl = await compressAvatar(file)
      const result = await updateAvatar(token, avatarUrl)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível salvar a foto.')
      const updated = { ...profile, avatar_url: avatarUrl }
      setProfile(updated); onProfileUpdated(updated)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar a foto.') } finally { setSavingAvatar(false) }
  }
  async function removeAvatar() {
    if (!profile?.avatar_url) return
    setSavingAvatar(true); setError('')
    try {
      const result = await updateAvatar(token, null)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível remover a foto.')
      const updated = { ...profile, avatar_url: null }
      setProfile(updated); onProfileUpdated(updated)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao remover a foto.') } finally { setSavingAvatar(false) }
  }
  return <><PageHeading eyebrow="Minha área · cadastro" title="Meu perfil" description="Confira os dados que o RH mantém no sistema." />{loading ? <LoadingState /> : error && !profile ? <ErrorState message={error} /> : profile ? <div className="profile-layout"><SectionCard title={profile.nome} caption={profile.cargo || 'Cargo não informado'}><div className="profile-identity"><UserAvatar name={profile.nome} url={profile.avatar_url} className="profile-avatar" /><div><strong>Foto do perfil</strong><span>JPG, PNG ou WebP · até 800 KB</span><div className="profile-avatar-actions"><label className="secondary-button">{savingAvatar ? <RefreshCw className="spin" size={15} /> : <Upload size={15} />} {profile.avatar_url ? 'Trocar foto' : 'Adicionar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={savingAvatar} onChange={(event) => { void changeAvatar(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>{profile.avatar_url && <button className="text-button" type="button" onClick={() => void removeAvatar()} disabled={savingAvatar}>Remover</button>}</div></div></div>{error && <div className="form-error profile-error"><AlertCircle size={16} />{error}</div>}<div className="detail-grid"><div><span>CPF</span><strong>{maskCpf(profile.cpf)}</strong></div><div><span>Data de nascimento</span><strong>{formatDate(profile.data_nascimento)}</strong></div><div><span>Admissão</span><strong>{formatDate(profile.data_admissao)}</strong></div><div><span>Telefone</span><strong>{profile.telefone_celular || 'Não informado'}</strong></div><div className="wide"><span>Endereço</span><strong>{profile.endereco || 'Não informado'}</strong></div></div></SectionCard><SectionCard title="Dados de trabalho" caption="Visão pessoal"><div className="security-row"><span>Cargo</span><strong>{profile.cargo || 'Não informado'}</strong></div><div className="security-row"><span>Função</span><strong>{profile.funcao || 'Não informado'}</strong></div><div className="security-row"><span>Situação</span><strong><StatusPill value={profile.ativo ? 'Ativo' : 'Inativo'} /></strong></div></SectionCard></div> : null}</>
}

function PointView({ token, user }: { token: string; user: SessionUser }) {
  const isAdministrative = user.perfil === 'admin' || user.perfil === 'administrador' || user.perfil === 'gestor'
  const [rows, setRows] = useState<PointRow[]>([])
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'previous_month' | 'custom'>('month')
  const [employeeId, setEmployeeId] = useState('')
  const [monthReference, setMonthReference] = useState(new Date().toISOString().slice(0, 7))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [decisionBusy, setDecisionBusy] = useState('')
  const [justificationRow, setJustificationRow] = useState('')
  const [justificationText, setJustificationText] = useState('')
  const [justificationType, setJustificationType] = useState('Falta de marcação')
  const [justificationStart, setJustificationStart] = useState('')
  const [justificationDays, setJustificationDays] = useState(1)
  const [justificationFile, setJustificationFile] = useState<File | null>(null)
  const [pendingAction, setPendingAction] = useState<{ title: string; description: string; confirmLabel: string; run: () => Promise<void> | void } | null>(null)
  const [reviewModalRow, setReviewModalRow] = useState<PointRow | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const range = useMemo(() => {
    const toIso = (date: Date) => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    const now = new Date()
    if (period === 'custom') return { inicio: customStart || null, fim: customEnd || null }
    if (period === 'day') return { inicio: toIso(now), fim: toIso(now) }
    if (period === 'week') {
      const start = new Date(now); const weekday = start.getDay() || 7
      start.setDate(start.getDate() - weekday + 1)
      const end = new Date(start); end.setDate(start.getDate() + 6)
      return { inicio: toIso(start), fim: toIso(end) }
    }
    const [year, month] = monthReference.split('-').map(Number)
    const reference = Number.isFinite(year) && Number.isFinite(month) ? new Date(year, month - 1, 1) : now
    const monthOffset = period === 'previous_month' ? -1 : 0
    const firstDay = new Date(reference.getFullYear(), reference.getMonth() + monthOffset, 1)
    return { inicio: toIso(firstDay), fim: toIso(new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0)) }
  }, [period, customStart, customEnd, monthReference])

  useEffect(() => {
    if (!isAdministrative) return
    listEmployees(token).then((data) => { setEmployees(data); setEmployeeId((current) => current || data[0]?.id || '') }).catch(() => undefined)
  }, [token, isAdministrative])

  useEffect(() => {
    const targetEmployeeId = isAdministrative ? employeeId : user.funcionario_id
    if (!targetEmployeeId || (period === 'custom' && (!customStart || !customEnd))) { setLoading(false); return }
    let cancelled = false
    setLoading(true); setError('')
    listPoint(token, { inicio: range.inicio, fim: range.fim, funcionarioId: targetEmployeeId, limite: 1000 })
      .then((data) => { if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta'); if (!cancelled) setRows(data.registros || []) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Falha de consulta') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, user.funcionario_id, isAdministrative, employeeId, period, range.inicio, range.fim, customStart, customEnd, refreshKey])

  const selectedEmployee = employees.find((employee) => employee.id === employeeId)
  const displayRows = useMemo(() => {
    if (!range.inicio || !range.fim) return []
    const recordsByDate = new Map(rows.map((row) => [row.data.slice(0, 10), row]))
    const start = new Date(`${range.inicio}T00:00:00`)
    const end = new Date(`${range.fim}T00:00:00`)
    const result: PointRow[] = []
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      result.push(recordsByDate.get(date) || { id: `sem-registro-${date}`, funcionario_id: isAdministrative ? employeeId : user.funcionario_id, data: date, entrada: null, saida_almoco: null, volta_almoco: null, saida: null, horas_trabalhadas: null, status: null })
    }
    return result
  }, [rows, range.inicio, range.fim, isAdministrative, employeeId, user.funcionario_id])
  const selectedEmployeeIndex = employees.findIndex((employee) => employee.id === employeeId)
  const moveEmployee = (direction: -1 | 1) => {
    const nextIndex = selectedEmployeeIndex + direction
    if (nextIndex >= 0 && nextIndex < employees.length) setEmployeeId(employees[nextIndex].id)
  }
  const rowKind = (row: PointRow) => {
    const marked = Boolean(row.entrada || row.saida || row.horas_trabalhadas)
    const note = `${row.justificativas || ''} ${row.inconsistencia_justificativa || ''}`.toLowerCase()
    if (note.includes('férias') || note.includes('ferias')) return 'ferias'
    if (row.dia_falta && row.dia_falta.trim() && !['não', 'nao', 'n', '0'].includes(row.dia_falta.trim().toLowerCase())) return 'falta'
    if (hoursToNumber(row.horas_atraso) > 0) return 'atraso'
    if (!marked && (!row.previsto || !row.previsto.trim() || note.includes('folga'))) return 'folga'
    if (!marked) return 'sem-marcacao'
    if (hoursToNumber(row.extra_50) > 0 || hoursToNumber(row.extra_100) > 0) return 'extra'
    return 'normal'
  }
  const renderPointStatus = (row: PointRow) => {
    const kind = rowKind(row)
    if (kind === 'sem-marcacao') return <span className="point-unmarked-status"><AlertCircle size={14} />Sem marcação</span>
    if (kind === 'folga') return <StatusPill value="Folga" />
    if (kind === 'ferias') return <StatusPill value="Férias" />
    if (kind === 'falta') return <StatusPill value={row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada' ? 'Falta justificada' : row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada' ? 'Falta · justificativa recusada' : 'Falta injustificada'} />
    if (kind === 'atraso') return <StatusPill value={row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada' ? 'Atraso justificado' : row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada' ? 'Atraso · justificativa recusada' : 'Atraso' } />
    if (kind === 'extra') return <StatusPill value="Hora extra" />
    return <StatusPill value={row.status || 'normal'} />
  }
  const hoursToNumber = (value: string | null | undefined) => {
    const raw = String(value || '').trim().replace(',', '.')
    if (!raw) return 0
    if (raw.includes(':')) { const [hours, minutes] = raw.split(':').map(Number); return (hours || 0) + (minutes || 0) / 60 }
    const parsed = Number(raw.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  const shortTime = (value: string | null | undefined) => value ? String(value).slice(0, 5) : '—'
  const formatDelayMinutes = (minutes: number) => {
    const rounded = Math.max(0, Math.round(minutes))
    const hours = Math.floor(rounded / 60)
    const remainder = rounded % 60
    return hours > 0 ? `${hours}h ${String(remainder).padStart(2, '0')}min` : `${remainder} min`
  }
  const pointSummary = useMemo(() => {
    const extra50 = displayRows.reduce((sum, row) => sum + hoursToNumber(row.extra_50), 0)
    const extra100 = displayRows.reduce((sum, row) => sum + hoursToNumber(row.extra_100), 0)
    const faltas = displayRows.filter((row) => Boolean(row.dia_falta && !['não', 'nao', 'n', '0'].includes(row.dia_falta.trim().toLowerCase())) || row.status === 'falta').length
    const atrasos = displayRows.filter((row) => hoursToNumber(row.horas_atraso) > 0).length
    const totalAtrasoMinutos = displayRows.reduce((sum, row) => sum + hoursToNumber(row.horas_atraso) * 60, 0)
    const diasComMarcacao = displayRows.filter((row) => row.entrada || row.saida || row.horas_trabalhadas).length
    return { extra50, extra100, faltas, atrasos, totalAtrasoMinutos, diasComMarcacao, diasSemMarcacao: displayRows.length - diasComMarcacao, totalExtras: extra50 + extra100 }
  }, [displayRows])
  const hasInconsistency = (row: PointRow) => Boolean(row.inconsistencia_tipo || row.dia_falta || row.horas_atraso)
  async function persistReviewInconsistency(row: PointRow, status: 'aprovada' | 'justificada') {
    const funcionarioId = row.funcionario_id || (isAdministrative ? employeeId : user.funcionario_id)
    if (!funcionarioId) return
    if (status === 'justificada' && !justificationText.trim()) { setError('Informe a justificativa da inconsistência.'); return }
    const key = row.data
    setDecisionBusy(key); setError('')
    try {
      const result = await decidePointInconsistency(token, funcionarioId, row.data, status, justificationText)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível analisar a inconsistência.')
      setJustificationRow(''); setJustificationText(''); setRefreshKey((value) => value + 1)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao analisar a inconsistência.') } finally { setDecisionBusy('') }
  }
  function requestReviewInconsistency(row: PointRow, status: 'aprovada' | 'justificada') {
    setPendingAction({ title: status === 'aprovada' ? 'Aprovar ocorrência?' : 'Salvar justificativa?', description: status === 'aprovada' ? `A ocorrência de ${formatDate(row.data)} será aprovada e registrada na auditoria.` : `A justificativa será encaminhada para ${formatDate(row.data)} e ficará disponível para o funcionário.`, confirmLabel: status === 'aprovada' ? 'Aprovar ocorrência' : 'Salvar justificativa', run: () => persistReviewInconsistency(row, status) })
  }
  async function persistSubmittedJustificationReview(row: PointRow, status: 'aceita' | 'recusada') {
    if (!row.justificativa_id) return
    if (status === 'recusada' && !justificationText.trim()) { setError('Informe o motivo da recusa para o funcionário.'); return }
    setDecisionBusy(row.data); setError('')
    try {
      const result = await decidePointJustification(token, row.justificativa_id, status, justificationText)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível concluir a análise da justificativa.')
      setJustificationRow(''); setJustificationText(''); setReviewModalRow(null); setRefreshKey((value) => value + 1)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao analisar a justificativa.') } finally { setDecisionBusy('') }
  }
  function requestSubmittedJustificationReview(row: PointRow, status: 'aceita' | 'recusada') {
    setPendingAction({
      title: status === 'aceita' ? 'Aceitar justificativa?' : 'Recusar justificativa?',
      description: status === 'aceita' ? `A justificativa de ${formatDate(row.data)} será aceita e o dia ficará identificado como justificado.` : `A justificativa de ${formatDate(row.data)} será recusada e o ponto permanecerá como lançado. Informe o motivo para o funcionário.`,
      confirmLabel: status === 'aceita' ? 'Aceitar justificativa' : 'Recusar justificativa',
      run: () => persistSubmittedJustificationReview(row, status),
    })
  }
  async function persistEmployeeJustification(row: PointRow) {
    if (!user.funcionario_id) return
    if (!justificationText.trim()) { setError('Informe o motivo da justificativa.'); return }
    if (!justificationStart) { setError('Informe quando a justificativa ou o atestado começou.'); return }
    setDecisionBusy(row.data); setError('')
    try {
      let fileUrl: string | null = null; let fileName: string | null = null
      if (justificationFile) {
        await uploadMedicalLeave(token, { tipo: 'Atestado médico', dataAtendimento: justificationStart, dias: Math.max(1, justificationDays), observacao: justificationText, file: justificationFile })
        const leaves = await listMedicalLeaves(token)
        const latest = (leaves.atestados || []).find((leave) => leave.data_atendimento === justificationStart && leave.arquivo_url) || leaves.atestados?.[0]
        fileUrl = latest?.arquivo_url || null; fileName = latest?.arquivo_nome || justificationFile.name
      }
      const result = await createPointJustification(token, row.data, justificationType, justificationText, fileUrl, fileName)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível enviar a justificativa.')
      setJustificationRow(''); setJustificationText(''); setJustificationFile(null); setJustificationStart(''); setJustificationDays(1); setRefreshKey((value) => value + 1)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao enviar a justificativa.') } finally { setDecisionBusy('') }
  }
  function requestEmployeeJustification(row: PointRow) {
    setJustificationRow(row.data); setJustificationText(''); setJustificationType('Falta de marcação'); setJustificationStart(row.data); setJustificationDays(1); setJustificationFile(null)
  }
  const renderEmployeeJustification = (row: PointRow) => {
    if (!hasInconsistency(row)) return '—'
    if (row.justificativa_status === 'aceita') return <div className="point-justification-result"><StatusPill value="Justificativa aceita" /><small>{row.justificativa_resposta || 'O dia foi analisado pelo RH.'}</small></div>
    if (row.justificativa_status === 'pendente') return <div className="point-justification-result"><StatusPill value="Em análise" /><small>Justificativa enviada. Aguarde o retorno do RH.</small></div>
    if (row.justificativa_status === 'recusada') return <div className="point-justification-result"><StatusPill value="Recusada" /><small>{row.justificativa_resposta || 'O RH recusou a justificativa.'}</small><button className="text-button point-justify-button" type="button" onClick={() => requestEmployeeJustification(row)}>Enviar nova justificativa</button></div>
    if (justificationRow !== row.data) return <button className="secondary-button point-justify-button" type="button" onClick={() => requestEmployeeJustification(row)}><FileText size={14} /> Justificar dia</button>
    return <div className="point-justification-form">
      <select value={justificationType} onChange={(event) => setJustificationType(event.target.value)} aria-label="Tipo de justificativa"><option>Falta de marcação</option><option>Atraso</option><option>Atestado médico</option><option>Outro</option></select>
      <textarea value={justificationText} onChange={(event) => setJustificationText(event.target.value)} placeholder="Explique o motivo da falta ou atraso" rows={3} />
      <div className="point-justification-fields"><label>Data inicial<input type="date" value={justificationStart} onChange={(event) => setJustificationStart(event.target.value)} /></label><label>Dias<input type="number" min={1} max={30} value={justificationDays} onChange={(event) => setJustificationDays(Math.max(1, Number(event.target.value) || 1))} /></label></div>
      <label className="point-file-label"><Upload size={13} /> Anexar foto ou PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setJustificationFile(event.target.files?.[0] || null)} /></label>
      {justificationFile ? <small>{justificationFile.name}</small> : <small>Opcional · JPG, PNG, WebP ou PDF</small>}
      <div className="point-review-actions"><button className="secondary-button" type="button" onClick={() => { setJustificationRow(''); setJustificationFile(null) }}>Cancelar</button><button className="primary-button" type="button" onClick={() => void persistEmployeeJustification(row)} disabled={decisionBusy === row.data}>{decisionBusy === row.data ? 'Enviando…' : 'Enviar justificativa'}</button></div>
    </div>
  }
  const renderAdministrativeIssueStatus = (row: PointRow) => {
    const label = row.justificativa_status === 'pendente' ? 'Justificativa pendente' : row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada' ? 'Justificada' : row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada' ? 'Justificativa recusada' : row.inconsistencia_status === 'aprovada' ? 'Aprovada' : 'Injustificado'
    return <div className="point-issue-cell"><StatusPill value={label} /><small>{row.horas_atraso ? `Atraso: ${row.horas_atraso}` : row.dia_falta ? `Falta: ${row.dia_falta}` : row.inconsistencia}</small></div>
  }
  const openReviewModal = (row: PointRow) => { setReviewModalRow(row); setJustificationText(row.justificativa_resposta || '') }
  const renderAdministrativeReview = (row: PointRow) => {
    if (!hasInconsistency(row)) return '—'
    if (row.justificativa_id) return <div className="point-review-actions"><StatusPill value={row.justificativa_status === 'aceita' ? 'Aceita' : row.justificativa_status === 'recusada' ? 'Recusada' : 'Pendente'} /><button className="icon-button point-review-trigger" type="button" onClick={() => openReviewModal(row)} aria-label={`Abrir justificativa de ${formatDate(row.data)}`} title="Abrir justificativa"><FileText size={15} /></button></div>
    if (row.inconsistencia_status === 'aprovada') return <div className="point-issue-cell"><StatusPill value="Aprovada sem justificativa" /><small>A inconsistência foi considerada um fato real.</small></div>
    return <div className="point-review-actions"><span className="point-unjustified-label">Injustificado</span><button className="icon-button" type="button" onClick={() => requestReviewInconsistency(row, 'aprovada')} disabled={decisionBusy === row.data} aria-label="Aprovar inconsistência sem justificativa" title="Aprovar como fato real"><Check size={15} /></button></div>
  }
  const periodLabel = period === 'day' ? 'Hoje' : period === 'week' ? 'Esta semana' : period === 'month' ? 'Mês selecionado' : period === 'previous_month' ? 'Mês anterior' : 'Período personalizado'
  const title = isAdministrative ? `Ponto · ${selectedEmployee?.nome || 'Funcionário'}` : 'Meu ponto'
  const description = isAdministrative ? 'Ficha individual de jornada. Selecione o funcionário e consulte todos os dias do período.' : 'Sua ficha individual de jornada, com todos os dias do período selecionado.'
  return <>
    <PageHeading eyebrow="Minha área · jornada" title={title} description={description} />
    {isAdministrative ? <>
      <div className="point-employee-nav"><button className="icon-button" type="button" onClick={() => moveEmployee(-1)} disabled={selectedEmployeeIndex <= 0} aria-label="Funcionário anterior"><ChevronLeft size={18} /></button><div><span>Ficha individual</span><strong>{selectedEmployee?.nome || 'Selecione um funcionário'}</strong><small>{selectedEmployeeIndex >= 0 ? `${selectedEmployeeIndex + 1} de ${employees.length} funcionários · ordem alfabética` : 'Selecione um funcionário'}</small></div><button className="icon-button" type="button" onClick={() => moveEmployee(1)} disabled={selectedEmployeeIndex < 0 || selectedEmployeeIndex >= employees.length - 1} aria-label="Próximo funcionário"><ChevronRight size={18} /></button></div>
      {selectedEmployee ? <section className="point-employee-heading" aria-label="Resumo do funcionário e período do ponto">
        <UserAvatar name={selectedEmployee.nome} url={selectedEmployee.avatar_url} className="point-employee-avatar" />
        <div className="point-employee-identity">
          <span className="eyebrow">Ficha mensal de ponto</span>
          <strong>{selectedEmployee.nome}</strong>
          <small>{selectedEmployee.cargo || 'Cargo não informado'} · CPF {maskCpf(selectedEmployee.cpf)}</small>
        </div>
        <div className="point-employee-detail"><span>Admissão</span><strong>{formatDate(selectedEmployee.data_admissao)}</strong></div>
        <div className="point-employee-detail"><span>Situação</span><StatusPill value={selectedEmployee.situacao || (selectedEmployee.ativo ? 'Trabalhando' : 'Inativo')} /></div>
        <div className="point-employee-detail point-employee-period"><span>{periodLabel}</span><strong>{range.inicio ? `${formatDate(range.inicio)}${range.fim && range.fim !== range.inicio ? ` até ${formatDate(range.fim)}` : ''}` : 'Selecione as datas'}</strong></div>
      </section> : null}
    </> : null}
    <div className="point-filter-panel">
      <div className="point-filter-heading"><div><strong>Filtros da ficha de ponto</strong><span>{isAdministrative ? 'Cada funcionário é consultado em uma ficha individual.' : 'Consulte sua jornada dia a dia.'}</span></div>{isAdministrative ? <span className="point-filter-scope"><UsersRound size={15} /> Visão administrativa</span> : null}</div>
      <div className="point-filter-fields">
        {isAdministrative ? <label>Funcionário<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Selecione um funcionário</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome} · {maskCpf(employee.cpf)}</option>)}</select></label> : null}
        <label>Período<select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="day">Ponto do dia</option><option value="week">Ponto da semana</option><option value="month">Mês de referência</option><option value="previous_month">Mês anterior</option><option value="custom">Período personalizado</option></select></label>
        {(period === 'month' || period === 'previous_month') ? <label>Mês de referência<input type="month" value={monthReference} onChange={(event) => setMonthReference(event.target.value)} /></label> : null}
        {period === 'custom' ? <><label>Data inicial<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Data final<input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} /></label></> : <div className="point-filter-current"><CalendarDays size={17} /><span>{periodLabel}<small>{range.inicio ? `${formatDate(range.inicio)}${range.fim && range.fim !== range.inicio ? ` até ${formatDate(range.fim)}` : ''}` : 'Selecione as datas'}</small></span></div>}
      </div>
    </div>
    <div className="point-summary-grid">
      <section className="point-chart-card"><div className="point-chart-heading"><div><span className="eyebrow">Resumo de horas</span><strong>{pointSummary.totalExtras.toFixed(1)} h extras</strong></div><CalendarDays size={18} /></div><div className="point-bar-row"><span>Extra 50%</span><div className="point-bar-track"><i style={{ width: `${pointSummary.totalExtras ? Math.max(4, pointSummary.extra50 / pointSummary.totalExtras * 100) : 0}%` }} /></div><b>{pointSummary.extra50.toFixed(1)} h</b></div><div className="point-bar-row"><span>Extra 100%</span><div className="point-bar-track is-pink"><i style={{ width: `${pointSummary.totalExtras ? Math.max(4, pointSummary.extra100 / pointSummary.totalExtras * 100) : 0}%` }} /></div><b>{pointSummary.extra100.toFixed(1)} h</b></div></section>
      <section className="point-chart-card"><div className="point-chart-heading"><div><span className="eyebrow">Resumo de ocorrências</span><strong>{pointSummary.faltas} faltas identificadas</strong><small className="point-chart-detail">{pointSummary.atrasos} {pointSummary.atrasos === 1 ? 'dia com atraso' : 'dias com atraso'} · {formatDelayMinutes(pointSummary.totalAtrasoMinutos)} acumulados</small></div><AlertCircle size={18} /></div><div className="point-bar-row"><span>Faltas</span><div className="point-bar-track is-danger"><i style={{ width: `${pointSummary.faltas ? 100 : 0}%` }} /></div><b>{pointSummary.faltas}</b></div><div className="point-bar-row"><span>Atrasos</span><div className="point-bar-track is-gold"><i style={{ width: `${pointSummary.atrasos ? Math.min(100, pointSummary.atrasos / Math.max(pointSummary.faltas, pointSummary.atrasos) * 100) : 0}%` }} /></div><b>{pointSummary.atrasos} dias</b></div></section>
    </div>
    <SectionCard title={isAdministrative ? `Ficha de ${selectedEmployee?.nome || 'funcionário'}` : 'Minha ficha de ponto'} caption={`${periodLabel} · ${range.inicio ? `${formatDate(range.inicio)} a ${formatDate(range.fim || range.inicio)}` : 'aguardando período'} · ${pointSummary.diasComMarcacao} com marcação · ${pointSummary.diasSemMarcacao} sem marcação`}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : !displayRows.length ? <EmptyState title={isAdministrative && !employeeId ? 'Selecione um funcionário' : 'Nenhum dia para exibir'} description={isAdministrative && !employeeId ? 'Escolha um funcionário para abrir a ficha individual de ponto.' : 'Ajuste o período para consultar a jornada.'} /> : <div className="table-wrap">
        <p className="table-scroll-hint">Os dias são exibidos do primeiro ao último dia do período. Dias sem horário aparecem como “Sem marcação”.</p>
        <table className="point-daily-table">
          <thead><tr><th rowSpan={2}>Dia</th><th colSpan={2}>Entrada e almoço</th><th colSpan={2}>Retorno e saída</th><th rowSpan={2}>Horas</th><th rowSpan={2}>Status</th><th colSpan={4}>Ocorrências do arquivo</th>{isAdministrative ? <><th rowSpan={2}>Inconsistência</th><th rowSpan={2}>Análise</th></> : <th rowSpan={2}>Justificativa</th>}</tr><tr><th>Entrada</th><th>Almoço</th><th>Retorno</th><th>Saída</th><th>Dia falta</th><th>Atraso</th><th>Extra 50%</th><th>Desconto DSR</th></tr></thead>
          <tbody>{displayRows.map((row) => { const kind = rowKind(row); return <tr key={row.id} className={`point-row-${kind}`}><td><strong>{formatDate(row.data)}</strong></td><td>{shortTime(row.entrada)}</td><td>{shortTime(row.saida_almoco)}</td><td>{shortTime(row.volta_almoco)}</td><td>{shortTime(row.saida)}</td><td>{row.horas_trabalhadas ? String(row.horas_trabalhadas).slice(0, 5) : '—'}</td><td>{renderPointStatus(row)}</td><td>{row.dia_falta || '—'}</td><td>{row.horas_atraso || '—'}</td><td>{row.extra_50 || '—'}</td><td>{row.desconta_dsr || '—'}</td>{isAdministrative ? <><td>{hasInconsistency(row) ? renderAdministrativeIssueStatus(row) : '—'}</td><td>{renderAdministrativeReview(row)}</td></> : <td>{renderEmployeeJustification(row)}</td>}</tr> })}</tbody>
        </table>
      </div>}
    </SectionCard>
    {reviewModalRow ? <div className="point-review-backdrop" role="dialog" aria-modal="true" aria-labelledby="point-review-title" onClick={(event) => { if (event.target === event.currentTarget) setReviewModalRow(null) }}><section className="point-review-dialog"><div className="point-review-dialog-head"><div><span className="eyebrow">Análise de justificativa</span><h3 id="point-review-title">{formatDate(reviewModalRow.data)}</h3></div><button className="icon-button" type="button" onClick={() => setReviewModalRow(null)} aria-label="Fechar análise"><X size={17} /></button></div><div className="point-review-dialog-body"><div className="point-review-summary"><div><span>Ocorrência</span><strong>{reviewModalRow.horas_atraso ? `Atraso de ${reviewModalRow.horas_atraso}` : reviewModalRow.dia_falta ? `Falta: ${reviewModalRow.dia_falta}` : 'Inconsistência de ponto'}</strong></div><div><span>Tipo</span><strong>{reviewModalRow.justificativa_motivo ? 'Justificativa do funcionário' : 'Análise administrativa'}</strong></div></div><div className="point-review-message"><span>Motivo informado</span><p>{reviewModalRow.justificativa_motivo || 'O funcionário não enviou uma justificativa textual.'}</p></div>{reviewModalRow.justificativa_arquivo_url ? <a className="point-review-attachment" href={reviewModalRow.justificativa_arquivo_url} target="_blank" rel="noreferrer"><FileText size={15} /> {reviewModalRow.justificativa_arquivo_nome || 'Abrir anexo'}</a> : <small className="point-review-no-attachment">Nenhum anexo enviado.</small>}<label className="point-review-response"><span>Resposta ao funcionário</span><textarea value={justificationText} onChange={(event) => setJustificationText(event.target.value)} placeholder="Escreva uma resposta. Para recusar, informe o motivo." rows={3} readOnly={reviewModalRow.justificativa_status !== 'pendente'} /></label></div><div className="point-review-dialog-actions"><button className="secondary-button" type="button" onClick={() => setReviewModalRow(null)}>Fechar</button>{reviewModalRow.justificativa_status === 'pendente' ? <><button className="secondary-button danger-button" type="button" onClick={() => requestSubmittedJustificationReview(reviewModalRow, 'recusada')} disabled={decisionBusy === reviewModalRow.data}><X size={15} /> Recusar</button><button className="primary-button" type="button" onClick={() => requestSubmittedJustificationReview(reviewModalRow, 'aceita')} disabled={decisionBusy === reviewModalRow.data}><Check size={15} /> Aceitar</button></> : null}</div></section></div> : null}
    {pendingAction ? <div className="point-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="point-confirm-title"><div className="point-confirm-dialog"><div className="point-confirm-icon"><ShieldCheck size={22} /></div><div><h3 id="point-confirm-title">{pendingAction.title}</h3><p>{pendingAction.description}</p></div><div className="point-confirm-actions"><button className="secondary-button" type="button" onClick={() => setPendingAction(null)}>Cancelar</button><button className="primary-button" type="button" onClick={async () => { const action = pendingAction; setPendingAction(null); await action.run() }}><Check size={15} /> {pendingAction.confirmLabel}</button></div></div></div> : null}
  </>
}

function PayslipsView({ token }: { token: string }) {
  const [rows, setRows] = useState<PayslipRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { listPayslips(token).then((data) => { if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta'); setRows(data.holerites || []) }).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')).finally(() => setLoading(false)) }, [token])
  return <><PageHeading eyebrow="Minha área · remuneração" title="Holerites" description="Comprovantes publicados pelo departamento pessoal." /><SectionCard title="Comprovantes disponíveis" caption="Arquivos privados vinculados ao seu cadastro">{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum holerite publicado" description="Quando o DP disponibilizar um comprovante, ele ficará disponível neste espaço." /> : <div className="document-list">{rows.map((row) => <div className="document-row" key={row.id}><span className="document-icon"><Receipt size={18} /></span><div><strong>{String(row.mes).padStart(2, '0')}/{row.ano}</strong><small>{row.arquivo_nome || 'Holerite'}</small></div><a href={row.arquivo_url} target="_blank" rel="noreferrer" className="icon-button" aria-label="Abrir holerite"><ArrowRight size={17} /></a></div>)}</div>}</SectionCard></>
}

function MedicalLeavesView({ token }: { token: string }) {
  const [rows, setRows] = useState<MedicalLeaveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [tipo, setTipo] = useState('Atestado médico')
  const [dataAtendimento, setDataAtendimento] = useState(new Date().toISOString().slice(0, 10))
  const [dias, setDias] = useState(1)
  const [observacao, setObservacao] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  async function reload() {
    setLoading(true)
    try {
      const data = await listMedicalLeaves(token)
      if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta')
      setRows(data.atestados || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de consulta')
    } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    if (!file) { setError('Selecione o arquivo do atestado.'); setSaving(false); return }
    try {
      await uploadMedicalLeave(token, { tipo, dataAtendimento, dias, observacao, file })
      setShowForm(false); setFile(null); setObservacao(''); setSuccess('Atestado enviado e registrado para conferência do RH.'); await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o atestado.')
    } finally { setSaving(false) }
  }

  return <>
    <PageHeading eyebrow="Minha área · saúde" title="Atestados" description="Acompanhe documentos enviados e a conferência do RH." action={<button className="secondary-button" onClick={() => { setShowForm(!showForm); setError('') }}>{showForm ? <X size={16} /> : <HeartPulse size={16} />} {showForm ? 'Fechar' : 'Enviar atestado'}</button>} />
    {showForm && <SectionCard title="Enviar novo atestado" caption="O arquivo será guardado no Storage privado e associado ao seu cadastro"><form className="form-stack upload-form" onSubmit={submit}><label>Tipo<select value={tipo} onChange={(event) => setTipo(event.target.value)}><option>Atestado médico</option><option>Declaração de comparecimento</option><option>Atestado de acompanhante</option><option>Justificativa</option><option>Outro</option></select></label><div className="form-row"><label>Data do atendimento<input type="date" value={dataAtendimento} onChange={(event) => setDataAtendimento(event.target.value)} required /></label><label>Dias<input type="number" min={1} max={30} value={dias} onChange={(event) => setDias(Number(event.target.value))} required /></label></div><label>Arquivo do atestado<input type="file" accept="application/pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] || null)} required /><span className="field-note">PDF ou imagem · máximo de 10 MB</span></label><label>Observação<textarea value={observacao} onChange={(event) => setObservacao(event.target.value)} placeholder="Alguma informação para o RH?" rows={3} /></label>{error && <div className="form-error"><AlertCircle size={16} />{error}</div>}<button className="primary-button" type="submit" disabled={saving}>{saving ? <><RefreshCw className="spin" size={16} /> Enviando com segurança…</> : <>Enviar para conferência <ArrowRight size={16} /></>}</button></form></SectionCard>}
    {success && <div className="form-success inline-message"><Check size={16} />{success}</div>}
    <SectionCard title="Histórico de atestados" caption="Registros persistidos no Supabase">{loading ? <LoadingState /> : error && !showForm ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum atestado enviado" description="Quando você enviar um documento, o status de conferência aparecerá aqui." /> : <div className="document-list">{rows.map((row) => <div className="document-row" key={row.id}><span className="document-icon"><FileText size={18} /></span><div><strong>{row.tipo}</strong><small>{formatDate(row.data_atendimento)} · {row.dias} dia(s) · {row.arquivo_nome || 'Sem arquivo'}</small></div><StatusPill value={row.status_label || row.status} /></div>)}</div>}</SectionCard>
    <div className="callout"><ShieldCheck size={18} /><p>Os arquivos não são públicos: a Edge Function valida sua sessão, grava no bucket privado e só então registra o protocolo no RH.</p></div>
  </>
}

const noticeCategoryLabels: Record<string, string> = {
  jornada_trabalho: 'Jornada de trabalho', holerite: 'Holerite', beneficios: 'Benefícios',
  reuniao: 'Reunião', sindicato: 'Sindicato', prevencao: 'Prevenção e saúde',
  informativo: 'Informativo', outro: 'Outro',
}

function NoticesView({ token, onUnreadChange, canMarkRead }: { token: string; onUnreadChange: (count: number) => void; canMarkRead: boolean }) {
  const [rows, setRows] = useState<NoticeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  useEffect(() => {
    let cancelled = false
    Promise.all([listNotices(token), listNoticeAttachments(token)])
      .then(([data, attachmentResult]) => {
        if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta')
        const attachmentsByNotice = new Map<string, NonNullable<NoticeRow['anexos']>>()
        if (attachmentResult.sucesso) for (const attachment of attachmentResult.anexos || []) {
          const current = attachmentsByNotice.get(attachment.aviso_id) || []
          current.push(attachment)
          attachmentsByNotice.set(attachment.aviso_id, current)
        }
        const notices = (data.avisos || []).map((row) => ({ ...row, anexos: attachmentsByNotice.get(row.id) || [] }))
          .sort((a, b) => new Date(b.publicado_em || b.created_at).getTime() - new Date(a.publicado_em || a.created_at).getTime())
        if (cancelled) return
        setRows(notices)
        if (!attachmentResult.sucesso) setError(attachmentResult.erro || 'Os avisos foram carregados, mas os anexos não puderam ser listados.')
        onUnreadChange(canMarkRead ? (data.nao_lidos ?? notices.filter((row) => !row.is_lido && !row.lido_em).length) : 0)
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Falha de consulta') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, onUnreadChange, canMarkRead])

  async function markRead(row: NoticeRow) {
    if (!canMarkRead || row.is_lido || row.lido_em || busyId) return
    setBusyId(row.id)
    setError('')
    try {
      const result = await markNoticeRead(token, row.id)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível registrar a leitura.')
      const updated = rows.map((item) => item.id === row.id ? { ...item, is_lido: true, lido_em: result.lido_em || new Date().toISOString() } : item)
      setRows(updated)
      onUnreadChange(updated.filter((item) => !item.is_lido && !item.lido_em).length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar leitura.')
    } finally {
      setBusyId('')
    }
  }

  const unreadCount = canMarkRead ? rows.filter((row) => !row.is_lido && !row.lido_em).length : 0
  const readCount = rows.length - unreadCount
  return <div className="employee-notices-page">
    <PageHeading eyebrow="Minha área · comunicação" title="Avisos" description={canMarkRead ? 'Acompanhe comunicados e campanhas da empresa em ordem cronológica. Abra as imagens e baixe os arquivos publicados pelo RH.' : 'Comunicados e campanhas oficiais da empresa, com imagens e documentos disponibilizados pelo RH.'} />
    {canMarkRead && <div className="notice-personal-summary">
      <div className="notice-personal-count is-unread"><span>Não lidos</span><strong>{unreadCount}</strong></div>
      <div className="notice-personal-count"><span>Já lidos</span><strong>{readCount}</strong></div>
      <div className="notice-personal-count"><span>Total publicado</span><strong>{rows.length}</strong></div>
    </div>}
    <SectionCard title="Comunicados publicados" caption="Avisos enviados pelo RH para os funcionários da empresa">
      {loading ? <LoadingState /> : error && rows.length === 0 ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum aviso publicado" description="Quando o RH publicar um comunicado, ele aparecerá aqui." /> : <div className="notice-list employee-notice-list">
        {rows.map((row) => {
          const isRead = !canMarkRead || Boolean(row.is_lido || row.lido_em)
          return <article className={`notice-card employee-notice-card ${isRead ? 'is-read' : 'is-unread'}`} key={row.id}>
            <div className="notice-head"><div className="notice-tags"><StatusPill value={row.prioridade} /><span className="notice-category-tag">{noticeCategoryLabels[row.categoria] || 'Informativo'}</span>{canMarkRead && !isRead && <span className="notice-unread-tag">Novo · não lido</span>}</div><time>{formatDate(row.publicado_em || row.created_at)}</time></div>
            <h3>{row.titulo}</h3><p>{row.conteudo}</p>
            <NoticeAttachments token={token} noticeId={row.id} attachments={row.anexos || []} />
            {canMarkRead && <div className="employee-notice-footer">{isRead ? <span className="notice-read-receipt"><Check size={14} /> Lido em {formatDate(row.lido_em || '')}</span> : <button className="primary-button notice-read-button" type="button" onClick={() => void markRead(row)} disabled={busyId === row.id}>{busyId === row.id ? <><RefreshCw size={14} className="spin" /> Registrando…</> : <><Check size={14} /> Marcar como lido</>}</button>}</div>}
          </article>
        })}
      </div>}
      {error && rows.length > 0 && <div className="form-error notice-inline-error"><AlertCircle size={15} />{error}</div>}
    </SectionCard>
  </div>
}

function parseDelimited(text: string) {
  const rows: string[][] = []
  let row: string[] = []; let cell = ''; let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ';') { row.push(cell.trim()); cell = '' }
    else if (char === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else if (char !== '\r') cell += char
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows.filter((item) => item.some(Boolean))
}

function normalizeHeader(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function pointRowsFromMatrix(matrix: string[][]) {
  if (matrix.length < 2) return []
  const headers = matrix[0].map(normalizeHeader)
  const find = (...names: string[]) => {
    const normalized = names.map(normalizeHeader)
    const exact = headers.findIndex((header) => normalized.includes(header))
    return exact >= 0 ? exact : headers.findIndex((header) => normalized.some((name) => header.startsWith(name)))
  }
  const get = (cells: string[], ...names: string[]) => { const index = find(...names); return index >= 0 ? String(cells[index] || '').trim() : '' }
  return matrix.slice(1).map((cells) => {
    const rawDate = get(cells, 'Dia').split(' ')[0]
    const parts = rawDate.split('/')
    const data = parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : ''
    return {
      cpf: get(cells, 'CPF do funcionário', 'CPF'), nome: get(cells, 'Nome do funcionário', 'Nome'), data,
      previsto: get(cells, 'Previsto'), entrada_1: get(cells, 'Entrada 1'), saida_1: get(cells, 'Saída 1', 'Saida 1'),
      entrada_2: get(cells, 'Entrada 2'), saida_2: get(cells, 'Saída 2', 'Saida 2'), total_normais: get(cells, 'Total Normais'),
      total_noturno: get(cells, 'Total Noturno'), dia_falta: get(cells, 'Dia Falta'), horas_atraso: get(cells, 'Horas Atraso'),
      abono: get(cells, 'Abono'), extra_50: get(cells, 'Extra   50%D', 'Extra 50%D'), extra_100: get(cells, 'Extra   100%D', 'Extra 100%D'),
      desconta_dsr: get(cells, 'Desconta DSR'), justificativas: get(cells, 'Justificativas'),
    }
  }).filter((row) => row.cpf || row.nome)
}

async function pointRowsFromFile(file: File) {
  if (/\.xlsx?$/i.test(file.name)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    return pointRowsFromMatrix(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }))
  }
  return pointRowsFromMatrix(parseDelimited(await file.text()))
}

function printReport(title: string, columns: string[], rows: string[][]) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
  const html = `<html><head><title>${escape(title)}</title><style>body{font:12px Arial;color:#151821;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd0d8;padding:6px;text-align:left}th{background:#f0f2f5}</style></head><body><h1>${escape(title)}</h1><p>RF Gestão · gerado em ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr>${columns.map((x) => `<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((x) => `<td>${escape(x || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`
  const popup = window.open('', '_blank'); if (!popup) return; popup.document.write(html); popup.document.close()
}

function PointImportsView({ token }: { token: string }) {
  const [tipo, setTipo] = useState<'diario' | 'mensal'>('mensal')
  const [competencia, setCompetencia] = useState('10/2026')
  const [file, setFile] = useState<File | null>(null)
  const [imports, setImports] = useState<PointImportSummary[]>([])
  const [rows, setRows] = useState<PointImportRow[]>([])
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false); const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const pending = imports.find((item) => item.id === pendingId)

  async function reload() { const data = await listPointImports(token); if (!data.sucesso) throw new Error(data.erro || 'Falha ao consultar o histórico'); setImports(data.importacoes || []) }
  useEffect(() => { reload().catch((err) => setError(err instanceof Error ? err.message : 'Falha ao consultar o histórico')) }, [token])

  async function loadPreview(importacaoId: string, importType: 'diario' | 'mensal' = tipo) {
    const listed = await listImportedPoint(token, importType, importacaoId)
    if (!listed.sucesso) throw new Error(listed.erro || 'Falha ao carregar a prévia')
    setRows(listed.registros || []); setPendingId(importacaoId)
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!file) { setError('Selecione o arquivo exportado pelo aplicativo de ponto.'); return }
    setLoading(true); setError(''); setMessage(''); setRows([]); setPendingId(null)
    try {
      const linhas = await pointRowsFromFile(file)
      if (!linhas.length) throw new Error('Não foi possível reconhecer linhas no arquivo. Use o exportador original, em CSV ou Excel.')
      const result = await importPoint(token, { tipo, competencia, arquivoNome: file.name, linhas })
      if (!result.sucesso || !result.importacao_id) throw new Error(result.erro || 'Falha ao analisar a importação')
      await reload(); await loadPreview(result.importacao_id)
      setFile(null); setMessage('Prévia criada. Revise as inconsistências antes de aplicar os registros encontrados.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao analisar o arquivo.') } finally { setLoading(false) }
  }

  async function applyPending() {
    if (!pendingId) return
    setActionLoading(true); setError('')
    try { const result = await applyPointImport(token, pendingId); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível aplicar os registros'); await reload(); await loadPreview(pendingId); setMessage(`${result.linhas_aplicadas || 0} registros válidos aplicados. As inconsistências ficaram preservadas para correção.`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao aplicar os registros.') } finally { setActionLoading(false) }
  }

  async function ignorePending() {
    if (!pendingId) return
    setActionLoading(true); setError('')
    try { const result = await ignorePointImport(token, pendingId); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível arquivar a importação'); await reload(); setPendingId(null); setRows([]); setMessage('Importação arquivada no histórico de auditoria.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao arquivar a importação.') } finally { setActionLoading(false) }
  }

  async function loadRows() {
    const listed = await listImportedPoint(token, tipo)
    if (listed.sucesso) { setRows(listed.registros || []); printReport(`Ponto ${tipo} · ${competencia}`, ['Data','Funcionário','CPF','Entrada','Saída','Horas normais','Atraso/Falta'], (listed.registros || []).map((row) => [formatDate(row.data), row.nome_csv, maskCpf(row.cpf), row.entrada_1 || '', row.saida_1 || '', row.total_normais || '', row.horas_atraso || row.dia_falta || ''])) }
  }

  return <div className="import-page">
    <PageHeading eyebrow="Administração · dados reais" title="Importar ponto" description="Analise o arquivo, confira os CPFs e aplique somente os registros válidos. As inconsistências ficam rastreáveis para correção posterior." action={<button className="secondary-button" onClick={loadRows}><Download size={16} /> Gerar PDF do ponto</button>} />
    <div className="import-flow-note"><div className="import-step"><b>1</b><span><strong>Analisar</strong><small>CPF, data e formato</small></span></div><ChevronRight size={16} /><div className="import-step"><b>2</b><span><strong>Revisar</strong><small>Válidos e inconsistências</small></span></div><ChevronRight size={16} /><div className="import-step"><b>3</b><span><strong>Aplicar</strong><small>Sem bloquear os válidos</small></span></div></div>
    <div className="import-layout">
      <SectionCard title="Nova importação" caption="O arquivo é apenas analisado até você confirmar"><form className="form-stack import-form" onSubmit={submit}><div className="form-row"><label>Tipo de ponto<select value={tipo} onChange={(event) => setTipo(event.target.value as 'diario' | 'mensal')}><option value="mensal">Ponto mensal / fechamento</option><option value="diario">Ponto diário</option></select></label><label>Competência<input value={competencia} onChange={(event) => setCompetencia(event.target.value)} placeholder="10/2026" /></label></div><label>Arquivo exportado<input type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] || null)} required /><span className="field-note">Aceita o CSV exato do aplicativo e planilhas Excel. O cruzamento é feito exclusivamente pelo CPF.</span></label>{file && <div className="selected-file"><FileSpreadsheet size={18} /><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB · pronto para análise</small></div></div>}{error && <div className="form-error"><AlertCircle size={16} />{error}</div>}{message && <div className="form-success"><Check size={16} />{message}</div>}<button className="primary-button" type="submit" disabled={loading}>{loading ? <><RefreshCw className="spin" size={16} /> Analisando arquivo…</> : <><Upload size={16} /> Analisar e cruzar CPFs</>}</button></form></SectionCard>
      <SectionCard title="Critérios de validação" caption="Regras explícitas da carga"><div className="import-rules"><div><Check size={16} /><span><strong>CPF encontrado</strong><small>Registro fica elegível para aplicação.</small></span></div><div><AlertCircle size={16} /><span><strong>CPF não encontrado</strong><small>Fica marcado como inconsistência, sem bloquear os demais.</small></span></div><div><ShieldCheck size={16} /><span><strong>Auditoria</strong><small>Usuário, arquivo, competência e resultado ficam no histórico.</small></span></div></div></SectionCard>
    </div>
    {pending && <SectionCard title="Revisão antes da aplicação" caption={`Importação ${pending.tipo === 'mensal' ? 'mensal' : 'diária'} · ${pending.arquivo_nome}`} className="import-review-card"><div className="import-summary"><div className="import-stat"><span>Linhas lidas</span><strong>{pending.total_linhas}</strong></div><div className="import-stat valid"><span>CPFs encontrados</span><strong>{pending.linhas_encontradas}</strong></div><div className="import-stat invalid"><span>Inconsistências</span><strong>{pending.linhas_nao_encontradas}</strong></div><div className="import-stat"><span>Importado por</span><strong>{pending.imported_by_name || 'Você'}</strong></div></div><div className="import-review-actions"><div><strong>{pending.linhas_nao_encontradas ? 'Atenção: há linhas que precisam de correção.' : 'Tudo conferido: não há inconsistências.'}</strong><small>Aplicar registra somente os CPFs encontrados e mantém as demais linhas no histórico.</small></div><div className="button-row"><button className="primary-button" onClick={() => void applyPending()} disabled={actionLoading || pending.status !== 'pendente'}>{actionLoading ? <RefreshCw className="spin" size={16} /> : <Check size={16} />} {pending.status === 'aplicada' ? 'Registros aplicados' : 'Aplicar registros válidos'}</button><button className="secondary-button" onClick={() => void ignorePending()} disabled={actionLoading}>{pending.status === 'aplicada' ? 'Arquivar alerta' : pending.status === 'ignorada' ? 'Importação ignorada' : 'Ignorar e arquivar'}</button></div></div></SectionCard>}
    <SectionCard title="Histórico e rastreabilidade" caption="Importações, operador, competência e resultado ficam preservados"><div className="import-history">{imports.length === 0 ? <EmptyState title="Nenhuma importação ainda" description="A primeira análise aparecerá aqui com o operador e os resultados." /> : imports.map((item) => <button className={`import-history-row ${pendingId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => void loadPreview(item.id, item.tipo)}><span className="document-icon"><FileSpreadsheet size={18} /></span><span className="import-history-main"><strong>{item.tipo === 'mensal' ? 'Mensal' : 'Diário'} · {item.competencia || 'sem competência'}</strong><small>{item.arquivo_nome} · {item.imported_by_name || 'Usuário'} · {formatDate(item.created_at)}</small></span><span className="import-history-count"><b>{item.linhas_encontradas}/{item.total_linhas}</b><small>CPFs válidos</small></span><StatusPill value={item.status === 'aplicada' ? 'Aplicada' : item.status === 'ignorada' ? 'Ignorada' : item.linhas_nao_encontradas ? `${item.linhas_nao_encontradas} inconsistências` : 'Pendente'} /></button>)}</div></SectionCard>
    {rows.length > 0 && <SectionCard title="Linhas da importação" caption={`${rows.length} registros · vermelho indica inconsistência de CPF ou data`} className="import-preview-card"><div className="table-wrap"><table><thead><tr><th>Data</th><th>Funcionário no arquivo</th><th>CPF</th><th>Entrada</th><th>Saída</th><th>Resultado</th></tr></thead><tbody>{rows.slice(0, 100).map((row) => <tr className={row.encontrado ? '' : 'row-inconsistent'} key={row.id}><td>{formatDate(row.data)}</td><td><strong>{row.nome_csv}</strong>{!row.encontrado && <small className="table-note">{row.inconsistencia || 'Inconsistência'}</small>}</td><td className="mono">{maskCpf(row.cpf)}</td><td>{row.entrada_1 || '—'}</td><td>{row.saida_1 || '—'}</td><td><StatusPill value={row.encontrado ? 'Encontrado' : 'Inconsistente'} /></td></tr>)}</tbody></table></div>{rows.length > 100 && <div className="table-footnote">Exibindo as primeiras 100 linhas desta prévia.</div>}</SectionCard>}
  </div>
}


function ControlModuleView({ token, module }: { token: string; module: ModuleKey }) {
  const [data, setData] = useState<DashboardResponse>(); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { dashboard(token).then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')).finally(() => setLoading(false)) }, [token])
  const content: Record<string, { eyebrow: string; title: string; description: string; metric: string; detail: string; icon: typeof Gauge }> = {
    producao: { eyebrow: 'Operação · chão de fábrica', title: 'Produção', description: 'Lotes, costura e acompanhamento dos prazos da operação.', metric: 'lotes_em_costura', detail: 'Lotes em costura', icon: Factory },
    financeiro: { eyebrow: 'Controle · caixa', title: 'Financeiro', description: 'Compromissos, vencimentos e leitura do caixa empresarial.', metric: 'contas_pendentes', detail: 'Contas pendentes', icon: CircleDollarSign },
    dividas: { eyebrow: 'Controle · compromissos', title: 'Dívidas', description: 'Saldos devedores e decisões de renegociação.', metric: 'saldo_dividas', detail: 'Saldo devedor', icon: WalletCards },
    rh: { eyebrow: 'Pessoas · departamento pessoal', title: 'Recursos humanos', description: 'Férias, afastamentos, folha e cuidado com a equipe.', metric: 'em_ferias', detail: 'Pessoas em férias hoje', icon: BriefcaseBusiness },
    relatorios: { eyebrow: 'Controle · leitura', title: 'Relatórios', description: 'Indicadores que conectam operação, pessoas e caixa.', metric: 'funcionarios_ativos', detail: 'Funcionários ativos', icon: BarChart3 },
  }
  const item = content[module] || content.relatorios; const Icon = item.icon; const raw = data?.indicadores?.[item.metric as keyof NonNullable<DashboardResponse['indicadores']>]
  const value = item.metric === 'saldo_dividas' ? formatMoney(Number(raw || 0)) : String(raw ?? '—')
  return <><PageHeading eyebrow={item.eyebrow} title={item.title} description={item.description} action={<button className="secondary-button" disabled><Settings2 size={16} /> Configurar</button>} /><div className="module-hero"><div className="module-icon"><Icon size={28} /></div><div><span className="eyebrow">Indicador conectado</span><h2>{loading ? 'Consultando…' : value}</h2><p>{item.detail} no ambiente Supabase.</p></div></div>{error ? <ErrorState message={error} /> : <div className="two-column"><SectionCard title="Próxima camada de dados" caption="Schema preparado para operação real"><div className="empty-module"><PackageCheck size={28} /><strong>Estrutura pronta para receber lançamentos</strong><p>Este módulo já está protegido por perfil e conectado aos indicadores reais. Os registros de operação serão exibidos assim que cadastrados por um administrador.</p></div></SectionCard><SectionCard title="Regra de acesso" caption="Aplicada no servidor"><div className="security-note"><div className="security-icon"><ShieldCheck size={20} /></div><div><strong>Permissão validada por RPC</strong><p>A tela não libera dados por ocultação visual: a função do Supabase verifica o perfil antes de responder.</p></div></div></SectionCard></div>}</>
}

function Shell({ user, token, onLogout }: { user: SessionUser; token: string; onLogout: () => void }) {
  const allowedItems = navItems.filter((item) => item.profiles.includes(user.perfil))
  const [active, setActive] = useState<ModuleKey>(user.perfil === 'funcionario' ? 'dashboard' : 'dashboard')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [profile, setProfile] = useState<EmployeeProfile>()
  const [unreadNotices, setUnreadNotices] = useState(0)
  useEffect(() => { myProfile(token).then((data) => { if (data.sucesso && data.funcionario) setProfile(data.funcionario) }).catch(() => undefined) }, [token])
  useEffect(() => {
    if (user.perfil !== 'funcionario') { setUnreadNotices(0); return }
    let cancelled = false
    const refreshCount = () => { unreadNoticeCount(token).then((data) => { if (!cancelled && data.sucesso) setUnreadNotices(Math.max(0, data.nao_lidos || 0)) }).catch(() => undefined) }
    refreshCount()
    const timer = window.setInterval(refreshCount, 60000)
    window.addEventListener('focus', refreshCount)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refreshCount) }
  }, [token, user.perfil])
  const displayName = profile?.nome || user.nome
  const displayCargo = profile?.cargo || user.cargo
  const activeItem = navItems.find((item) => item.key === active) || navItems[0]
  const groups = Array.from(new Set(allowedItems.map((item) => item.group)))
  function navigate(key: ModuleKey) { setActive(key); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function renderPage() {
    if (active === 'dashboard') return <DashboardView token={token} user={user} onNavigate={navigate} />
    if (active === 'funcionarios') return <EmployeesView token={token} />
    if (active === 'ordens') return adminProfiles.includes(user.perfil)
      ? <WorkOrdersDashboard token={token} onGoToProduction={() => navigate('producao')} />
      : <><PageHeading eyebrow="Acesso restrito" title="Ordens de serviço" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'financeiro') return <FinanceExecutiveDashboard token={token} />
    if (active === 'dividas') return adminProfiles.includes(user.perfil)
      ? <DebtManagementDashboard token={token} />
      : <><PageHeading eyebrow="Acesso restrito" title="Gestão de dívidas" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'relatorios') return <FinanceReportsDashboard token={token} />
    if (active === 'rh') return <AdminCenter token={token} initialTab="painel" />
    if (active === 'producao') return <FactoryProductionDashboard token={token} />
    if (active === 'perfil') return <EmployeeProfileView token={token} onProfileUpdated={setProfile} />
    if (active === 'ponto') return <PointView token={token} user={user} />
    if (active === 'holerites') return <PayslipsView token={token} />
    if (active === 'atestados') return <EmployeeMedicalLeaves token={token} />
    if (active === 'avisos') return <NoticesView token={token} onUnreadChange={setUnreadNotices} canMarkRead={user.perfil === 'funcionario'} />
    if (active === 'solicitacoes') return <EmployeeHRRequests token={token} />
    if (active === 'importacoes') return <PointImportsView token={token} />
    if (active === 'acordos') return <AgreementsDashboard token={token} />
    if (active === 'documentos') return <InternalDocumentsDashboard token={token} canManage={adminProfiles.includes(user.perfil)} />
    return <ControlModuleView token={token} module={active} />
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <img className="brand-logo" src={rfLogo} alt="RF — Rafaela Fernandes" />
          <div><strong>RF</strong><span>Rafaela Fernandes</span></div>
          <button className="close-mobile" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <nav>
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-label">{group}</span>
              {allowedItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.key} className={`nav-item ${active === item.key ? 'active' : ''}`} onClick={() => navigate(item.key)}>
                    <Icon size={17} /><span>{item.label}</span>{item.key === 'avisos' && unreadNotices > 0 && <span className="nav-badge" aria-label={`${unreadNotices} avisos não lidos`}>{unreadNotices > 99 ? '99+' : unreadNotices}</span>}{active === item.key && <ChevronRight className="nav-arrow" size={14} />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <button className="logout-button" onClick={onLogout}><LogOut size={17} /> Sair da sessão</button>
      </aside>
      <div className={`shell-backdrop ${mobileMenu ? 'visible' : ''}`} onClick={() => setMobileMenu(false)} />
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu size={20} /></button>
          <div className="breadcrumbs"><span>RF Gestão</span><ChevronRight size={14} /><strong>{activeItem.label}</strong></div>
          <div className="topbar-actions">
            <span className="connection-status"><span className="live-dot">●</span> Supabase conectado</span>
            <div className="topbar-user">
              <UserAvatar name={displayName} url={profile?.avatar_url} className="topbar-avatar" />
              <div className="topbar-user-meta"><strong>{displayName}</strong><span>{displayCargo || profileLabel(user.perfil)}</span></div>
            </div>
          </div>
        </header>
        <div className="content-wrap">{renderPage()}</div>
        <footer className="app-footer"><span>RF Gestão · {new Date().getFullYear()}</span><span>Sessão segura</span></footer>
      </main>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [token, setSessionToken] = useState<string | null>(null)
  const [firstAccess, setFirstAccess] = useState(false)
  const [booting, setBooting] = useState(true)
  useEffect(() => { const currentToken = getToken(); if (!currentToken) { setBooting(false); return } getSession(currentToken).then((data) => { if (data.valido) { setUser(data); setSessionToken(currentToken); setFirstAccess(Boolean(data.primeiro_acesso)) } else clearToken() }).catch(() => clearToken()).finally(() => setBooting(false)) }, [])
  function loggedIn(response: LoginResponse) { if (!response.token) return; setSessionToken(response.token); setUser({ usuario_id: response.usuario_id, funcionario_id: response.funcionario_id, perfil: response.perfil, nome: response.nome, cargo: response.cargo, cpf: response.cpf }); setFirstAccess(Boolean(response.primeiro_acesso)) }
  async function signOut() { const currentToken = token || getToken(); if (currentToken) await logout(currentToken).catch(() => undefined); clearToken(); setUser(null); setSessionToken(null); setFirstAccess(false) }
  if (booting) return <main className="boot-screen"><div className="brand-lockup"><img className="brand-logo" src={rfLogo} alt="RF — Rafaela Fernandes" /><div><strong>RF</strong><span>Rafaela Fernandes</span></div></div><RefreshCw className="spin" size={20} /><span>Carregando seu ambiente…</span></main>
  if (!user || !token) return <LoginScreen onLoggedIn={loggedIn} />
  if (firstAccess) return <FirstAccessScreen token={token} user={user} onDone={() => setFirstAccess(false)} onLogout={signOut} />
  return <Shell user={user} token={token} onLogout={signOut} />
}
