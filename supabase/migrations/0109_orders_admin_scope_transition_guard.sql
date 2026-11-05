BEGIN;

-- Keep the existing, audited implementations private and expose guarded wrappers.
ALTER FUNCTION public.app_dashboard(text) RENAME TO app_dashboard_i109;
ALTER FUNCTION public.app_dashboard_v2(text) RENAME TO app_dashboard_v2_i109;
ALTER FUNCTION public.app_admin_dashboard_periodo(text, date, date) RENAME TO app_admin_dashboard_periodo_i109;
ALTER FUNCTION public.app_admin_financeiro_relatorio(text, text, date, date) RENAME TO app_admin_financeiro_relatorio_i109;
ALTER FUNCTION public.app_admin_relatorio_operacional(text, text, date, date) RENAME TO app_admin_relatorio_operacional_i109;
ALTER FUNCTION public.app_admin_direitos(text) RENAME TO app_admin_direitos_i109;
ALTER FUNCTION public.app_admin_painel_fabrica(text) RENAME TO app_admin_painel_fabrica_i109;
ALTER FUNCTION public.app_admin_painel_fabrica_financeiro(text) RENAME TO app_admin_painel_fabrica_financeiro_i109;
ALTER FUNCTION public.app_admin_salvar_progresso_fabrica(text, uuid, jsonb) RENAME TO app_admin_salvar_progresso_fabrica_i109;
ALTER FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(text, uuid, jsonb, date) RENAME TO app_admin_salvar_progresso_fabrica_com_vencimento_i109;
ALTER FUNCTION public.app_admin_liberar_ordem_financeiro(text, uuid) RENAME TO app_admin_liberar_ordem_financeiro_i109;

