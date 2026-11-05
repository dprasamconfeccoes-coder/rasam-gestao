BEGIN;
-- Dashboard e relatórios: wrappers públicos mantêm os contratos antigos,
-- mas removem dados Financeiro/Dívidas/Acordos para gestores.
ALTER FUNCTION public.app_dashboard(text) RENAME TO app_dashboard_i112;
ALTER FUNCTION public.app_dashboard_v2(text) RENAME TO app_dashboard_v2_i112;
ALTER FUNCTION public.app_admin_dashboard_periodo(text, date, date)
  RENAME TO app_admin_dashboard_periodo_i112;
ALTER FUNCTION public.app_admin_financeiro_relatorio(text, text, date, date)
  RENAME TO app_admin_financeiro_relatorio_i112;
ALTER FUNCTION public.app_admin_relatorio_operacional(text, text, date, date)
  RENAME TO app_admin_relatorio_operacional_i112;
ALTER FUNCTION public.app_admin_relatorio_registrar(text, text, date, date, text)
  RENAME TO app_admin_relatorio_registrar_i112;
ALTER FUNCTION public.app_admin_relatorio_historico(text)
  RENAME TO app_admin_relatorio_historico_i112;
REVOKE ALL ON FUNCTION public.app_dashboard_i112(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_dashboard_v2_i112(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_dashboard_periodo_i112(text, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_relatorio_i112(text, text, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_operacional_i112(text, text, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_registrar_i112(
  text, text, date, date, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_historico_i112(text)
  FROM PUBLIC, anon, authenticated;
-- Redaction única e privada, compartilhada pelo dashboard legado, v2 e período.
-- Gestores continuam recebendo Pessoas/Ponto e demais dados operacionais que já
-- eram permitidos, mas não recebem chaves financeiras, de Dívidas ou Acordos.
CREATE OR REPLACE FUNCTION public.app_dashboard_redact_non_admin_i112(p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb := COALESCE(p_result, '{}'::jsonb);
  v_indicadores jsonb;
  v_comparativos jsonb;
  v_inteligencia jsonb;
  v_pendencias jsonb;
  v_relatorios jsonb;
  v_alertas jsonb;
  v_agenda jsonb;
  v_item jsonb;
BEGIN
  IF jsonb_typeof(v_result) <> 'object' THEN
    RETURN v_result;
  END IF;

  -- Não preserve chaves de domínio no nível superior, caso uma implementação
  -- anterior ou futura as adicione ao contrato do painel.
  v_result := v_result - ARRAY[
    'financeiro', 'dividas', 'divida', 'acordos', 'acordo'
  ]::text[];

  IF v_result ? 'indicadores'
     AND jsonb_typeof(v_result->'indicadores') = 'object' THEN
    v_indicadores := v_result->'indicadores' - ARRAY[
      'financeiro', 'dividas', 'divida', 'acordos', 'acordo',
      'contas_pendentes', 'saldo_dividas', 'dividas_saldo',
      'receitas_realizadas', 'despesas_realizadas', 'resultado_realizado',
      'receitas_a_receber', 'despesas_a_pagar', 'despesas_vencidas',
      'receitas_pendentes', 'receitas_recebidas',
      'receitas_ordens_previstas', 'ordens_aguardando_pagamento',
      'recebiveis_com_vencimento', 'pagamentos_com_vencimento',
      'compromissos_recorrentes', 'recorrencias_ativas', 'saldo_projetado'
    ]::text[];
    v_result := jsonb_set(v_result, '{indicadores}', v_indicadores, true);
  END IF;

  IF v_result ? 'comparativos'
     AND jsonb_typeof(v_result->'comparativos') = 'object' THEN
    v_comparativos := v_result->'comparativos' - ARRAY[
      'financeiro', 'dividas', 'divida', 'acordos', 'acordo',
      'receitas_realizadas', 'despesas_realizadas', 'receitas_pendentes',
      'despesas_pendentes', 'receitas_a_receber', 'despesas_a_pagar',
      'contas_pendentes', 'saldo_dividas'
    ]::text[];
    v_result := jsonb_set(v_result, '{comparativos}', v_comparativos, true);
  END IF;

  IF v_result ? 'alertas' AND jsonb_typeof(v_result->'alertas') = 'array' THEN
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
      INTO v_alertas
    FROM jsonb_array_elements(v_result->'alertas') AS alert_items(item)
    WHERE lower(COALESCE(item->>'destino', item->>'modulo', '')) NOT IN (
      'financeiro', 'dividas', 'divida', 'acordos', 'acordo'
    )
      AND lower(COALESCE(item->>'tipo', '')) NOT IN (
        'financeiro', 'dividas', 'divida', 'acordos', 'acordo'
      );
    v_result := jsonb_set(v_result, '{alertas}', COALESCE(v_alertas, '[]'::jsonb), true);
  END IF;

  IF v_result ? 'inteligencia'
     AND jsonb_typeof(v_result->'inteligencia') = 'object' THEN
    v_inteligencia := v_result->'inteligencia'
      - ARRAY['financeiro', 'dividas', 'divida', 'acordos', 'acordo']::text[];

    IF v_inteligencia ? 'agenda'
       AND jsonb_typeof(v_inteligencia->'agenda') = 'array' THEN
      SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
        INTO v_agenda
      FROM jsonb_array_elements(v_inteligencia->'agenda') AS agenda_items(item)
      WHERE lower(COALESCE(item->>'destino', item->>'modulo', '')) NOT IN (
        'financeiro', 'dividas', 'divida', 'acordos', 'acordo'
      )
        AND lower(COALESCE(item->>'tipo', '')) NOT IN (
          'financeiro', 'dividas', 'divida', 'acordos', 'acordo'
        );
      v_inteligencia := jsonb_set(
        v_inteligencia, '{agenda}', COALESCE(v_agenda, '[]'::jsonb), true
      );
    END IF;

    IF v_inteligencia ? 'pendencias_area'
       AND jsonb_typeof(v_inteligencia->'pendencias_area') = 'object' THEN
      v_pendencias := v_inteligencia->'pendencias_area'
        - ARRAY['financeiro', 'dividas', 'divida', 'acordos', 'acordo']::text[];
      v_inteligencia := jsonb_set(
        v_inteligencia, '{pendencias_area}', v_pendencias, true
      );
    END IF;

    v_result := jsonb_set(v_result, '{inteligencia}', v_inteligencia, true);
  END IF;

  -- Algumas versões do painel carregam relatórios como objeto e outras como
  -- lista. Em ambos os casos, remova apenas as três famílias administrativas.
  IF v_result ? 'relatorios'
     AND jsonb_typeof(v_result->'relatorios') = 'object' THEN
    v_relatorios := v_result->'relatorios'
      - ARRAY['financeiro', 'dividas', 'divida', 'acordos', 'acordo']::text[];
    v_result := jsonb_set(v_result, '{relatorios}', v_relatorios, true);
  ELSIF v_result ? 'relatorios'
        AND jsonb_typeof(v_result->'relatorios') = 'array' THEN
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
      INTO v_relatorios
    FROM jsonb_array_elements(v_result->'relatorios') AS report_items(item)
    WHERE lower(COALESCE(item->>'tipo', item->>'relatorio', '')) NOT IN (
      'financeiro', 'dividas', 'divida', 'acordos', 'acordo'
    );
    v_result := jsonb_set(
      v_result, '{relatorios}', COALESCE(v_relatorios, '[]'::jsonb), true
    );
  END IF;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.app_dashboard_redact_non_admin_i112(jsonb)
  FROM PUBLIC, anon, authenticated;


-- Relatório financeiro é integralmente admin-only. Tipos de Acordos são
-- encaminhados à RPC específica da 0111, nunca ao relatório genérico.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_relatorio(
  p_token text,
  p_tipo text,
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_tipo text := lower(btrim(COALESCE(p_tipo, 'fluxo')));
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Relatórios Financeiros estão disponíveis somente para administradores.'
    );
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF v_tipo IN ('acordos_posicao', 'acordos_quitacoes') THEN
    RETURN public.app_admin_relatorio_acordos(p_token, v_tipo, p_inicio, p_fim);
  END IF;
  RETURN public.app_admin_financeiro_relatorio_i112(
    p_token, p_tipo, p_inicio, p_fim
  );
END;
$function$;

-- Relatório operacional: gestor só pode consultar Pessoas. Produção, Dívidas e
-- Acordos são admin-only; Acordos sempre passam pela RPC criada em 0111.
CREATE OR REPLACE FUNCTION public.app_admin_relatorio_operacional(
  p_token text,
  p_tipo text,
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_admin boolean := public.app_financeiro_admin_allowed(p_token);
  v_tipo text := lower(btrim(COALESCE(p_tipo, '')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  IF v_admin THEN
    IF v_tipo IN ('acordos_posicao', 'acordos_quitacoes') THEN
      RETURN public.app_admin_relatorio_acordos(p_token, v_tipo, p_inicio, p_fim);
    END IF;
    RETURN public.app_admin_relatorio_operacional_i112(
      p_token, p_tipo, p_inicio, p_fim
    );
  END IF;

  IF lower(COALESCE(v.perfil, '')) <> 'gestor' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF v_tipo NOT IN (
    'quadro_funcionarios', 'ponto_jornada', 'absenteismo', 'ferias_afastamentos'
  ) THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Gestores só podem consultar relatórios de Pessoas e Ponto.'
    );
  END IF;

  RETURN public.app_admin_relatorio_operacional_i112(
    p_token, p_tipo, p_inicio, p_fim
  );
END;
$function$;

-- Histórico/auditoria de relatórios: o gestor não pode descobrir que um
-- relatório Financeiro, Dívidas ou Acordos foi registrado.
CREATE OR REPLACE FUNCTION public.app_admin_relatorio_registrar(
  p_token text,
  p_tipo text,
  p_inicio date,
  p_fim date,
  p_formato text DEFAULT 'gerencial'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_admin boolean := public.app_financeiro_admin_allowed(p_token);
  v_tipo text := lower(btrim(COALESCE(p_tipo, '')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF NOT v_admin AND lower(COALESCE(v.perfil, '')) <> 'gestor' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF NOT v_admin AND v_tipo NOT IN (
    'quadro_funcionarios', 'ponto_jornada', 'absenteismo', 'ferias_afastamentos'
  ) THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Gestores só podem registrar relatórios de Pessoas e Ponto.'
    );
  END IF;
  RETURN public.app_admin_relatorio_registrar_i112(
    p_token, p_tipo, p_inicio, p_fim, p_formato
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_relatorio_historico(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_admin boolean := public.app_financeiro_admin_allowed(p_token);
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF NOT v_admin AND lower(COALESCE(v.perfil, '')) <> 'gestor' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  IF v_admin THEN
    RETURN public.app_admin_relatorio_historico_i112(p_token);
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'linhas', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT r.id, r.tipo, r.inicio, r.fim, r.formato, r.created_at,
          COALESCE(u.nome_exibicao, 'Administrador') AS usuario
        FROM public.relatorios_gerados r
        LEFT JOIN public.usuarios u ON u.id = r.usuario_id
        WHERE r.empresa_id = v.empresa_id
          AND lower(btrim(r.tipo)) IN (
            'quadro_funcionarios', 'ponto_jornada', 'absenteismo',
            'ferias_afastamentos'
          )
        ORDER BY r.created_at DESC
        LIMIT 100
      ) x
    )
  );
END;
$function$;

-- Dashboards: admins mantêm o contrato completo; gestores preservam Pessoas,
-- Ponto e operação permitida pelo 0109, sem Financeiro/Dívidas/Acordos.
CREATE OR REPLACE FUNCTION public.app_dashboard_v2(p_token text)
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
  IF v.usuario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;
  v_result := public.app_dashboard_v2_i112(p_token);
  IF public.app_financeiro_admin_allowed(p_token) THEN
    RETURN v_result;
  END IF;
  RETURN public.app_dashboard_redact_non_admin_i112(v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_dashboard(p_token text)
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
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;
  v_result := public.app_dashboard_i112(p_token);
  IF public.app_financeiro_admin_allowed(p_token) THEN
    RETURN v_result;
  END IF;
  RETURN public.app_dashboard_redact_non_admin_i112(v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_dashboard_periodo(
  p_token text,
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
  v_admin boolean := public.app_financeiro_admin_allowed(p_token);
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR (NOT v_admin AND lower(COALESCE(v.perfil, '')) <> 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  v_result := public.app_admin_dashboard_periodo_i112(p_token, p_inicio, p_fim);
  IF v_admin THEN
    RETURN v_result;
  END IF;
  RETURN public.app_dashboard_redact_non_admin_i112(v_result);
END;
$function$;


REVOKE ALL ON FUNCTION public.app_dashboard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_dashboard_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_relatorio(text, text, date, date)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_operacional(text, text, date, date)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_registrar(text, text, date, date, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_relatorio_historico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_dashboard(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_dashboard_v2(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_dashboard_periodo(text, date, date)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_relatorio(text, text, date, date)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_operacional(text, text, date, date)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_registrar(text, text, date, date, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_historico(text)
  TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
