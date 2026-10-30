BEGIN;

ALTER TABLE public.documentos_empresa
  ADD COLUMN IF NOT EXISTS grupo_id uuid,
  ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS tamanho_bytes bigint;

UPDATE public.documentos_empresa SET grupo_id = id WHERE grupo_id IS NULL;
ALTER TABLE public.documentos_empresa ALTER COLUMN grupo_id SET NOT NULL;
ALTER TABLE public.documentos_empresa ALTER COLUMN grupo_id SET DEFAULT gen_random_uuid();

DROP INDEX IF EXISTS public.uq_documentos_empresa_titulo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_documentos_empresa_grupo_versao
  ON public.documentos_empresa(grupo_id, versao);
CREATE INDEX IF NOT EXISTS idx_documentos_empresa_tenant_catalogo
  ON public.documentos_empresa(empresa_id, disponivel_funcionarios, titulo, versao DESC);

ALTER TABLE public.documentos_empresa DROP CONSTRAINT IF EXISTS documentos_empresa_categoria_check;
ALTER TABLE public.documentos_empresa
  ADD CONSTRAINT documentos_empresa_categoria_check
  CHECK (categoria IN ('regimento','cct','ponto','campanha','comunicado','politica','outro'));

CREATE TABLE IF NOT EXISTS public.documentos_empresa_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  grupo_id uuid NOT NULL,
  documento_id uuid REFERENCES public.documentos_empresa(id),
  usuario_id uuid REFERENCES public.usuarios(id),
  evento text NOT NULL CHECK (evento IN ('documento_criado','versao_adicionada','metadados_atualizados')),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documentos_empresa_auditoria_grupo
  ON public.documentos_empresa_auditoria(empresa_id, grupo_id, created_at DESC);

