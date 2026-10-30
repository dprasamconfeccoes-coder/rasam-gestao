-- Painel de saúde financeira: lançamentos manuais e receitas previstas de ordens entregues.
-- Dívidas/parcelas do módulo Dívidas continuam fora deste fluxo.

CREATE OR REPLACE FUNCTION public.app_admin_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; v_hoje date := current_date;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;

  RETURN jsonb_build_object(
    'sucesso',true,
    'contas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento, x.created_at DESC),'[]'::jsonb)
      FROM (SELECT id,tipo,categoria,descricao,valor,vencimento,status,pago_em,observacoes,fonte_documento,created_at
            FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id
            ORDER BY vencimento,created_at DESC LIMIT 1000)x),
    'recorrencias',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.proximo_vencimento),'[]'::jsonb)
      FROM (SELECT id,descricao,categoria,fornecedor,valor,periodicidade,proximo_vencimento,ativo
            FROM public.financeiro_recorrencias WHERE empresa_id=v.empresa_id
            ORDER BY ativo DESC,proximo_vencimento LIMIT 300)x),
    'parcelas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb)
      FROM (SELECT p.id,p.numero,p.valor,p.vencimento,p.status,p.pago_em,p.comprovante_nome,p.fonte_documento,s.credor,s.descricao
            FROM public.financeiro_parcelas p JOIN public.financeiro_parcelamentos s ON s.id=p.parcelamento_id
            WHERE p.empresa_id=v.empresa_id
              AND NOT EXISTS (SELECT 1 FROM public.dividas_gestao d WHERE d.parcelamento_origem_id=s.id LIMIT 1)
            ORDER BY p.vencimento LIMIT 1000)x),
    'receitas_ordens',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST,x.numero),'[]'::jsonb)
      FROM (SELECT o.id,o.numero,o.descricao,o.status,o.status_pagamento,o.valor_total,o.prazo,
                   c.nome AS cliente_nome,
                   CASE WHEN o.status='entregue' AND o.status_pagamento='pendente' THEN 'prevista' ELSE 'recebida' END AS origem_status
            FROM public.ordens_servico o
            LEFT JOIN public.clientes c ON c.id=o.cliente_id
            WHERE o.empresa_id=v.empresa_id AND o.status <> 'cancelada'
              AND o.status IN ('entregue')
            ORDER BY o.prazo NULLS LAST,o.numero LIMIT 500)x),
    'resumo',jsonb_build_object(
      'despesas_pendentes',coalesce((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido')),0),
      'despesas_vencidas',coalesce((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento<v_hoje),0),
      'receitas_pendentes',coalesce((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status IN ('pendente','vencido')),0),
      'receitas_recebidas',coalesce((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status='pago'),0),
      'receitas_ordens_previstas',coalesce((SELECT sum(valor_total) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente'),0),
      'ordens_aguardando_pagamento',coalesce((SELECT count(*) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente'),0)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_salvar(
  p_token text, p_id uuid, p_tipo text, p_categoria text, p_descricao text,
  p_valor numeric, p_vencimento date, p_observacoes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v record; v_id uuid; v_tipo text;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  v_tipo:=lower(trim(coalesce(p_tipo,'')));
  IF v_tipo NOT IN ('pagar','receber') THEN RETURN jsonb_build_object('sucesso',false,'erro','Escolha despesa ou receita'); END IF;
  IF nullif(trim(coalesce(p_categoria,'')),'') IS NULL OR nullif(trim(coalesce(p_descricao,'')),'') IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Categoria e descrição são obrigatórias'); END IF;
  IF coalesce(p_valor,0)<=0 OR p_vencimento IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe um valor positivo e o vencimento'); END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.financeiro_lancamentos(empresa_id,tipo,categoria,descricao,valor,vencimento,status,observacoes,created_by)
    VALUES(v.empresa_id,v_tipo,trim(p_categoria),trim(p_descricao),p_valor,p_vencimento,'pendente',nullif(trim(coalesce(p_observacoes,'')),''),v.usuario_id)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.financeiro_lancamentos SET tipo=v_tipo,categoria=trim(p_categoria),descricao=trim(p_descricao),valor=p_valor,
      vencimento=p_vencimento,observacoes=nullif(trim(coalesce(p_observacoes,'')),'') ,updated_at=now()
      WHERE id=p_id AND empresa_id=v.empresa_id AND status <> 'pago' RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento não encontrado ou já pago'); END IF;
  END IF;
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_status(p_token text,p_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v record; v_status text; v_rows integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  v_status:=lower(trim(coalesce(p_status,'')));
  IF v_status NOT IN ('pendente','pago','cancelado') THEN RETURN jsonb_build_object('sucesso',false,'erro','Status inválido'); END IF;
  UPDATE public.financeiro_lancamentos SET status=v_status,pago_em=CASE WHEN v_status='pago' THEN coalesce(pago_em,current_date) ELSE NULL END,updated_at=now()
    WHERE id=p_id AND empresa_id=v.empresa_id AND status <> 'pago';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento não encontrado ou já pago'); END IF;
  RETURN jsonb_build_object('sucesso',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_excluir(p_token text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v record; v_rows integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  DELETE FROM public.financeiro_lancamentos WHERE id=p_id AND empresa_id=v.empresa_id AND status <> 'pago';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento não encontrado ou já pago'); END IF;
  RETURN jsonb_build_object('sucesso',true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_admin_financeiro(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_salvar(text,uuid,text,text,text,numeric,date,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_status(text,uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_excluir(text,uuid) TO anon,authenticated;
