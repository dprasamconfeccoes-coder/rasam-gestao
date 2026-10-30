-- Dashboard mensal paginado de atestados para RH e histórico completo do funcionário.
-- A listagem administrativa continua limitada à empresa e à permissão de revisão médica.

CREATE OR REPLACE FUNCTION public.app_listar_atestados(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_usuario
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  IF v_usuario.funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão não vinculada a um funcionário');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.id, a.tipo, a.data_atendimento, a.dias, a.cid, a.observacao,
      a.arquivo_url, a.arquivo_nome, a.status, a.status_label,
      a.observacao_rh, a.conferido_em, a.created_at,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'evento', ev.evento,
          'status_anterior', ev.status_anterior,
          'status_novo', ev.status_novo,
          'justificativa', ev.justificativa,
          'responsavel', CASE
            WHEN ev.evento = 'registro_anterior' THEN 'Registro anterior à auditoria'
            WHEN ev.actor_role = 'administrador_sistema' THEN 'Administrador do sistema'
            WHEN ev.actor_role = 'administrativo' THEN 'Administrador da empresa'
            WHEN ev.evento = 'enviado' THEN 'Funcionário'
            ELSE 'Recursos Humanos'
          END,
          'created_at', ev.created_at
        ) ORDER BY ev.created_at ASC, ev.id ASC)
        FROM public.atestados_auditoria ev
        WHERE ev.atestado_id = a.id
      ), '[]'::jsonb) AS timeline
    FROM public.atestados a
    WHERE a.funcionario_id = v_usuario.funcionario_id
    ORDER BY a.created_at DESC
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'atestados', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_listar_atestados(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_atestados_dashboard(
  p_token text,
  p_mes text DEFAULT NULL,
  p_status text DEFAULT 'todos',
  p_offset integer DEFAULT 0,
  p_limite integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_empresa_id uuid;
  v_periodo_inicio date;
  v_periodo_fim date;
  v_status text;
  v_offset integer;
  v_limite integer;
  v_total bigint;
  v_result jsonb;
  v_resumo jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'documents.medical.review') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  v_empresa_id := public.app_empresa_unica();

  IF nullif(btrim(p_mes), '') IS NOT NULL THEN
    IF btrim(p_mes) !~ '^[0-9]{4}-[0-9]{2}$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Mês inválido');
    END IF;
    BEGIN
      v_periodo_inicio := to_date(btrim(p_mes) || '-01', 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Mês inválido');
    END;
    IF to_char(v_periodo_inicio, 'YYYY-MM') <> btrim(p_mes) THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Mês inválido');
    END IF;
    v_periodo_fim := (v_periodo_inicio + interval '1 month')::date;
  END IF;

  v_status := coalesce(nullif(lower(btrim(p_status)), ''), 'todos');
  IF v_status NOT IN ('todos', 'pendentes', 'aceitos', 'recusados') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de status inválido');
  END IF;

  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_limite := least(greatest(coalesce(p_limite, 30), 1), 100);

  SELECT count(*)
  INTO v_total
  FROM public.atestados a
  WHERE a.empresa_id = v_empresa_id
    AND (v_periodo_inicio IS NULL OR (a.data_atendimento >= v_periodo_inicio AND a.data_atendimento < v_periodo_fim))
    AND (
      v_status = 'todos'
      OR (v_status = 'pendentes' AND lower(coalesce(a.status, '')) IN ('aguardando', 'pendente', 'em_analise'))
      OR (v_status = 'aceitos' AND lower(coalesce(a.status, '')) IN ('aceito', 'aceita', 'aprovado', 'aprovada'))
      OR (v_status = 'recusados' AND lower(coalesce(a.status, '')) IN ('recusado', 'recusada', 'reprovado', 'reprovada'))
    );

  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE lower(coalesce(a.status, '')) IN ('aguardando', 'pendente', 'em_analise')),
    'aceitos', count(*) FILTER (WHERE lower(coalesce(a.status, '')) IN ('aceito', 'aceita', 'aprovado', 'aprovada')),
    'recusados', count(*) FILTER (WHERE lower(coalesce(a.status, '')) IN ('recusado', 'recusada', 'reprovado', 'reprovada'))
  )
  INTO v_resumo
  FROM public.atestados a
  WHERE a.empresa_id = v_empresa_id
    AND (v_periodo_inicio IS NULL OR (a.data_atendimento >= v_periodo_inicio AND a.data_atendimento < v_periodo_fim));

  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'prioridade' ORDER BY x.prioridade, x.created_at DESC, x.id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.id, a.funcionario_id, a.tipo, a.data_atendimento, a.dias, a.cid,
      a.observacao, a.arquivo_nome, a.status, a.status_label,
      a.observacao_rh, a.conferido_em, a.created_at,
      f.nome,
      CASE WHEN lower(coalesce(a.status, '')) IN ('aguardando', 'pendente', 'em_analise') THEN 0 ELSE 1 END AS prioridade,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'evento', ev.evento,
          'status_anterior', ev.status_anterior,
          'status_novo', ev.status_novo,
          'justificativa', ev.justificativa,
          'responsavel', CASE
            WHEN ev.evento = 'registro_anterior' THEN 'Registro anterior à auditoria'
            WHEN ev.actor_role = 'administrador_sistema' THEN 'Administrador do sistema'
            WHEN ev.actor_role = 'administrativo' THEN 'Administrador da empresa'
            WHEN ev.evento = 'enviado' THEN 'Funcionário'
            ELSE 'Recursos Humanos'
          END,
          'created_at', ev.created_at
        ) ORDER BY ev.created_at ASC, ev.id ASC)
        FROM public.atestados_auditoria ev
        WHERE ev.atestado_id = a.id
      ), '[]'::jsonb) AS timeline
    FROM public.atestados a
    JOIN public.funcionarios f ON f.id = a.funcionario_id
    WHERE a.empresa_id = v_empresa_id
      AND (v_periodo_inicio IS NULL OR (a.data_atendimento >= v_periodo_inicio AND a.data_atendimento < v_periodo_fim))
      AND (
        v_status = 'todos'
        OR (v_status = 'pendentes' AND lower(coalesce(a.status, '')) IN ('aguardando', 'pendente', 'em_analise'))
        OR (v_status = 'aceitos' AND lower(coalesce(a.status, '')) IN ('aceito', 'aceita', 'aprovado', 'aprovada'))
        OR (v_status = 'recusados' AND lower(coalesce(a.status, '')) IN ('recusado', 'recusada', 'reprovado', 'reprovada'))
      )
    ORDER BY CASE WHEN lower(coalesce(a.status, '')) IN ('aguardando', 'pendente', 'em_analise') THEN 0 ELSE 1 END, a.created_at DESC, a.id DESC
    LIMIT v_limite OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'sucesso', true,
    'atestados', v_result,
    'total', v_total,
    'offset', v_offset,
    'limite', v_limite,
    'resumo', v_resumo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.app_admin_atestados_dashboard(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atestados_dashboard(text, text, text, integer, integer) TO anon, authenticated;
