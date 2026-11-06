import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { TABLE_COLUMNS, TABLE_DATE_COLUMN_TYPES, TABLE_NUMERIC_COLUMNS, TABLE_PRIMARY_KEYS } from "./catalog.ts"

type SensitiveFlags = { medical: boolean; payroll: boolean; text: boolean; names: boolean }
type ScopeRelation = { alias: string; table: string; foreignKey: string }
type RelationConfig = { table: string; foreignKey: string }
type FilterSpec = { column: string; op: string; value: unknown }
type AggregateSpec = { operation: string; column?: string; groupBy?: string[] }
type QuerySpec = {
  id?: string
  table: string
  columns: string[]
  filters?: FilterSpec[]
  include?: string[]
  orderBy?: string
  ascending?: boolean
  limit?: number
  offset?: number
  aggregate?: AggregateSpec
}

type TableScope = { direct: boolean; relations: ScopeRelation[] }

const MAX_REQUEST_BYTES = 48_000
const MAX_QUERIES = 4
const MAX_COLUMNS = 9
const MAX_FILTERS = 10
const MAX_IN_VALUES = 100
const MAX_ROWS = 100
const SCAN_PAGE_SIZE = 1000
const MAX_SCAN_ROWS = 10_000
const MAX_GROUPS = 100
const MAX_TEXT_FIELD_CHARS = 320
const MAX_RESPONSE_BYTES = 900_000
const ALLOWED_ORIGINS = new Set([
  "https://dprasamconfeccoes-coder.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
])

const HIDDEN_TABLES = new Set([
  "empresas", "usuarios", "sessoes", "app_roles", "app_permissions",
  "app_role_permissions", "app_user_roles", "auditoria_acoes",
  "folhas_pagamento_linhas", "documentos_financeiros_importados",
])

const UNSCOPED_TABLE_RELATIONS: Record<string, ScopeRelation[]> = {
  acordo_parcelas: [
    { alias: "__scope_acordo", table: "acordos_trabalhistas", foreignKey: "acordo_parcelas_acordo_id_fkey" },
  ],
  fechamento_funcionarios: [
    { alias: "__scope_fechamento", table: "fechamentos_mensais", foreignKey: "fechamento_funcionarios_fechamento_id_fkey" },
    { alias: "__scope_funcionario", table: "funcionarios", foreignKey: "fechamento_funcionarios_funcionario_id_fkey" },
  ],
  folha_escritorio_itens: [
    { alias: "__scope_registro", table: "folha_escritorio_registros", foreignKey: "folha_escritorio_itens_registro_id_fkey" },
  ],
}

const RELATIONS: Record<string, Record<string, RelationConfig>> = {
  atestados: { funcionario: { table: "funcionarios", foreignKey: "atestados_funcionario_id_fkey" } },
  registros_ponto: { funcionario: { table: "funcionarios", foreignKey: "registros_ponto_funcionario_id_fkey" } },
  justificativas_ponto: { funcionario: { table: "funcionarios", foreignKey: "justificativas_ponto_funcionario_id_fkey" } },
  ponto_inconsistencias: { funcionario: { table: "funcionarios", foreignKey: "ponto_inconsistencias_funcionario_id_fkey" } },
  rh_ferias: { funcionario: { table: "funcionarios", foreignKey: "rh_ferias_funcionario_id_fkey" } },
  rh_afastamentos: { funcionario: { table: "funcionarios", foreignKey: "rh_afastamentos_funcionario_id_fkey" } },
  rh_solicitacoes: { funcionario: { table: "funcionarios", foreignKey: "rh_solicitacoes_funcionario_id_fkey" } },
  holerites: { funcionario: { table: "funcionarios", foreignKey: "holerites_funcionario_id_fkey" } },
  ponto_import_linhas: { funcionario: { table: "funcionarios", foreignKey: "ponto_import_linhas_funcionario_id_fkey" } },
  ponto_jornada_atribuicoes: { funcionario: { table: "funcionarios", foreignKey: "ponto_jornada_atribuicoes_funcionario_id_fkey" } },
  vale_alimentacao_competencias: { funcionario: { table: "funcionarios", foreignKey: "vale_alimentacao_competencias_funcionario_id_fkey" } },
  rh_beneficios_lancamentos: { funcionario: { table: "funcionarios", foreignKey: "rh_beneficios_lancamentos_funcionario_id_fkey" } },
  rh_descontos_lancamentos: { funcionario: { table: "funcionarios", foreignKey: "rh_descontos_lancamentos_funcionario_id_fkey" } },
  rh_folha_dados_competencia: { funcionario: { table: "funcionarios", foreignKey: "rh_folha_dados_competencia_funcionario_id_fkey" } },
  funcionario_documentos: { funcionario: { table: "funcionarios", foreignKey: "funcionario_documentos_funcionario_id_fkey" } },
  funcionario_advertencias: { funcionario: { table: "funcionarios", foreignKey: "funcionario_advertencias_funcionario_id_fkey" } },
  funcionario_timeline: { funcionario: { table: "funcionarios", foreignKey: "funcionario_timeline_funcionario_id_fkey" } },
  rh_ferias_calculos: { ferias: { table: "rh_ferias", foreignKey: "rh_ferias_calculos_ferias_id_fkey" } },
  rh_ferias_import_linhas: {
    funcionario: { table: "funcionarios", foreignKey: "rh_ferias_import_linhas_funcionario_id_fkey" },
    ferias: { table: "rh_ferias", foreignKey: "rh_ferias_import_linhas_ferias_id_fkey" },
  },
  ordens_servico: { cliente: { table: "clientes", foreignKey: "ordens_servico_cliente_id_fkey" } },
  producao_lotes: { ordem: { table: "ordens_servico", foreignKey: "producao_lotes_ordem_id_fkey" } },
  financeiro_parcelas: { parcelamento: { table: "financeiro_parcelamentos", foreignKey: "financeiro_parcelas_parcelamento_id_fkey" } },
  dividas_parcelas: { divida: { table: "dividas_gestao", foreignKey: "dividas_parcelas_divida_id_fkey" } },
  acordo_parcelas: { acordo: { table: "acordos_trabalhistas", foreignKey: "acordo_parcelas_acordo_id_fkey" } },
  fechamento_funcionarios: {
    funcionario: { table: "funcionarios", foreignKey: "fechamento_funcionarios_funcionario_id_fkey" },
    fechamento: { table: "fechamentos_mensais", foreignKey: "fechamento_funcionarios_fechamento_id_fkey" },
  },
  folha_escritorio_itens: { registro: { table: "folha_escritorio_registros", foreignKey: "folha_escritorio_itens_registro_id_fkey" } },
}

