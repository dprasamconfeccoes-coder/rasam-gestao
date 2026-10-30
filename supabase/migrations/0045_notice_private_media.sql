-- Anexos privados em avisos: imagem/PDF, controle por empresa, autorização de upload/visualização e trilha.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rh-avisos-privados', 'rh-avisos-privados', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[];

CREATE TABLE IF NOT EXISTS public.rh_aviso_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aviso_id uuid NOT NULL REFERENCES public.rh_avisos(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  nome_arquivo text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  tamanho_bytes integer NOT NULL CHECK (tamanho_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL
);
ALTER TABLE public.rh_aviso_anexos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rh_aviso_anexos FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS rh_aviso_anexos_aviso_empresa_active_idx
  ON public.rh_aviso_anexos (empresa_id, aviso_id, created_at DESC)
  WHERE deleted_at IS NULL;

DO $constraint$
BEGIN
  ALTER TABLE public.rh_avisos_auditoria
    DROP CONSTRAINT IF EXISTS rh_avisos_auditoria_evento_check;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rh_avisos_auditoria'::regclass
      AND conname = 'rh_avisos_auditoria_evento_check'
  ) THEN
    ALTER TABLE public.rh_avisos_auditoria
      ADD CONSTRAINT rh_avisos_auditoria_evento_check
      CHECK (evento IN ('criado','editado','publicado','pausado','arquivado','anexo_adicionado','anexo_removido'));
  END IF;
END;
$constraint$;

CREATE OR REPLACE FUNCTION public.app_listar_avisos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_funcionario_id uuid;
  v_empresa_id uuid;
  v_can_read boolean;
  v_result jsonb;
  v_count integer := 0;
