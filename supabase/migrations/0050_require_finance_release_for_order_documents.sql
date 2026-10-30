BEGIN;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_financeiro(
  p_token text, p_ordem_id uuid, p_status_pagamento text, p_nota_fiscal_numero text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_status_pagamento text;
  v_nota text;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;

  v_status_pagamento := lower(btrim(COALESCE(p_status_pagamento, '')));
  v_nota := NULLIF(btrim(COALESCE(p_nota_fiscal_numero, '')), '');
  IF v_status_pagamento NOT IN ('pendente', 'pago') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Status de pagamento inválido.');
  END IF;
  IF v_nota IS NOT NULL AND length(v_nota) > 40 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O número da nota fiscal deve ter até 40 caracteres.');
  END IF;

  SELECT status_pagamento, pago_em, nota_fiscal_numero, nota_fiscal_emitida_em,
    financeiro_liberado_em, valor_total
  INTO v_ordem
  FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;
  IF v_ordem.financeiro_liberado_em IS NULL
    AND (v_status_pagamento IS DISTINCT FROM v_ordem.status_pagamento
      OR v_nota IS DISTINCT FROM v_ordem.nota_fiscal_numero) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O lote precisa ser liberado pela Produção após a entrega completa antes de atualizar o financeiro.');
  END IF;

  v_antes := jsonb_build_object('status_pagamento', v_ordem.status_pagamento, 'pago_em', v_ordem.pago_em,
    'nota_fiscal_numero', v_ordem.nota_fiscal_numero, 'nota_fiscal_emitida_em', v_ordem.nota_fiscal_emitida_em,
    'financeiro_liberado_em', v_ordem.financeiro_liberado_em);
  UPDATE public.ordens_servico
  SET status_pagamento = v_status_pagamento,
      pago_em = CASE WHEN v_status_pagamento = 'pago' THEN COALESCE(pago_em, current_date) ELSE NULL END,
      nota_fiscal_numero = v_nota,
      nota_fiscal_emitida_em = CASE WHEN v_nota IS NULL THEN NULL
        WHEN v_nota IS DISTINCT FROM nota_fiscal_numero OR nota_fiscal_emitida_em IS NULL THEN current_date
        ELSE nota_fiscal_emitida_em END,
      updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status_pagamento', status_pagamento, 'pago_em', pago_em,
    'nota_fiscal_numero', nota_fiscal_numero, 'nota_fiscal_emitida_em', nota_fiscal_emitida_em,
    'financeiro_liberado_em', financeiro_liberado_em) INTO v_depois;

  IF v_antes IS DISTINCT FROM v_depois THEN
    INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
    VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'financeiro_nf_atualizado', v_antes, v_depois);
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'status_pagamento', v_status_pagamento,
    'nota_fiscal_numero', v_nota, 'pago_em', CASE WHEN v_status_pagamento = 'pago' THEN current_date ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_ordem_documento_preflight(
  p_token text, p_ordem_id uuid, p_tipo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  IF COALESCE(p_tipo, '') NOT IN ('nota_fiscal', 'comprovante_pagamento') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de documento inválido.');
  END IF;

  SELECT id, financeiro_liberado_em INTO v_ordem
  FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada.');
  END IF;
  IF v_ordem.financeiro_liberado_em IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Libere o lote para o financeiro após a entrega completa antes de anexar documentos.');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'empresa_id', v.empresa_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_registrar_ordem_documento(
  p_token text, p_ordem_id uuid, p_tipo text, p_storage_path text,
  p_nome_arquivo text, p_mime_type text, p_tamanho_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_id uuid;
  v_prefix text;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  IF COALESCE(p_tipo, '') NOT IN ('nota_fiscal', 'comprovante_pagamento')
    OR COALESCE(p_mime_type, '') NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    OR p_tamanho_bytes IS NULL OR p_tamanho_bytes NOT BETWEEN 1 AND 10485760
    OR length(btrim(COALESCE(p_nome_arquivo, ''))) NOT BETWEEN 1 AND 255 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Metadados ou arquivo inválidos.');
  END IF;

  v_prefix := 'ordens-servico/' || v.empresa_id::text || '/' || p_ordem_id::text || '/' || p_tipo || '/';
  IF p_storage_path IS NULL OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Caminho de armazenamento inválido.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ordens_servico o
    WHERE o.id = p_ordem_id AND o.empresa_id = v.empresa_id
      AND o.financeiro_liberado_em IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada ou ainda não liberada para financeiro.');
  END IF;

  INSERT INTO public.ordens_servico_documentos
    (empresa_id, ordem_id, tipo, storage_path, nome_arquivo, mime_type, tamanho_bytes, uploaded_by)
  VALUES (v.empresa_id, p_ordem_id, p_tipo, p_storage_path, btrim(p_nome_arquivo), p_mime_type, p_tamanho_bytes, v.usuario_id)
  RETURNING id INTO v_id;
  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'documento_adicionado',
    jsonb_build_object('documento_id', v_id, 'tipo', p_tipo, 'nome_arquivo', btrim(p_nome_arquivo), 'mime_type', p_mime_type, 'tamanho_bytes', p_tamanho_bytes));
  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem_financeiro(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_ordem_documento_preflight(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_registrar_ordem_documento(text, uuid, text, text, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem_financeiro(text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_ordem_documento_preflight(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_ordem_documento(text, uuid, text, text, text, text, bigint) TO anon, authenticated;

COMMIT;
