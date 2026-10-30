import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const allowedTypes = new Set([
  "Atestado médico",
  "Declaração de comparecimento",
  "Atestado de acompanhante",
  "Justificativa",
  "Outro",
]);

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

async function sniffMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  let detected: string | null = null;

  if (new TextDecoder().decode(bytes).includes("%PDF-")) detected = "application/pdf";
  else if (startsWith([0xff, 0xd8, 0xff])) detected = "image/jpeg";
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = "image/png";
  else if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) detected = "image/webp";

  if (!detected) return null;
  const declared = file.type.toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== detected) return null;

  const extension = file.name.toLowerCase().split(".").pop() || "";
  const compatibleExtension =
    (detected === "application/pdf" && extension === "pdf") ||
    (detected === "image/jpeg" && ["jpg", "jpeg"].includes(extension)) ||
    (detected === "image/png" && extension === "png") ||
    (detected === "image/webp" && extension === "webp");
  return compatibleExtension ? detected : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ sucesso: false, erro: "Método não permitido" }, 405);

  const token = getToken(request);
  if (!token) return response({ sucesso: false, erro: "Sessão não informada" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ sucesso: false, erro: "Ambiente de armazenamento não configurado" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: sessionError } = await admin.rpc("app_sessao", { p_token: token });
  if (sessionError || !session?.valido || !session.funcionario_id) {
    return response({ sucesso: false, erro: "Sessão inválida" }, 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return response({ sucesso: false, erro: "Envie o documento como multipart/form-data" }, 400);
  }

  const file = form.get("arquivo");
  const tipo = String(form.get("tipo") || "Atestado médico").trim();
  const dataAtendimento = String(form.get("data_atendimento") || "").trim();
  const dias = Number(form.get("dias") || 0);
  const cid = String(form.get("cid") || "").trim().toUpperCase();
  const observacao = String(form.get("observacao") || "").trim();

  if (!(file instanceof File) || !file.name || file.size < 1) {
    return response({ sucesso: false, erro: "Selecione um arquivo" }, 400);
  }
  if (file.size > MAX_FILE_BYTES) return response({ sucesso: false, erro: "O arquivo deve ter no máximo 10 MB" }, 400);
  if (!allowedTypes.has(tipo)) return response({ sucesso: false, erro: "Tipo de documento inválido" }, 400);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dataAtendimento)) return response({ sucesso: false, erro: "Informe a data da consulta" }, 400);
  const parsedDate = new Date(`${dataAtendimento}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dataAtendimento) {
    return response({ sucesso: false, erro: "Informe uma data de consulta válida" }, 400);
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
    return response({ sucesso: false, erro: "Os dias de afastamento devem estar entre 1 e 365" }, 400);
  }
  if (cid && (cid.length > 10 || !/^[A-Z][0-9]{2}(?:[.][A-Z0-9]{1,4})?$/.test(cid))) {
    return response({ sucesso: false, erro: "Informe um CID válido ou deixe em branco se não constar no documento" }, 400);
  }
  if (observacao.length > 1000) return response({ sucesso: false, erro: "A observação deve ter no máximo 1.000 caracteres" }, 400);

  const contentType = await sniffMime(file);
  if (!contentType) return response({ sucesso: false, erro: "Use um PDF ou uma imagem JPG, PNG ou WebP válida" }, 400);

  const safeName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[.]{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(-100) || `atestado.${contentType === "application/pdf" ? "pdf" : "jpg"}`;
  const originalName = file.name.trim().slice(0, 255) || safeName;
  const path = `atestados/${session.funcionario_id}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from("documentos-privados")
    .upload(path, file, { contentType, upsert: false });
  if (uploadError) return response({ sucesso: false, erro: "Não foi possível armazenar o documento" }, 502);

  const { data: saved, error: saveError } = await admin.rpc("salvar_atestado_v2", {
    p_token: token,
    p_tipo: tipo,
    p_data_atendimento: dataAtendimento,
    p_dias: dias,
    p_observacao: observacao,
    p_cid: cid || null,
    p_arquivo_url: path,
    p_arquivo_nome: originalName,
  });

  if (saveError || !saved?.sucesso) {
    await admin.storage.from("documentos-privados").remove([path]);
    return response({
      sucesso: false,
      erro: saved?.erro || "Não foi possível registrar o atestado",
    }, 400);
  }

  return response({
    sucesso: true,
    atestado_id: saved.atestado_id,
    status: saved.status,
    status_label: saved.status_label,
    arquivo_nome: originalName,
  });
});
