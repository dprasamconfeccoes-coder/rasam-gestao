BEGIN;

-- Enrich the existing, tenant-scoped timeline with imported attendance exceptions.
-- Events are derived at read time so retroactive point imports appear automatically.
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
    SELECT 1 FROM public.funcionarios f
    WHERE f.id = v_funcionario_id AND f.empresa_id = v.empresa_id
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado neste escopo.');
  END IF;

  IF p_tipo IS NOT NULL AND p_tipo NOT IN (
    'cadastro', 'admissao', 'desligamento', 'advertencia', 'atestado',
    'afastamento', 'ferias', 'justificativa', 'ponto', 'hora_extra',
    'atraso', 'falta', 'documento'
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Filtro de evento inválido.');
  END IF;

  WITH pontos AS (
    SELECT
      r.id::text AS id,
      r.data,
      COALESCE(r.created_at::timestamptz, r.data::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ocorrido_em,
      r.entrada,
      r.saida_almoco,
      r.volta_almoco,
      r.saida,
      r.horas_trabalhadas,
      r.status::text AS status,
      imp.previsto,
      imp.extra_50,
      imp.extra_100,
      imp.dia_falta,
      imp.horas_atraso,
      imp.justificativas,
      imp.inconsistencia,
      COALESCE(inc.status, NULL)::text AS inconsistencia_status
    FROM public.registros_ponto r
    LEFT JOIN LATERAL (
      SELECT l.previsto, l.extra_50, l.extra_100, l.dia_falta, l.horas_atraso,
        l.justificativas, l.inconsistencia
      FROM public.ponto_import_linhas l
      JOIN public.ponto_importacoes i ON i.id = l.importacao_id
      WHERE l.funcionario_id = r.funcionario_id
        AND l.empresa_id = v.empresa_id
        AND l.data = r.data
        AND i.empresa_id = v.empresa_id
        AND i.status = 'aplicada'
      ORDER BY i.applied_at DESC NULLS LAST, i.created_at DESC, l.created_at DESC
      LIMIT 1
    ) imp ON true
    LEFT JOIN LATERAL (
      SELECT p.status
      FROM public.ponto_inconsistencias p
      WHERE p.funcionario_id = r.funcionario_id
        AND p.empresa_id = v.empresa_id
        AND p.data = r.data
        AND p.tipo = 'ponto'
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT 1
    ) inc ON true
    WHERE r.funcionario_id = v_funcionario_id
      AND r.empresa_id = v.empresa_id

    UNION ALL

    -- Keep applied imported rows visible even if an attendance row was not created for that date.
    SELECT
      l.id::text,
      l.data,
      COALESCE(l.importado_em, l.data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      l.entrada_1,
      l.saida_1,
      l.entrada_2,
      l.saida_2,
      NULL::interval,
      'importado'::text,
      l.previsto,
      l.extra_50,
      l.extra_100,
      l.dia_falta,
      l.horas_atraso,
      l.justificativas,
      l.inconsistencia,
      inc.status::text
    FROM (
      SELECT DISTINCT ON (linha.funcionario_id, linha.data)
        linha.id,
        linha.funcionario_id,
        linha.empresa_id,
        linha.data,
        linha.entrada_1,
        linha.saida_1,
        linha.entrada_2,
        linha.saida_2,
        linha.previsto,
        linha.extra_50,
        linha.extra_100,
        linha.dia_falta,
        linha.horas_atraso,
        linha.justificativas,
        linha.inconsistencia,
        linha.created_at,
        COALESCE(importacao.applied_at, importacao.created_at) AS importado_em
      FROM public.ponto_import_linhas linha
      JOIN public.ponto_importacoes importacao ON importacao.id = linha.importacao_id
      WHERE linha.funcionario_id = v_funcionario_id
        AND linha.empresa_id = v.empresa_id
        AND importacao.empresa_id = v.empresa_id
        AND importacao.status = 'aplicada'
      ORDER BY linha.funcionario_id, linha.data,
        importacao.applied_at DESC NULLS LAST,
        importacao.created_at DESC,
        linha.created_at DESC
    ) l
    LEFT JOIN LATERAL (
      SELECT p.status
      FROM public.ponto_inconsistencias p
      WHERE p.funcionario_id = l.funcionario_id
        AND p.empresa_id = v.empresa_id
        AND p.data = l.data
        AND p.tipo = 'ponto'
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT 1
    ) inc ON true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.registros_ponto r
      WHERE r.funcionario_id = l.funcionario_id
        AND r.empresa_id = v.empresa_id
        AND r.data = l.data
    )
  ), eventos AS (
    SELECT t.id::text AS id, 'cadastro'::text AS tipo,
      COALESCE(t.data_evento, t.created_at::date) AS data_evento,
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
      COALESCE(f.cargo, 'Início do vínculo'), 'Vínculo', NULL::text
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
      COALESCE(a.tipo, 'Atestado'),
      concat_ws(' · ', CASE WHEN a.dias IS NULL THEN NULL ELSE a.dias::text || ' dia(s)' END, NULLIF(a.observacao, '')),
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
      concat_ws(' · ', to_char(f.inicio, 'DD/MM/YYYY') || ' a ' || to_char(f.fim, 'DD/MM/YYYY'),
        NULLIF(f.periodo_aquisitivo_inicio::text, '') || CASE WHEN f.periodo_aquisitivo_fim IS NULL THEN '' ELSE ' a ' || f.periodo_aquisitivo_fim::text END),
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

    SELECT p.id || ':ponto', 'ponto', p.data, p.ocorrido_em,
      'Registro de ponto',
      concat_ws(' · ',
        NULLIF(concat_ws(' / ', p.entrada::text, p.saida_almoco::text, p.volta_almoco::text, p.saida::text), ''),
        CASE WHEN p.horas_trabalhadas IS NULL THEN NULL ELSE 'Trabalhado: ' || p.horas_trabalhadas::text END,
        CASE WHEN NULLIF(btrim(COALESCE(p.previsto, '')), '') IS NULL THEN NULL ELSE 'Jornada prevista: ' || btrim(p.previsto) END),
      'Ponto', p.status
    FROM pontos p
    WHERE p.entrada IS NOT NULL OR p.saida_almoco IS NOT NULL
      OR p.volta_almoco IS NOT NULL OR p.saida IS NOT NULL OR p.horas_trabalhadas IS NOT NULL

    UNION ALL

    SELECT p.id || ':extra', 'hora_extra', p.data, p.ocorrido_em,
      'Hora extra registrada',
      concat_ws(' · ',
        CASE WHEN NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p.extra_50, '')), '[^0-9]', '', 'g'), '^0+$', ''), '') IS NOT NULL THEN 'Adicional 50%: ' || btrim(p.extra_50) END,
        CASE WHEN NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p.extra_100, '')), '[^0-9]', '', 'g'), '^0+$', ''), '') IS NOT NULL THEN 'Adicional 100%: ' || btrim(p.extra_100) END),
      'Ponto', p.inconsistencia_status
    FROM pontos p
    WHERE NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p.extra_50, '')), '[^0-9]', '', 'g'), '^0+$', ''), '') IS NOT NULL
       OR NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p.extra_100, '')), '[^0-9]', '', 'g'), '^0+$', ''), '') IS NOT NULL

    UNION ALL

    SELECT p.id || ':atraso', 'atraso', p.data, p.ocorrido_em,
      'Atraso na jornada',
      concat_ws(' · ',
        CASE WHEN NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p.horas_atraso, '')), '[^0-9]', '', 'g'), '^0+$', ''), '') IS NOT NULL THEN 'Tempo registrado: ' || btrim(p.horas_atraso) END,
        NULLIF(btrim(p.inconsistencia), ''),
        NULLIF(btrim(p.justificativas), '')),
      'Ponto', p.inconsistencia_status
    FROM pontos p
    WHERE NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p.horas_atraso, '')), '[^0-9]', '', 'g'), '^0+$', ''), '') IS NOT NULL
       OR lower(COALESCE(p.inconsistencia, '')) LIKE '%atraso%'

    UNION ALL

    SELECT p.id || ':falta', 'falta', p.data, p.ocorrido_em,
      'Falta registrada',
      concat_ws(' · ',
        CASE WHEN NULLIF(btrim(COALESCE(p.dia_falta, '')), '') IS NULL THEN NULL ELSE 'Registro de falta: ' || btrim(p.dia_falta) END,
        NULLIF(btrim(p.inconsistencia), ''),
        NULLIF(btrim(p.justificativas), '')),
      'Ponto', p.inconsistencia_status
    FROM pontos p
    WHERE (
      NULLIF(btrim(COALESCE(p.dia_falta, '')), '') IS NOT NULL
      AND lower(btrim(p.dia_falta)) NOT IN ('0', '0,0', '0.0', '0,00', '0.00', '0:00', '00:00', '00:00:00', 'não', 'nao', '-')
    ) OR lower(COALESCE(p.inconsistencia, '')) LIKE '%falta%'

    UNION ALL

    SELECT d.id::text, 'documento', d.created_at::date, d.created_at,
      COALESCE(d.titulo, d.categoria, 'Documento'),
      concat_ws(' · ', NULLIF(d.arquivo_nome, ''), CASE WHEN d.validade IS NULL THEN NULL ELSE 'Validade ' || to_char(d.validade, 'DD/MM/YYYY') END),
      'Documento', d.categoria
    FROM public.funcionario_documentos d
    WHERE d.funcionario_id = v_funcionario_id AND d.empresa_id = v.empresa_id
  ), filtrados AS (
    SELECT * FROM eventos WHERE p_tipo IS NULL OR tipo = p_tipo
  ), total AS (
    SELECT count(*)::integer AS quantidade FROM filtrados
  ), pagina AS (
    SELECT * FROM filtrados
    ORDER BY data_evento ASC NULLS LAST, ocorrido_em ASC NULLS LAST, id ASC
    OFFSET v_offset LIMIT v_limite
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', pagina.id,
      'tipo', pagina.tipo,
      'data', pagina.data_evento,
      'titulo', pagina.titulo,
      'descricao', pagina.descricao,
      'origem', pagina.origem,
      'status', pagina.status
    ) ORDER BY pagina.data_evento ASC NULLS LAST, pagina.ocorrido_em ASC NULLS LAST, pagina.id ASC), '[]'::jsonb),
    (SELECT quantidade FROM total)
  INTO v_eventos, v_total
  FROM pagina;

  RETURN jsonb_build_object(
    'sucesso', true,
    'eventos', v_eventos,
    'total', v_total,
    'offset', v_offset,
    'limite', v_limite
  );
END;
$$;

COMMIT;