const ALWAYS_HIDDEN_COLUMNS = new Set([
  "empresa_id", "cpf", "cpf_nao_encontrados", "cnpj", "empregador_cnpj", "documento", "matricula_esocial", "numero_registro",
  "data_nascimento", "local_nascimento", "nome_pai", "nome_mae", "rg", "rg_data_emissao",
  "rg_orgao_emissor", "titulo_eleitor", "titulo_zona", "titulo_secao", "ctps", "ctps_serie",
  "ctps_data_expedicao", "ctps_uf", "cnh", "cnh_categoria", "doc_militar", "doc_militar_categoria",
  "pis_numero", "pis_cadastro", "endereco", "empregador_endereco", "cep", "telefone_residencial",
  "telefone_celular", "email", "contato", "banco_domicilio", "banco_numero", "banco_agencia", "banco_endereco",
  "fgts_conta_banco", "chave_pix", "dados_transferencia", "token", "senha", "password", "secret",
  "storage_path", "drive_file_id", "drive_url_origem", "arquivo_url", "anexo_url", "comprovante_url",
  "url", "mime_type", "tamanho_bytes", "sha256", "avatar_url", "raw_data", "dados", "dados_extraidos",
  "regras", "beneficiarios", "snapshot", "antes", "depois", "request_fingerprint", "source_fingerprint",
  "created_by", "updated_by", "uploaded_by", "deleted_by", "actor_usuario_id", "usuario_id",
  "analisado_por", "conferido_por", "criado_por", "confirmado_por", "atribuido_por", "baixado_por",
  "pago_por", "updated_by", "created_by", "deleted_by", "uploaded_by",
])
const NEVER_SELECT_PATTERNS = [
  /(^|_)(cpf|cnpj|documento|senha|password|token|secret|email|telefone|phone|endereco|cep|banco|agencia|pix)(_|$)/i,
  /(^|_)(url|path|arquivo|anexo|comprovante|mime_type|tamanho_bytes|sha256|fingerprint)(_|$)/i,
  /(^|_)(created_by|updated_by|uploaded_by|deleted_by|imported_by|applied_by|usuario_id|analisado_por|conferido_por|criado_por|confirmado_por|pago_por|baixado_por|liberado_por)(_|$)/i,
  /(_por|_by)$/i,
]
const CONDITIONAL_TEXT_COLUMNS = new Set([
  "descricao", "descricao_os", "observacao", "observacoes", "observacao_rh", "motivo", "justificativa",
  "resposta", "resposta_rh", "comentario", "conteudo", "conteudo_texto", "detalhe", "detalhes",
  "alteracoes", "dados_alteracao", "acidentes_doencas", "ocorrencias", "divergencia", "inconsistencia",
  "instrucoes_pagamento",
])
const MEDICAL_TABLE_COLUMNS: Record<string, Set<string>> = {
  funcionarios: new Set(["acidentes_doencas", "deficiencia"]),
  atestados: new Set(["cid", "observacao", "observacao_rh"]),
  rh_afastamentos: new Set(["motivo", "observacao", "observacoes"]),
  rh_solicitacoes: new Set(["detalhes", "motivo", "observacao", "observacoes"]),
  justificativas_ponto: new Set(["motivo"]),
  ponto_import_linhas: new Set(["justificativas"]),
  funcionario_documentos: new Set(["observacoes"]),
}
const PAYROLL_COLUMNS = new Set(["salario", "salario_base", "salario_admissao", "hora_base", "base_inss", "base_fgts", "base_irrf", "fgts_mes", "valor_previdencia", "valor_irrf", "dependentes_irrf", "pensao_alimenticia", "pensao_confirmada", "declaracao_confirmada", "outros_vinculos", "outras_fontes_rendimento", "faixa_irrf", "salario_pendente"])
const PAYROLL_TABLE_COLUMNS: Record<string, Set<string>> = {
  funcionarios: new Set(["valor_mensal", "valor_diaria"]),
  vale_alimentacao_competencias: new Set(["valor"]),
  fechamento_funcionarios: new Set(["dsr_desconto", "vale_valor", "horas_extras_50_valor", "horas_extras_100_valor"]),
  rh_ferias_calculos: new Set(["faltas_injustificadas", "media_horas", "media_valores", "outras_vantagens", "base_calculo", "valor_ferias", "valor_terco_ferias", "valor_abono", "valor_terco_abono", "valor_dobra", "valor_terco_dobra", "valor_salario_familia", "valor_primeira_parcela_13", "total_proventos", "total_descontos", "total_liquido"]),
  rh_beneficios_lancamentos: new Set(["valor"]),
  rh_descontos_lancamentos: new Set(["valor"]),
  rh_beneficios_catalogo: new Set(["valor_atual", "valor_minimo", "percentual_reajuste"]),
  rh_descontos_catalogo: new Set(["valor_padrao"]),
  rh_beneficios_valores_historico: new Set(["valor"]),
  rh_descontos_valores_historico: new Set(["valor"]),
  folha_escritorio_registros: new Set(["total_vencimentos", "total_descontos", "valor_liquido"]),
  folha_escritorio_itens: new Set(["valor"]),
}

