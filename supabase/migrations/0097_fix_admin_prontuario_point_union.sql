-- Correção de tipos no UNION do prontuário administrativo
-- Enriquecimento do prontuário administrativo com a fonte real da importação de ponto.
-- Registros de ponto armazenam a jornada consolidada; extras, faltas, atrasos,
-- abono e inconsistências ficam em ponto_import_linhas/ponto_inconsistencias.
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
    'ponto', coalesce((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.data DESC)
      FROM (
        WITH imported AS (
          SELECT DISTINCT ON (l.funcionario_id, l.data)
            l.id,
            l.funcionario_id,
            l.data,
            l.entrada_1::text AS entrada,
            l.saida_1::text AS saida_almoco,
            l.entrada_2::text AS volta_almoco,
            l.saida_2::text AS saida,
            nullif(trim(coalesce(l.total_normais, '')), '') AS horas_trabalhadas,
            coalesce(inc.status, CASE
              WHEN nullif(trim(coalesce(l.dia_falta, '')), '') IS NOT NULL AND lower(trim(l.dia_falta)) NOT IN ('não', 'nao', 'n', '0', 'false') THEN 'falta'
              WHEN public.app_horas_decimal(l.horas_atraso) > 0 THEN 'atraso'
              WHEN nullif(trim(coalesce(l.inconsistencia, '')), '') IS NOT NULL THEN 'inconsistencia'
              ELSE 'regular'
            END) AS status,
            l.extra_50,
            l.extra_100,
            public.app_horas_decimal(l.extra_50) + public.app_horas_decimal(l.extra_100) AS horas_extras,
            l.previsto,
            l.dia_falta,
            l.horas_atraso,
            l.abono,
            l.desconta_dsr,
            l.justificativas,
            l.inconsistencia,
            CASE
              WHEN nullif(trim(coalesce(l.dia_falta, '')), '') IS NOT NULL AND lower(trim(l.dia_falta)) NOT IN ('não', 'nao', 'n', '0', 'false') THEN 'falta'
              WHEN public.app_horas_decimal(l.horas_atraso) > 0 THEN 'atraso'
              WHEN nullif(trim(coalesce(l.inconsistencia, '')), '') IS NOT NULL THEN 'inconsistencia'
              ELSE NULL
            END AS inconsistencia_tipo,
            inc.status AS inconsistencia_status,
            coalesce(inc.justificativa, jp.motivo) AS inconsistencia_justificativa,
            jp.id AS justificativa_id,
            jp.status AS justificativa_status,
            jp.motivo AS justificativa_motivo,
            jp.resposta_rh AS justificativa_resposta,
            jp.arquivo_url AS justificativa_arquivo_url,
            jp.arquivo_nome AS justificativa_arquivo_nome,
            i.applied_at,
            i.created_at AS import_created_at
          FROM public.ponto_import_linhas l
          JOIN public.ponto_importacoes i
            ON i.id = l.importacao_id AND i.empresa_id = l.empresa_id
          LEFT JOIN LATERAL (
            SELECT p.status, p.justificativa
            FROM public.ponto_inconsistencias p
            WHERE p.funcionario_id = l.funcionario_id
              AND p.data = l.data
              AND p.tipo = 'ponto'
              AND p.empresa_id = v.empresa_id
            ORDER BY p.updated_at DESC
            LIMIT 1
          ) inc ON true
          LEFT JOIN LATERAL (
            SELECT j.id, j.status, j.motivo, j.resposta_rh, j.arquivo_url, j.arquivo_nome
            FROM public.justificativas_ponto j
            WHERE j.funcionario_id = l.funcionario_id
              AND j.data_registro = l.data
              AND j.empresa_id = v.empresa_id
            ORDER BY j.created_at DESC
            LIMIT 1
          ) jp ON true
          WHERE l.funcionario_id = p_funcionario_id
            AND l.empresa_id = v.empresa_id
            AND i.empresa_id = v.empresa_id
            AND i.status = 'aplicada'
            AND l.data IS NOT NULL
          ORDER BY l.funcionario_id, l.data,
            i.applied_at DESC NULLS LAST, i.created_at DESC, l.created_at DESC, l.id DESC
        ),
        records_only AS (
          SELECT
            r.id,
            r.funcionario_id,
            r.data,
            r.entrada::text AS entrada,
            r.saida_almoco::text AS saida_almoco,
            r.volta_almoco::text AS volta_almoco,
            r.saida::text AS saida,
            r.horas_trabalhadas::text AS horas_trabalhadas,
            r.status,
            NULL::text AS extra_50,
            NULL::text AS extra_100,
            0::numeric AS horas_extras,
            NULL::text AS previsto,
            NULL::text AS dia_falta,
            NULL::text AS horas_atraso,
            NULL::text AS abono,
            NULL::text AS desconta_dsr,
            NULL::text AS justificativas,
            NULL::text AS inconsistencia,
            NULL::text AS inconsistencia_tipo,
            NULL::text AS inconsistencia_status,
            NULL::text AS inconsistencia_justificativa,
            NULL::uuid AS justificativa_id,
            NULL::text AS justificativa_status,
            NULL::text AS justificativa_motivo,
            NULL::text AS justificativa_resposta,
            NULL::text AS justificativa_arquivo_url,
            NULL::text AS justificativa_arquivo_nome,
            NULL::timestamptz AS applied_at,
            NULL::timestamptz AS import_created_at
          FROM public.registros_ponto r
          WHERE r.funcionario_id = p_funcionario_id
            AND r.empresa_id = v.empresa_id
            AND NOT EXISTS (
              SELECT 1
              FROM public.ponto_import_linhas l
              JOIN public.ponto_importacoes i
                ON i.id = l.importacao_id AND i.empresa_id = l.empresa_id
              WHERE l.funcionario_id = r.funcionario_id
                AND l.data = r.data
                AND l.empresa_id = v.empresa_id
                AND i.status = 'aplicada'
            )
        )
        SELECT * FROM imported
        UNION ALL
        SELECT * FROM records_only
        ORDER BY data DESC
        LIMIT 180
      ) x
    ), '[]'::jsonb),
    'holerites', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.ano DESC, h.mes DESC) FROM (SELECT * FROM public.holerites h WHERE h.funcionario_id = p_funcionario_id AND h.empresa_id = v.empresa_id AND h.disponivel = true ORDER BY h.ano DESC, h.mes DESC LIMIT 6) h), '[]'::jsonb),
    'ferias', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.inicio DESC) FROM (SELECT * FROM public.rh_ferias x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.inicio DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb),
    'afastamentos', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.inicio DESC) FROM (SELECT * FROM public.rh_afastamentos x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.inicio DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb),
    'beneficios', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competencia DESC, x.created_at DESC) FROM (SELECT * FROM public.rh_beneficios_lancamentos x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.competencia DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb),
    'descontos', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competencia DESC, x.created_at DESC) FROM (SELECT * FROM public.rh_descontos_lancamentos x WHERE x.funcionario_id = p_funcionario_id AND x.empresa_id = v.empresa_id ORDER BY x.competencia DESC, x.created_at DESC LIMIT 60) x), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_admin_prontuario(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_prontuario(text, uuid) TO anon, authenticated;
