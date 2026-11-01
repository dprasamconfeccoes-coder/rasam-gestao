export type Profile = 'funcionario' | 'gestor' | 'administrador' | 'admin'

export type ModuleKey =
  | 'dashboard'
  | 'funcionarios'
  | 'ordens'
  | 'producao'
  | 'financeiro'
  | 'dividas'
  | 'rh'
  | 'relatorios'
  | 'perfil'
  | 'ponto'
  | 'ferias'
  | 'holerites'
  | 'atestados'
  | 'solicitacoes'
  | 'avisos'
  | 'importacoes'
  | 'importar_holerite'
  | 'beneficios_descontos'
  | 'acordos'
  | 'documentos'
  | 'central'

export interface SessionUser {
  usuario_id: string
  funcionario_id: string | null
  perfil: Profile
  nome: string
  cargo: string
  cpf: string
}

export interface LoginResponse extends SessionUser {
  sucesso: boolean
  primeiro_acesso?: boolean
  token?: string
  expira_em?: string
  erro?: string
}

export interface DashboardResponse {
  sucesso: boolean
  erro?: string
  perfil?: Profile
  nome?: string
  cargo?: string
  indicadores?: {
    funcionarios_ativos: number
    em_ferias: number
    em_afastamento: number
    ordens_ativas: number
    lotes_em_costura: number
    contas_pendentes: number
    saldo_dividas: number
  }
  modo?: 'executivo' | 'pessoal'
  pessoal?: {
    ponto_sem_justificativa?: number
    atestados_em_analise?: number
    solicitacoes_abertas?: number
    avisos_nao_lidos?: number
    holerites_disponiveis?: number
  }
  alertas?: Array<{
    id: string
    titulo: string
    valor: number
    detalhe: string
    prioridade: 'urgente' | 'atencao' | 'informacao'
    destino: ModuleKey
  }>
  funil?: {
    recebidas: number
    em_producao: number
    costuradas: number
    entregues: number
    pagas: number
  }
  comparativos?: {
    ordens_entrada_mes?: number
    ordens_entrada_mes_anterior?: number
    ponto_inconsistencias_mes?: number
    ponto_inconsistencias_mes_anterior?: number
  }
  inteligencia?: {
    operacao?: {
      ordens_atrasadas?: number
      lotes_parados?: number
      ordens_proximas?: number
    }
    financeiro?: {
      vencidas_qtd?: number
      vencidas_valor?: number
      proximas_qtd?: number
      proximas_valor?: number
    }
    agenda?: Array<{
      id: string
      titulo: string
      valor: number
      detalhe: string
      destino: ModuleKey
      prioridade: 'urgente' | 'atencao' | 'informacao'
    }>
    evolucao?: Array<{
      periodo: string
      ordens: number
      entregues: number
    }>
    pendencias_area?: {
      financeiro?: number
      operacao?: number
      producao?: number
      rh?: number
    }
  }
}

export interface EmployeeRow {
  id: string
  nome: string
  cpf: string
  cargo: string | null
  data_admissao: string | null
  data_demissao: string | null
  motivo_demissao: string | null
  tipo_vinculo: string | null
  salario: number | null
  valor_mensal?: number | null
  valor_diaria?: number | null
  salario_periodo?: string | null
  ativo: boolean
  perfil: Profile
  avatar_url: string | null
  situacao: 'Trabalhando' | 'Em férias' | 'Afastado' | 'Inativo'
  elegivel_holerite?: boolean
}

export interface EmployeeSearchPage {
  sucesso: boolean
  erro?: string
  registros: EmployeeRow[]
  total: number
  offset: number
  limite: number
}

export interface OrderRow {
  id: string
  numero: string
  cliente: string | null
  descricao: string
  status: string
  prioridade: string
  data_entrada: string
  prazo: string | null
  quantidade: number
  valor_total: number
  status_pagamento: 'pendente' | 'pago'
  pago_em: string | null
  nota_fiscal_numero: string | null
  nota_fiscal_emitida_em: string | null
  financeiro_liberado_em: string | null
  producao_iniciada_em: string | null
  producao_concluida_em: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
  tamanhos: OrderSizeRow[]
  documentos: OrderDocumentRow[]
  historico: OrderAuditRow[]
}

