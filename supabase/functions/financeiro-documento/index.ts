import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const BUCKET = "documentos-privados"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_MULTIPART_BODY_BYTES = MAX_FILE_BYTES + 2 * 1024 * 1024
const MAX_JSON_BODY_BYTES = 64 * 1024
const SIGNED_URL_SECONDS = 300

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION))
const ALLOWED_TARGET_TYPES = new Set(["lancamento", "acordo_parcela"])
const ALLOWED_PAYMENT_METHODS = new Set(["pix", "transferencia", "boleto", "outro"])

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type TargetType = "lancamento" | "acordo_parcela"
type JsonObject = Record<string, unknown>
type StoredFile = {
  file: File
  arquivo_nome: string
  mime_type: string
  tamanho_bytes: number
}

type SupabaseAdmin = ReturnType<typeof createClient>

function response(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  })
}

function getToken(request: Request): string | null {
  const appToken = request.headers.get("x-app-token")?.trim()
  if (appToken) return appToken

  const authorization = request.headers.get("authorization")?.trim() || ""
  if (!authorization) return null
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim() || null
    : authorization
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as JsonObject
}

function rpcObject(value: unknown): JsonObject | null {
  const direct = asObject(value)
  if (direct) return direct
  if (Array.isArray(value) && value.length > 0) return asObject(value[0])
  return null
}

function rpcSucceeded(value: unknown): boolean {
  if (value === true) return true
  return rpcObject(value)?.sucesso === true
}

function rpcErrorMessage(value: unknown, fallback: string): string {
  const result = rpcObject(value)
  return typeof result?.erro === "string" && result.erro.trim() ? result.erro : fallback
}

async function readLimited(request: Request, maximumBytes: number): Promise<Uint8Array | null> {
  const declaredLength = request.headers.get("content-length")
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) return null
  }

  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function requestWithBody(request: Request, body: Uint8Array): Request {
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  headers.delete("transfer-encoding")
  return new Request(request.url, { method: request.method, headers, body: body as unknown as BodyInit })
}

function extensionForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf"
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  return "webp"
}

function extensionOf(name: string): string {
  const basename = name.replace(/^.*[\\/]/, "")
  const dot = basename.lastIndexOf(".")
  return dot >= 0 ? basename.slice(dot + 1).toLowerCase() : ""
}

function safeFileName(name: string, mime: string): string {
  const extension = extensionForMime(mime)
  const basename = name.replace(/^.*[\\/]/, "")
  const normalized = basename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const withoutExtension = normalized.replace(/\.[^.]*$/, "")
  const safeBase = withoutExtension
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 110)
  return `${safeBase || "documento"}.${extension}`
}

function safeDownloadName(name: string): string {
  const basename = name.replace(/^.*[\\/]/, "")
  const normalized = basename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const safe = normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120)
  return safe || "documento"
}

async function sniffMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const startsWith = (signature: number[]) =>
    bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value)

  let detected: string | null = null
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    detected = MIME_BY_EXTENSION.pdf
  } else if (startsWith([0xff, 0xd8, 0xff])) {
    detected = MIME_BY_EXTENSION.jpg
  } else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = MIME_BY_EXTENSION.png
  } else if (
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    detected = MIME_BY_EXTENSION.webp
  }
  if (!detected || !ALLOWED_MIME.has(detected)) return null

  const declaredMime = file.type.trim().toLowerCase()
  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== detected) return null

  const extension = extensionOf(file.name)
  if (MIME_BY_EXTENSION[extension] !== detected) return null
  return detected
}

async function validateFile(value: unknown): Promise<StoredFile | null> {
  if (!(value instanceof File) || value.size < 1 || value.size > MAX_FILE_BYTES || !value.name.trim()) return null
  const mime = await sniffMime(value)
  if (!mime) return null
  return {
    file: value,
    arquivo_nome: safeFileName(value.name, mime),
    mime_type: mime,
    tamanho_bytes: value.size,
  }
}

