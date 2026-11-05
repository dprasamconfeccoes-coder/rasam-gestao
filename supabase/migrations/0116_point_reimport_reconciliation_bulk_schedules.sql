BEGIN;

-- Reimportação segura: mantém a assinatura anterior durante a transição, mas nunca
-- atualiza uma batida existente. Conflitos ficam preservados e são contabilizados.
CREATE OR REPLACE FUNCTION public.app_aplicar_importacao_ponto(
  p_token text,
  p_importacao_id uuid,
  p_confirmar_substituicao boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_importacao record;
  v_total_validas integer := 0;
  v_aplicadas integer := 0;
  v_existentes integer := 0;
  v_invalidas integer := 0;
  v_duplicadas integer := 0;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  SELECT * INTO v_importacao
  FROM public.ponto_importacoes
  WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id
  FOR UPDATE;
  IF v_importacao.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Importação não encontrada');
  END IF;
  IF v_importacao.status <> 'pendente' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Esta importação já foi processada');
  END IF;

  SELECT count(*)::integer INTO v_invalidas
  FROM public.ponto_import_linhas l
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND (l.funcionario_id IS NULL OR l.data IS NULL OR NOT COALESCE(l.encontrado, false)
      OR NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NOT NULL);
  IF v_invalidas > 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'A importação contém linhas sem correspondência ou inconsistentes. Corrija o arquivo e faça uma nova análise; nenhuma batida foi gravada.',
      'linhas_invalidas', v_invalidas);
  END IF;

  SELECT count(*)::integer INTO v_duplicadas FROM (
    SELECT l.funcionario_id, l.data
    FROM public.ponto_import_linhas l
    WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    GROUP BY l.funcionario_id, l.data HAVING count(*) > 1
  ) duplicates;
  IF v_duplicadas > 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'Há mais de uma linha para o mesmo funcionário e data. Corrija o arquivo antes de aplicar.',
      'chaves_duplicadas', v_duplicadas);
  END IF;

  SELECT count(*)::integer INTO v_total_validas
  FROM public.ponto_import_linhas l
  JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND l.encontrado AND l.data IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NULL;

  INSERT INTO public.registros_ponto(
    empresa_id, funcionario_id, data, entrada, saida_almoco, volta_almoco, saida, status
  )
  SELECT v_usuario.empresa_id, l.funcionario_id, l.data, l.entrada_1,
    l.saida_1, l.entrada_2, l.saida_2,
    CASE WHEN COALESCE(BTRIM(l.dia_falta), '') <> '' THEN 'falta' ELSE 'normal' END
  FROM public.ponto_import_linhas l
  JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND l.encontrado AND l.funcionario_id IS NOT NULL AND l.data IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NULL
  ON CONFLICT (funcionario_id, data) DO NOTHING;
  GET DIAGNOSTICS v_aplicadas = ROW_COUNT;
  v_existentes := greatest(v_total_validas - v_aplicadas, 0);

  UPDATE public.ponto_importacoes
  SET status = 'aplicada', applied_at = now(), applied_by = v_usuario.usuario_id
  WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (v_usuario.usuario_id, 'aplicou_importacao_ponto_preservando_existentes', 'ponto_importacoes',
    jsonb_build_object('importacao_id', p_importacao_id, 'linhas_inseridas', v_aplicadas,
      'registros_existentes_preservados', v_existentes,
      'linhas_com_inconsistencia', v_importacao.linhas_com_inconsistencia,
      'politica', 'insert_do_nothing'));

  RETURN jsonb_build_object('sucesso', true, 'status', 'aplicada',
    'linhas_aplicadas', v_aplicadas, 'linhas_inseridas', v_aplicadas,
    'registros_existentes_preservados', v_existentes,
    'linhas_com_inconsistencia', v_importacao.linhas_com_inconsistencia);
