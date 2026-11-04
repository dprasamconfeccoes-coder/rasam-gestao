-- Re-read the source's finance link after the AFTER trigger completes.
-- UPDATE ... RETURNING can expose the pre-trigger link value when the trigger
-- fills financeiro_lancamento_id through a nested UPDATE.

CREATE OR REPLACE FUNCTION public.app_admin_lancar_beneficio_financeiro(
  p_token text,
  p_funcionario_id uuid,
  p_beneficio_nome text,
  p_competencia date,
  p_valor numeric DEFAULT NULL::numeric,
  p_status text DEFAULT 'liberado'::text,
  p_motivo text DEFAULT NULL::text,
  p_observacoes text DEFAULT NULL::text,
  p_fornecedor text DEFAULT NULL::text,
  p_vencimento date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
  v_id uuid;
  v_financeiro_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF p_valor < 0 OR length(COALESCE(p_fornecedor, '')) > 200 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor ou fornecedor inválido');
  END IF;

  v_result := public.app_admin_lancar_beneficio(
    p_token, p_funcionario_id, p_beneficio_nome, p_competencia,
    p_valor, p_status, p_motivo, p_observacoes
  );
  IF COALESCE((v_result->>'sucesso')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_id := (v_result->>'id')::uuid;
  UPDATE public.rh_beneficios_lancamentos
  SET fornecedor = NULLIF(btrim(COALESCE(p_fornecedor, '')), ''),
      vencimento = p_vencimento
  WHERE id = v_id AND empresa_id = v.empresa_id;

  SELECT b.financeiro_lancamento_id INTO v_financeiro_id
  FROM public.rh_beneficios_lancamentos b
  WHERE b.id = v_id AND b.empresa_id = v.empresa_id
  LIMIT 1;

  RETURN v_result || jsonb_build_object(
    'financeiro_gerado', v_financeiro_id IS NOT NULL,
    'financeiro_lancamento_id', v_financeiro_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_lancar_desconto_financeiro(
  p_token text,
  p_funcionario_id uuid,
  p_tipo text,
  p_fornecedor text,
  p_descricao text,
  p_competencia date,
  p_valor numeric,
  p_status text DEFAULT 'lancado'::text,
  p_observacoes text DEFAULT NULL::text,
  p_vencimento date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
  v_id uuid;
  v_financeiro_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF length(COALESCE(p_fornecedor, '')) > 200 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Fornecedor inválido');
  END IF;

  v_result := public.app_admin_lancar_desconto(
    p_token, p_funcionario_id, p_tipo, p_fornecedor, p_descricao,
    p_competencia, p_valor, p_status, p_observacoes
  );
  IF COALESCE((v_result->>'sucesso')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_id := (v_result->>'id')::uuid;
  UPDATE public.rh_descontos_lancamentos
  SET vencimento = p_vencimento
  WHERE id = v_id AND empresa_id = v.empresa_id;

  SELECT d.financeiro_lancamento_id INTO v_financeiro_id
  FROM public.rh_descontos_lancamentos d
  WHERE d.id = v_id AND d.empresa_id = v.empresa_id
  LIMIT 1;

  RETURN v_result || jsonb_build_object(
    'financeiro_gerado', v_financeiro_id IS NOT NULL,
    'financeiro_lancamento_id', v_financeiro_id
  );
END;
$function$;
