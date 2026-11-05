BEGIN;
CREATE OR REPLACE FUNCTION public.app_financeiro_lancamento_quitar(
  p_token text,
  p_id uuid,
  p_pago_em date,
  p_forma_pagamento text,
  p_motivo text,
  p_documento jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_lancamento record;
  v_doc record;
  v_doc_id uuid;
  v_doc_path text;
  v_doc_name text;
  v_doc_mime text;
  v_doc_size bigint;
  v_metodo text := lower(btrim(coalesce(p_forma_pagamento, '')));
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  SELECT l.* INTO v_lancamento
  FROM public.financeiro_lancamentos l
  WHERE l.id = p_id AND l.empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_lancamento.status NOT IN ('pendente', 'vencido') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O lançamento não está disponível para quitação.');
  END IF;
  IF p_pago_em IS NULL OR v_metodo NOT IN ('pix', 'transferencia', 'boleto', 'outro') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a data e a forma de pagamento.');
  END IF;
  IF length(coalesce(v_motivo, '')) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A justificativa deve ter até 500 caracteres.');
  END IF;

  IF p_documento IS NOT NULL THEN
    IF jsonb_typeof(p_documento) <> 'object' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante inválido.');
    END IF;

    IF nullif(btrim(coalesce(p_documento->>'id', '')), '') IS NOT NULL THEN
      BEGIN
        v_doc_id := (p_documento->>'id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante inválido.');
      END;
      SELECT d.* INTO v_doc
      FROM public.financeiro_lancamentos_documentos d
      WHERE d.id = v_doc_id
        AND d.empresa_id = v.empresa_id
        AND d.lancamento_id = p_id
        AND d.tipo = 'comprovante'
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante não encontrado neste lançamento.');
      END IF;
      v_doc_path := v_doc.storage_path;
      v_doc_name := v_doc.arquivo_nome;
      v_doc_mime := v_doc.mime_type;
      v_doc_size := v_doc.tamanho_bytes;
    ELSE
      v_doc_path := p_documento->>'storage_path';
      v_doc_name := nullif(btrim(coalesce(p_documento->>'arquivo_nome', '')), '');
      v_doc_mime := lower(btrim(coalesce(p_documento->>'mime_type', '')));
      v_doc_size := nullif(p_documento->>'tamanho_bytes', '')::bigint;
    END IF;

    IF v_doc_path IS NULL OR v_doc_name IS NULL OR length(v_doc_name) > 255
       OR v_doc_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
       OR v_doc_size IS NULL OR v_doc_size < 1 OR v_doc_size > 10485760
       OR btrim(v_doc_path) <> v_doc_path
       OR length(v_doc_path) <= length('financeiro/' || v.empresa_id::text || '/lancamentos/' || p_id::text || '/')
       OR position('..' IN v_doc_path) > 0
       OR left(v_doc_path, length('financeiro/' || v.empresa_id::text || '/lancamentos/' || p_id::text || '/'))
          <> 'financeiro/' || v.empresa_id::text || '/lancamentos/' || p_id::text || '/' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante inválido.');
    END IF;
  END IF;

  UPDATE public.financeiro_lancamentos
  SET status = 'pago', pago_em = p_pago_em, forma_pagamento = v_metodo,
    pago_por = v.usuario_id, updated_at = now()
  WHERE id = p_id AND empresa_id = v.empresa_id;

  IF p_documento IS NOT NULL AND v_doc_id IS NULL THEN
    INSERT INTO public.financeiro_lancamentos_documentos(
      empresa_id, lancamento_id, tipo, storage_path, arquivo_nome,
      mime_type, tamanho_bytes, uploaded_by
    ) VALUES (
      v.empresa_id, p_id, 'comprovante', v_doc_path, v_doc_name,
      v_doc_mime, v_doc_size, v.usuario_id
    );
  END IF;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v.usuario_id, 'quitou_lancamento_financeiro', 'financeiro_lancamentos', p_id,
    jsonb_build_object(
      'empresa_id', v.empresa_id,
      'pago_em', p_pago_em,
      'forma_pagamento', v_metodo,
      'motivo', v_motivo,
      'comprovante_anexado', p_documento IS NOT NULL
    )
  );

  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'pago_em', p_pago_em, 'forma_pagamento', v_metodo);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível registrar a quitação do lançamento.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_quitar_acordo_parcela(
  p_token text,
  p_parcela_id uuid,
  p_pago_em date,
  p_forma_pagamento text,
  p_motivo text,
  p_documento jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_parcela record;
  v_doc record;
  v_doc_id uuid;
  v_doc_path text;
  v_doc_name text;
  v_doc_mime text;
  v_doc_size bigint;
  v_metodo text := lower(btrim(coalesce(p_forma_pagamento, '')));
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  SELECT p.*, a.processo, a.favorecido, a.empresa_id AS acordo_empresa_id
    INTO v_parcela
  FROM public.acordo_parcelas p
  JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
  WHERE p.id = p_parcela_id AND a.empresa_id = v.empresa_id
  FOR UPDATE OF p;
  IF NOT FOUND OR v_parcela.status <> 'pendente' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A parcela do acordo não está disponível para quitação.');
  END IF;
  IF p_pago_em IS NULL OR v_metodo NOT IN ('pix', 'transferencia', 'boleto', 'outro') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a data e a forma de pagamento.');
  END IF;
  IF length(coalesce(v_motivo, '')) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A justificativa deve ter até 500 caracteres.');
  END IF;
  v_before := jsonb_build_object(
    'status', v_parcela.status, 'pago_em', v_parcela.pago_em,
    'forma_pagamento', v_parcela.forma_pagamento
  );

  IF p_documento IS NOT NULL THEN
    IF jsonb_typeof(p_documento) <> 'object' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante inválido.');
    END IF;

    IF nullif(btrim(coalesce(p_documento->>'id', '')), '') IS NOT NULL THEN
      BEGIN
        v_doc_id := (p_documento->>'id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante inválido.');
      END;
      SELECT d.* INTO v_doc
      FROM public.acordo_parcelas_documentos d
      WHERE d.id = v_doc_id
        AND d.empresa_id = v.empresa_id
        AND d.acordo_parcela_id = p_parcela_id
        AND d.tipo = 'comprovante'
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante não encontrado nesta parcela.');
      END IF;
      v_doc_path := v_doc.storage_path;
      v_doc_name := v_doc.arquivo_nome;
      v_doc_mime := v_doc.mime_type;
      v_doc_size := v_doc.tamanho_bytes;
    ELSE
      v_doc_path := p_documento->>'storage_path';
      v_doc_name := nullif(btrim(coalesce(p_documento->>'arquivo_nome', '')), '');
      v_doc_mime := lower(btrim(coalesce(p_documento->>'mime_type', '')));
      v_doc_size := nullif(p_documento->>'tamanho_bytes', '')::bigint;
    END IF;

    IF v_doc_path IS NULL OR v_doc_name IS NULL OR length(v_doc_name) > 255
       OR v_doc_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
       OR v_doc_size IS NULL OR v_doc_size < 1 OR v_doc_size > 10485760
       OR btrim(v_doc_path) <> v_doc_path
       OR length(v_doc_path) <= length('acordos/' || v.empresa_id::text || '/' || p_parcela_id::text || '/')
       OR position('..' IN v_doc_path) > 0
       OR left(v_doc_path, length('acordos/' || v.empresa_id::text || '/' || p_parcela_id::text || '/'))
          <> 'acordos/' || v.empresa_id::text || '/' || p_parcela_id::text || '/' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Comprovante inválido.');
    END IF;
  END IF;

  UPDATE public.acordo_parcelas
  SET status = 'quitada', pago_em = p_pago_em,
    forma_pagamento = v_metodo, pago_por = v.usuario_id
  WHERE id = p_parcela_id
    AND EXISTS (
      SELECT 1
      FROM public.acordos_trabalhistas a
      WHERE a.id = acordo_parcelas.acordo_id
        AND a.empresa_id = v.empresa_id
    );

  IF p_documento IS NOT NULL AND v_doc_id IS NULL THEN
    INSERT INTO public.acordo_parcelas_documentos(
      empresa_id, acordo_parcela_id, tipo, storage_path, arquivo_nome,
      mime_type, tamanho_bytes, uploaded_by
    ) VALUES (
      v.empresa_id, p_parcela_id, 'comprovante', v_doc_path, v_doc_name,
      v_doc_mime, v_doc_size, v.usuario_id
    );
  END IF;

  v_after := jsonb_build_object(
    'status', 'quitada', 'pago_em', p_pago_em,
    'forma_pagamento', v_metodo,
    'comprovante_anexado', p_documento IS NOT NULL
  );

  INSERT INTO public.acordos_trabalhistas_auditoria(
    empresa_id, acordo_id, parcela_id, usuario_id, evento, motivo, antes, depois
  ) VALUES (
    v.empresa_id, v_parcela.acordo_id, p_parcela_id, v.usuario_id,
    'status_alterado', v_motivo, v_before, v_after
  );

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v.usuario_id, 'quitou_parcela_acordo', 'acordo_parcelas', p_parcela_id,
    jsonb_build_object(
      'empresa_id', v.empresa_id,
      'acordo_id', v_parcela.acordo_id,
      'pago_em', p_pago_em,
      'forma_pagamento', v_metodo,
      'motivo', v_motivo,
      'comprovante_anexado', p_documento IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true, 'id', p_parcela_id,
    'pago_em', p_pago_em, 'forma_pagamento', v_metodo
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível registrar a quitação da parcela do acordo.');
END;
$function$;

-- Relatórios de Acordos: posição usa somente o estado atual por vencimento;
-- quitações usa o campo corrente pago_em. Nenhum histórico retroativo é inferido.
CREATE OR REPLACE FUNCTION public.app_admin_relatorio_acordos(
  p_token text,
  p_tipo text,
  p_inicio date,
  p_fim date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
  v_inicio date := coalesce(p_inicio, date_trunc('month', current_date)::date);
  v_fim date := coalesce(p_fim, current_date);
  v_linhas jsonb;
  v_totais jsonb;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF v_tipo NOT IN ('acordos_posicao', 'acordos_quitacoes') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de relatório de Acordos inválido.');
  END IF;
  IF v_inicio > v_fim THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Período inválido.');
  END IF;

  IF v_tipo = 'acordos_posicao' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento NULLS LAST, x.processo, x.numero), '[]'::jsonb)
      INTO v_linhas
    FROM (
      SELECT
        p.id AS parcela_id,
        a.id AS acordo_id,
        a.processo,
        a.favorecido,
        p.tipo,
        p.numero,
        p.valor,
        p.vencimento,
        CASE
          WHEN p.status = 'quitada' THEN 'quitada'
          WHEN p.vencimento IS NOT NULL AND p.vencimento < current_date THEN 'atrasada'
          ELSE 'pendente'
        END AS status,
        p.pago_em,
        p.forma_pagamento
      FROM public.acordo_parcelas p
      JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
      WHERE a.empresa_id = v.empresa_id
        AND p.vencimento BETWEEN v_inicio AND v_fim
      ORDER BY p.vencimento NULLS LAST, a.processo, p.numero
      LIMIT 5000
    ) x;

    SELECT jsonb_build_object(
      'quantidade', count(*)::integer,
      'valor_total', coalesce(sum(p.valor), 0),
      'pendentes_quantidade', count(*) FILTER (WHERE p.status <> 'quitada' AND (p.vencimento IS NULL OR p.vencimento >= current_date))::integer,
      'pendentes_valor', coalesce(sum(p.valor) FILTER (WHERE p.status <> 'quitada' AND (p.vencimento IS NULL OR p.vencimento >= current_date)), 0),
      'atrasadas_quantidade', count(*) FILTER (WHERE p.status <> 'quitada' AND p.vencimento < current_date)::integer,
      'atrasadas_valor', coalesce(sum(p.valor) FILTER (WHERE p.status <> 'quitada' AND p.vencimento < current_date), 0),
      'quitadas_quantidade', count(*) FILTER (WHERE p.status = 'quitada')::integer,
      'quitadas_valor', coalesce(sum(p.valor) FILTER (WHERE p.status = 'quitada'), 0)
    ) INTO v_totais
    FROM public.acordo_parcelas p
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
    WHERE a.empresa_id = v.empresa_id
      AND p.vencimento BETWEEN v_inicio AND v_fim;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.pago_em, x.processo, x.numero), '[]'::jsonb)
      INTO v_linhas
    FROM (
      SELECT
        p.id AS parcela_id,
        a.id AS acordo_id,
        a.processo,
        a.favorecido,
        p.tipo,
        p.numero,
        p.valor,
        p.vencimento,
        'quitada'::text AS status,
        p.pago_em,
        p.forma_pagamento
      FROM public.acordo_parcelas p
      JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
      WHERE a.empresa_id = v.empresa_id
        AND p.status = 'quitada'
        AND p.pago_em BETWEEN v_inicio AND v_fim
      ORDER BY p.pago_em, a.processo, p.numero
      LIMIT 5000
    ) x;

    SELECT jsonb_build_object(
      'quantidade', count(*)::integer,
      'valor_total', coalesce(sum(p.valor), 0),
      'quitadas_quantidade', count(*)::integer,
      'quitadas_valor', coalesce(sum(p.valor), 0)
    ) INTO v_totais
    FROM public.acordo_parcelas p
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
    WHERE a.empresa_id = v.empresa_id
      AND p.status = 'quitada'
      AND p.pago_em BETWEEN v_inicio AND v_fim;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tipo', v_tipo,
    'inicio', v_inicio,
    'fim', v_fim,
    'linhas', coalesce(v_linhas, '[]'::jsonb),
    'totais', coalesce(v_totais, '{}'::jsonb)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível gerar o relatório de Acordos.');
END;
$function$;

-- Leituras existentes continuam disponíveis ao cliente, mas somente para admins.
REVOKE ALL ON FUNCTION public.app_admin_financeiro(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_listar_acordos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_acordos(text) TO anon, authenticated, service_role;

-- Upload, caminho, baixas e relatório são superfícies internas chamadas pela Edge
-- Function. Gestores e clientes não recebem EXECUTE, mesmo que possuam token.
REVOKE ALL ON FUNCTION public.app_financeiro_admin_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_financeiro_admin_allowed(text) TO service_role;
REVOKE ALL ON FUNCTION public.app_financeiro_documento_preflight(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_financeiro_documento_registrar(text, text, uuid, text, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_financeiro_documento_caminho(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_financeiro_lancamento_quitar(text, uuid, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_quitar_acordo_parcela(text, uuid, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_acordos(text, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_financeiro_documento_preflight(text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_financeiro_documento_registrar(text, text, uuid, text, text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_financeiro_documento_caminho(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_financeiro_lancamento_quitar(text, uuid, date, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_quitar_acordo_parcela(text, uuid, date, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_acordos(text, text, date, date) TO service_role;


NOTIFY pgrst, 'reload schema';
COMMIT;