export interface OrderSizeRow {
  id: string
  tamanho: string
  quantidade: number
  valor_unitario?: number
  quantidade_produzida: number
  quantidade_costurada: number
  quantidade_entregue: number
}

export interface OrderAuditRow {
  evento: string
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
  created_at: string
  responsavel: string | null
}

export interface WorkOrderSummary {
  total_ordens: number
  ordens_ativas: number
  recebidas: number
  em_producao: number
  costuradas: number
  expedidas: number
  entregues: number
  pagas: number
  aguardando_pagamento: number
  notas_fiscais_emitidas: number
  sem_nota_fiscal: number
  vencidas: number
  vencem_em_7_dias: number
  valor_ordens_ativas: number
  valor_aguardando_pagamento: number
  valor_pago: number
  unidades_total: number
  unidades_produzidas: number
  unidades_costuradas: number
  aguardando_costura: number
  unidades_entregues: number
}

export interface WorkOrderDashboardResponse {
  sucesso: boolean
  erro?: string
  resumo: WorkOrderSummary
  ordens: OrderRow[]
}

export interface OrderDocumentRow {
  id: string
  tipo: 'nota_fiscal' | 'comprovante_pagamento'
  nome_arquivo: string
  mime_type: string
  tamanho_bytes: number
  created_at: string
}

export interface FactoryProductionSummary {
  lotes_ativos: number
  lotes_aguardando_inicio: number
  lotes_em_producao: number
  lotes_prontos_entrega: number
  lotes_entregues: number
  lotes_atrasados: number
  lotes_aguardando_pagamento: number
  unidades_solicitadas: number
  unidades_produzidas: number
  unidades_costuradas: number
  unidades_entregues: number
  unidades_aguardando_costura: number
  unidades_prontas_entrega: number
}

export interface FactoryProductionLot {
  id: string
  numero: string
  cliente: string | null
  descricao: string
  status: string
  prioridade: string
  data_entrada: string
  prazo: string | null
  quantidade: number
  unidades_solicitadas: number
  unidades_produzidas: number
  unidades_costuradas: number
  unidades_entregues: number
  producao_iniciada_em: string | null
  producao_concluida_em: string | null
  financeiro_liberado_em: string | null
  created_at: string
  tamanhos: OrderSizeRow[]
}

export interface FactoryProductionTrend {
  data: string
  produzidas: number
  costuradas: number
  entregues: number
}

export interface FactoryProductionResponse {
  sucesso: boolean
  erro?: string
  resumo: FactoryProductionSummary
  lotes: FactoryProductionLot[]
  tendencia: FactoryProductionTrend[]
}

export interface CreateWorkOrderPayload {
  clienteId: string
  clienteNome: string
  descricao: string
  prioridade: string
  prazo: string
  observacoes: string
  tamanhos: Array<{ tamanho: string; quantidade: number; valor_unitario: number }>
}

export interface WorkOrderProgressPayload {
  id: string
  quantidade_produzida: number
  quantidade_costurada: number
  quantidade_entregue: number
}

export interface RpcListResponse<T> {
  sucesso: boolean
  erro?: string
  [key: string]: unknown
  items?: T[]
}

export interface EmployeeProfile {
  nome: string
  cpf: string
  avatar_url: string | null
  data_nascimento: string | null
  cargo: string | null
  funcao: string | null
  data_admissao: string | null
  endereco: string | null
  telefone_celular: string | null
  ativo: boolean
}

