import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Factory,
  FileCheck2,
  FileText,
  Fingerprint,
  Gauge,
  Info,
  HardHat,
  HeartPulse,
  HelpCircle,
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
  Sparkles,
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
  reconcilePointImports,
  dashboard,
  getFactoryProduction,
  listAgreements,
  listOrders,
  managedDebts,
  adminFinanceiroWorkspace,
  adminLeaves,
  adminVacations,
  dashboardPeriod,
  adminProntuario,
  getSession,
  getPayslipDocumentUrl,
  getToken,
  listEmployeePointSchedules,
  listEmployees,
  listMedicalLeaves,
  listNotices,
  listNoticeAttachments,
  markNoticeRead,
  listPayslips,
  listPoint,
  searchEmployees,
  unreadNoticeCount,
  login,
  logout,
  myProfile,
  changePassword,
  setPassword,
  setToken,
  updateAvatar,
  uploadMedicalLeave,
} from './lib/api'
import { displayValue, fieldGroups } from './features/EmployeeFichaPanel'
import type {
  DashboardResponse,
  DashboardPeriodOverviewResponse,
  AdminLeaveRow,
  AdminVacationRow,
  EmployeeProfile,
  EmployeeRow,
  EmployeeSearchPage,
  FactoryProductionLot,
  FinanceiroLancamento,
  LoginResponse,
  MedicalLeaveRow,
  ModuleKey,
  NoticeRow,
  OrderRow,
  PayslipRow,
  PointRow,
  Profile,
  SessionUser,
  PointImportRow,
  PointImportSummary,
  PointScheduleAssignment,
} from './lib/types'
import { getNotificationPermission, requestNotificationPermission, showDashboardNotification, subscribeDashboardRealtime, type DashboardLiveEvent, type DashboardRealtimeStatus } from './lib/dashboard-realtime'
import { buildPeriodOverviewRows, downloadPeriodOverviewCsv, exportPeriodOverviewPdf, type OverviewReportEnrichment, type OverviewReportRow } from './features/dashboard-executive-report'
import { EmployeeFichaPanel } from './features/EmployeeFichaPanel'
import { durationToMinutes, formatDuration, hasDurationValue, periodMinutes } from './lib/point-schedules'
import { pointRowsFromFile } from './lib/point-import-parser'
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
import './hr-vacation-management.css'
import './hr-vacation-import.css'

const PointManagementDashboard = lazy(() => import('./features/PointManagementDashboard').then((module) => ({ default: module.PointManagementDashboard })))
const PointSchedulesPanel = lazy(() => import('./features/PointSchedulesPanel').then((module) => ({ default: module.PointSchedulesPanel })))
const EmployeeMedicalLeaves = lazy(() => import('./features/MedicalLeavesWorkflow').then((module) => ({ default: module.EmployeeMedicalLeaves })))
const EmployeeHRRequests = lazy(() => import('./features/EmployeeHRRequests').then((module) => ({ default: module.EmployeeHRRequests })))
const NoticeAttachments = lazy(() => import('./features/NoticeAttachments').then((module) => ({ default: module.NoticeAttachments })))
const AgreementsDashboard = lazy(() => import('./features/AgreementsDashboard').then((module) => ({ default: module.AgreementsDashboard })))
const WorkOrdersDashboard = lazy(() => import('./features/WorkOrdersDashboard').then((module) => ({ default: module.WorkOrdersDashboard })))
const FactoryProductionDashboard = lazy(() => import('./features/FactoryProductionDashboard').then((module) => ({ default: module.FactoryProductionDashboard })))
const AdminCenter = lazy(() => import('./features/AdminCenterV2').then((module) => ({ default: module.AdminCenterV2 })))
const DebtManagementDashboard = lazy(() => import('./features/DebtManagementDashboard').then((module) => ({ default: module.DebtManagementDashboard })))
const FinanceExecutiveDashboard = lazy(() => import('./features/FinanceExecutiveDashboard').then((module) => ({ default: module.FinanceExecutiveDashboard })))
const FinanceReportsDashboard = lazy(() => import('./features/FinanceReportsDashboard').then((module) => ({ default: module.FinanceReportsDashboard })))
const InternalDocumentsDashboard = lazy(() => import('./features/InternalDocumentsDashboard').then((module) => ({ default: module.InternalDocumentsDashboard })))
const EmployeeVacationPortal = lazy(() => import('./features/EmployeeVacationPortal').then((module) => ({ default: module.EmployeeVacationPortal })))
const PayslipImportDashboard = lazy(() => import('./features/PayslipImportDashboard').then((module) => ({ default: module.PayslipImportDashboard })))
const EmployeeManagementDashboard = lazy(() => import('./features/EmployeeManagementDashboard').then((module) => ({ default: module.EmployeeManagementDashboard })))
const EmployeeOwnDossier = lazy(() => import('./features/EmployeeOwnDossier').then((module) => ({ default: module.EmployeeOwnDossier })))
const IntelligentView = lazy(() => import('./features/IntelligentView').then((module) => ({ default: module.IntelligentView })))
const PayrollManagementDashboard = lazy(() => import('./features/PayrollManagementDashboard').then((module) => ({ default: module.PayrollManagementDashboard })))

const managerProfiles: Profile[] = ['gestor', 'administrador', 'admin']
const adminProfiles: Profile[] = ['administrador', 'admin']
const managementProfiles: Profile[] = managerProfiles

function redactOperationalDashboard(data: DashboardResponse): DashboardResponse {
  const isRestrictedDestination = (destination: ModuleKey) => ['ordens', 'producao', 'financeiro', 'dividas', 'acordos'].includes(destination)
  return {
    ...data,
    indicadores: data.indicadores ? { ...data.indicadores, ordens_ativas: 0, lotes_em_costura: 0, contas_pendentes: 0, saldo_dividas: 0 } : data.indicadores,
    alertas: (data.alertas || []).filter((alert) => !isRestrictedDestination(alert.destino)),
    funil: { recebidas: 0, em_producao: 0, costuradas: 0, entregues: 0, pagas: 0 },
    comparativos: { ...data.comparativos, ordens_entrada_mes: undefined, ordens_entrada_mes_anterior: undefined },
    inteligencia: {
      ...data.inteligencia,
      operacao: undefined,
      financeiro: undefined,
      agenda: (data.inteligencia?.agenda || []).filter((item) => !isRestrictedDestination(item.destino)),
      evolucao: [],
      pendencias_area: { ...data.inteligencia?.pendencias_area, financeiro: undefined, operacao: undefined, producao: undefined },
    },
  }
}

type NavItem = { key: ModuleKey; label: string; description: string; icon: typeof Gauge; group: string; profiles: Profile[] }

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="app-error-screen"><AlertTriangle size={30} /><h1>Não foi possível carregar esta tela</h1><p>O restante da sessão foi preservado. Recarregue a página para tentar novamente.</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>Recarregar sistema</button></main>
  }
}

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Visão geral', description: 'Prioridades administrativas', icon: LayoutDashboard, group: 'Operação', profiles: managementProfiles },
  { key: 'visao_inteligente', label: 'Visão inteligente', description: 'Consultas locais sobre os registros', icon: Sparkles, group: 'Operação', profiles: managementProfiles },
  { key: 'funcionarios', label: 'Funcionários', description: 'Gestão da equipe e prontuários', icon: UsersRound, group: 'Operação', profiles: managementProfiles },
  { key: 'ordens', label: 'Ordens de serviço', description: 'Cadastro de lotes e financeiro', icon: ClipboardList, group: 'Operação', profiles: adminProfiles },
  { key: 'producao', label: 'Produção', description: 'Lotes e costura', icon: Factory, group: 'Operação', profiles: adminProfiles },
  { key: 'financeiro', label: 'Financeiro', description: 'Fluxo e compromissos', icon: CircleDollarSign, group: 'Controle', profiles: managementProfiles },
  { key: 'folha', label: 'Folha de pagamento', description: 'Lançamentos e fechamento da folha', icon: Receipt, group: 'Controle', profiles: managementProfiles },
  { key: 'acordos', label: 'Acordos e parcelas', description: 'Pagamentos trabalhistas', icon: Scale, group: 'Controle', profiles: managementProfiles },
  { key: 'dividas', label: 'Dívidas', description: 'Saldos e vencimentos', icon: WalletCards, group: 'Controle', profiles: managementProfiles },
  { key: 'relatorios', label: 'Relatórios', description: 'Indicadores administrativos e financeiros', icon: BarChart3, group: 'Controle', profiles: managementProfiles },
  { key: 'importacoes', label: 'Gestão de ponto', description: 'Equipe, importações e jornadas', icon: FileSpreadsheet, group: 'Controle', profiles: managementProfiles },
  { key: 'importar_holerite', label: 'Gestão de Holerites', description: 'Documentos, cobertura e pendências', icon: Receipt, group: 'Controle', profiles: managementProfiles },
  { key: 'rh', label: 'Recursos humanos', description: 'Painel e operações de RH', icon: BriefcaseBusiness, group: 'Pessoas', profiles: adminProfiles },
  { key: 'ferias', label: 'Gestão de férias', description: 'Programação e documentos da equipe', icon: CalendarDays, group: 'Pessoas', profiles: adminProfiles },
  { key: 'ponto', label: 'Ponto da equipe', description: 'Jornadas e conferência administrativa', icon: Fingerprint, group: 'Pessoas', profiles: managementProfiles },
  { key: 'documentos', label: 'Documentos internos', description: 'Biblioteca administrativa da empresa', icon: BookOpen, group: 'Pessoas', profiles: adminProfiles },
]

function profileLabel(profile: Profile) {
  if (profile === 'admin' || profile === 'administrador') return 'Administrador'
  if (profile === 'gestor') return 'Gestor'
  return 'Funcionário'
}

function maskCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '')
  if (!digits) return 'CPF não informado'
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`
  return digits.length > 2 ? `${'*'.repeat(digits.length - 2)}${digits.slice(-2)}` : '*'.repeat(digits.length)
}

function normalizeCpf(value: string) {
  return value.replace(/\D/g, '').slice(0, 11)
}

function formatPointDuration(value: string | null | undefined) {
  if (!hasDurationValue(value)) return '—'
  const minutes = durationToMinutes(value)
  return minutes === null ? 'Formato inválido' : formatDuration(minutes)
}

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'RF'
}

type GlobalSearchResult = { id: string; title: string; subtitle: string; kind: string; destination: ModuleKey }

function GlobalSearch({ token, canSearchAll, onNavigate }: { token: string; canSearchAll: boolean; onNavigate: (key: ModuleKey) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName || '')) { event.preventDefault(); setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0) }
      if (event.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setResults([]); setError(''); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const employeePromise = searchEmployees(token, { busca: term, limite: 6 })
        const [employees, orders, agreements, finance] = await Promise.all([
          employeePromise,
          canSearchAll ? listOrders(token) : Promise.resolve({ sucesso: true, ordens: [] }),
          canSearchAll ? listAgreements(token) : Promise.resolve({ sucesso: true, parcelas: [] }),
          canSearchAll ? adminFinanceiroWorkspace(token) : Promise.resolve({ sucesso: true, contas: [] }),
        ])
        if (cancelled) return
        const normalized = term.toLocaleLowerCase('pt-BR')
        const next: GlobalSearchResult[] = []
        for (const row of employees.registros || []) next.push({ id: row.id, title: row.nome, subtitle: [row.cargo, row.cpf ? `CPF final ${String(row.cpf).slice(-2)}` : ''].filter(Boolean).join(' · '), kind: 'Funcionário', destination: 'funcionarios' })
        for (const row of orders.ordens || []) if (`${row.numero} ${row.cliente || ''} ${row.descricao || ''}`.toLocaleLowerCase('pt-BR').includes(normalized)) next.push({ id: row.id, title: row.numero || 'Ordem de serviço', subtitle: [row.cliente, row.status].filter(Boolean).join(' · '), kind: 'Ordem', destination: 'ordens' })
        for (const row of agreements.parcelas || []) if (`${row.processo || ''} ${row.funcionario_nome || ''}`.toLocaleLowerCase('pt-BR').includes(normalized)) next.push({ id: row.id, title: row.processo || 'Acordo trabalhista', subtitle: [row.funcionario_nome, row.status].filter(Boolean).join(' · '), kind: 'Acordo', destination: 'acordos' })
        for (const row of finance.contas || []) if (`${row.descricao || ''} ${row.categoria || ''}`.toLocaleLowerCase('pt-BR').includes(normalized)) next.push({ id: row.id || `${row.descricao}`, title: row.descricao || 'Lançamento financeiro', subtitle: [row.categoria, row.status].filter(Boolean).join(' · '), kind: 'Financeiro', destination: 'financeiro' })
        setResults(next.slice(0, 12))
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível consultar os registros.') }
      finally { if (!cancelled) setLoading(false) }
    }, 280)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [canSearchAll, query, token])
  return <div className="global-search"><div className={`global-search-box ${open ? 'is-open' : ''}`}><Search size={16} /><input ref={inputRef} value={query} onFocus={() => setOpen(true)} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar registros…" aria-label="Busca global" /><kbd>/</kbd></div>{open && <><button className="global-search-backdrop" type="button" aria-label="Fechar busca" onClick={() => setOpen(false)} /><div className="global-search-results" role="dialog" aria-label="Resultados da busca global">{query.trim().length < 2 ? <p className="global-search-hint">Digite pelo menos 2 caracteres para buscar funcionários, ordens, acordos e lançamentos.</p> : loading ? <p className="global-search-hint">Consultando dados reais…</p> : error ? <p className="global-search-error">{error}</p> : results.length === 0 ? <p className="global-search-hint">Nenhum registro encontrado com este termo.</p> : results.map((result) => <button type="button" className="global-search-result" key={`${result.kind}-${result.id}`} onClick={() => { onNavigate(result.destination); setOpen(false) }}><span className="global-search-kind">{result.kind}</span><span><strong>{result.title}</strong><small>{result.subtitle || 'Sem detalhes adicionais'}</small></span><ArrowRight size={15} /></button>)}</div></>}</div>
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
      if (!managementProfiles.includes(response.perfil)) {
        clearToken()
        setError('O portal do funcionário está desativado. Este acesso é exclusivo para a gestão administrativa.')
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
        <div className="auth-copy"><span className="eyebrow">Rafaela Fernandes · gestão integrada</span><h1>Gestão clara.<br /><em>Decisões no tempo certo.</em></h1><p>Financeiro, RH, departamento pessoal, fiscal e operação em um ambiente administrativo protegido.</p></div>
        <div className="auth-feature"><ShieldCheck size={18} /><span>O portal do funcionário está desativado nesta versão.</span></div>
      </section>
      <section className="auth-card">
        <div className="auth-card-head"><div className="mobile-brand"><img className="brand-logo compact" src={rfLogo} alt="RF — Rafaela Fernandes" /><strong>RF Gestão</strong></div><span className="eyebrow">Entrar no sistema</span><h2>Acesso da gestão</h2><p>Use seu CPF e sua senha para continuar.</p></div>
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

type OverviewQuickModalKind = 'equipe' | 'ordens' | 'costura' | 'contas' | 'recebidas' | 'producao' | 'costuradas' | 'entregues' | 'pagas' | 'ferias_hoje' | 'ordens_atrasadas' | 'ordens_proximas' | 'contas_vencidas'
type OverviewQuickDetails = { employees?: EmployeeRow[]; orders?: OrderRow[]; lots?: FactoryProductionLot[]; contas?: FinanceiroLancamento[]; vacations?: AdminVacationRow[]; leaves?: AdminLeaveRow[] }
type OverviewQuickModalRow = { title: string; subtitle: string; meta: string }

function overviewTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function OverviewQuickModal({ kind, details, count, reportTitle, reportSubtitle, reportRows, warning, onClose, onOpenSource }: { kind: OverviewQuickModalKind | 'relatorio'; details?: OverviewQuickDetails; count: number; reportTitle?: string; reportSubtitle?: string; reportRows?: OverviewQuickModalRow[]; warning?: string; onClose: () => void; onOpenSource: (module: ModuleKey) => void }) {
  const titles: Record<OverviewQuickModalKind | 'relatorio', [string, string]> = {
    equipe: ['Equipe ativa', 'Funcionários ativos no quadro atual'], ordens: ['Ordens ativas', 'Ordens ainda em operação'], costura: ['Lotes em costura', 'Lotes que estão na etapa de costura'], contas: ['Contas pendentes', 'Obrigações financeiras sem baixa'], recebidas: ['Ordens recebidas', 'Ordens que entraram na operação'], producao: ['Ordens em produção', 'Ordens em execução na fábrica'], costuradas: ['Ordens costuradas', 'Ordens com costura registrada'], entregues: ['Ordens entregues', 'Ordens que já foram entregues'], pagas: ['Ordens pagas', 'Ordens com pagamento confirmado'],
    ferias_hoje: ['Férias e afastamentos hoje', `Registros vigentes em ${formatDate(overviewTodayIso())}`], ordens_atrasadas: ['Ordens atrasadas', 'Prazo anterior a hoje e status diferente de entregue ou cancelada'], ordens_proximas: ['Ordens nos próximos 7 dias', 'Prazos entre hoje e os próximos sete dias'], contas_vencidas: ['Contas vencidas', 'Lançamentos financeiros com status vencido'], relatorio: [reportTitle || 'Detalhes do indicador', reportSubtitle || 'Registros relacionados ao indicador selecionado'],
  }
  const status = (value?: string | null) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const today = overviewTodayIso()
  const nextWeek = shiftIsoDate(today, 7)
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [kind, reportTitle])
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown) }
  }, [onClose])
  const orders = details?.orders || []
  const orderRows = orders.filter((item) => {
    const value = status(item.status)
    if (kind === 'ordens') return ['recebida', 'em_producao', 'costurada'].includes(value)
    if (kind === 'recebidas') return value === 'recebida'
    if (kind === 'producao') return value === 'em_producao'
    if (kind === 'costuradas') return value === 'costurada'
    if (kind === 'entregues') return value === 'entregue'
    if (kind === 'pagas') return item.status_pagamento === 'pago'
    if (kind === 'ordens_atrasadas') return Boolean(item.prazo && item.prazo.slice(0, 10) < today && !['entregue', 'cancelada'].includes(value))
    if (kind === 'ordens_proximas') return Boolean(item.prazo && item.prazo.slice(0, 10) >= today && item.prazo.slice(0, 10) <= nextWeek && !['entregue', 'cancelada'].includes(value))
    return false
  })
  const currentVacations = (details?.vacations || []).filter((item) => ['agendada', 'em_gozo'].includes(item.status) && (!item.inicio || item.inicio.slice(0, 10) <= today) && (!item.fim || item.fim.slice(0, 10) >= today))
  const currentLeaves = (details?.leaves || []).filter((item) => item.status === 'ativo' && item.inicio.slice(0, 10) <= today && (!item.fim || item.fim.slice(0, 10) >= today))
  const financialRows = (details?.contas || []).filter((item) => status(item.status) === 'vencido' && item.fonte_registro === 'ledger')
  const rows: OverviewQuickModalRow[] = kind === 'relatorio' ? (reportRows || [])
    : kind === 'ferias_hoje' ? [
      ...currentVacations.map((item) => ({ title: item.nome, subtitle: `Férias · ${item.inicio ? formatDate(item.inicio) : 'início não informado'} a ${item.fim ? formatDate(item.fim) : 'sem data final'}`, meta: item.status === 'em_gozo' ? 'Em gozo' : 'Agendada' })),
      ...currentLeaves.map((item) => ({ title: item.nome, subtitle: `Afastamento · ${item.tipo} · ${item.inicio ? formatDate(item.inicio) : 'início não informado'} a ${item.fim ? formatDate(item.fim) : 'sem data final'}`, meta: 'Ativo' })),
    ]
    : kind === 'ordens_atrasadas' || kind === 'ordens_proximas' ? orderRows.map((item) => ({ title: `${item.numero} · ${item.descricao}`, subtitle: `${item.cliente || 'Cliente não informado'} · prazo ${formatDate(item.prazo)}`, meta: item.status }))
      : kind === 'contas_vencidas' ? financialRows.map((item) => ({ title: item.descricao || item.categoria || 'Lançamento sem descrição', subtitle: `${item.tipo === 'receber' ? 'Receita a receber' : 'Despesa a pagar'} · vencimento ${formatDate(item.vencimento)}`, meta: formatMoney(Number(item.valor || 0)) }))
        : kind === 'equipe' ? (details?.employees || []).filter((item) => item.ativo).map((item) => ({ title: item.nome, subtitle: item.cargo || 'Cargo não informado', meta: item.situacao }))
          : kind === 'costura' ? (details?.lots || []).filter((item) => status(item.status).includes('costur')).map((item) => ({ title: `${item.numero} · ${item.descricao}`, subtitle: item.cliente || 'Cliente não informado', meta: `${item.unidades_costuradas}/${item.unidades_solicitadas} unidades` }))
            : kind === 'contas' ? (details?.contas || []).filter((item) => status(item.status).includes('pend') || status(item.status).includes('abert')).map((item) => ({ title: item.descricao || item.categoria || 'Conta sem descrição', subtitle: `${item.tipo === 'receber' ? 'A receber' : 'A pagar'} · vencimento ${formatDate(item.vencimento)}`, meta: formatMoney(Number(item.valor || 0)) }))
              : orderRows.map((item) => ({ title: `${item.numero} · ${item.descricao}`, subtitle: item.cliente || 'Cliente não informado', meta: item.prazo ? `Prazo ${formatDate(item.prazo)}` : `${item.quantidade} peças` }))
  const exactKind = ['ferias_hoje', 'ordens_atrasadas', 'ordens_proximas', 'contas_vencidas'].includes(kind)
  const sourceReady = kind === 'relatorio' ? reportRows !== undefined
    : kind === 'ferias_hoje' ? details?.vacations !== undefined && details?.leaves !== undefined
      : kind === 'ordens_atrasadas' || kind === 'ordens_proximas' ? details?.orders !== undefined
        : kind === 'contas_vencidas' ? details?.contas !== undefined
          : kind === 'equipe' ? details?.employees !== undefined
            : kind === 'costura' ? details?.lots !== undefined
              : kind === 'contas' ? details?.contas !== undefined
                : details?.orders !== undefined
  const consistencyWarning = exactKind && sourceReady && rows.length !== count ? `O indicador mostra ${count}; a consulta detalhada retornou ${rows.length} registro(s). Confira a origem completa no módulo.` : undefined
  const modalWarning = warning || consistencyWarning || (exactKind && !sourceReady ? 'A listagem de origem não foi carregada; os registros não serão inferidos a partir do total.' : undefined)
  const destinations: Record<OverviewQuickModalKind | 'relatorio', ModuleKey> = { equipe: 'funcionarios', ordens: 'ordens', costura: 'producao', contas: 'financeiro', recebidas: 'ordens', producao: 'producao', costuradas: 'producao', entregues: 'ordens', pagas: 'financeiro', ferias_hoje: 'rh', ordens_atrasadas: 'ordens', ordens_proximas: 'ordens', contas_vencidas: 'financeiro', relatorio: 'relatorios' }
  const [title, subtitle] = kind === 'relatorio' ? [reportTitle || titles.relatorio[0], reportSubtitle || titles.relatorio[1]] : titles[kind]
  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const summaryCount = exactKind && sourceReady ? rows.length : rows.length || count
  return <div className="overview-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="overview-detail-modal" role="dialog" aria-modal="true" aria-labelledby="overview-detail-title"><header className="overview-detail-head"><div><span className="eyebrow">Visão geral · registros da fonte</span><h2 id="overview-detail-title">{title}</h2><p>{subtitle}</p></div><button className="overview-detail-close" type="button" onClick={onClose} aria-label="Fechar detalhes"><X size={18} /></button></header><div className="overview-detail-summary"><strong>{summaryCount}</strong><span>{sourceReady ? (summaryCount === 1 ? 'registro retornado' : 'registros retornados') : 'total do indicador · lista indisponível'}</span></div>{modalWarning && <div className="report-inline-error" role="status">{modalWarning}</div>}<div className="overview-detail-list">{!sourceReady ? <div className="overview-detail-empty"><span>Fonte indisponível</span><strong>Os registros não foram carregados.</strong><small>O número do indicador não será apresentado como se fosse a lista filtrada.</small></div> : visibleRows.length ? visibleRows.map((row, index) => <div className="overview-detail-row" key={`${row.title}-${index}`}><span className="overview-detail-index">{String((page - 1) * pageSize + index + 1).padStart(2, '0')}</span><span><strong>{row.title}</strong><small>{row.subtitle}</small></span><b>{row.meta}</b></div>) : <div className="overview-detail-empty"><span>Filtro aplicado</span><strong>Nenhum registro encontrado</strong><small>{exactKind && count > 0 ? 'A lista retornada não corresponde ao total do indicador; veja o aviso acima antes de concluir.' : 'Não há registros que correspondam a este filtro no momento.'}</small></div>}</div>{pageCount > 1 && <div className="overview-detail-pagination"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><ChevronLeft size={14} /> Anterior</button><span>Página {page} de {pageCount}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Próxima <ChevronRight size={14} /></button></div>}<footer className="overview-detail-foot"><span>{sourceReady ? `Exibindo ${rows.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, rows.length)} de ${rows.length}` : '0 registros'}.` : 'A listagem não está disponível.'}</span><div className="overview-detail-actions"><button className="secondary-button" type="button" onClick={() => { onClose(); onOpenSource(destinations[kind]) }}>Abrir no módulo <ChevronRight size={14} /></button><button className="secondary-button" type="button" onClick={onClose}>Fechar</button></div></footer></section></div>
}