END;
$function$;
REVOKE ALL ON FUNCTION public.app_aplicar_importacao_ponto(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_aplicar_importacao_ponto(text, uuid, boolean) TO anon, authenticated;

-- Conciliação somente leitura: compara os lotes selecionados por funcionário/data
-- e, separadamente, com o registro operacional atual; não escolhe vencedor nem grava.
CREATE OR REPLACE FUNCTION public.app_conciliar_importacoes_ponto(
  p_token text,
  p_importacao_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_count integer;
  v_lotes jsonb;
  v_itens jsonb;
  v_total integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;
  IF p_importacao_ids IS NULL OR cardinality(p_importacao_ids) < 2
     OR cardinality(p_importacao_ids) > 20 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione de 2 a 20 importações para conciliar.');
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_importacao_ids) x) <> cardinality(p_importacao_ids) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A seleção contém importações repetidas.');
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.ponto_importacoes i
  WHERE i.empresa_id = v_usuario.empresa_id AND i.id = ANY(p_importacao_ids);
  IF v_count <> cardinality(p_importacao_ids) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Uma ou mais importações não foram encontradas nesta empresa.');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'tipo', i.tipo, 'competencia', i.competencia,
    'arquivo_nome', i.arquivo_nome, 'status', i.status,
    'created_at', i.created_at, 'applied_at', i.applied_at
  ) ORDER BY i.created_at), '[]'::jsonb)
  INTO v_lotes
  FROM public.ponto_importacoes i
  WHERE i.empresa_id = v_usuario.empresa_id AND i.id = ANY(p_importacao_ids);

  WITH selected_rows AS (
    SELECT l.importacao_id, i.arquivo_nome, i.status AS status_lote,
      l.funcionario_id, l.data, l.cpf, l.nome_csv,
      l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
      l.total_normais, l.extra_50, l.extra_100, l.dia_falta, l.inconsistencia
    FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i ON i.id = l.importacao_id AND i.empresa_id = l.empresa_id
    WHERE l.empresa_id = v_usuario.empresa_id AND i.id = ANY(p_importacao_ids)
      AND l.funcionario_id IS NOT NULL AND l.data IS NOT NULL
  ), findings AS (
    SELECT s.funcionario_id, f.nome AS funcionario, s.data,
      count(DISTINCT s.importacao_id)::integer AS quantidade_lotes,
      jsonb_agg(jsonb_build_object(
        'importacao_id', s.importacao_id, 'arquivo', s.arquivo_nome,
        'status_lote', s.status_lote, 'entrada_1', s.entrada_1,
        'saida_1', s.saida_1, 'entrada_2', s.entrada_2, 'saida_2', s.saida_2,
        'total_normais', s.total_normais, 'extra_50', s.extra_50,
        'extra_100', s.extra_100, 'dia_falta', s.dia_falta,
        'inconsistencia', s.inconsistencia
      ) ORDER BY s.importacao_id) AS lotes,
      (count(DISTINCT jsonb_build_array(s.entrada_1, s.saida_1, s.entrada_2,
        s.saida_2, s.total_normais, s.extra_50, s.extra_100, s.dia_falta)) > 1) AS divergencia_entre_lotes,
      EXISTS (
        SELECT 1 FROM public.registros_ponto r
        WHERE r.empresa_id = v_usuario.empresa_id AND r.funcionario_id = s.funcionario_id
          AND r.data = s.data AND (
            r.entrada IS DISTINCT FROM s.entrada_1 OR
            r.saida_almoco IS DISTINCT FROM s.saida_1 OR
            r.volta_almoco IS DISTINCT FROM s.entrada_2 OR
            r.saida IS DISTINCT FROM s.saida_2
          )
      ) AS divergencia_registro_atual
    FROM selected_rows s
    JOIN public.funcionarios f ON f.id = s.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    GROUP BY s.funcionario_id, f.nome, s.data
  )
  SELECT count(*)::integer, COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.data DESC, x.funcionario), '[]'::jsonb)
  INTO v_total, v_itens
  FROM (SELECT * FROM findings
        WHERE quantidade_lotes > 1 OR divergencia_registro_atual
        ORDER BY data DESC, funcionario
        LIMIT 500) x;

  RETURN jsonb_build_object('sucesso', true, 'lotes', v_lotes,
    'achados', v_itens, 'achados_retornados', COALESCE(jsonb_array_length(v_itens), 0),
    'limite', 500, 'politica', 'Somente comparação; nenhum lote ou registro operacional foi alterado.');
