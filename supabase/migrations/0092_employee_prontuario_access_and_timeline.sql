BEGIN;

CREATE INDEX IF NOT EXISTS idx_registros_ponto_empresa_funcionario_data
  ON public.registros_ponto (empresa_id, funcionario_id, data DESC);

CREATE OR REPLACE FUNCTION public.app_admin_buscar_funcionarios(
  p_token text,
  p_busca text DEFAULT NULL,
  p_situacao text DEFAULT NULL,
  p_tipo_vinculo text DEFAULT NULL,
  p_cargo text DEFAULT NULL,
  p_salario_min numeric DEFAULT NULL,
  p_salario_max numeric DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limite integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_total integer := 0;
  v_registros jsonb := '[]'::jsonb;
  v_busca text := lower(btrim(coalesce(p_busca, '')));
  v_cpf text := regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g');
  v_situacao text := nullif(btrim(coalesce(p_situacao, '')), '');
  v_tipo text := nullif(btrim(coalesce(p_tipo_vinculo, '')), '');
  v_cargo text := lower(btrim(coalesce(p_cargo, '')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado', 'registros', '[]'::jsonb, 'total', 0, 'offset', v_offset, 'limite', v_limite);
  END IF;

  WITH base AS (
    SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao, f.data_demissao,
      f.motivo_demissao, f.tipo_vinculo::text, f.salario, f.ativo,
      COALESCE(u.perfil, 'funcionario')::text AS perfil, f.avatar_url::text,
      CASE
        WHEN NOT f.ativo THEN 'Inativo'
        WHEN EXISTS (
          SELECT 1 FROM public.rh_afastamentos a
          WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id
            AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)
        ) THEN 'Afastado'
        WHEN EXISTS (
          SELECT 1 FROM public.rh_ferias fer
          WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id
            AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)
        ) THEN 'Em férias'
        ELSE 'Trabalhando'
      END::text AS situacao
    FROM public.funcionarios f
    LEFT JOIN public.usuarios u ON u.funcionario_id = f.id AND u.empresa_id = v.empresa_id
    WHERE f.empresa_id = v.empresa_id
      AND (v_busca = '' OR lower(f.nome) LIKE '%' || v_busca || '%'
        OR lower(coalesce(f.cargo, '')) LIKE '%' || v_busca || '%'
        OR (v_cpf <> '' AND regexp_replace(f.cpf, '[^0-9]', '', 'g') LIKE '%' || v_cpf || '%'))
      AND (v_situacao IS NULL OR (
        CASE
          WHEN NOT f.ativo THEN 'Inativo'
          WHEN EXISTS (SELECT 1 FROM public.rh_afastamentos a WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'Afastado'
          WHEN EXISTS (SELECT 1 FROM public.rh_ferias fer WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)) THEN 'Em férias'
          ELSE 'Trabalhando'
        END
      ) = v_situacao)
      AND (v_tipo IS NULL OR f.tipo_vinculo = v_tipo)
      AND (v_cargo = '' OR lower(coalesce(f.cargo, '')) LIKE '%' || v_cargo || '%')
      AND (p_salario_min IS NULL OR coalesce(f.salario, 0) >= p_salario_min)
      AND (p_salario_max IS NULL OR coalesce(f.salario, 0) <= p_salario_max)
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao, f.data_demissao,
      f.motivo_demissao, f.tipo_vinculo::text, f.salario, f.ativo,
      COALESCE(u.perfil, 'funcionario')::text AS perfil, f.avatar_url::text,
      CASE
        WHEN NOT f.ativo THEN 'Inativo'
        WHEN EXISTS (SELECT 1 FROM public.rh_afastamentos a WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'Afastado'
        WHEN EXISTS (SELECT 1 FROM public.rh_ferias fer WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)) THEN 'Em férias'
        ELSE 'Trabalhando'
      END::text AS situacao
    FROM public.funcionarios f
    LEFT JOIN public.usuarios u ON u.funcionario_id = f.id AND u.empresa_id = v.empresa_id
    WHERE f.empresa_id = v.empresa_id
      AND (v_busca = '' OR lower(f.nome) LIKE '%' || v_busca || '%'
        OR lower(coalesce(f.cargo, '')) LIKE '%' || v_busca || '%'
        OR (v_cpf <> '' AND regexp_replace(f.cpf, '[^0-9]', '', 'g') LIKE '%' || v_cpf || '%'))
      AND (v_situacao IS NULL OR (
        CASE
          WHEN NOT f.ativo THEN 'Inativo'
          WHEN EXISTS (SELECT 1 FROM public.rh_afastamentos a WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'Afastado'
          WHEN EXISTS (SELECT 1 FROM public.rh_ferias fer WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)) THEN 'Em férias'
          ELSE 'Trabalhando'
        END
      ) = v_situacao)
      AND (v_tipo IS NULL OR f.tipo_vinculo = v_tipo)
      AND (v_cargo = '' OR lower(coalesce(f.cargo, '')) LIKE '%' || v_cargo || '%')
      AND (p_salario_min IS NULL OR coalesce(f.salario, 0) >= p_salario_min)
      AND (p_salario_max IS NULL OR coalesce(f.salario, 0) <= p_salario_max)
    ORDER BY f.ativo DESC, f.nome ASC
    OFFSET v_offset LIMIT v_limite
  )
  SELECT coalesce(jsonb_agg(to_jsonb(base) ORDER BY base.ativo DESC, base.nome ASC), '[]'::jsonb)
  INTO v_registros FROM base;

  RETURN jsonb_build_object('sucesso', true, 'registros', v_registros, 'total', v_total, 'offset', v_offset, 'limite', v_limite);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_prontuario(p_token text, p_funcionario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_func jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT to_jsonb(f) INTO v_func
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id AND f.empresa_id = v.empresa_id
  LIMIT 1;
  IF v_func IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'funcionario', v_func,
    'documentos', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC) FROM (SELECT * FROM public.funcionario_documentos d WHERE d.funcionario_id = p_funcionario_id AND d.empresa_id = v.empresa_id ORDER BY d.created_at DESC LIMIT 60) d), '[]'::jsonb),
    'advertencias', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.data_ocorrencia DESC) FROM (SELECT * FROM public.funcionario_advertencias a WHERE a.funcionario_id = p_funcionario_id AND a.empresa_id = v.empresa_id ORDER BY a.data_ocorrencia DESC, a.created_at DESC LIMIT 60) a), '[]'::jsonb),
    'timeline', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.data_evento DESC, t.created_at DESC) FROM (SELECT * FROM public.funcionario_timeline t WHERE t.funcionario_id = p_funcionario_id AND t.empresa_id = v.empresa_id ORDER BY t.data_evento DESC, t.created_at DESC LIMIT 120) t), '[]'::jsonb),
    'atestados', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM (SELECT * FROM public.atestados a WHERE a.funcionario_id = p_funcionario_id AND a.empresa_id = v.empresa_id ORDER BY a.created_at DESC LIMIT 60) a), '[]'::jsonb),
    'justificativas', coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.data_registro DESC) FROM (SELECT * FROM public.justificativas_ponto j WHERE j.funcionario_id = p_funcionario_id AND j.empresa_id = v.empresa_id ORDER BY j.data_registro DESC, j.created_at DESC LIMIT 60) j), '[]'::jsonb),
    'ponto', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.data DESC) FROM (SELECT * FROM public.registros_ponto WHERE funcionario_id = p_funcionario_id AND empresa_id = v.empresa_id ORDER BY data DESC LIMIT 180) r), '[]'::jsonb),
    'holerites', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.ano DESC, h.mes DESC) FROM (SELECT * FROM public.holerites WHERE funcionario_id = p_funcionario_id AND empresa_id = v.empresa_id AND disponivel = true ORDER BY ano DESC, mes DESC LIMIT 6) h), '[]'::jsonb),
    'ferias', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.inicio DESC) FROM (SELECT * FROM public.rh_ferias x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.inicio DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb),
    'afastamentos', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.inicio DESC) FROM (SELECT * FROM public.rh_afastamentos x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.inicio DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb),
    'beneficios', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competencia DESC, x.created_at DESC) FROM (SELECT * FROM public.rh_beneficios_lancamentos x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.competencia DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb),
    'descontos', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competencia DESC, x.created_at DESC) FROM (SELECT * FROM public.rh_descontos_lancamentos x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.competencia DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.app_meu_prontuario(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_funcionario jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.funcionario_id IS NULL
     OR COALESCE(v.perfil, '') <> 'funcionario' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso permitido somente ao prontuário do próprio funcionário.');
  END IF;

  SELECT jsonb_build_object(
    'id', f.id,
    'nome', f.nome,
    'cpf', f.cpf,
    'data_nascimento', f.data_nascimento,
    'tipo_vinculo', f.tipo_vinculo,
    'cargo', f.cargo,
    'funcao', f.funcao,
    'data_admissao', f.data_admissao,
    'salario', f.salario,
    'salario_periodo', f.salario_periodo,
    'horario_trabalho', f.horario_trabalho,
    'horario_intervalo', f.horario_intervalo,
    'telefone_celular', f.telefone_celular,
    'endereco', f.endereco,
    'ativo', f.ativo,
    'data_demissao', f.data_demissao,
    'tipo_desligamento', f.tipo_desligamento
  ) INTO v_funcionario
  FROM public.funcionarios f
  WHERE f.id = v.funcionario_id AND f.empresa_id = v.empresa_id
  LIMIT 1;

  IF v_funcionario IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Seu prontuário não está vinculado à sessão. Procure o RH.');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'funcionario', v_funcionario,
    'advertencias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'data_ocorrencia', a.data_ocorrencia, 'tipo', a.tipo, 'descricao', a.descricao, 'medida', a.medida, 'created_at', a.created_at) ORDER BY a.data_ocorrencia DESC, a.created_at DESC) FROM public.funcionario_advertencias a WHERE a.funcionario_id = v.funcionario_id AND a.empresa_id = v.empresa_id), '[]'::jsonb),
    'atestados', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'data_atendimento', a.data_atendimento, 'dias', a.dias, 'status', a.status, 'status_label', a.status_label, 'observacao', a.observacao, 'arquivo_nome', a.arquivo_nome, 'created_at', a.created_at) ORDER BY a.data_atendimento DESC, a.created_at DESC) FROM public.atestados a WHERE a.funcionario_id = v.funcionario_id AND a.empresa_id = v.empresa_id), '[]'::jsonb),
    'justificativas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'data_registro', j.data_registro, 'tipo', j.tipo, 'motivo', j.motivo, 'status', j.status, 'resposta_rh', j.resposta_rh, 'arquivo_nome', j.arquivo_nome, 'created_at', j.created_at) ORDER BY j.data_registro DESC, j.created_at DESC) FROM public.justificativas_ponto j WHERE j.funcionario_id = v.funcionario_id AND j.empresa_id = v.empresa_id), '[]'::jsonb),
    'ferias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'periodo_aquisitivo_inicio', f.periodo_aquisitivo_inicio, 'periodo_aquisitivo_fim', f.periodo_aquisitivo_fim, 'inicio', f.inicio, 'fim', f.fim, 'status', f.status, 'dias_gozo', f.dias_gozo, 'dias_abono', f.dias_abono, 'created_at', f.created_at) ORDER BY f.inicio DESC, f.created_at DESC) FROM public.rh_ferias f WHERE f.funcionario_id = v.funcionario_id AND f.empresa_id = v.empresa_id), '[]'::jsonb),
    'afastamentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'inicio', a.inicio, 'fim', a.fim, 'motivo', a.motivo, 'status', a.status, 'created_at', a.created_at) ORDER BY a.inicio DESC, a.created_at DESC) FROM public.rh_afastamentos a WHERE a.funcionario_id = v.funcionario_id AND a.empresa_id = v.empresa_id), '[]'::jsonb),
    'documentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'categoria', d.categoria, 'titulo', d.titulo, 'arquivo_nome', d.arquivo_nome, 'validade', d.validade, 'created_at', d.created_at) ORDER BY d.created_at DESC) FROM public.funcionario_documentos d WHERE d.funcionario_id = v.funcionario_id AND d.empresa_id = v.empresa_id), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.app_prontuario_linha_tempo(
  p_token text,
  p_funcionario_id uuid DEFAULT NULL,
  p_tipo text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limite integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_funcionario_id uuid;
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 100);
  v_eventos jsonb := '[]'::jsonb;
  v_total integer := 0;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida.');
  END IF;

  IF COALESCE(v.perfil, '') IN ('admin', 'administrador', 'gestor') THEN
    v_funcionario_id := p_funcionario_id;
  ELSIF COALESCE(v.perfil, '') = 'funcionario' THEN
    v_funcionario_id := v.funcionario_id;
  ELSE
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;

  IF v_funcionario_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.funcionarios f WHERE f.id = v_funcionario_id AND f.empresa_id = v.empresa_id
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado neste escopo.');
  END IF;

  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('cadastro', 'admissao', 'desligamento', 'advertencia', 'atestado', 'afastamento', 'ferias', 'justificativa', 'ponto', 'documento') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de evento inválido.');
  END IF;

  WITH eventos AS (
    SELECT t.id::text AS id, 'cadastro'::text AS tipo, COALESCE(t.data_evento, t.created_at::date) AS data_evento,
      COALESCE(t.created_at, t.data_evento::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ocorrido_em,
      COALESCE(t.evento, 'Movimento funcional')::text AS titulo,
      COALESCE(t.descricao, '')::text AS descricao,
      COALESCE(t.origem, 'RH')::text AS origem,
      NULL::text AS status
    FROM public.funcionario_timeline t
    WHERE t.funcionario_id = v_funcionario_id AND t.empresa_id = v.empresa_id
    UNION ALL
    SELECT f.id::text, 'admissao', f.data_admissao,
      f.data_admissao::timestamp AT TIME ZONE 'America/Sao_Paulo', 'Admissão',
      COALESCE(f.cargo, 'Vínculo iniciado'), 'Vínculo', NULL::text
    FROM public.funcionarios f
    WHERE f.id = v_funcionario_id AND f.empresa_id = v.empresa_id AND f.data_admissao IS NOT NULL
    UNION ALL
    SELECT f.id::text, 'desligamento', f.data_demissao,
      f.data_demissao::timestamp AT TIME ZONE 'America/Sao_Paulo', 'Desligamento',
      COALESCE(f.motivo_demissao, f.tipo_desligamento, 'Encerramento do vínculo'), 'Vínculo', 'Inativo'
    FROM public.funcionarios f
    WHERE f.id = v_funcionario_id AND f.empresa_id = v.empresa_id AND f.data_demissao IS NOT NULL
    UNION ALL
    SELECT a.id::text, 'advertencia', a.data_ocorrencia,
      COALESCE(a.created_at, a.data_ocorrencia::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      COALESCE(a.tipo, 'Advertência'), concat_ws(' · ', NULLIF(a.descricao, ''), NULLIF(a.medida, '')),
      'Advertência', 'Registrada'
    FROM public.funcionario_advertencias a
    WHERE a.funcionario_id = v_funcionario_id AND a.empresa_id = v.empresa_id
    UNION ALL
    SELECT a.id::text, 'atestado', a.data_atendimento,
      COALESCE(a.created_at::timestamptz, a.data_atendimento::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      COALESCE(a.tipo, 'Atestado'), concat_ws(' · ', CASE WHEN a.dias IS NULL THEN NULL ELSE a.dias::text || ' dia(s)' END, NULLIF(a.observacao, '')),
      'Atestado', COALESCE(a.status_label, a.status)
    FROM public.atestados a
    WHERE a.funcionario_id = v_funcionario_id AND a.empresa_id = v.empresa_id
    UNION ALL
    SELECT a.id::text, 'afastamento', a.inicio,
      COALESCE(a.created_at, a.inicio::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      COALESCE(a.tipo, 'Afastamento'), concat_ws(' · ', 'Até ' || COALESCE(a.fim::text, 'em aberto'), NULLIF(a.motivo, '')),
      'Afastamento', a.status
    FROM public.rh_afastamentos a
    WHERE a.funcionario_id = v_funcionario_id AND a.empresa_id = v.empresa_id
    UNION ALL
    SELECT f.id::text, 'ferias', f.inicio,
      COALESCE(f.created_at, f.inicio::timestamp AT TIME ZONE 'America/Sao_Paulo'), 'Férias',
      concat_ws(' · ', to_char(f.inicio, 'DD/MM/YYYY') || ' a ' || to_char(f.fim, 'DD/MM/YYYY'), NULLIF(f.periodo_aquisitivo_inicio::text, '') || CASE WHEN f.periodo_aquisitivo_fim IS NULL THEN '' ELSE ' a ' || f.periodo_aquisitivo_fim::text END),
      'Férias', f.status
    FROM public.rh_ferias f
    WHERE f.funcionario_id = v_funcionario_id AND f.empresa_id = v.empresa_id
    UNION ALL
    SELECT j.id::text, 'justificativa', j.data_registro,
      COALESCE(j.created_at::timestamptz, j.data_registro::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      COALESCE(j.tipo, 'Justificativa de ponto'), COALESCE(j.motivo, ''), 'Justificativa', j.status
    FROM public.justificativas_ponto j
    WHERE j.funcionario_id = v_funcionario_id AND j.empresa_id = v.empresa_id
    UNION ALL
    SELECT r.id::text, 'ponto', r.data,
      COALESCE(r.created_at::timestamptz, r.data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      'Registro de ponto', concat_ws(' · ', concat_ws(' / ', r.entrada::text, r.saida_almoco::text, r.volta_almoco::text, r.saida::text), r.horas_trabalhadas::text),
      'Ponto', r.status
    FROM public.registros_ponto r
    WHERE r.funcionario_id = v_funcionario_id AND r.empresa_id = v.empresa_id
    UNION ALL
    SELECT d.id::text, 'documento', d.created_at::date, d.created_at,
      COALESCE(d.titulo, d.categoria, 'Documento'), concat_ws(' · ', NULLIF(d.arquivo_nome, ''), CASE WHEN d.validade IS NULL THEN NULL ELSE 'Validade ' || to_char(d.validade, 'DD/MM/YYYY') END),
      'Documento', d.categoria
    FROM public.funcionario_documentos d
    WHERE d.funcionario_id = v_funcionario_id AND d.empresa_id = v.empresa_id
  ), filtrados AS (
    SELECT * FROM eventos WHERE p_tipo IS NULL OR tipo = p_tipo
  ), total AS (
    SELECT count(*)::integer AS quantidade FROM filtrados
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY data_evento DESC NULLS LAST, ocorrido_em DESC NULLS LAST, id DESC
    OFFSET v_offset LIMIT v_limite
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', pagina.id, 'tipo', pagina.tipo, 'data', pagina.data_evento,
      'titulo', pagina.titulo, 'descricao', pagina.descricao,
      'origem', pagina.origem, 'status', pagina.status
    ) ORDER BY pagina.data_evento DESC NULLS LAST, pagina.ocorrido_em DESC NULLS LAST, pagina.id DESC), '[]'::jsonb),
    (SELECT quantidade FROM total)
  INTO v_eventos, v_total
  FROM pagina;

  RETURN jsonb_build_object('sucesso', true, 'eventos', v_eventos, 'total', v_total, 'offset', v_offset, 'limite', v_limite);
END;
$$;

REVOKE ALL ON FUNCTION public.app_admin_buscar_funcionarios(text, text, text, text, text, numeric, numeric, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_buscar_funcionarios(text, text, text, text, text, numeric, numeric, integer, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_prontuario(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_prontuario(text, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.app_meu_prontuario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_meu_prontuario(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.app_prontuario_linha_tempo(text, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_prontuario_linha_tempo(text, uuid, text, integer, integer) TO anon, authenticated;

COMMIT;
