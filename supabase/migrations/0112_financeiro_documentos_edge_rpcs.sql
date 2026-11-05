BEGIN;
CREATE OR REPLACE FUNCTION public.app_financeiro_documento_preflight(
  p_token text,
  p_alvo_tipo text,
  p_alvo_id uuid,
  p_tipo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_lancamento record;
  v_parcela record;
  v_alvo_tipo text := lower(btrim(coalesce(p_alvo_tipo, '')));
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
  v_prefix text;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF p_alvo_id IS NULL OR v_tipo NOT IN ('documento_pagamento', 'comprovante') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Alvo ou tipo de documento inválido.');
  END IF;

  IF v_alvo_tipo = 'lancamento' THEN
    SELECT l.id, l.empresa_id, l.status
      INTO v_lancamento
    FROM public.financeiro_lancamentos l
    WHERE l.id = p_alvo_id
      AND l.empresa_id = v.empresa_id
    FOR UPDATE;
    IF NOT FOUND OR v_lancamento.status NOT IN ('pendente', 'vencido') THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O lançamento não permite anexos neste estado.');
    END IF;
    v_prefix := 'financeiro/' || v.empresa_id::text || '/lancamentos/' || p_alvo_id::text || '/';
  ELSIF v_alvo_tipo = 'acordo_parcela' THEN
    SELECT p.id, a.empresa_id, p.status
      INTO v_parcela
    FROM public.acordo_parcelas p
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
    WHERE p.id = p_alvo_id
      AND a.empresa_id = v.empresa_id
    FOR UPDATE OF p;
    IF NOT FOUND OR v_parcela.status <> 'pendente' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A parcela do acordo não permite anexos neste estado.');
    END IF;
    v_prefix := 'acordos/' || v.empresa_id::text || '/' || p_alvo_id::text || '/';
  ELSE
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de alvo inválido.');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'empresa_id', v.empresa_id,
    'alvo_tipo', v_alvo_tipo,
    'alvo_id', p_alvo_id,
    'tipo', v_tipo,
    'storage_prefix', v_prefix
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível validar o anexo.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_financeiro_documento_registrar(
  p_token text,
  p_alvo_tipo text,
  p_alvo_id uuid,
  p_tipo text,
  p_storage_path text,
  p_arquivo_nome text,
  p_mime_type text,
  p_tamanho_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_lancamento record;
  v_parcela record;
  v_id uuid;
  v_alvo_tipo text := lower(btrim(coalesce(p_alvo_tipo, '')));
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
  v_nome text := nullif(btrim(coalesce(p_arquivo_nome, '')), '');
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_prefix text;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  IF p_alvo_id IS NULL OR v_alvo_tipo NOT IN ('lancamento', 'acordo_parcela')
     OR v_tipo NOT IN ('documento_pagamento', 'comprovante') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Alvo ou tipo de documento inválido.');
  END IF;

  IF v_nome IS NULL OR length(v_nome) > 255
     OR p_tamanho_bytes IS NULL OR p_tamanho_bytes < 1 OR p_tamanho_bytes > 10485760
     OR v_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo inválido ou maior que 10 MB.');
  END IF;

  IF v_alvo_tipo = 'lancamento' THEN
    SELECT l.id, l.empresa_id, l.status
      INTO v_lancamento
    FROM public.financeiro_lancamentos l
    WHERE l.id = p_alvo_id
      AND l.empresa_id = v.empresa_id
    FOR UPDATE;
    IF NOT FOUND OR v_lancamento.status NOT IN ('pendente', 'vencido') THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O lançamento não permite este anexo.');
    END IF;
    v_prefix := 'financeiro/' || v.empresa_id::text || '/lancamentos/' || p_alvo_id::text || '/';
  ELSE
    SELECT p.id, a.empresa_id, p.status
      INTO v_parcela
    FROM public.acordo_parcelas p
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
    WHERE p.id = p_alvo_id
      AND a.empresa_id = v.empresa_id
    FOR UPDATE OF p;
    IF NOT FOUND OR v_parcela.status <> 'pendente' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A parcela do acordo não permite este anexo.');
    END IF;
    v_prefix := 'acordos/' || v.empresa_id::text || '/' || p_alvo_id::text || '/';
  END IF;

  IF p_storage_path IS NULL
     OR btrim(p_storage_path) <> p_storage_path
     OR length(p_storage_path) > 1024
     OR length(p_storage_path) <= length(v_prefix)
     OR position('..' IN p_storage_path) > 0
     OR left(p_storage_path, 1) = '/'
     OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Caminho de armazenamento inválido.');
  END IF;

  IF v_alvo_tipo = 'lancamento' THEN
    INSERT INTO public.financeiro_lancamentos_documentos(
      empresa_id, lancamento_id, tipo, storage_path, arquivo_nome,
      mime_type, tamanho_bytes, uploaded_by
    ) VALUES (
      v.empresa_id, p_alvo_id, v_tipo, p_storage_path, v_nome,
      v_mime, p_tamanho_bytes, v.usuario_id
    ) RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.acordo_parcelas_documentos(
      empresa_id, acordo_parcela_id, tipo, storage_path, arquivo_nome,
      mime_type, tamanho_bytes, uploaded_by
    ) VALUES (
      v.empresa_id, p_alvo_id, v_tipo, p_storage_path, v_nome,
      v_mime, p_tamanho_bytes, v.usuario_id
    ) RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v.usuario_id,
    'anexou_documento_financeiro',
    CASE WHEN v_alvo_tipo = 'lancamento' THEN 'financeiro_lancamentos' ELSE 'acordo_parcelas' END,
    p_alvo_id,
    jsonb_build_object(
      'empresa_id', v.empresa_id,
      'documento_id', v_id,
      'tipo', v_tipo,
      'arquivo_nome', v_nome,
      'mime_type', v_mime,
      'tamanho_bytes', p_tamanho_bytes
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', v_id,
    'alvo_tipo', v_alvo_tipo,
    'alvo_id', p_alvo_id,
    'tipo', v_tipo,
    'arquivo_nome', v_nome,
    'mime_type', v_mime,
    'tamanho_bytes', p_tamanho_bytes
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Este arquivo já foi registrado.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível registrar o documento.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_financeiro_documento_caminho(
  p_token text,
  p_documento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  d record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR p_documento_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão, empresa ou documento inválido.');
  END IF;

  SELECT d.id, d.storage_path, d.arquivo_nome, d.mime_type, d.tamanho_bytes,
    d.tipo, 'lancamento'::text AS alvo_tipo, d.lancamento_id AS alvo_id
    INTO d
  FROM public.financeiro_lancamentos_documentos d
  JOIN public.financeiro_lancamentos l
    ON l.id = d.lancamento_id AND l.empresa_id = d.empresa_id
  WHERE d.id = p_documento_id AND d.empresa_id = v.empresa_id
    AND l.status IN ('pendente', 'vencido', 'pago')
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT d.id, d.storage_path, d.arquivo_nome, d.mime_type, d.tamanho_bytes,
      d.tipo, 'acordo_parcela'::text AS alvo_tipo, d.acordo_parcela_id AS alvo_id
      INTO d
    FROM public.acordo_parcelas_documentos d
    JOIN public.acordo_parcelas p ON p.id = d.acordo_parcela_id
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id AND a.empresa_id = d.empresa_id
    WHERE d.id = p_documento_id AND d.empresa_id = v.empresa_id
      AND p.status IN ('pendente', 'atrasada', 'quitada')
    LIMIT 1;
  END IF;

  IF NOT FOUND OR d.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento não encontrado ou sem permissão.');
  END IF;

  -- O caminho é devolvido somente para a Edge Function, que cria uma URL assinada.
  -- A quitação pode já ter ocorrido; neste ponto a validação necessária é tenant,
  -- vínculo do alvo e existência do documento, permitindo baixar o comprovante depois.
  RETURN jsonb_build_object(
    'sucesso', true,
    'storage_path', d.storage_path,
    'arquivo_nome', d.arquivo_nome,
    'mime_type', d.mime_type,
    'tamanho_bytes', d.tamanho_bytes,
    'tipo', d.tipo,
    'alvo_tipo', d.alvo_tipo,
    'alvo_id', d.alvo_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível validar o acesso ao documento.');
END;
$function$;

-- Baixa de lançamento comum. Acordos não são copiados para o ledger e, portanto,
-- esta função nunca altera qualquer tabela de Acordos.

REVOKE ALL ON FUNCTION public.app_financeiro_documento_preflight(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_financeiro_documento_registrar(text, text, uuid, text, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_financeiro_documento_caminho(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_financeiro_documento_preflight(text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_financeiro_documento_registrar(text, text, uuid, text, text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_financeiro_documento_caminho(text, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
