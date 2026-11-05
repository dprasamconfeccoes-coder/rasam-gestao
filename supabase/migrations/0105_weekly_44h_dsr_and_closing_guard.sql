BEGIN;

ALTER TABLE public.fechamento_funcionarios
  ADD COLUMN IF NOT EXISTS jornada_nome text,
  ADD COLUMN IF NOT EXISTS carga_semanal_minutos integer,
  ADD COLUMN IF NOT EXISTS divisor_horas numeric(10,2),
  ADD COLUMN IF NOT EXISTS dsr_semanas_perdidas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dsr_pendencias integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salario_pendente boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.app_validar_tipo_descanso_jornada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dsr_count integer;
BEGIN
  IF jsonb_typeof(NEW.dias_semana) <> 'object' THEN
    RAISE EXCEPTION 'A jornada deve informar a semana em formato válido';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(NEW.dias_semana) AS d(dia, dados)
    WHERE coalesce(d.dados->>'tipo_descanso','') NOT IN ('','dsr','repouso_adicional')
       OR (coalesce((d.dados->>'ativo')::boolean,false)
           AND coalesce(d.dados->>'tipo_descanso','') <> '')
  ) THEN
    RAISE EXCEPTION 'Dia trabalhado não pode ser marcado como descanso; use dsr ou repouso_adicional em dia não trabalhado';
  END IF;
  SELECT count(*)::integer INTO v_dsr_count
  FROM jsonb_each(NEW.dias_semana) AS d(dia, dados)
  WHERE d.dados->>'tipo_descanso' = 'dsr'
    AND NOT coalesce((d.dados->>'ativo')::boolean,false);
  IF v_dsr_count < 1 THEN
    RAISE EXCEPTION 'Informe ao menos um dia de descanso semanal remunerado (DSR)';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_tipo_descanso_jornada ON public.ponto_jornadas;
CREATE TRIGGER trg_validar_tipo_descanso_jornada
BEFORE INSERT OR UPDATE OF dias_semana ON public.ponto_jornadas
FOR EACH ROW EXECUTE FUNCTION public.app_validar_tipo_descanso_jornada();

