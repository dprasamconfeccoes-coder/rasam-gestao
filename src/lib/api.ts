import { supabase } from './supabase'
import { config } from './config'
import type {
  DashboardResponse,
  FactoryProductionResponse,
  AgreementInstallment,
  CreateAgreementPayload,
  CreateWorkOrderPayload,
  WorkOrderDashboardResponse,
  WorkOrderProgressPayload,
  AdminNoticePage,
  AdminDebtRow,
  AdminJustificationRow,
  AdminLotRow,
  AdminMedicalLeaveDashboardPage,
  AdminMedicalLeaveRow,
  AdminOrderRow,
  AdminPayslipRow,
  AdminPointRow,
  AdminRequestsPage,
  AdminRequestRow,
  AdminVacationRow,
  AdminVacationManagementRow,
  VacationReconciliationSummary,
  VacationImportBatch,
  CompanyDocument,
  DebtCategory,
  DebtDashboardResponse,
  DebtPaymentMethod,
  EmployeeProfile,
  EmployeeFichaPayload,
  EmployeeRow,
  LoginResponse,
  MedicalLeaveRow,
  NoticeAttachmentRow,
  NoticeRow,
  NoticeEmployeeReadRow,
  OrderDocumentRow,
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
  return rpc<DashboardResponse>('app_dashboard_v2', { p_token: token })
}

export function listEmployees(token: string) {
  return rpc<EmployeeRow[]>('app_listar_funcionarios', { p_token: token })
}

export function myProfile(token: string) {
  return rpc<{ sucesso: boolean; funcionario?: EmployeeProfile; erro?: string }>('app_meu_perfil', {
    p_token: token,
  })
}

export function updateAvatar(token: string, avatarUrl: string | null) {
  return rpc<{ sucesso: boolean; avatar_url?: string | null; erro?: string }>('app_atualizar_avatar', {
    p_token: token,
    p_avatar_url: avatarUrl,
  })
}

export function listPoint(token: string, filters: { inicio?: string | null; fim?: string | null; funcionarioId?: string | null; limite?: number } = {}) {
  return rpc<{ sucesso: boolean; registros: PointRow[]; erro?: string; escopo?: 'individual' | 'equipe'; perfil?: string }>('app_listar_ponto', {
    p_token: token,
    p_limite: filters.limite ?? 500,
    p_inicio: filters.inicio ?? null,
    p_fim: filters.fim ?? null,
    p_funcionario_id: filters.funcionarioId ?? null,
  })
}

export function decidePointInconsistency(token: string, funcionarioId: string, data: string, status: 'aprovada' | 'justificada', justificativa = '') {
  return rpc<{ sucesso: boolean; erro?: string }>('app_decidir_inconsistencia_ponto', {
    p_token: token,
    p_funcionario_id: funcionarioId,
    p_data: data,
    p_status: status,
    p_justificativa: justificativa,
  })
}

export function decidePointJustification(token: string, id: string, status: 'aceita' | 'recusada' | 'pendente', resposta = '') {
  return rpc<{ sucesso: boolean; status?: string; erro?: string }>('app_decidir_justificativa_ponto', {
    p_token: token, p_id: id, p_status: status, p_resposta: resposta,
  })
}

export function createPointJustification(token: string, data: string, tipo: string, motivo: string, arquivoUrl?: string | null, arquivoNome?: string | null) {
  return rpc<{ sucesso: boolean; id?: string; status?: string; erro?: string }>('app_criar_justificativa_ponto', {
    p_token: token, p_data: data, p_tipo: tipo, p_motivo: motivo, p_arquivo_url: arquivoUrl || null, p_arquivo_nome: arquivoNome || null,
  })
}

export function listPayslips(token: string) {
  return rpc<{ sucesso: boolean; holerites: PayslipRow[]; erro?: string }>('app_listar_holerites', {
    p_token: token,
  })
}

export function listNotices(token: string) {
  return rpc<{ sucesso: boolean; avisos: NoticeRow[]; nao_lidos: number; erro?: string }>('app_listar_avisos', {
    p_token: token,
  })
}

