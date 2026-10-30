-- Solicitações ao RH: categorias, histórico auditável, tenant scope e dashboard paginado.
BEGIN;

-- Registros anteriores podem ter sido criados antes de empresa_id ser preenchido.
UPDATE public.rh_solicitacoes s
SET empresa_id = COALESCE(f.empresa_id, public.app_empresa_unica())
FROM public.funcionarios f
WHERE f.id = s.funcionario_id
  AND s.empresa_id IS NULL;

CREATE TABLE IF NOT EXISTS public.rh_solicitacoes_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public.rh_solicitacoes(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  actor_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  evento text NOT NULL,
  status_anterior text,
  status_novo text NOT NULL,
  comentario text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_solicitacoes_empresa_created_idx
  ON public.rh_solicitacoes (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rh_solicitacoes_empresa_status_created_idx
  ON public.rh_solicitacoes (empresa_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS rh_solicitacoes_funcionario_created_idx
  ON public.rh_solicitacoes (funcionario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rh_solicitacoes_auditoria_request_created_idx
  ON public.rh_solicitacoes_auditoria (solicitacao_id, created_at, id);
CREATE INDEX IF NOT EXISTS rh_solicitacoes_auditoria_empresa_created_idx
  ON public.rh_solicitacoes_auditoria (empresa_id, created_at DESC);

ALTER TABLE public.rh_solicitacoes_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rh_solicitacoes_auditoria FROM PUBLIC, anon, authenticated;

-- Semear uma linha de histórico para solicitações anteriores à trilha de auditoria.
INSERT INTO public.rh_solicitacoes_auditoria (
  solicitacao_id, funcionario_id, empresa_id, actor_usuario_id, actor_role,
  evento, status_anterior, status_novo, comentario, created_at
)
SELECT
  s.id, s.funcionario_id, COALESCE(s.empresa_id, f.empresa_id, public.app_empresa_unica()),
  s.analisado_por, 'registro_anterior', 'registro_anterior', NULL, s.status,
  NULLIF(btrim(s.resposta), ''), COALESCE(s.analisado_em, s.updated_at, s.created_at)
FROM public.rh_solicitacoes s
JOIN public.funcionarios f ON f.id = s.funcionario_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.rh_solicitacoes_auditoria a WHERE a.solicitacao_id = s.id
);

CREATE OR REPLACE FUNCTION public.app_criar_solicitacao(
  p_token text,
  p_tipo text,
  p_descricao text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario_id uuid;
  v_funcionario_id uuid;
  v_empresa_id uuid;
  v_tipo text := btrim(COALESCE(p_tipo, ''));
  v_descricao text := btrim(COALESCE(p_descricao, ''));
  v_id uuid;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.self.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para solicitar ao RH');
  END IF;

  SELECT usuario_id, funcionario_id
    INTO v_usuario_id, v_funcionario_id
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Usuário sem vínculo de funcionário');
  END IF;

  IF v_tipo NOT IN (
    'Dúvida ao RH', 'Correção cadastral', 'Solicitação de férias',
    'Solicitação de documento', 'Benefício', 'Outro assunto'
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione um tipo de solicitação válido');
  END IF;

  IF char_length(v_descricao) < 10 OR char_length(v_descricao) > 2500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Descreva a solicitação com 10 a 2.500 caracteres');
  END IF;

  SELECT COALESCE(f.empresa_id, public.app_empresa_unica())
    INTO v_empresa_id
  FROM public.funcionarios f
  WHERE f.id = v_funcionario_id;

  IF v_empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível identificar a empresa do funcionário');
  END IF;

  INSERT INTO public.rh_solicitacoes (funcionario_id, empresa_id, tipo, descricao, status)
  VALUES (v_funcionario_id, v_empresa_id, v_tipo, v_descricao, 'pendente')
  RETURNING id INTO v_id;

  INSERT INTO public.rh_solicitacoes_auditoria (
    solicitacao_id, funcionario_id, empresa_id, actor_usuario_id, actor_role,
    evento, status_anterior, status_novo, comentario
  ) VALUES (
    v_id, v_funcionario_id, v_empresa_id, v_usuario_id,
    COALESCE(public.app_role_code_for_user(v_usuario_id), 'funcionario'),
    'solicitacao_aberta', NULL, 'pendente', NULL
  );

  RETURN jsonb_build_object('sucesso', true, 'id', v_id, 'status', 'pendente');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_listar_solicitacoes(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_funcionario_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.self.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para consultar solicitações');
  END IF;

  SELECT funcionario_id INTO v_funcionario_id
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Usuário sem vínculo de funcionário');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'tipo', q.tipo,
      'descricao', q.descricao,
      'anexo_nome', q.anexo_nome,
      'status', q.status,
      'resposta', q.resposta,
      'created_at', q.created_at,
      'updated_at', q.updated_at,
      'analisado_em', q.analisado_em,
      'timeline', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'evento', a.evento,
            'status_anterior', a.status_anterior,
            'status_novo', a.status_novo,
            'comentario', a.comentario,
            'responsavel', a.actor_role,
            'created_at', a.created_at
          ) ORDER BY a.created_at, a.id
        ), '[]'::jsonb)
        FROM public.rh_solicitacoes_auditoria a
        WHERE a.solicitacao_id = q.id AND a.funcionario_id = v_funcionario_id
      )
    ) ORDER BY q.created_at DESC, q.id
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT s.id, s.tipo, s.descricao, s.anexo_nome, s.status, s.resposta,
           s.created_at, s.updated_at, s.analisado_em
    FROM public.rh_solicitacoes s
    WHERE s.funcionario_id = v_funcionario_id
    ORDER BY s.created_at DESC, s.id
  ) q;

  RETURN jsonb_build_object('sucesso', true, 'solicitacoes', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_solicitacoes_dashboard(
  p_token text,
  p_mes text DEFAULT NULL,
  p_status text DEFAULT 'todos',
  p_funcionario_id uuid DEFAULT NULL,
  p_tipo text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limite integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_mes date;
  v_periodo_inicio timestamptz;
  v_periodo_fim timestamptz;
  v_status text := COALESCE(NULLIF(lower(btrim(p_status)), ''), 'todos');
  v_tipo text := NULLIF(btrim(COALESCE(p_tipo, '')), '');
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 30), 1), 100);
  v_total integer := 0;
  v_resumo jsonb;
  v_rows jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado: permissão de gestão de solicitações necessária');
  END IF;

  v_empresa_id := public.app_empresa_unica();

  IF p_mes IS NOT NULL AND btrim(p_mes) <> '' THEN
    IF p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Mês inválido; use AAAA-MM');
    END IF;
    v_mes := to_date(p_mes || '-01', 'YYYY-MM-DD');
    v_periodo_inicio := v_mes::timestamp AT TIME ZONE 'America/Sao_Paulo';
    v_periodo_fim := (v_mes + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF v_status NOT IN ('todos', 'pendentes', 'em_analise', 'atendidas', 'recusadas', 'canceladas') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de status inválido');
  END IF;

  IF v_tipo IS NOT NULL AND v_tipo NOT IN (
    'Dúvida ao RH', 'Correção cadastral', 'Solicitação de férias',
    'Solicitação de documento', 'Benefício', 'Outro assunto'
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de tipo inválido');
  END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'pendentes', count(*) FILTER (WHERE s.status IN ('pendente', 'aberta', 'nova')),
    'em_analise', count(*) FILTER (WHERE s.status = 'em_analise'),
    'abertas', count(*) FILTER (WHERE s.status IN ('pendente', 'aberta', 'nova', 'em_analise')),
    'atendidas', count(*) FILTER (WHERE s.status IN ('atendida', 'concluida', 'aprovada')),
    'recusadas', count(*) FILTER (WHERE s.status IN ('recusada', 'reprovada')),
    'canceladas', count(*) FILTER (WHERE s.status = 'cancelada')
  ) INTO v_resumo
  FROM public.rh_solicitacoes s
  JOIN public.funcionarios f ON f.id = s.funcionario_id
  WHERE s.empresa_id = v_empresa_id
    AND (v_periodo_inicio IS NULL OR (s.created_at >= v_periodo_inicio AND s.created_at < v_periodo_fim))
    AND (p_funcionario_id IS NULL OR s.funcionario_id = p_funcionario_id)
    AND (v_tipo IS NULL OR s.tipo = v_tipo);

  SELECT count(*)::integer INTO v_total
  FROM public.rh_solicitacoes s
  JOIN public.funcionarios f ON f.id = s.funcionario_id
  WHERE s.empresa_id = v_empresa_id
    AND (v_periodo_inicio IS NULL OR (s.created_at >= v_periodo_inicio AND s.created_at < v_periodo_fim))
    AND (p_funcionario_id IS NULL OR s.funcionario_id = p_funcionario_id)
    AND (v_tipo IS NULL OR s.tipo = v_tipo)
    AND CASE v_status
      WHEN 'pendentes' THEN s.status IN ('pendente', 'aberta', 'nova')
      WHEN 'em_analise' THEN s.status = 'em_analise'
      WHEN 'atendidas' THEN s.status IN ('atendida', 'concluida', 'aprovada')
      WHEN 'recusadas' THEN s.status IN ('recusada', 'reprovada')
      WHEN 'canceladas' THEN s.status = 'cancelada'
      ELSE true
    END;

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.prioridade, x.created_at DESC, x.id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      jsonb_build_object(
        'id', s.id,
        'funcionario_id', s.funcionario_id,
        'nome', f.nome,
        'tipo', s.tipo,
        'descricao', s.descricao,
        'anexo_nome', s.anexo_nome,
        'status', s.status,
        'resposta', s.resposta,
        'created_at', s.created_at,
        'updated_at', s.updated_at,
        'analisado_em', s.analisado_em,
        'timeline', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'evento', a.evento,
              'status_anterior', a.status_anterior,
              'status_novo', a.status_novo,
              'comentario', a.comentario,
              'responsavel', a.actor_role,
              'created_at', a.created_at
            ) ORDER BY a.created_at, a.id
          ), '[]'::jsonb)
          FROM public.rh_solicitacoes_auditoria a
          WHERE a.solicitacao_id = s.id AND a.empresa_id = v_empresa_id
        )
      ) AS item,
      CASE WHEN s.status IN ('pendente', 'aberta', 'nova', 'em_analise') THEN 0 ELSE 1 END AS prioridade,
      s.created_at,
      s.id
    FROM public.rh_solicitacoes s
    JOIN public.funcionarios f ON f.id = s.funcionario_id
    WHERE s.empresa_id = v_empresa_id
      AND (v_periodo_inicio IS NULL OR (s.created_at >= v_periodo_inicio AND s.created_at < v_periodo_fim))
      AND (p_funcionario_id IS NULL OR s.funcionario_id = p_funcionario_id)
      AND (v_tipo IS NULL OR s.tipo = v_tipo)
      AND CASE v_status
        WHEN 'pendentes' THEN s.status IN ('pendente', 'aberta', 'nova')
        WHEN 'em_analise' THEN s.status = 'em_analise'
        WHEN 'atendidas' THEN s.status IN ('atendida', 'concluida', 'aprovada')
        WHEN 'recusadas' THEN s.status IN ('recusada', 'reprovada')
        WHEN 'canceladas' THEN s.status = 'cancelada'
        ELSE true
      END
    ORDER BY prioridade, s.created_at DESC, s.id
    LIMIT v_limite OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'sucesso', true,
    'resumo', v_resumo,
    'solicitacoes', v_rows,
    'total', v_total,
    'offset', v_offset,
    'limite', v_limite
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_solicitacoes(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  v_empresa_id := public.app_empresa_unica();
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT s.id, s.funcionario_id, s.tipo, s.descricao, s.anexo_nome,
           s.status, s.resposta, s.analisado_em, s.created_at,
           f.nome, f.cpf
    FROM public.rh_solicitacoes s
    JOIN public.funcionarios f ON f.id = s.funcionario_id
    WHERE s.empresa_id = v_empresa_id
    ORDER BY s.created_at DESC, s.id
    LIMIT 500
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'solicitacoes', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_responder_solicitacao(
  p_token text,
  p_id uuid,
  p_status text,
  p_resposta text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario_id uuid;
  v_empresa_id uuid;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_resposta text := NULLIF(btrim(COALESCE(p_resposta, '')), '');
  v_current record;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT usuario_id INTO v_usuario_id
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;
  v_empresa_id := public.app_empresa_unica();

  IF p_id IS NULL OR v_status NOT IN ('pendente', 'em_analise', 'atendida', 'recusada', 'cancelada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação ou status inválido');
  END IF;

  IF v_status IN ('atendida', 'recusada') AND char_length(COALESCE(v_resposta, '')) < 5 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma resposta de pelo menos 5 caracteres para concluir ou recusar');
  END IF;

  SELECT s.funcionario_id, s.empresa_id, s.status, s.resposta
    INTO v_current
  FROM public.rh_solicitacoes s
  WHERE s.id = p_id AND s.empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação não encontrada nesta empresa');
  END IF;

  UPDATE public.rh_solicitacoes
  SET status = v_status,
      resposta = COALESCE(v_resposta, v_current.resposta),
      analisado_por = v_usuario_id,
      analisado_em = now(),
      updated_at = now()
  WHERE id = p_id AND empresa_id = v_empresa_id;

  IF v_current.status IS DISTINCT FROM v_status
     OR (v_resposta IS NOT NULL AND v_current.resposta IS DISTINCT FROM v_resposta) THEN
    INSERT INTO public.rh_solicitacoes_auditoria (
      solicitacao_id, funcionario_id, empresa_id, actor_usuario_id, actor_role,
      evento, status_anterior, status_novo, comentario
    ) VALUES (
      p_id, v_current.funcionario_id, v_empresa_id, v_usuario_id,
      COALESCE(public.app_role_code_for_user(v_usuario_id), 'administrativo'),
      CASE WHEN v_current.status IS DISTINCT FROM v_status THEN 'status_alterado' ELSE 'resposta_atualizada' END,
      v_current.status, v_status, COALESCE(v_resposta, v_current.resposta)
    );
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_criar_solicitacao(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_listar_solicitacoes(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_solicitacoes_dashboard(text, text, text, uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_solicitacoes(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_responder_solicitacao(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_criar_solicitacao(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_solicitacoes(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_solicitacoes_dashboard(text, text, text, uuid, text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_solicitacoes(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_responder_solicitacao(text, uuid, text, text) TO anon, authenticated;

COMMIT;