REVOKE ALL ON FUNCTION public.app_dashboard_i109(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_dashboard_v2_i109(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_dashboard_periodo_i109(text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_relatorio_i109(text, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_operacional_i109(text, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_direitos_i109(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica_i109(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica_financeiro_i109(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_salvar_progresso_fabrica_i109(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento_i109(text, uuid, jsonb, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_liberar_ordem_financeiro_i109(text, uuid) FROM PUBLIC, anon, authenticated;

-- Legacy dashboard: reuse tenant-scoped indicators from v2, then suppress operations for non-admin profiles.
CREATE OR REPLACE FUNCTION public.app_dashboard(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
  v_scoped jsonb;
  v_indicadores jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;
  v_result := public.app_dashboard_i109(p_token);
  IF COALESCE(v_result->>'sucesso', 'false') <> 'true' THEN
    RETURN v_result;
  END IF;
  v_scoped := public.app_dashboard_v2_i109(p_token);
  IF COALESCE(v_scoped->>'sucesso', 'false') <> 'true' OR v_scoped->'indicadores' IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível validar o escopo empresarial do painel.');
  END IF;
  v_indicadores := v_scoped->'indicadores';
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    v_indicadores := v_indicadores - ARRAY['ordens_ativas', 'lotes_em_costura']::text[];
    v_indicadores := v_indicadores || jsonb_build_object('ordens_ativas', 0, 'lotes_em_costura', 0);
  END IF;
  v_result := jsonb_set(v_result, '{indicadores}', v_indicadores, true);
  RETURN v_result;
END;
$function$;

-- Current dashboard: strip order and production data from all non-admin profiles.
CREATE OR REPLACE FUNCTION public.app_dashboard_v2(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
  v_indicadores jsonb;
  v_alertas jsonb;
  v_funil jsonb;
  v_comparativos jsonb;
  v_inteligencia jsonb;
  v_agenda jsonb;
  v_pendencias jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;
  v_result := public.app_dashboard_v2_i109(p_token);
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador')
     AND COALESCE(v_result->>'sucesso', 'false') = 'true' THEN
    v_indicadores := COALESCE(v_result->'indicadores', '{}'::jsonb)
      - ARRAY['ordens_ativas', 'lotes_em_costura']::text[];
    v_result := jsonb_set(v_result, '{indicadores}',
      v_indicadores || jsonb_build_object('ordens_ativas', 0, 'lotes_em_costura', 0), true);

    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_alertas
    FROM jsonb_array_elements(COALESCE(v_result->'alertas', '[]'::jsonb)) AS alerts(item)
    WHERE COALESCE(item->>'destino', '') NOT IN ('ordens', 'producao');
    v_result := jsonb_set(v_result, '{alertas}', v_alertas, true);

    v_funil := jsonb_build_object('recebidas', 0, 'em_producao', 0, 'costuradas', 0, 'entregues', 0, 'pagas', 0);
    v_result := jsonb_set(v_result, '{funil}', v_funil, true);
    v_comparativos := COALESCE(v_result->'comparativos', '{}'::jsonb)
      - ARRAY['ordens_entrada_mes', 'ordens_entrada_mes_anterior']::text[];
    v_result := jsonb_set(v_result, '{comparativos}', v_comparativos, true);

    v_inteligencia := COALESCE(v_result->'inteligencia', '{}'::jsonb);
    v_inteligencia := jsonb_set(v_inteligencia, '{operacao}', '{}'::jsonb, true);
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_agenda
    FROM jsonb_array_elements(COALESCE(v_inteligencia->'agenda', '[]'::jsonb)) AS agenda_items(item)
    WHERE COALESCE(item->>'destino', '') NOT IN ('ordens', 'producao');
    v_inteligencia := jsonb_set(v_inteligencia, '{agenda}', v_agenda, true);
    v_inteligencia := jsonb_set(v_inteligencia, '{evolucao}', '[]'::jsonb, true);
    v_pendencias := COALESCE(v_inteligencia->'pendencias_area', '{}'::jsonb)
      - ARRAY['operacao', 'producao']::text[];
    v_inteligencia := jsonb_set(v_inteligencia, '{pendencias_area}', v_pendencias, true);
    v_result := jsonb_set(v_result, '{inteligencia}', v_inteligencia, true);
  END IF;
  RETURN v_result;
END;
$function$;

-- Period summaries retain finance, people and attendance but never return factory aggregates to managers.
CREATE OR REPLACE FUNCTION public.app_admin_dashboard_periodo(p_token text, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  v_result := public.app_admin_dashboard_periodo_i109(p_token, p_inicio, p_fim);
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador')
     AND COALESCE(v_result->>'sucesso', 'false') = 'true' THEN
    v_result := v_result - ARRAY['ordens', 'producao']::text[];
  END IF;
  RETURN v_result;
END;
$function$;

-- Legacy rights endpoint may continue to serve permitted debt data, but not orders or factory lots to managers.
CREATE OR REPLACE FUNCTION public.app_admin_direitos(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_dividas jsonb := '[]'::jsonb;
  v_ordens jsonb := '[]'::jsonb;
  v_producao jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF public.app_dividas_admin_allowed(p_token) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento NULLS LAST), '[]'::jsonb)
    INTO v_dividas
    FROM (
      SELECT id, credor, descricao, valor_original, saldo_devedor, vencimento, status, observacoes
      FROM public.dividas_gestao WHERE empresa_id = v.empresa_id
      ORDER BY vencimento NULLS LAST LIMIT 500
    ) x;
  END IF;
  IF COALESCE(v.perfil, '') IN ('admin', 'administrador') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST), '[]'::jsonb)
    INTO v_ordens
    FROM (
      SELECT id, numero, descricao, status, prioridade, prazo, quantidade, valor_total
      FROM public.ordens_servico WHERE empresa_id = v.empresa_id
      ORDER BY prazo NULLS LAST LIMIT 500
    ) x;
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST), '[]'::jsonb)
    INTO v_producao
    FROM (
      SELECT id, nome, status, prazo, quantidade, responsavel
      FROM public.producao_lotes WHERE empresa_id = v.empresa_id
      ORDER BY prazo NULLS LAST LIMIT 500
    ) x;
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'dividas', v_dividas, 'ordens', v_ordens, 'producao', v_producao);
END;
$function$;

-- Block order/production report families for every non-admin profile at the RPC boundary.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_relatorio(
  p_token text, p_tipo text, p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_tipo text := lower(btrim(COALESCE(p_tipo, '')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF v_tipo = 'producao' AND COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Relatórios de Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_financeiro_relatorio_i109(p_token, p_tipo, p_inicio, p_fim);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_relatorio_operacional(
  p_token text, p_tipo text, p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_tipo text := lower(btrim(COALESCE(p_tipo, '')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF v_tipo = ANY(ARRAY[
    'producao_status', 'producao_clientes', 'produtividade',
    'producao_fluxo_diario', 'controle_tamanhos_lotes'
  ]) AND COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Relatórios de Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_relatorio_operacional_i109(p_token, p_tipo, p_inicio, p_fim);
END;
$function$;

-- Admin-only wrappers for the active factory dashboards and mutation endpoints.
CREATE OR REPLACE FUNCTION public.app_admin_painel_fabrica(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_painel_fabrica_i109(p_token);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_painel_fabrica_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_painel_fabrica_financeiro_i109(p_token);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_salvar_progresso_fabrica(
  p_token text, p_ordem_id uuid, p_tamanhos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_salvar_progresso_fabrica_i109(p_token, p_ordem_id, p_tamanhos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(
  p_token text, p_ordem_id uuid, p_tamanhos jsonb, p_vencimento_financeiro date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_salvar_progresso_fabrica_com_vencimento_i109(
    p_token, p_ordem_id, p_tamanhos, p_vencimento_financeiro
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_liberar_ordem_financeiro(p_token text, p_ordem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN public.app_admin_liberar_ordem_financeiro_i109(p_token, p_ordem_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_iniciar_producao(p_token text, p_ordem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  SELECT id, numero, status INTO v_ordem
  FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;
  IF v_ordem.status <> 'recebida' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Somente ordens aguardando início podem ser iniciadas.');
  END IF;
  v_antes := jsonb_build_object('status', v_ordem.status);
  UPDATE public.ordens_servico
  SET status = 'em_producao', producao_iniciada_em = now(), updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status', status, 'producao_iniciada_em', producao_iniciada_em) INTO v_depois;
  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'status_alterado', v_antes, v_depois);
  INSERT INTO public.ordens_servico_producao_eventos (empresa_id, ordem_id, usuario_id, evento, detalhes)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'producao_iniciada', jsonb_build_object('status', 'em_producao'));
  RETURN jsonb_build_object('sucesso', true, 'status', 'em_producao');
END;
$function$;

-- Compatibility RPC delegates to the canonical validated, audited progress flow.
CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_progresso(
  p_token text, p_ordem_id uuid, p_tamanhos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN public.app_admin_salvar_progresso_fabrica(p_token, p_ordem_id, p_tamanhos);
END;
$function$;

-- Retire the old lot status setter: stage changes must go through the audited order-size progress RPC.
CREATE OR REPLACE FUNCTION public.app_admin_atualizar_lote(p_token text, p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  RETURN jsonb_build_object(
    'sucesso', false,
    'erro', 'Fluxo legado desativado. Atualize a grade da ordem de serviço; as etapas são derivadas do progresso registrado e auditado.'
  );
END;
$function$;

-- Allow only start/cancel compatibility operations; all production-stage transitions derive from audited quantities.
CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_status(
  p_token text, p_ordem_id uuid, p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordens e Produção estão disponíveis somente para administradores.');
  END IF;
  IF v_status NOT IN ('recebida', 'em_producao', 'costurada', 'expedida', 'entregue', 'cancelada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Status operacional inválido.');
  END IF;
  SELECT id, numero, status, quantidade, financeiro_liberado_em, status_pagamento
  INTO v_ordem
  FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;
  IF v_ordem.status = v_status THEN
    RETURN jsonb_build_object('sucesso', true, 'status', v_status, 'alterado', false);
  END IF;
  IF v_ordem.status = 'recebida' AND v_status = 'em_producao' THEN
    RETURN public.app_admin_iniciar_producao(p_token, p_ordem_id);
  END IF;
  IF v_status <> 'cancelada' OR v_ordem.status NOT IN ('recebida', 'em_producao') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'As etapas de produção, costura e entrega são calculadas pelo progresso auditado; não podem ser alteradas diretamente.');
  END IF;
  IF v_ordem.financeiro_liberado_em IS NOT NULL OR v_ordem.status_pagamento = 'pago' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não é possível cancelar uma ordem liberada ou paga.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ordens_servico_tamanhos s
    WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id
      AND (s.quantidade_produzida > 0 OR s.quantidade_costurada > 0 OR s.quantidade_entregue > 0)
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não é possível cancelar uma ordem que já possui produção, costura ou entrega registrada.');
  END IF;
  v_antes := jsonb_build_object('status', v_ordem.status);
  UPDATE public.ordens_servico
  SET status = 'cancelada', updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status', status, 'updated_at', updated_at) INTO v_depois;
  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'status_alterado', v_antes, v_depois);
  RETURN jsonb_build_object('sucesso', true, 'status', 'cancelada', 'alterado', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_dashboard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_dashboard_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_relatorio(text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_operacional(text, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_dashboard(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_dashboard_v2(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_relatorio(text, text, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_operacional(text, text, date, date) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.app_admin_direitos(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica_financeiro(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_salvar_progresso_fabrica(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(text, uuid, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_liberar_ordem_financeiro(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_iniciar_producao(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem_progresso(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem_status(text, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.app_admin_direitos(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_painel_fabrica(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_painel_fabrica_financeiro(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_progresso_fabrica(text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(text, uuid, jsonb, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_liberar_ordem_financeiro(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_iniciar_producao(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem_progresso(text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem_status(text, uuid, text) TO anon, authenticated;

-- The legacy lot setter is a non-mutating compatibility stub; expose only its guarded response.
REVOKE ALL ON FUNCTION public.app_admin_atualizar_lote(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_lote(text, uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
