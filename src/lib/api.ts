import { supabase } from './supabase'
import { config } from './config'
import type {
  DashboardResponse,
  AgreementInstallment,
  CompanyDocument,
  EmployeeProfile,
  EmployeeRow,
  LoginResponse,
  MedicalLeaveRow,
  NoticeRow,
  OrderRow,
  PayslipRow,
  PointRow,
  PointImportRow,
  PointImportSummary,
  RequestRow,
  SessionUser,
} from './types'

const tokenKey = 'rasam-session-token'

export function getToken() {
  return sessionStorage.getItem(tokenKey)
}

export function setToken(token: string) {
  sessionStorage.setItem(tokenKey, token)
}

export function clearToken() {
  sessionStorage.removeItem(tokenKey)
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export function login(cpf: string, senha: string) {
  return rpc<LoginResponse>('app_login', { p_cpf: cpf, p_senha: senha })
}

export function getSession(token: string) {
  return rpc<{ valido: boolean } & SessionUser>('app_sessao', { p_token: token })
}

export function setPassword(token: string, password: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_definir_senha', {
    p_token: token,
    p_nova_senha: password,
  })
}

export function logout(token: string) {
  return rpc<{ sucesso: boolean }>('app_logout', { p_token: token })
}

export function dashboard(token: string) {
  return rpc<DashboardResponse>('app_dashboard', { p_token: token })
}

export function listEmployees(token: string) {
  return rpc<EmployeeRow[]>('app_listar_funcionarios', { p_token: token })
}

export function myProfile(token: string) {
  return rpc<{ sucesso: boolean; funcionario?: EmployeeProfile; erro?: string }>('app_meu_perfil', {
    p_token: token,
  })
}

export function listPoint(token: string) {
  return rpc<{ sucesso: boolean; registros: PointRow[]; erro?: string }>('app_listar_ponto', {
    p_token: token,
    p_limite: 180,
  })
}

export function listPayslips(token: string) {
  return rpc<{ sucesso: boolean; holerites: PayslipRow[]; erro?: string }>('app_listar_holerites', {
    p_token: token,
  })
}

export function listNotices(token: string) {
  return rpc<{ sucesso: boolean; avisos: NoticeRow[]; erro?: string }>('app_listar_avisos', {
    p_token: token,
  })
}

export function listRequests(token: string) {
  return rpc<{ sucesso: boolean; solicitacoes: RequestRow[]; erro?: string }>('app_listar_solicitacoes', {
    p_token: token,
  })
}

export function createRequest(token: string, tipo: string, descricao: string) {
  return rpc<{ sucesso: boolean; id?: string; erro?: string }>('app_criar_solicitacao', {
    p_token: token,
    p_tipo: tipo,
    p_descricao: descricao,
  })
}

export function listMedicalLeaves(token: string) {
  return rpc<{ sucesso: boolean; atestados: MedicalLeaveRow[]; erro?: string }>('app_listar_atestados', {
    p_token: token,
  })
}

export async function uploadMedicalLeave(token: string, payload: { tipo: string; dataAtendimento: string; dias: number; observacao: string; file: File }) {
  const form = new FormData()
  form.set('tipo', payload.tipo)
  form.set('data_atendimento', payload.dataAtendimento)
  form.set('dias', String(payload.dias))
  form.set('observacao', payload.observacao)
  form.set('arquivo', payload.file)
  const response = await fetch(`${config.supabaseUrl}/functions/v1/atestado-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-app-token': token },
    body: form,
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; status_label?: string }
  if (!response.ok || !data.sucesso) throw new Error(data.erro || 'Não foi possível enviar o atestado')
  return data
}

export function listOrders(token: string) {
  return rpc<{ sucesso: boolean; ordens: OrderRow[]; erro?: string }>('app_listar_ordens', {
    p_token: token,
  })
}

export function importPoint(token: string, payload: { tipo: 'diario' | 'mensal'; competencia: string; arquivoNome: string; linhas: Record<string, unknown>[] }) {
  return rpc<{ sucesso: boolean; erro?: string; total_linhas?: number; linhas_encontradas?: number; linhas_nao_encontradas?: number; cpfs_nao_encontrados?: string[] }>('app_importar_ponto', {
    p_token: token,
    p_tipo: payload.tipo,
    p_competencia: payload.competencia,
    p_arquivo_nome: payload.arquivoNome,
    p_linhas: payload.linhas,
  })
}

export function listPointImports(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; importacoes: PointImportSummary[] }>('app_listar_importacoes', { p_token: token })
}

export function listImportedPoint(token: string, tipo?: 'diario' | 'mensal') {
  return rpc<{ sucesso: boolean; erro?: string; registros: PointImportRow[] }>('app_listar_ponto_importado', { p_token: token, p_tipo: tipo || null })
}

export function listAgreements(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; parcelas: AgreementInstallment[] }>('app_listar_acordos', { p_token: token })
}

export function listCompanyDocuments(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; documentos: CompanyDocument[] }>('app_listar_documentos', { p_token: token })
}
