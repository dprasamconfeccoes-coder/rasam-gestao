-- Uma edição/publicação nova do mesmo aviso reabre a leitura sem apagar recibos antigos.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_contar_avisos_nao_lidos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_funcionario_id uuid; v_empresa_id uuid; v_count integer;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.read') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para consultar avisos');
  END IF;
  SELECT funcionario_id, empresa_id INTO v_funcionario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Usuário sem vínculo de funcionário');
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.rh_avisos a
  WHERE a.empresa_id = v_empresa_id AND a.status = 'publicado' AND a.publicado = true
    AND NOT EXISTS (
      SELECT 1 FROM public.rh_avisos_leituras l
      WHERE l.aviso_id = a.id AND l.funcionario_id = v_funcionario_id
        AND l.empresa_id = v_empresa_id AND l.lido_em >= a.updated_at
    );
  RETURN jsonb_build_object('sucesso', true, 'nao_lidos', COALESCE(v_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_listar_avisos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_funcionario_id uuid; v_empresa_id uuid; v_result jsonb; v_count integer;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.read') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para consultar avisos');
  END IF;
  SELECT funcionario_id, empresa_id INTO v_funcionario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Usuário sem vínculo de funcionário');
  END IF;
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
  SELECT count(*)::integer INTO v_count
  FROM public.rh_avisos a
  WHERE a.empresa_id = v_empresa_id AND a.status = 'publicado' AND a.publicado = true
    AND NOT EXISTS (
      SELECT 1 FROM public.rh_avisos_leituras l
      WHERE l.aviso_id = a.id AND l.funcionario_id = v_funcionario_id
        AND l.empresa_id = v_empresa_id AND l.lido_em >= a.updated_at
    );
  RETURN jsonb_build_object('sucesso', true, 'avisos', v_result, 'nao_lidos', COALESCE(v_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_marcar_aviso_lido(p_token text, p_aviso_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_usuario_id uuid; v_funcionario_id uuid; v_empresa_id uuid; v_lido_em timestamptz;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.read') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para registrar leitura');
  END IF;
  SELECT usuario_id, funcionario_id, empresa_id INTO v_usuario_id, v_funcionario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Usuário sem vínculo de funcionário');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rh_avisos a WHERE a.id = p_aviso_id AND a.empresa_id = v_empresa_id
      AND a.publicado = true AND a.status = 'publicado'
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Aviso não encontrado ou indisponível');
  END IF;
  INSERT INTO public.rh_avisos_leituras (aviso_id, funcionario_id, empresa_id, usuario_id)
  VALUES (p_aviso_id, v_funcionario_id, v_empresa_id, v_usuario_id)
  ON CONFLICT (aviso_id, funcionario_id) DO UPDATE
    SET empresa_id = EXCLUDED.empresa_id, usuario_id = EXCLUDED.usuario_id, lido_em = now();
  SELECT lido_em INTO v_lido_em FROM public.rh_avisos_leituras
  WHERE aviso_id = p_aviso_id AND funcionario_id = v_funcionario_id AND empresa_id = v_empresa_id;
  RETURN jsonb_build_object('sucesso', true, 'lido_em', v_lido_em);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_avisos_dashboard(
  p_token text, p_status text DEFAULT 'todos', p_categoria text DEFAULT NULL,
  p_offset integer DEFAULT 0, p_limite integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_usuario_id uuid; v_empresa_id uuid;
  v_status text := COALESCE(NULLIF(lower(btrim(p_status)), ''), 'todos');
  v_categoria text := NULLIF(btrim(COALESCE(p_categoria, '')), '');
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 30), 1), 100);
  v_total integer; v_recipientes integer; v_summary jsonb; v_items jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado: permissão de gestão de avisos necessária');
  END IF;
  SELECT usuario_id, empresa_id INTO v_usuario_id, v_empresa_id
  FROM public.app_tenant_usuario(p_token) LIMIT 1;
  SELECT count(*)::integer INTO v_recipientes FROM public.funcionarios f
  WHERE f.empresa_id = v_empresa_id AND f.ativo = true;
  SELECT jsonb_build_object(
    'total', count(*), 'publicados', count(*) FILTER (WHERE a.status = 'publicado'),
    'rascunhos', count(*) FILTER (WHERE a.status = 'rascunho'), 'arquivados', count(*) FILTER (WHERE a.status = 'arquivado'),
    'leituras', (SELECT count(*) FROM public.rh_avisos_leituras l WHERE l.empresa_id = v_empresa_id),
    'funcionarios_ativos', v_recipientes
  ) INTO v_summary FROM public.rh_avisos a WHERE a.empresa_id = v_empresa_id;
  IF v_status NOT IN ('todos', 'publicado', 'rascunho', 'arquivado') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de status inválido');
  END IF;
  IF v_categoria IS NOT NULL AND v_categoria NOT IN ('jornada_trabalho','holerite','beneficios','reuniao','sindicato','prevencao','informativo','outro') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de categoria inválido');
  END IF;
  SELECT count(*)::integer INTO v_total FROM public.rh_avisos a
  WHERE a.empresa_id = v_empresa_id AND (v_status = 'todos' OR a.status = v_status)
    AND (v_categoria IS NULL OR a.categoria = v_categoria);
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.status_order, x.updated_at DESC, x.id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'id', a.id, 'titulo', a.titulo, 'conteudo', a.conteudo, 'categoria', a.categoria,
      'prioridade', a.prioridade, 'status', a.status, 'publicado_em', a.publicado_em,
      'created_at', a.created_at, 'updated_at', a.updated_at, 'created_by', a.created_by,
      'updated_by', a.updated_by, 'funcionarios_ativos', v_recipientes,
      'lidos', (
        SELECT count(*)::integer FROM public.rh_avisos_leituras l
        JOIN public.funcionarios f ON f.id = l.funcionario_id
        WHERE l.aviso_id = a.id AND l.empresa_id = v_empresa_id
          AND f.empresa_id = v_empresa_id AND f.ativo = true AND l.lido_em >= a.updated_at
      ),
      'nao_lidos', CASE WHEN a.status = 'publicado' THEN GREATEST(v_recipientes - (
        SELECT count(*)::integer FROM public.rh_avisos_leituras l
        JOIN public.funcionarios f ON f.id = l.funcionario_id
        WHERE l.aviso_id = a.id AND l.empresa_id = v_empresa_id
          AND f.empresa_id = v_empresa_id AND f.ativo = true AND l.lido_em >= a.updated_at
      ), 0) ELSE 0 END,
      'auditoria', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'evento', ev.evento, 'antes', ev.antes, 'depois', ev.depois,
          'responsavel', COALESCE(f.nome, u.nome_exibicao, 'Administrador'), 'created_at', ev.created_at
        ) ORDER BY ev.created_at DESC, ev.id DESC), '[]'::jsonb)
        FROM (
          SELECT * FROM public.rh_avisos_auditoria au WHERE au.aviso_id = a.id AND au.empresa_id = v_empresa_id
          ORDER BY au.created_at DESC, au.id DESC LIMIT 10
        ) ev
        LEFT JOIN public.usuarios u ON u.id = ev.usuario_id
        LEFT JOIN public.funcionarios f ON f.id = u.funcionario_id
      )
    ) AS item,
    CASE a.status WHEN 'publicado' THEN 0 WHEN 'rascunho' THEN 1 ELSE 2 END AS status_order,
    a.updated_at, a.id
    FROM public.rh_avisos a
    WHERE a.empresa_id = v_empresa_id AND (v_status = 'todos' OR a.status = v_status)
      AND (v_categoria IS NULL OR a.categoria = v_categoria)
    ORDER BY status_order, a.updated_at DESC, a.id DESC
    LIMIT v_limite OFFSET v_offset
  ) x;
  RETURN jsonb_build_object('sucesso', true, 'resumo', v_summary, 'avisos', v_items,
    'total', v_total, 'offset', v_offset, 'limite', v_limite);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_aviso_leituras(
  p_token text, p_aviso_id uuid, p_offset integer DEFAULT 0, p_limite integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_empresa_id uuid; v_updated_at timestamptz;
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500);
  v_total integer; v_rows jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'notices.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  SELECT empresa_id INTO v_empresa_id FROM public.app_tenant_usuario(p_token) LIMIT 1;
  SELECT updated_at INTO v_updated_at FROM public.rh_avisos
  WHERE id = p_aviso_id AND empresa_id = v_empresa_id;
  IF v_updated_at IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Aviso não encontrado nesta empresa');
  END IF;
  SELECT count(*)::integer INTO v_total FROM public.funcionarios f
  WHERE f.empresa_id = v_empresa_id AND f.ativo = true;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nome), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT f.id AS funcionario_id, f.nome,
      (l.lido_em IS NOT NULL AND l.lido_em >= v_updated_at) AS lido,
      CASE WHEN l.lido_em >= v_updated_at THEN l.lido_em ELSE NULL END AS lido_em
    FROM public.funcionarios f
    LEFT JOIN public.rh_avisos_leituras l
      ON l.aviso_id = p_aviso_id AND l.funcionario_id = f.id
        AND l.empresa_id = v_empresa_id AND l.lido_em >= v_updated_at
    WHERE f.empresa_id = v_empresa_id AND f.ativo = true
    ORDER BY f.nome, f.id LIMIT v_limite OFFSET v_offset
  ) x;
  RETURN jsonb_build_object('sucesso', true, 'funcionarios', v_rows, 'total', v_total,
    'offset', v_offset, 'limite', v_limite);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_contar_avisos_nao_lidos(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_avisos(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_marcar_aviso_lido(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_avisos_dashboard(text, text, text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_aviso_leituras(text, uuid, integer, integer) TO anon, authenticated;
COMMIT;