export interface PointRow {
  id: string
  funcionario_id?: string
  nome?: string | null
  cpf?: string | null
  cargo?: string | null
  data: string
  entrada: string | null
  saida_almoco: string | null
  volta_almoco: string | null
  saida: string | null
  horas_trabalhadas: string | null
  status: string | null
  extra_50?: string | null
  extra_100?: string | null
  previsto?: string | null
  dia_falta?: string | null
  horas_atraso?: string | null
  desconta_dsr?: string | null
  justificativas?: string | null
  inconsistencia?: string | null
  inconsistencia_tipo?: string | null
  inconsistencia_status?: 'pendente' | 'aprovada' | 'justificada' | 'recusada' | null
  inconsistencia_justificativa?: string | null
  justificativa_id?: string | null
  justificativa_status?: 'pendente' | 'aceita' | 'recusada' | null
  justificativa_motivo?: string | null
  justificativa_resposta?: string | null
  justificativa_arquivo_url?: string | null
  justificativa_arquivo_nome?: string | null
}

export interface PointListResponse {
  sucesso: boolean
  registros: PointRow[]
  erro?: string
  escopo?: 'individual' | 'equipe'
  perfil?: Profile
}

export interface PayslipRow {
  id: string
  mes: number
  ano: number
  arquivo_nome: string | null
  arquivo_url: string
  disponivel: boolean
  created_at?: string
}

export interface NoticeAttachmentRow {
  id: string
  aviso_id: string
  nome_arquivo: string
  mime_type: string
  tamanho_bytes: number
  created_at: string
}

export interface NoticeRow {
  id: string
  titulo: string
  conteudo: string
  categoria: string
  prioridade: string
  publicado_em: string | null
  created_at: string
  lido_em?: string | null
  is_lido?: boolean
  anexos?: NoticeAttachmentRow[]
}

export interface NoticeAuditRow {
  evento: string
  antes: Record<string, unknown> | null
  depois: Record<string, unknown>
  responsavel: string
  created_at: string
}

export interface AdminNoticeRow extends NoticeRow {
  status: 'rascunho' | 'publicado' | 'arquivado' | string
  updated_at: string
  funcionarios_ativos: number
  lidos: number
  nao_lidos: number
  auditoria: NoticeAuditRow[]
}

export interface AdminNoticeSummary {
  total: number
  publicados: number
  rascunhos: number
  arquivados: number
  leituras: number
  funcionarios_ativos: number
}

export interface AdminNoticePage {
  sucesso: boolean
  erro?: string
  resumo: AdminNoticeSummary
  avisos: AdminNoticeRow[]
  total: number
  offset: number
  limite: number
}

export interface NoticeEmployeeReadRow {
  funcionario_id: string
  nome: string
  lido: boolean
  lido_em: string | null
}

export interface RequestRow {
  id: string
  tipo: string
  descricao: string
  anexo_nome: string | null
  status: string
  resposta: string | null
  created_at: string
  updated_at?: string
  analisado_em?: string | null
  timeline?: RequestAuditEvent[]
}

export interface RequestAuditEvent {
  evento: string
  status_anterior: string | null
  status_novo: string
  comentario: string | null
  responsavel: string | null
  created_at: string
}

export interface MedicalLeaveAuditEvent {
  evento: 'enviado' | 'aceito' | 'recusado' | 'registro_anterior' | string
  status_anterior: string | null
  status_novo: string
  justificativa: string | null
  responsavel: string | null
  created_at: string
}

export interface MedicalLeaveRow {
  id: string
  tipo: string
  data_atendimento: string
  dias: number
  cid?: string | null
  observacao: string | null
  arquivo_url: string | null
  arquivo_nome: string | null
  status: string
  status_label: string | null
  observacao_rh: string | null
  created_at: string
  conferido_em?: string | null
  timeline?: MedicalLeaveAuditEvent[]
}

export interface PointImportRow {
  id: string
  cpf: string
  nome_csv: string
  data: string | null
  entrada_1: string | null
  saida_1: string | null
  entrada_2: string | null
  saida_2: string | null
  total_normais: string | null
  extra_50: string | null
  extra_100: string | null
  dia_falta: string | null
  horas_atraso: string | null
  justificativas: string | null
  encontrado: boolean
  inconsistencia: string | null
  tipo: 'diario' | 'mensal'
  competencia: string | null
  status: 'pendente' | 'aplicada' | 'ignorada'
}

