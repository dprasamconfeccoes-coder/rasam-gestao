import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Download,
  FileSpreadsheet,
  Scale,
  Upload,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
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
  Receipt,
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
  applyPointImport,
  importPoint,
  ignorePointImport,
  listAgreements,
  listCompanyDocuments,
  listImportedPoint,
  listPointImports,
  createRequest,
  dashboard,
  adminProntuario,
  adminCriarOrdem,
  getSession,
  getToken,
  listEmployees,
  listMedicalLeaves,
  listNotices,
  listOrders,
  listPayslips,
  listPoint,
  listRequests,
  login,
  logout,
  myProfile,
  setPassword,
  setToken,
  updateAvatar,
  uploadMedicalLeave,
} from './lib/api'
import type {
  DashboardResponse,
  EmployeeProfile,
  EmployeeRow,
  LoginResponse,
  MedicalLeaveRow,
  ModuleKey,
  NoticeRow,
  OrderRow,
  PayslipRow,
  PointRow,
  Profile,
  RequestRow,
  SessionUser,
  AgreementInstallment,
  CompanyDocument,
  PointImportRow,
  PointImportSummary,
} from './lib/types'
import { regimentoSections } from './data/regimento'
import { AdminCenterV2 as AdminCenter } from './features/AdminCenterV2'
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

const managerProfiles: Profile[] = ['gestor', 'administrador', 'admin']
const adminProfiles: Profile[] = ['administrador', 'admin']

