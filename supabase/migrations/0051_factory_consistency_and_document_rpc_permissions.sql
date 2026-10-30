BEGIN;

DO $migration$
DECLARE
  v_progress text;
  v_release text;
  v_orders_dashboard text;
  v_factory_dashboard text;
  v_phrase text;
BEGIN
  v_progress := pg_get_functiondef('public.app_admin_salvar_progresso_fabrica(text, uuid, jsonb)'::regprocedure);
  IF position('  v_count integer;' in v_progress) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a declaração esperada da RPC de progresso.';
  END IF;
  v_progress := replace(v_progress, '  v_count integer;', '  v_count integer;' || E'\n  v_solicitada integer;');

  IF position($old$SELECT count(*), COALESCE(sum(quantidade_produzida), 0), COALESCE(sum(quantidade_costurada), 0), COALESCE(sum(quantidade_entregue), 0)
  INTO v_count, v_prod_antes, v_cost_antes, v_entrega_antes$old$ in v_progress) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a soma atual da grade na RPC de progresso.';
  END IF;
  v_progress := replace(v_progress,
    $old$SELECT count(*), COALESCE(sum(quantidade_produzida), 0), COALESCE(sum(quantidade_costurada), 0), COALESCE(sum(quantidade_entregue), 0)
  INTO v_count, v_prod_antes, v_cost_antes, v_entrega_antes$old$,
    $new$SELECT count(*), COALESCE(sum(quantidade), 0), COALESCE(sum(quantidade_produzida), 0), COALESCE(sum(quantidade_costurada), 0), COALESCE(sum(quantidade_entregue), 0)
  INTO v_count, v_solicitada, v_prod_antes, v_cost_antes, v_entrega_antes$new$);

  IF position('  IF v_count < 1 OR jsonb_array_length(p_tamanhos) <> v_count THEN' in v_progress) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a validação da grade na RPC de progresso.';
  END IF;
  v_progress := replace(v_progress,
    '  IF v_count < 1 OR jsonb_array_length(p_tamanhos) <> v_count THEN',
    E'  IF v_solicitada <> v_ordem.quantidade THEN\n    RETURN jsonb_build_object(''sucesso'', false, ''erro'', ''A soma da grade de tamanhos deve ser igual à quantidade total do lote antes de registrar produção.'');\n  END IF;\n  IF v_count < 1 OR jsonb_array_length(p_tamanhos) <> v_count THEN');
  EXECUTE v_progress;

  v_release := pg_get_functiondef('public.app_admin_liberar_ordem_financeiro(text, uuid)'::regprocedure);
  IF position($old$SELECT o.id, o.numero, o.status, o.financeiro_liberado_em, o.status_pagamento,
    COALESCE((SELECT sum(s.quantidade_entregue) FROM public.ordens_servico_tamanhos s WHERE s.ordem_id = o.id AND s.empresa_id = v.empresa_id), 0) AS entregues$old$ in v_release) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a leitura da grade na RPC de liberação financeira.';
  END IF;
  v_release := replace(v_release,
    $old$SELECT o.id, o.numero, o.status, o.financeiro_liberado_em, o.status_pagamento,
    COALESCE((SELECT sum(s.quantidade_entregue) FROM public.ordens_servico_tamanhos s WHERE s.ordem_id = o.id AND s.empresa_id = v.empresa_id), 0) AS entregues$old$,
    $new$SELECT o.id, o.numero, o.status, o.financeiro_liberado_em, o.status_pagamento,
    COALESCE((SELECT sum(s.quantidade) FROM public.ordens_servico_tamanhos s WHERE s.ordem_id = o.id AND s.empresa_id = v.empresa_id), 0) AS solicitadas,
    COALESCE((SELECT sum(s.quantidade_entregue) FROM public.ordens_servico_tamanhos s WHERE s.ordem_id = o.id AND s.empresa_id = v.empresa_id), 0) AS entregues$new$);
  IF position($old$IF v_ordem.status <> 'entregue' OR v_ordem.entregues < (SELECT quantidade FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id) THEN$old$ in v_release) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a condição atual de liberação financeira.';
  END IF;
  v_release := replace(v_release,
    $old$IF v_ordem.status <> 'entregue' OR v_ordem.entregues < (SELECT quantidade FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id) THEN$old$,
    $new$IF v_ordem.solicitadas < 1
    OR v_ordem.solicitadas <> (SELECT quantidade FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id)
    OR v_ordem.status <> 'entregue'
    OR v_ordem.entregues < v_ordem.solicitadas THEN$new$);
  EXECUTE v_release;

  v_phrase := 'financeiro_liberado_em IS NOT NULL OR status = ''entregue''';
  v_orders_dashboard := pg_get_functiondef('public.app_admin_painel_ordens(text)'::regprocedure);
  IF position(v_phrase in v_orders_dashboard) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o filtro financeiro do painel de ordens.';
  END IF;
  v_orders_dashboard := replace(v_orders_dashboard, v_phrase, 'financeiro_liberado_em IS NOT NULL');
  EXECUTE v_orders_dashboard;

  v_factory_dashboard := pg_get_functiondef('public.app_admin_painel_fabrica(text)'::regprocedure);
  IF position(v_phrase in v_factory_dashboard) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o filtro financeiro do painel fabril.';
  END IF;
  v_factory_dashboard := replace(v_factory_dashboard, v_phrase, 'financeiro_liberado_em IS NOT NULL');
  EXECUTE v_factory_dashboard;
END;
$migration$;

REVOKE ALL ON FUNCTION public.app_admin_ordem_documento_preflight(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_registrar_ordem_documento(text, uuid, text, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_ordem_documento_path(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_ordem_documento_preflight(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_ordem_documento(text, uuid, text, text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_ordem_documento_path(text, uuid) TO service_role;

COMMIT;