export function unreadNoticeCount(token: string) {
  return rpc<{ sucesso: boolean; nao_lidos: number; erro?: string }>('app_contar_avisos_nao_lidos', { p_token: token })
}

export function markNoticeRead(token: string, id: string) {
  return rpc<{ sucesso: boolean; lido_em?: string; erro?: string }>('app_marcar_aviso_lido', { p_token: token, p_aviso_id: id })
}

export function listNoticeAttachments(token: string, noticeIds?: string[] | null) {
  return rpc<{ sucesso: boolean; anexos: NoticeAttachmentRow[]; erro?: string }>('app_listar_anexos_avisos', {
    p_token: token, p_aviso_ids: noticeIds === undefined ? null : noticeIds,
  })
}

export function removeNoticeAttachment(token: string, attachmentId: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_remover_aviso_anexo', { p_token: token, p_anexo_id: attachmentId })
}

export async function uploadNoticeAttachment(token: string, noticeId: string, file: File) {
  const form = new FormData()
  form.set('action', 'upload')
  form.set('aviso_id', noticeId)
  form.set('arquivo', file)
  const response = await fetch(`${config.supabaseUrl}/functions/v1/aviso-anexo`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token },
    body: form,
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; anexo_id?: string }
  if (!response.ok || !data.sucesso) throw new Error(data.erro || 'Não foi possível enviar o anexo')
  return data
}

export async function getNoticeAttachmentUrl(token: string, attachmentId: string, download = false) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/aviso-anexo`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signed-url', anexo_id: attachmentId, download }),
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; url?: string; expires_in?: number }
  if (!response.ok || !data.sucesso || !data.url) throw new Error(data.erro || 'Não foi possível abrir o anexo')
  return data
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

export async function uploadMedicalLeave(token: string, payload: { tipo: string; dataAtendimento: string; dias: number; cid?: string; observacao: string; file: File }) {
  const form = new FormData()
  form.set('tipo', payload.tipo)
  form.set('data_atendimento', payload.dataAtendimento)
  form.set('dias', String(payload.dias))
  form.set('cid', payload.cid || '')
  form.set('observacao', payload.observacao)
  form.set('arquivo', payload.file)
  const response = await fetch(`${config.supabaseUrl}/functions/v1/atestado-upload`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token },
    body: form,
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; status_label?: string }
  if (!response.ok || !data.sucesso) throw new Error(data.erro || 'Não foi possível enviar o atestado')
  return data
}

export async function getMedicalLeaveDocumentUrl(token: string, id: string) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/atestado-documento`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ atestado_id: id }),
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; url?: string }
  if (!response.ok || !data.sucesso || !data.url) throw new Error(data.erro || 'Não foi possível abrir o documento')
  return data.url
}

export function listOrders(token: string) {
  return rpc<{ sucesso: boolean; ordens: OrderRow[]; erro?: string }>('app_listar_ordens', {
    p_token: token,
  })
}

export function getWorkOrderDashboard(token: string) {
  return rpc<WorkOrderDashboardResponse>('app_admin_painel_ordens', { p_token: token })
}

export function getFactoryProduction(token: string) {
  return rpc<FactoryProductionResponse>('app_admin_painel_fabrica', { p_token: token })
}

export function startWorkOrderProduction(token: string, orderId: string) {
  return rpc<{ sucesso: boolean; erro?: string; status?: string }>('app_admin_iniciar_producao', {
    p_token: token, p_ordem_id: orderId,
  })
}

export function saveFactoryProduction(token: string, orderId: string, tamanhos: WorkOrderProgressPayload[]) {
  return rpc<{ sucesso: boolean; erro?: string; status?: string; tamanhos?: WorkOrderProgressPayload[] }>(
    'app_admin_salvar_progresso_fabrica', { p_token: token, p_ordem_id: orderId, p_tamanhos: tamanhos },
  )
}

export function releaseWorkOrderForFinance(token: string, orderId: string) {
  return rpc<{ sucesso: boolean; erro?: string; alterado?: boolean; financeiro_liberado_em?: string }>(
    'app_admin_liberar_ordem_financeiro', { p_token: token, p_ordem_id: orderId },
  )
}

