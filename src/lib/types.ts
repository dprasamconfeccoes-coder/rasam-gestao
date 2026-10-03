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
  | 'holerites'
  | 'atestados'
  | 'solicitacoes'
  | 'avisos'
  | 'importacoes'
  | 'acordos'
  | 'documentos'
  | 'central'

export interface SessionUser {
  usuario_id: string
  funcionario_id: string
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
}

export interface EmployeeRow {
  id: string
  nome: string
  cpf: string
  cargo: string | null
  data_admissao: string | null
  salario: number | null
  ativo: boolean
  perfil: Profile
}

export interface OrderRow {
  id: string
  numero: string
  descricao: string
  status: string
  prioridade: string
  data_entrada: string
  prazo: string | null
  quantidade: number
  valor_total: number
  cliente: string | null
}

export interface RpcListResponse<T> {
  sucesso: boolean
  erro?: string
  [key: string]: unknown
  items?: T[]
}

export interface EmployeeProfile {
  id: string
  nome: string
  cpf: string
  data_nascimento: string
  cargo: string | null
  funcao: string | null
  data_admissao: string | null
  salario: number | null
  endereco: string | null
  telefone_celular: string | null
  email?: string | null
  ativo: boolean
}

export interface PointRow {
  id: string
  data: string
  entrada: string | null
  saida_almoco: string | null
  volta_almoco: string | null
  saida: string | null
  horas_trabalhadas: string | null
  status: string | null
}

export interface PayslipRow {
  id: string
  mes: number
  ano: number
  arquivo_nome: string | null
  arquivo_url: string
  disponivel: boolean
}

export interface NoticeRow {
  id: string
  titulo: string
  conteudo: string
  prioridade: string
  publicado_em: string | null
  created_at: string
}

export interface RequestRow {
  id: string
  tipo: string
  descricao: string
  anexo_nome: string | null
  status: string
  resposta: string | null
  created_at: string
}

export interface MedicalLeaveRow {
  id: string
  tipo: string
  data_atendimento: string
  dias: number
  observacao: string | null
  arquivo_nome: string | null
  status: string
  status_label: string | null
  observacao_rh: string | null
  created_at: string
}

export interface PointImportRow {
  id: string
  cpf: string
  nome_csv: string
  data: string
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
  tipo: 'diario' | 'mensal'
  competencia: string | null
}

export interface PointImportSummary {
  id: string
  tipo: 'diario' | 'mensal'
  competencia: string | null
  arquivo_nome: string
  total_linhas: number
  linhas_encontradas: number
  linhas_nao_encontradas: number
  cpfs_nao_encontrados: string[]
  created_at: string
}

export interface AgreementInstallment {
  id: string
  processo: string
  favorecido: string | null
  numero: number
  valor: number
  vencimento: string | null
  status: 'quitada' | 'pendente' | 'atrasada'
  observacoes: string | null
}

export interface CompanyDocument {
  id: string
  titulo: string
  categoria: string
  arquivo_nome: string | null
  arquivo_url: string | null
  conteudo_texto: string | null
  disponivel_funcionarios: boolean
  created_at: string
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
  cpf: string
}

export interface AdminRequestRow extends RequestRow {
  funcionario_id: string
  analisado_em: string | null
  nome: string
  cpf: string
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