function targetIsValid(targetType: string, targetId: string): targetType is TargetType {
  return ALLOWED_TARGET_TYPES.has(targetType) && isUuid(targetId)
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function storagePath(empresaId: string, targetType: TargetType, targetId: string, fileName: string): string {
  const prefix = targetType === "lancamento"
    ? `financeiro/${empresaId}/lancamentos/${targetId}`
    : `acordos/${empresaId}/${targetId}`
  return `${prefix}/${crypto.randomUUID()}-${fileName}`
}

async function preflightDocument(
  admin: SupabaseAdmin,
  token: string,
  targetType: TargetType,
  targetId: string,
  documentType: "documento_pagamento" | "comprovante",
): Promise<{ result: JsonObject | null; allowed: boolean }> {
  const { data, error } = await admin.rpc("app_financeiro_documento_preflight", {
    p_token: token,
    p_alvo_tipo: targetType,
    p_alvo_id: targetId,
    p_tipo: documentType,
  })
  const result = rpcObject(data)
  const empresaId = typeof result?.empresa_id === "string" ? result.empresa_id : ""
  return { result, allowed: !error && result?.sucesso === true && isUuid(empresaId) }
}

async function uploadFile(
  admin: SupabaseAdmin,
  empresaId: string,
  targetType: TargetType,
  targetId: string,
  storedFile: StoredFile,
): Promise<{ path: string; error: boolean }> {
  const path = storagePath(empresaId, targetType, targetId, storedFile.arquivo_nome)
  const { error } = await admin.storage.from(BUCKET).upload(path, storedFile.file, {
    contentType: storedFile.mime_type,
    cacheControl: "3600",
    upsert: false,
  })
  return { path, error: Boolean(error) }
}

function documentMetadata(path: string, file: StoredFile): JsonObject {
  return {
    storage_path: path,
    arquivo_nome: file.arquivo_nome,
    mime_type: file.mime_type,
    tamanho_bytes: file.tamanho_bytes,
  }
}

async function handleInstruction(
  admin: SupabaseAdmin,
  token: string,
  form: FormData,
): Promise<Response> {
  const targetType = String(form.get("alvo_tipo") || "")
  const targetId = String(form.get("alvo_id") || "")
  if (!targetIsValid(targetType, targetId)) {
    return response({ sucesso: false, erro: "Alvo inválido." }, 400)
  }

  const storedFile = await validateFile(form.get("arquivo"))
  if (!storedFile) {
    return response({ sucesso: false, erro: "Envie um PDF ou uma imagem JPG, PNG ou WebP válida de até 10 MB." }, 400)
  }

  const preflight = await preflightDocument(admin, token, targetType, targetId, "documento_pagamento")
  if (!preflight.allowed || !preflight.result) {
    return response({ sucesso: false, erro: rpcErrorMessage(preflight.result, "O documento não pode ser anexado a este alvo.") }, 403)
  }

  const empresaId = String(preflight.result.empresa_id)
  const uploaded = await uploadFile(admin, empresaId, targetType, targetId, storedFile)
  if (uploaded.error) {
    return response({ sucesso: false, erro: "Não foi possível armazenar o documento." }, 502)
  }

  const { data, error } = await admin.rpc("app_financeiro_documento_registrar", {
    p_token: token,
    p_alvo_tipo: targetType,
    p_alvo_id: targetId,
    p_tipo: "documento_pagamento",
    p_storage_path: uploaded.path,
    p_arquivo_nome: storedFile.arquivo_nome,
    p_mime_type: storedFile.mime_type,
    p_tamanho_bytes: storedFile.tamanho_bytes,
  })
  const result = rpcObject(data)
  if (error || !rpcSucceeded(data)) {
    await admin.storage.from(BUCKET).remove([uploaded.path])
    return response({ sucesso: false, erro: rpcErrorMessage(result, "Não foi possível registrar o documento.") }, 400)
  }

  const output: JsonObject = { sucesso: true, arquivo_nome: storedFile.arquivo_nome }
  if (typeof result?.id === "string") output.documento_id = result.id
  return response(output)
}

async function settle(
  admin: SupabaseAdmin,
  token: string,
  targetType: string,
  targetId: string,
  paidOn: string,
  paymentMethod: string,
  reason: string,
  storedFile: StoredFile | null,
): Promise<Response> {
  if (!targetIsValid(targetType, targetId)) {
    return response({ sucesso: false, erro: "Alvo inválido." }, 400)
  }
  if (!validDate(paidOn) || !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    return response({ sucesso: false, erro: "Informe uma data de pagamento e uma forma de pagamento válidas." }, 400)
  }

  let path: string | null = null
  let document: JsonObject | null = null
  if (storedFile) {
    const preflight = await preflightDocument(admin, token, targetType, targetId, "comprovante")
    if (!preflight.allowed || !preflight.result) {
      return response({ sucesso: false, erro: rpcErrorMessage(preflight.result, "O comprovante não pode ser anexado a este alvo.") }, 403)
    }

    const uploaded = await uploadFile(admin, String(preflight.result.empresa_id), targetType, targetId, storedFile)
    if (uploaded.error) {
      return response({ sucesso: false, erro: "Não foi possível armazenar o comprovante." }, 502)
    }
    path = uploaded.path
    document = documentMetadata(path, storedFile)
  }

  const rpcName = targetType === "lancamento"
    ? "app_financeiro_lancamento_quitar"
    : "app_admin_quitar_acordo_parcela"
  const rpcArgs: JsonObject = {
    p_token: token,
    p_pago_em: paidOn,
    p_forma_pagamento: paymentMethod,
    p_motivo: reason || null,
    p_documento: document,
  }
  if (targetType === "lancamento") rpcArgs.p_id = targetId
  else rpcArgs.p_parcela_id = targetId

  const { data, error } = await admin.rpc(rpcName, rpcArgs)
  if (error || !rpcSucceeded(data)) {
    if (path) await admin.storage.from(BUCKET).remove([path])
    return response({ sucesso: false, erro: rpcErrorMessage(data, "Não foi possível registrar a quitação.") }, 400)
  }

  const output: JsonObject = { sucesso: true }
  if (storedFile) output.arquivo_nome = storedFile.arquivo_nome
  return response(output)
}

async function handleMultipart(
  request: Request,
  admin: SupabaseAdmin,
  token: string,
): Promise<Response> {
  const boundedBody = await readLimited(request, MAX_MULTIPART_BODY_BYTES)
  if (!boundedBody) return response({ sucesso: false, erro: "O corpo da requisição excede o limite permitido." }, 413)

  let form: FormData
  try {
    form = await requestWithBody(request, boundedBody).formData()
  } catch {
    return response({ sucesso: false, erro: "Envie o arquivo como multipart/form-data." }, 400)
  }

  const action = String(form.get("action") || "")
  if (action === "instruction") return handleInstruction(admin, token, form)
  if (action !== "settle") return response({ sucesso: false, erro: "Ação inválida." }, 400)

  const fileValue = form.get("arquivo")
  let storedFile: StoredFile | null = null
  if (fileValue !== null) {
    if (!(fileValue instanceof File) || fileValue.size < 1) {
      return response({ sucesso: false, erro: "O comprovante enviado é inválido." }, 400)
    }
    storedFile = await validateFile(fileValue)
    if (!storedFile) {
      return response({ sucesso: false, erro: "Envie um comprovante PDF ou uma imagem JPG, PNG ou WebP válida de até 10 MB." }, 400)
    }
  }

  return settle(
    admin,
    token,
    String(form.get("alvo_tipo") || ""),
    String(form.get("alvo_id") || ""),
    String(form.get("pago_em") || ""),
    String(form.get("forma_pagamento") || ""),
    String(form.get("motivo") || "").trim(),
    storedFile,
  )
}

async function handleJson(
  request: Request,
  admin: SupabaseAdmin,
  token: string,
): Promise<Response> {
  const boundedBody = await readLimited(request, MAX_JSON_BODY_BYTES)
  if (!boundedBody) return response({ sucesso: false, erro: "O corpo da requisição excede o limite permitido." }, 413)

  let body: JsonObject
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(boundedBody))
    if (!asObject(parsed)) throw new Error("invalid-json")
    body = parsed as JsonObject
  } catch {
    return response({ sucesso: false, erro: "Requisição inválida." }, 400)
  }

  const action = String(body.action || "")
  if (action === "download") {
    const documentId = String(body.documento_id || "")
    if (!isUuid(documentId)) return response({ sucesso: false, erro: "Documento não encontrado." }, 404)

    const { data, error } = await admin.rpc("app_financeiro_documento_caminho", {
      p_token: token,
      p_documento_id: documentId,
    })
    const access = rpcObject(data)
    const pathValue = access?.caminho ?? access?.storage_path
    const path = typeof pathValue === "string" ? pathValue.trim() : ""
    if (error || !access || access.sucesso !== true || !path) {
      return response({ sucesso: false, erro: rpcErrorMessage(access, "Acesso negado ao documento.") }, 403)
    }

    const nameValue = access.arquivo_nome ?? access.nome_arquivo ?? access.nome
    const downloadName = safeDownloadName(typeof nameValue === "string" ? nameValue : "documento")
    const { data: signed, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS, { download: downloadName })
    if (signedError || !signed?.signedUrl) {
      return response({ sucesso: false, erro: "Não foi possível preparar o download." }, 502)
    }

    return response({ sucesso: true, url: signed.signedUrl, expires_in: SIGNED_URL_SECONDS, arquivo_nome: downloadName })
  }

  if (action === "settle") {
    return settle(
      admin,
      token,
      String(body.alvo_tipo || ""),
      String(body.alvo_id || ""),
      String(body.pago_em || ""),
      String(body.forma_pagamento || ""),
      String(body.motivo || "").trim(),
      null,
    )
  }

  return response({ sucesso: false, erro: "Ação inválida." }, 400)
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return response({ sucesso: false, erro: "Método não permitido." }, 405)

  const token = getToken(request)
  if (!token) return response({ sucesso: false, erro: "Sessão não informada." }, 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return response({ sucesso: false, erro: "Serviço não configurado." }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: allowed, error: allowedError } = await admin.rpc("app_financeiro_admin_allowed", { p_token: token })
  if (allowedError || allowed !== true) {
    return response({ sucesso: false, erro: "Acesso restrito a administradores financeiros." }, 403)
  }

  try {
    const contentType = (request.headers.get("content-type") || "").toLowerCase()
    if (contentType.includes("multipart/form-data")) return await handleMultipart(request, admin, token)
    return await handleJson(request, admin, token)
  } catch {
    return response({ sucesso: false, erro: "Não foi possível processar a requisição." }, 500)
  }
})