BEGIN
  v_can_read := public.app_tem_permissao(p_token, 'notices.read')
                OR public.app_tem_permissao(p_token, 'notices.self.read')
                OR public.app_tem_permissao(p_token, 'notices.manage');
  IF NOT v_can_read THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para consultar avisos');
  END IF;

  SELECT funcionario_id, empresa_id INTO v_funcionario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'titulo', q.titulo, 'conteudo', q.conteudo, 'categoria', q.categoria,
    'prioridade', q.prioridade, 'publicado_em', q.publicado_em, 'created_at', q.created_at,
    'lido_em', q.lido_em, 'is_lido', q.lido_em IS NOT NULL
  ) ORDER BY (q.lido_em IS NOT NULL),
    CASE q.prioridade WHEN 'urgente' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END,
    q.publicado_em DESC NULLS LAST, q.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT a.id, a.titulo, a.conteudo, a.categoria, a.prioridade, a.publicado_em,
           a.created_at, l.lido_em
    FROM public.rh_avisos a
    LEFT JOIN public.rh_avisos_leituras l
      ON l.aviso_id = a.id AND l.funcionario_id = v_funcionario_id
      AND l.empresa_id = v_empresa_id AND l.lido_em >= a.updated_at
    WHERE a.empresa_id = v_empresa_id AND a.status = 'publicado' AND a.publicado = true
    ORDER BY a.publicado_em DESC NULLS LAST, a.created_at DESC LIMIT 500
  ) q;

  IF v_funcionario_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_count
    FROM public.rh_avisos a
    WHERE a.empresa_id = v_empresa_id AND a.status = 'publicado' AND a.publicado = true
      AND NOT EXISTS (
        SELECT 1 FROM public.rh_avisos_leituras l
        WHERE l.aviso_id = a.id AND l.funcionario_id = v_funcionario_id
          AND l.empresa_id = v_empresa_id AND l.lido_em >= a.updated_at
      );
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'avisos', v_result, 'nao_lidos', COALESCE(v_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_contar_avisos_nao_lidos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_funcionario_id uuid; v_empresa_id uuid; v_count integer := 0;
BEGIN
  IF NOT (public.app_tem_permissao(p_token, 'notices.read') OR public.app_tem_permissao(p_token, 'notices.self.read')) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para consultar avisos');
  END IF;
  SELECT funcionario_id, empresa_id INTO v_funcionario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_funcionario_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_count FROM public.rh_avisos a
    WHERE a.empresa_id = v_empresa_id AND a.status = 'publicado' AND a.publicado = true
      AND NOT EXISTS (
        SELECT 1 FROM public.rh_avisos_leituras l
        WHERE l.aviso_id = a.id AND l.funcionario_id = v_funcionario_id
          AND l.empresa_id = v_empresa_id AND l.lido_em >= a.updated_at
      );
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'nao_lidos', COALESCE(v_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_listar_anexos_avisos(
  p_token text,
  p_aviso_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_empresa_id uuid;
  v_can_manage boolean;
  v_can_read boolean;
  v_items jsonb;
BEGIN
  v_can_manage := public.app_tem_permissao(p_token, 'notices.manage');
  v_can_read := public.app_tem_permissao(p_token, 'notices.read') OR public.app_tem_permissao(p_token, 'notices.self.read');
  IF NOT (v_can_manage OR v_can_read) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado aos anexos de avisos');
  END IF;
  SELECT empresa_id INTO v_empresa_id FROM public.app_tenant_usuario(p_token) LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'aviso_id', a.aviso_id, 'nome_arquivo', a.nome_arquivo,
    'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes, 'created_at', a.created_at
  ) ORDER BY a.created_at, a.id), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT an.id, an.aviso_id, an.nome_arquivo, an.mime_type, an.tamanho_bytes, an.created_at
    FROM public.rh_aviso_anexos an
    JOIN public.rh_avisos n ON n.id = an.aviso_id AND n.empresa_id = an.empresa_id
    WHERE an.empresa_id = v_empresa_id
      AND an.deleted_at IS NULL
      AND (p_aviso_ids IS NULL OR an.aviso_id = ANY(p_aviso_ids))
      AND (v_can_manage OR (n.status = 'publicado' AND n.publicado = true))
    ORDER BY an.created_at DESC, an.id
    LIMIT 2500
  ) a;
  RETURN jsonb_build_object('sucesso', true, 'anexos', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_aviso_anexo_preflight(p_token text, p_aviso_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_empresa_id uuid;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Permissão de gestão de avisos necessária');
  END IF;
  SELECT empresa_id INTO v_empresa_id FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.rh_avisos n WHERE n.id = p_aviso_id AND n.empresa_id = v_empresa_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Aviso não encontrado nesta empresa');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'empresa_id', v_empresa_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_registrar_aviso_anexo(
  p_token text, p_aviso_id uuid, p_storage_path text, p_nome_arquivo text,
  p_mime_type text, p_tamanho_bytes integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_usuario_id uuid; v_empresa_id uuid; v_id uuid; v_count integer; v_meta jsonb;
  v_prefix text;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Permissão de gestão de avisos necessária');
  END IF;
  SELECT usuario_id, empresa_id INTO v_usuario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.rh_avisos n WHERE n.id = p_aviso_id AND n.empresa_id = v_empresa_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Aviso não encontrado nesta empresa');
  END IF;
  v_prefix := v_empresa_id::text || '/' || p_aviso_id::text || '/';
  IF p_storage_path IS NULL OR left(p_storage_path, length(v_prefix)) <> v_prefix
     OR position('..' in p_storage_path) > 0 OR char_length(p_storage_path) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Caminho de arquivo inválido');
  END IF;
  IF p_mime_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
     OR p_tamanho_bytes IS NULL OR p_tamanho_bytes < 1 OR p_tamanho_bytes > 10485760
     OR char_length(btrim(COALESCE(p_nome_arquivo,''))) < 1 OR char_length(p_nome_arquivo) > 255 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo, tamanho ou nome de arquivo inválido');
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.rh_aviso_anexos an
  WHERE an.aviso_id = p_aviso_id AND an.empresa_id = v_empresa_id AND an.deleted_at IS NULL;
  IF v_count >= 5 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada aviso pode ter até 5 anexos ativos'); END IF;

  INSERT INTO public.rh_aviso_anexos (aviso_id, empresa_id, storage_path, nome_arquivo, mime_type, tamanho_bytes, uploaded_by)
  VALUES (p_aviso_id, v_empresa_id, p_storage_path, btrim(p_nome_arquivo), p_mime_type, p_tamanho_bytes, v_usuario_id)
  RETURNING id INTO v_id;
  SELECT jsonb_build_object('id',id,'nome_arquivo',nome_arquivo,'mime_type',mime_type,'tamanho_bytes',tamanho_bytes)
  INTO v_meta FROM public.rh_aviso_anexos WHERE id = v_id;
  INSERT INTO public.rh_avisos_auditoria (aviso_id, empresa_id, usuario_id, evento, antes, depois)
  VALUES (p_aviso_id, v_empresa_id, v_usuario_id, 'anexo_adicionado', NULL, v_meta);
  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_remover_aviso_anexo(p_token text, p_anexo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_usuario_id uuid; v_empresa_id uuid; v_aviso_id uuid; v_before jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Permissão de gestão de avisos necessária');
  END IF;
  SELECT usuario_id, empresa_id INTO v_usuario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  SELECT jsonb_build_object('id',an.id,'nome_arquivo',an.nome_arquivo,'mime_type',an.mime_type,'tamanho_bytes',an.tamanho_bytes), an.aviso_id
  INTO v_before, v_aviso_id
  FROM public.rh_aviso_anexos an
  WHERE an.id = p_anexo_id AND an.empresa_id = v_empresa_id AND an.deleted_at IS NULL
  FOR UPDATE;
  IF v_aviso_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Anexo não encontrado'); END IF;
  UPDATE public.rh_aviso_anexos SET deleted_at = now(), deleted_by = v_usuario_id
  WHERE id = p_anexo_id AND empresa_id = v_empresa_id;
  INSERT INTO public.rh_avisos_auditoria (aviso_id, empresa_id, usuario_id, evento, antes, depois)
  VALUES (v_aviso_id, v_empresa_id, v_usuario_id, 'anexo_removido', v_before,
    jsonb_build_object('id',p_anexo_id,'removido',true,'removido_em',now()));
  RETURN jsonb_build_object('sucesso', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_aviso_anexo_path(p_token text, p_anexo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_empresa_id uuid; v_funcionario_id uuid; v_can_manage boolean; v_can_read boolean; v_result jsonb;
BEGIN
  v_can_manage := public.app_tem_permissao(p_token, 'notices.manage');
  v_can_read := public.app_tem_permissao(p_token, 'notices.read') OR public.app_tem_permissao(p_token, 'notices.self.read');
  IF NOT (v_can_manage OR v_can_read) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado'); END IF;
  SELECT empresa_id, funcionario_id INTO v_empresa_id, v_funcionario_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  SELECT jsonb_build_object(
    'sucesso', true, 'caminho', an.storage_path, 'nome', an.nome_arquivo,
    'mime_type', an.mime_type, 'tamanho_bytes', an.tamanho_bytes
  ) INTO v_result
  FROM public.rh_aviso_anexos an
  JOIN public.rh_avisos n ON n.id = an.aviso_id AND n.empresa_id = an.empresa_id
  WHERE an.id = p_anexo_id AND an.empresa_id = v_empresa_id AND an.deleted_at IS NULL
    AND (v_can_manage OR (v_can_read AND v_funcionario_id IS NOT NULL AND n.status = 'publicado' AND n.publicado = true));
  RETURN COALESCE(v_result, jsonb_build_object('sucesso', false, 'erro', 'Arquivo não encontrado ou sem autorização'));
END;
$function$;

REVOKE ALL ON FUNCTION public.app_listar_anexos_avisos(text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_aviso_anexo_preflight(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_registrar_aviso_anexo(text, uuid, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_remover_aviso_anexo(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_aviso_anexo_path(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_anexos_avisos(text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_aviso_anexo_preflight(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_aviso_anexo(text, uuid, text, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_remover_aviso_anexo(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_aviso_anexo_path(text, uuid) TO anon, authenticated;

COMMIT;
