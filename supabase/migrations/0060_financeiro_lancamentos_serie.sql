-- Série de lançamentos financeiros: uma operação atômica para contratos mensais,
-- anuais ou semanais, sempre limitada ao tenant e a perfis administrativos.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(
  p_token text,
  p_tipo text,
  p_categoria text,
  p_descricao text,
  p_valor numeric,
  p_primeiro_vencimento date,
  p_quantidade integer,
  p_periodicidade text,
  p_observacoes text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v record;
  v_tipo text := lower(trim(coalesce(p_tipo,'')));
  v_periodicidade text := lower(trim(coalesce(p_periodicidade,'')));
  v_quantidade integer := coalesce(p_quantidade,0);
  v_count integer := 0;
  v_total numeric := 0;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF v_tipo NOT IN ('pagar','receber') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Escolha despesa ou receita');
  END IF;
  IF nullif(trim(coalesce(p_categoria,'')),'') IS NULL OR nullif(trim(coalesce(p_descricao,'')),'') IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Categoria e descrição são obrigatórias');
  END IF;
  IF coalesce(p_valor,0) <= 0 OR p_primeiro_vencimento IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Informe um valor positivo e o primeiro vencimento');
  END IF;
  IF v_quantidade < 2 OR v_quantidade > 120 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A série deve ter entre 2 e 120 lançamentos');
  END IF;
  IF v_periodicidade NOT IN ('semanal','mensal','anual') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Periodicidade inválida');
  END IF;

  INSERT INTO public.financeiro_lancamentos(
    empresa_id,tipo,categoria,descricao,valor,vencimento,status,observacoes,created_by
  )
  SELECT
    v.empresa_id,
    v_tipo,
    trim(p_categoria),
    trim(p_descricao),
    p_valor,
    CASE v_periodicidade
      WHEN 'semanal' THEN (p_primeiro_vencimento + (n * interval '7 days'))::date
      WHEN 'anual' THEN (p_primeiro_vencimento + make_interval(years => n))::date
      ELSE (p_primeiro_vencimento + make_interval(months => n))::date
    END,
    'pendente',
    concat(
      nullif(trim(coalesce(p_observacoes,'')),''),
      CASE WHEN nullif(trim(coalesce(p_observacoes,'')),'') IS NULL THEN '' ELSE ' · ' END,
      'Série de ', v_quantidade, ' lançamentos · ', n + 1, '/', v_quantidade,
      ' · ', initcap(v_periodicidade)
    ),
    v.usuario_id
  FROM generate_series(0, v_quantidade - 1) AS series(n);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := p_valor * v_count;
  RETURN jsonb_build_object('sucesso',true,'quantidade',v_count,'valor_total',v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(text,text,text,text,numeric,date,integer,text,text) TO anon,authenticated;