type NavItem = { key: ModuleKey; label: string; description: string; icon: typeof Gauge; group: string; profiles: Profile[] }

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Visão geral', description: 'O que precisa de atenção hoje', icon: LayoutDashboard, group: 'Operação', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'funcionarios', label: 'Funcionários', description: 'Equipe e acessos', icon: UsersRound, group: 'Operação', profiles: managerProfiles },
  { key: 'ordens', label: 'Ordens de serviço', description: 'Prazos e andamento', icon: ClipboardList, group: 'Operação', profiles: managerProfiles },
  { key: 'producao', label: 'Produção', description: 'Lotes e costura', icon: Factory, group: 'Operação', profiles: managerProfiles },
  { key: 'financeiro', label: 'Financeiro', description: 'Fluxo e compromissos', icon: CircleDollarSign, group: 'Controle', profiles: managerProfiles },
  { key: 'dividas', label: 'Dívidas', description: 'Saldos e vencimentos', icon: WalletCards, group: 'Controle', profiles: adminProfiles },
  { key: 'rh', label: 'Recursos humanos', description: 'Férias e afastamentos', icon: BriefcaseBusiness, group: 'Pessoas', profiles: managerProfiles },
  { key: 'relatorios', label: 'Relatórios', description: 'Leituras da operação', icon: BarChart3, group: 'Controle', profiles: managerProfiles },
  { key: 'perfil', label: 'Meu perfil', description: 'Dados cadastrais', icon: UserRound, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'ponto', label: 'Meu ponto', description: 'Jornada registrada', icon: Fingerprint, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'holerites', label: 'Holerites', description: 'Comprovantes disponíveis', icon: Receipt, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'atestados', label: 'Atestados', description: 'Histórico e conferência', icon: HeartPulse, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'solicitacoes', label: 'Solicitações ao RH', description: 'Acompanhe seus pedidos', icon: FileCheck2, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'avisos', label: 'Avisos', description: 'Comunicados da empresa', icon: Bell, group: 'Minha área', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'importacoes', label: 'Importar ponto', description: 'CSV diário e mensal', icon: FileSpreadsheet, group: 'Administração', profiles: managerProfiles },
  { key: 'acordos', label: 'Acordos e parcelas', description: 'Pagamentos trabalhistas', icon: Scale, group: 'Administração', profiles: adminProfiles },
  { key: 'documentos', label: 'Documentos internos', description: 'Regimento e CCT', icon: BookOpen, group: 'Administração', profiles: ['funcionario', 'gestor', 'administrador', 'admin'] },
  { key: 'central', label: 'Central operacional', description: 'RH, ponto, holerites e gestão total', icon: ShieldCheck, group: 'Administração', profiles: adminProfiles },
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
  const [state, setState] = useState<{ loading: boolean; data?: DashboardResponse; error?: string }>({ loading: true })
  useEffect(() => { dashboard(token).then((data) => setState({ loading: false, data })).catch((err) => setState({ loading: false, error: err instanceof Error ? err.message : 'Erro desconhecido' })) }, [token])
  if (state.loading) return <><PageHeading eyebrow="Pulso da operação" title="Visão geral" description={`Bom dia, ${user.nome.split(' ')[0]}. Aqui está o que merece atenção.`} /><LoadingState /></>
  if (state.error || !state.data?.sucesso) return <><PageHeading eyebrow="Pulso da operação" title="Visão geral" /><ErrorState message={state.error || state.data?.erro || 'Sessão inválida'} /></>
  const indicators = state.data.indicadores!
  const isEmployee = user.perfil === 'funcionario'
  return <>
    <PageHeading eyebrow="Pulso da operação" title="Visão geral" description={`Bom dia, ${user.nome.split(' ')[0]}. Aqui está o que merece atenção.`} action={<span className="date-chip"><CalendarDays size={15} /> {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</span>} />
    <div className="welcome-strip"><div><span className="eyebrow">Acesso liberado</span><h2>{profileLabel(user.perfil)} <span className="gold-text">· {user.cargo || 'RF Gestão'}</span></h2><p>As informações abaixo vêm do ambiente operacional em tempo real.</p></div><div className="welcome-symbol"><Gauge size={34} /></div></div>
    <div className="metric-grid">
      {isEmployee ? <>
        <MetricCard label="Meu ponto" value="Consultar" detail="Jornada registrada" tone="gold" />
        <MetricCard label="Holerites" value="Acessar" detail="Comprovantes disponíveis" tone="pink" />
        <MetricCard label="Atestados" value="Enviar" detail="Histórico e status" tone="green" />
        <MetricCard label="Avisos" value="Ler" detail="Comunicados da empresa" tone="blue" />
      </> : <>
        <MetricCard label="Equipe ativa" value={indicators.funcionarios_ativos} detail="Abrir funcionários" tone="gold" onClick={() => onNavigate('funcionarios')} />
        <MetricCard label="Ordens ativas" value={indicators.ordens_ativas} detail="Abrir ordens de serviço" tone="pink" onClick={() => onNavigate('ordens')} />
        <MetricCard label="Lotes em costura" value={indicators.lotes_em_costura} detail="Abrir produção" tone="green" onClick={() => onNavigate('producao')} />
        <MetricCard label="Contas pendentes" value={indicators.contas_pendentes} detail="Abrir financeiro" tone="blue" onClick={() => onNavigate('financeiro')} />
      </>}
    </div>
    <div className="dashboard-columns">
      <SectionCard title={isEmployee ? 'Acesso rápido' : 'Pontos de controle'} caption={isEmployee ? 'O que você pode consultar agora' : 'Atalhos para a decisão do dia'}>
        <div className="quick-list">
          {(isEmployee ? ([['ponto', 'Meu ponto', 'Veja seus registros de jornada', Fingerprint], ['holerites', 'Holerites', 'Acesse seus comprovantes', Receipt], ['solicitacoes', 'Falar com o RH', 'Abra ou acompanhe uma solicitação', FileText]] as const) : ([['funcionarios', 'Equipe', 'Cadastros e perfis de acesso', UsersRound], ['ordens', 'Ordens de serviço', 'Prazos e andamento', ClipboardList], ['financeiro', 'Financeiro', 'Compromissos e fluxo', CircleDollarSign]] as const)).map(([key, label, detail, Icon]) => <button className="quick-item" key={key} onClick={() => onNavigate(key as ModuleKey)}><span className="quick-icon"><Icon size={18} /></span><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={17} /></button>)}
        </div>
      </SectionCard>
      <SectionCard title="Leitura do ambiente" caption="Acesso e segurança">
        <div className="security-note"><div className="security-icon"><ShieldCheck size={20} /></div><div><strong>Sessão protegida</strong><p>Seu perfil de {profileLabel(user.perfil).toLowerCase()} está validado por RPC e permissões do Supabase.</p></div></div>
        <div className="security-row"><span>Saldo de dívidas</span><strong>{isEmployee ? 'Restrito ao seu perfil' : formatMoney(indicators.saldo_dividas)}</strong></div>
        <div className="security-row"><span>Em férias hoje</span><strong>{isEmployee ? 'Disponível ao RH' : indicators.em_ferias}</strong></div>
        <div className="security-row"><span>Em afastamento</span><strong>{isEmployee ? 'Disponível ao RH' : indicators.em_afastamento}</strong></div>
      </SectionCard>
    </div>
  </>
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

function OrdersView({ token }: { token: string }) {
  const [rows, setRows] = useState<OrderRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [open, setOpen] = useState(false); const [form, setForm] = useState({ numero: '', descricao: '', prioridade: 'normal', prazo: '', quantidade: '1', valor: '', observacoes: '' })
  async function reload() { setLoading(true); try { const data = await listOrders(token); if (!data.sucesso) throw new Error(data.erro || 'Acesso negado'); setRows(data.ordens || []) } catch (err) { setError(err instanceof Error ? err.message : 'Falha de consulta') } finally { setLoading(false) } }
  useEffect(() => { reload() }, [token])
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); try { const result = await adminCriarOrdem(token, { numero: form.numero, descricao: form.descricao, prioridade: form.prioridade, prazo: form.prazo, quantidade: Number(form.quantidade), valor: Number(form.valor || 0), observacoes: form.observacoes }); if (!result.sucesso) throw new Error(result.erro || 'Não foi possível criar a ordem'); setOpen(false); setForm({ numero: '', descricao: '', prioridade: 'normal', prazo: '', quantidade: '1', valor: '', observacoes: '' }); await reload() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao criar ordem') } }
  return <><PageHeading eyebrow="Operação · produção" title="Ordens de serviço" description="Acompanhe prazos, prioridade e valor da operação." action={<button className="primary-button" onClick={() => setOpen(!open)}><ClipboardList size={16} /> {open ? 'Fechar cadastro' : 'Nova ordem'}</button>} />{open && <SectionCard title="Nova ordem de serviço" caption="O lançamento já nasce com status recebida"><form className="form-stack" onSubmit={submit}><div className="form-row"><label>Número<input required value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="OS-0001" /></label><label>Prioridade<select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })}><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label></div><label>Descrição<input required value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label><div className="form-row"><label>Prazo<input type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} /></label><label>Quantidade<input type="number" min="1" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} /></label><label>Valor total<input type="number" min="0" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></label></div><label>Observações<textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label><button className="primary-button" type="submit">Criar ordem</button></form></SectionCard>}{error && <ErrorState message={error} />}<SectionCard title="Fila operacional" caption="Dados vindos de ordens_servico">{loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="A fila está sem ordens cadastradas" description="Use Nova ordem para lançar o primeiro pedido da produção." /> : <div className="table-wrap"><table><thead><tr><th>Ordem</th><th>Cliente</th><th>Descrição</th><th>Status</th><th>Prazo</th><th>Valor</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mono"><strong>{row.numero}</strong></td><td>{row.cliente || '—'}</td><td>{row.descricao}</td><td><StatusPill value={row.status.replaceAll('_', ' ')} /></td><td>{formatDate(row.prazo)}</td><td>{formatMoney(row.valor_total)}</td></tr>)}</tbody></table></div>}</SectionCard></>
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

function PointView({ token }: { token: string }) {
  const [rows, setRows] = useState<PointRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { listPoint(token).then((data) => { if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta'); setRows(data.registros || []) }).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')).finally(() => setLoading(false)) }, [token])
  return <><PageHeading eyebrow="Minha área · jornada" title="Meu ponto" description="Registros de jornada associados ao seu funcionário." /><SectionCard title="Histórico de ponto" caption="Últimos 180 registros">{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Ainda não há ponto registrado" description="Quando o RH lançar sua jornada, os registros aparecerão aqui." /> : <div className="table-wrap"><table><thead><tr><th>Data</th><th>Entrada</th><th>Almoço</th><th>Retorno</th><th>Saída</th><th>Horas</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.data)}</td><td>{row.entrada || '—'}</td><td>{row.saida_almoco || '—'}</td><td>{row.volta_almoco || '—'}</td><td>{row.saida || '—'}</td><td>{row.horas_trabalhadas || '—'}</td><td><StatusPill value={row.status || 'normal'} /></td></tr>)}</tbody></table></div>}</SectionCard></>
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

function NoticesView({ token }: { token: string }) {
  const [rows, setRows] = useState<NoticeRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { listNotices(token).then((data) => { if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta'); setRows(data.avisos || []) }).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')).finally(() => setLoading(false)) }, [token])
  return <><PageHeading eyebrow="Minha área · comunicação" title="Avisos" description="Comunicados oficiais publicados pela empresa." /><SectionCard title="Comunicados publicados" caption="Somente avisos liberados pelo RH">{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum aviso publicado" description="Quando houver um novo comunicado, ele aparecerá nesta lista." /> : <div className="notice-list">{rows.map((row) => <article className="notice-card" key={row.id}><div className="notice-head"><StatusPill value={row.prioridade} /><span>{formatDate(row.publicado_em || row.created_at)}</span></div><h3>{row.titulo}</h3><p>{row.conteudo}</p></article>)}</div>}</SectionCard></>
}

function RequestsView({ token }: { token: string }) {
  const [rows, setRows] = useState<RequestRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [type, setType] = useState('Dúvida ao RH'); const [description, setDescription] = useState(''); const [saving, setSaving] = useState(false); const [success, setSuccess] = useState('')
  async function reload() { setLoading(true); try { const data = await listRequests(token); if (!data.sucesso) throw new Error(data.erro || 'Falha de consulta'); setRows(data.solicitacoes || []) } catch (err) { setError(err instanceof Error ? err.message : 'Falha de consulta') } finally { setLoading(false) } }
  useEffect(() => { reload() }, [token])
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setSuccess(''); setError(''); try { const data = await createRequest(token, type, description); if (!data.sucesso) throw new Error(data.erro || 'Não foi possível registrar'); setDescription(''); setSuccess('Solicitação registrada no RH.'); await reload() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao registrar') } finally { setSaving(false) } }
  return <><PageHeading eyebrow="Minha área · relacionamento" title="Solicitações ao RH" description="Abra um pedido e acompanhe o retorno do departamento pessoal." /><div className="two-column"><SectionCard title="Nova solicitação" caption="O registro será associado ao seu funcionário"><form className="form-stack" onSubmit={submit}><label>Tipo<select value={type} onChange={(event) => setType(event.target.value)}><option>Dúvida ao RH</option><option>Correção cadastral</option><option>Férias</option><option>Documento</option><option>Benefício</option></select></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descreva o que você precisa…" rows={6} /></label>{error && <div className="form-error"><AlertCircle size={16} />{error}</div>}{success && <div className="form-success"><Check size={16} />{success}</div>}<button className="primary-button" type="submit" disabled={saving}>{saving ? <><RefreshCw className="spin" size={16} /> Enviando…</> : <>Registrar solicitação <ArrowRight size={16} /></>}</button></form></SectionCard><SectionCard title="Meus pedidos" caption="Status atualizado pelo RH">{loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="Nenhuma solicitação aberta" description="Seu histórico de pedidos aparecerá aqui." /> : <div className="request-list">{rows.map((row) => <div className="request-row" key={row.id}><div><div className="row-kicker">{row.tipo} · {formatDate(row.created_at)}</div><strong>{row.descricao}</strong>{row.resposta && <p>Resposta: {row.resposta}</p>}</div><StatusPill value={row.status} /></div>)}</div>}</SectionCard></div></>
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

function AgreementsView({ token }: { token: string }) { const [rows, setRows] = useState<AgreementInstallment[]>([]); const [error, setError] = useState(''); useEffect(() => { listAgreements(token).then((data) => { if (!data.sucesso) throw new Error(data.erro || 'Acesso negado'); setRows(data.parcelas || []) }).catch((err) => setError(err instanceof Error ? err.message : 'Falha de consulta')) }, [token]); return <><PageHeading eyebrow="Administração · compromissos" title="Acordos e parcelas" description="Pagamentos trabalhistas extraídos do relatório real, com quitadas e futuras separadas." action={<button className="secondary-button" onClick={() => printReport('Acordos e parcelas', ['Processo','Parcela','Valor','Vencimento','Status'], rows.map((row) => [row.processo, String(row.numero), formatMoney(row.valor), formatDate(row.vencimento), row.status]))}><Download size={16} /> Gerar PDF</button>} /><SectionCard title={`${rows.length} parcelas registradas`} caption="Relatório de pagamentos de acordos">{error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="Nenhum acordo registrado" description="Os dados aparecerão após a carga do relatório de pagamentos." /> : <div className="table-wrap"><table><thead><tr><th>Processo</th><th>Parcela</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mono">{row.processo}</td><td>{row.numero}</td><td>{formatMoney(row.valor)}</td><td>{formatDate(row.vencimento)}</td><td><StatusPill value={row.status} /></td></tr>)}</tbody></table></div>}</SectionCard></> }

function DocumentsView({ token }: { token: string }) { const [docs, setDocs] = useState<CompanyDocument[]>([]); const [query, setQuery] = useState(''); useEffect(() => { listCompanyDocuments(token).then((data) => setDocs(data.documentos || [])).catch(() => undefined) }, [token]); const sections = regimentoSections.filter((section) => !query || `${section.title} ${section.items.join(' ')}`.toLowerCase().includes(query.toLowerCase())); return <><PageHeading eyebrow="Minha área · normas" title="Documentos internos" description="Consulte o regimento e a Convenção Coletiva disponibilizados pela empresa." action={<div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no regimento" /></div>} /><div className="document-list">{docs.map((doc) => <div className="document-row" key={doc.id}><span className="document-icon"><BookOpen size={18} /></span><div><strong>{doc.titulo}</strong><small>{doc.arquivo_nome || 'Documento interno'} · {doc.disponivel_funcionarios ? 'Disponível aos funcionários' : 'Administrativo'}</small></div>{doc.arquivo_url && <a className="icon-button" href={doc.arquivo_url} target="_blank" rel="noreferrer" aria-label="Abrir documento"><ArrowRight size={17} /></a>}</div>)}</div><SectionCard title="Regimento Interno · consulta rápida" caption={`${sections.length} seções encontradas`}><div className="policy-list">{sections.map((section) => <details key={section.title} open={Boolean(query)}><summary>{section.title}</summary><div className="policy-content">{section.items.map((item, index) => <p key={`${section.title}-${index}`}>{item}</p>)}</div></details>)}</div></SectionCard></> }

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
  useEffect(() => { myProfile(token).then((data) => { if (data.sucesso && data.funcionario) setProfile(data.funcionario) }).catch(() => undefined) }, [token])
  const displayName = profile?.nome || user.nome
  const displayCargo = profile?.cargo || user.cargo
  const activeItem = navItems.find((item) => item.key === active) || navItems[0]
  const groups = Array.from(new Set(allowedItems.map((item) => item.group)))
  function navigate(key: ModuleKey) { setActive(key); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function renderPage() {
    if (active === 'dashboard') return <DashboardView token={token} user={user} onNavigate={navigate} />
    if (active === 'funcionarios') return <EmployeesView token={token} />
    if (active === 'ordens') return <OrdersView token={token} />
    if (active === 'financeiro' || active === 'dividas') return <AdminCenter token={token} initialTab="financeiro" />
    if (active === 'relatorios') return <AdminCenter token={token} initialTab="fechamento" />
    if (active === 'rh') return <AdminCenter token={token} initialTab="prontuario" />
    if (active === 'producao') return <AdminCenter token={token} initialTab="producao" />
    if (active === 'perfil') return <EmployeeProfileView token={token} onProfileUpdated={setProfile} />
    if (active === 'ponto') return <PointView token={token} />
    if (active === 'holerites') return <PayslipsView token={token} />
    if (active === 'atestados') return <MedicalLeavesView token={token} />
    if (active === 'avisos') return <NoticesView token={token} />
    if (active === 'solicitacoes') return <RequestsView token={token} />
    if (active === 'importacoes') return <PointImportsView token={token} />
    if (active === 'acordos') return <AgreementsView token={token} />
    if (active === 'documentos') return <DocumentsView token={token} />
    if (active === 'central') return <AdminCenter token={token} />
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
        <button className="sidebar-user" onClick={() => navigate('perfil')} aria-label="Abrir meu perfil">
          <UserAvatar name={displayName} url={profile?.avatar_url} />
          <span><strong>{displayName}</strong><span>{displayCargo || profileLabel(user.perfil)}</span></span>
          <ChevronRight className="sidebar-user-arrow" size={15} />
        </button>
        <nav>
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-label">{group}</span>
              {allowedItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.key} className={`nav-item ${active === item.key ? 'active' : ''}`} onClick={() => navigate(item.key)}>
                    <Icon size={17} /><span>{item.label}</span>{active === item.key && <ChevronRight className="nav-arrow" size={14} />}
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