DO $migration$
DECLARE
  v_count integer;
  v_jornada record;
  v_after jsonb;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public.ponto_jornadas
  WHERE nome = 'CLT — padrão informado (44h)'
    AND carga_semanal_minutos = 2640
    AND ativo = true;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Esperada exatamente uma jornada ativa CLT 44h; encontradas %', v_count;
  END IF;
  SELECT * INTO v_jornada
  FROM public.ponto_jornadas
  WHERE nome = 'CLT — padrão informado (44h)'
    AND carga_semanal_minutos = 2640
    AND ativo = true
  LIMIT 1;
  v_after := jsonb_set(
    jsonb_set(v_jornada.dias_semana, '{6,tipo_descanso}', to_jsonb('repouso_adicional'::text), true),
    '{7,tipo_descanso}', to_jsonb('dsr'::text), true
  );
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (NULL, 'configurou_descansos_jornada_44h', 'ponto_jornadas', v_jornada.id,
    jsonb_build_object('migracao','0105_weekly_44h_dsr_and_closing_guard',
      'antes',v_jornada.dias_semana,'depois',v_after,
      'vigencia_aplicada','2026-11-04 a 2026-12-15'));
  UPDATE public.ponto_jornadas
  SET dias_semana = v_after
  WHERE id = v_jornada.id AND empresa_id = v_jornada.empresa_id;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.app_fechamento_source_fingerprint_44h(
  p_empresa_id uuid, p_competencia text, p_incluir_informais_vale boolean
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
WITH faixa AS (
  SELECT to_date(p_competencia || '-01','YYYY-MM-DD')::date AS inicio,
    (to_date(p_competencia || '-01','YYYY-MM-DD') + interval '1 month - 1 day')::date AS fim,
    date_trunc('week',to_date(p_competencia || '-01','YYYY-MM-DD'))::date AS inicio_semana,
    (date_trunc('week',(to_date(p_competencia || '-01','YYYY-MM-DD') + interval '1 month - 1 day'))::date + 6) AS fim_semana
), payload AS (
  SELECT jsonb_build_object(
    'version','payroll-close-44h-weekly-dsr-v1',
    'base',public.app_fechamento_source_fingerprint(p_empresa_id,p_competencia,p_incluir_informais_vale),
    'jornadas',coalesce((
      SELECT jsonb_agg(jsonb_build_object('atribuicao_id',a.id,'funcionario_id',a.funcionario_id,
        'jornada_id',j.id,'nome',j.nome,'versao',j.versao,'carga',j.carga_semanal_minutos,
        'dias',j.dias_semana,'vigencia_inicio',a.vigencia_inicio,'vigencia_fim',a.vigencia_fim)
        ORDER BY a.funcionario_id,a.vigencia_inicio,a.id)
      FROM public.ponto_jornada_atribuicoes a
      JOIN public.ponto_jornadas j ON j.id=a.jornada_id AND j.empresa_id=a.empresa_id
      CROSS JOIN faixa f
      WHERE a.empresa_id=p_empresa_id
        AND a.vigencia_inicio<=f.fim_semana
        AND (a.vigencia_fim IS NULL OR a.vigencia_fim>=f.inicio_semana)
    ),'[]'::jsonb),
    'pontos_fora_competencia',coalesce((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.funcionario_id,q.data)
      FROM (
        SELECT DISTINCT ON (l.funcionario_id,l.data)
          l.id AS linha_id,i.id AS importacao_id,l.funcionario_id,l.data,l.previsto,
          l.dia_falta,l.abono,l.desconta_dsr,l.justificativas,l.entrada_1,l.saida_1,
          l.entrada_2,l.saida_2,l.total_normais,l.inconsistencia,i.status,i.applied_at
        FROM public.ponto_import_linhas l
        JOIN public.ponto_importacoes i ON i.id=l.importacao_id AND i.empresa_id=l.empresa_id
        CROSS JOIN faixa f
        WHERE l.empresa_id=p_empresa_id AND i.empresa_id=p_empresa_id
          AND i.status='aplicada' AND l.encontrado=true
          AND l.funcionario_id IS NOT NULL AND l.data IS NOT NULL
          AND l.data BETWEEN f.inicio_semana AND f.fim_semana
          AND l.data NOT BETWEEN f.inicio AND f.fim
        ORDER BY l.funcionario_id,l.data,i.applied_at DESC NULLS LAST,i.created_at DESC,l.created_at DESC,l.id DESC
      ) q
    ),'[]'::jsonb),
    'importacoes_pendentes',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',i.id,'competencia',i.competencia,
        'status',i.status,'linhas_com_inconsistencia',i.linhas_com_inconsistencia,
        'total_linhas',i.total_linhas,'applied_at',i.applied_at) ORDER BY i.id)
      FROM public.ponto_importacoes i
      CROSS JOIN faixa f
      WHERE i.empresa_id=p_empresa_id AND i.competencia=to_char(f.inicio,'MM/YYYY')
        AND (i.status<>'aplicada' OR i.linhas_com_inconsistencia>0)
    ),'[]'::jsonb),
    'eventos_fora_competencia',jsonb_build_object(
      'atestados',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'funcionario_id',a.funcionario_id,
        'data',a.data_atendimento,'dias',a.dias,'status',a.status) ORDER BY a.id)
        FROM public.atestados a JOIN public.funcionarios f ON f.id=a.funcionario_id AND f.empresa_id=p_empresa_id
        CROSS JOIN faixa x WHERE a.data_atendimento<=x.fim_semana
          AND a.data_atendimento+greatest(coalesce(a.dias,1),1)>x.inicio_semana
          AND (a.data_atendimento<x.inicio OR a.data_atendimento>x.fim)), '[]'::jsonb),
      'afastamentos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',af.id,'funcionario_id',af.funcionario_id,
        'inicio',af.inicio,'fim',af.fim,'status',af.status) ORDER BY af.id)
        FROM public.rh_afastamentos af JOIN public.funcionarios f ON f.id=af.funcionario_id AND f.empresa_id=p_empresa_id
        CROSS JOIN faixa x WHERE af.inicio<=x.fim_semana AND (af.fim IS NULL OR af.fim>=x.inicio_semana)
          AND (af.inicio<x.inicio OR af.inicio>x.fim OR af.fim<x.inicio OR af.fim>x.fim)), '[]'::jsonb),
      'inconsistencias',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pi.id,'funcionario_id',pi.funcionario_id,
        'data',pi.data,'tipo',pi.tipo,'status',pi.status) ORDER BY pi.id)
        FROM public.ponto_inconsistencias pi JOIN public.funcionarios f ON f.id=pi.funcionario_id AND f.empresa_id=p_empresa_id
        CROSS JOIN faixa x WHERE pi.data BETWEEN x.inicio_semana AND x.fim_semana
          AND (pi.data<x.inicio OR pi.data>x.fim)), '[]'::jsonb),
      'justificativas',coalesce((SELECT jsonb_agg(jsonb_build_object('id',jp.id,'funcionario_id',jp.funcionario_id,
        'data',jp.data_registro,'tipo',jp.tipo,'status',jp.status) ORDER BY jp.id)
        FROM public.justificativas_ponto jp JOIN public.funcionarios f ON f.id=jp.funcionario_id AND f.empresa_id=p_empresa_id
        CROSS JOIN faixa x WHERE jp.data_registro BETWEEN x.inicio_semana AND x.fim_semana
          AND (jp.data_registro<x.inicio OR jp.data_registro>x.fim)), '[]'::jsonb)
    )
  ) AS value
  FROM faixa
)
SELECT encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex') FROM payload;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_calcular_fechamento_44h(
  p_token text, p_competencia text, p_incluir_informais_vale boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_base jsonb;
  v_id uuid;
  v_inicio date;
  v_fim date;
  v_inicio_semana date;
  v_fim_semana date;
  v_fingerprint text;
  v_divisor numeric;
  v_importacoes_pendentes integer := 0;
  v_salarios_pendentes integer := 0;
  v_semanas_pendentes integer := 0;
  v_terminados_fora_da_previa integer := 0;
  v_pendencias integer := 0;
  v_perdidas integer := 0;
  v_resumo jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia,4)='0000' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  v_inicio:=to_date(p_competencia||'-01','YYYY-MM-DD');
  v_fim:=(v_inicio+interval '1 month - 1 day')::date;
  IF v_inicio < DATE '2026-11-01' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A regra auditável de 44h começa em novembro/2026. Competências anteriores exigem cálculo histórico específico; não serão calculadas por esta regra.');
  END IF;
  IF v_inicio >= DATE '2026-12-16' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A jornada de 44h tem vigência encerrada em 15/12/2026. Configure e atribua a jornada seguinte antes de calcular esta competência.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:'||v_usuario.empresa_id::text,0));

  v_base:=public.app_admin_calcular_fechamento(p_token,p_competencia,coalesce(p_incluir_informais_vale,false));
  IF coalesce((v_base->>'sucesso')::boolean,false)=false THEN RETURN v_base; END IF;
  SELECT id INTO v_id FROM public.fechamentos_mensais
  WHERE empresa_id=v_usuario.empresa_id AND competencia=p_competencia LIMIT 1;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','O backend não criou o registro da prévia; nenhum valor foi disponibilizado.');
  END IF;

  v_inicio_semana:=date_trunc('week',v_inicio)::date;
  v_fim_semana:=date_trunc('week',v_fim)::date+6;
  SELECT coalesce(nullif((c.regras->>'divisor_horas')::numeric,0),220)
    INTO v_divisor FROM public.configuracoes_empresa c WHERE c.empresa_id=v_usuario.empresa_id LIMIT 1;
  v_divisor:=coalesce(v_divisor,220);
  SELECT count(*)::integer INTO v_importacoes_pendentes
  FROM public.ponto_importacoes i
  WHERE i.empresa_id=v_usuario.empresa_id
    AND i.competencia=to_char(v_inicio,'MM/YYYY')
    AND (i.status<>'aplicada' OR i.linhas_com_inconsistencia>0);

  WITH empregados AS (
    SELECT f.id,f.empresa_id,f.nome,f.salario,f.salario_periodo,f.elegivel_vale,f.registrado,
      f.data_admissao,f.data_demissao,f.tipo_vinculo
    FROM public.funcionarios f
    WHERE f.empresa_id=v_usuario.empresa_id
      AND f.tipo_vinculo IN ('formal','clt')
      AND (f.ativo=true OR (f.data_demissao IS NOT NULL AND f.data_demissao BETWEEN v_inicio AND v_fim))
      AND (f.data_admissao IS NULL OR f.data_admissao<=v_fim)
      AND (f.data_demissao IS NULL OR f.data_demissao>=v_inicio)
  ), semana_grade AS (
    SELECT e.*,g.week_start,
      greatest(g.week_start,coalesce(e.data_admissao,g.week_start)) AS active_start,
      least(g.week_start+6,coalesce(e.data_demissao,g.week_start+6)) AS active_end
    FROM empregados e
    CROSS JOIN LATERAL generate_series(v_inicio_semana::timestamp,v_fim_semana::timestamp,interval '7 days') AS g(week_start)
    WHERE g.week_start::date+6 BETWEEN v_inicio AND v_fim
      AND g.week_start::date<=coalesce(e.data_demissao,g.week_start::date)
      AND g.week_start::date+6>=coalesce(e.data_admissao,g.week_start::date+6)
  ), semana_jornada AS (
    SELECT w.*,
      coalesce(ac.quantidade,0)::integer AS atribuicoes_semana,
      sj.id AS jornada_id,sj.nome AS jornada_nome,sj.carga_semanal_minutos,sj.dias_semana,
      coalesce(ed.dias_esperados,0)::integer AS dias_esperados,
      coalesce((SELECT count(*) FROM jsonb_each(coalesce(sj.dias_semana,'{}'::jsonb)) d
        WHERE d.value->>'tipo_descanso'='dsr' AND NOT coalesce((d.value->>'ativo')::boolean,false)),0)::integer AS quantidade_dsr,
      sj.dias_semana->'7'->>'tipo_descanso' AS domingo_tipo,
      sj.dias_semana->'6'->>'tipo_descanso' AS sabado_tipo
    FROM semana_grade w
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS quantidade
      FROM public.ponto_jornada_atribuicoes a
      JOIN public.ponto_jornadas j ON j.id=a.jornada_id AND j.empresa_id=a.empresa_id
      WHERE a.empresa_id=w.empresa_id AND a.funcionario_id=w.id
        AND a.vigencia_inicio<=w.week_start::date
        AND (a.vigencia_fim IS NULL OR a.vigencia_fim>=w.week_start::date+6)
    ) ac ON true
    LEFT JOIN LATERAL (
      SELECT j.id,j.nome,j.carga_semanal_minutos,j.dias_semana
      FROM public.ponto_jornada_atribuicoes a
      JOIN public.ponto_jornadas j ON j.id=a.jornada_id AND j.empresa_id=a.empresa_id
      WHERE a.empresa_id=w.empresa_id AND a.funcionario_id=w.id
        AND a.vigencia_inicio<=w.week_start::date
        AND (a.vigencia_fim IS NULL OR a.vigencia_fim>=w.week_start::date+6)
      ORDER BY a.vigencia_inicio DESC,a.id DESC LIMIT 1
    ) sj ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS dias_esperados
      FROM generate_series(w.active_start::timestamp,w.active_end::timestamp,interval '1 day') d(dia)
      WHERE coalesce((sj.dias_semana->(extract(isodow FROM d.dia)::integer::text)->>'ativo')::boolean,false)
    ) ed ON true
  ), ponto_ultima AS (
    SELECT DISTINCT ON (l.funcionario_id,l.data)
      l.id,l.importacao_id,l.funcionario_id,l.data,l.previsto,l.entrada_1,l.saida_1,
      l.entrada_2,l.saida_2,l.total_normais,l.dia_falta,l.abono,l.desconta_dsr,
      l.justificativas,l.inconsistencia
    FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i ON i.id=l.importacao_id AND i.empresa_id=l.empresa_id
    WHERE l.empresa_id=v_usuario.empresa_id AND i.empresa_id=v_usuario.empresa_id
      AND i.status='aplicada' AND l.encontrado=true
      AND nullif(trim(coalesce(l.inconsistencia,'')),'') IS NULL
      AND l.funcionario_id IS NOT NULL AND l.data BETWEEN v_inicio_semana AND v_fim_semana
    ORDER BY l.funcionario_id,l.data,i.applied_at DESC NULLS LAST,i.created_at DESC,l.created_at DESC,l.id DESC
  ), ponto_classificado AS (
    SELECT p.*,
      coalesce((sj.dias_semana->(extract(isodow FROM p.data)::integer::text)->>'ativo')::boolean,
        nullif(trim(coalesce(p.previsto,'')),'') IS NOT NULL) AS dia_programado,
      (coalesce(p.entrada_1::text,'')<>'' OR coalesce(p.saida_1::text,'')<>'' OR
       coalesce(p.entrada_2::text,'')<>'' OR coalesce(p.saida_2::text,'')<>'' OR
       nullif(trim(coalesce(p.total_normais,'')),'') IS NOT NULL) AS tem_marcacao,
      (lower(trim(coalesce(p.dia_falta,''))) IN ('sim','s','true','1','falta','faltou')) AS falta_explicita,
      (nullif(trim(coalesce(p.dia_falta,'')),'') IS NOT NULL AND
        lower(trim(p.dia_falta)) NOT IN ('sim','s','true','1','falta','faltou','não','nao','n','0','false')) AS falta_ambigua,
      (lower(trim(coalesce(p.abono,''))) IN ('sim','s','true','1','abono')) AS abono_marcado,
      (nullif(trim(coalesce(p.abono,'')),'') IS NOT NULL AND
        lower(trim(p.abono)) NOT IN ('sim','s','true','1','abono','não','nao','n','0','false')) AS abono_ambiguo,
      (lower(trim(coalesce(p.desconta_dsr,''))) IN ('sim','s','true','1')) AS dsr_marcado,
      (nullif(trim(coalesce(p.desconta_dsr,'')),'') IS NOT NULL AND
        lower(trim(p.desconta_dsr)) NOT IN ('sim','s','true','1','não','nao','n','0','false')) AS dsr_ambiguo,
      (lower(coalesce(p.previsto,'')||' '||coalesce(p.justificativas,'')) LIKE '%ferias%' OR
       lower(coalesce(p.previsto,'')||' '||coalesce(p.justificativas,'')) LIKE '%férias%') AS ferias,
      (EXISTS(SELECT 1 FROM public.atestados a WHERE a.funcionario_id=p.funcionario_id AND lower(coalesce(a.status,'')) IN ('aceito','aceita','aprovado','aprovada')
          AND p.data>=a.data_atendimento AND p.data<a.data_atendimento+greatest(coalesce(a.dias,1),1)) OR
       EXISTS(SELECT 1 FROM public.rh_afastamentos af WHERE af.funcionario_id=p.funcionario_id AND lower(af.status) IN ('ativo','aprovado','aprovada','aceito','aceita')
          AND p.data>=af.inicio AND (af.fim IS NULL OR p.data<=af.fim))) AS afastamento,
      EXISTS(SELECT 1 FROM public.ponto_inconsistencias pi WHERE pi.funcionario_id=p.funcionario_id
        AND pi.data=p.data AND pi.tipo='ponto' AND pi.status IN ('justificada','aprovada')) AS justificativa_aprovada,
      EXISTS(SELECT 1 FROM public.ponto_inconsistencias pi WHERE pi.funcionario_id=p.funcionario_id
        AND pi.data=p.data AND pi.tipo='ponto' AND pi.status NOT IN ('justificada','aprovada')) AS inconsistencia_pendente,
      coalesce((SELECT j.dias_semana FROM public.ponto_jornada_atribuicoes a
        JOIN public.ponto_jornadas j ON j.id=a.jornada_id AND j.empresa_id=a.empresa_id
        WHERE a.empresa_id=v_usuario.empresa_id AND a.funcionario_id=p.funcionario_id
          AND a.vigencia_inicio<=p.data AND (a.vigencia_fim IS NULL OR a.vigencia_fim>=p.data)
        ORDER BY a.vigencia_inicio DESC,a.id DESC LIMIT 1),'{}'::jsonb) AS dias_json
    FROM ponto_ultima p
    LEFT JOIN LATERAL (
      SELECT j.dias_semana
      FROM public.ponto_jornada_atribuicoes a
      JOIN public.ponto_jornadas j ON j.id=a.jornada_id AND j.empresa_id=a.empresa_id
      WHERE a.empresa_id=v_usuario.empresa_id AND a.funcionario_id=p.funcionario_id
        AND a.vigencia_inicio<=p.data AND (a.vigencia_fim IS NULL OR a.vigencia_fim>=p.data)
      ORDER BY a.vigencia_inicio DESC,a.id DESC LIMIT 1
    ) sj ON true
  ), ponto_eventos AS (
    SELECT p.*,
      (p.falta_explicita AND p.dia_programado AND NOT (p.justificativa_aprovada OR p.ferias OR p.afastamento OR p.abono_marcado)) AS falta_injustificada,
      ((nullif(trim(coalesce(p.justificativas,'')),'') IS NOT NULL AND NOT (p.justificativa_aprovada OR p.ferias OR p.afastamento)) OR
       (p.dia_programado AND NOT p.tem_marcacao AND NOT p.falta_explicita AND NOT p.ferias AND NOT p.afastamento) OR
       (p.falta_explicita AND NOT p.dia_programado) OR p.inconsistencia_pendente OR
       p.falta_ambigua OR p.abono_ambiguo OR p.dsr_ambiguo) AS revisar
    FROM ponto_classificado p
  ), semana_eventos AS (
    SELECT p.funcionario_id,date_trunc('week',p.data)::date AS week_start,
      count(DISTINCT p.data) FILTER(WHERE p.dia_programado)::integer AS dias_observados,
      coalesce(bool_or(p.dsr_marcado),false) AS dsr_marcado,
      coalesce(bool_or(p.falta_injustificada),false) AS falta_injustificada,
      coalesce(bool_or(p.revisar),false) AS revisar
    FROM ponto_eventos p GROUP BY p.funcionario_id,date_trunc('week',p.data)::date
  ), semana_resultado AS (
    SELECT sj.id AS funcionario_id,sj.nome,sj.salario,sj.salario_periodo,
      sj.week_start,sj.carga_semanal_minutos,sj.jornada_nome,sj.atribuicoes_semana,
      sj.dias_esperados,coalesce(se.dias_observados,0) AS dias_observados,
      coalesce(se.dsr_marcado,false) AS dsr_marcado,
      coalesce(se.falta_injustificada,false) AS falta_injustificada,
      coalesce(se.revisar,false) AS revisar,
      (sj.atribuicoes_semana=1 AND sj.carga_semanal_minutos=2640 AND sj.quantidade_dsr=1
        AND sj.domingo_tipo='dsr' AND sj.sabado_tipo='repouso_adicional'
        AND coalesce((sj.dias_semana->'1'->>'ativo')::boolean,false)
        AND coalesce((sj.dias_semana->'2'->>'ativo')::boolean,false)
        AND coalesce((sj.dias_semana->'3'->>'ativo')::boolean,false)
        AND coalesce((sj.dias_semana->'4'->>'ativo')::boolean,false)
        AND coalesce((sj.dias_semana->'5'->>'ativo')::boolean,false)
        AND NOT coalesce((sj.dias_semana->'6'->>'ativo')::boolean,false)
        AND NOT coalesce((sj.dias_semana->'7'->>'ativo')::boolean,false)
        AND (SELECT coalesce(sum(CASE WHEN coalesce((d.value->>'ativo')::boolean,false)
          THEN coalesce((d.value->>'minutos')::integer,0) ELSE 0 END),0)
          FROM jsonb_each(sj.dias_semana) d)=2640) AS jornada_44h_valida,
      (sj.dias_esperados>0 AND coalesce(se.dias_observados,0)=sj.dias_esperados) AS ponto_completo,
      (coalesce(se.dsr_marcado,false) IS DISTINCT FROM coalesce(se.falta_injustificada,false)) AS marcador_inconsistente
    FROM semana_jornada sj
    LEFT JOIN semana_eventos se ON se.funcionario_id=sj.id AND se.week_start=sj.week_start::date
  ), empregado_resumo AS (
    SELECT funcionario_id,max(jornada_nome) AS jornada_nome,max(carga_semanal_minutos)::integer AS carga_semanal_minutos,
      count(*) FILTER(WHERE jornada_44h_valida AND ponto_completo AND NOT revisar
        AND NOT marcador_inconsistente AND dsr_marcado AND falta_injustificada)::integer AS dsr_semanas_perdidas,
      count(*) FILTER(WHERE NOT jornada_44h_valida OR NOT ponto_completo OR revisar OR marcador_inconsistente)::integer AS dsr_pendencias
    FROM semana_resultado GROUP BY funcionario_id
  )
  UPDATE public.fechamento_funcionarios ff
  SET jornada_nome=er.jornada_nome,
      carga_semanal_minutos=er.carga_semanal_minutos,
      divisor_horas=CASE WHEN er.carga_semanal_minutos=2640 THEN 220 ELSE NULL END,
      dsr_semanas_perdidas=coalesce(er.dsr_semanas_perdidas,0),
      dsr_pendencias=coalesce(er.dsr_pendencias,0),
      salario_pendente=(coalesce(f.salario,0)<=0 OR coalesce(f.salario_periodo,'')<>'Mês'),
      dsr_horas=coalesce(er.dsr_semanas_perdidas,0),
      dsr_desconto=CASE WHEN coalesce(f.salario,0)>0 AND f.salario_periodo='Mês'
        THEN round((f.salario/30)*coalesce(er.dsr_semanas_perdidas,0),2) ELSE 0 END,
      ocorrencias=coalesce(ff.ocorrencias,'{}'::jsonb)||jsonb_build_object(
        'versao_regra_dsr','44h-semanal-v1','jornada_nome',er.jornada_nome,
        'carga_semanal_minutos',er.carga_semanal_minutos,'divisor_horas',
        CASE WHEN er.carga_semanal_minutos=2640 THEN 220 ELSE NULL END,
        'dsr_semanas_perdidas',coalesce(er.dsr_semanas_perdidas,0),
        'dsr_pendencias',coalesce(er.dsr_pendencias,0),
        'salario_pendente',(coalesce(f.salario,0)<=0 OR coalesce(f.salario_periodo,'')<>'Mês')),
      observacoes=CASE WHEN coalesce(er.dsr_pendencias,0)>0 OR coalesce(f.salario,0)<=0 OR coalesce(f.salario_periodo,'')<>'Mês'
        THEN 'Prévia bloqueada: revisar jornada, ponto ou salário antes de usar valores.' ELSE ff.observacoes END
  FROM public.funcionarios f
  LEFT JOIN empregado_resumo er ON er.funcionario_id=f.id
  WHERE ff.fechamento_id=v_id AND ff.funcionario_id=f.id AND f.empresa_id=v_usuario.empresa_id
    AND f.tipo_vinculo IN ('formal','clt');

  SELECT count(*) FILTER(WHERE salario_pendente)::integer,
    coalesce(sum(dsr_pendencias),0)::integer,
    coalesce(sum(dsr_semanas_perdidas),0)::integer
  INTO v_salarios_pendentes,v_semanas_pendentes,v_perdidas
  FROM public.fechamento_funcionarios WHERE fechamento_id=v_id;
  SELECT count(*)::integer INTO v_terminados_fora_da_previa
  FROM public.funcionarios f
  WHERE f.empresa_id=v_usuario.empresa_id AND f.tipo_vinculo IN ('formal','clt')
    AND f.ativo=false AND f.data_demissao BETWEEN v_inicio AND v_fim
    AND NOT EXISTS (SELECT 1 FROM public.fechamento_funcionarios ff WHERE ff.fechamento_id=v_id AND ff.funcionario_id=f.id);
  v_pendencias:=v_salarios_pendentes+v_semanas_pendentes+v_importacoes_pendentes+v_terminados_fora_da_previa;
  IF v_divisor<>220 THEN v_pendencias:=v_pendencias+1; END IF;

  v_fingerprint:=public.app_fechamento_source_fingerprint_44h(v_usuario.empresa_id,p_competencia,coalesce(p_incluir_informais_vale,false));
  SELECT jsonb_build_object(
    'funcionarios',count(*),
    'faltas_injustificadas',coalesce(sum(faltas_injustificadas),0),
    'faltas_justificadas',coalesce(sum(faltas_justificadas),0),
    'horas_extras_50',coalesce(sum(horas_extras_50),0),
    'horas_extras_100',coalesce(sum(horas_extras_100),0),
    'extras_50_valor',coalesce(sum(horas_extras_50_valor),0),
    'extras_100_valor',coalesce(sum(horas_extras_100_valor),0),
    'dsr_desconto',coalesce(sum(dsr_desconto),0),
    'dsr_semanas_perdidas',v_perdidas,
    'dsr_pendencias',v_semanas_pendentes,
    'salarios_pendentes',v_salarios_pendentes,
    'importacoes_pendentes',v_importacoes_pendentes,
    'terminados_fora_da_previa',v_terminados_fora_da_previa,
    'pendencias_total',v_pendencias
  ) INTO v_resumo
  FROM public.fechamento_funcionarios WHERE fechamento_id=v_id;

  UPDATE public.fechamentos_mensais
  SET source_fingerprint=v_fingerprint,
    regra_snapshot=jsonb_build_object(
      'versao_regra','v5_44h_dsr_semanal','horas_semanais',44,
      'carga_semanal_minutos',2640,'divisor_horas_configurado',v_divisor,
      'divisor_horas_esperado',220,'dsr_principal','domingo',
      'repouso_adicional','sábado','vigencia_44h_inicio','2026-11-04',
      'vigencia_44h_fim','2026-12-15',
      'criterio_dsr','No máximo uma ocorrência semanal (dsr_horas mantém a unidade histórica de contagem); somente ausência explicitamente injustificada, jornada CLT 44h de segunda a sexta, ponto completo e marcador coincidente. Dúvida ou falta de dados bloqueia a confirmação.',
      'fonte_normativa',jsonb_build_array('Constituição Federal, art. 7º, XIII e XV','Lei 605/1949, arts. 1º, 6º e 7º','CCT 2025–2026 indicada pela empresa como referência operacional vigente'),
      'dsr_semanas_perdidas',v_perdidas,'dsr_pendencias',v_semanas_pendentes,
      'salarios_pendentes',v_salarios_pendentes,'importacoes_pendentes',v_importacoes_pendentes,
      'terminados_fora_da_previa',v_terminados_fora_da_previa,
      'divisor_incompativel',(v_divisor<>220),'pendencias_total',v_pendencias
    ),
    observacoes='Prévia 44h recalculada com DSR semanal; valores financeiros ocultados na interface enquanto houver pendências. Resumo: '||v_resumo::text
  WHERE id=v_id AND empresa_id=v_usuario.empresa_id;

  INSERT INTO public.auditoria_acoes(usuario_id,acao,entidade,entidade_id,detalhes)
  VALUES(v_usuario.usuario_id,'calculou_previa_fechamento_44h','fechamentos_mensais',v_id,
    jsonb_build_object('competencia',p_competencia,'source_fingerprint',v_fingerprint,
      'horas_semanais',44,'divisor_horas',v_divisor,'resumo',v_resumo));
  v_base:=jsonb_set(v_base,'{source_fingerprint}',to_jsonb(v_fingerprint),true);
  v_base:=jsonb_set(v_base,'{resumo}',v_resumo,true);
  v_base:=jsonb_set(v_base,'{mensagem}',to_jsonb(CASE WHEN v_pendencias>0
    THEN 'Prévia calculada, mas bloqueada: corrija as pendências antes de usar valores ou fechar.'
    ELSE 'Prévia 44h calculada e auditável. Revise antes de confirmar.' END),true);
  RETURN v_base;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_visualizar_fechamento(p_token text,p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_usuario record; v_fechamento record; v_resumo jsonb; v_linhas jsonb;
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
  IF v_fechamento.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Prévia não encontrada; calcule antes de consultar'); END IF;
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

CREATE OR REPLACE FUNCTION public.app_admin_confirmar_fechamento(
  p_token text,p_competencia text,p_confirmacao text,p_source_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_usuario record; v_fechamento record; v_atual text; v_pendencias integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia,4)='0000' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  IF upper(trim(coalesce(p_confirmacao,'')))<>'CONFIRMAR' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Digite CONFIRMAR para fechar a competência');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:'||v_usuario.empresa_id::text,0));
  IF p_source_fingerprint IS NULL OR p_source_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Versão da prévia ausente ou inválida; recalcule e revise antes de confirmar');
  END IF;
  SELECT * INTO v_fechamento FROM public.fechamentos_mensais
  WHERE empresa_id=v_usuario.empresa_id AND competencia=p_competencia FOR UPDATE;
  IF v_fechamento.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Prévia não encontrada; calcule antes de confirmar'); END IF;
  IF v_fechamento.status='fechado' THEN RETURN jsonb_build_object('sucesso',true,'status','fechado','mensagem','Competência já estava fechada','source_fingerprint',v_fechamento.source_fingerprint); END IF;
  IF v_fechamento.source_fingerprint IS DISTINCT FROM p_source_fingerprint THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A prévia exibida foi substituída. Recalcule e revise novamente antes de confirmar.');
  END IF;
  IF v_fechamento.regra_snapshot->>'versao_regra'='v5_44h_dsr_semanal' THEN
    v_pendencias:=coalesce((v_fechamento.regra_snapshot->>'pendencias_total')::integer,0);
    IF v_pendencias>0 THEN
      RETURN jsonb_build_object('sucesso',false,'erro',format('Fechamento bloqueado: existem %s pendências de salário, jornada, ponto ou importação. Corrija e recalcule.',v_pendencias));
    END IF;
    v_atual:=public.app_fechamento_source_fingerprint_44h(v_usuario.empresa_id,p_competencia,v_fechamento.incluir_informais_vale);
  ELSE
    v_atual:=public.app_fechamento_source_fingerprint(v_usuario.empresa_id,p_competencia,v_fechamento.incluir_informais_vale);
  END IF;
  IF v_atual IS DISTINCT FROM v_fechamento.source_fingerprint THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Ponto, jornada, salário ou cadastro mudou desde a prévia. Recalcule e revise antes de confirmar.');
  END IF;
  UPDATE public.fechamentos_mensais SET status='fechado',confirmado_por=v_usuario.usuario_id,
    confirmado_at=now(),observacoes=coalesce(observacoes,'')||' Fechamento confirmado pelo gestor.'
  WHERE id=v_fechamento.id AND empresa_id=v_usuario.empresa_id;
  INSERT INTO public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  VALUES(v_usuario.usuario_id,'confirmou_fechamento_folha','fechamentos_mensais',
    jsonb_build_object('fechamento_id',v_fechamento.id,'competencia',p_competencia,
      'source_fingerprint',v_fechamento.source_fingerprint,'status_anterior',v_fechamento.status,'status_novo','fechado'));
  RETURN jsonb_build_object('sucesso',true,'status','fechado','fechamento_id',v_fechamento.id,
    'competencia',p_competencia,'source_fingerprint',v_fechamento.source_fingerprint);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_relatorio_fechamento(
  p_token text,p_competencia text,p_tipo text,p_incluir_informais_vale boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_usuario record; v_fechamento record; v_id uuid; v_rows jsonb; v_include boolean; v_atual text;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia,4)='0000' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('escritorio','vale') THEN RETURN jsonb_build_object('sucesso',false,'erro','Tipo de relatório inválido'); END IF;
  v_include:=coalesce(p_incluir_informais_vale,false);
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:'||v_usuario.empresa_id::text,0));
  SELECT * INTO v_fechamento FROM public.fechamentos_mensais
  WHERE empresa_id=v_usuario.empresa_id AND competencia=p_competencia LIMIT 1;
  IF v_fechamento.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Calcule a prévia antes de emitir o relatório'); END IF;
  IF v_fechamento.status NOT IN ('calculado','fechado') THEN RETURN jsonb_build_object('sucesso',false,'erro','A prévia não está disponível para relatório'); END IF;
  IF p_tipo='vale' AND v_include IS DISTINCT FROM coalesce(v_fechamento.incluir_informais_vale,false) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A opção de informais mudou; recalcule a prévia antes de emitir o relatório');
  END IF;
  IF v_fechamento.regra_snapshot->>'versao_regra'='v5_44h_dsr_semanal'
     AND v_fechamento.status='calculado'
     AND coalesce((v_fechamento.regra_snapshot->>'pendencias_total')::integer,0)>0 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Relatório bloqueado: a prévia tem pendências de salário, jornada, ponto ou importação. Corrija e recalcule antes de exportar.');
  END IF;
  IF v_fechamento.status='calculado' THEN
    IF v_fechamento.source_fingerprint IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','A prévia foi invalidada; recalcule antes de emitir o relatório'); END IF;
    IF v_fechamento.regra_snapshot->>'versao_regra'='v5_44h_dsr_semanal' THEN
      v_atual:=public.app_fechamento_source_fingerprint_44h(v_usuario.empresa_id,p_competencia,v_fechamento.incluir_informais_vale);
    ELSE
      v_atual:=public.app_fechamento_source_fingerprint(v_usuario.empresa_id,p_competencia,v_fechamento.incluir_informais_vale);
    END IF;
    IF v_atual IS DISTINCT FROM v_fechamento.source_fingerprint THEN RETURN jsonb_build_object('sucesso',false,'erro','Os dados mudaram desde a prévia; recalcule antes de emitir o relatório'); END IF;
  END IF;
  v_id:=v_fechamento.id;
  IF p_tipo='escritorio' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.nome,f.cpf,f.cargo,f.registrado,ff.dias_trabalhados,ff.dias_folga,ff.dias_ferias,
        ff.dias_afastamento,ff.faltas,ff.faltas_justificadas,ff.faltas_injustificadas,ff.atrasos_minutos,
        ff.horas_extras_50,ff.horas_extras_50_valor,ff.horas_extras_100,ff.horas_extras_100_valor,
        ff.dsr_horas,ff.dsr_semanas_perdidas AS dsr_ocorrencias,ff.dsr_desconto,ff.hora_base
      FROM public.fechamento_funcionarios ff
      JOIN public.funcionarios f ON f.id=ff.funcionario_id AND f.empresa_id=v_usuario.empresa_id
      WHERE ff.fechamento_id=v_id AND f.elegivel_escritorio=true AND f.registrado=true LIMIT 1000
    ) x;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.nome,f.cpf,f.registrado,ff.faltas_justificadas,ff.faltas_injustificadas,
        ff.vale_elegivel,ff.vale_valor,ff.dsr_desconto
      FROM public.fechamento_funcionarios ff
      JOIN public.funcionarios f ON f.id=ff.funcionario_id AND f.empresa_id=v_usuario.empresa_id
      WHERE ff.fechamento_id=v_id AND ff.vale_elegivel AND (v_include OR f.registrado) LIMIT 1000
    ) x;
  END IF;
  RETURN jsonb_build_object('sucesso',true,'competencia',p_competencia,'tipo',p_tipo,
    'status',v_fechamento.status,'linhas',v_rows,'auditavel',true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.app_admin_calcular_fechamento(text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_admin_confirmar_fechamento(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_fechamento_source_fingerprint_44h(uuid,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_validar_tipo_descanso_jornada() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_admin_calcular_fechamento_44h(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_calcular_fechamento_44h(text,text,boolean) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_admin_visualizar_fechamento(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_visualizar_fechamento(text,text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_admin_confirmar_fechamento(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_confirmar_fechamento(text,text,text,text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_admin_relatorio_fechamento(text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_fechamento(text,text,text,boolean) TO anon, authenticated;

COMMIT;
