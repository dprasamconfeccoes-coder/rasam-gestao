import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "documentos-privados";
const MAX = 10 * 1024 * 1024;

const out = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const tokenOf = (req: Request) => {
  const app = req.headers.get("x-app-token");
  const auth = req.headers.get("authorization");
  return app || (!auth ? null : (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth));
};
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function isPdf(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = new TextDecoder().decode(bytes);
  return signature.startsWith("%PDF-") && (!file.type || file.type === "application/pdf" || file.type === "application/octet-stream");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ sucesso: false, erro: "Método não permitido" }, 405);

  const token = tokenOf(req);
  if (!token) return out({ sucesso: false, erro: "Sessão não informada" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return out({ sucesso: false, erro: "Storage não configurado" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const contentType = req.headers.get("content-type") || "";
  let body: Record<string, unknown> = {};
  let form: FormData | null = null;
  let action = "signed-url";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    try { form = await req.formData(); action = String(form.get("action") || "upload"); }
    catch { return out({ sucesso: false, erro: "Formulário inválido" }, 400); }
  } else {
    try { body = await req.json(); action = String(body.action || "signed-url"); }
    catch { return out({ sucesso: false, erro: "Requisição inválida" }, 400); }
  }

  if (action === "upload") {
    const funcionarioId = String(form?.get("funcionario_id") || "");
    const competencia = String(form?.get("competencia") || "");
    const file = form?.get("arquivo");
    const [year, month] = competencia.split("-").map(Number);
    if (!uuid(funcionarioId) || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return out({ sucesso: false, erro: "Funcionário ou competência inválida" }, 400);
    }
    if (!(file instanceof File) || file.size < 1 || file.size > MAX || !(await isPdf(file))) {
      return out({ sucesso: false, erro: "Selecione um PDF válido de até 10 MB" }, 400);
    }

    const preflight = await admin.rpc("app_admin_holerite_preflight", { p_token: token, p_funcionario_id: funcionarioId });
    if (preflight.error || !preflight.data?.sucesso) {
      return out({ sucesso: false, erro: preflight.data?.erro || "Sem permissão para importar" }, 403);
    }
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/[.]{2,}/g, ".").slice(-120) || "holerite.pdf";
    const path = `${preflight.data.empresa_id}/holerites/${funcionarioId}/${year}-${String(month).padStart(2, "0")}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await admin.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
    if (uploaded.error) return out({ sucesso: false, erro: "Não foi possível armazenar o PDF" }, 502);

    const saved = await admin.rpc("app_admin_registrar_holerite_upload", {
      p_token: token,
      p_funcionario_id: funcionarioId,
      p_mes: month,
      p_ano: year,
      p_storage_path: path,
      p_arquivo_nome: file.name.slice(0, 255),
      p_mime_type: "application/pdf",
      p_tamanho_bytes: file.size,
    });
    if (saved.error || !saved.data?.sucesso) {
      await admin.storage.from(BUCKET).remove([path]);
      return out({ sucesso: false, erro: saved.data?.erro || "Não foi possível registrar o holerite" }, 400);
    }
    return out({ sucesso: true, holerite_id: saved.data.id, arquivo_nome: file.name });
  }

  if (action === "signed-url") {
    const holeriteId = String(body.holerite_id || "");
    if (!uuid(holeriteId)) return out({ sucesso: false, erro: "Holerite inválido" }, 400);
    const access = await admin.rpc("app_holerite_documento_path", { p_token: token, p_holerite_id: holeriteId });
    if (access.error || !access.data?.sucesso) return out({ sucesso: false, erro: access.data?.erro || "Acesso negado" }, 403);
    const signed = await admin.storage.from(BUCKET).createSignedUrl(access.data.caminho, 300, { download: Boolean(body.download) });
    if (signed.error || !signed.data?.signedUrl) return out({ sucesso: false, erro: "Não foi possível abrir o PDF" }, 502);
    return out({ sucesso: true, url: signed.data.signedUrl, expires_in: 300, nome_arquivo: access.data.nome });
  }

  return out({ sucesso: false, erro: "Ação inválida" }, 400);
});
