import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-app-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const BUCKET = "rh-avisos-privados";
const MAX = 10 * 1024 * 1024;
const out = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const tokenOf = (req: Request) => req.headers.get("x-app-token") || req.headers.get("authorization")?.replace(/^bearer\s+/i, "") || null;
const safe = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-120) || "arquivo.pdf";
const sha256 = async (file: File) => { const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join(""); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ sucesso: false, erro: "Método não permitido" }, 405);
  const token = tokenOf(req); if (!token) return out({ sucesso: false, erro: "Sessão não informada" }, 401);
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return out({ sucesso: false, erro: "Storage não configurado" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const form = await req.formData();
  const action = String(form.get("action") || "batch-upload");
  if (action !== "batch-upload") return out({ sucesso: false, erro: "Ação inválida" }, 400);
  const tipo = String(form.get("tipo") || "aviso");
  if (!["aviso", "recibo", "comprovante_pagamento"].includes(tipo)) return out({ sucesso: false, erro: "Tipo de documento inválido" }, 400);
  const files = form.getAll("arquivos").filter((value): value is File => value instanceof File);
  if (!files.length || files.length > 100) return out({ sucesso: false, erro: "Selecione entre 1 e 100 PDFs" }, 400);
  if (files.some((file) => file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf") || file.size < 1 || file.size > MAX)) return out({ sucesso: false, erro: "Todos os arquivos devem ser PDFs de até 10 MB" }, 400);
  const scopeResult = await admin.rpc("app_tenant_usuario", { p_token: token });
  const scope = Array.isArray(scopeResult.data) ? scopeResult.data[0] : scopeResult.data;
  if (scopeResult.error || !scope?.usuario_id || !scope.empresa_id || !["admin", "administrador"].includes(scope.perfil)) return out({ sucesso: false, erro: "Acesso restrito ao administrador" }, 403);
  const batchResult = await admin.from("rh_ferias_importacoes").insert({ empresa_id: scope.empresa_id, tipo, origem: "app_upload", pasta_nome: null, total_linhas: files.length, linhas_vinculadas: 0, linhas_pendentes: files.length, status: "pendente", observacoes: "Lote enviado pelo aplicativo; vinculação manual obrigatória.", created_by: scope.usuario_id }).select("id").single();
  if (batchResult.error || !batchResult.data) return out({ sucesso: false, erro: "Não foi possível criar o lote" }, 500);
  const batchId = batchResult.data.id as string;
  const createdPaths: string[] = [];
  try {
    for (const file of files) {
      const digest = await sha256(file);
      const duplicate = await admin.from("rh_ferias_import_linhas").select("id,arquivo_nome").eq("empresa_id", scope.empresa_id).eq("sha256", digest).limit(1);
      if (duplicate.data?.length) {
        await admin.from("rh_ferias_import_linhas").insert({ importacao_id: batchId, empresa_id: scope.empresa_id, nome_extraido: file.name.replace(/\.pdf$/i, ""), arquivo_nome: file.name.slice(0, 255), mime_type: "application/pdf", tamanho_bytes: file.size, sha256: digest, status: "divergente", divergencia: "Arquivo duplicado: o mesmo PDF já foi importado." });
        continue;
      }
      const path = `${scope.empresa_id}/ferias-importacoes/${batchId}/${crypto.randomUUID()}-${safe(file.name)}`;
      const uploaded = await admin.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
      if (uploaded.error) throw new Error("Não foi possível armazenar " + file.name);
      createdPaths.push(path);
      const line = await admin.from("rh_ferias_import_linhas").insert({ importacao_id: batchId, empresa_id: scope.empresa_id, nome_extraido: file.name.replace(/\.pdf$/i, ""), arquivo_nome: file.name.slice(0, 255), storage_path: path, mime_type: "application/pdf", tamanho_bytes: file.size, sha256: digest, status: "pendente", dados_extraidos: {} });
      if (line.error) throw new Error("Não foi possível registrar " + file.name);
    }
    const counts = await admin.from("rh_ferias_import_linhas").select("status").eq("importacao_id", batchId);
    const lines = counts.data || [];
    const pending = lines.filter((row) => ["pendente", "divergente"].includes(row.status)).length;
    await admin.from("rh_ferias_importacoes").update({ total_linhas: lines.length, linhas_pendentes: pending, status: pending === 0 ? "rejeitada" : "pendente", updated_at: new Date().toISOString() }).eq("id", batchId);
    await admin.from("auditoria_acoes").insert({ usuario_id: scope.usuario_id, acao: "criou_importacao_ferias_app", entidade: "rh_ferias_importacoes", entidade_id: batchId, detalhes: { total: lines.length, tipo, origem: "app_upload" } });
    return out({ sucesso: true, importacao_id: batchId, total_linhas: lines.length, linhas_pendentes: pending });
  } catch (error) {
    if (createdPaths.length) await admin.storage.from(BUCKET).remove(createdPaths);
    await admin.from("rh_ferias_importacoes").update({ status: "rejeitada", observacoes: error instanceof Error ? error.message : "Falha no upload", updated_at: new Date().toISOString() }).eq("id", batchId);
    return out({ sucesso: false, erro: error instanceof Error ? error.message : "Falha no upload do lote" }, 502);
  }
});
