-- RF Gestão 0104: campos comerciais obrigatórios da OS e validação mínima de diaristas.
-- Migração aditiva: preserva ordens antigas sem inventar fornecedor, referência ou preço.
-- Não altera a fórmula de DSR; a escala semanal da empresa precisa ser confirmada separadamente.
BEGIN;

ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS fornecedor text,
  ADD COLUMN IF NOT EXISTS referencia text,
  ADD COLUMN IF NOT EXISTS valor_unitario_peca numeric(12,2);

CREATE INDEX IF NOT EXISTS ordens_servico_empresa_fornecedor_referencia_idx
  ON public.ordens_servico (empresa_id, fornecedor, referencia)
  WHERE status <> 'cancelada';

CREATE OR REPLACE FUNCTION public.app_validar_diarista_minimo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.tipo_vinculo = 'diarista' THEN
    IF NEW.data_nascimento IS NULL OR NEW.data_nascimento > CURRENT_DATE THEN
      RAISE EXCEPTION 'Para cadastrar diarista, informe uma data de nascimento válida.';
    END IF;
    IF NULLIF(BTRIM(NEW.cargo), '') IS NULL THEN
      RAISE EXCEPTION 'Para cadastrar diarista, informe o cargo ou a função.';
    END IF;
    IF NEW.valor_diaria IS NULL OR NEW.valor_diaria <= 0 THEN
      RAISE EXCEPTION 'Para cadastrar diarista, informe um valor individual de diária maior que zero.';
    END IF;
    IF COALESCE(NEW.salario, 0) > 0 THEN
      RAISE EXCEPTION 'Diarista não pode receber simultaneamente salário mensal e valor de diária.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_validar_diarista_minimo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS funcionarios_validar_diarista_minimo ON public.funcionarios;
CREATE TRIGGER funcionarios_validar_diarista_minimo
  BEFORE INSERT OR UPDATE OF tipo_vinculo, data_nascimento, cargo, valor_diaria, salario
  ON public.funcionarios
  FOR EACH ROW
  EXECUTE FUNCTION public.app_validar_diarista_minimo();

