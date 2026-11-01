-- Relatórios fabris por evento e por tamanho/lote; corrigem períodos sem efeito
-- e a participação fixa da DRE. Aplicar primeiro em homologação.

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_relatorio(
  p_token text,
  p_tipo text,
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v record;
  v_inicio date := COALESCE(p_inicio, date_trunc('month', current_date)::date);
  v_fim date := COALESCE(p_fim, current_date);
  v_tipo text := lower(trim(COALESCE(p_tipo, 'fluxo')));
  v_linhas jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF v_inicio > v_fim THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A data inicial não pode ser posterior à data final');
  END IF;

  IF v_tipo = 'fluxo' THEN
    RETURN jsonb_build_object(
      'sucesso', true, 'tipo', v_tipo, 'inicio', v_inicio, 'fim', v_fim,
      'linhas', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.mes), '[]'::jsonb)
        FROM (SELECT date_trunc('month', COALESCE(l.competencia,l.vencimento))::date mes,
          COALESCE(sum(l.valor) FILTER (WHERE l.tipo='receber' AND l.status='pago'),0) receitas_recebidas,
          COALESCE(sum(l.valor) FILTER (WHERE l.tipo='pagar' AND l.status='pago'),0) despesas_pagas,
          COALESCE(sum(l.valor) FILTER (WHERE l.tipo='receber' AND l.status IN ('pendente','vencido')),0) receitas_previstas,
          COALESCE(sum(l.valor) FILTER (WHERE l.tipo='pagar' AND l.status IN ('pendente','vencido')),0) despesas_previstas
          FROM public.financeiro_lancamentos l
          WHERE l.empresa_id=v.empresa_id AND COALESCE(l.competencia,l.vencimento) BETWEEN v_inicio AND v_fim
          GROUP BY 1 ORDER BY 1 LIMIT 24) x)
    );
  END IF;

  IF v_tipo = 'categorias' THEN
    RETURN jsonb_build_object(
      'sucesso', true, 'tipo', v_tipo, 'inicio', v_inicio, 'fim', v_fim,
      'linhas', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC), '[]'::jsonb)
        FROM (SELECT COALESCE(NULLIF(trim(categoria),''),'Sem categoria') categoria,
          sum(valor) valor, count(*)::integer quantidade
          FROM public.financeiro_lancamentos
          WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status<>'cancelado'
            AND vencimento BETWEEN v_inicio AND v_fim
          GROUP BY 1 ORDER BY 2 DESC LIMIT 50) x)
    );
  END IF;

  IF v_tipo IN ('contas_pagar','contas_receber') THEN
    RETURN jsonb_build_object(
      'sucesso', true, 'tipo', v_tipo, 'inicio', v_inicio, 'fim', v_fim,
      'linhas', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento), '[]'::jsonb)
        FROM (SELECT id,tipo,categoria,descricao,fornecedor,valor,competencia,vencimento,status,pago_em,
          origem,serie_id,parcela_numero,total_parcelas,observacoes
          FROM public.financeiro_lancamentos
          WHERE empresa_id=v.empresa_id
            AND tipo=CASE WHEN v_tipo='contas_pagar' THEN 'pagar' ELSE 'receber' END
            AND vencimento BETWEEN v_inicio AND v_fim
          ORDER BY vencimento LIMIT 500) x)
    );
  END IF;

  IF v_tipo = 'producao' THEN
    RETURN jsonb_build_object(
      'sucesso', true, 'tipo', v_tipo, 'inicio', v_inicio, 'fim', v_fim,
      'linhas', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo), '[]'::jsonb)
        FROM (SELECT o.numero,o.descricao,c.nome cliente_nome,o.valor_total,o.status,o.status_pagamento,o.prazo
          FROM public.ordens_servico o
          LEFT JOIN public.clientes c ON c.id=o.cliente_id AND c.empresa_id=v.empresa_id
          WHERE o.empresa_id=v.empresa_id AND o.status='entregue' AND o.prazo BETWEEN v_inicio AND v_fim
          ORDER BY o.prazo LIMIT 500) x)
    );
  END IF;

  IF v_tipo = 'dre' THEN
    WITH base AS (
      SELECT 1 ordem, 'Receitas realizadas'::text grupo,
        COALESCE(sum(valor),0)::numeric valor
      FROM public.financeiro_lancamentos
      WHERE empresa_id=v.empresa_id AND tipo='receber' AND status='pago'
        AND COALESCE(pago_em,vencimento) BETWEEN v_inicio AND v_fim
      UNION ALL
      SELECT 2, 'Receitas previstas', COALESCE(sum(valor),0)::numeric
      FROM public.financeiro_lancamentos
      WHERE empresa_id=v.empresa_id AND tipo='receber' AND status IN ('pendente','vencido')
        AND vencimento BETWEEN v_inicio AND v_fim
      UNION ALL
      SELECT 3, 'Despesas pagas', COALESCE(sum(valor),0)::numeric
      FROM public.financeiro_lancamentos
      WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status='pago'
        AND COALESCE(pago_em,vencimento) BETWEEN v_inicio AND v_fim
      UNION ALL
      SELECT 4, 'Despesas previstas', COALESCE(sum(valor),0)::numeric
      FROM public.financeiro_lancamentos
      WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido')
        AND vencimento BETWEEN v_inicio AND v_fim
    ), totais AS (
      SELECT COALESCE(sum(valor) FILTER (WHERE grupo IN ('Receitas realizadas','Receitas previstas')),0)::numeric total_receitas
      FROM base
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'grupo',base.grupo,
      'valor',base.valor,
      'participacao',CASE WHEN totais.total_receitas > 0
        THEN round(base.valor / totais.total_receitas * 100,1) ELSE 0 END
    ) ORDER BY base.ordem),'[]'::jsonb)
    INTO v_linhas
    FROM base CROSS JOIN totais;
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'linhas',v_linhas);
  END IF;

  IF v_tipo = 'inadimplencia' THEN
    WITH atrasos AS (
      SELECT v_fim-l.vencimento dias_atraso,l.valor
      FROM public.financeiro_lancamentos l
      WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido')
        AND l.vencimento BETWEEN v_inicio AND v_fim AND l.vencimento < v_fim
    ), faixas AS (
      SELECT 1 ordem,'1 a 7 dias' faixa,count(*) FILTER (WHERE dias_atraso BETWEEN 1 AND 7)::integer quantidade,
        COALESCE(sum(valor) FILTER (WHERE dias_atraso BETWEEN 1 AND 7),0) valor FROM atrasos
      UNION ALL
      SELECT 2,'8 a 30 dias',count(*) FILTER (WHERE dias_atraso BETWEEN 8 AND 30)::integer quantidade,
        COALESCE(sum(valor) FILTER (WHERE dias_atraso BETWEEN 8 AND 30),0) valor FROM atrasos
      UNION ALL
      SELECT 3,'31 a 60 dias',count(*) FILTER (WHERE dias_atraso BETWEEN 31 AND 60)::integer quantidade,
        COALESCE(sum(valor) FILTER (WHERE dias_atraso BETWEEN 31 AND 60),0) valor FROM atrasos
      UNION ALL
      SELECT 4,'Mais de 60 dias',count(*) FILTER (WHERE dias_atraso > 60)::integer quantidade,
        COALESCE(sum(valor) FILTER (WHERE dias_atraso > 60),0) valor FROM atrasos
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) INTO v_linhas FROM faixas f;
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'data_corte',v_fim,'linhas',v_linhas);
  END IF;

  IF v_tipo = 'recorrencias' THEN
    RETURN jsonb_build_object(
      'sucesso', true, 'tipo', v_tipo, 'inicio', v_inicio, 'fim', v_fim,
      'linhas', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.proximo_vencimento), '[]'::jsonb)
        FROM (SELECT descricao,categoria,fornecedor,periodicidade,valor,
          CASE periodicidade WHEN 'anual' THEN valor WHEN 'semanal' THEN valor*52 ELSE valor*12 END projecao_anual,
          proximo_vencimento
          FROM public.financeiro_recorrencias
          WHERE empresa_id=v.empresa_id AND ativo AND proximo_vencimento BETWEEN v_inicio AND v_fim
          ORDER BY proximo_vencimento LIMIT 300) x)
    );
  END IF;

  IF v_tipo = 'orcamento' THEN
    RETURN jsonb_build_object(
      'sucesso', true, 'tipo', v_tipo, 'inicio', v_inicio, 'fim', v_fim,
      'linhas', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.orcado DESC), '[]'::jsonb)
        FROM (SELECT categoria,round(sum(orcado),2) orcado,round(sum(realizado),2) realizado,
          round(sum(orcado)-sum(realizado),2) desvio,
          CASE WHEN sum(orcado)>0 THEN round(sum(realizado)/sum(orcado)*100,1) ELSE 0 END execucao
          FROM (
            SELECT categoria,valor_orcado orcado,0::numeric realizado
            FROM public.financeiro_orcamentos WHERE empresa_id=v.empresa_id AND competencia BETWEEN v_inicio AND v_fim
            UNION ALL
            SELECT COALESCE(NULLIF(trim(categoria),''),'Sem categoria'),0::numeric,sum(valor)
            FROM public.financeiro_lancamentos
            WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status='pago'
              AND COALESCE(competencia,vencimento) BETWEEN v_inicio AND v_fim
            GROUP BY categoria
          ) s GROUP BY categoria ORDER BY 2 DESC LIMIT 100) x)
    );
  END IF;

  RETURN jsonb_build_object('sucesso',false,'erro','Tipo de relatório inválido');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_relatorio(text,text,date,date) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_relatorio_operacional(
  p_token text,
  p_tipo text,
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v record;
  v_inicio date := COALESCE(p_inicio, date_trunc('month',current_date)::date);
  v_fim date := COALESCE(p_fim,current_date);
  v_tipo text := lower(trim(COALESCE(p_tipo,'')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF v_inicio > v_fim THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A data inicial não pode ser posterior à data final');
  END IF;
  IF v_tipo='producao_fluxo_diario' AND v_fim-v_inicio > 366 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Selecione no máximo 367 dias para o fluxo fabril diário');
  END IF;

  IF v_tipo='producao_fluxo_diario' THEN
    RETURN jsonb_build_object(
      'sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(
        WITH dias AS (
          SELECT generate_series(v_inicio::timestamp,v_fim::timestamp,interval '1 day')::date dia
        ), eventos AS (
          SELECT (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date dia,
            count(DISTINCT e.ordem_id)::bigint ordens_com_evento,
            COALESCE(sum(e.unidades_produzidas_delta),0) produzidas,
            COALESCE(sum(e.unidades_costuradas_delta),0) costuradas,
            COALESCE(sum(e.unidades_entregues_delta),0) entregues
          FROM public.ordens_servico_producao_eventos e
          WHERE e.empresa_id=v.empresa_id
            AND e.created_at >= (v_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND e.created_at < ((v_fim+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          GROUP BY (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'data',d.dia,
          'ordens_com_evento',COALESCE(e.ordens_com_evento,0),
          'produzidas',COALESCE(e.produzidas,0),
          'costuradas',COALESCE(e.costuradas,0),
          'entregues',COALESCE(e.entregues,0)
        ) ORDER BY d.dia),'[]'::jsonb)
        FROM dias d LEFT JOIN eventos e ON e.dia=d.dia
      )
    );
  END IF;

  IF v_tipo='controle_tamanhos_lotes' THEN
    RETURN jsonb_build_object(
      'sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'totais',(SELECT jsonb_build_object(
        'solicitadas',COALESCE(sum(s.quantidade),0),
        'produzidas',COALESCE(sum(s.quantidade_produzida),0),
        'costuradas',COALESCE(sum(s.quantidade_costurada),0),
        'entregues',COALESCE(sum(s.quantidade_entregue),0),
        'faltam_produzir',COALESCE(sum(GREATEST(s.quantidade-s.quantidade_produzida,0)),0),
        'faltam_costurar',COALESCE(sum(GREATEST(s.quantidade_produzida-s.quantidade_costurada,0)),0),
        'faltam_entregar',COALESCE(sum(GREATEST(s.quantidade_costurada-s.quantidade_entregue,0)),0)
      )
      FROM public.ordens_servico o
      JOIN public.ordens_servico_tamanhos s ON s.ordem_id=o.id AND s.empresa_id=v.empresa_id
      WHERE o.empresa_id=v.empresa_id AND o.status<>'cancelada' AND o.data_entrada BETWEEN v_inicio AND v_fim),
      'limite',2000,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST,x.numero,x.tamanho),'[]'::jsonb)
        FROM (
          SELECT s.id,o.numero,COALESCE(NULLIF(o.cliente_nome,''),c.nome,'Cliente não informado') cliente,
            o.descricao,o.status,o.prioridade,o.prazo,s.tamanho,
            s.quantidade solicitadas,s.quantidade_produzida produzidas,
            s.quantidade_costurada costuradas,s.quantidade_entregue entregues,
            GREATEST(s.quantidade-s.quantidade_produzida,0) faltam_produzir,
            GREATEST(s.quantidade_produzida-s.quantidade_costurada,0) faltam_costurar,
            GREATEST(s.quantidade_costurada-s.quantidade_entregue,0) faltam_entregar
          FROM public.ordens_servico o
          JOIN public.ordens_servico_tamanhos s ON s.ordem_id=o.id AND s.empresa_id=v.empresa_id
          LEFT JOIN public.clientes c ON c.id=o.cliente_id AND c.empresa_id=v.empresa_id
          WHERE o.empresa_id=v.empresa_id AND o.status<>'cancelada'
            AND o.data_entrada BETWEEN v_inicio AND v_fim
          ORDER BY o.prazo NULLS LAST,o.numero,s.tamanho
          LIMIT 2000
        ) x)
    );
  END IF;

  IF v_tipo='producao_status' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC),'[]'::jsonb)
        FROM (SELECT status,count(*)::integer quantidade,COALESCE(sum(valor_total),0) valor_total
          FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND data_entrada BETWEEN v_inicio AND v_fim
          GROUP BY status ORDER BY 2 DESC LIMIT 20) x));
  END IF;

  IF v_tipo='producao_clientes' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor_total DESC),'[]'::jsonb)
        FROM (SELECT COALESCE(c.nome,'Cliente não informado') cliente,count(o.id)::integer ordens,
          COALESCE(sum(o.quantidade),0)::integer quantidade,COALESCE(sum(o.valor_total),0) valor_total
          FROM public.ordens_servico o LEFT JOIN public.clientes c ON c.id=o.cliente_id AND c.empresa_id=v.empresa_id
          WHERE o.empresa_id=v.empresa_id AND o.data_entrada BETWEEN v_inicio AND v_fim
          GROUP BY 1 ORDER BY 4 DESC LIMIT 100) x));
  END IF;

  IF v_tipo='produtividade' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT jsonb_build_array(
        jsonb_build_object('indicador','Ordens recebidas','valor',count(*)),
        jsonb_build_object('indicador','Peças recebidas','valor',COALESCE(sum(quantidade),0)),
        jsonb_build_object('indicador','Valor das ordens recebidas','valor',COALESCE(sum(valor_total),0)),
        jsonb_build_object('indicador','Ordens atualmente entregues','valor',count(*) FILTER(WHERE status='entregue')))
        FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND data_entrada BETWEEN v_inicio AND v_fim));
  END IF;

  IF v_tipo='quadro_funcionarios' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC),'[]'::jsonb)
        FROM (
          SELECT 'Vínculo · '||COALESCE(f.tipo_vinculo,'não informado') grupo,count(*)::integer quantidade
          FROM public.funcionarios f
          WHERE f.empresa_id=v.empresa_id AND COALESCE(f.data_admissao,'-infinity'::date)<=v_fim
            AND (f.data_demissao IS NULL OR f.data_demissao>v_fim)
            AND (f.ativo IS TRUE OR f.data_demissao IS NOT NULL)
          GROUP BY f.tipo_vinculo
          UNION ALL
          SELECT 'Cargo · '||COALESCE(f.cargo,'não informado'),count(*)::integer
          FROM public.funcionarios f
          WHERE f.empresa_id=v.empresa_id AND COALESCE(f.data_admissao,'-infinity'::date)<=v_fim
            AND (f.data_demissao IS NULL OR f.data_demissao>v_fim)
            AND (f.ativo IS TRUE OR f.data_demissao IS NOT NULL)
          GROUP BY f.cargo LIMIT 100
        ) x));
  END IF;

  IF v_tipo='ponto_jornada' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC),'[]'::jsonb)
        FROM (SELECT COALESCE(r.status,'sem status') status,count(*)::integer quantidade
          FROM public.registros_ponto r JOIN public.funcionarios f ON f.id=r.funcionario_id
          WHERE f.empresa_id=v.empresa_id AND r.data BETWEEN v_inicio AND v_fim
          GROUP BY r.status LIMIT 20) x));
  END IF;

  IF v_tipo='absenteismo' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT jsonb_build_array(
        jsonb_build_object('tipo','Faltas registradas','quantidade',count(*) FILTER(WHERE r.status='falta'),'dias',count(*) FILTER(WHERE r.status='falta')),
        jsonb_build_object('tipo','Registros totais','quantidade',count(*),'dias',count(*)))
        FROM public.registros_ponto r JOIN public.funcionarios f ON f.id=r.funcionario_id
        WHERE f.empresa_id=v.empresa_id AND r.data BETWEEN v_inicio AND v_fim));
  END IF;

  IF v_tipo='ferias_afastamentos' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
        SELECT 'Férias' tipo,count(*)::integer quantidade,
          count(*) FILTER(WHERE f.inicio BETWEEN v_inicio AND v_fim)::integer inicios_no_periodo
        FROM public.rh_ferias f JOIN public.funcionarios u ON u.id=f.funcionario_id
        WHERE u.empresa_id=v.empresa_id AND COALESCE(f.fim,f.inicio)>=v_inicio AND f.inicio<=v_fim
        UNION ALL
        SELECT 'Afastamentos',count(*)::integer,
          count(*) FILTER(WHERE a.inicio BETWEEN v_inicio AND v_fim)::integer
        FROM public.rh_afastamentos a JOIN public.funcionarios u ON u.id=a.funcionario_id
        WHERE u.empresa_id=v.empresa_id AND COALESCE(a.fim,v_fim)>=v_inicio AND a.inicio<=v_fim
        LIMIT 10) x));
  END IF;

  IF v_tipo='dividas_posicao' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC),'[]'::jsonb)
        FROM (SELECT status,count(*)::integer quantidade,COALESCE(sum(saldo_devedor),0) valor
          FROM public.dividas_gestao
          WHERE empresa_id=v.empresa_id AND status<>'inativa'
            AND COALESCE(data_contratacao,(created_at AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN v_inicio AND v_fim
          GROUP BY status LIMIT 20) x));
  END IF;

  IF v_tipo='dividas_credores' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.saldo DESC),'[]'::jsonb)
        FROM (SELECT credor,count(*)::integer contratos,COALESCE(sum(saldo_devedor),0) saldo
          FROM public.dividas_gestao
          WHERE empresa_id=v.empresa_id AND status='ativa'
            AND COALESCE(data_contratacao,(created_at AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN v_inicio AND v_fim
          GROUP BY credor ORDER BY 3 DESC LIMIT 100) x));
  END IF;

  RETURN jsonb_build_object('sucesso',false,'erro','Tipo de relatório operacional inválido');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_operacional(text,text,date,date) TO anon,authenticated;