export async function uploadWorkOrderDocument(token: string, orderId: string, type: OrderDocumentRow['tipo'], file: File) {
  const form = new FormData()
  form.set('action', 'upload')
  form.set('ordem_id', orderId)
  form.set('tipo', type)
  form.set('arquivo', file)
  const response = await fetch(`${config.supabaseUrl}/functions/v1/ordem-servico-documento`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token },
    body: form,
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; documento?: OrderDocumentRow }
  if (!response.ok || !data.sucesso || !data.documento) throw new Error(data.erro || 'Não foi possível enviar o documento')
  return data.documento
}

export async function getWorkOrderDocumentUrl(token: string, documentId: string, download = false) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/ordem-servico-documento`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signed-url', documento_id: documentId, download }),
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; url?: string; expires_in?: number }
  if (!response.ok || !data.sucesso || !data.url) throw new Error(data.erro || 'Não foi possível abrir o documento')
  return data
}

export function searchOrderClients(token: string, query: string) {
  return rpc<{ sucesso: boolean; erro?: string; clientes?: Array<{ id: string; nome: string }> }>('app_admin_buscar_clientes_ordem', {
    p_token: token,
    p_busca: query,
  })
}
export function createOrderClient(token: string, name: string) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string; nome?: string; existente?: boolean }>('app_admin_criar_cliente_ordem', {
    p_token: token,
    p_nome: name,
  })
}
export function createWorkOrder(token: string, payload: CreateWorkOrderPayload) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string; numero?: string; quantidade?: number; valor_total?: number }>('app_admin_criar_ordem_painel_v2', {
    p_token: token,
    p_cliente_id: payload.clienteId,
    p_descricao: payload.descricao,
    p_prioridade: payload.prioridade,
    p_prazo: payload.prazo,
    p_observacoes: payload.observacoes || null,
    p_tamanhos: payload.tamanhos,
  })
}

export function updateWorkOrderStatus(token: string, orderId: string, status: string) {
  return rpc<{ sucesso: boolean; erro?: string; alterado?: boolean }>('app_admin_atualizar_ordem_status', {
    p_token: token,
    p_ordem_id: orderId,
    p_status: status,
  })
}

export function updateWorkOrderFinance(token: string, orderId: string, statusPagamento: 'pendente' | 'pago', notaFiscalNumero: string) {
  return rpc<{ sucesso: boolean; erro?: string; status_pagamento?: string; nota_fiscal_numero?: string | null }>('app_admin_atualizar_ordem_financeiro', {
    p_token: token,
    p_ordem_id: orderId,
    p_status_pagamento: statusPagamento,
    p_nota_fiscal_numero: notaFiscalNumero || null,
  })
}

export function updateWorkOrderProgress(token: string, orderId: string, tamanhos: WorkOrderProgressPayload[]) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_atualizar_ordem_progresso', {
    p_token: token,
    p_ordem_id: orderId,
    p_tamanhos: tamanhos,
  })
}

export function importPoint(token: string, payload: { tipo: 'diario' | 'mensal'; competencia: string; arquivoNome: string; linhas: Record<string, unknown>[] }) {
  return rpc<{ sucesso: boolean; erro?: string; importacao_id?: string; status?: string; total_linhas?: number; linhas_encontradas?: number; linhas_nao_encontradas?: number; cpfs_nao_encontrados?: string[] }>('app_importar_ponto', {
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

export function applyPointImport(token: string, importacaoId: string) {
  return rpc<{ sucesso: boolean; erro?: string; status?: string; linhas_aplicadas?: number; linhas_inconsistentes?: number }>('app_aplicar_importacao_ponto', { p_token: token, p_importacao_id: importacaoId })
}

export function ignorePointImport(token: string, importacaoId: string) {
  return rpc<{ sucesso: boolean; erro?: string; status?: string }>('app_ignorar_importacao_ponto', { p_token: token, p_importacao_id: importacaoId })
}

export function listImportedPoint(token: string, tipo?: 'diario' | 'mensal', importacaoId?: string) {
  return rpc<{ sucesso: boolean; erro?: string; registros: PointImportRow[] }>('app_listar_ponto_importado', { p_token: token, p_tipo: tipo || null, p_importacao_id: importacaoId || null })
}

export function listAgreements(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; parcelas: AgreementInstallment[] }>('app_listar_acordos', { p_token: token })
}

export function createAgreement(token: string, payload: CreateAgreementPayload) {
  return rpc<{ sucesso: boolean; erro?: string; acordo_id?: string; quantidade_parcelas?: number }>('app_admin_salvar_acordo', {
    p_token: token,
    p_processo: payload.processo,
    p_funcionario_nome: payload.funcionarioNome || null,
    p_funcionario_cpf: payload.funcionarioCpf || null,
    p_observacoes: payload.observacoes || null,
    p_parcelas: payload.parcelas,
  })
}

export function updateAgreementInstallmentStatus(token: string, parcelaId: string, status: 'quitada' | 'pendente', motivo = '') {
  return rpc<{ sucesso: boolean; erro?: string; status?: string; pago_em?: string | null }>('app_admin_atualizar_status_acordo', {
    p_token: token,
    p_parcela_id: parcelaId,
    p_status: status,
    p_motivo: motivo || null,
  })
}

export function listCompanyDocuments(token: string) {
  return fetchInternalDocuments<{ sucesso: boolean; erro?: string; documentos: CompanyDocument[] }>(token, { action: 'list' })
}

export type InternalDocumentCategory = 'regimento' | 'cct' | 'ponto' | 'campanha' | 'comunicado' | 'politica' | 'outro'
export interface InternalDocumentDraft {
  grupoId?: string | null
  titulo: string
  categoria: InternalDocumentCategory
  descricao: string
  disponivelFuncionarios: boolean
  arquivo: File
}
export function updateInternalDocument(token: string, grupoId: string, payload: Omit<InternalDocumentDraft, 'grupoId' | 'arquivo'>) {
  return fetchInternalDocuments<{ sucesso: boolean; erro?: string }>(token, {
    action: 'update-metadata',
    grupo_id: grupoId,
    titulo: payload.titulo,
    categoria: payload.categoria,
    descricao: payload.descricao || null,
    disponivel_funcionarios: payload.disponivelFuncionarios,
  })
}
export function deleteInternalDocument(token: string, grupoId: string) {
  return fetchInternalDocuments<{ sucesso: boolean; erro?: string; versoes_arquivadas?: number }>(token, { action: 'delete', grupo_id: grupoId })
}
export function restoreInternalDocument(token: string, grupoId: string) {
  return fetchInternalDocuments<{ sucesso: boolean; erro?: string; versoes_restauradas?: number }>(token, { action: 'restore', grupo_id: grupoId })
}
async function fetchInternalDocuments<T>(token: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/documentos-internos`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json() as T & { erro?: string }
  if (!response.ok) throw new Error(data.erro || 'Não foi possível acessar o acervo de documentos.')
  return data
}
export async function uploadInternalDocument(token: string, payload: InternalDocumentDraft) {
  const groupId = payload.grupoId || crypto.randomUUID()
  const form = new FormData()
  form.set('grupo_id', groupId)
  form.set('titulo', payload.titulo)
  form.set('categoria', payload.categoria)
  form.set('descricao', payload.descricao)
  form.set('disponivel_funcionarios', String(payload.disponivelFuncionarios))
  form.set('arquivo', payload.arquivo)
  const response = await fetch(`${config.supabaseUrl}/functions/v1/documentos-internos`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token, 'x-document-group-id': groupId },
    body: form,
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; documento_id?: string; grupo_id?: string; versao?: number }
  if (!response.ok || !data.sucesso || !data.documento_id) throw new Error(data.erro || 'Não foi possível enviar o documento')
  return data
}
export async function getInternalDocumentDownloadUrl(token: string, documentId: string) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/documentos-internos`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}`, 'x-app-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documento_id: documentId }),
  })
  const data = (await response.json()) as { sucesso: boolean; erro?: string; url?: string; nome_arquivo?: string }
  if (!response.ok || !data.sucesso || !data.url) throw new Error(data.erro || 'Não foi possível preparar o download')
  return data
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

