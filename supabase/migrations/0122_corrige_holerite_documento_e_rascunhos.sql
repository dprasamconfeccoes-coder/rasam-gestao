-- Corrige o acesso ao documento privado e evita ocultar totais de rascunhos.
-- Não altera os totais oficiais: o resumo continua somando somente confirmados.

BEGIN;

CREATE OR REPLACE FUNCTION public.app_holerite_documento_path(
  p_token text,
  p_holerite_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_holerite record;
BEGIN
  SELECT * INTO v_usuario
    FROM public.app_tenant_usuario(p_token)
   LIMIT 1;

  IF v_usuario.usuario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;

  SELECT hol.id, hol.storage_path, hol.arquivo_nome, hol.mime_type, hol.funcionario_id
    INTO v_holerite
    FROM public.holerites AS hol
   WHERE hol.id = p_holerite_id
     AND hol.empresa_id = v_usuario.empresa_id
     AND hol.disponivel = true
   LIMIT 1;

  IF v_holerite.id IS NULL OR v_holerite.storage_path IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Holerite privado não encontrado');
  END IF;

  IF v_usuario.perfil NOT IN ('gestor', 'administrador', 'admin')
     AND v_holerite.funcionario_id <> v_usuario.funcionario_id THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Você não tem acesso a este holerite');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'caminho', v_holerite.storage_path,
    'nome', v_holerite.arquivo_nome,
    'mime_type', v_holerite.mime_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_holerite_documento_path(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_folha_escritorio_listar(
  p_token text,
  p_competencia text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_inicio date;
  v_fim date;
  v_elegiveis integer;
  v_confirmados integer;
  v_rascunhos integer;
  v_funcionarios jsonb;
  v_total_vencimentos numeric;
  v_total_descontos numeric;
  v_valor_liquido numeric;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;

  IF v_usuario.usuario_id IS NULL
     OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência inválida');
  END IF;

  v_inicio := to_date(p_competencia || '-01', 'YYYY-MM-DD');
  v_fim := (v_inicio + interval '1 month - 1 day')::date;

  WITH elegiveis AS (
    SELECT
      f.id AS funcionario_id,
      f.nome,
      f.cargo,
      r.id AS registro_id,
      coalesce(r.holerite_id, latest.id) AS holerite_id,
      r.status,
      r.salario_base,
      r.base_inss,
      r.base_fgts,
      r.fgts_mes,
      r.base_irrf,
      r.faixa_irrf,
      r.total_vencimentos,
      r.total_descontos,
      r.valor_liquido,
      coalesce(h.arquivo_nome, latest.arquivo_nome) AS arquivo_nome,
      coalesce(h.mime_type, latest.mime_type) AS mime_type,
      CASE
        WHEN r.holerite_id IS NOT NULL
          THEN coalesce(h.disponivel, false) AND nullif(btrim(h.storage_path), '') IS NOT NULL
        ELSE coalesce(latest.disponivel, false) AND nullif(btrim(latest.storage_path), '') IS NOT NULL
      END AS documento_disponivel
    FROM public.funcionarios AS f
    LEFT JOIN public.folha_escritorio_registros AS r
      ON r.empresa_id = f.empresa_id
     AND r.funcionario_id = f.id
     AND r.competencia = p_competencia
    LEFT JOIN public.holerites AS h
      ON h.id = r.holerite_id
     AND h.empresa_id = f.empresa_id
    LEFT JOIN LATERAL (
      SELECT h2.id, h2.arquivo_nome, h2.mime_type, h2.disponivel, h2.storage_path
      FROM public.holerites AS h2
      WHERE h2.empresa_id = f.empresa_id
        AND h2.funcionario_id = f.id
        AND h2.mes = extract(month FROM v_inicio)::int
        AND h2.ano = extract(year FROM v_inicio)::int
      ORDER BY h2.created_at DESC
      LIMIT 1
    ) AS latest ON true
    WHERE f.empresa_id = v_usuario.empresa_id
      AND coalesce(f.ativo, false)
      AND coalesce(f.elegivel_holerite, f.tipo_vinculo = 'formal')
      AND (f.data_admissao IS NULL OR f.data_admissao <= v_fim)
      AND (coalesce(f.data_saida, f.data_demissao) IS NULL OR coalesce(f.data_saida, f.data_demissao) >= v_inicio)
    ORDER BY f.nome
    LIMIT 1000
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'confirmado')::int,
    count(*) FILTER (WHERE status = 'rascunho')::int,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'funcionario_id', e.funcionario_id,
        'nome', e.nome,
        'cargo', e.cargo,
        'status', coalesce(e.status, 'pendente'),
        'registro_id', e.registro_id,
        'holerite_id', e.holerite_id,
        'arquivo_nome', e.arquivo_nome,
        'mime_type', e.mime_type,
        'documento_disponivel', coalesce(e.documento_disponivel, false),
        'salario_base', e.salario_base,
        'base_inss', e.base_inss,
        'base_fgts', e.base_fgts,
        'fgts_mes', e.fgts_mes,
        'base_irrf', e.base_irrf,
        'faixa_irrf', e.faixa_irrf,
        'total_vencimentos', e.total_vencimentos,
        'total_descontos', e.total_descontos,
        'valor_liquido', e.valor_liquido,
        'itens', coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'ordem', i.ordem,
              'codigo', i.codigo,
              'descricao', i.descricao,
              'referencia', i.referencia,
              'tipo', i.tipo,
              'valor', i.valor
            ) ORDER BY i.ordem
          )
          FROM public.folha_escritorio_itens AS i
          WHERE i.registro_id = e.registro_id
        ), '[]'::jsonb)
      ) ORDER BY e.nome
    ), '[]'::jsonb),
    coalesce(sum(e.total_vencimentos) FILTER (WHERE e.status = 'confirmado'), 0),
    coalesce(sum(e.total_descontos) FILTER (WHERE e.status = 'confirmado'), 0),
    coalesce(sum(e.valor_liquido) FILTER (WHERE e.status = 'confirmado'), 0)
  INTO v_elegiveis, v_confirmados, v_rascunhos, v_funcionarios,
       v_total_vencimentos, v_total_descontos, v_valor_liquido
  FROM elegiveis AS e;

  RETURN jsonb_build_object(
    'sucesso', true,
    'competencia', p_competencia,
    'funcionarios_elegiveis', v_elegiveis,
    'confirmados', v_confirmados,
    'rascunhos', v_rascunhos,
    'pendentes', v_elegiveis - v_confirmados - v_rascunhos,
    'status_competencia', CASE
      WHEN v_elegiveis = 0 THEN 'sem_vinculos'
      WHEN v_confirmados = v_elegiveis THEN 'completa'
      WHEN v_confirmados = 0 THEN 'sem_oficiais'
      ELSE 'parcial'
    END,
    'total_vencimentos_oficiais', v_total_vencimentos,
    'total_descontos_oficiais', v_total_descontos,
    'valor_liquido_oficial', v_valor_liquido,
    'funcionarios', v_funcionarios
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_admin_folha_escritorio_listar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_folha_escritorio_listar(text, text) TO anon, authenticated;

COMMIT;
