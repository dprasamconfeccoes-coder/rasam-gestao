import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const BUCKET = "documentos-privados"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION))
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type DebtDocumentKind = "documento_pagamento" | "comprovante"

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

function getToken(request: Request) {
  const appToken = request.headers.get("x-app-token")
  const authorization = request.headers.get("authorization")
  if (appToken) return appToken
  if (!authorization) return null
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : authorization
}

async function readLimited(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("content-length") || 0)
  if (declaredLength > maxBytes) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}

function safeFileName(name: string) {
  const safe = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/[.]{2,}/g, ".").replace(/^-+|-+$/g, "").slice(-120)
  return safe || "documento.pdf"
}

async function sniffMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value)
  let detected: string | null = null
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) detected = MIME_BY_EXTENSION.pdf
  else if (startsWith([0xff, 0xd8, 0xff])) detected = MIME_BY_EXTENSION.jpg
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = MIME_BY_EXTENSION.png
  else if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") detected = MIME_BY_EXTENSION.webp
  if (!detected) return null
  const declared = file.type.toLowerCase()
  if (declared && declared !== "application/octet-stream" && declared !== detected) return null
  const extension = file.name.toLowerCase().split(".").pop() || ""
  return MIME_BY_EXTENSION[extension] === detected ? detected : null
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return response({ sucesso: false, erro: "Método não permitido." }, 405)

  const token = getToken(request)
  if (!token) return response({ sucesso: false, erro: "Sessão não informada." }, 401)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return response({ sucesso: false, erro: "Armazenamento não configurado." }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: allowed, error: authError } = await admin.rpc("app_dividas_admin_allowed", { p_token: token })
  if (authError || allowed !== true) return response({ sucesso: false, erro: "Acesso restrito a administradores." }, 403)

  const contentType = (request.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("multipart/form-data")) {
    const rawBody = await readLimited(request, MAX_BODY_BYTES)
    if (!rawBody) return response({ sucesso: false, erro: "O arquivo deve ter no máximo 10 MB." }, 413)
    let form: FormData
    try {
      const parsed = new Request(request.url, { method: "POST", headers: request.headers, body: new Blob([rawBody]) })
      form = await parsed.formData()
    } catch {
      return response({ sucesso: false, erro: "Envie o arquivo como multipart/form-data." }, 400)
    }
    const action = String(form.get("action") || "")
    const installmentId = String(form.get("parcela_id") || "")
    const fileValue = form.get("arquivo")
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installmentId)) {
      return response({ sucesso: false, erro: "Parcela inválida." }, 400)
    }
    if (action !== "instruction" && action !== "settle") return response({ sucesso: false, erro: "Ação inválida." }, 400)
    if (action === "instruction" && !file) return response({ sucesso: false, erro: "Selecione o boleto ou documento de pagamento." }, 400)
    if (file && file.size > MAX_FILE_BYTES) return response({ sucesso: false, erro: "O arquivo deve ter no máximo 10 MB." }, 413)

    const documentKind: DebtDocumentKind = action === "instruction" ? "documento_pagamento" : "comprovante"
    const { data: preflight, error: preflightError } = await admin.rpc("app_admin_divida_documento_preflight", {
      p_token: token,
      p_parcela_id: installmentId,
      p_tipo: documentKind,
    })
    if (preflightError || !preflight?.sucesso || !preflight.empresa_id) {
      return response({ sucesso: false, erro: preflight?.erro || "A parcela não permite anexos neste estado." }, 403)
    }

    let storagePath: string | null = null
    let document: Record<string, unknown> | null = null
    if (file) {
      const mime = await sniffMime(file)
      if (!mime || !ALLOWED_MIME.has(mime)) return response({ sucesso: false, erro: "Formato não permitido. Use PDF, JPG, PNG ou WebP." }, 400)
      const originalName = file.name.trim().slice(0, 255) || "documento.pdf"
      storagePath = `${preflight.empresa_id}/dividas/${installmentId}/${crypto.randomUUID()}-${safeFileName(originalName)}`
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, file, { contentType: mime, upsert: false })
      if (uploadError) return response({ sucesso: false, erro: "Não foi possível armazenar o arquivo." }, 502)
      document = { storage_path: storagePath, arquivo_nome: originalName, mime_type: mime, tamanho_bytes: file.size }
    }

    if (action === "instruction") {
      const { data: registered, error: registerError } = await admin.rpc("app_admin_divida_documento_registrar", {
        p_token: token,
        p_parcela_id: installmentId,
        p_tipo: "documento_pagamento",
        p_storage_path: storagePath,
        p_arquivo_nome: document?.arquivo_nome,
        p_mime_type: document?.mime_type,
        p_tamanho_bytes: document?.tamanho_bytes,
      })
      if (registerError || !registered?.sucesso) {
        if (storagePath) await admin.storage.from(BUCKET).remove([storagePath])
        return response({ sucesso: false, erro: registered?.erro || "Não foi possível registrar o documento." }, 400)
      }
      return response({ sucesso: true, id: registered.id, arquivo_nome: document?.arquivo_nome })
    }

    const paidOn = String(form.get("pago_em") || "")
    const method = String(form.get("forma_pagamento") || "")
    const reason = String(form.get("motivo") || "").trim()
    if (!parseDate(paidOn) || !["pix", "transferencia", "boleto", "outro"].includes(method)) {
      if (storagePath) await admin.storage.from(BUCKET).remove([storagePath])
      return response({ sucesso: false, erro: "Informe uma data de pagamento e uma forma de pagamento válidas." }, 400)
    }
    const { data: paid, error: paidError } = await admin.rpc("app_admin_divida_parcela_quitar", {
      p_token: token,
      p_parcela_id: installmentId,
      p_pago_em: paidOn,
      p_forma_pagamento: method,
      p_motivo: reason || null,
      p_documento: document,
    })
    if (paidError || !paid?.sucesso) {
      if (storagePath) await admin.storage.from(BUCKET).remove([storagePath])
      return response({ sucesso: false, erro: paid?.erro || "Não foi possível registrar a quitação." }, 400)
    }
    return response({ sucesso: true, arquivo_nome: document?.arquivo_nome || null })
  }

  const rawBody = await readLimited(request, 8192)
  if (!rawBody) return response({ sucesso: false, erro: "Requisição muito grande." }, 413)
  let body: Record<string, unknown>
  try { body = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown> }
  catch { return response({ sucesso: false, erro: "Requisição inválida." }, 400) }

  if (body.action === "download") {
    const attachmentId = String(body.arquivo_id || "")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) return response({ sucesso: false, erro: "Arquivo não encontrado." }, 404)
    const { data: access, error: accessError } = await admin.rpc("app_admin_divida_documento_caminho", { p_token: token, p_arquivo_id: attachmentId })
    if (accessError || !access?.sucesso || !access.storage_path) return response({ sucesso: false, erro: access?.erro || "Acesso negado ao arquivo." }, 403)
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(String(access.storage_path), 300, { download: String(access.arquivo_nome || "documento") })
    if (signedError || !signed?.signedUrl) return response({ sucesso: false, erro: "Não foi possível preparar o download." }, 502)
    return response({ sucesso: true, url: signed.signedUrl, expires_in: 300, arquivo_nome: access.arquivo_nome })
  }

  if (body.action === "settle") {
    const installmentId = String(body.parcela_id || "")
    const paidOn = String(body.pago_em || "")
    const method = String(body.forma_pagamento || "")
    const reason = String(body.motivo || "").trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installmentId) || !parseDate(paidOn) || !["pix", "transferencia", "boleto", "outro"].includes(method)) {
      return response({ sucesso: false, erro: "Informe parcela, data e forma de pagamento válidas." }, 400)
    }
    const { data: paid, error: paidError } = await admin.rpc("app_admin_divida_parcela_quitar", {
      p_token: token,
      p_parcela_id: installmentId,
      p_pago_em: paidOn,
      p_forma_pagamento: method,
      p_motivo: reason || null,
      p_documento: null,
    })
    if (paidError || !paid?.sucesso) return response({ sucesso: false, erro: paid?.erro || "Não foi possível registrar a quitação." }, 400)
    return response({ sucesso: true })
  }

  return response({ sucesso: false, erro: "Ação não reconhecida." }, 400)
})
