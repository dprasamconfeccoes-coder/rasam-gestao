import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token, x-document-group-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "documentos-privados";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION));

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
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

async function readLimited(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}

async function sniffMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  let detected: string | null = null;
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) detected = MIME_BY_EXTENSION.pdf;
  else if (startsWith([0xff, 0xd8, 0xff])) detected = MIME_BY_EXTENSION.jpg;
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = MIME_BY_EXTENSION.png;
  else if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") detected = MIME_BY_EXTENSION.webp;
  else if (startsWith([0x50, 0x4b, 0x03, 0x04])) {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (["docx", "xlsx", "pptx"].includes(ext)) detected = MIME_BY_EXTENSION[ext];
  }
  if (!detected) return null;
  const declared = file.type.toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== detected) return null;
  const extension = file.name.toLowerCase().split(".").pop() || "";
  return MIME_BY_EXTENSION[extension] === detected ? detected : null;
}
function safeFileName(name: string) {
  const safe = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/[.]{2,}/g, ".").replace(/^-+|-+$/g, "").slice(-120);
  return safe || "documento.pdf";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ sucesso: false, erro: "Método não permitido" }, 405);
  const token = getToken(request);
  if (!token) return response({ sucesso: false, erro: "Sessão não informada" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ sucesso: false, erro: "Armazenamento não configurado" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: sessionError } = await admin.rpc("app_sessao", { p_token: token });
  if (sessionError || !session?.valido) return response({ sucesso: false, erro: "Sessão inválida" }, 401);

  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const groupId = request.headers.get("x-document-group-id") || "";
    if (!isUuid(groupId)) return response({ sucesso: false, erro: "Documento inválido" }, 400);
    const { data: preflight, error: preflightError } = await admin.rpc("app_documento_interno_preflight", { p_token: token, p_grupo_id: groupId });
    if (preflightError || !preflight?.sucesso || !preflight.empresa_id || !preflight.versao) {
      return response({ sucesso: false, erro: preflight?.erro || "Somente administradores podem enviar documentos." }, 403);
    }

    const rawBody = await readLimited(request, MAX_BODY_BYTES);
    if (!rawBody) return response({ sucesso: false, erro: "O arquivo deve ter no máximo 20 MB." }, 413);
    let form: FormData;
    try {
      const parsedRequest = new Request(request.url, { method: "POST", headers: request.headers, body: new Blob([rawBody]) });
      form = await parsedRequest.formData();
    } catch {
      return response({ sucesso: false, erro: "Envie o arquivo como multipart/form-data" }, 400);
    }

    const postedGroup = String(form.get("grupo_id") || "");
    const file = form.get("arquivo");
    const title = String(form.get("titulo") || "").trim();
    const category = String(form.get("categoria") || "");
    const description = String(form.get("descricao") || "").trim();
    const visibleToEmployees = String(form.get("disponivel_funcionarios") || "false") === "true";
    if (postedGroup !== groupId) return response({ sucesso: false, erro: "Documento inválido" }, 400);
    if (!(file instanceof File) || !file.name || file.size < 1) return response({ sucesso: false, erro: "Selecione um arquivo" }, 400);
    if (file.size > MAX_FILE_BYTES) return response({ sucesso: false, erro: "O arquivo deve ter no máximo 20 MB." }, 413);
    if (title.length < 2 || title.length > 180 || description.length > 5000) return response({ sucesso: false, erro: "Confira o título e a descrição do documento." }, 400);
    if (!["regimento", "cct", "ponto", "campanha", "comunicado", "politica", "outro"].includes(category)) return response({ sucesso: false, erro: "Selecione uma categoria válida." }, 400);
    const mime = await sniffMime(file);
    if (!mime || !ALLOWED_MIME.has(mime)) return response({ sucesso: false, erro: "Formato não permitido. Use PDF, JPG, PNG, WebP, DOCX, XLSX ou PPTX." }, 400);

    const originalName = file.name.trim().slice(0, 255);
    const storagePath = `${preflight.empresa_id}/documentos-internos/${groupId}/v${preflight.versao}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, file, { contentType: mime, upsert: false });
    if (uploadError) return response({ sucesso: false, erro: "Não foi possível armazenar o documento." }, 502);

    const { data: registered, error: registerError } = await admin.rpc("app_admin_registrar_documento_interno", {
      p_token: token,
      p_grupo_id: groupId,
      p_versao: preflight.versao,
      p_titulo: title,
      p_categoria: category,
      p_descricao: description,
      p_disponivel_funcionarios: visibleToEmployees,
      p_storage_path: storagePath,
      p_arquivo_nome: originalName,
      p_mime_type: mime,
      p_tamanho_bytes: file.size,
    });
    if (registerError || !registered?.sucesso) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      return response({ sucesso: false, erro: registered?.erro || "Não foi possível registrar o documento." }, 400);
    }
    return response({ sucesso: true, documento_id: registered.id, grupo_id: groupId, versao: registered.versao, arquivo_nome: originalName });
  }

  const rawBody = await readLimited(request, 8192);
  if (!rawBody) return response({ sucesso: false, erro: "Requisição muito grande" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>; }
  catch { return response({ sucesso: false, erro: "Requisição inválida" }, 400); }
  if (body.action === "list") {
    const { data: listing, error: listingError } = await admin.rpc("app_listar_documentos", { p_token: token });
    if (listingError || !listing?.sucesso) return response({ sucesso: false, erro: listing?.erro || "Não foi possível listar os documentos." }, 403);
    return response(listing);
  }
  if (body.action === "update-metadata") {
    const groupId = String(body.grupo_id || "");
    if (!isUuid(groupId)) return response({ sucesso: false, erro: "Documento inválido." }, 400);
    const { data: updated, error: updateError } = await admin.rpc("app_admin_atualizar_documento_interno", {
      p_token: token,
      p_grupo_id: groupId,
      p_titulo: String(body.titulo || ""),
      p_categoria: String(body.categoria || ""),
      p_descricao: typeof body.descricao === "string" ? body.descricao : null,
      p_disponivel_funcionarios: body.disponivel_funcionarios === true,
    });
    if (updateError || !updated?.sucesso) return response({ sucesso: false, erro: updated?.erro || "Não foi possível atualizar o documento." }, 403);
    return response({ sucesso: true });
  }
  if (body.action === "delete" || body.action === "restore") {
    const groupId = String(body.grupo_id || "");
    if (!isUuid(groupId)) return response({ sucesso: false, erro: "Documento inválido." }, 400);
    const operation = body.action === "delete" ? "app_documento_interno_excluir" : "app_documento_interno_restaurar";
    const { data: changed, error: changeError } = await admin.rpc(operation, { p_token: token, p_grupo_id: groupId });
    if (changeError || !changed?.sucesso) return response({ sucesso: false, erro: changed?.erro || "Não foi possível alterar o estado do documento." }, 403);
    return response(changed);
  }
  const documentId = String(body.documento_id || "");
  if (!isUuid(documentId)) return response({ sucesso: false, erro: "Documento não encontrado" }, 404);
  const { data: access, error: accessError } = await admin.rpc("app_documento_interno_caminho", { p_token: token, p_documento_id: documentId });
  if (accessError || !access?.sucesso) return response({ sucesso: false, erro: access?.erro || "Acesso negado ao documento." }, 403);
  if (access.caminho) {
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(
      String(access.caminho), 300, { download: String(access.nome || "documento") },
    );
    if (signedError || !signed?.signedUrl) return response({ sucesso: false, erro: "Não foi possível preparar o download." }, 502);
    return response({ sucesso: true, url: signed.signedUrl, expires_in: 300, nome_arquivo: access.nome, mime_type: access.mime_type });
  }
  if (typeof access.arquivo_url === "string" && access.arquivo_url.startsWith("https://")) {
    return response({ sucesso: true, url: access.arquivo_url, expires_in: null, nome_arquivo: access.nome, mime_type: access.mime_type });
  }
  return response({ sucesso: false, erro: "Este registro não tem um arquivo disponível para download." }, 404);
});
