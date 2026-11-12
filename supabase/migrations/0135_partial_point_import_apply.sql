-- Aplicação parcial de ponto: grava linhas válidas e preserva inconsistências para revisão.
-- Linhas sem CPF/funcionário/data/horário válido nunca são gravadas.
CREATE OR REPLACE FUNCTION public.app_aplicar_importacao_ponto(
  p_token text,
  p_importacao_id uuid,
  p_confirmar_substituicao boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_importacao record;
  v_total_validas integer := 0;
  v_aplicadas integer := 0;
  v_existentes integer := 0;
  v_invalidas integer := 0;
  v_duplicadas integer := 0;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  SELECT * INTO v_importacao
  FROM public.ponto_importacoes
  WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id
  FOR UPDATE;
  IF v_importacao.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Importação não encontrada');
  END IF;
  IF v_importacao.status <> 'pendente' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Esta importação já foi processada');
  END IF;

  SELECT count(*)::integer INTO v_invalidas
  FROM public.ponto_import_linhas l
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND (l.funcionario_id IS NULL OR l.data IS NULL OR NOT COALESCE(l.encontrado, false)
      OR NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NOT NULL);

  SELECT count(*)::integer INTO v_duplicadas FROM (
    SELECT l.funcionario_id, l.data
    FROM public.ponto_import_linhas l
    WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
      AND l.funcionario_id IS NOT NULL AND l.data IS NOT NULL AND COALESCE(l.encontrado, false)
      AND NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NULL
    GROUP BY l.funcionario_id, l.data HAVING count(*) > 1
  ) duplicates;
  IF v_duplicadas > 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'Há mais de uma linha válida para o mesmo funcionário e data. Corrija o arquivo antes de aplicar.',
      'chaves_duplicadas', v_duplicadas);
  END IF;

  SELECT count(*)::integer INTO v_total_validas
  FROM public.ponto_import_linhas l
  JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND l.encontrado AND l.data IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NULL;

  INSERT INTO public.registros_ponto(
    empresa_id, funcionario_id, data, entrada, saida_almoco, volta_almoco, saida, status
  )
  SELECT v_usuario.empresa_id, l.funcionario_id, l.data, l.entrada_1,
    l.saida_1, l.entrada_2, l.saida_2,
    CASE WHEN COALESCE(BTRIM(l.dia_falta), '') <> '' THEN 'falta' ELSE 'normal' END
  FROM public.ponto_import_linhas l
  JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND l.encontrado AND l.funcionario_id IS NOT NULL AND l.data IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NULL
  ON CONFLICT (funcionario_id, data) DO NOTHING;
  GET DIAGNOSTICS v_aplicadas = ROW_COUNT;
  v_existentes := greatest(v_total_validas - v_aplicadas, 0);

  UPDATE public.ponto_importacoes
  SET status = 'aplicada', applied_at = now(), applied_by = v_usuario.usuario_id
  WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (v_usuario.usuario_id, 'aplicou_importacao_ponto_preservando_existentes', 'ponto_importacoes',
    jsonb_build_object('importacao_id', p_importacao_id, 'linhas_inseridas', v_aplicadas,
      'registros_existentes_preservados', v_existentes,
      'linhas_com_inconsistencia', v_importacao.linhas_com_inconsistencia,
      'politica', 'insert_do_nothing'));

  RETURN jsonb_build_object('sucesso', true, 'status', 'aplicada',
    'linhas_aplicadas', v_aplicadas, 'linhas_inseridas', v_aplicadas,
    'registros_existentes_preservados', v_existentes,
    'linhas_com_inconsistencia', v_importacao.linhas_com_inconsistencia,
      'linhas_ignoradas', v_invalidas, 'politica', 'aplicacao_parcial');
END;
$function$;