REVOKE ALL ON TABLE public.documentos_empresa FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.documentos_empresa_auditoria FROM PUBLIC, anon, authenticated;

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
  v_admin := COALESCE(v.perfil, '') IN ('admin','administrador');
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.titulo, x.versao DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT d.id, d.grupo_id, d.versao, d.titulo, d.categoria,
      d.arquivo_nome, d.arquivo_url, d.conteudo_texto,
      d.disponivel_funcionarios, d.mime_type, d.tamanho_bytes,
      (d.storage_path IS NOT NULL) AS arquivo_privado,
      d.created_at, d.updated_at
    FROM public.documentos_empresa d
    WHERE d.empresa_id = v.empresa_id
      AND (d.disponivel_funcionarios OR v_admin)
  ) x;
  RETURN jsonb_build_object('sucesso', true, 'documentos', v_result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível consultar os documentos internos.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_documento_interno_preflight(p_token text, p_grupo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_version integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF COALESCE(v.perfil, '') NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Somente administradores podem adicionar documentos.');
  END IF;
  IF p_grupo_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Identificador do documento inválido.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.documentos_empresa d WHERE d.grupo_id = p_grupo_id AND d.empresa_id <> v.empresa_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento não encontrado nesta empresa.');
  END IF;
  SELECT COALESCE(MAX(d.versao), 0) + 1 INTO v_version
  FROM public.documentos_empresa d
  WHERE d.empresa_id = v.empresa_id AND d.grupo_id = p_grupo_id;
  RETURN jsonb_build_object('sucesso', true, 'empresa_id', v.empresa_id, 'grupo_id', p_grupo_id, 'versao', v_version);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível validar o envio do documento.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_registrar_documento_interno(
  p_token text, p_grupo_id uuid, p_versao integer, p_titulo text, p_categoria text,
  p_descricao text, p_disponivel_funcionarios boolean, p_storage_path text,
  p_arquivo_nome text, p_mime_type text, p_tamanho_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_next integer;
  v_id uuid;
  v_title text := NULLIF(BTRIM(COALESCE(p_titulo, '')), '');
  v_name text := NULLIF(BTRIM(COALESCE(p_arquivo_nome, '')), '');
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF COALESCE(v.perfil, '') NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Somente administradores podem adicionar documentos.');
  END IF;
  IF v_title IS NULL OR LENGTH(v_title) > 180 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um título de até 180 caracteres.');
  END IF;
  IF p_categoria NOT IN ('regimento','cct','ponto','campanha','comunicado','politica','outro') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione uma categoria válida.');
  END IF;
  IF LENGTH(COALESCE(p_descricao, '')) > 5000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A descrição deve ter até 5.000 caracteres.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.documentos_empresa d WHERE d.grupo_id = p_grupo_id AND d.empresa_id <> v.empresa_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento-base não encontrado nesta empresa.');
  END IF;
  IF p_versao IS NULL OR p_versao < 1 OR p_grupo_id IS NULL OR p_storage_path IS NULL
     OR p_storage_path NOT LIKE v.empresa_id::text || '/documentos-internos/' || p_grupo_id::text || '/%'
     OR POSITION('..' IN p_storage_path) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Caminho ou versão do documento inválidos.');
  END IF;
  IF v_name IS NULL OR LENGTH(v_name) > 255 OR p_tamanho_bytes IS NULL OR p_tamanho_bytes < 1 OR p_tamanho_bytes > 20971520 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo inválido ou maior que 20 MB.');
  END IF;
  IF p_mime_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Formato de arquivo não permitido.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v.empresa_id::text || p_grupo_id::text, 0));
  SELECT COALESCE(MAX(d.versao), 0) + 1 INTO v_next
  FROM public.documentos_empresa d
  WHERE d.empresa_id = v.empresa_id AND d.grupo_id = p_grupo_id;
  IF p_versao <> v_next THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A versão do documento mudou. Atualize a lista e tente novamente.');
  END IF;
  INSERT INTO public.documentos_empresa (
    empresa_id, grupo_id, versao, titulo, categoria, arquivo_nome, arquivo_url,
    conteudo_texto, disponivel_funcionarios, storage_path, mime_type, tamanho_bytes,
    created_by, created_at, updated_at
  ) VALUES (
    v.empresa_id, p_grupo_id, v_next, v_title, p_categoria, v_name, NULL,
    NULLIF(BTRIM(COALESCE(p_descricao, '')), ''), COALESCE(p_disponivel_funcionarios, false),
    p_storage_path, p_mime_type, p_tamanho_bytes, v.usuario_id, now(), now()
  ) RETURNING id INTO v_id;

  INSERT INTO public.documentos_empresa_auditoria(empresa_id, grupo_id, documento_id, usuario_id, evento, detalhes)
  VALUES (v.empresa_id, p_grupo_id, v_id, v.usuario_id,
    CASE WHEN v_next = 1 THEN 'documento_criado' ELSE 'versao_adicionada' END,
    jsonb_build_object('versao', v_next, 'titulo', v_title, 'categoria', p_categoria,
      'arquivo_nome', v_name, 'tamanho_bytes', p_tamanho_bytes,
      'disponivel_funcionarios', COALESCE(p_disponivel_funcionarios, false)));
  RETURN jsonb_build_object('sucesso', true, 'id', v_id, 'grupo_id', p_grupo_id, 'versao', v_next);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível registrar o documento.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_documento_interno(
  p_token text, p_grupo_id uuid, p_titulo text, p_categoria text,
  p_descricao text, p_disponivel_funcionarios boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_count integer;
  v_title text := NULLIF(BTRIM(COALESCE(p_titulo, '')), '');
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF COALESCE(v.perfil, '') NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Somente administradores podem alterar documentos.');
  END IF;
  IF p_grupo_id IS NULL OR v_title IS NULL OR LENGTH(v_title) > 180
     OR p_categoria NOT IN ('regimento','cct','ponto','campanha','comunicado','politica','outro')
     OR LENGTH(COALESCE(p_descricao, '')) > 5000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Confira título, categoria e descrição do documento.');
  END IF;
  UPDATE public.documentos_empresa
  SET titulo = v_title, categoria = p_categoria,
      conteudo_texto = NULLIF(BTRIM(COALESCE(p_descricao, '')), ''),
      disponivel_funcionarios = COALESCE(p_disponivel_funcionarios, false), updated_at = now()
  WHERE empresa_id = v.empresa_id AND grupo_id = p_grupo_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento não encontrado nesta empresa.');
  END IF;
  INSERT INTO public.documentos_empresa_auditoria(empresa_id, grupo_id, usuario_id, evento, detalhes)
  VALUES (v.empresa_id, p_grupo_id, v.usuario_id, 'metadados_atualizados',
    jsonb_build_object('titulo', v_title, 'categoria', p_categoria,
      'disponivel_funcionarios', COALESCE(p_disponivel_funcionarios, false)));
  RETURN jsonb_build_object('sucesso', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível atualizar o documento.');
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
  v_admin := COALESCE(v.perfil, '') IN ('admin','administrador');
  SELECT id, storage_path, arquivo_url, arquivo_nome, mime_type, tamanho_bytes, disponivel_funcionarios
  INTO d FROM public.documentos_empresa
  WHERE id = p_documento_id AND empresa_id = v.empresa_id
    AND (disponivel_funcionarios OR v_admin)
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

REVOKE ALL ON FUNCTION public.app_listar_documentos(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_documento_interno_preflight(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_registrar_documento_interno(text, uuid, integer, text, text, text, boolean, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_documento_interno(text, uuid, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_documento_interno_caminho(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_documentos(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_documento_interno(text, uuid, text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_documento_interno_preflight(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_documento_interno(text, uuid, integer, text, text, text, boolean, text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_documento_interno_caminho(text, uuid) TO service_role;

COMMIT;