export function adminMedicalLeavesPage(token: string, mes: string, status: string, offset: number, limite: number) {
  return rpc<AdminMedicalLeaveDashboardPage>('app_admin_atestados_dashboard', {
    p_token: token,
    p_mes: mes || null,
    p_status: status,
    p_offset: offset,
    p_limite: limite,
  })
}

export function adminVacations(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; ferias: AdminVacationRow[] }>('app_admin_listar_ferias', { p_token: token })
}

export function adminVacationManagement(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; ferias: AdminVacationManagementRow[]; importacoes: VacationImportBatch[]; reconciliacao: VacationReconciliationSummary }>('app_admin_listar_ferias_gestao', { p_token: token })
}

export function confirmVacationImport(token: string, id: string, observacoes: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_confirmar_ferias_importacao', { p_token: token, p_id: id, p_observacoes: observacoes || null })
}

export function rejectVacationImport(token: string, id: string, observacoes: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_rejeitar_ferias_importacao', { p_token: token, p_id: id, p_observacoes: observacoes || null })
}

export function adminLeaves(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; afastamentos: import('./types').AdminLeaveRow[] }>('app_admin_listar_afastamentos', { p_token: token })
}

export function createAdminLeave(token: string, payload: { funcionarioId: string; tipo: string; inicio: string; fim: string; motivo: string; status: string }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_criar_afastamento', {
    p_token: token,
    p_funcionario_id: payload.funcionarioId,
    p_tipo: payload.tipo,
    p_inicio: payload.inicio,
    p_fim: payload.fim || null,
    p_motivo: payload.motivo || null,
    p_status: payload.status,
  })
}