function DashboardView({ token, user, onNavigate }: { token: string; user: SessionUser; onNavigate: (key: ModuleKey) => void }) {
  const [state, setState] = useState<{ loading: boolean; refreshing?: boolean; data?: DashboardResponse; periodData?: DashboardPeriodOverviewResponse; periodKey?: string; enrichment?: OverviewReportEnrichment; quickDetails?: OverviewQuickDetails; error?: string; periodError?: string; partialErrors?: string[]; lastUpdated?: string }>({ loading: true })
  const [liveEvents, setLiveEvents] = useState<DashboardLiveEvent[]>([])
  const [liveConnected, setLiveConnected] = useState(false)
  const [liveStatus, setLiveStatus] = useState<DashboardRealtimeStatus>('connecting')
  const [refreshKey, setRefreshKey] = useState(0)
  const [notificationPermission, setNotificationPermission] = useState(getNotificationPermission())
  const [chartMetric, setChartMetric] = useState<'ordens' | 'entregues'>('ordens')
  const [chartRange, setChartRange] = useState<3 | 6>(6)
  const [reportLoading, setReportLoading] = useState(false)
  const [quickGranularity, setQuickGranularity] = useState<'mes' | 'semana'>('mes')
  const [quickAnchor, setQuickAnchor] = useState(() => new Date())
  const [quickModal, setQuickModal] = useState<OverviewQuickModalKind | null>(null)
  const quickReportWindow = (() => {
    const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    if (quickGranularity === 'mes') {
      const start = new Date(quickAnchor.getFullYear(), quickAnchor.getMonth(), 1)
      const end = new Date(quickAnchor.getFullYear(), quickAnchor.getMonth() + 1, 0)
      return { start: iso(start), end: iso(end), label: start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }
    }
    const monday = new Date(quickAnchor.getFullYear(), quickAnchor.getMonth(), quickAnchor.getDate() - ((quickAnchor.getDay() + 6) % 7))
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
    return { start: iso(monday), end: iso(sunday), label: `${monday.toLocaleDateString('pt-BR')} a ${sunday.toLocaleDateString('pt-BR')}` }
  })()
  const today = new Date()
  const currentWindow = quickGranularity === 'mes'
    ? quickReportWindow.start === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    : quickReportWindow.start === (() => { const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7)); return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}` })()
  const quickReportLabel = `${quickGranularity === 'mes' ? currentWindow ? 'Mês atual' : 'Mês selecionado' : currentWindow ? 'Semana atual' : 'Semana selecionada'} · ${quickReportWindow.label}`
  const shiftQuickWindow = (direction: number) => setQuickAnchor((current) => quickGranularity === 'mes' ? new Date(current.getFullYear(), current.getMonth() + direction, 1) : new Date(current.getFullYear(), current.getMonth(), current.getDate() + direction * 7))
  const periodRows = state.periodData?.sucesso ? buildPeriodOverviewRows(state.periodData) : []
  useEffect(() => {
    let active = true
    let requestSequence = 0
    let refreshTimer: number | undefined
    const periodKey = `${quickReportWindow.start}|${quickReportWindow.end}`

    async function loadOverview() {
      const requestId = ++requestSequence
      setState((current) => ({
        ...current,
        loading: !current.data,
        refreshing: true,
        error: undefined,
        periodError: undefined,
        periodData: current.periodKey === periodKey ? current.periodData : undefined,
        partialErrors: [],
      }))
      try {
        const rawData = await dashboard(token)
        if (!rawData.sucesso) throw new Error(rawData.erro || 'Não foi possível carregar a visão geral.')
        const data = adminProfiles.includes(user.perfil) ? rawData : redactOperationalDashboard(rawData)
        const enrichment: OverviewReportEnrichment = {}
        const quickDetails: OverviewQuickDetails = {}
        const partialErrors: string[] = []
        let periodData: DashboardPeriodOverviewResponse | undefined
        let periodError: string | undefined

        const accepted = <T,>(label: string, result: PromiseSettledResult<T>, requireSuccess = false): T | undefined => {
          if (result.status === 'rejected') { partialErrors.push(label); return undefined }
          const value = result.value
          if (requireSuccess && typeof value === 'object' && value !== null && 'sucesso' in value && value.sucesso === false) {
            partialErrors.push(label)
            return undefined
          }
          return value
        }

        if (user.perfil !== 'funcionario') {
          const isAdmin = adminProfiles.includes(user.perfil)
          const [employeesResult, periodResult] = await Promise.allSettled([
            listEmployees(token),
            dashboardPeriod(token, quickReportWindow.start, quickReportWindow.end),
          ])
          const employees = accepted('Equipe', employeesResult) as EmployeeRow[] | undefined
          if (employees) quickDetails.employees = employees
          const period = accepted('Movimento no período', periodResult, true) as DashboardPeriodOverviewResponse | undefined

          if (isAdmin) {
            const [productionResult, ordersResult, agreementsResult, debtsResult, financeResult, vacationsResult, leavesResult] = await Promise.allSettled([
              getFactoryProduction(token),
              listOrders(token),
              listAgreements(token),
              managedDebts(token),
              adminFinanceiroWorkspace(token),
              adminVacations(token),
              adminLeaves(token),
            ])
            const production = accepted('Produção detalhada', productionResult, true) as Awaited<ReturnType<typeof getFactoryProduction>> | undefined
            const orders = accepted('Ordens', ordersResult, true) as Awaited<ReturnType<typeof listOrders>> | undefined
            const agreements = accepted('Acordos', agreementsResult, true) as Awaited<ReturnType<typeof listAgreements>> | undefined
            const debts = accepted('Dívidas', debtsResult, true) as Awaited<ReturnType<typeof managedDebts>> | undefined
            const finance = accepted('Contas do financeiro', financeResult, true) as Awaited<ReturnType<typeof adminFinanceiroWorkspace>> | undefined
            const vacations = accepted('Férias', vacationsResult, true) as Awaited<ReturnType<typeof adminVacations>> | undefined
            const leaves = accepted('Afastamentos', leavesResult, true) as Awaited<ReturnType<typeof adminLeaves>> | undefined
            if (production?.sucesso) { enrichment.production = production.resumo; quickDetails.lots = production.lotes }
            if (agreements?.sucesso) enrichment.agreements = agreements.parcelas
            if (debts?.sucesso) enrichment.debts = debts.dividas
            if (orders?.sucesso) quickDetails.orders = orders.ordens
            if (finance?.sucesso) quickDetails.contas = finance.contas
            if (vacations?.sucesso) quickDetails.vacations = vacations.ferias
            if (leaves?.sucesso) quickDetails.leaves = leaves.afastamentos
          }

          const periodHasPeopleData = period?.ponto && period.inconsistencias_ponto && period.ausencias
          if (period?.sucesso && periodHasPeopleData && (!isAdmin || (period.financeiro && period.ordens && period.producao))) {
            periodData = isAdmin ? period : { ...period, financeiro: undefined, ordens: undefined, producao: undefined }
          }
          else periodError = period?.erro || 'O resumo do período veio incompleto; os números não serão apresentados como zero.'
        }

        if (!active || requestId !== requestSequence) return
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          data,
          periodData,
          periodKey,
          periodError,
          enrichment: { ...current.enrichment, ...enrichment },
          quickDetails: { ...current.quickDetails, ...quickDetails },
          error: undefined,
          partialErrors,
          lastUpdated: partialErrors.length === 0 && !periodError ? new Date().toISOString() : current.lastUpdated,
        }))
      } catch (err) {
        if (!active || requestId !== requestSequence) return
        const message = err instanceof Error ? err.message : 'Erro desconhecido ao carregar a visão geral.'
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: message,
          periodError: message,
          periodData: current.periodKey === periodKey ? current.periodData : undefined,
          periodKey,
        }))
      }
    }

    void loadOverview()
    const unsubscribe = subscribeDashboardRealtime((event) => {
      setLiveEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 5))
      showDashboardNotification(event)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => { void loadOverview() }, 700)
    }, (status) => {
      if (!active) return
      setLiveStatus(status)
      setLiveConnected(status === 'subscribed')
    }, adminProfiles.includes(user.perfil))
    return () => {
      active = false
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [token, user.perfil, quickReportWindow.start, quickReportWindow.end, refreshKey])
  async function enableNotifications() {
    const permission = await requestNotificationPermission()
    setNotificationPermission(permission)
  }
  function exportCsv() {
    if (state.periodData) downloadPeriodOverviewCsv(reportRows, user, quickReportLabel)
  }
  async function exportPdf() {
    if (!state.periodData) return
    setReportLoading(true)
    try { await exportPeriodOverviewPdf(reportRows, user, quickReportLabel) } finally { setReportLoading(false) }
  }
  if (state.loading) return <LoadingState label="Preparando seu painel de atenção…" />
  if ((state.error && !state.data) || !state.data?.sucesso) return <><ErrorState message={state.error || state.data?.erro || 'Sessão inválida'} /><button className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Tentar novamente</button></>
  const data = state.data; const isEmployee = user.perfil === 'funcionario'; const isAdmin = adminProfiles.includes(user.perfil); const indicators = data.indicadores!; const personal = data.pessoal || {}; const rawAlerts = data.alertas || []; const alerts = rawAlerts.filter((alert) => alert.valor > 0 && alert.id !== 'ordens-prazo'); const funnel: DashboardResponse['funil'] = data.funil; const intelligence = data.inteligencia || {}; const agenda = (intelligence.agenda || []).filter((item) => item.id !== 'ordens-prazo'); const evolution = intelligence.evolucao || []; const maxEvolution = Math.max(1, ...evolution.flatMap((point) => [point.ordens, point.entregues]));
  const reportRows = isAdmin ? periodRows : periodRows.filter((item) => !['Financeiro', 'Produção', 'Dívidas', 'Acordos'].includes(item.grupo))
  const reportGroups = ['Financeiro', 'Produção', 'Pessoas'].map((group) => ({ group, rows: reportRows.filter((item) => item.grupo === group) })).filter((item) => item.rows.length)
  const reportDestination = (module: string): ModuleKey => module === 'dividas' ? 'dividas' : module === 'acordos' ? 'acordos' : module === 'rh' || module === 'afastamentos' ? 'rh' : module === 'producao' ? 'producao' : module === 'ponto' ? 'ponto' : module === 'ordens' ? 'ordens' : 'financeiro'
  const filteredEvolution = evolution.slice(-Math.min(chartRange, 6))
  const alertDestination = (value: string) => ['financeiro','ordens','producao','rh','importacoes'].includes(value) ? value as ModuleKey : 'dashboard'
  const quickModalCounts: Record<OverviewQuickModalKind, number> = { equipe: indicators.funcionarios_ativos, ordens: indicators.ordens_ativas, costura: indicators.lotes_em_costura, contas: indicators.contas_pendentes, recebidas: funnel?.recebidas || 0, producao: funnel?.em_producao || 0, costuradas: funnel?.costuradas || 0, entregues: funnel?.entregues || 0, pagas: funnel?.pagas || 0, ferias_hoje: (indicators.em_ferias || 0) + (indicators.em_afastamento || 0), ordens_atrasadas: intelligence.operacao?.ordens_atrasadas || 0, ordens_proximas: intelligence.operacao?.ordens_proximas || 0, contas_vencidas: intelligence.financeiro?.vencidas_qtd || 0 }
  const liveStatusLabel = liveStatus === 'subscribed' ? 'Atualização automática conectada' : liveStatus === 'error' ? 'Realtime indisponível · atualize manualmente' : liveStatus === 'closed' ? 'Atualização automática pausada' : 'Conectando ao painel…'
  const openReportDetails = (item: OverviewReportRow) => onNavigate(reportDestination(item.modulo))
  const renderPeriodRow = (item: OverviewReportRow) => <button type="button" key={`${item.grupo}-${item.indicador}`} onClick={() => openReportDetails(item)}><span><strong>{item.indicador}</strong><small>{item.contexto}</small></span><b className={`is-${item.status}`}>{item.valor}</b><ChevronRight size={14} /></button>
  return <div className={`overview-page ${isEmployee ? 'is-personal' : 'is-executive'}`}>
    {state.error && state.data && <div className="overview-data-warning" role="status"><AlertTriangle size={16} /><span>Não foi possível atualizar o painel principal: {state.error}. Os últimos dados carregados continuam visíveis.</span></div>}
    {!!state.partialErrors?.length && <div className="overview-data-warning" role="status"><AlertTriangle size={16} /><span>Atualização parcial. Não foi possível consultar: {state.partialErrors.join(', ')}. As métricas afetadas não são apresentadas como zero.</span></div>}
    {isEmployee && <div className="overview-welcome"><div><span className="eyebrow">Seu painel pessoal</span><h2>Tudo o que depende de você, em um só lugar.</h2><p>Consulte sua jornada, acompanhe documentos e mantenha suas solicitações em dia.</p></div><div className="overview-welcome-symbol"><Gauge size={32}/></div></div>}
    <div className="metric-grid overview-metrics">{isEmployee ? <><MetricCard label="Ponto a revisar" value={personal.ponto_sem_justificativa || 0} detail="Registros sem justificativa" tone="gold" onClick={() => onNavigate('ponto')} /><MetricCard label="Atestados" value={personal.atestados_em_analise || 0} detail="Em análise pelo RH" tone="gold" onClick={() => onNavigate('atestados')} /><MetricCard label="Solicitações" value={personal.solicitacoes_abertas || 0} detail="Pedidos em aberto" tone="gold" onClick={() => onNavigate('solicitacoes')} /><MetricCard label="Avisos novos" value={personal.avisos_nao_lidos || 0} detail="Comunicados não lidos" tone="blue" onClick={() => onNavigate('avisos')} /></> : <><MetricCard label="Férias e afastamentos" value={quickModalCounts.ferias_hoje} detail={`${indicators.em_ferias || 0} em férias · ${indicators.em_afastamento || 0} afastamento(s) hoje`} tone={quickModalCounts.ferias_hoje ? 'gold' : 'green'} onClick={() => setQuickModal('ferias_hoje')} /><MetricCard label="Ordens atrasadas" value={quickModalCounts.ordens_atrasadas} detail="Prazo anterior a hoje" tone={quickModalCounts.ordens_atrasadas ? 'pink' : 'green'} onClick={() => setQuickModal('ordens_atrasadas')} /><MetricCard label="Ordens nos próximos 7 dias" value={quickModalCounts.ordens_proximas} detail="Planeje capacidade e entrega" tone={quickModalCounts.ordens_proximas ? 'gold' : 'green'} onClick={() => setQuickModal('ordens_proximas')} /><MetricCard label="Contas vencidas" value={quickModalCounts.contas_vencidas} detail="Lançamentos com status vencido" tone={quickModalCounts.contas_vencidas ? 'pink' : 'green'} onClick={() => setQuickModal('contas_vencidas')} /></>}</div>
    <div className="overview-main-grid"><SectionCard title={isEmployee ? 'Pendências pessoais' : 'Alertas prioritários'} caption={isEmployee ? 'Resolva o que pode bloquear sua rotina' : `${alerts.length} alerta(s) com ocorrência ativa`}><div className="overview-alert-list">{isEmployee ? <><button className="overview-alert-item is-attention" onClick={() => onNavigate('ponto')}><span><Fingerprint size={18}/></span><div><strong>{personal.ponto_sem_justificativa || 0} registro(s) de ponto precisam de revisão</strong><small>Confira sua jornada e envie justificativa quando necessário.</small></div><ChevronRight size={16}/></button><button className="overview-alert-item is-info" onClick={() => onNavigate('atestados')}><span><HeartPulse size={18}/></span><div><strong>{personal.atestados_em_analise || 0} atestado(s) em análise</strong><small>Acompanhe o status dos documentos enviados ao RH.</small></div><ChevronRight size={16}/></button><button className="overview-alert-item is-success" onClick={() => onNavigate('solicitacoes')}><span><FileCheck2 size={18}/></span><div><strong>{personal.solicitacoes_abertas || 0} solicitação(ões) em aberto</strong><small>Veja respostas ou complemente seus pedidos.</small></div><ChevronRight size={16}/></button></> : alerts.length === 0 ? <EmptyState title="Nenhuma exceção ativa" description="Não há alertas com ocorrências no momento. Indicadores sem ocorrências não são repetidos nesta lista." /> : alerts.map((alert) => <button className={`overview-alert-item is-${alert.prioridade}`} key={alert.id} onClick={() => onNavigate(alertDestination(alert.destino))}><span>{alert.prioridade === 'urgente' ? <AlertCircle size={18}/> : alert.destino === 'producao' ? <Factory size={18}/> : alert.destino === 'financeiro' ? <CircleDollarSign size={18}/> : <ShieldCheck size={18}/>}</span><div><strong>{alert.titulo} <b>{alert.valor}</b></strong><small>{alert.detalhe}</small></div><ChevronRight size={16}/></button>)}</div></SectionCard><SectionCard title={isEmployee ? 'Acesso rápido' : 'Agenda dos próximos 7 dias'} caption={isEmployee ? 'Atalhos para sua rotina' : 'Prazos e movimentos que merecem planejamento'}>{isEmployee ? <div className="overview-summary-list"><button onClick={() => onNavigate('ponto')}><Fingerprint size={17}/><span><strong>Minha jornada</strong><small>Registros, atrasos e justificativas</small></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('avisos')}><Bell size={17}/><span><strong>Avisos da empresa</strong><small>{personal.avisos_nao_lidos || 0} comunicado(s) aguardando leitura</small></span><ChevronRight size={15}/></button><button onClick={() => onNavigate('holerites')}><Receipt size={17}/><span><strong>Comprovantes</strong><small>{personal.holerites_disponiveis || 0} holerite(s) disponíveis</small></span><ChevronRight size={15}/></button></div> : <div className="overview-agenda">{agenda.length === 0 ? <EmptyState title="Agenda sem pendências" description="Não há vencimentos ou marcos nos próximos sete dias." /> : agenda.map((item) => <button key={item.id} onClick={() => onNavigate(item.destino)}><span className={`overview-agenda-dot is-${item.prioridade}`} /><span><strong>{item.titulo}</strong><small>{item.detalhe}</small></span><b>{item.valor}</b><ChevronRight size={15}/></button>)}</div>}</SectionCard></div>
    {!isEmployee && <details className="overview-quick-report overview-period-details">
      <summary className="overview-period-summary"><span className="overview-period-summary-copy"><span className="eyebrow">ANÁLISE COMPLEMENTAR</span><strong>Movimentação por período</strong><small>Consulte caixa, produção e pessoas em uma janela específica.</small></span><span className="overview-period-summary-action">Abrir análise <ChevronDown size={17} /></span></summary><div className="overview-period-content"><div className="overview-quick-report-heading">
        <div><span className="eyebrow">PERÍODO SELECIONADO</span><h2>Indicadores do período</h2><p>Selecione a janela e aprofunde os dados por área.</p></div>
        <div className="overview-quick-report-controls">
          <select value={quickGranularity} onChange={(event) => { setQuickGranularity(event.target.value as typeof quickGranularity); setQuickAnchor(new Date()) }} aria-label="Granularidade do período"><option value="mes">Por mês</option><option value="semana">Por semana</option></select>
          <div className="overview-quick-report-navigation"><button type="button" onClick={() => shiftQuickWindow(-1)} aria-label="Período anterior"><ChevronLeft size={14} /></button><span>{quickReportWindow.label}</span><button type="button" onClick={() => shiftQuickWindow(1)} aria-label="Próximo período"><ChevronRight size={14} /></button></div>
          <div className="overview-report-actions"><button type="button" onClick={exportCsv} disabled={!state.periodData}><Download size={14} /> CSV</button><button type="button" onClick={() => void exportPdf()} disabled={!state.periodData || reportLoading}><FileText size={14} /> {reportLoading ? 'Gerando…' : 'PDF'}</button></div>
        </div>
      </div>
      {state.periodError ? <div className="overview-data-warning" role="alert"><AlertTriangle size={16} /><span>Não foi possível gerar o resumo de {quickReportWindow.label}: {state.periodError}</span><button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={state.refreshing}><RefreshCw size={14} /> Tentar novamente</button></div> : !state.periodData ? <LoadingState label={`Consultando dados de ${quickReportWindow.label}…`} /> : <>
        {state.refreshing && <div className="overview-period-refreshing"><RefreshCw size={14} className="spin" /> Atualizando o período…</div>}
        {state.lastUpdated && <p className="overview-period-updated">Dados completos atualizados em {new Date(state.lastUpdated).toLocaleString('pt-BR')}.</p>}
        <div className="overview-quick-report-grid">{reportGroups.map(({ group, rows }) => <article className="overview-quick-report-card" key={group}><div className="overview-quick-report-card-heading"><strong>{group}</strong><small>{rows.length} indicador(es)</small></div><div className="overview-quick-report-list">{rows.slice(0, 2).map(renderPeriodRow)}{rows.length > 2 && <details className="overview-more-indicators"><summary>Ver mais {rows.length - 2} indicadores</summary><div className="overview-quick-report-list">{rows.slice(2).map(renderPeriodRow)}</div></details>}</div></article>)}</div>
        <p className="overview-period-footnote">{isAdmin ? 'Financeiro usa baixa/vencimento no intervalo; ordens usam data de entrada; produção usa eventos fabris (incluindo ajustes); férias e afastamentos contam períodos sobrepostos.' : 'Ponto usa registros no período; férias e afastamentos contam períodos sobrepostos.'}</p>
      </>}
    </div></details>}
    <SectionCard title="Alertas em tempo real" caption={liveEvents.length ? `${liveEvents.length} atualização(ões) recebida(s) nesta sessão` : 'As próximas alterações importantes aparecerão aqui'}><div className="overview-live-events"><div className="overview-live-events-controls"><span className="overview-live-status"><span className={`overview-live-dot ${liveConnected ? 'is-connected' : ''}`} /><Radio size={14} /> {liveStatusLabel}</span>{state.lastUpdated && <span className="overview-updated-at">Atualizado {new Date(state.lastUpdated).toLocaleString('pt-BR')}</span>}<div className="overview-live-actions"><button type="button" className="overview-refresh-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={state.refreshing}><RefreshCw size={14} className={state.refreshing ? 'spin' : ''} /> {state.refreshing ? 'Atualizando…' : 'Atualizar agora'}</button><button type="button" className="overview-notification-button" onClick={() => void enableNotifications()} disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'}>{notificationPermission === 'granted' ? <BellRing size={15} /> : <BellOff size={15} />} {notificationPermission === 'granted' ? 'Notificações ativas' : notificationPermission === 'denied' ? 'Notificações bloqueadas' : 'Ativar notificações'}</button></div></div>{liveEvents.length === 0 ? <div className="overview-live-empty"><Radio size={17} /><span><strong>Monitoramento ativo</strong><small>{isAdmin ? 'Novas movimentações de financeiro, ordens, produção, RH e ponto serão sinalizadas sem recarregar a página.' : 'Novas movimentações de financeiro, RH e ponto serão sinalizadas sem recarregar a página.'}</small></span></div> : liveEvents.map((event) => <button key={event.id} onClick={() => onNavigate(event.destination)}><span className={`overview-live-event-icon is-${event.priority}`}><BellRing size={15} /></span><span><strong>{event.title}</strong><small>{event.detail}</small></span><time>{new Date(event.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><ChevronRight size={15} /></button>)}</div></SectionCard>
    {isAdmin && <>
      <div className="overview-stage2-grid overview-stage2-chart-only"><SectionCard title="Evolução dos últimos meses" caption="Explore o volume por métrica e período"><div className="overview-chart-controls"><div className="overview-segmented"><button className={chartMetric === 'ordens' ? 'is-active' : ''} onClick={() => setChartMetric('ordens')}>Recebidas</button><button className={chartMetric === 'entregues' ? 'is-active' : ''} onClick={() => setChartMetric('entregues')}>Entregues</button></div><div className="overview-segmented overview-segmented-small"><button className={chartRange === 3 ? 'is-active' : ''} onClick={() => setChartRange(3)}>3M</button><button className={chartRange === 6 ? 'is-active' : ''} onClick={() => setChartRange(6)}>6M</button></div></div><div className="overview-interactive-chart">{filteredEvolution.map((point) => { const value = point[chartMetric]; const maxVisible = Math.max(1, ...filteredEvolution.map((item) => item[chartMetric])); return <button className="overview-chart-column" key={point.periodo} title={`${point.periodo}: ${value} ${chartMetric === 'ordens' ? 'recebidas' : 'entregues'}`}><span className="overview-chart-value">{value}</span><span className={`overview-chart-bar is-${chartMetric}`} style={{ height: `${Math.max(5, value / maxVisible * 100)}%` }} /><small>{point.periodo}</small></button> })}</div><div className="overview-trend-legend"><span><i className={`is-${chartMetric}`} /> {chartMetric === 'ordens' ? 'Ordens recebidas' : 'Ordens entregues'}</span><span className="overview-chart-help">Passe o cursor para ver detalhes</span></div></SectionCard></div>
      <div className="overview-stage2-lower overview-stage2-single"><SectionCard title="Pendências por área" caption="Concentração de itens que pedem acompanhamento"><div className="overview-area-list">{([['financeiro','Financeiro','financeiro'],['operacao','Operação','ordens'],['producao','Produção','producao'],['rh','Pessoas','funcionarios']] as const).map(([key, label, destination]) => <button className={(intelligence.pendencias_area?.[key] || 0) > 0 ? 'is-pending' : 'is-clear'} key={key} onClick={() => onNavigate(destination as ModuleKey)}><span><strong>{label}</strong><small>{intelligence.pendencias_area?.[key] || 0} pendência(s)</small></span><div><i style={{ width: `${Math.min(100, ((intelligence.pendencias_area?.[key] || 0) / Math.max(1, ...Object.values(intelligence.pendencias_area || {}))) * 100)}%` }} /></div><ChevronRight size={15}/></button>)}</div></SectionCard></div>
    </>}
    {isAdmin && <>
      <SectionCard title="Funil operacional" caption="Acompanhe onde as ordens estão concentradas hoje">
        <div className="overview-funnel">{([['recebidas','Recebidas','recebidas'],['em_producao','Em produção','producao'],['costuradas','Costuradas','costuradas'],['entregues','Entregues','entregues'],['pagas','Pagas','pagas']] as const).map(([key, label, modal], index) => <button key={key} className="overview-funnel-step" onClick={() => setQuickModal(modal)}><span className="overview-funnel-index">0{index + 1}</span><span className="overview-funnel-copy"><small>{label}</small><strong>{funnel?.[key] || 0}</strong></span>{index < 4 && <ChevronRight className="overview-funnel-arrow" size={16} />}</button>)}</div>
      </SectionCard>

    </>}

    {quickModal ? <OverviewQuickModal kind={quickModal} details={state.quickDetails} count={quickModalCounts[quickModal]} warning={state.error ? `Falha na atualização principal: ${state.error}. A lista pode estar desatualizada.` : state.partialErrors?.length ? `Atualização parcial: ${state.partialErrors.join(", ")}. A lista pode estar incompleta.` : undefined} onClose={() => setQuickModal(null)} onOpenSource={onNavigate} /> : null}
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
  const [passwordCurrent, setPasswordCurrent] = useState('')
  const [passwordNew, setPasswordNew] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  useEffect(() => {
    let cancelled = false
    myProfile(token).then((data) => {
      if (!data.sucesso || !data.funcionario) throw new Error(data.erro || 'Falha de sessão')
      if (!cancelled) { setProfile(data.funcionario); onProfileUpdated(data.funcionario) }
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Falha de consulta') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, onProfileUpdated])

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

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordError(''); setPasswordSuccess('')
    if (passwordNew.length < 8) { setPasswordError('A nova senha deve ter pelo menos 8 caracteres.'); return }
    if (passwordNew !== passwordConfirm) { setPasswordError('A confirmação não corresponde à nova senha.'); return }
    try {
      const result = await changePassword(token, passwordCurrent, passwordNew)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível alterar a senha.')
      setPasswordCurrent(''); setPasswordNew(''); setPasswordConfirm('')
      setPasswordSuccess('Senha alterada. Use a nova senha no próximo acesso.')
    } catch (err) { setPasswordError(err instanceof Error ? err.message : 'Falha ao alterar a senha.') }
  }

  const profileFields = profile as unknown as Record<string, unknown> | undefined
  return <>
    <PageHeading eyebrow="Minha área · cadastro" title="Meu perfil" description="Consulte sua ficha funcional completa, solicite correções e proteja seu acesso." />
    {loading ? <LoadingState /> : error && !profile ? <ErrorState message={error} /> : profile ? <div className="profile-layout">
      <SectionCard title={profile.nome} caption={`${profile.cargo || 'Cargo não informado'} · ${profile.tipo_vinculo || 'Vínculo não informado'}`}>
        <div className="profile-identity"><UserAvatar name={profile.nome} url={profile.avatar_url} className="profile-avatar" /><div><strong>Foto do perfil</strong><span>JPG, PNG ou WebP · até 800 KB</span><div className="profile-avatar-actions"><label className="secondary-button">{savingAvatar ? <RefreshCw className="spin" size={15} /> : <Upload size={15} />} {profile.avatar_url ? 'Trocar foto' : 'Adicionar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={savingAvatar} onChange={(event) => { void changeAvatar(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>{profile.avatar_url && <button className="text-button" type="button" onClick={() => void removeAvatar()} disabled={savingAvatar}>Remover</button>}</div></div></div>
        {error && <div className="form-error profile-error"><AlertCircle size={16} />{error}</div>}
        <div className="detail-grid"><div><span>Situação</span><strong><StatusPill value={profile.ativo ? 'Ativo' : 'Inativo'} /></strong></div><div><span>Tipo de vínculo</span><strong>{profile.tipo_vinculo || 'Não informado'}</strong></div><div><span>CPF</span><strong>{maskCpf(profile.cpf)}</strong></div></div>
      </SectionCard>
      <SectionCard title="Ficha funcional completa" caption="Dados apresentados conforme o cadastro mantido pelo RH. Para corrigir informações, envie uma solicitação ao RH.">
        <div className="employee-ficha-groups own-profile-ficha">{fieldGroups.map((group) => <details className="employee-ficha-group" key={group.title} open={group.title.includes('Identificação') || group.title.includes('Vínculo')}><summary>{group.title}</summary><div className="employee-ficha-grid">{group.fields.map((field) => <div className={`employee-ficha-value${field.kind === 'textarea' ? ' is-wide' : ''}`} key={field.key}><span>{field.label}</span><strong>{displayValue(field, profileFields?.[field.key])}</strong></div>)}</div></details>)}</div>
      </SectionCard>
      <SectionCard title="Trocar senha" caption="Disponível a qualquer momento, não apenas no primeiro acesso. Sua senha atual é validada pelo servidor.">
        <form className="employee-password-form" onSubmit={(event) => void submitPassword(event)}>
          <label>Senha atual<input type="password" autoComplete="current-password" required value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} /></label>
          <label>Nova senha<input type="password" autoComplete="new-password" minLength={8} required value={passwordNew} onChange={(event) => setPasswordNew(event.target.value)} /></label>
          <label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={8} required value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>
          {passwordError ? <div className="form-error" role="alert">{passwordError}</div> : null}
          {passwordSuccess ? <div className="form-success" role="status">{passwordSuccess}</div> : null}
          <button className="primary-button" type="submit">Alterar senha</button>
        </form>
      </SectionCard>
    </div> : null}
  </>
}

function PointView({ token, user, refreshSignal = 0 }: { token: string; user: SessionUser; refreshSignal?: number }) {
  const isAdministrative = user.perfil === 'admin' || user.perfil === 'administrador' || user.perfil === 'gestor'
  const [rows, setRows] = useState<PointRow[]>([])
  const [loadedPointKey, setLoadedPointKey] = useState('')
  const [employeePage, setEmployeePage] = useState<EmployeeSearchPage | null>(null)
  const [employeeOffset, setEmployeeOffset] = useState(0)
  const [employeeSearchInput, setEmployeeSearchInput] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [employeeSearchKey, setEmployeeSearchKey] = useState(0)
  const [employeeLoading, setEmployeeLoading] = useState(false)
  const [employeeError, setEmployeeError] = useState('')
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'previous_month' | 'custom'>('month')
  const [employeeId, setEmployeeId] = useState('')
  const [scheduleAssignments, setScheduleAssignments] = useState<PointScheduleAssignment[]>([])
  const [monthReference, setMonthReference] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
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
  const [selectedPointDayId, setSelectedPointDayId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const pointReviewDialogRef = useRef<HTMLDivElement | null>(null)
  const pointConfirmDialogRef = useRef<HTMLDivElement | null>(null)
  const pointDayDialogRef = useRef<HTMLDivElement | null>(null)
  const pointDialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const pointConfirmReturnFocusRef = useRef<HTMLElement | null>(null)
  const pointDialogStateRef = useRef<'review' | 'confirm' | 'day' | null>(null)
  const activePointDialog = pendingAction ? 'confirm' : reviewModalRow ? 'review' : selectedPointDayId ? 'day' : null
  pointDialogStateRef.current = activePointDialog

  function rememberPointDialogFocus() {
    if (!pointDialogReturnFocusRef.current && document.activeElement instanceof HTMLElement) pointDialogReturnFocusRef.current = document.activeElement
  }

  useEffect(() => {
    if (!activePointDialog) return
    rememberPointDialogFocus()
    const dialog = activePointDialog === 'confirm' ? pointConfirmDialogRef.current : activePointDialog === 'day' ? pointDayDialogRef.current : pointReviewDialogRef.current
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(selector)) : []
    const confirmTrigger = activePointDialog === 'review' ? pointConfirmReturnFocusRef.current : null
    const triggerIsDisabled = confirmTrigger && 'disabled' in confirmTrigger && Boolean((confirmTrigger as HTMLButtonElement).disabled)
    if (confirmTrigger?.isConnected && !triggerIsDisabled) confirmTrigger.focus()
    else focusables[0]?.focus()
    if (activePointDialog === 'review') pointConfirmReturnFocusRef.current = null
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (activePointDialog === 'confirm') setPendingAction(null)
        else if (activePointDialog === 'review') setReviewModalRow(null)
        else setSelectedPointDayId('')
        return
      }
      if (event.key !== 'Tab') return
      const currentFocusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter((element) => !('disabled' in element && Boolean((element as HTMLButtonElement).disabled))) : []
      if (!currentFocusables.length) { event.preventDefault(); dialog?.focus(); return }
      const first = currentFocusables[0]
      const last = currentFocusables[currentFocusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!dialog?.contains(document.activeElement) || !currentFocusables.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
    }
    document.addEventListener('keydown', handleDialogKeys)
    return () => {
      document.removeEventListener('keydown', handleDialogKeys)
      if (pointDialogStateRef.current === null) {
        pointDialogReturnFocusRef.current?.focus()
        pointDialogReturnFocusRef.current = null
        pointConfirmReturnFocusRef.current = null
      }
    }
  }, [activePointDialog])

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
  const targetEmployeeId = isAdministrative ? employeeId : user.funcionario_id
  const pointRequestKey = [targetEmployeeId || '', period, range.inicio || '', range.fim || '', customStart, customEnd, refreshSignal, refreshKey, isAdministrative ? employeeSearch : '', isAdministrative ? employeeOffset : '', isAdministrative ? employeeSearchKey : ''].join('|')

  useEffect(() => { setSelectedPointDayId('') }, [pointRequestKey])

  useEffect(() => {
    if (!isAdministrative) return
    let cancelled = false
    setEmployeeLoading(true)
    setEmployeeError('')
    setEmployeePage(null)
    setEmployeeId('')
    searchEmployees(token, { busca: employeeSearch || undefined, offset: employeeOffset, limite: 1 })
      .then((result) => {
        if (!result.sucesso) throw new Error(result.erro || 'Falha ao buscar funcionários.')
        if (cancelled) return
        setEmployeePage(result)
        setEmployeeId(result.registros?.[0]?.id || '')
      })
      .catch((cause) => {
        if (cancelled) return
        setEmployeePage(null)
        setEmployeeError(cause instanceof Error ? cause.message : 'Falha ao buscar funcionários.')
      })
      .finally(() => { if (!cancelled) setEmployeeLoading(false) })
    return () => { cancelled = true }
  }, [token, isAdministrative, employeeSearch, employeeOffset, employeeSearchKey])

  useEffect(() => {
    if (!targetEmployeeId || (period === 'custom' && (!customStart || !customEnd))) { setLoading(false); setRows([]); setScheduleAssignments([]); setLoadedPointKey(''); setError(''); return }
    let cancelled = false
    setLoading(true); setError(''); setRows([]); setLoadedPointKey(''); setScheduleAssignments([])
    const pointRequest = listPoint(token, { inicio: range.inicio, fim: range.fim, funcionarioId: targetEmployeeId, limite: 1000 })
    const scheduleRequest = isAdministrative
      ? listEmployeePointSchedules(token, targetEmployeeId, range.inicio || undefined, range.fim || undefined)
      : Promise.resolve(null)
    Promise.all([pointRequest, scheduleRequest])
      .then(([data, scheduleResult]) => {
        if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta')
        if (isAdministrative && scheduleResult && !scheduleResult.sucesso) throw new Error(scheduleResult.erro || 'Falha ao consultar a jornada configurada.')
        if (!cancelled) { setRows(data.registros || []); setScheduleAssignments(scheduleResult?.atribuicoes || []); setLoadedPointKey(pointRequestKey) }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Falha de consulta') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, user.funcionario_id, targetEmployeeId, isAdministrative, period, range.inicio, range.fim, customStart, customEnd, refreshKey, pointRequestKey])

  const employees = employeePage?.registros || []
  const employeeCount = employeePage?.total || 0
  const selectedEmployee = employees[0]
  const displayRows = useMemo(() => {
    if (!range.inicio || !range.fim || loadedPointKey !== pointRequestKey) return []
    const recordsByDate = new Map(rows.map((row) => [row.data.slice(0, 10), row]))
    const start = new Date(`${range.inicio}T00:00:00`)
    const end = new Date(`${range.fim}T00:00:00`)
    const result: PointRow[] = []
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      result.push(recordsByDate.get(date) || { id: `sem-registro-${date}`, funcionario_id: isAdministrative ? employeeId : user.funcionario_id, data: date, entrada: null, saida_almoco: null, volta_almoco: null, saida: null, horas_trabalhadas: null, status: null })
    }
    return result
  }, [rows, range.inicio, range.fim, isAdministrative, employeeId, user.funcionario_id, loadedPointKey, pointRequestKey])
  const selectedEmployeeIndex = employees.length ? employeeOffset : -1
  const invalidateEmployeeSelection = () => {
    setEmployeePage(null)
    setEmployeeId('')
    setRows([])
    setScheduleAssignments([])
    setLoadedPointKey('')
    setLoading(true)
    setError('')
    setEmployeeError('')
  }
  const moveEmployee = (direction: -1 | 1) => {
    const nextIndex = employeeOffset + direction
    if (nextIndex >= 0 && nextIndex < employeeCount) {
      invalidateEmployeeSelection()
      setEmployeeLoading(true)
      setEmployeeOffset(nextIndex)
    }
  }
  const scheduleForDate = (date: string) => {
    const dateKey = date.slice(0, 10)
    const assignment = scheduleAssignments.find((item) => item.vigencia_inicio <= dateKey && (!item.vigencia_fim || item.vigencia_fim >= dateKey))
    if (!assignment) return null
    const cursor = new Date(`${dateKey}T12:00:00`)
    const weekday = cursor.getDay() || 7
    const day = assignment.dias_semana?.[String(weekday)]
    if (!day?.ativo) return { expectedMinutes: 0, isWorkday: false }
    const expectedMinutes = assignment.modo === 'horarios_fixos'
      ? (day.periodos || []).reduce((total, period) => total + periodMinutes(period), 0)
      : Math.max(0, Number(day.minutos || 0))
    return { expectedMinutes, isWorkday: expectedMinutes > 0 }
  }
  const isPositiveFlag = (value: string | null | undefined) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return false
    if (['não', 'nao', 'n', '0', '0.0', 'false', 'falso', '—', '-'].includes(normalized)) return false
    const numeric = Number(normalized.replace(',', '.'))
    return !Number.isFinite(numeric) || numeric !== 0
  }
  const rowHasInvalidDuration = (row: PointRow) => [row.horas_trabalhadas, row.horas_atraso, row.extra_50, row.extra_100]
    .some((value) => hasDurationValue(value) && durationToMinutes(value) === null)
  const rowKind = (row: PointRow) => {
    const marked = Boolean(row.entrada || row.saida || row.horas_trabalhadas)
    const note = `${row.justificativas || ''} ${row.inconsistencia_justificativa || ''}`.toLowerCase()
    const status = String(row.status || '').toLowerCase()
    const previsto = String(row.previsto || '').toLowerCase()
    const schedule = scheduleForDate(row.data)
    if (note.includes('férias') || note.includes('ferias')) return 'ferias'
    if (isPositiveFlag(row.dia_falta) || status.includes('falta')) return 'falta'
    if ((durationToMinutes(row.horas_atraso) ?? 0) > 0 || status.includes('atraso')) return 'atraso'
    if (rowHasInvalidDuration(row)) return 'inconsistencia'
    if (!marked && schedule?.isWorkday) return 'sem-marcacao'
    if (!marked && schedule && !schedule.isWorkday) return 'folga'
    if (!marked && (note.includes('folga') || /folga|descanso|repouso/.test(status) || /folga|descanso|repouso/.test(previsto))) return 'folga'
    if (!marked && status.includes('sem marcação')) return 'sem-marcacao'
    if (!marked && previsto.trim()) return 'sem-marcacao'
    if (!marked) return 'sem-escala'
    if ((durationToMinutes(row.extra_50) ?? 0) > 0 || (durationToMinutes(row.extra_100) ?? 0) > 0) return 'extra'
    return 'normal'
  }
  const renderPointStatus = (row: PointRow) => {
    const kind = rowKind(row)
    if (kind === 'sem-marcacao') return <span className="point-unmarked-status"><AlertCircle size={14} />Sem marcação</span>
    if (kind === 'sem-escala') return <StatusPill value="Sem escala" />
    if (kind === 'folga') return <StatusPill value="Folga" />
    if (kind === 'ferias') return <StatusPill value="Férias" />
    if (kind === 'falta') return <StatusPill value={row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada' ? 'Falta justificada' : row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada' ? 'Falta · justificativa recusada' : row.justificativa_status === 'pendente' || row.inconsistencia_status === 'pendente' ? 'Falta · em análise' : 'Falta identificada'} />
    if (kind === 'atraso') return <StatusPill value={row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada' ? 'Atraso justificado' : row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada' ? 'Atraso · justificativa recusada' : row.justificativa_status === 'pendente' || row.inconsistencia_status === 'pendente' ? 'Atraso · em análise' : 'Atraso'} />
    if (kind === 'inconsistencia') return <StatusPill value="Revisar duração" />
    if (kind === 'extra') return <StatusPill value="Hora extra" />
    return <StatusPill value={row.status || 'normal'} />
  }
  const shortTime = (value: string | null | undefined) => value ? String(value).slice(0, 5) : '—'
  const formatDelayMinutes = (minutes: number) => {
    const rounded = Math.max(0, Math.round(minutes))
    const hours = Math.floor(rounded / 60)
    const remainder = rounded % 60
    return hours > 0 ? `${hours}h ${String(remainder).padStart(2, '0')}min` : `${remainder} min`
  }
  const selectedPointDay = displayRows.find((row) => row.id === selectedPointDayId) || null
  const pointSummary = useMemo(() => {
    const extra50Minutes = rows.reduce((sum, row) => sum + (durationToMinutes(row.extra_50) ?? 0), 0)
    const extra100Minutes = rows.reduce((sum, row) => sum + (durationToMinutes(row.extra_100) ?? 0), 0)
    const faltas = displayRows.filter((row) => rowKind(row) === 'falta').length
    const atrasos = displayRows.filter((row) => rowKind(row) === 'atraso').length
    const totalAtrasoMinutos = displayRows.reduce((sum, row) => sum + (durationToMinutes(row.horas_atraso) ?? 0), 0)
    const invalidDurationValues = rows.reduce((count, row) => count + [row.horas_trabalhadas, row.horas_atraso, row.extra_50, row.extra_100]
      .filter((value) => hasDurationValue(value) && durationToMinutes(value) === null).length, 0)
    const diasComMarcacao = displayRows.filter((row) => row.entrada || row.saida_almoco || row.volta_almoco || row.saida || row.horas_trabalhadas).length
    const diasSemMarcacao = displayRows.filter((row) => rowKind(row) === 'sem-marcacao').length
    return { extra50Minutes, extra100Minutes, faltas, atrasos, totalAtrasoMinutos, invalidDurationValues, diasComMarcacao, diasSemMarcacao, totalExtrasMinutes: extra50Minutes + extra100Minutes }
  }, [displayRows, rows])
  const hasInconsistency = (row: PointRow) => Boolean(row.inconsistencia_tipo || isPositiveFlag(row.dia_falta) || (durationToMinutes(row.horas_atraso) ?? 0) > 0 || String(row.status || '').toLowerCase().includes('atraso') || String(row.status || '').toLowerCase().includes('falta'))
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
    rememberPointDialogFocus()
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
    rememberPointDialogFocus()
    pointConfirmReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
    const normalizedStatus = String(row.status || '').toLowerCase()
    const isAbsence = isPositiveFlag(row.dia_falta) || normalizedStatus.includes('falta') || row.inconsistencia_tipo === 'falta'
    const isDelay = (durationToMinutes(row.horas_atraso) ?? 0) > 0 || normalizedStatus.includes('atraso')
    const label = rowHasInvalidDuration(row) && !row.inconsistencia_tipo && !row.justificativa_status && !row.inconsistencia_status ? 'Formato inválido' : row.justificativa_status === 'pendente' ? 'Justificativa pendente' : row.justificativa_status === 'aceita' || row.inconsistencia_status === 'justificada' ? 'Justificada' : row.justificativa_status === 'recusada' || row.inconsistencia_status === 'recusada' ? 'Justificativa recusada' : row.inconsistencia_status === 'aprovada' ? 'Aprovada' : isAbsence ? 'Falta · pendente de análise' : isDelay ? 'Atraso · pendente de análise' : 'Inconsistência pendente'
    const detail = rowHasInvalidDuration(row) ? 'Há uma duração em formato inválido no arquivo importado.' : (durationToMinutes(row.horas_atraso) ?? 0) > 0 ? `Atraso: ${formatPointDuration(row.horas_atraso)}` : isPositiveFlag(row.dia_falta) ? `Falta: ${row.dia_falta}` : String(row.status || '').toLowerCase().includes('atraso') ? 'Atraso registrado; duração não informada.' : row.inconsistencia || 'Revisar ocorrência importada'
    return <div className="point-issue-cell"><StatusPill value={label} /><small>{detail}</small></div>
  }
  const openReviewModal = (row: PointRow) => { rememberPointDialogFocus(); setReviewModalRow(row); setJustificationText(row.justificativa_resposta || '') }
  const renderAdministrativeReview = (row: PointRow) => {
    if (!hasInconsistency(row)) return '—'
    if (row.justificativa_id) return <div className="point-review-actions"><StatusPill value={row.justificativa_status === 'aceita' ? 'Aceita' : row.justificativa_status === 'recusada' ? 'Recusada' : 'Pendente'} /><button className="icon-button point-review-trigger" type="button" onClick={() => openReviewModal(row)} aria-label={`Abrir justificativa de ${formatDate(row.data)}`} title="Abrir justificativa"><FileText size={15} /></button></div>
    if (row.inconsistencia_status === 'aprovada') return <div className="point-issue-cell"><StatusPill value="Aprovada sem justificativa" /><small>A inconsistência foi considerada um fato real.</small></div>
    return <div className="point-review-actions"><span className="point-unjustified-label">Aguardando análise</span><button className="icon-button" type="button" onClick={() => requestReviewInconsistency(row, 'aprovada')} disabled={decisionBusy === row.data} aria-label="Aprovar inconsistência sem justificativa" title="Aprovar como fato real"><Check size={15} /></button></div>
  }
  const periodLabel = period === 'day' ? 'Hoje' : period === 'week' ? 'Esta semana' : period === 'month' ? 'Mês selecionado' : period === 'previous_month' ? 'Mês anterior' : 'Período personalizado'
  return <>
    {!isAdministrative && <PageHeading eyebrow="Minha área · jornada" title="Meu ponto" description="Sua ficha individual de jornada, com todos os dias do período selecionado." />}
    <div className="point-filter-panel">
      <div className="point-filter-heading"><div><strong>{isAdministrative ? 'Filtros da equipe' : 'Filtros da ficha de ponto'}</strong>{!isAdministrative && <span>Consulte sua jornada dia a dia.</span>}</div>{isAdministrative ? <span className="point-filter-scope"><UsersRound size={15} /> Visão administrativa</span> : null}</div>
      <div className="point-filter-fields">
        {isAdministrative ? <form className="point-employee-search" onSubmit={(event) => { event.preventDefault(); invalidateEmployeeSelection(); setEmployeeLoading(true); setEmployeeOffset(0); setEmployeeSearch(employeeSearchInput.trim()); setEmployeeSearchKey((value) => value + 1) }}><label>Buscar funcionário por nome ou CPF<input type="search" value={employeeSearchInput} onChange={(event) => setEmployeeSearchInput(event.target.value)} placeholder="Digite um nome ou CPF" autoComplete="off" /></label><button className="secondary-button" type="submit" disabled={employeeLoading}><Search size={15} /> Buscar</button></form> : null}
        <label>Período<select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="day">Ponto do dia</option><option value="week">Ponto da semana</option><option value="month">Mês de referência</option><option value="previous_month">Mês anterior</option><option value="custom">Período personalizado</option></select></label>
        {(period === 'month' || period === 'previous_month') ? <label>Mês de referência<input type="month" value={monthReference} onChange={(event) => setMonthReference(event.target.value)} /></label> : null}
        {period === 'custom' ? <><label>Data inicial<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Data final<input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} /></label></> : <div className="point-filter-current"><CalendarDays size={17} /><span>{periodLabel}<small>{range.inicio ? `${formatDate(range.inicio)}${range.fim && range.fim !== range.inicio ? ` até ${formatDate(range.fim)}` : ''}` : 'Selecione as datas'}</small></span></div>}
      </div>
      {employeeError ? <div className="point-employee-search-error" role="alert">{employeeError}</div> : null}
    </div>
    {isAdministrative && selectedEmployee ? <section className="point-employee-context" aria-label="Funcionário selecionado">
      <div className="point-employee-context-main"><UserAvatar name={selectedEmployee.nome} url={selectedEmployee.avatar_url} className="point-employee-avatar" /><div className="point-employee-context-copy"><span>Funcionário {employeeOffset + 1} de {employeeCount}{employeeSearch ? ' encontrados' : ''}</span><strong>{selectedEmployee.nome}</strong>{selectedEmployee.cargo ? <small>{selectedEmployee.cargo}</small> : null}</div></div>
      <div className="point-employee-context-controls" role="group" aria-label={`Navegação da equipe: funcionário ${employeeOffset + 1} de ${employeeCount}`}><button className="icon-button" type="button" onClick={() => moveEmployee(-1)} disabled={selectedEmployeeIndex <= 0 || employeeLoading} aria-label="Funcionário anterior"><ChevronLeft size={18} /></button><button className="icon-button" type="button" onClick={() => moveEmployee(1)} disabled={selectedEmployeeIndex < 0 || selectedEmployeeIndex >= employeeCount - 1 || employeeLoading} aria-label="Próximo funcionário"><ChevronRight size={18} /></button></div>
    </section> : isAdministrative && employeeLoading ? <div className="point-employee-context is-loading" role="status"><RefreshCw className="spin" size={16} /> Carregando primeiro funcionário…</div> : null}
    <section className={`point-summary-section${loading || error || loadedPointKey !== pointRequestKey ? ' is-loading' : ''}`} aria-label="Resumo do período"><div className="point-summary-heading"><div><span className="eyebrow">ANÁLISE DA JORNADA</span><h2>Resumo do período</h2></div></div><div className="point-summary-grid">
      <article className="point-insight-card is-presence"><span>Dias com marcação</span><strong>{pointSummary.diasComMarcacao}</strong><small>de {displayRows.length} dia(s) no período</small></article>
      <article className="point-insight-card is-missing"><span>Sem marcação prevista</span><strong>{pointSummary.diasSemMarcacao}</strong><small>Dia de trabalho sem batida identificada</small></article>
      <article className="point-insight-card is-absence"><span>Faltas identificadas</span><strong>{pointSummary.faltas}</strong><small>Conforme sinalização do registro importado</small></article>
      <article className="point-insight-card is-delay"><span>Dias com atraso</span><strong>{pointSummary.atrasos}</strong><small>{formatDelayMinutes(pointSummary.totalAtrasoMinutos)} acumulados</small></article>
      <article className="point-insight-card is-overtime"><span>Horas extras registradas</span><strong>{formatDuration(pointSummary.totalExtrasMinutes)}</strong><small>50%: {formatDuration(pointSummary.extra50Minutes)} · 100%: {formatDuration(pointSummary.extra100Minutes)}{pointSummary.invalidDurationValues ? ` · ${pointSummary.invalidDurationValues} campo(s) de duração inválido(s) para revisar` : ''}</small></article>
    </div></section>
    <SectionCard title={isAdministrative ? 'Diário do ponto' : 'Minha ficha de ponto'} caption="Um registro por dia do período selecionado.">
      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : !displayRows.length ? <EmptyState title={isAdministrative && !employeeId ? 'Selecione um funcionário' : 'Nenhum dia para exibir'} description={isAdministrative && !employeeId ? 'Escolha um funcionário para abrir a ficha individual de ponto.' : 'Ajuste o período para consultar a jornada.'} /> : <div className="table-wrap">
        <p className="table-scroll-hint">Os dias são exibidos do primeiro ao último dia do período. Extras 50%/100% vêm do arquivo importado; a diferença da jornada configurada é apenas informativa e não calcula adicional, desconto ou banco de horas.</p>
        <table className={isAdministrative ? 'point-daily-table is-administrative' : 'point-daily-table'}>
          <thead><tr><th rowSpan={2}>Dia</th><th colSpan={2}>Entrada e almoço</th><th colSpan={2}>Retorno e saída</th><th rowSpan={2}>Horas</th><th rowSpan={2}>Status</th><th colSpan={5}>Ocorrências do arquivo</th>{isAdministrative ? <><th colSpan={2}>Jornada configurada</th><th rowSpan={2}>Inconsistência</th><th rowSpan={2}>Análise</th></> : <th rowSpan={2}>Justificativa</th>}</tr><tr><th>Entrada</th><th>Almoço</th><th>Retorno</th><th>Saída</th><th>Dia falta</th><th>Atraso</th><th>Extra 50%</th><th>Extra 100%</th><th>Desconto DSR</th>{isAdministrative ? <><th>Previsto</th><th>Diferença informativa</th></> : null}</tr></thead>
          <tbody>{displayRows.map((row) => {
            const kind = rowKind(row)
            const schedule = isAdministrative ? scheduleForDate(row.data) : null
            const marked = Boolean(row.entrada || row.saida || row.horas_trabalhadas)
            const workedMinutes = durationToMinutes(row.horas_trabalhadas)
            const difference = schedule?.isWorkday && marked && workedMinutes !== null ? workedMinutes - schedule.expectedMinutes : null
            return <tr key={row.id} className={`point-row-${kind}${selectedPointDay?.id === row.id ? ' is-selected' : ''}`} onClick={(event) => { if ((event.target as HTMLElement).closest('button,a,input,select,textarea')) return; setSelectedPointDayId(row.id) }}><td><button type="button" className="point-day-trigger" onClick={() => setSelectedPointDayId(row.id)} aria-label={`Ver todas as informações de ${formatDate(row.data)}`}>{formatDate(row.data)}</button></td><td>{shortTime(row.entrada)}</td><td>{shortTime(row.saida_almoco)}</td><td>{shortTime(row.volta_almoco)}</td><td>{shortTime(row.saida)}</td><td>{formatPointDuration(row.horas_trabalhadas)}</td><td>{renderPointStatus(row)}</td><td>{row.dia_falta || '—'}</td><td>{formatPointDuration(row.horas_atraso)}</td><td>{formatPointDuration(row.extra_50)}</td><td>{formatPointDuration(row.extra_100)}</td><td>{row.desconta_dsr || '—'}</td>{isAdministrative ? <><td>{schedule ? schedule.isWorkday ? formatDuration(schedule.expectedMinutes) : 'Descanso' : '—'}</td><td className={difference === null ? '' : difference > 0 ? 'point-schedule-positive' : difference < 0 ? 'point-schedule-negative' : ''}>{difference === null ? '—' : `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${formatDuration(Math.abs(difference))}`}</td><td>{hasInconsistency(row) || rowHasInvalidDuration(row) ? renderAdministrativeIssueStatus(row) : '—'}</td><td>{renderAdministrativeReview(row)}</td></> : <td>{renderEmployeeJustification(row)}</td>}</tr>
          })}</tbody>
        </table>
      </div>}
    </SectionCard>
    {selectedPointDay ? <div className="point-day-details-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedPointDayId('') }}>
      <div ref={pointDayDialogRef} className="point-day-details-dialog" role="dialog" aria-modal={activePointDialog === 'day'} aria-hidden={activePointDialog !== 'day'} inert={activePointDialog !== 'day'} aria-labelledby="point-day-details-title" tabIndex={-1}>
        <div className="point-day-details-heading"><div><span className="eyebrow">Detalhe completo do dia</span><h2 id="point-day-details-title">{formatDate(selectedPointDay.data)}</h2><p>{isAdministrative ? selectedEmployee?.nome || 'Funcionário selecionado' : user.nome}</p></div><button className="icon-button" type="button" onClick={() => setSelectedPointDayId('')} aria-label="Fechar detalhe do dia"><X size={18} /></button></div>
        {(() => {
          const daySchedule = isAdministrative ? scheduleForDate(selectedPointDay.data) : null
          const dayWorkedMinutes = durationToMinutes(selectedPointDay.horas_trabalhadas)
          const dayDifference = daySchedule?.isWorkday && dayWorkedMinutes !== null ? dayWorkedMinutes - daySchedule.expectedMinutes : null
          const justificationStatus = selectedPointDay.justificativa_status === 'aceita' ? 'Aceita pelo RH' : selectedPointDay.justificativa_status === 'recusada' ? 'Recusada pelo RH' : selectedPointDay.justificativa_status === 'pendente' ? 'Aguardando análise do RH' : selectedPointDay.justificativa_motivo ? 'Justificativa registrada' : 'Nenhuma justificativa enviada'
          const fields: Array<{ label: string; value: ReactNode; wide?: boolean }> = [
            { label: 'Status do dia', value: renderPointStatus(selectedPointDay) },
            { label: 'Entrada', value: shortTime(selectedPointDay.entrada) },
            { label: 'Saída para almoço', value: shortTime(selectedPointDay.saida_almoco) },
            { label: 'Retorno do almoço', value: shortTime(selectedPointDay.volta_almoco) },
            { label: 'Saída', value: shortTime(selectedPointDay.saida) },
            { label: 'Horas trabalhadas', value: formatPointDuration(selectedPointDay.horas_trabalhadas) },
            { label: 'Falta registrada', value: selectedPointDay.dia_falta || '—' },
            { label: 'Atraso', value: formatPointDuration(selectedPointDay.horas_atraso) },
            { label: 'Hora extra 50%', value: formatPointDuration(selectedPointDay.extra_50) },
            { label: 'Hora extra 100%', value: formatPointDuration(selectedPointDay.extra_100) },
            { label: 'Desconto de DSR', value: selectedPointDay.desconta_dsr || '—' },
            { label: 'Justificativa enviada', value: selectedPointDay.justificativa_motivo || selectedPointDay.justificativas || '—', wide: true },
            { label: 'Situação da justificativa', value: justificationStatus },
            { label: 'Resposta do RH', value: selectedPointDay.justificativa_resposta || '—', wide: true },
          ]
          if (isAdministrative) fields.push(
            { label: 'Jornada esperada', value: daySchedule ? daySchedule.isWorkday ? formatDuration(daySchedule.expectedMinutes) : 'Descanso' : 'Sem jornada configurada' },
            { label: 'Horas previstas no arquivo', value: formatPointDuration(selectedPointDay.previsto) },
            { label: 'Diferença informativa', value: dayDifference === null ? '—' : `${dayDifference > 0 ? '+' : dayDifference < 0 ? '−' : ''}${formatDuration(Math.abs(dayDifference))}` },
            { label: 'Ocorrência / inconsistência', value: hasInconsistency(selectedPointDay) || rowHasInvalidDuration(selectedPointDay) ? renderAdministrativeIssueStatus(selectedPointDay) : 'Nenhuma ocorrência identificada', wide: true },
          )
          return <div className="point-day-details-grid">{fields.map((field) => <div className={field.wide ? 'is-wide' : ''} key={field.label}><span>{field.label}</span><strong>{field.value}</strong></div>)}</div>
        })()}
        <div className="point-day-details-footer"><small>Para revisar ou registrar uma análise, feche este detalhe e use as ações da tabela.</small><button className="secondary-button" type="button" onClick={() => setSelectedPointDayId('')}>Voltar ao diário</button></div>
      </div>
    </div> : null}
    {reviewModalRow ? <div className="point-review-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setReviewModalRow(null) }}>
      <div ref={pointReviewDialogRef} className="point-review-dialog" role="dialog" aria-modal={activePointDialog === 'review'} aria-hidden={activePointDialog === 'confirm'} inert={activePointDialog === 'confirm'} aria-labelledby="point-review-title" tabIndex={-1}>
        <div className="point-review-dialog-head"><div><span className="eyebrow">Análise de justificativa</span><h3 id="point-review-title">{formatDate(reviewModalRow.data)}</h3></div><button className="icon-button" type="button" onClick={() => setReviewModalRow(null)} aria-label="Fechar análise"><X size={17} /></button></div>
        <div className="point-review-dialog-body">
          <div className="point-review-summary"><div><span>Ocorrência</span><strong>{(durationToMinutes(reviewModalRow.horas_atraso) ?? 0) > 0 ? `Atraso de ${formatPointDuration(reviewModalRow.horas_atraso)}` : isPositiveFlag(reviewModalRow.dia_falta) ? `Falta: ${reviewModalRow.dia_falta}` : 'Inconsistência de ponto'}</strong></div><div><span>Tipo</span><strong>{reviewModalRow.justificativa_motivo ? 'Justificativa do funcionário' : 'Análise administrativa'}</strong></div></div>
          <div className="point-review-message"><span>Motivo informado</span><p>{reviewModalRow.justificativa_motivo || 'O funcionário não enviou uma justificativa textual.'}</p></div>
          {reviewModalRow.justificativa_arquivo_url ? <a className="point-review-attachment" href={reviewModalRow.justificativa_arquivo_url} target="_blank" rel="noreferrer"><FileText size={15} /> {reviewModalRow.justificativa_arquivo_nome || 'Abrir anexo'}</a> : <small className="point-review-no-attachment">Nenhum anexo enviado.</small>}
          <label className="point-review-response"><span>Resposta ao funcionário</span><textarea value={justificationText} onChange={(event) => setJustificationText(event.target.value)} placeholder="Escreva uma resposta. Para recusar, informe o motivo." rows={3} readOnly={reviewModalRow.justificativa_status !== 'pendente'} /></label>
        </div>
        <div className="point-review-dialog-actions"><button className="secondary-button" type="button" onClick={() => setReviewModalRow(null)}>Fechar</button>{reviewModalRow.justificativa_status === 'pendente' ? <><button className="secondary-button danger-button" type="button" onClick={() => requestSubmittedJustificationReview(reviewModalRow, 'recusada')} disabled={decisionBusy === reviewModalRow.data}><X size={15} /> Recusar</button><button className="primary-button" type="button" onClick={() => requestSubmittedJustificationReview(reviewModalRow, 'aceita')} disabled={decisionBusy === reviewModalRow.data}><Check size={15} /> Aceitar</button></> : null}</div>
      </div>
    </div> : null}
    {pendingAction ? <div className="point-confirm-backdrop" role="presentation">
      <div ref={pointConfirmDialogRef} className="point-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="point-confirm-title" tabIndex={-1}><div className="point-confirm-icon"><ShieldCheck size={22} /></div><div><h3 id="point-confirm-title">{pendingAction.title}</h3><p>{pendingAction.description}</p></div><div className="point-confirm-actions"><button className="secondary-button" type="button" onClick={() => setPendingAction(null)}>Cancelar</button><button className="primary-button" type="button" onClick={async () => { const action = pendingAction; setPendingAction(null); await action.run() }}><Check size={15} /> {pendingAction.confirmLabel}</button></div></div>
    </div> : null}
  </>
}

function PayslipsView({ token }: { token: string }) {
  const [rows, setRows] = useState<PayslipRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState('')
  useEffect(() => { listPayslips(token).then((data) => { if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta'); setRows(data.holerites || []) }).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')).finally(() => setLoading(false)) }, [token])
  async function openPayslip(row: PayslipRow) {
    setOpeningId(row.id); setError('')
    const popup = window.open('about:blank', '_blank')
    try {
      const signed = await getPayslipDocumentUrl(token, row.id)
      const url = signed.url
      if (!url) throw new Error('URL assinada do documento não encontrada')
      if (popup) popup.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) { popup?.close(); setError(err instanceof Error ? err.message : 'Não foi possível abrir o holerite') } finally { setOpeningId('') }
  }
  return <><PageHeading eyebrow="Minha área · remuneração" title="Holerites" description="Comprovantes publicados pelo departamento pessoal." /><SectionCard title="Comprovantes disponíveis" caption="Arquivos privados vinculados ao seu cadastro">{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum holerite publicado" description="Quando o DP disponibilizar um comprovante, ele ficará disponível neste espaço." /> : <div className="document-list">{rows.map((row) => <div className="document-row" key={row.id}><span className="document-icon"><Receipt size={18} /></span><div><strong>{String(row.mes).padStart(2, '0')}/{row.ano}</strong><small>{row.arquivo_nome || 'Holerite'}</small></div><button type="button" onClick={() => void openPayslip(row)} disabled={openingId === row.id} className="icon-button" aria-label="Abrir holerite">{openingId === row.id ? <RefreshCw className="spin" size={16} /> : <ArrowRight size={17} />}</button></div>)}</div>}</SectionCard></>
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

function printReport(title: string, columns: string[], rows: string[][], targetWindow?: Window | null) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
  const html = `<html><head><title>${escape(title)}</title><style>body{font:12px Arial;color:#151821;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd0d8;padding:6px;text-align:left}th{background:#f0f2f5}</style></head><body><h1>${escape(title)}</h1><p>RF Gestão · gerado em ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr>${columns.map((x) => `<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((x) => `<td>${escape(x || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`
  const popup = targetWindow || window.open('', '_blank'); if (!popup) return; popup.document.open(); popup.document.write(html); popup.document.close()
}

