BEGIN;

CREATE OR REPLACE FUNCTION public.app_listar_documentos(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
  v_admin boolean;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida.');
  END IF;
  v_admin := COALESCE(v.perfil, '') IN ('admin','administrador');
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.titulo, x.versao DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT d.id, d.grupo_id, d.versao, d.titulo, d.categoria,
      d.arquivo_nome, d.arquivo_url, d.conteudo_texto,
      d.disponivel_funcionarios, d.mime_type, d.tamanho_bytes,
      (d.storage_path IS NOT NULL) AS arquivo_privado,
      d.arquivado_em AS excluido_em,
      d.created_at, d.updated_at
    FROM public.documentos_empresa d
    WHERE d.empresa_id = v.empresa_id
      AND (
        v_admin OR (
          d.arquivado_em IS NULL
          AND d.disponivel_funcionarios IS TRUE
          AND (
            SELECT (atual.arquivado_em IS NULL AND atual.disponivel_funcionarios IS TRUE)
            FROM public.documentos_empresa atual
            WHERE atual.empresa_id = d.empresa_id AND atual.grupo_id = d.grupo_id
            ORDER BY atual.versao DESC LIMIT 1
          ) IS TRUE
        )
      )
  ) x;
  RETURN jsonb_build_object('sucesso', true, 'documentos', v_result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível consultar os documentos internos.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_documento_interno_caminho(p_token text, p_documento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  d record;
  v_admin boolean;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida.');
  END IF;
  v_admin := COALESCE(v.perfil, '') IN ('admin','administrador');
  SELECT doc.id, doc.storage_path, doc.arquivo_url, doc.arquivo_nome, doc.mime_type, doc.tamanho_bytes, doc.disponivel_funcionarios
  INTO d FROM public.documentos_empresa doc
  WHERE doc.id = p_documento_id AND doc.empresa_id = v.empresa_id AND doc.arquivado_em IS NULL
    AND (
      v_admin OR (
        doc.disponivel_funcionarios IS TRUE
        AND (
          SELECT (atual.arquivado_em IS NULL AND atual.disponivel_funcionarios IS TRUE)
          FROM public.documentos_empresa atual
          WHERE atual.empresa_id = doc.empresa_id AND atual.grupo_id = doc.grupo_id
          ORDER BY atual.versao DESC LIMIT 1
        ) IS TRUE
      )
    )
  LIMIT 1;
  IF d.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento não encontrado ou sem permissão.');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'caminho', d.storage_path,
    'arquivo_url', d.arquivo_url, 'nome', d.arquivo_nome,
    'mime_type', d.mime_type, 'tamanho_bytes', d.tamanho_bytes);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível validar o acesso ao documento.');
END;
$function$;

REVOKE ALL ON FUNCTION public.app_documento_interno_preflight(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_registrar_documento_interno(text, uuid, integer, text, text, text, boolean, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_documento_interno(text, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_listar_documentos(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_documento_interno_caminho(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_documento_interno_preflight(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_documento_interno(text, uuid, integer, text, text, text, boolean, text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_documento_interno(text, uuid, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_listar_documentos(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_documento_interno_caminho(text, uuid) TO service_role;

COMMIT;