export function updateAdminLeave(token: string, id: string, payload: { fim: string; motivo: string; status: string }) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_atualizar_afastamento', {
    p_token: token,
    p_id: id,
    p_fim: payload.fim || null,
    p_motivo: payload.motivo || null,
    p_status: payload.status,
  })
}

export function createAdminVacation(token: string, payload: { funcionarioId: string; periodoAquisitivoInicio: string; periodoAquisitivoFim: string; inicio: string; fim: string; status: string; observacoes: string }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_criar_ferias', {
    p_token: token,
    p_funcionario_id: payload.funcionarioId,
    p_periodo_aquisitivo_inicio: payload.periodoAquisitivoInicio,
    p_periodo_aquisitivo_fim: payload.periodoAquisitivoFim,
    p_inicio: payload.inicio,
    p_fim: payload.fim,
    p_status: payload.status,
    p_observacoes: payload.observacoes || null,
  })
}

export function updateAdminVacation(token: string, id: string, payload: { inicio: string; fim: string; status: string; observacoes: string }) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_atualizar_ferias', {
    p_token: token,
    p_id: id,
    p_inicio: payload.inicio,
    p_fim: payload.fim,
    p_status: payload.status,
    p_observacoes: payload.observacoes || null,
  })
}

export function decideMedicalLeave(token: string, id: string, status: string, observacao: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_decidir_atestado', { p_token: token, p_id: id, p_status: status, p_observacao: observacao })
}

export function adminRequests(token: string) {
  return rpc<{ sucesso: boolean; erro?: string; solicitacoes: AdminRequestRow[] }>('app_admin_solicitacoes', { p_token: token })
}

export function adminRequestsPage(token: string, mes: string | null, status: string, funcionarioId: string | null, tipo: string | null, offset: number, limite: number) {
  return rpc<AdminRequestsPage>('app_admin_solicitacoes_dashboard', {
    p_token: token,
    p_mes: mes,
    p_status: status,
    p_funcionario_id: funcionarioId,
    p_tipo: tipo,
    p_offset: offset,
    p_limite: limite,
  })
}

export function answerRequest(token: string, id: string, status: string, resposta: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_responder_solicitacao', { p_token: token, p_id: id, p_status: status, p_resposta: resposta })
}

export function publishNotice(token: string, titulo: string, conteudo: string, prioridade: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_publicar_aviso', { p_token: token, p_titulo: titulo, p_conteudo: conteudo, p_prioridade: prioridade })
}

export function adminNoticesPage(token: string, status: string, categoria: string | null, offset: number, limite: number) {
  return rpc<AdminNoticePage>('app_admin_avisos_dashboard', {
    p_token: token, p_status: status, p_categoria: categoria, p_offset: offset, p_limite: limite,
  })
}

