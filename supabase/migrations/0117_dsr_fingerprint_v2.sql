BEGIN;

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
    'version','payroll-close-44h-weekly-dsr-v2',
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

COMMENT ON FUNCTION public.app_fechamento_source_fingerprint_44h(uuid,text,boolean) IS
  'Fingerprint v2 para invalidar prévias calculadas com a regra anterior à distinção entre falta integral e parcial.';

COMMIT;
