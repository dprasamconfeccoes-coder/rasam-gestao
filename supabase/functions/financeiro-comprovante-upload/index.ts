import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-app-token, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  })

function safeFileName(name: string) {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-120) || "comprovante"
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json({ sucesso: false, erro: "Método não permitido" }, 405)

  const token = request.headers.get("x-app-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!token) return json({ sucesso: false, erro: "Sessão não informada" }, 401)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: tenants, error: sessionError } = await supabase.rpc("app_tenant_usuario", { p_token: token })
  const tenant = Array.isArray(tenants) ? tenants[0] : tenants
  if (sessionError || !tenant?.usuario_id || !tenant?.empresa_id) {
    return json({ sucesso: false, erro: "Sessão inválida" }, 401)
  }
  if (!["admin", "administrador", "gestor"].includes(tenant.perfil)) {
    return json({ sucesso: false, erro: "Acesso negado" }, 403)
  }

  const form = await request.formData()
  const parcelaId = String(form.get("parcela_id") || "")
  const file = form.get("arquivo")
  if (!parcelaId || !(file instanceof File)) {
    return json({ sucesso: false, erro: "Parcela e arquivo são obrigatórios" }, 400)
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ sucesso: false, erro: "Formato inválido. Envie PDF, JPG, PNG ou WEBP." }, 400)
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return json({ sucesso: false, erro: "O comprovante deve ter entre 1 byte e 10 MB." }, 400)
  }

  const { data: parcela, error: parcelaError } = await supabase
    .from("financeiro_parcelas")
    .select("id, empresa_id, status")
    .eq("id", parcelaId)
    .eq("empresa_id", tenant.empresa_id)
    .maybeSingle()
  if (parcelaError || !parcela) return json({ sucesso: false, erro: "Parcela não encontrada" }, 404)
  if (parcela.status === "pago") return json({ sucesso: false, erro: "Esta parcela já está baixada" }, 409)

  const path = `financeiro/${tenant.empresa_id}/${parcelaId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from("documentos-privados")
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false })
  if (uploadError) return json({ sucesso: false, erro: `Não foi possível armazenar o comprovante: ${uploadError.message}` }, 500)

  return json({ sucesso: true, caminho: path, nome: file.name })
})