export function adminNoticeReaders(token: string, avisoId: string, offset = 0, limite = 100) {
  return rpc<{ sucesso: boolean; funcionarios: NoticeEmployeeReadRow[]; total: number; erro?: string }>(
    'app_admin_aviso_leituras', { p_token: token, p_aviso_id: avisoId, p_offset: offset, p_limite: limite },
  )
}

export function saveNotice(token: string, id: string | null, notice: { titulo: string; conteudo: string; categoria: string; prioridade: string; status: string }) {
  return rpc<{ sucesso: boolean; id?: string; status?: string; erro?: string }>('app_admin_salvar_aviso', {
    p_token: token, p_id: id, p_titulo: notice.titulo, p_conteudo: notice.conteudo,
    p_categoria: notice.categoria, p_prioridade: notice.prioridade, p_status: notice.status,
  })
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

export function adminDebtAccess(token: string) {
  return rpc<boolean>('app_dividas_admin_allowed', { p_token: token })
}

export function managedDebts(token: string) {
  return rpc<DebtDashboardResponse>('app_admin_dividas_dashboard', { p_token: token })
}

export interface DebtScheduleItemPayload {
  valor: number
  vencimento: string
}

export interface DebtDraftPayload {
  credor: string
  descricao: string
  categoria: DebtCategory
  data_contratacao: string | null
  observacoes: string
  valor_total: number
  entrada: {
    valor: number
    vencimento: string | null
    forma_pagamento: DebtPaymentMethod
    chave_pix: string
    dados_transferencia: string
  }
  forma_pagamento: DebtPaymentMethod
  chave_pix: string
  dados_transferencia: string
  parcelas: DebtScheduleItemPayload[]
}

export function createManagedDebt(token: string, payload: DebtDraftPayload) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_divida_criar', { p_token: token, p_payload: payload })
}

export function updateManagedDebt(token: string, debtId: string, payload: Pick<DebtDraftPayload, 'credor' | 'descricao' | 'categoria' | 'data_contratacao' | 'observacoes'>) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_divida_atualizar', { p_token: token, p_divida_id: debtId, p_payload: payload })
}

export function addDebtInstallment(token: string, debtId: string, payload: DebtScheduleItemPayload & { forma_pagamento: DebtPaymentMethod; chave_pix: string; dados_transferencia: string }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_divida_parcela_adicionar', { p_token: token, p_divida_id: debtId, p_payload: payload })
}

export function updateDebtInstallment(token: string, installmentId: string, payload: DebtScheduleItemPayload & { forma_pagamento: DebtPaymentMethod; chave_pix: string; dados_transferencia: string }) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_divida_parcela_atualizar', { p_token: token, p_parcela_id: installmentId, p_payload: payload })
}

export function changeDebtInstallment(token: string, installmentId: string, action: 'inativar' | 'restaurar' | 'reabrir', reason = '') {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_divida_parcela_status', { p_token: token, p_parcela_id: installmentId, p_acao: action, p_motivo: reason || null })
}

export function changeManagedDebtStatus(token: string, debtId: string, action: 'inativar' | 'restaurar', reason = '') {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_divida_status', { p_token: token, p_divida_id: debtId, p_acao: action, p_motivo: reason || null })
}

type DebtFunctionResponse = { sucesso: boolean; erro?: string; url?: string; expires_in?: number; arquivo_nome?: string }