END;
$function$;
REVOKE ALL ON FUNCTION public.app_conciliar_importacoes_ponto(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_conciliar_importacoes_ponto(text, uuid[]) TO anon, authenticated;

-- Atribuição de jornada em massa. Toda a lista é validada antes de mutação; qualquer
-- falha gera exception e reverte a transação inteira. A RPC individual mantém a regra
-- vigente de corte/encadeamento das datas e sua auditoria por pessoa.
CREATE OR REPLACE FUNCTION public.app_admin_atribuir_jornada_ponto_lote(
  p_token text,
  p_funcionario_ids uuid[],
  p_jornada_id uuid,
  p_vigencia_inicio date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_jornada public.ponto_jornadas%ROWTYPE;
  v_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;
  IF p_vigencia_inicio IS NULL OR p_funcionario_ids IS NULL
     OR cardinality(p_funcionario_ids) < 1 OR cardinality(p_funcionario_ids) > 200 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione de 1 a 200 funcionários e informe a vigência.');
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_funcionario_ids) x) <> cardinality(p_funcionario_ids) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A seleção contém funcionários repetidos.');
  END IF;
  SELECT * INTO v_jornada FROM public.ponto_jornadas j
  WHERE j.id = p_jornada_id AND j.empresa_id = v_usuario.empresa_id AND j.ativo = true
  FOR UPDATE;
  IF v_jornada.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione uma jornada ativa desta empresa.');
  END IF;

  PERFORM f.id FROM public.funcionarios f
  WHERE f.id = ANY(p_funcionario_ids) AND f.empresa_id = v_usuario.empresa_id
    AND f.ativo = true FOR UPDATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(p_funcionario_ids) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Todos os funcionários selecionados devem estar ativos e pertencer a esta empresa.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ponto_jornada_atribuicoes a
    WHERE a.empresa_id = v_usuario.empresa_id AND a.funcionario_id = ANY(p_funcionario_ids)
      AND a.vigencia_inicio <= p_vigencia_inicio
      AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= p_vigencia_inicio)
    GROUP BY a.funcionario_id HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Há históricos com vigências sobrepostas; corrija as sobreposições antes da atribuição em massa.');
  END IF;

  FOREACH v_id IN ARRAY p_funcionario_ids LOOP
    v_result := public.app_admin_atribuir_jornada_ponto(
      p_token, v_id, p_jornada_id, p_vigencia_inicio
    );
    IF COALESCE((v_result->>'sucesso')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Falha na atribuição do funcionário %: %', v_id, COALESCE(v_result->>'erro', 'erro não especificado');
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'funcionario_id', v_id, 'atribuicao_id', v_result->>'atribuicao_id',
      'vigencia_fim', v_result->'vigencia_fim',
      'reutilizada', COALESCE((v_result->>'reutilizada')::boolean, false),
      'corrigida', COALESCE((v_result->>'corrigida')::boolean, false)
    ));
  END LOOP;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_usuario.usuario_id, 'atribuiu_jornada_ponto_em_lote', 'ponto_jornadas', v_jornada.id,
    jsonb_build_object('jornada_id', v_jornada.id, 'versao', v_jornada.versao,
      'vigencia_inicio', p_vigencia_inicio, 'quantidade', cardinality(p_funcionario_ids),
      'funcionarios', to_jsonb(p_funcionario_ids)));
  RETURN jsonb_build_object('sucesso', true, 'jornada_id', v_jornada.id,
    'vigencia_inicio', p_vigencia_inicio, 'quantidade', cardinality(p_funcionario_ids),
    'resultados', v_results);
END;
$function$;
REVOKE ALL ON FUNCTION public.app_admin_atribuir_jornada_ponto_lote(text, uuid[], uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_atribuir_jornada_ponto_lote(text, uuid[], uuid, date) TO anon, authenticated;

COMMIT;
