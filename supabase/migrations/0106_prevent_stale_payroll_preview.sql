BEGIN;

CREATE OR REPLACE FUNCTION public.app_admin_visualizar_fechamento(p_token text,p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_usuario record;
  v_fechamento record;
  v_resumo jsonb;
  v_linhas jsonb;
  v_atual text;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia,4)='0000' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  SELECT * INTO v_fechamento FROM public.fechamentos_mensais
  WHERE empresa_id=v_usuario.empresa_id AND competencia=p_competencia LIMIT 1;
  IF v_fechamento.id IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Prévia não encontrada; calcule antes de consultar');
  END IF;
  IF v_fechamento.status='calculado' THEN
    IF v_fechamento.source_fingerprint IS NULL THEN
      RETURN jsonb_build_object('sucesso',false,'erro','A prévia foi invalidada; recalcule antes de consultar valores.');
    END IF;
    IF v_fechamento.regra_snapshot->>'versao_regra'='v5_44h_dsr_semanal' THEN
      v_atual:=public.app_fechamento_source_fingerprint_44h(v_usuario.empresa_id,p_competencia,coalesce(v_fechamento.incluir_informais_vale,false));
    ELSE
      v_atual:=public.app_fechamento_source_fingerprint(v_usuario.empresa_id,p_competencia,coalesce(v_fechamento.incluir_informais_vale,false));
    END IF;
    IF v_atual IS DISTINCT FROM v_fechamento.source_fingerprint THEN
      RETURN jsonb_build_object('sucesso',false,'erro','Ponto, jornada, salário ou cadastro mudou desde a prévia; recalcule antes de consultar ou usar os valores.');
    END IF;
  END IF;
  SELECT jsonb_build_object('funcionarios',count(*),'faltas_injustificadas',coalesce(sum(faltas_injustificadas),0),
    'faltas_justificadas',coalesce(sum(faltas_justificadas),0),'horas_extras_50',coalesce(sum(horas_extras_50),0),
    'horas_extras_100',coalesce(sum(horas_extras_100),0),'extras_50_valor',coalesce(sum(horas_extras_50_valor),0),
    'extras_100_valor',coalesce(sum(horas_extras_100_valor),0),'dsr_desconto',coalesce(sum(dsr_desconto),0),
    'dsr_semanas_perdidas',coalesce(sum(dsr_semanas_perdidas),0),
    'dsr_pendencias',coalesce(sum(dsr_pendencias),0),
    'salarios_pendentes',count(*) FILTER(WHERE salario_pendente)) INTO v_resumo
  FROM public.fechamento_funcionarios WHERE fechamento_id=v_fechamento.id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome),'[]'::jsonb) INTO v_linhas
  FROM (
    SELECT f.nome,f.cpf,f.salario,f.salario_periodo,ff.dias_trabalhados,ff.dias_folga,
      ff.dias_ferias,ff.dias_afastamento,ff.faltas,ff.faltas_justificadas,ff.faltas_injustificadas,
      ff.atrasos_minutos,ff.horas_extras_50,ff.horas_extras_50_valor,ff.horas_extras_100,
      ff.horas_extras_100_valor,ff.dsr_horas,ff.dsr_desconto,ff.jornada_nome,
      ff.carga_semanal_minutos,ff.divisor_horas,ff.dsr_semanas_perdidas,ff.dsr_pendencias,
      ff.salario_pendente,ff.observacoes
    FROM public.fechamento_funcionarios ff
    JOIN public.funcionarios f ON f.id=ff.funcionario_id AND f.empresa_id=v_usuario.empresa_id
    WHERE ff.fechamento_id=v_fechamento.id LIMIT 1000
  ) x;
  RETURN jsonb_build_object('sucesso',true,'fechamento_id',v_fechamento.id,'competencia',p_competencia,
    'status',v_fechamento.status,'confirmado_at',v_fechamento.confirmado_at,
    'source_fingerprint',v_fechamento.source_fingerprint,'resumo',v_resumo,'linhas',v_linhas,
    'regras',v_fechamento.regra_snapshot);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.app_admin_visualizar_fechamento(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_visualizar_fechamento(text,text) TO anon, authenticated;

COMMIT;