export interface PointImportSummary {
  id: string
  tipo: 'diario' | 'mensal'
  competencia: string | null
  arquivo_nome: string
  total_linhas: number
  linhas_encontradas: number
  linhas_nao_encontradas: number
  linhas_inconsistentes?: number
  cpfs_nao_encontrados: string[]
  imported_by_name: string | null
  status: 'pendente' | 'aplicada' | 'ignorada'
  applied_at: string | null
  archived_at: string | null
  created_at: string
}

export interface AgreementInstallment {
  id: string
  acordo_id: string
  processo: string
  funcionario_nome: string | null
  funcionario_cpf: string | null
  acordo_observacoes: string | null
  tipo: 'entrada' | 'parcela'
  numero: number
  valor: number
  vencimento: string | null
  status: 'quitada' | 'pendente' | 'atrasada'
  pago_em: string | null
  observacoes: string | null
}

export interface CreateAgreementPayload {
  processo: string
  funcionarioNome: string
  funcionarioCpf: string
  observacoes: string
  parcelas: Array<{
    tipo: 'entrada' | 'parcela'
    numero: number
    valor: number
    vencimento: string
  }>
}

export interface CompanyDocument {
  id: string
  grupo_id: string
  versao: number
  titulo: string
  categoria: string
  arquivo_nome: string | null
  arquivo_url: string | null
  arquivo_privado: boolean
  conteudo_texto: string | null
  disponivel_funcionarios: boolean
  mime_type: string | null
  tamanho_bytes: number | null
  excluido_em?: string | null
  created_at: string
  updated_at: string
}

export interface AdminPointRow extends PointRow {
  funcionario_id: string
  nome: string
  cpf: string
  cargo: string | null
}

export interface AdminJustificationRow {
  id: string
  funcionario_id: string
  data_registro: string
  tipo: string
  motivo: string
  arquivo_nome: string | null
  status: string
  resposta_rh: string | null
  analisado_em: string | null
  nome: string
  cpf: string
}

export interface AdminMedicalLeaveRow extends MedicalLeaveRow {
  funcionario_id: string
  nome: string
  cpf?: string | null
}

export interface AdminMedicalLeaveDashboardSummary {
  total: number
  pendentes: number
  aceitos: number
  recusados: number
}

export interface AdminMedicalLeaveDashboardPage {
  sucesso: boolean
  erro?: string
  atestados: AdminMedicalLeaveRow[]
  total: number
  offset: number
  limite: number
  resumo: AdminMedicalLeaveDashboardSummary
}

export interface AdminVacationRow {
  id: string
  funcionario_id: string
  nome: string
  cpf: string
  cargo: string | null
  periodo_aquisitivo_inicio: string
  periodo_aquisitivo_fim: string
  inicio: string | null
  fim: string | null
  status: 'agendada' | 'em_gozo' | 'concluida' | 'cancelada'
  observacoes: string | null
  created_at: string
  updated_at: string
}

export interface AdminVacationManagementRow extends AdminVacationRow {
  avatar_url: string | null
  aviso_documento: VacationDocumentLink | null
  recibo_documento: VacationDocumentLink | null
  comprovante_pagamento_documento: VacationDocumentLink | null
  retorno_em: string | null
  aviso_emitido_em: string | null
  pagamento_previsto_em: string | null
  pagamento_efetivo_em: string | null
  dias_gozo: number | null
  dias_abono: number | null
  abono_solicitado: boolean
  importacao_status: string
  origem_importacao: string | null
  documentos_count: number
  avisos_count: number
  recibos_count: number
  reconciliacao_status: 'conciliado' | 'aviso_sem_recibo' | 'recibo_sem_aviso' | string
  calculo: Record<string, unknown> | null
}

export interface VacationDocumentLink {
  id: string
  tipo: 'aviso' | 'recibo' | 'comprovante_pagamento'
  arquivo_nome: string
}

export interface VacationPortalUse {
  id: string
  inicio: string | null
  fim: string | null
  retorno_em: string | null
  dias_gozo: number | null
  status: string
  observacoes: string | null
  created_at: string
}

