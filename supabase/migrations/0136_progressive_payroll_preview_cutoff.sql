BEGIN;

-- Prévia progressiva: dias posteriores ao último ponto aplicado são projeção,
-- não ausência. O ponto real continua governando faltas, atrasos, extras e DSR
-- somente até a data de corte observada.
DO $migration$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.app_admin_calcular_fechamento_44h(text,text,boolean)'::regprocedure);

  v_def := replace(
    v_def,
    E'  v_fim date;\n  v_inicio_semana date;',
    E'  v_fim date;\n  v_data_corte date;\n  v_inicio_semana date;'
  );

  v_def := replace(
    v_def,
    E'  v_fim:=(v_inicio+interval ''1 month - 1 day'')::date;\n  IF v_inicio < DATE ''2026-11-01'' THEN',
    E'  v_fim:=(v_inicio+interval ''1 month - 1 day'')::date;\n  SELECT coalesce(max(l.data), v_inicio - 1) INTO v_data_corte\n  FROM public.ponto_import_linhas l\n  JOIN public.ponto_importacoes i ON i.id=l.importacao_id AND i.empresa_id=l.empresa_id\n  WHERE l.empresa_id=v_usuario.empresa_id AND i.status=''aplicada''\n    AND l.encontrado=true AND l.funcionario_id IS NOT NULL\n    AND l.data BETWEEN v_inicio AND v_fim;\n  IF v_inicio < DATE ''2026-11-01'' THEN'
  );

  v_def := replace(
    v_def,
    E'(sj.dias_esperados>0 AND coalesce(se.dias_observados,0)=sj.dias_esperados) AS ponto_completo,\n      (coalesce(se.dsr_marcado,false) IS DISTINCT FROM coalesce(se.falta_injustificada,false)) AS marcador_inconsistente',
    E'(sj.dias_esperados>0 AND CASE\n        WHEN sj.week_start::date > date_trunc(''week'',v_data_corte)::date THEN true\n        WHEN sj.week_start::date < date_trunc(''week'',v_data_corte)::date THEN coalesce(se.dias_observados,0)=sj.dias_esperados\n        ELSE coalesce(se.dias_observados,0) = (SELECT count(*)::integer FROM generate_series(sj.active_start::timestamp,least(sj.active_end,v_data_corte)::timestamp,interval ''1 day'') d(dia) WHERE coalesce((sj.dias_semana->(extract(isodow FROM d.dia)::integer::text)->>''ativo'')::boolean,false))\n      END) AS ponto_completo,\n      (sj.week_start::date + 6 <= v_data_corte AND coalesce(se.dsr_marcado,false) IS DISTINCT FROM coalesce(se.falta_injustificada,false)) AS marcador_inconsistente'
  );

  v_def := replace(
    v_def,
    E'count(*) FILTER(WHERE jornada_44h_valida AND ponto_completo AND NOT revisar\n        AND NOT marcador_inconsistente AND dsr_marcado AND falta_injustificada)::integer AS dsr_semanas_perdidas,',
    E'count(*) FILTER(WHERE week_start::date + 6 <= v_data_corte AND jornada_44h_valida AND ponto_completo AND NOT revisar\n        AND NOT marcador_inconsistente AND dsr_marcado AND falta_injustificada)::integer AS dsr_semanas_perdidas,'
  );

  v_def := replace(
    v_def,
    E'count(*) FILTER(WHERE NOT jornada_44h_valida OR NOT ponto_completo OR revisar OR marcador_inconsistente)::integer AS dsr_pendencias',
    E'count(*) FILTER(WHERE (week_start::date <= date_trunc(''week'',v_data_corte)::date) AND (NOT jornada_44h_valida OR NOT ponto_completo OR revisar OR marcador_inconsistente))::integer AS dsr_pendencias'
  );

  IF position('v_data_corte date' in v_def)=0
     OR position('date_trunc(''week'',v_data_corte)' in v_def)=0 THEN
    RAISE EXCEPTION 'Não foi possível aplicar a regra de corte progressivo; função atual não corresponde ao contrato esperado';
  END IF;

  EXECUTE v_def;
END;
$migration$;

COMMENT ON FUNCTION public.app_admin_calcular_fechamento_44h(text,text,boolean) IS
  'Calcula prévia progressiva: dados reais até a última data de ponto aplicada e projeção contratual sem faltas, atrasos, extras ou DSR futuro.';

COMMIT;
