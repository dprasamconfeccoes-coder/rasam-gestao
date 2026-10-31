-- Etapas 3 e 4: operação estruturada e relatórios financeiros.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_salvar(
  p_token text, p_id uuid, p_tipo text, p_categoria text, p_descricao text,
  p_valor numeric, p_vencimento date, p_observacoes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v record; v_id uuid; v_tipo text; v_categoria_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  v_tipo:=lower(trim(coalesce(p_tipo,'')));
  IF v_tipo NOT IN ('pagar','receber') THEN RETURN jsonb_build_object('sucesso',false,'erro','Escolha despesa ou receita'); END IF;
  IF nullif(trim(coalesce(p_categoria,'')),'') IS NULL OR nullif(trim(coalesce(p_descricao,'')),'') IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Categoria e descrição são obrigatórias'); END IF;
  IF coalesce(p_valor,0)<=0 OR p_vencimento IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe um valor positivo e o vencimento'); END IF;
  SELECT id INTO v_categoria_id FROM public.financeiro_categorias WHERE empresa_id=v.empresa_id AND lower(nome)=lower(trim(p_categoria)) AND ativa LIMIT 1;
  IF p_id IS NULL THEN
    INSERT INTO public.financeiro_lancamentos(empresa_id,tipo,categoria,categoria_id,descricao,valor,vencimento,competencia,status,origem,observacoes,created_by)
    VALUES(v.empresa_id,v_tipo,trim(p_categoria),v_categoria_id,trim(p_descricao),p_valor,p_vencimento,p_vencimento,'pendente','manual',nullif(trim(coalesce(p_observacoes,'')),''),v.usuario_id) RETURNING id INTO v_id;
  ELSE
    UPDATE public.financeiro_lancamentos SET tipo=v_tipo,categoria=trim(p_categoria),categoria_id=v_categoria_id,descricao=trim(p_descricao),valor=p_valor,vencimento=p_vencimento,competencia=COALESCE(competencia,p_vencimento),observacoes=nullif(trim(coalesce(p_observacoes,'')),''),updated_at=now()
    WHERE id=p_id AND empresa_id=v.empresa_id AND status <> 'pago' RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento não encontrado ou já pago'); END IF;
  END IF;
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
END;$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(
  p_token text,p_tipo text,p_categoria text,p_descricao text,p_valor numeric,p_primeiro_vencimento date,p_quantidade integer,p_periodicidade text,p_observacoes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v record; v_tipo text:=lower(trim(coalesce(p_tipo,''))); v_periodicidade text:=lower(trim(coalesce(p_periodicidade,''))); v_quantidade integer:=coalesce(p_quantidade,0); v_categoria_id uuid; v_serie_id uuid; v_count integer:=0; v_total numeric:=0;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  IF v_tipo NOT IN ('pagar','receber') THEN RETURN jsonb_build_object('sucesso',false,'erro','Escolha despesa ou receita'); END IF;
  IF nullif(trim(coalesce(p_categoria,'')),'') IS NULL OR nullif(trim(coalesce(p_descricao,'')),'') IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Categoria e descrição são obrigatórias'); END IF;
  IF coalesce(p_valor,0)<=0 OR p_primeiro_vencimento IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe um valor positivo e o primeiro vencimento'); END IF;
  IF v_quantidade<2 OR v_quantidade>120 THEN RETURN jsonb_build_object('sucesso',false,'erro','A série deve ter entre 2 e 120 lançamentos'); END IF;
  IF v_periodicidade NOT IN ('semanal','mensal','anual') THEN RETURN jsonb_build_object('sucesso',false,'erro','Periodicidade inválida'); END IF;
  SELECT id INTO v_categoria_id FROM public.financeiro_categorias WHERE empresa_id=v.empresa_id AND lower(nome)=lower(trim(p_categoria)) AND ativa LIMIT 1;
  INSERT INTO public.financeiro_series(empresa_id,tipo,descricao,categoria_id,valor_parcela,quantidade_parcelas,periodicidade,primeiro_vencimento,origem,observacoes,created_by)
  VALUES(v.empresa_id,v_tipo,trim(p_descricao),v_categoria_id,p_valor,v_quantidade,v_periodicidade,p_primeiro_vencimento,'manual',nullif(trim(coalesce(p_observacoes,'')),''),v.usuario_id) RETURNING id INTO v_serie_id;
  INSERT INTO public.financeiro_lancamentos(empresa_id,serie_id,parcela_numero,total_parcelas,tipo,categoria,categoria_id,descricao,valor,vencimento,competencia,status,origem,origem_id,observacoes,created_by)
  SELECT v.empresa_id,v_serie_id,n+1,v_quantidade,v_tipo,trim(p_categoria),v_categoria_id,trim(p_descricao),p_valor,
    CASE v_periodicidade WHEN 'semanal' THEN (p_primeiro_vencimento+(n*interval '7 days'))::date WHEN 'anual' THEN (p_primeiro_vencimento+make_interval(years=>n))::date ELSE (p_primeiro_vencimento+make_interval(months=>n))::date END,
    CASE v_periodicidade WHEN 'semanal' THEN (p_primeiro_vencimento+(n*interval '7 days'))::date WHEN 'anual' THEN (p_primeiro_vencimento+make_interval(years=>n))::date ELSE (p_primeiro_vencimento+make_interval(months=>n))::date END,
    'pendente','serie',v_serie_id,nullif(trim(coalesce(p_observacoes,'')),''),v.usuario_id
  FROM generate_series(0,v_quantidade-1) AS series(n);
  GET DIAGNOSTICS v_count=ROW_COUNT; v_total=p_valor*v_count;
  RETURN jsonb_build_object('sucesso',true,'quantidade',v_count,'valor_total',v_total,'serie_id',v_serie_id);
END;$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_relatorio(p_token text,p_tipo text,p_inicio date DEFAULT NULL,p_fim date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v record; v_inicio date:=COALESCE(p_inicio,date_trunc('month',current_date)::date); v_fim date:=COALESCE(p_fim,current_date); v_tipo text:=lower(trim(coalesce(p_tipo,'fluxo')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  IF v_tipo='fluxo' THEN RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.mes),'[]'::jsonb) FROM (SELECT date_trunc('month',COALESCE(l.competencia,l.vencimento))::date mes,COALESCE(sum(l.valor) FILTER(WHERE l.tipo='receber' AND l.status='pago'),0) receitas_recebidas,COALESCE(sum(l.valor) FILTER(WHERE l.tipo='pagar' AND l.status='pago'),0) despesas_pagas,COALESCE(sum(l.valor) FILTER(WHERE l.tipo='receber' AND l.status IN('pendente','vencido')),0) receitas_previstas,COALESCE(sum(l.valor) FILTER(WHERE l.tipo='pagar' AND l.status IN('pendente','vencido')),0) despesas_previstas FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND COALESCE(l.competencia,l.vencimento) BETWEEN v_inicio AND v_fim GROUP BY 1 ORDER BY 1 LIMIT 24)x)); END IF;
  IF v_tipo='categorias' THEN RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC),'[]'::jsonb) FROM (SELECT COALESCE(NULLIF(trim(categoria),''),'Sem categoria') categoria,sum(valor) valor,count(*)::integer quantidade FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status<>'cancelado' AND vencimento BETWEEN v_inicio AND v_fim GROUP BY 1 ORDER BY 2 DESC LIMIT 50)x)); END IF;
  IF v_tipo IN ('contas_pagar','contas_receber') THEN RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb) FROM (SELECT id,tipo,categoria,descricao,fornecedor,valor,competencia,vencimento,status,pago_em,origem,serie_id,parcela_numero,total_parcelas,observacoes FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo=CASE WHEN v_tipo='contas_pagar' THEN 'pagar' ELSE 'receber' END AND vencimento BETWEEN v_inicio AND v_fim ORDER BY vencimento LIMIT 500)x)); END IF;
  IF v_tipo='producao' THEN RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo),'[]'::jsonb) FROM (SELECT o.numero,o.descricao,c.nome cliente_nome,o.valor_total,o.status,o.status_pagamento,o.prazo FROM public.ordens_servico o LEFT JOIN public.clientes c ON c.id=o.cliente_id WHERE o.empresa_id=v.empresa_id AND o.status='entregue' AND o.prazo BETWEEN v_inicio AND v_fim ORDER BY o.prazo LIMIT 500)x)); END IF;
  RETURN jsonb_build_object('sucesso',false,'erro','Tipo de relatório inválido');
END;$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_salvar(text,uuid,text,text,text,numeric,date,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(text,text,text,text,numeric,date,integer,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_relatorio(text,text,date,date) TO anon,authenticated;