function PointImportsView({ token }: { token: string }) {
  const [tipo, setTipo] = useState<'diario' | 'mensal'>('mensal')
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
  })
  const [file, setFile] = useState<File | null>(null)
  const [imports, setImports] = useState<PointImportSummary[]>([])
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([])
  const [reconciliation, setReconciliation] = useState<Awaited<ReturnType<typeof reconcilePointImports>> | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [rows, setRows] = useState<PointImportRow[]>([])
  const [previewPage, setPreviewPage] = useState(0)
  const previewRequestRef = useRef(0)
  const importOperationLockRef = useRef(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null)
  const importPreviewDialogRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(false); const [actionLoading, setActionLoading] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const pending = imports.find((item) => item.id === pendingId)
  const previewPageSize = 100
  const previewPageCount = Math.max(1, Math.ceil(rows.length / previewPageSize))
  const visiblePreviewRows = rows.slice(previewPage * previewPageSize, (previewPage + 1) * previewPageSize)
  const importHasBlockingIssues = Boolean(pending && (pending.linhas_nao_encontradas > 0 || pending.linhas_com_inconsistencia > 0))
  const competenciaMonth = useMemo(() => {
    const [month, year] = competencia.split('/')
    return month && year ? `${year}-${month}` : ''
  }, [competencia])

  function closePreview() {
    previewRequestRef.current += 1
    setPendingId(null)
    setPreviewLoadingId(null)
    setRows([])
    setPreviewPage(0)
  }

  useEffect(() => {
    if (!pendingId) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = importPreviewDialogRef.current
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(selector)) : []
    focusables[0]?.focus()
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); if (!importOperationLockRef.current) closePreview(); return }
      if (event.key !== 'Tab' || !dialog) return
      const currentFocusables = Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter((element) => !('disabled' in element && Boolean((element as HTMLButtonElement).disabled)))
      if (!currentFocusables.length) { event.preventDefault(); dialog.focus(); return }
      const first = currentFocusables[0]
      const last = currentFocusables[currentFocusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
    }
    document.addEventListener('keydown', handleDialogKeys)
    return () => { document.removeEventListener('keydown', handleDialogKeys); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [pendingId])

  async function reload() { const data = await listPointImports(token); if (!data.sucesso) throw new Error(data.erro || 'Falha ao consultar o histórico'); setImports(data.importacoes || []) }
  useEffect(() => { reload().catch((err) => setError(err instanceof Error ? err.message : 'Falha ao consultar o histórico')) }, [token])

  async function loadPreview(importacaoId: string, importType: 'diario' | 'mensal' = tipo): Promise<boolean> {
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setRows([]); setPendingId(importacaoId); setPreviewPage(0); setPreviewLoadingId(importacaoId); setError(''); setMessage('')
    try {
      const listed = await listImportedPoint(token, importType, importacaoId)
      if (requestId !== previewRequestRef.current) return false
      if (!listed.sucesso) throw new Error(listed.erro || 'Falha ao carregar a prévia')
      setRows(listed.registros || [])
      return true
    } catch (cause) {
      if (requestId !== previewRequestRef.current) return false
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar a prévia da importação.')
      return false
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoadingId(null)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (importOperationLockRef.current) return
    if (!file) { setError('Selecione o arquivo exportado pelo aplicativo de ponto.'); return }
    importOperationLockRef.current = true
    previewRequestRef.current += 1
    setLoading(true); setError(''); setMessage(''); setRows([]); setPendingId(null)
    try {
      const parsedFile = await pointRowsFromFile(file)
      if (!parsedFile.headerFound) throw new Error('Não reconheci o modelo do arquivo. Confirme que uma das planilhas contenha as colunas Dia/Data e CPF do funcionário do exportador de ponto.')
      if (!parsedFile.rows.length) throw new Error('O cabeçalho foi reconhecido, mas não há linhas de ponto para analisar.')
      const result = await importPoint(token, { tipo, competencia, arquivoNome: file.name, linhas: parsedFile.rows })
      if (!result.sucesso || !result.importacao_id) throw new Error(result.erro || 'Falha ao analisar a importação')
      setFile(null)
      await reload()
      if (await loadPreview(result.importacao_id)) setMessage('Prévia criada. Revise as inconsistências antes de aplicar os registros encontrados.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao analisar o arquivo.') } finally { importOperationLockRef.current = false; setLoading(false) }
  }

  async function applyPending() {
    if (!pendingId || importOperationLockRef.current) return
    importOperationLockRef.current = true
    const importId = pendingId
    previewRequestRef.current += 1
    setActionLoading(true); setError('')
    try {
      const result = await applyPointImport(token, importId)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível aplicar os registros')
      await reload(); await loadPreview(importId)
      setMessage(`${result.linhas_inseridas || result.linhas_aplicadas || 0} batida(s) nova(s) inserida(s). ${result.registros_existentes_preservados || 0} registro(s) existente(s) foram preservados sem alteração.`)
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao aplicar os registros.') } finally { importOperationLockRef.current = false; setActionLoading(false) }
  }

  async function runReconciliation() {
    if (selectedImportIds.length < 2) { setError('Selecione pelo menos duas importações para conciliar.'); return }
    setReconciling(true); setError(''); setMessage(''); setReconciliation(null)
    try {
      const result = await reconcilePointImports(token, selectedImportIds)
      if (!result.sucesso) throw new Error(result.erro || 'Não foi possível conciliar as importações.')
      setReconciliation(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao conciliar os lotes.') }
    finally { setReconciling(false) }
  }

  async function ignorePending() {
    if (!pendingId || importOperationLockRef.current) return
    importOperationLockRef.current = true
    const importId = pendingId
    previewRequestRef.current += 1
    setActionLoading(true); setError('')
    try { const result = await ignorePointImport(token, importId); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível arquivar a importação'); await reload(); setPendingId(null); setRows([]); setPreviewPage(0); setMessage('Importação arquivada no histórico de auditoria.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao arquivar a importação.') } finally { importOperationLockRef.current = false; setActionLoading(false) }
  }

  async function loadRows() {
    if (importOperationLockRef.current) { setError('Aguarde a conclusão da operação de importação antes de gerar o relatório.'); return }
    const selectedImport = imports.find((item) => item.tipo === tipo && item.competencia === competencia && item.status === 'aplicada')
    if (!selectedImport) { setError(`Não há uma importação aplicada de ponto ${tipo} para a competência ${competencia}.`); return }
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) { setError('Permita pop-ups neste site para gerar o relatório imprimível.'); return }
    importOperationLockRef.current = true
    setReportLoading(true); setError('')
    try {
      reportWindow.document.write('<p style="font:14px Arial;padding:24px">Preparando relatório de ponto…</p>')
      const listed = await listImportedPoint(token, tipo, selectedImport.id)
      if (!listed.sucesso) throw new Error(listed.erro || 'Não foi possível carregar os registros da importação selecionada.')
      const reportRows = listed.registros || []
      if (!reportRows.length) throw new Error('A importação aplicada não contém linhas para relatar.')
      printReport(`Ponto ${tipo} · ${competencia}`, ['Data','Funcionário','CPF','Entrada','Saída','Horas normais','Extra 50%','Extra 100%','Atraso/Falta'], reportRows.map((row) => [formatDate(row.data), row.nome_csv, maskCpf(row.cpf_arquivo || row.cpf), row.entrada_1 || '', row.saida_1 || '', formatPointDuration(row.total_normais), formatPointDuration(row.extra_50), formatPointDuration(row.extra_100), formatPointDuration(row.horas_atraso) !== '—' ? formatPointDuration(row.horas_atraso) : row.dia_falta || '']), reportWindow)
    } catch (cause) {
      reportWindow.close()
      setError(cause instanceof Error ? cause.message : 'Falha ao gerar o relatório de ponto.')
    } finally { importOperationLockRef.current = false; setReportLoading(false) }
  }

  return <div className="import-page">
    <PageHeading title="Importar ponto" action={<button className="secondary-button" onClick={loadRows} disabled={reportLoading || loading || actionLoading}>{reportLoading || loading || actionLoading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />} {reportLoading ? 'Preparando PDF…' : loading || actionLoading ? 'Aguarde a operação atual…' : 'Gerar PDF do ponto'}</button>} />
    <div className="import-layout">
      <SectionCard title="Nova importação" caption="O arquivo é apenas analisado até você confirmar">
        <form className="form-stack import-form" onSubmit={submit}>
          <div className="form-row">
            <label>Tipo de ponto<select value={tipo} onChange={(event) => setTipo(event.target.value as 'diario' | 'mensal')} disabled={loading || actionLoading || reportLoading}><option value="mensal">Ponto mensal / fechamento</option><option value="diario">Ponto diário</option></select></label>
            <label>Competência · mês atual por padrão<input type="month" value={competenciaMonth} onChange={(event) => { const [year, month] = event.target.value.split('-'); setCompetencia(year && month ? `${month}/${year}` : '') }} required disabled={loading || actionLoading || reportLoading} /></label>
          </div>
          <label>Arquivo exportado<input type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] || null)} required disabled={loading || actionLoading || reportLoading} /><span className="field-note">Aceita o CSV exato do aplicativo e planilhas Excel. O cruzamento é feito exclusivamente pelo CPF.</span></label>
          {file && <div className="selected-file"><FileSpreadsheet size={18} /><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB · pronto para análise</small></div></div>}
          {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
          {message && <div className="form-success"><Check size={16} />{message}</div>}
          <button className="primary-button" type="submit" disabled={loading || actionLoading || reportLoading}>{loading ? <><RefreshCw className="spin" size={16} /> Analisando arquivo…</> : actionLoading || reportLoading ? <><RefreshCw className="spin" size={16} /> Aguarde a operação atual…</> : <><Upload size={16} /> Analisar e cruzar CPFs</>}</button>
        </form>
      </SectionCard>
      <SectionCard title="Critérios de validação" caption="Regras explícitas da carga">
        <div className="import-rules">
          <div><Check size={16} /><span><strong>Vínculo por CPF</strong><small>O nome exportado pelo relógio pode ser diferente; isso não bloqueia a correspondência.</small></span></div>
          <div><AlertCircle size={16} /><span><strong>Dados inválidos ou CPF não localizado</strong><small>O motivo aparece na prévia; nenhuma linha do lote é gravada até corrigir e reanalisar o arquivo.</small></span></div>
          <div><ShieldCheck size={16} /><span><strong>Auditoria</strong><small>Operador, arquivo, competência e resultado ficam no histórico.</small></span></div>
        </div>
      </SectionCard>
    </div>
    <SectionCard title="Histórico de importações" caption="Consulte resultado, competência, operador e situação de cada arquivo">
      <details className="import-history-help">
        <summary><Info size={15} /><span>Como interpretar este histórico</span></summary>
        <div className="import-history-help-body">
          <p><strong>Vinculado:</strong> o funcionário foi localizado pelo CPF. O nome informado no relógio pode ter outra grafia e não impede a associação.</p>
          <p><strong>Sem correspondência:</strong> a linha não foi vinculada; abra o item para ver o motivo disponível e corrija o CPF/cadastro antes de uma nova carga.</p>
          <p><strong>Pendente:</strong> prévia aguardando decisão. <strong>Aplicada:</strong> linhas vinculadas gravadas. <strong>Ignorada:</strong> arquivada sem aplicar registros.</p>
        </div>
      </details>
      <div className="import-reconcile-tools">
        <div className="import-reconcile-heading"><div><strong>Conciliação entre lotes</strong><small>Compare 2–20 importações selecionadas. A conciliação é somente leitura; nenhuma batida é alterada.</small></div><button type="button" className="secondary-button" onClick={() => void runReconciliation()} disabled={reconciling || selectedImportIds.length < 2}>{reconciling ? <RefreshCw size={15} className="spin" /> : <Search size={15} />} Conciliar {selectedImportIds.length || ''}</button></div>
        <div className="import-reconcile-selection">{imports.map((item) => <label key={item.id}><input type="checkbox" checked={selectedImportIds.includes(item.id)} onChange={(event) => { setSelectedImportIds((current) => event.target.checked ? current.length < 20 ? [...current, item.id] : current : current.filter((id) => id !== item.id)); setReconciliation(null) }} disabled={reconciling || (!selectedImportIds.includes(item.id) && selectedImportIds.length >= 20)} /><span><strong>{item.tipo === 'mensal' ? 'Mensal' : 'Diário'} · {item.competencia}</strong><small>{item.arquivo_nome} · {item.status}</small></span></label>)}</div>
        {reconciliation && <div className="import-reconcile-results"><strong>{reconciliation.achados?.length || 0} chave(s) com divergência entre lotes ou em relação ao ponto atual</strong>{!reconciliation.achados?.length ? <p>Nenhum conflito encontrado nos lotes selecionados.</p> : <div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>Data</th><th>Tipo de achado</th><th>Valores por lote</th></tr></thead><tbody>{reconciliation.achados.map((finding) => <tr key={`${finding.funcionario_id}-${finding.data}`}><td>{finding.funcionario}</td><td>{formatDate(finding.data)}</td><td>{[finding.divergencia_entre_lotes ? 'Entre lotes' : '', finding.divergencia_registro_atual ? 'Vs. batida atual' : ''].filter(Boolean).join(' · ')}</td><td>{finding.lotes.map((lot, index) => <small className="import-reconcile-value" key={`${String(lot.importacao_id)}-${index}`}>{String(lot.arquivo)} ({String(lot.status_lote)}): {String(lot.entrada_1 || '—')} / {String(lot.saida_1 || '—')} · {String(lot.total_normais || '—')}</small>)}</td></tr>)}</tbody></table></div>}</div>}
      </div>
      <div className="import-history">
        {imports.length === 0 ? <EmptyState title="Nenhuma importação ainda" description="A primeira análise aparecerá aqui com operador, competência e resultado por CPF." /> : imports.map((item) => <button className={`import-history-row ${pendingId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => void loadPreview(item.id, item.tipo)} disabled={loading || actionLoading || reportLoading}>
          <span className="document-icon"><FileSpreadsheet size={18} /></span>
          <span className="import-history-main"><strong>{item.tipo === 'mensal' ? 'Mensal' : 'Diário'} · {item.competencia || 'sem competência'}</strong><small>{item.arquivo_nome} · {item.imported_by_name || 'Usuário'} · {formatDate(item.created_at)}</small><small>{item.linhas_encontradas} pessoas localizadas · {item.linhas_nao_encontradas} sem vínculo · {item.linhas_com_inconsistencia} inconsistentes</small></span>
          <span className="import-history-count"><b>{item.linhas_encontradas}/{item.total_linhas}</b><small>linhas vinculadas</small></span>
          <StatusPill value={item.status === 'aplicada' ? 'Aplicada' : item.status === 'ignorada' ? 'Ignorada' : (item.linhas_nao_encontradas || item.linhas_com_inconsistencia) ? 'Pendente · corrigir' : 'Pendente · pronta'} />
        </button>)}
      </div>
    </SectionCard>
    {pending ? <div className="point-import-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionLoading && !loading && !reportLoading) closePreview() }}>
      <div ref={importPreviewDialogRef} className="point-import-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="point-import-preview-title" tabIndex={-1}>
        <div className="point-import-preview-heading"><div><span className="eyebrow">{pending.tipo === 'mensal' ? 'Importação mensal' : 'Importação diária'} · {pending.competencia || 'sem competência'}</span><h2 id="point-import-preview-title">Detalhes da importação</h2><p>{pending.arquivo_nome} · {pending.imported_by_name || 'Usuário'} · {formatDate(pending.created_at)}</p></div><button type="button" className="icon-button" onClick={closePreview} disabled={actionLoading || loading} aria-label="Fechar detalhes da importação"><X size={18} /></button></div>
        <div className="point-import-preview-content">
          <div className="import-summary"><div className="import-stat"><span>Linhas lidas</span><strong>{pending.total_linhas}</strong></div><div className="import-stat valid"><span>Pessoas localizadas</span><strong>{pending.linhas_encontradas}</strong></div><div className="import-stat invalid"><span>CPFs sem vínculo</span><strong>{pending.linhas_nao_encontradas}</strong></div><div className="import-stat invalid"><span>Linhas inconsistentes</span><strong>{pending.linhas_com_inconsistencia}</strong></div></div>
          <div className="point-import-preview-status"><StatusPill value={pending.status === 'aplicada' ? 'Aplicada' : pending.status === 'ignorada' ? 'Ignorada' : importHasBlockingIssues ? 'Pendente · corrigir' : 'Pendente · pronta'} /><span>{importHasBlockingIssues ? 'Há erros impeditivos; nenhum registro deste lote pode ser aplicado.' : pending.status === 'aplicada' ? 'Registros vinculados gravados; batidas existentes foram preservadas.' : pending.status === 'ignorada' ? 'Lote arquivado sem aplicar registros.' : 'Prévia consistente. A aplicação continua dependendo da sua confirmação.'}</span></div>
          {error ? <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div> : null}
          {message ? <div className="form-success" role="status"><Check size={16} />{message}</div> : null}
          {previewLoadingId === pending.id ? <LoadingState label="Carregando detalhes deste lote…" /> : rows.length ? <>
            <div className="point-import-rows-heading"><div><strong>Linhas analisadas</strong><small>{rows.length} registro(s) · associação pelo CPF · {previewPage + 1} de {previewPageCount} páginas</small></div><span>Valores recebidos do arquivo</span></div>
            <div className="table-wrap point-import-preview-table-wrap"><table><thead><tr><th>Data</th><th>Funcionário no arquivo</th><th>CPF</th><th>Entrada</th><th>Almoço</th><th>Retorno</th><th>Saída</th><th>Horas normais</th><th>Extra 50%</th><th>Extra 100%</th><th>Vínculo</th></tr></thead><tbody>{visiblePreviewRows.map((row) => <tr className={!row.encontrado || row.inconsistencia ? 'row-inconsistent' : ''} key={row.id}><td>{formatDate(row.data || '')}</td><td><strong>{row.nome_csv}</strong>{(!row.encontrado || row.inconsistencia) && <small className="table-note">{row.inconsistencia || row.import_validation_errors?.[0] || 'CPF não localizado no cadastro da empresa.'}</small>}</td><td className="mono">{maskCpf(row.cpf_arquivo || row.cpf)}</td><td>{row.entrada_1 || '—'}</td><td>{row.saida_1 || '—'}</td><td>{row.entrada_2 || '—'}</td><td>{row.saida_2 || '—'}</td><td>{formatPointDuration(row.total_normais)}</td><td>{formatPointDuration(row.extra_50)}</td><td>{formatPointDuration(row.extra_100)}</td><td><StatusPill value={row.inconsistencia ? 'Inconsistente' : row.encontrado ? 'Vinculado' : 'Não localizado'} /></td></tr>)}</tbody></table></div>
            {rows.length > previewPageSize ? <div className="button-row point-import-pagination"><small>Linhas {previewPage * previewPageSize + 1}–{Math.min((previewPage + 1) * previewPageSize, rows.length)} de {rows.length}</small><div className="button-row"><button type="button" className="secondary-button" disabled={previewPage === 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>Anterior</button><span>Página {previewPage + 1} de {previewPageCount}</span><button type="button" className="secondary-button" disabled={previewPage + 1 >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}>Próxima</button></div></div> : null}
          </> : <EmptyState title="Nenhuma linha disponível" description="O lote não retornou registros para exibir nesta prévia." />}
          <div className="point-import-preview-actions"><div><strong>{importHasBlockingIssues ? 'Aplicação bloqueada: corrija os erros e analise o arquivo novamente.' : 'Batidas existentes nunca serão substituídas.'}</strong><small>Conflitos com registros já gravados são preservados e informados no resultado da aplicação.</small></div><div className="button-row"><button className="secondary-button" onClick={() => void ignorePending()} disabled={loading || actionLoading || reportLoading || previewLoadingId === pending.id}>{actionLoading ? <RefreshCw className="spin" size={15} /> : null}{pending.status === 'aplicada' ? 'Arquivar alerta' : pending.status === 'ignorada' ? 'Importação ignorada' : 'Ignorar e arquivar'}</button><button className="primary-button" onClick={() => void applyPending()} disabled={loading || actionLoading || reportLoading || previewLoadingId === pending.id || pending.status !== 'pendente' || importHasBlockingIssues}>{actionLoading ? <RefreshCw className="spin" size={15} /> : <Check size={15} />} {pending.status === 'aplicada' ? 'Registros aplicados' : importHasBlockingIssues ? 'Corrija e reimporte' : 'Aplicar sem substituir'}</button></div></div>
        </div>
      </div>
    </div> : null}

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
  const preferenceKey = `rf-gestao-preferences-${user.usuario_id}`
  const [active, setActive] = useState<ModuleKey>(() => {
    try { const saved = localStorage.getItem(`${preferenceKey}-active`); return saved && allowedItems.some((item) => item.key === saved) ? saved as ModuleKey : allowedItems[0]?.key || 'perfil' } catch { return allowedItems[0]?.key || 'perfil' }
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const [compactSidebar, setCompactSidebar] = useState(() => localStorage.getItem(`${preferenceKey}-compact`) === 'true')
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
  useEffect(() => {
    document.body.classList.toggle('mobile-nav-open', mobileMenu)
    return () => document.body.classList.remove('mobile-nav-open')
  }, [mobileMenu])
  const displayName = profile?.nome || user.nome
  const displayCargo = profile?.cargo || user.cargo
  const activeItem = navItems.find((item) => item.key === active) || navItems[0]
  const activeLabel = active === 'funcionarios' && user.perfil === 'funcionario' ? 'Meu prontuário' : activeItem.label
  const groups = Array.from(new Set(allowedItems.map((item) => item.group)))
  function navigate(key: ModuleKey) {
    if (!allowedItems.some((item) => item.key === key)) return
    setActive(key)
    localStorage.setItem(`${preferenceKey}-active`, key)
    setMobileMenu(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  useEffect(() => { localStorage.setItem(`${preferenceKey}-compact`, String(compactSidebar)) }, [compactSidebar, preferenceKey])
  useEffect(() => {
    let sequence = ''
    const onShortcut = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName || ''
      if (event.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) { event.preventDefault(); setHelpOpen((value) => !value); return }
      if (event.key === 'Escape') { setHelpOpen(false); return }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      sequence = `${sequence}${event.key.toLowerCase()}`.slice(-2)
      const shortcuts: Record<string, ModuleKey> = { gd: 'dashboard', gf: 'funcionarios', go: 'ordens', gl: 'financeiro', gr: 'relatorios', gh: 'rh' }
      const destination = shortcuts[sequence]
      if (destination && allowedItems.some((item) => item.key === destination)) { navigate(destination); sequence = '' }
      window.setTimeout(() => { sequence = '' }, 900)
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [allowedItems, preferenceKey])
  function renderPage() {
    if (active === 'dashboard') return managementProfiles.includes(user.perfil) ? <DashboardView token={token} user={user} onNavigate={navigate} /> : <><PageHeading eyebrow="Acesso restrito" title="Visão geral" /><ErrorState message="Esta visão está disponível somente para a gestão administrativa." /></>
    if (active === 'visao_inteligente') return adminProfiles.includes(user.perfil) ? <IntelligentView token={token} /> : <><PageHeading eyebrow="Acesso restrito" title="Visão inteligente" /><ErrorState message="Esta visão está disponível somente para perfis administradores." /></>
    if (active === 'funcionarios') {
      if (user.perfil === 'funcionario') return <EmployeeOwnDossier token={token} />
      if (managerProfiles.includes(user.perfil)) return <EmployeeManagementDashboard token={token} profile={user.perfil} />
      return <><PageHeading eyebrow="Acesso restrito" title="Gestão de funcionários" /><ErrorState message="A lista geral e os prontuários da equipe estão disponíveis somente para administradores." /></>
    }
    if (active === 'ordens') return adminProfiles.includes(user.perfil)
      ? <WorkOrdersDashboard token={token} onGoToProduction={() => navigate('producao')} />
      : <><PageHeading eyebrow="Acesso restrito" title="Ordens de serviço" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'financeiro') return adminProfiles.includes(user.perfil)
      ? <FinanceExecutiveDashboard token={token} onNavigateToReports={() => navigate('relatorios')} />
      : <><PageHeading eyebrow="Acesso restrito" title="Financeiro" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'dividas') return adminProfiles.includes(user.perfil)
      ? <DebtManagementDashboard token={token} />
      : <><PageHeading eyebrow="Acesso restrito" title="Gestão de dívidas" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'relatorios') return <FinanceReportsDashboard token={token} isAdmin={adminProfiles.includes(user.perfil)} />
    if (active === 'rh') return <AdminCenter token={token} initialTab="painel" />
    if (active === 'folha') return adminProfiles.includes(user.perfil)
      ? <PayrollManagementDashboard token={token} onNavigateToHR={() => navigate('rh')} />
      : <><PageHeading eyebrow="Acesso restrito" title="Folha de pagamento" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'producao') return adminProfiles.includes(user.perfil)
      ? <FactoryProductionDashboard token={token} />
      : <><PageHeading eyebrow="Acesso restrito" title="Produção" /><ErrorState message="Ordens e produção estão disponíveis somente para perfis administradores." /></>
    if (active === 'perfil') return <EmployeeProfileView token={token} onProfileUpdated={setProfile} />
    if (active === 'ponto') return <PointView token={token} user={user} />
    if (active === 'ferias') return <EmployeeVacationPortal token={token} isAdministrative={adminProfiles.includes(user.perfil)} />
    if (active === 'holerites') return <PayslipsView token={token} />
    if (active === 'atestados') return <EmployeeMedicalLeaves token={token} />
    if (active === 'avisos') return <NoticesView token={token} onUnreadChange={setUnreadNotices} canMarkRead={user.perfil === 'funcionario'} />
    if (active === 'solicitacoes') return <EmployeeHRRequests token={token} />
    if (active === 'importacoes') return <Suspense fallback={<LoadingState label="Carregando gestão de ponto…" />}><PointManagementDashboard team={(refreshSignal) => <PointView token={token} user={user} refreshSignal={refreshSignal} />} imports={<PointImportsView token={token} />} schedules={<PointSchedulesPanel token={token} />} /></Suspense>
    if (active === 'importar_holerite') return <PayslipImportDashboard token={token} onNavigateToPayroll={adminProfiles.includes(user.perfil) ? () => navigate('folha') : undefined} />
    if (active === 'beneficios_descontos') return adminProfiles.includes(user.perfil)
      ? <PayrollManagementDashboard token={token} initialTab="beneficios" />
      : <><PageHeading eyebrow="Acesso restrito" title="Folha de pagamento" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'acordos') return adminProfiles.includes(user.perfil)
      ? <AgreementsDashboard token={token} />
      : <><PageHeading eyebrow="Acesso restrito" title="Acordos e parcelas" /><ErrorState message="Esta tela está disponível somente para perfis administradores." /></>
    if (active === 'documentos') return <InternalDocumentsDashboard token={token} canManage={adminProfiles.includes(user.perfil)} />
    return <ControlModuleView token={token} module={active} />
  }
  return (
    <div className="app-shell">
      <aside id="primary-navigation" className={`sidebar ${mobileMenu ? 'is-open' : ''} ${compactSidebar ? 'is-compact' : ''}`} aria-label="Navegação principal">
        <div className="sidebar-brand">
          <img className="brand-logo" src={rfLogo} alt="RF — Rafaela Fernandes" />
          <div><strong>RF</strong><span>Rafaela Fernandes</span></div>
          <button className="close-mobile" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={18} /></button>
          <button className="sidebar-preference-button" type="button" onClick={() => setCompactSidebar((value) => !value)} aria-label={compactSidebar ? 'Expandir menu lateral' : 'Recolher menu lateral'} title={compactSidebar ? 'Expandir menu' : 'Recolher menu'}><ChevronLeft size={16} /></button>
        </div>
        <nav aria-label="Módulos do sistema">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-label">{group}</span>
              {allowedItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.key} className={`nav-item ${active === item.key ? 'active' : ''}`} onClick={() => navigate(item.key)}>
                    <Icon size={17} /><span>{item.key === 'funcionarios' && user.perfil === 'funcionario' ? 'Meu prontuário' : item.label}</span>{item.key === 'avisos' && unreadNotices > 0 && <span className="nav-badge" aria-label={`${unreadNotices} avisos não lidos`}>{unreadNotices > 99 ? '99+' : unreadNotices}</span>}{active === item.key && <ChevronRight className="nav-arrow" size={14} />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer-actions"><button className="help-button" type="button" onClick={() => setHelpOpen(true)}><HelpCircle size={17} /> Ajuda e atalhos <kbd>?</kbd></button><button className="logout-button" onClick={onLogout}><LogOut size={17} /> Sair da sessão</button></div>
      </aside>
      <div className={`shell-backdrop ${mobileMenu ? 'visible' : ''}`} onClick={() => setMobileMenu(false)} />
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menu" aria-controls="primary-navigation" aria-expanded={mobileMenu}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>RF Gestão</span><ChevronRight size={14} /><strong>{activeLabel}</strong></div>
          <div className="topbar-actions">
            <GlobalSearch token={token} canSearchAll={adminProfiles.includes(user.perfil)} onNavigate={navigate} />
            <span className="connection-status"><span className="live-dot">●</span> Supabase conectado</span>
            <div className="topbar-user">
              <UserAvatar name={displayName} url={profile?.avatar_url} className="topbar-avatar" />
              <div className="topbar-user-meta"><strong>{displayName}</strong><span>{displayCargo || profileLabel(user.perfil)}</span></div>
            </div>
          </div>
        </header>
        <div className="content-wrap"><Suspense fallback={<div className="module-loading-boundary"><LoadingState label="Carregando módulo…" /></div>}>{renderPage()}</Suspense></div>
        <footer className="app-footer"><span>RF Gestão · {new Date().getFullYear()}</span><span>Sessão segura</span></footer>
      </main>
      {helpOpen && <div className="phase3-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false) }}><section className="phase3-help-dialog" role="dialog" aria-modal="true" aria-labelledby="phase3-help-title"><header><div><span className="eyebrow">Produtividade RF Gestão</span><h2 id="phase3-help-title">Ajuda e atalhos</h2></div><button className="icon-button" type="button" onClick={() => setHelpOpen(false)} aria-label="Fechar ajuda"><X size={18} /></button></header><p>Use a busca global para localizar registros reais do seu escopo e os atalhos abaixo para navegar sem retirar as mãos do teclado.</p><div className="phase3-shortcuts"><div><kbd>/</kbd><span>Abrir busca global</span></div><div><kbd>?</kbd><span>Abrir esta ajuda</span></div><div><kbd>G</kbd><kbd>D</kbd><span>Visão geral</span></div><div><kbd>G</kbd><kbd>F</kbd><span>Funcionários</span></div><div><kbd>G</kbd><kbd>O</kbd><span>Ordens</span></div><div><kbd>G</kbd><kbd>L</kbd><span>Financeiro</span></div><div><kbd>G</kbd><kbd>R</kbd><span>Relatórios</span></div><div><kbd>G</kbd><kbd>H</kbd><span>Recursos humanos</span></div><div><kbd>Esc</kbd><span>Fechar janelas</span></div></div><footer><span>Preferências de menu e último módulo ficam salvas neste dispositivo.</span><button className="primary-button" type="button" onClick={() => setHelpOpen(false)}>Entendi</button></footer></section></div>}
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
  return <AppErrorBoundary><Shell user={user} token={token} onLogout={signOut} /></AppErrorBoundary>
}