export interface VacationPortalRow {
  funcionario_id: string
  nome: string
  cpf: string
  cargo: string | null
  avatar_url: string | null
  data_admissao: string | null
  periodo_inicio: string
  periodo_fim: string
  dias_direito: number | null
  dias_gozados_relatorio: number | null
  dias_restantes_relatorio: number | null
  ferias_vencidas: number
  limite_gozo: string | null
  dias_gozados_sistema: number
  dias_disponiveis: number
  dias_excedentes: number
  usufrutos: VacationPortalUse[]
  documentos: VacationDocumentLink[]
  situacao: 'utilizado' | 'vencido' | 'disponivel' | string
}

export interface VacationReconciliationSummary {
  avisos_total: number
  recibos_total: number
  avisos_sem_recibo: number
  recibos_sem_aviso: number
}

export interface VacationHistoricalProgrammingRow {
  id: string
  codigo_empregado: number
  nome_relatorio: string
  nome_sistema: string | null
  funcionario_id: string | null
  data_admissao: string | null
  data_admissao_sistema: string | null
  vencimento_ferias: string | null
  ferias_vencidas: number
  ferias_programadas: string | null
  aquisitivo_inicio: string
  aquisitivo_fim: string
  dias_direito: number | null
  dias_gozados_relatorio: number | null
  dias_restantes_relatorio: number | null
  dias_gozados_sistema: number
  dias_gozados_total: number
  dias_disponiveis: number
  dias_excedentes: number
  periodos_sistema: number
  dias_afastamento_inss: number
  dias_faltas_total: number
  limite_gozo: string | null
  dias_afastamento: string | null
  dias_faltas: string | null
  avisos_sistema: number
  recibos_sistema: number
  situacao_confronto: 'conferido' | 'dias_excedentes' | 'sem_ferias_lancadas' | 'sem_vinculo' | string
  fonte_emissao: string
  fonte_nome: string
}

export interface VacationImportLine {
  id: string
  importacao_id: string
  funcionario_id: string | null
  nome_extraido: string
  cpf_extraido: string | null
  cadastro_extraido: string | null
  periodo_aquisitivo_inicio: string | null
  periodo_aquisitivo_fim: string | null
  inicio: string | null
  fim: string | null
  retorno_em: string | null
  pagamento_previsto_em: string | null
  aviso_emitido_em: string | null
  abono_solicitado: boolean
  arquivo_nome: string
  status: 'pendente' | 'vinculada' | 'conferida' | 'divergente' | 'rejeitada'
  divergencia: string | null
  ferias_id: string | null
  documento_id: string | null
}

export interface VacationImportBatch {
  id: string
  tipo: string
  origem: string
  pasta_nome: string | null
  total_linhas: number
  linhas_vinculadas: number
  linhas_pendentes: number
  status: string
  observacoes: string | null
  created_at: string
  linhas: VacationImportLine[]
}

export interface AdminLeaveRow {
  id: string
  funcionario_id: string
  nome: string
  cpf: string
  cargo: string | null
  tipo: string
  inicio: string
  fim: string | null
  motivo: string | null
  status: 'ativo' | 'encerrado' | 'cancelado'
  created_at: string
  updated_at: string
}

export interface AdminRequestRow extends RequestRow {
  funcionario_id: string
  analisado_em: string | null
  nome: string
  cpf?: string
}

export interface AdminRequestsSummary {
  total: number
  pendentes: number
  em_analise: number
  abertas: number
  atendidas: number
  recusadas: number
  canceladas: number
}

export interface AdminRequestsPage {
  sucesso: boolean
  erro?: string
  resumo: AdminRequestsSummary
  solicitacoes: AdminRequestRow[]
  total: number
  offset: number
  limite: number
}

export interface AdminPayslipRow extends PayslipRow {
  funcionario_id: string
  nome: string
  cpf: string
}

export interface AdminDebtRow {
  id: string
  credor: string
  descricao: string
  valor_original: number
  saldo_devedor: number
  vencimento: string | null
  status: string
  observacoes: string | null
}

