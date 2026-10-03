import { supabase } from './supabase'
import { config } from './config'
import type {
  DashboardResponse,
  AgreementInstallment,
  AdminDebtRow,
  AdminJustificationRow,
  AdminLotRow,
  AdminMedicalLeaveRow,
  AdminOrderRow,
  AdminPayslipRow,
  AdminPointRow,
  AdminRequestRow,
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
  return rpc<{ valido: boolean; primeiro_acesso?: boolean } & SessionUser>('app_sessao', { p_token: token })
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

export function adminPoint(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; registros: AdminPointRow[] }>('app_admin_ponto', { p_token: token })
}

export function adminJustifications(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; justificativas: AdminJustificationRow[] }>('app_admin_justificativas', { p_token: token })
}

export function decideJustification(token: string, id: string, status: string, resposta: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_decidir_justificativa', { p_token: token, p_id: id, p_status: status, p_resposta: resposta })
}

export function adminMedicalLeaves(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; atestados: AdminMedicalLeaveRow[] }>('app_admin_atestados', { p_token: token })
}

export function decideMedicalLeave(token: string, id: string, status: string, observacao: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_decidir_atestado', { p_token: token, p_id: id, p_status: status, p_observacao: observacao })
}

export function adminRequests(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; solicitacoes: AdminRequestRow[] }>('app_admin_solicitacoes', { p_token: token })
}

export function answerRequest(token: string, id: string, status: string, resposta: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_responder_solicitacao', { p_token: token, p_id: id, p_status: status, p_resposta: resposta })
}

export function publishNotice(token: string, titulo: string, conteudo: string, prioridade: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_publicar_aviso', { p_token: token, p_titulo: titulo, p_conteudo: conteudo, p_prioridade: prioridade })
}

export function adminPayslips(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; holerites: AdminPayslipRow[] }>('app_admin_holerites', { p_token: token })
}

export function registerPayslip(token: string, funcionarioId: string, mes: number, ano: number, arquivoNome: string, arquivoUrl: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_registrar_holerite', { p_token: token, p_funcionario_id: funcionarioId, p_mes: mes, p_ano: ano, p_arquivo_nome: arquivoNome, p_arquivo_url: arquivoUrl })
}

export function adminRights(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; dividas: AdminDebtRow[]; ordens: AdminOrderRow[]; producao: AdminLotRow[] }>('app_admin_direitos', { p_token: token })
}

export function updateDebt(token: string, id: string, status: string, saldo: number) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_atualizar_divida', { p_token: token, p_id: id, p_status: status, p_saldo: saldo })
}

export function updateOrder(token: string, id: string, status: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_atualizar_ordem', { p_token: token, p_id: id, p_status: status })
}

export function updateLot(token: string, id: string, status: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_atualizar_lote', { p_token: token, p_id: id, p_status: status })
}


export function adminProntuario(token: string, funcionarioId: string) {
  return rpc<import('./types').ProntuarioResponse>('app_admin_prontuario', { p_token: token, p_funcionario_id: funcionarioId })
}

export function adminCadastrarFuncionario(token: string, payload: { nome: string; cpf: string; dataNascimento: string; tipoVinculo: string; cargo: string; telefone: string; endereco: string; valorMensal: number | null; valorDiaria: number | null; liberarAcesso: boolean }) {
  return rpc<{ sucesso: boolean; erro?: string; funcionario_id?: string }>('app_admin_cadastrar_funcionario', {
    p_token: token, p_nome: payload.nome, p_cpf: payload.cpf, p_data_nascimento: payload.dataNascimento, p_tipo_vinculo: payload.tipoVinculo,
    p_cargo: payload.cargo, p_telefone: payload.telefone, p_endereco: payload.endereco, p_valor_mensal: payload.valorMensal,
    p_valor_diaria: payload.valorDiaria, p_liberar_acesso: payload.liberarAcesso,
  })
}

export function adminCalcularFechamento(token: string, competencia: string, incluirInformaisVale: boolean) {
  return rpc<import('./types').FechamentoResult>('app_admin_calcular_fechamento', { p_token: token, p_competencia: competencia, p_incluir_informais_vale: incluirInformaisVale })
}

export function adminRelatorioFechamento(token: string, competencia: string, tipo: 'escritorio' | 'vale', incluirInformaisVale = false) {
  return rpc<import('./types').FechamentoReport>('app_admin_relatorio_fechamento', { p_token: token, p_competencia: competencia, p_tipo: tipo, p_incluir_informais_vale: incluirInformaisVale })
}

export function adminFinanceiroWorkspace(token: string) {
  return rpc<import('./types').FinanceiroWorkspace>('app_admin_financeiro', { p_token: token })
}

export function adminQuitarParcela(token: string, id: string, comprovanteUrl?: string, comprovanteNome?: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_quitar_parcela', { p_token: token, p_id: id, p_comprovante_url: comprovanteUrl || null, p_comprovante_nome: comprovanteNome || null })
}

export function adminCriarRecorrencia(token: string, payload: { descricao: string; categoria: string; fornecedor: string; valor: number; periodicidade: string; proximoVencimento: string }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_criar_recorrencia', { p_token: token, p_descricao: payload.descricao, p_categoria: payload.categoria, p_fornecedor: payload.fornecedor, p_valor: payload.valor, p_periodicidade: payload.periodicidade, p_proximo_vencimento: payload.proximoVencimento })
}
export function adminCriarParcelamento(token: string, payload: { tipo: string; credor: string; descricao: string; entrada: number; quantidade: number; valorPadrao: number; primeiroVencimento: string; valores: number[] }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_criar_parcelamento', { p_token: token, p_tipo: payload.tipo, p_credor: payload.credor, p_descricao: payload.descricao, p_valor_entrada: payload.entrada, p_quantidade: payload.quantidade, p_valor_padrao: payload.valorPadrao, p_primeiro_vencimento: payload.primeiroVencimento, p_valores: payload.valores })
}