CREATE OR REPLACE FUNCTION public.app_admin_criar_ordem_painel_v3(
  p_token text,
  p_cliente_id uuid,
  p_fornecedor text,
  p_referencia text,
  p_descricao text,
  p_prioridade text,
  p_prazo date,
  p_observacoes text,
  p_valor_unitario numeric,
  p_tamanhos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_item jsonb;
  v_tamanhos jsonb := '[]'::jsonb;
  v_item_count integer;
  v_unitario numeric(12,2);
  v_resultado jsonb;
  v_ordem_id uuid;
  v_fornecedor text := NULLIF(BTRIM(COALESCE(p_fornecedor, '')), '');
  v_referencia text := NULLIF(BTRIM(COALESCE(p_referencia, '')), '');
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado. Apenas administradores podem cadastrar ordens.');
  END IF;
  IF v_fornecedor IS NULL OR length(v_fornecedor) > 200 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o fornecedor do lote (até 200 caracteres).');
  END IF;
  IF v_referencia IS NULL OR length(v_referencia) > 120 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a referência ou modelo do produto (até 120 caracteres).');
  END IF;
  IF p_valor_unitario IS NULL OR p_valor_unitario <= 0
    OR p_valor_unitario > 9999999999.99
    OR p_valor_unitario <> round(p_valor_unitario, 2) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um valor único por peça, positivo e com no máximo duas casas decimais.');
  END IF;
  IF COALESCE(jsonb_typeof(p_tamanhos), '') <> 'array' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a grade de tamanhos e quantidades.');
  END IF;

  v_item_count := jsonb_array_length(p_tamanhos);
  IF v_item_count < 1 OR v_item_count > 50 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade deve conter entre 1 e 50 tamanhos.');
  END IF;
  v_unitario := p_valor_unitario::numeric(12,2);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    IF COALESCE(jsonb_typeof(v_item), '') <> 'object'
      OR v_item - ARRAY['tamanho', 'quantidade']::text[] <> '{}'::jsonb THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada item da grade deve conter somente tamanho e quantidade.');
    END IF;
    v_tamanhos := v_tamanhos || jsonb_build_array(
      v_item || jsonb_build_object('valor_unitario', v_unitario)
    );
  END LOOP;

  -- Reutiliza a validação transacional já existente para cliente, prioridade,
  -- prazo, tamanhos repetidos, quantidades, limites, cálculo e auditoria da OS.
  v_resultado := public.app_admin_criar_ordem_painel_v2(
    p_token, p_cliente_id, p_descricao, p_prioridade, p_prazo, p_observacoes, v_tamanhos
  );
  IF COALESCE(v_resultado->>'sucesso', 'false') <> 'true' THEN
    RETURN v_resultado;
  END IF;

  v_ordem_id := NULLIF(v_resultado->>'id', '')::uuid;
  IF v_ordem_id IS NULL THEN
    RAISE EXCEPTION 'A RPC de criação não retornou o identificador da ordem.';
  END IF;

  UPDATE public.ordens_servico
  SET fornecedor = v_fornecedor,
      referencia = v_referencia,
      valor_unitario_peca = v_unitario,
      updated_at = now()
  WHERE id = v_ordem_id AND empresa_id = v_usuario.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A ordem não pertence à empresa da sessão.';
  END IF;

  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, depois)
  VALUES (
    v_usuario.empresa_id,
    v_ordem_id,
    v_usuario.usuario_id,
    'ordem_campos_comerciais_incluidos',
    jsonb_build_object(
      'fornecedor', v_fornecedor,
      'referencia', v_referencia,
      'valor_unitario_peca', v_unitario,
      'formula', 'quantidade de cada tamanho × o mesmo valor unitário; total calculado pela RPC de criação'
    )
  );

  RETURN v_resultado || jsonb_build_object(
    'fornecedor', v_fornecedor,
    'referencia', v_referencia,
    'valor_unitario_peca', v_unitario
  );
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Há valores inválidos na ordem. Confira o cliente, os campos comerciais, a grade, o prazo e o valor por peça.');
END;
$function$;

DO $migration$
DECLARE
  v_dashboard text;
  v_fabrica text;
BEGIN
  v_dashboard := pg_get_functiondef('public.app_admin_painel_ordens(text)'::regprocedure);
  IF position('o.descricao, o.status, o.prioridade' IN v_dashboard) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a projeção da RPC app_admin_painel_ordens.';
  END IF;
  v_dashboard := replace(
    v_dashboard,
    'o.descricao, o.status, o.prioridade',
    'o.descricao, o.fornecedor, o.referencia, o.valor_unitario_peca, o.status, o.prioridade'
  );
  EXECUTE v_dashboard;

  v_fabrica := pg_get_functiondef('public.app_admin_painel_fabrica(text)'::regprocedure);
  IF position('o.descricao, o.status, o.prioridade, o.data_entrada' IN v_fabrica) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a projeção da RPC app_admin_painel_fabrica.';
  END IF;
  v_fabrica := replace(
    v_fabrica,
    'o.descricao, o.status, o.prioridade, o.data_entrada',
    'o.descricao, o.fornecedor, o.referencia, o.valor_unitario_peca, o.status, o.prioridade, o.data_entrada'
  );
  EXECUTE v_fabrica;
END;
$migration$;

-- A nova tela usa a RPC v3; revogar a v2 impede gravações futuras sem fornecedor/referência.
REVOKE ALL ON FUNCTION public.app_admin_criar_ordem_painel_v2(text, uuid, text, text, date, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_criar_ordem_painel_v3(text, uuid, text, text, text, text, date, text, numeric, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_criar_ordem_painel_v3(text, uuid, text, text, text, text, date, text, numeric, jsonb)
  TO anon, authenticated;

COMMIT;