export type DebtCategory = 'trabalhista' | 'previdenciaria' | 'emprestimo_pessoal' | 'consignado' | 'outros'
export type DebtPaymentMethod = 'pix' | 'transferencia' | 'boleto' | 'outro'
export type DebtInstallmentKind = 'entrada' | 'parcela' | 'saldo_legado'
export type DebtInstallmentStatus = 'pendente' | 'paga'

export interface DebtAttachment {
  id: string
  tipo: 'documento_pagamento' | 'comprovante'
  arquivo_nome: string
  mime_type: string
  tamanho_bytes: number
  created_at: string
}

export interface DebtInstallment {
  id: string
  tipo_item: DebtInstallmentKind
  numero: number
  valor: number
  vencimento: string | null
  status: DebtInstallmentStatus
  ativo: boolean
  pago_em: string | null
  forma_pagamento: DebtPaymentMethod
  chave_pix: string | null
  dados_transferencia: string | null
  legacy_comprovante_nome: string | null
  arquivos: DebtAttachment[]
  created_at: string
  updated_at: string
}

export interface DebtAuditEntry {
  id: string
  evento: string
  detalhes: Record<string, unknown>
  usuario_nome: string
  created_at: string
}

export interface ManagedDebt {
  id: string
  credor: string
  descricao: string
  categoria: DebtCategory
  valor_original: number
  saldo_devedor: number
  vencimento: string | null
  status: 'ativa' | 'quitada' | 'renegociada' | 'inativa'
  observacoes: string | null
  data_contratacao: string | null
  revisao_pendente: boolean
  origem_legada: string | null
  modelo_agenda: 'legado' | 'migrado' | 'novo'
  inativada_em: string | null
  updated_at: string
  parcelas: DebtInstallment[]
  auditoria: DebtAuditEntry[]
}

export interface DebtDashboardResponse {
  sucesso: boolean
  erro?: string
  dividas: ManagedDebt[]
}

export interface AdminOrderRow {
  id: string
  numero: string
  descricao: string
  status: string
  prioridade: string
  prazo: string | null
  quantidade: number
  valor_total: number
}

export interface AdminLotRow {
  id: string
  nome: string
  status: string
  prazo: string | null
  quantidade: number
  responsavel: string | null
}


export interface EmployeeFichaRecord extends Record<string, unknown> {
  id: string
  nome: string
  cpf: string
  data_nascimento: string | null
  tipo_vinculo?: string
  registrado?: boolean
}

export type EmployeeFichaPayload = Record<string, string | number | null>

export interface ProntuarioResponse {
  sucesso: boolean
  erro?: string
  funcionario?: EmployeeFichaRecord
  documentos: Array<Record<string, unknown>>
  advertencias: Array<Record<string, unknown>>
  timeline: Array<Record<string, unknown>>
  atestados: Array<Record<string, unknown>>
  justificativas: Array<Record<string, unknown>>
  ponto: Array<Record<string, unknown>>
  holerites: Array<Record<string, unknown>>
  ferias: Array<Record<string, unknown>>
  afastamentos: Array<Record<string, unknown>>
  beneficios?: Array<Record<string, unknown>>
  descontos?: Array<Record<string, unknown>>
}

export interface OwnProntuarioResponse {
  sucesso: boolean
  erro?: string
  funcionario?: {
    id: string
    nome: string
    cpf: string
    data_nascimento: string | null
    tipo_vinculo: string | null
    cargo: string | null
    funcao: string | null
    data_admissao: string | null
    salario: number | null
    salario_periodo: string | null
    valor_mensal: number | null
    valor_diaria: number | null
    horario_trabalho: string | null
    horario_intervalo: string | null
    telefone_celular: string | null
    endereco: string | null
    ativo: boolean
    data_demissao: string | null
    tipo_desligamento: string | null
  }
  documentos: Array<Record<string, unknown>>
  advertencias: Array<Record<string, unknown>>
  atestados: Array<Record<string, unknown>>
  justificativas: Array<Record<string, unknown>>
  ferias: Array<Record<string, unknown>>
  afastamentos: Array<Record<string, unknown>>
}

