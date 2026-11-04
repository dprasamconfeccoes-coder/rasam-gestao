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
BEGIN
  SELECT * INTO v
  FROM public.app_tenant_usuario(p_token)
  LIMIT 1;

  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  IF p_inicio IS NULL OR p_fim IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe as datas inicial e final');
  END IF;

  IF p_inicio > p_fim THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A data inicial não pode ser posterior à data final');
  END IF;

  IF p_fim - p_inicio > 366 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione no máximo 367 dias');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'financeiro', jsonb_build_object(
      'receitas_realizadas', COALESCE((
        SELECT sum(l.valor)
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id
          AND l.tipo = 'receber'
          AND l.status = 'pago'
          AND COALESCE(l.pago_em, l.vencimento) BETWEEN p_inicio AND p_fim
      ), 0),
      'despesas_realizadas', COALESCE((
        SELECT sum(a.valor)
        FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status = 'pago'
          AND COALESCE(a.pago_em, a.vencimento) BETWEEN p_inicio AND p_fim
      ), 0),
      'recebiveis_com_vencimento', COALESCE((
        SELECT sum(l.valor)
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id
          AND l.tipo = 'receber'
          AND l.status IN ('pendente', 'vencido')
          AND l.vencimento BETWEEN p_inicio AND p_fim
      ), 0),
      'pagamentos_com_vencimento', COALESCE((
        SELECT sum(a.valor)
        FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status IN ('pendente', 'vencido')
          AND a.vencimento BETWEEN p_inicio AND p_fim
      ), 0)
    ),
    'ordens', (
      SELECT jsonb_build_object(
        'quantidade', count(*)::integer,
        'pecas', COALESCE(sum(o.quantidade), 0),
        'valor', COALESCE(sum(o.valor_total), 0)
      )
      FROM public.ordens_servico o
      WHERE o.empresa_id = v.empresa_id
        AND o.data_entrada BETWEEN p_inicio AND p_fim
    ),
    'producao', (
      SELECT jsonb_build_object(
        'ordens_com_evento', count(DISTINCT e.ordem_id)::integer,
        'produzidas', COALESCE(sum(e.unidades_produzidas_delta), 0),
        'costuradas', COALESCE(sum(e.unidades_costuradas_delta), 0),
        'entregues', COALESCE(sum(e.unidades_entregues_delta), 0)
      )
      FROM public.ordens_servico_producao_eventos e
      WHERE e.empresa_id = v.empresa_id
        AND e.created_at >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND e.created_at < ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    ),
    'ponto', (
      SELECT jsonb_build_object(
        'total', COALESCE(sum(x.quantidade), 0),
        'por_status', COALESCE(jsonb_agg(jsonb_build_object('status', x.status, 'quantidade', x.quantidade) ORDER BY x.status), '[]'::jsonb)
      )
      FROM (
        SELECT COALESCE(r.status, 'sem status') AS status, count(*)::integer AS quantidade
        FROM public.registros_ponto r
        JOIN public.funcionarios f ON f.id = r.funcionario_id
        WHERE f.empresa_id = v.empresa_id
          AND r.data BETWEEN p_inicio AND p_fim
        GROUP BY r.status
      ) x
    ),
    'inconsistencias_ponto', (
      SELECT jsonb_build_object(
        'total', count(*)::integer,
        'pendentes', count(*) FILTER (WHERE i.status = 'pendente')::integer
      )
      FROM public.ponto_inconsistencias i
      WHERE i.empresa_id = v.empresa_id
        AND i.data BETWEEN p_inicio AND p_fim
    ),
    'ausencias', jsonb_build_object(
      'ferias_sobrepostas', (
        SELECT count(*)::integer
        FROM public.rh_ferias f
        JOIN public.funcionarios x ON x.id = f.funcionario_id
        WHERE x.empresa_id = v.empresa_id
          AND COALESCE(f.fim, f.inicio) >= p_inicio
          AND f.inicio <= p_fim
      ),
      'ferias_iniciadas', (
        SELECT count(*)::integer
        FROM public.rh_ferias f
        JOIN public.funcionarios x ON x.id = f.funcionario_id
        WHERE x.empresa_id = v.empresa_id
          AND f.inicio BETWEEN p_inicio AND p_fim
      ),
      'afastamentos_sobrepostos', (
        SELECT count(*)::integer
        FROM public.rh_afastamentos a
        JOIN public.funcionarios x ON x.id = a.funcionario_id
        WHERE x.empresa_id = v.empresa_id
          AND COALESCE(a.fim, p_fim) >= p_inicio
          AND a.inicio <= p_fim
      ),
      'afastamentos_iniciados', (
        SELECT count(*)::integer
        FROM public.rh_afastamentos a
        JOIN public.funcionarios x ON x.id = a.funcionario_id
        WHERE x.empresa_id = v.empresa_id
          AND a.inicio BETWEEN p_inicio AND p_fim
      )
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) TO anon, authenticated;
