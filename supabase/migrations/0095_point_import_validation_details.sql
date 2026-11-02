BEGIN;

CREATE OR REPLACE FUNCTION public.app_listar_ponto_importado(
  p_token text,
  p_tipo text DEFAULT NULL::text,
  p_importacao_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_usuario
  FROM public.app_tenant_usuario(p_token)
  LIMIT 1;

  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.data DESC NULLS LAST, x.nome_csv), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      l.id,
      l.cpf,
      l.raw_data->>'cpf_arquivo' AS cpf_arquivo,
      CASE
        WHEN jsonb_typeof(l.raw_data->'import_validation_errors') = 'array'
          THEN l.raw_data->'import_validation_errors'
        ELSE '[]'::jsonb
      END AS import_validation_errors,
      l.nome_csv,
      l.data,
      l.entrada_1,
      l.saida_1,
      l.entrada_2,
      l.saida_2,
      l.total_normais,
      l.extra_50,
      l.extra_100,
      l.dia_falta,
      l.horas_atraso,
      l.justificativas,
      l.encontrado,
      l.inconsistencia,
      i.tipo,
      i.competencia,
      i.status
    FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i
      ON i.id = l.importacao_id
     AND l.empresa_id = i.empresa_id
    LEFT JOIN public.funcionarios f
      ON f.id = l.funcionario_id
     AND f.empresa_id = i.empresa_id
    WHERE i.empresa_id = v_usuario.empresa_id
      AND l.empresa_id = v_usuario.empresa_id
      AND (l.funcionario_id IS NULL OR f.id IS NOT NULL)
      AND (p_tipo IS NULL OR i.tipo = p_tipo)
      AND (p_importacao_id IS NULL OR i.id = p_importacao_id)
    ORDER BY l.data DESC NULLS LAST, l.nome_csv
    LIMIT 1500
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'registros', v_result);
END;
$function$;

COMMIT;
