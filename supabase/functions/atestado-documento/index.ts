import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ sucesso: false, erro: "Método não permitido" }, 405);

  const token = getToken(request);
  if (!token) return response({ sucesso: false, erro: "Sessão não informada" }, 401);

  let body: { atestado_id?: string };
  try {
    body = await request.json();
  } catch {
    return response({ sucesso: false, erro: "Requisição inválida" }, 400);
  }
  const atestadoId = String(body.atestado_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(atestadoId)) {
    return response({ sucesso: false, erro: "Atestado não encontrado" }, 404);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ sucesso: false, erro: "Ambiente de armazenamento não configurado" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: access, error: accessError } = await admin.rpc("app_atestado_documento_path", {
    p_token: token,
    p_atestado_id: atestadoId,
  });
  if (accessError || !access?.sucesso || !access.caminho) {
    return response({ sucesso: false, erro: access?.erro || "Acesso negado ao documento" }, 403);
  }

  const { data: signed, error: signedError } = await admin.storage
    .from("documentos-privados")
    .createSignedUrl(access.caminho, 120, { download: false });
  if (signedError || !signed?.signedUrl) {
    return response({ sucesso: false, erro: "Não foi possível abrir o documento" }, 502);
  }

  return response({ sucesso: true, url: signed.signedUrl, expires_in: 120 });
});
