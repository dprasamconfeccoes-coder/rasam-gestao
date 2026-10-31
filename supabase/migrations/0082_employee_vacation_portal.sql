-- Portal de férias: funcionários consultam somente o próprio histórico;
-- administradores podem consultar a empresa inteira ou um funcionário específico.
CREATE OR REPLACE FUNCTION public.app_listar_portal_ferias(
  p_token text,
  p_funcionario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_scope uuid;
  v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;
  IF v.perfil IN ('admin', 'administrador') THEN
    v_scope := p_funcionario_id;
  ELSE
    v_scope := v.funcionario_id;
    IF p_funcionario_id IS NOT NULL AND p_funcionario_id <> v.funcionario_id THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Você só pode consultar suas próprias férias');
    END IF;
  END IF;

  WITH periodos AS (
    SELECT h.funcionario_id, h.aquisitivo_inicio AS periodo_inicio, h.aquisitivo_fim AS periodo_fim,
           h.dias_direito, h.dias_gozados_relatorio, h.dias_restantes_relatorio,
           h.ferias_vencidas, h.limite_gozo
      FROM public.rh_ferias_programacao_historica h
     WHERE h.empresa_id = v.empresa_id
       AND h.funcionario_id IS NOT NULL
       AND (v_scope IS NULL OR h.funcionario_id = v_scope)
    UNION
    SELECT r.funcionario_id, r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim,
           NULL::numeric, 0::numeric, NULL::numeric, 0::integer, NULL::date
      FROM public.rh_ferias r
     WHERE r.empresa_id = v.empresa_id
       AND (v_scope IS NULL OR r.funcionario_id = v_scope)
  ), consolidado AS (
    SELECT
      p.funcionario_id,
      p.periodo_inicio,
      p.periodo_fim,
      max(p.dias_direito)::numeric AS dias_direito,
      max(p.dias_gozados_relatorio)::numeric AS dias_gozados_relatorio,
      max(p.dias_restantes_relatorio)::numeric AS dias_restantes_relatorio,
      max(p.ferias_vencidas)::integer AS ferias_vencidas,
      max(p.limite_gozo)::date AS limite_gozo,
      coalesce((SELECT sum(coalesce(r.dias_gozo, CASE WHEN r.inicio IS NOT NULL AND r.fim IS NOT NULL THEN (r.fim - r.inicio + 1) ELSE 0 END))::numeric
                  FROM public.rh_ferias r
                 WHERE r.empresa_id = v.empresa_id AND r.funcionario_id = p.funcionario_id
                   AND r.periodo_aquisitivo_inicio = p.periodo_inicio AND r.periodo_aquisitivo_fim = p.periodo_fim
                   AND r.status <> 'cancelada'), 0) AS dias_gozados_sistema,
      coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.inicio DESC NULLS LAST, x.created_at DESC)
                  FROM (SELECT r.id, r.inicio, r.fim, r.retorno_em, r.dias_gozo, r.status, r.observacoes, r.created_at
                          FROM public.rh_ferias r
                         WHERE r.empresa_id = v.empresa_id AND r.funcionario_id = p.funcionario_id
                           AND r.periodo_aquisitivo_inicio = p.periodo_inicio AND r.periodo_aquisitivo_fim = p.periodo_fim
                           AND r.status <> 'cancelada'
                         LIMIT 20) x), '[]'::jsonb) AS usufrutos,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'arquivo_nome', d.arquivo_nome) ORDER BY d.created_at DESC)
                  FROM public.rh_ferias_documentos d
                 WHERE d.empresa_id = v.empresa_id AND d.funcionario_id = p.funcionario_id
                   AND d.ferias_id IN (SELECT r.id FROM public.rh_ferias r WHERE r.empresa_id = v.empresa_id AND r.funcionario_id = p.funcionario_id AND r.periodo_aquisitivo_inicio = p.periodo_inicio AND r.periodo_aquisitivo_fim = p.periodo_fim)
                   AND d.storage_path IS NOT NULL), '[]'::jsonb) AS documentos
    FROM periodos p
    GROUP BY p.funcionario_id, p.periodo_inicio, p.periodo_fim
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome, x.periodo_fim DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT c.funcionario_id, f.nome, f.cpf, f.cargo, f.avatar_url, f.data_admissao,
           c.periodo_inicio, c.periodo_fim, c.dias_direito, c.dias_gozados_relatorio,
           c.dias_restantes_relatorio, c.ferias_vencidas, c.limite_gozo,
           c.dias_gozados_sistema,
           greatest(coalesce(c.dias_direito, 30) - coalesce(c.dias_gozados_relatorio, 0) - c.dias_gozados_sistema, 0) AS dias_disponiveis,
           greatest(coalesce(c.dias_gozados_relatorio, 0) + c.dias_gozados_sistema - coalesce(c.dias_direito, 30), 0) AS dias_excedentes,
           c.usufrutos, c.documentos,
           CASE WHEN coalesce(c.dias_gozados_relatorio, 0) + c.dias_gozados_sistema >= coalesce(c.dias_direito, 30) THEN 'utilizado'
                WHEN c.periodo_fim < current_date THEN 'vencido'
                ELSE 'disponivel' END AS situacao
      FROM consolidado c
      JOIN public.funcionarios f ON f.id = c.funcionario_id
     WHERE f.empresa_id = v.empresa_id
     LIMIT 1000
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'ferias', v_rows, 'escopo', CASE WHEN v_scope IS NULL THEN 'empresa' ELSE 'individual' END, 'funcionario_id', v_scope);
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_listar_portal_ferias(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_ferias_documento_path(p_token text, p_documento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v record; d record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); END IF;
  SELECT id, storage_path, arquivo_nome, mime_type, funcionario_id
    INTO d FROM public.rh_ferias_documentos
   WHERE id = p_documento_id AND empresa_id = v.empresa_id AND storage_path IS NOT NULL LIMIT 1;
  IF d.id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento privado não encontrado'); END IF;
  IF v.perfil NOT IN ('admin', 'administrador') AND d.funcionario_id <> v.funcionario_id THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Você não tem acesso a este documento');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'caminho', d.storage_path, 'nome', d.arquivo_nome, 'mime_type', d.mime_type);
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_admin_ferias_documento_path(text, uuid) TO service_role;
