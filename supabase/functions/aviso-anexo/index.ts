import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "rh-avisos-privados";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getToken(request: Request) {
  const appToken = request.headers.get("x-app-token");
  const authorization = request.headers.get("authorization");
  if (appToken) return appToken;
  if (!authorization) return null;
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : authorization;
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function sniffMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  let detected: string | null = null;
  if (new TextDecoder().decode(bytes).includes("%PDF-")) detected = "application/pdf";
  else if (startsWith([0xff, 0xd8, 0xff])) detected = "image/jpeg";
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = "image/png";
  else if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") detected = "image/webp";
  if (!detected) return null;
  const declared = file.type.toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== detected) return null;
  const ext = file.name.toLowerCase().split(".").pop() || "";
  const compatible = (detected === "application/pdf" && ext === "pdf")
    || (detected === "image/jpeg" && ["jpg", "jpeg"].includes(ext))
    || (detected === "image/png" && ext === "png")
    || (detected === "image/webp" && ext === "webp");
  return compatible ? detected : null;
}

function safeFileName(name: string, mime: string) {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/[.]{2,}/g, ".").replace(/^-+|-+$/g, "").slice(-100);
  return safe || `anexo.${mime === "application/pdf" ? "pdf" : "jpg"}`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ sucesso: false, erro: "Método não permitido" }, 405);
  const token = getToken(request);
  if (!token) return response({ sucesso: false, erro: "Sessão não informada" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ sucesso: false, erro: "Ambiente de armazenamento não configurado" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: sessionError } = await admin.rpc("app_sessao", { p_token: token });
  if (sessionError || !session?.valido) return response({ sucesso: false, erro: "Sessão inválida" }, 401);

  let action = "";
  let body: Record<string, unknown> = {};
  let form: FormData | null = null;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    try { form = await request.formData(); action = String(form.get("action") || "upload"); }
    catch { return response({ sucesso: false, erro: "Envie o arquivo como multipart/form-data" }, 400); }
  } else {
    try { body = await request.json(); action = String(body.action || "signed-url"); }
    catch { return response({ sucesso: false, erro: "Requisição inválida" }, 400); }
  }

  if (action === "upload") {
    const noticeId = String(form?.get("aviso_id") || "");
    const file = form?.get("arquivo");
    if (!isUuid(noticeId)) return response({ sucesso: false, erro: "Aviso inválido" }, 400);
    if (!(file instanceof File) || !file.name || file.size < 1) return response({ sucesso: false, erro: "Selecione um arquivo" }, 400);
    if (file.size > MAX_FILE_BYTES) return response({ sucesso: false, erro: "Cada arquivo deve ter no máximo 10 MB" }, 400);

    const { data: preflight, error: preflightError } = await admin.rpc("app_admin_aviso_anexo_preflight", { p_token: token, p_aviso_id: noticeId });
    if (preflightError || !preflight?.sucesso || !preflight.empresa_id) return response({ sucesso: false, erro: preflight?.erro || "Sem permissão para anexar arquivos" }, 403);
    const mime = await sniffMime(file);
    if (!mime || !ALLOWED_MIME.has(mime)) return response({ sucesso: false, erro: "Use um PDF ou uma imagem JPG, PNG ou WebP válida" }, 400);

    const originalName = file.name.trim().slice(0, 255) || safeFileName(file.name, mime);
    const path = `${preflight.empresa_id}/${noticeId}/${crypto.randomUUID()}-${safeFileName(file.name, mime)}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (uploadError) return response({ sucesso: false, erro: "Não foi possível armazenar o anexo" }, 502);

    const { data: saved, error: saveError } = await admin.rpc("app_admin_registrar_aviso_anexo", {
      p_token: token,
      p_aviso_id: noticeId,
      p_storage_path: path,
      p_nome_arquivo: originalName,
      p_mime_type: mime,
      p_tamanho_bytes: file.size,
    });
    if (saveError || !saved?.sucesso) {
      await admin.storage.from(BUCKET).remove([path]);
      return response({ sucesso: false, erro: saved?.erro || "Não foi possível registrar o anexo" }, 400);
    }
    return response({ sucesso: true, anexo_id: saved.id, nome_arquivo: originalName, mime_type: mime, tamanho_bytes: file.size });
  }

  if (action === "signed-url") {
    const attachmentId = String(body.anexo_id || "");
    if (!isUuid(attachmentId)) return response({ sucesso: false, erro: "Anexo não encontrado" }, 404);
    const { data: access, error: accessError } = await admin.rpc("app_aviso_anexo_path", { p_token: token, p_anexo_id: attachmentId });
    if (accessError || !access?.sucesso || !access.caminho) return response({ sucesso: false, erro: access?.erro || "Acesso negado ao anexo" }, 403);
    const forceDownload = Boolean(body.download);
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(access.caminho, 300, { download: forceDownload });
    if (signedError || !signed?.signedUrl) return response({ sucesso: false, erro: "Não foi possível abrir o anexo" }, 502);
    return response({ sucesso: true, url: signed.signedUrl, expires_in: 300, mime_type: access.mime_type, nome_arquivo: access.nome });
  }
  return response({ sucesso: false, erro: "Ação inválida" }, 400);
});
