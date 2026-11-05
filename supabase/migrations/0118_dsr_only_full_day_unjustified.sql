BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef('public.app_admin_calcular_fechamento_44h(text,text,boolean)'::regprocedure);

  v_old := $old$(p.falta_explicita AND p.dia_programado AND NOT (p.justificativa_aprovada OR p.ferias OR p.afastamento OR p.abono_marcado)) AS falta_injustificada,$old$;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Trecho de classificação de falta não corresponde à versão esperada; migration abortada';
  END IF;
  v_new := $new$(p.falta_explicita AND p.dia_programado AND NOT p.tem_marcacao AND NOT (p.justificativa_aprovada OR p.ferias OR p.afastamento OR p.abono_marcado)) AS falta_injustificada,$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$p.falta_ambigua OR p.abono_ambiguo OR p.dsr_ambiguo) AS revisar$old$;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Trecho de revisão de eventos não corresponde à versão esperada; migration abortada';
  END IF;
  v_new := $new$p.falta_ambigua OR p.abono_ambiguo OR p.dsr_ambiguo OR (p.falta_explicita AND p.tem_marcacao)) AS revisar$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$'criterio_dsr','No máximo uma ocorrência semanal (dsr_horas mantém a unidade histórica de contagem); somente ausência explicitamente injustificada, jornada CLT 44h de segunda a sexta, ponto completo e marcador coincidente. Dúvida ou falta de dados bloqueia a confirmação.'$old$;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Descrição vigente da regra de DSR não corresponde à versão esperada; migration abortada';
  END IF;
  v_new := $new$'criterio_dsr','No máximo uma ocorrência semanal (dsr_horas mantém a unidade histórica de contagem); somente falta de dia inteiro explicitamente injustificada, sem marcações parciais, em jornada CLT 44h de segunda a sexta, com ponto completo e marcador coincidente. Atrasos e faltas parciais não geram perda automática do DSR; ficam para revisão. Dúvida ou falta de dados bloqueia a confirmação.'$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$'fonte_normativa',jsonb_build_array('Constituição Federal, art. 7º, XIII e XV','Lei 605/1949, arts. 1º, 6º e 7º','CCT 2025–2026 indicada pela empresa como referência operacional vigente'),$old$;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'Fontes normativas do snapshot não correspondem à versão esperada; migration abortada';
  END IF;
  v_new := $new$'fonte_normativa',jsonb_build_array('Constituição Federal, art. 7º, XIII e XV','CLT, arts. 58, §1º e 67','Lei 605/1949, arts. 1º, 6º e 7º','CCT 2025–2026 fornecida pela empresa: vigência expressa de 01/03/2025 a 28/02/2026; períodos posteriores usam a legislação geral, salvo instrumento vigente identificado'),$new$;
  v_definition := replace(v_definition,v_old,v_new);

  EXECUTE v_definition;
END;
$migration$;

COMMENT ON FUNCTION public.app_admin_calcular_fechamento_44h(text,text,boolean) IS
  'DSR: no máximo uma ocorrência por semana por falta de dia inteiro explicitamente injustificada; dia com marcação parcial fica em revisão e nunca gera perda automática. CCT do usuário: 01/03/2025 a 28/02/2026; fora da vigência expressa, regra legal geral salvo instrumento aplicável.';

COMMIT;
