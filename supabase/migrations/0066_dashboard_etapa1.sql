-- Etapa 1: Visão Geral com funil operacional, comparativos e prioridades.
-- Visão Geral profissional por perfil: executivo para gestão e pessoal para funcionários.
CREATE OR REPLACE FUNCTION public.app_dashboard_v2(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $function$
DECLARE v record; v_empresa_id uuid; v_ind jsonb; v_alertas jsonb; v_pessoal jsonb; v_funil jsonb; v_comparativos jsonb; v_inicio date := date_trunc('month', current_date)::date; v_fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
BEGIN
  SELECT * INTO v FROM public.app_usuario_por_token(p_token) LIMIT 1;
  IF v.usuario_id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Sessão inválida'); END IF;
  SELECT empresa_id INTO v_empresa_id FROM public.funcionarios WHERE id = v.funcionario_id LIMIT 1;
  IF v.perfil = 'funcionario' THEN
    v_pessoal := jsonb_build_object(
      'ponto_sem_justificativa', (SELECT count(*)::int FROM public.registros_ponto r WHERE r.funcionario_id=v.funcionario_id AND r.data BETWEEN v_inicio AND v_fim AND r.status IN ('falta','inconsistente')),
      'atestados_em_analise', (SELECT count(*)::int FROM public.atestados a WHERE a.funcionario_id=v.funcionario_id AND a.status IN ('aguardando','pendente','em_analise')),
      'solicitacoes_abertas', (SELECT count(*)::int FROM public.rh_solicitacoes s WHERE s.funcionario_id=v.funcionario_id AND s.status IN ('pendente','em_analise')),
      'avisos_nao_lidos', (SELECT count(*)::int FROM public.rh_avisos a WHERE a.status='publicado' AND NOT EXISTS (SELECT 1 FROM public.rh_avisos_leituras l WHERE l.aviso_id=a.id AND l.funcionario_id=v.funcionario_id)),
      'holerites_disponiveis', (SELECT count(*)::int FROM public.holerites h WHERE h.funcionario_id=v.funcionario_id AND h.disponivel=true)
    );
    RETURN jsonb_build_object('sucesso',true,'perfil',v.perfil,'nome',v.nome,'cargo',coalesce(v.cargo,''),'modo','pessoal','indicadores',jsonb_build_object('funcionarios_ativos',0,'em_ferias',0,'em_afastamento',0,'ordens_ativas',0,'lotes_em_costura',0,'contas_pendentes',0,'saldo_dividas',0),'pessoal',v_pessoal,'alertas','[]'::jsonb,'funil',jsonb_build_object(),'comparativos',jsonb_build_object());
  END IF;
  v_funil := jsonb_build_object(
    'recebidas',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status='recebida'),
    'em_producao',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status='em_producao'),
    'costuradas',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status='costurada'),
    'entregues',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status='entregue'),
    'pagas',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status_pagamento='pago')
  );
  v_comparativos := jsonb_build_object(
    'ordens_entrada_mes',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND data_entrada >= date_trunc('month', current_date)::date),
    'ordens_entrada_mes_anterior',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND data_entrada >= (date_trunc('month', current_date)-interval '1 month')::date AND data_entrada < date_trunc('month', current_date)::date),
    'ponto_inconsistencias_mes',(SELECT count(*)::int FROM public.registros_ponto r JOIN public.funcionarios f ON f.id=r.funcionario_id WHERE f.empresa_id=v_empresa_id AND r.data BETWEEN v_inicio AND v_fim AND r.status IN ('falta','inconsistente')),
    'ponto_inconsistencias_mes_anterior',(SELECT count(*)::int FROM public.registros_ponto r JOIN public.funcionarios f ON f.id=r.funcionario_id WHERE f.empresa_id=v_empresa_id AND r.data >= (date_trunc('month', current_date)-interval '1 month')::date AND r.data < v_inicio AND r.status IN ('falta','inconsistente'))
  );
  v_ind := jsonb_build_object(
    'funcionarios_ativos',(SELECT count(*)::int FROM public.funcionarios WHERE empresa_id=v_empresa_id AND ativo=true),
    'em_ferias',(SELECT count(*)::int FROM public.rh_ferias f JOIN public.funcionarios x ON x.id=f.funcionario_id WHERE x.empresa_id=v_empresa_id AND f.status IN ('agendada','em_gozo') AND (f.inicio IS NULL OR f.inicio<=current_date) AND (f.fim IS NULL OR f.fim>=current_date)),
    'em_afastamento',(SELECT count(*)::int FROM public.rh_afastamentos a JOIN public.funcionarios x ON x.id=a.funcionario_id WHERE x.empresa_id=v_empresa_id AND a.status='ativo' AND a.inicio<=current_date AND (a.fim IS NULL OR a.fim>=current_date)),
    'ordens_ativas',(SELECT count(*)::int FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status IN ('recebida','em_producao','costurada')),
    'lotes_em_costura',(SELECT count(*)::int FROM public.producao_lotes l JOIN public.ordens_servico o ON o.id=l.ordem_id WHERE o.empresa_id=v_empresa_id AND l.status='em_costura'),
    'contas_pendentes',(SELECT count(*)::int FROM public.financeiro_lancamentos WHERE empresa_id=v_empresa_id AND status IN ('pendente','vencido')),
    'saldo_dividas',coalesce((SELECT sum(saldo_devedor) FROM public.dividas_gestao WHERE empresa_id=v_empresa_id AND status NOT IN ('quitada','inativa')),0)
  );
  v_alertas := (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.ordem),'[]'::jsonb) FROM (
    SELECT 'financeiro-vencido' id, 'Contas vencidas' titulo, count(*)::int valor, 'Regularize os compromissos vencidos do financeiro.' detalhe, 'urgente' prioridade, 'financeiro' destino, 1 ordem FROM public.financeiro_lancamentos WHERE empresa_id=v_empresa_id AND status='vencido'
    UNION ALL SELECT 'ordens-prazo','Ordens vencendo em 7 dias',count(*)::int,'Confirme capacidade e prazo de entrega das ordens.','atencao','ordens',2 FROM public.ordens_servico WHERE empresa_id=v_empresa_id AND status NOT IN ('entregue','cancelada') AND prazo BETWEEN current_date AND current_date+7
    UNION ALL SELECT 'lotes-costura','Lotes em costura',count(*)::int,'Acompanhe a produção e os lotes próximos da entrega.','informacao','producao',3 FROM public.producao_lotes l JOIN public.ordens_servico o ON o.id=l.ordem_id WHERE o.empresa_id=v_empresa_id AND l.status='em_costura'
    UNION ALL SELECT 'atestados-rh','Atestados aguardando análise',count(*)::int,'Há documentos de saúde aguardando decisão do RH.','atencao','rh',4 FROM public.atestados a WHERE a.empresa_id=v_empresa_id AND a.status IN ('aguardando','pendente','em_analise')
    UNION ALL SELECT 'solicitacoes-rh','Solicitações ao RH em aberto',count(*)::int,'Revise pedidos dos funcionários e registre uma resposta.','atencao','rh',5 FROM public.rh_solicitacoes s JOIN public.funcionarios f ON f.id=s.funcionario_id WHERE f.empresa_id=v_empresa_id AND s.status IN ('pendente','em_analise')
    UNION ALL SELECT 'ponto-inconsistente','Inconsistências de ponto',count(*)::int,'Corrija registros antes do fechamento da competência.','atencao','importacoes',6 FROM public.registros_ponto r JOIN public.funcionarios f ON f.id=r.funcionario_id WHERE f.empresa_id=v_empresa_id AND r.data BETWEEN v_inicio AND v_fim AND r.status IN ('falta','inconsistente')
  ) x);
  RETURN jsonb_build_object('sucesso',true,'perfil',v.perfil,'nome',v.nome,'cargo',coalesce(v.cargo,''),'modo','executivo','indicadores',v_ind,'pessoal',jsonb_build_object(),'alertas',v_alertas,'funil',v_funil,'comparativos',v_comparativos);
END;$function$;
GRANT EXECUTE ON FUNCTION public.app_dashboard_v2(text) TO anon,authenticated;