const corsHeaders = (origin: string | null) => ({
  ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
})

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  let payload = JSON.stringify(body)
  if (new TextEncoder().encode(payload).byteLength > MAX_RESPONSE_BYTES) {
    status = 413
    payload = JSON.stringify({ sucesso: false, erro: "A resposta excede o limite seguro. Refine o período, a lista ou a quantidade de campos." })
  }
  return new Response(payload, {
    status,
    headers: { ...corsHeaders(request.headers.get("origin")), "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

function getToken(request: Request) {
  const appToken = request.headers.get("x-app-token")?.trim()
  if (appToken) return appToken
  const authorization = request.headers.get("authorization")?.trim()
  if (!authorization) return null
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : authorization
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeFlags(value: unknown): SensitiveFlags {
  const source = isRecord(value) ? value : {}
  return { medical: source.medical === true, payroll: source.payroll === true, text: source.text === true, names: source.names === true }
}

function tableScope(table: string): TableScope | null {
  if (HIDDEN_TABLES.has(table) || !Object.hasOwn(TABLE_COLUMNS, table)) return null
  const columns = TABLE_COLUMNS[table]
  if (columns.includes("empresa_id")) return { direct: true, relations: [] }
  const relations = Object.hasOwn(UNSCOPED_TABLE_RELATIONS, table) ? UNSCOPED_TABLE_RELATIONS[table] : undefined
  if (relations?.length) return { direct: false, relations }
  return null
}

function isColumnAllowed(table: string, column: string, flags: SensitiveFlags): boolean {
  if (typeof column !== "string" || column === "id" || column.endsWith("_id")) return false
  if (!TABLE_COLUMNS[table]?.includes(column) || ALWAYS_HIDDEN_COLUMNS.has(column)) return false
  if (NEVER_SELECT_PATTERNS.some((pattern) => pattern.test(column))) return false
  if (table === "funcionarios" && column === "nome" && !flags.names) return false
  if ((column === "cid" || MEDICAL_TABLE_COLUMNS[table]?.has(column)) && !flags.medical) return false
  if ((PAYROLL_COLUMNS.has(column) || PAYROLL_TABLE_COLUMNS[table]?.has(column)) && !flags.payroll) return false
  if (CONDITIONAL_TEXT_COLUMNS.has(column) && !flags.text) return false
  if (column === "ferias_periodo_aquisitivo" || column === "ferias_periodo_gozo" || column === "ferias_periodo_abono") return flags.payroll
  return true
}

function isFilterColumnAllowed(table: string, column: string, includes: string[], flags: SensitiveFlags) {
  if (isColumnAllowed(table, column, flags)) return true
  const [relationName, relatedColumn, ...extra] = column.split(".")
  const relationMap = RELATIONS[table] || {}
  const relation = Object.hasOwn(relationMap, relationName) ? relationMap[relationName] : undefined
  return Boolean(relation && !extra.length && includes.includes(relationName) && isColumnAllowed(relation.table, relatedColumn, flags))
}

function allowedColumns(table: string, flags: SensitiveFlags) {
  return (TABLE_COLUMNS[table] || []).filter((column) => isColumnAllowed(table, column, flags))
}

function moduleForTable(table: string) {
  if (table === "funcionarios") return "Funcionários"
  if (table.startsWith("rh_aviso")) return "Avisos"
  if (table.startsWith("rh_folha_") || table.startsWith("rh_beneficios_") || table.startsWith("rh_descontos_") || table.startsWith("vale_alimentacao_") || table.startsWith("folha_") || table.startsWith("fechamento_") || table === "holerites") return "Folha"
  if (table.startsWith("rh_") || table.startsWith("atestado") || table.startsWith("funcionario_") || table.startsWith("vale_")) return "RH"
  if (table.startsWith("ponto_") || table === "registros_ponto" || table === "justificativas_ponto") return "Ponto"
  if (table.startsWith("financeiro_")) return "Financeiro"
  if (table.startsWith("dividas_")) return "Dívidas"
  if (table.startsWith("acordo")) return "Acordos"
  if (table.startsWith("ordens") || table.startsWith("ordem_") || table.startsWith("producao_") || table === "clientes") return "Produção"
  if (table.startsWith("documentos_")) return "Documentos"
  return "Sistema"
}

function buildCatalog(flags: SensitiveFlags) {
  const tables = Object.keys(TABLE_COLUMNS).filter((table) => tableScope(table) !== null).sort()
  return tables.map((table) => ({
    table,
    module: moduleForTable(table),
    columns: allowedColumns(table, flags),
    dateColumns: Object.fromEntries(Object.entries(TABLE_DATE_COLUMN_TYPES[table] || {}).filter(([column]) => isColumnAllowed(table, column, flags))),
    numericColumns: (TABLE_NUMERIC_COLUMNS[table] || []).filter((column) => isColumnAllowed(table, column, flags)),
    relations: Object.entries(RELATIONS[table] || {}).map(([name, relation]) => ({
      name,
      table: relation.table,
      columns: allowedColumns(relation.table, flags).filter((column) => ["nome", "cargo", "funcao", "numero", "status", "competencia", "nome_fantasia", "razao_social", "fornecedor", "credor", "favorecido"].includes(column)).slice(0, 3),
    })),
  }))
}

function validScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function normalizeFilterValue(value: unknown, op: string) {
  if (op === "in") {
    if (!Array.isArray(value) || value.length > MAX_IN_VALUES || !value.every((item) => validScalar(item) && (typeof item !== "string" || item.length <= 240))) throw new Error("Filtro IN inválido.")
    return value
  }
  if (!validScalar(value)) throw new Error("Valor de filtro inválido.")
  if (typeof value === "string" && value.length > 240) throw new Error("Valor de filtro muito longo.")
  return value
}

function makeSelection(table: string, columns: string[], includes: string[], filters: FilterSpec[], scope: TableScope, flags: SensitiveFlags) {
  const parts = [...columns]
  const selectedRelationAliases = new Set<string>()
  let fieldBudget = MAX_COLUMNS - columns.length
  const relationMap = RELATIONS[table] || {}
  for (const relationName of includes) {
    const relation = Object.hasOwn(relationMap, relationName) ? relationMap[relationName] : undefined
    if (!relation) throw new Error(`Relação não permitida: ${relationName}.`)
    const relationColumns = allowedColumns(relation.table, flags).filter((column) =>
      ["nome", "cargo", "funcao", "numero", "status", "competencia", "nome_fantasia", "razao_social", "fornecedor", "credor", "favorecido"].includes(column)
    ).slice(0, Math.min(3, fieldBudget))
    if (!relationColumns.length) throw new Error("A relação não tem campos permitidos.")
    fieldBudget -= relationColumns.length
    const relationFilter = filters.some((filter) => isRecord(filter) && typeof filter.column === "string" && filter.column.startsWith(`${relationName}.`))
    const joinType = relationFilter ? "!inner" : ""
    parts.push(`${relationName}:${relation.table}!${relation.foreignKey}${joinType}(empresa_id,${relationColumns.join(",")})`)
    selectedRelationAliases.add(relationName)
  }
  const scopeAliases: string[] = []
  for (const relation of scope.relations) {
    const alias = relation.alias.replace(/^__/, "scope_")
    if (selectedRelationAliases.has(alias)) continue
    parts.push(`${alias}:${relation.table}!${relation.foreignKey}!inner(empresa_id)`)
    scopeAliases.push(alias)
  }
  return { selection: parts.join(","), scopeAliases }
}

function applyFilter(builder: any, filter: FilterSpec, table: string, includes: string[], flags: SensitiveFlags) {
  if (!isRecord(filter) || typeof filter.column !== "string" || typeof filter.op !== "string") throw new Error("Filtro inválido.")
  if (!isFilterColumnAllowed(table, filter.column, includes, flags)) throw new Error(`Coluna de filtro não permitida: ${filter.column}.`)
  const op = filter.op
  const supported = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "ilike", "in", "is"])
  if (!supported.has(op)) throw new Error(`Operador não permitido: ${op}.`)
  const value = normalizeFilterValue(filter.value, op)
  if (op === "ilike" && typeof value !== "string") throw new Error("O filtro ilike exige texto.")
  if (op === "is" && value !== null && typeof value !== "boolean") throw new Error("O filtro is exige null ou booleano.")
  return op === "in" ? builder.in(filter.column, value)
    : op === "is" ? builder.is(filter.column, value)
      : builder[op](filter.column, value)
}

function getPath(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => isRecord(value) ? value[part] : undefined, row)
}

function validateGroupPath(table: string, path: string, columns: string[], includes: string[], flags: SensitiveFlags) {
  if (columns.includes(path) && isColumnAllowed(table, path, flags)) return true
  const [relationName, column, ...extra] = path.split(".")
  const relationMap = RELATIONS[table] || {}
  const relation = Object.hasOwn(relationMap, relationName) ? relationMap[relationName] : undefined
  return Boolean(relation && !extra.length && includes.includes(relationName) && isColumnAllowed(relation.table, column, flags))
}

function isNumericPathAllowed(table: string, path: string, includes: string[], flags: SensitiveFlags) {
  if (isColumnAllowed(table, path, flags) && TABLE_NUMERIC_COLUMNS[table]?.includes(path)) return true
  const [relationName, column, ...extra] = path.split(".")
  const relationMap = RELATIONS[table] || {}
  const relation = Object.hasOwn(relationMap, relationName) ? relationMap[relationName] : undefined
  return Boolean(relation && !extra.length && includes.includes(relationName)
    && isColumnAllowed(relation.table, column, flags) && TABLE_NUMERIC_COLUMNS[relation.table]?.includes(column))
}

function isTextPath(table: string, path: string) {
  const [relationName, column, ...extra] = path.split(".")
  if (extra.length) return true
  const relationMap = RELATIONS[table] || {}
  const relation = Object.hasOwn(relationMap, relationName) ? relationMap[relationName] : undefined
  const targetTable = relation ? relation.table : table
  const targetColumn = relation ? column : path
  return CONDITIONAL_TEXT_COLUMNS.has(targetColumn) || Boolean(MEDICAL_TABLE_COLUMNS[targetTable]?.has(targetColumn))
}

function cleanRow(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanRow)
  if (typeof value === "string") {
    const redacted = redactSensitiveText(value)
    return redacted.length > MAX_TEXT_FIELD_CHARS ? `${redacted.slice(0, MAX_TEXT_FIELD_CHARS)}…[texto truncado]` : redacted
  }
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === "id" || key.endsWith("_id") || key === "empresa_id" || key.startsWith("scope_") || key.startsWith("__scope")) continue
    result[key] = cleanRow(item)
  }
  return result
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[CNPJ removido]")
    .replace(/\b\d{14}\b/g, "[CNPJ removido]")
    .replace(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b/g, "[CPF removido]")
    .replace(/\b\d{11}\b/g, "[CPF removido]")
    .replace(/\b(conta|ag[eê]ncia|pix|banco|chave)\s*(?:n[ºo.]?\s*)?[:#-]?\s*\d{5,20}\b/gi, "$1 [dado bancário removido]")
    .replace(/\b(?:rg|cnh|ctps|pis|pasep)\s*(?:n[ºo.]?\s*)?[:#-]?\s*[\w.-]{4,20}\b/gi, "[identificador removido]")
    .replace(/\bcep\s*[:#-]?\s*\d{5}-?\d{3}\b/gi, "[CEP removido]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[e-mail removido]")
    .replace(/(?:\+?55\s*)?\(?\d{2}\)?[\s.-]?\d{4,5}[-\s]?\d{4}/g, "[telefone removido]")
    .replace(/\b(?:rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada|logradouro|endere[cç]o)\b[^;\n]{0,160}/gi, "[endereço removido]")
    .replace(/\b(senha|password|token|secret|api[_ -]?key)\s*[:=]\s*["']?[^,\s"']+/gi, "$1=[credencial removida]")
    .replace(/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:publishable|secret)_[\w-]{12,}|sk_[\w-]{12,}|gh[pousr]_[\w]{12,})\b/gi, "[credencial removida]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[identificador removido]")
    .replace(/(?:https?|ftp|s3|file|mailto):\/\/[^\s<>"']+|www\.[^\s<>"']+/gi, "[link removido]")
    .replace(/\b[\w.-]+\.(?:com(?:\.br)?|net|org|io|br|gov(?:\.br)?)(?:\/[^\s<>"']*)?/gi, "[link removido]")
}

function aggregateRows(rows: Record<string, unknown>[], aggregate: AggregateSpec, table: string, columns: string[], includes: string[], flags: SensitiveFlags) {
  const operation = aggregate.operation
  if (!new Set(["count", "sum", "avg", "min", "max"]).has(operation)) throw new Error("Agregação não permitida.")
  const groupBy = Array.isArray(aggregate.groupBy) ? aggregate.groupBy : []
  if (groupBy.length > 4 || groupBy.some((path) => typeof path !== "string" || isTextPath(table, path) || !validateGroupPath(table, path, columns, includes, flags))) {
    throw new Error("Campo de agrupamento inválido.")
  }
  if (operation !== "count" && (typeof aggregate.column !== "string" || !columns.includes(aggregate.column) || !isNumericPathAllowed(table, aggregate.column, includes, flags))) {
    throw new Error("A agregação exige uma coluna numérica permitida.")
  }
  const groups = new Map<string, { group: Record<string, unknown>; count: number; valueCount: number; sum: number; min: number; max: number }>()
  for (const row of rows) {
    const group: Record<string, unknown> = {}
    for (const path of groupBy) group[path] = getPath(row, path) ?? null
    const key = JSON.stringify(group)
    const current = groups.get(key) || { group, count: 0, valueCount: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
    current.count += 1
    if (operation !== "count") {
      const raw = getPath(row, aggregate.column!)
      const number = typeof raw === "number" ? raw : Number(raw)
      if (Number.isFinite(number)) {
        current.valueCount += 1
        current.sum += number
        current.min = Math.min(current.min, number)
        current.max = Math.max(current.max, number)
      }
    }
    groups.set(key, current)
  }
  if (!groups.size && groupBy.length === 0) groups.set("{}", { group: {}, count: 0, valueCount: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY })
  const groupedRows = Array.from(groups.values())
  const groupTruncated = groupedRows.length > MAX_GROUPS
  const moneyValue = typeof aggregate.column === "string" && /valor|saldo|salario|preco|custo|receita|despesa|liquido|desconto|beneficio|base_/i.test(aggregate.column)
  const roundValue = (value: number | null) => value !== null && moneyValue ? Math.round((value + Number.EPSILON) * 100) / 100 : value
  const result = groupedRows.slice(0, MAX_GROUPS).map((item) => {
    let value: number | null
    if (operation === "count") value = item.count
    else if (operation === "sum") value = item.sum
    else if (operation === "avg") value = item.valueCount ? item.sum / item.valueCount : null
    else if (operation === "min") value = Number.isFinite(item.min) ? item.min : null
    else value = Number.isFinite(item.max) ? item.max : null
    return { group: cleanRow(item.group) as Record<string, unknown>, count: item.count, valueCount: item.valueCount, value: roundValue(value) }
  })
  return { rows: result, groupTruncated }
}

function buildQuery(admin: any, table: string, columns: string[], includes: string[], filters: FilterSpec[], scope: TableScope, tenantId: string, flags: SensitiveFlags, orderBy?: string, ascending?: boolean, stableOrder: string[] = []) {
  const { selection, scopeAliases } = makeSelection(table, columns, includes, filters, scope, flags)
  let builder = admin.from(table).select(selection, { count: "exact" })
  if (scope.direct) builder = builder.eq("empresa_id", tenantId)
  for (const alias of scopeAliases) builder = builder.eq(`${alias}.empresa_id`, tenantId)
  for (const relationName of includes) builder = builder.eq(`${relationName}.empresa_id`, tenantId)
  for (const filter of filters) builder = applyFilter(builder, filter, table, includes, flags)
  if (orderBy) {
    if (!isColumnAllowed(table, orderBy, flags)) throw new Error(`Coluna de ordenação não permitida: ${orderBy}.`)
    builder = builder.order(orderBy, { ascending: ascending !== false })
  }
  for (const primaryKey of stableOrder) if (primaryKey !== orderBy) builder = builder.order(primaryKey, { ascending: true })
  return builder
}

async function executeQuery(admin: any, input: QuerySpec, tenantId: string, flags: SensitiveFlags) {
  if (!isRecord(input) || typeof input.table !== "string") throw new Error("Consulta inválida.")
  const table = input.table
  const scope = tableScope(table)
  if (!scope) throw new Error(`Tabela fora do escopo permitido: ${table}.`)
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > MAX_COLUMNS || input.columns.some((column) => typeof column !== "string")) throw new Error(`Informe de 1 a ${MAX_COLUMNS} colunas permitidas.`)
  const columns = Array.from(new Set(input.columns))
  if (columns.some((column) => typeof column !== "string" || !isColumnAllowed(table, column, flags))) throw new Error(`A tabela ${table} contém coluna não permitida.`)
  if (input.include !== undefined && !Array.isArray(input.include)) throw new Error("Relação solicitada não permitida.")
  const includes = input.include === undefined ? [] : Array.from(new Set(input.include))
  const relationMap = RELATIONS[table] || {}
  if (includes.length > 4 || includes.some((name) => typeof name !== "string" || !Object.hasOwn(relationMap, name))) throw new Error("Relação solicitada não permitida.")
  const filters = input.filters === undefined ? [] : input.filters
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) throw new Error("Quantidade de filtros inválida.")
  const sort = typeof input.orderBy === "string" ? input.orderBy : undefined
  const aggregate = input.aggregate
  if (aggregate !== undefined) {
    if (!isRecord(aggregate)) throw new Error("Agregação inválida.")
    if (aggregate.groupBy !== undefined && (!Array.isArray(aggregate.groupBy) || aggregate.groupBy.some((path) => typeof path !== "string"))) throw new Error("Campo de agrupamento inválido.")
    const groupBy = Array.isArray(aggregate.groupBy) ? aggregate.groupBy as string[] : []
    if (columns.some((column) => isTextPath(table, column)) || groupBy.some((path) => isTextPath(table, path))) throw new Error("Agregações não podem varrer campos textuais livres.")
    if (groupBy.some((path) => !validateGroupPath(table, path, columns, includes, flags))) throw new Error("Campo de agrupamento inválido.")
    if (!new Set(["count", "sum", "avg", "min", "max"]).has(String(aggregate.operation))) throw new Error("Agregação não permitida.")
    if (aggregate.operation !== "count" && (typeof aggregate.column !== "string" || !columns.includes(aggregate.column) || !isNumericPathAllowed(table, aggregate.column, includes, flags))) throw new Error("A agregação exige uma coluna numérica permitida e selecionada.")
    const rows: Record<string, unknown>[] = []
    let totalCount = 0
    let offset = 0
    let complete = false
    while (offset < MAX_SCAN_ROWS) {
      const primaryOrder = Array.from(TABLE_PRIMARY_KEYS[table] || (TABLE_COLUMNS[table].includes("id") ? ["id"] : []))
      const paged = await buildQuery(admin, table, columns, includes, filters as FilterSpec[], scope, tenantId, flags, sort, input.ascending, primaryOrder)
        .range(offset, offset + SCAN_PAGE_SIZE - 1)
      const { data, error, count } = await paged
      if (error) throw new Error("Falha na leitura de uma tabela autorizada.")
      totalCount = count ?? totalCount
      const page = (data || []) as Record<string, unknown>[]
      rows.push(...page)
      offset += page.length
      if (page.length < SCAN_PAGE_SIZE) { complete = true; break }
      if (page.length === 0) { complete = true; break }
    }
    if (totalCount <= rows.length) complete = true
    const aggregates = aggregateRows(rows, aggregate, table, columns, includes, flags)
    const overallComplete = complete && !aggregates.groupTruncated
    const limitation = [
      ...(!complete ? [`A leitura atingiu o teto de ${MAX_SCAN_ROWS} linhas; agregados são parciais.`] : []),
      ...(aggregates.groupTruncated ? [`A exibição foi limitada a ${MAX_GROUPS} grupos; existem mais categorias.`] : []),
    ].join(" ") || null
    return {
      id: typeof input.id === "string" ? input.id.slice(0, 40) : undefined,
      table,
      mode: "aggregate",
      aggregateOperation: aggregate.operation,
      aggregateColumn: aggregate.column,
      aggregate: aggregates.rows,
      totalCount,
      scanned: rows.length,
      complete: overallComplete,
      limitation,
    }
  }

  const limit = input.limit === undefined ? 100 : Number(input.limit)
  const offset = input.offset === undefined ? 0 : Number(input.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) throw new Error(`O limite de linhas deve ser entre 1 e ${MAX_ROWS}.`)
  if (!Number.isInteger(offset) || offset !== 0) throw new Error("A paginação não é retomada automaticamente; refine os filtros da consulta.")
  const primaryOrder = Array.from(TABLE_PRIMARY_KEYS[table] || (TABLE_COLUMNS[table].includes("id") ? ["id"] : []))
  const { data, error, count } = await buildQuery(admin, table, columns, includes, filters as FilterSpec[], scope, tenantId, flags, sort, input.ascending, primaryOrder)
    .range(offset, offset + limit - 1)
  if (error) throw new Error("Falha na leitura de uma tabela autorizada.")
  const rows = ((data || []) as unknown[]).map(cleanRow)
  const totalCount = count ?? rows.length
  return {
    id: typeof input.id === "string" ? input.id.slice(0, 40) : undefined,
    table,
    mode: "rows",
    rows,
    returned: rows.length,
    totalCount,
    hasMore: offset + rows.length < totalCount,
    complete: offset + rows.length >= totalCount,
  }
}

async function limitedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null
  if (!request.body) return undefined
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown } catch { return undefined }
  } catch {
    return undefined
  }
}

async function authenticate(admin: any, token: string) {
  const { data: allowed, error: allowedError } = await admin.rpc("app_financeiro_admin_allowed", { p_token: token })
  if (allowedError || allowed !== true) return null
  const { data, error } = await admin.rpc("app_tenant_usuario", { p_token: token })
  if (error) return null
  const identity = Array.isArray(data) ? data[0] : data
  if (!isRecord(identity) || typeof identity.empresa_id !== "string" || typeof identity.usuario_id !== "string") return null
  return { tenantId: identity.empresa_id, actorId: identity.usuario_id }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin")
  if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse(request, { sucesso: false, erro: "Origem não permitida." }, 403)
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) })
  if (request.method !== "POST") return jsonResponse(request, { sucesso: false, erro: "Método não permitido." }, 405)

  const token = getToken(request)
  if (!token || token.length > 2048) return jsonResponse(request, { sucesso: false, erro: "Sessão inválida ou não informada." }, 401)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(request, { sucesso: false, erro: "Gateway não configurado." }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any
  const identity = await authenticate(admin, token)
  if (!identity) return jsonResponse(request, { sucesso: false, erro: "Acesso restrito a uma sessão administrativa válida." }, 403)
  const rawBody = await limitedJson(request)
  if (rawBody === null) return jsonResponse(request, { sucesso: false, erro: "Requisição muito grande." }, 413)
  if (!isRecord(rawBody)) return jsonResponse(request, { sucesso: false, erro: "JSON inválido." }, 400)
  const action = rawBody.action
  const flags = normalizeFlags(rawBody.sensitive)
  if (action === "schema") {
    console.info("ai_read_audit", JSON.stringify({ event: "schema", actor: identity.actorId }))
    return jsonResponse(request, { sucesso: true, tables: buildCatalog(flags), readOnly: true })
  }
  if (action !== "query") return jsonResponse(request, { sucesso: false, erro: "Ação não suportada." }, 400)
  if (!Array.isArray(rawBody.queries) || rawBody.queries.length < 1 || rawBody.queries.length > MAX_QUERIES) {
    return jsonResponse(request, { sucesso: false, erro: `A consulta aceita de 1 a ${MAX_QUERIES} planos.` }, 400)
  }

  try {
    const results = []
    for (const query of rawBody.queries as QuerySpec[]) results.push(await executeQuery(admin, query, identity.tenantId, flags))
    console.info("ai_read_audit", JSON.stringify({
      event: "query",
      actor: identity.actorId,
      tables: results.map((item) => item.table),
      returned: results.map((item) => item.mode === "rows" ? item.returned : item.scanned),
      mode: results.map((item) => item.mode),
    }))
    return jsonResponse(request, { sucesso: true, readOnly: true, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Consulta não autorizada."
    const known = /não permitid|inválid|limite|quantidade|informe|exige|fora do limite|exige texto/i.test(message)
    return jsonResponse(request, { sucesso: false, erro: known ? message : "Não foi possível concluir uma consulta segura ao Supabase." }, known ? 400 : 500)
  }
})