export interface EmployeeTimelineEvent {
  id: string
  tipo: string
  data: string
  titulo: string
  descricao: string
  origem: string
  status: string | null
}

export interface EmployeeTimelineResponse {
  sucesso: boolean
  erro?: string
  eventos: EmployeeTimelineEvent[]
  total: number
  offset: number
  limite: number
}

export interface FechamentoSummary { funcionarios?: number; faltas_injustificadas?: number; faltas_justificadas?: number; horas_extras_50?: number; horas_extras_100?: number; extras_50_valor?: number; extras_100_valor?: number; dsr_desconto?: number }
export interface FechamentoResult { sucesso: boolean; erro?: string; fechamento_id?: string; competencia?: string; status?: string; mensagem?: string; source_fingerprint?: string | null; resumo?: FechamentoSummary }
export interface FechamentoPreview extends FechamentoResult { confirmado_at?: string | null; regras?: Record<string, unknown>; linhas?: Array<Record<string, unknown>> }
export interface FechamentoReport { sucesso: boolean; erro?: string; competencia?: string; tipo?: string; linhas?: Array<Record<string, unknown>> }
export interface FinanceiroLancamento { id?: string; tipo?: 'pagar'|'receber'|string; categoria?: string; descricao?: string; valor?: number|string; vencimento?: string; status?: string; pago_em?: string|null; observacoes?: string|null; created_at?: string }
export interface FinanceiroOrdemReceita { id?: string; numero?: string; descricao?: string; cliente_nome?: string|null; status?: string; status_pagamento?: string; valor_total?: number|string; prazo?: string|null; origem_status?: string }
export interface FinanceiroResumo { despesas_pendentes?: number|string; despesas_vencidas?: number|string; receitas_pendentes?: number|string; receitas_recebidas?: number|string; receitas_ordens_previstas?: number|string; ordens_aguardando_pagamento?: number|string }
export interface FinanceiroWorkspace { sucesso: boolean; erro?: string; contas: FinanceiroLancamento[]; dividas: Array<Record<string, unknown>>; recorrencias: Array<Record<string, unknown>>; parcelas: Array<Record<string, unknown>>; receitas_ordens?: FinanceiroOrdemReceita[]; resumo?: FinanceiroResumo }
export interface FinanceiroExecutivoKpis { receitas_realizadas?: number|string; despesas_realizadas?: number|string; resultado_realizado?: number|string; receitas_a_receber?: number|string; despesas_a_pagar?: number|string; despesas_vencidas?: number|string; receitas_ordens_previstas?: number|string; ordens_aguardando_pagamento?: number|string; compromissos_recorrentes?: number|string; recorrencias_ativas?: number|string; saldo_projetado?: number|string }
export interface FinanceiroExecutivoEvolucao { mes: string; receitas_realizadas?: number|string; despesas_realizadas?: number|string; receitas_previstas?: number|string; despesas_previstas?: number|string }
export interface FinanceiroExecutivoCategoria { categoria: string; valor?: number|string; quantidade?: number|string }
export interface FinanceiroExecutivoAgingBucket { quantidade?: number|string; valor?: number|string }
export interface FinanceiroExecutivoAlerta { nivel?: 'critico'|'atencao'|'informativo'|string; titulo?: string; detalhe?: string }
export interface FinanceiroExecutivoDashboard { sucesso: boolean; erro?: string; periodo?: { inicio?: string; fim?: string }; kpis?: FinanceiroExecutivoKpis; evolucao?: FinanceiroExecutivoEvolucao[]; categorias?: FinanceiroExecutivoCategoria[]; aging?: { vencido?: FinanceiroExecutivoAgingBucket; hoje?: FinanceiroExecutivoAgingBucket; sete_dias?: FinanceiroExecutivoAgingBucket; trinta_dias?: FinanceiroExecutivoAgingBucket }; alertas?: Array<FinanceiroExecutivoAlerta|null> }
export interface FinanceiroRelatorioResponse { sucesso: boolean; erro?: string; tipo?: string; inicio?: string; fim?: string; totais?: Record<string, unknown>; linhas?: Array<Record<string, unknown>> }
