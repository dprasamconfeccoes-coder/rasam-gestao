BEGIN;

-- Alinha a fila ao fluxo atual de upload, que exige vínculo ativo.
CREATE OR REPLACE FUNCTION public.app_admin_holerites_competencia_resumo(
  p_token text,
  p_competencia text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_usuario record;
  v_inicio date;
  v_fim date;
  v_total integer := 0;
  v_recebidos integer := 0;
  v_ausentes integer := 0;
  v_reenvio integer := 0;
  v_pendencias jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('gestor','admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM');
  END IF;

  v_inicio := to_date(p_competencia || '-01','YYYY-MM-DD');
  v_fim := (v_inicio + interval '1 month - 1 day')::date;

  WITH elegiveis AS (
    SELECT f.id AS funcionario_id, f.nome,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.holerites h
          WHERE h.empresa_id=v_usuario.empresa_id AND h.funcionario_id=f.id
            AND h.mes=extract(month FROM v_inicio)::integer
            AND h.ano=extract(year FROM v_inicio)::integer
            AND coalesce(h.disponivel,false)=true
            AND nullif(btrim(h.storage_path),'') IS NOT NULL
            AND h.mime_type='application/pdf'
        ) THEN 'recebido'
        WHEN EXISTS (
          SELECT 1 FROM public.holerites h
          WHERE h.empresa_id=v_usuario.empresa_id AND h.funcionario_id=f.id
            AND h.mes=extract(month FROM v_inicio)::integer
            AND h.ano=extract(year FROM v_inicio)::integer
        ) THEN 'reenvio'
        ELSE 'ausente'
      END AS status
    FROM public.funcionarios f
    WHERE f.empresa_id=v_usuario.empresa_id
      AND coalesce(f.ativo,false)=true
      AND coalesce(f.elegivel_holerite, f.tipo_vinculo='formal')=true
      AND (f.data_admissao IS NULL OR f.data_admissao<=v_fim)
      AND (coalesce(f.data_saida,f.data_demissao) IS NULL
           OR coalesce(f.data_saida,f.data_demissao)>=v_inicio)
  )
  SELECT count(*)::integer,
         count(*) FILTER (WHERE status='recebido')::integer,
         count(*) FILTER (WHERE status='ausente')::integer,
         count(*) FILTER (WHERE status='reenvio')::integer,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'funcionario_id', p.funcionario_id,
             'nome', p.nome,
             'status', p.status
           ) ORDER BY p.nome)
           FROM (SELECT funcionario_id,nome,status FROM elegiveis
                 WHERE status<>'recebido' ORDER BY nome LIMIT 1000) p
         ),'[]'::jsonb)
    INTO v_total,v_recebidos,v_ausentes,v_reenvio,v_pendencias
  FROM elegiveis;

  RETURN jsonb_build_object(
    'sucesso',true,
    'competencia',p_competencia,
    'funcionarios_elegiveis',v_total,
    'holerites_privados_recebidos',v_recebidos,
    'holerites_ausentes',v_ausentes,
    'holerites_reenvio',v_reenvio,
    'pendencias_total',v_ausentes+v_reenvio,
    'pendencias_limitadas',v_ausentes+v_reenvio>1000,
    'cobertura_percentual',CASE WHEN v_total=0 THEN NULL ELSE round(v_recebidos*100.0/v_total,1) END,
    'pendencias',v_pendencias,
    'escopo','Vínculos ativos e elegíveis na competência; conta PDFs privados disponíveis. Não confirma processamento ou pagamento da folha pelo escritório.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.app_admin_holerites_competencia_resumo(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_holerites_competencia_resumo(text,text) TO anon,authenticated;

COMMIT;