async function callDebtFunction<T extends DebtFunctionResponse>(token: string, body: Record<string, unknown> | FormData): Promise<T> {
  const isForm = body instanceof FormData
  const response = await fetch(`${config.supabaseUrl}/functions/v1/gestao-dividas`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${token}`,
      'x-app-token': token,
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isForm ? body : JSON.stringify(body),
  })
  const data = await response.json() as T
  if (!response.ok || !data.sucesso) throw new Error(data.erro || 'Não foi possível concluir a operação de documentos da dívida.')
  return data
}

export function uploadDebtPaymentDocument(token: string, installmentId: string, file: File) {
  const form = new FormData()
  form.set('action', 'instruction')
  form.set('parcela_id', installmentId)
  form.set('arquivo', file)
  return callDebtFunction<DebtFunctionResponse>(token, form)
}

export function settleDebtInstallment(token: string, installmentId: string, paidOn: string, method: DebtPaymentMethod, reason: string, proof?: File | null) {
  if (proof) {
    const form = new FormData()
    form.set('action', 'settle')
    form.set('parcela_id', installmentId)
    form.set('pago_em', paidOn)
    form.set('forma_pagamento', method)
    form.set('motivo', reason)
    form.set('arquivo', proof)
    return callDebtFunction<DebtFunctionResponse>(token, form)
  }
  return callDebtFunction<DebtFunctionResponse>(token, { action: 'settle', parcela_id: installmentId, pago_em: paidOn, forma_pagamento: method, motivo: reason })
}

export function debtAttachmentDownload(token: string, attachmentId: string) {
  return callDebtFunction<DebtFunctionResponse>(token, { action: 'download', arquivo_id: attachmentId })
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

export function adminAtualizarFichaFuncionario(token: string, funcionarioId: string, payload: EmployeeFichaPayload) {
  return rpc<{ sucesso: boolean; erro?: string; funcionario_id?: string }>('app_admin_atualizar_funcionario', {
    p_token: token,
    p_funcionario_id: funcionarioId,
    p_dados: payload,
  })
}


export function adminCadastrarFuncionario(token: string, payload: { nome: string; cpf: string; dataNascimento: string; tipoVinculo: string; cargo: string; telefone: string; endereco: string; valorMensal: number | null; valorDiaria: number | null; liberarAcesso: boolean }) {
  return rpc<{ sucesso: boolean; erro?: string; funcionario_id?: string }>('app_admin_cadastrar_funcionario', {
    p_token: token, p_nome: payload.nome, p_cpf: payload.cpf, p_data_nascimento: payload.dataNascimento, p_tipo_vinculo: payload.tipoVinculo,
    p_cargo: payload.cargo, p_telefone: payload.telefone, p_endereco: payload.endereco, p_valor_mensal: payload.valorMensal,
    p_valor_diaria: payload.valorDiaria, p_liberar_acesso: payload.liberarAcesso,
  })
}

export function registerAdmission(token: string, payload: { funcionarioId: string; dataAdmissao: string; tipoVinculo?: string; cargo?: string; valorMensal?: number | null; valorDiaria?: number | null; registrado?: boolean | null }) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_registrar_admissao', {
    p_token: token, p_funcionario_id: payload.funcionarioId, p_data_admissao: payload.dataAdmissao,
    p_tipo_vinculo: payload.tipoVinculo || null, p_cargo: payload.cargo || null,
    p_valor_mensal: payload.valorMensal ?? null, p_valor_diaria: payload.valorDiaria ?? null,
    p_registrado: payload.registrado ?? null,
  })
}

export function dismissEmployee(token: string, funcionarioId: string, dataDemissao: string, motivo: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_demitir_funcionario', { p_token: token, p_funcionario_id: funcionarioId, p_data_demissao: dataDemissao, p_motivo: motivo })
}

export function reinstateEmployee(token: string, funcionarioId: string, dataAdmissao: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_reintegrar_funcionario', { p_token: token, p_funcionario_id: funcionarioId, p_data_admissao: dataAdmissao })
}

export function adminCalcularFechamento(token: string, competencia: string, incluirInformaisVale: boolean) {
  return rpc<import('./types').FechamentoResult>('app_admin_calcular_fechamento', { p_token: token, p_competencia: competencia, p_incluir_informais_vale: incluirInformaisVale })
}

export function adminVisualizarFechamento(token: string, competencia: string) {
  return rpc<import('./types').FechamentoPreview>('app_admin_visualizar_fechamento', { p_token: token, p_competencia: competencia })
}

export function adminConfirmarFechamento(token: string, competencia: string, confirmacao: string) {
  return rpc<import('./types').FechamentoResult>('app_admin_confirmar_fechamento', { p_token: token, p_competencia: competencia, p_confirmacao: confirmacao })
}

export function adminRelatorioFechamento(token: string, competencia: string, tipo: 'escritorio' | 'vale', incluirInformaisVale = false) {
  return rpc<import('./types').FechamentoReport>('app_admin_relatorio_fechamento', { p_token: token, p_competencia: competencia, p_tipo: tipo, p_incluir_informais_vale: incluirInformaisVale })
}

export function adminFinanceiroWorkspace(token: string) {
  return rpc<import('./types').FinanceiroWorkspace>('app_admin_financeiro', { p_token: token })
}

export function adminFinanceiroExecutivo(token: string, inicio?: string, fim?: string) {
  return rpc<import('./types').FinanceiroExecutivoDashboard>('app_admin_financeiro_executivo', { p_token: token, p_inicio: inicio || null, p_fim: fim || null })
}

export function adminFinanceiroRelatorio(token: string, tipo: 'fluxo'|'categorias'|'contas_pagar'|'contas_receber'|'producao'|'dre'|'inadimplencia'|'recorrencias'|'orcamento'|'producao_status'|'producao_clientes'|'produtividade'|'quadro_funcionarios'|'ponto_jornada'|'absenteismo'|'ferias_afastamentos'|'dividas_posicao'|'dividas_credores', inicio?: string, fim?: string) {
  const operational = ['producao_status','producao_clientes','produtividade','quadro_funcionarios','ponto_jornada','absenteismo','ferias_afastamentos','dividas_posicao','dividas_credores'].includes(tipo)
  return rpc<import('./types').FinanceiroRelatorioResponse>(operational ? 'app_admin_relatorio_operacional' : 'app_admin_financeiro_relatorio', { p_token: token, p_tipo: tipo, p_inicio: inicio || null, p_fim: fim || null })
}

export function adminRegistrarRelatorio(token: string, tipo: string, inicio?: string, fim?: string, formato = 'gerencial') {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_relatorio_registrar', { p_token: token, p_tipo: tipo, p_inicio: inicio || null, p_fim: fim || null, p_formato: formato })
}

export function adminFinanceiroLancamentoSalvar(token: string, payload: { id?: string; tipo: 'pagar'|'receber'; categoria: string; descricao: string; valor: number; vencimento: string; observacoes?: string }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_financeiro_lancamento_salvar', { p_token: token, p_id: payload.id || null, p_tipo: payload.tipo, p_categoria: payload.categoria, p_descricao: payload.descricao, p_valor: payload.valor, p_vencimento: payload.vencimento, p_observacoes: payload.observacoes || null })
}

export function adminFinanceiroLancamentosSerieSalvar(token: string, payload: { tipo: 'pagar'|'receber'; categoria: string; descricao: string; valor: number; primeiroVencimento: string; quantidade: number; periodicidade: 'semanal'|'mensal'|'anual'; observacoes?: string }) {
  return rpc<{ sucesso: boolean; erro?: string; quantidade?: number; valor_total?: number }>('app_admin_financeiro_lancamentos_serie_salvar', { p_token: token, p_tipo: payload.tipo, p_categoria: payload.categoria, p_descricao: payload.descricao, p_valor: payload.valor, p_primeiro_vencimento: payload.primeiroVencimento, p_quantidade: payload.quantidade, p_periodicidade: payload.periodicidade, p_observacoes: payload.observacoes || null })
}

export function adminFinanceiroLancamentoStatus(token: string, id: string, status: 'pendente'|'pago'|'cancelado') {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_financeiro_lancamento_status', { p_token: token, p_id: id, p_status: status })
}

export function adminFinanceiroLancamentoExcluir(token: string, id: string) {
  return rpc<{ sucesso: boolean; erro?: string }>('app_admin_financeiro_lancamento_excluir', { p_token: token, p_id: id })
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

export function adminCriarOrdem(token: string, payload: { numero: string; descricao: string; prioridade: string; prazo: string; quantidade: number; valor: number; observacoes: string }) {
  return rpc<{ sucesso: boolean; erro?: string; id?: string }>('app_admin_criar_ordem', { p_token: token, p_numero: payload.numero, p_descricao: payload.descricao, p_prioridade: payload.prioridade, p_prazo: payload.prazo || null, p_quantidade: payload.quantidade, p_valor: payload.valor, p_observacoes: payload.observacoes || null })
}
