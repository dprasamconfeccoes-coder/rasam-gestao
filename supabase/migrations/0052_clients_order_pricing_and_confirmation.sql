BEGIN;

ALTER TABLE public.ordens_servico_tamanhos
  ADD COLUMN IF NOT EXISTS valor_unitario numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor_unitario >= 0);

CREATE INDEX IF NOT EXISTS idx_clientes_empresa_nome_normalizado
  ON public.clientes (empresa_id, lower(btrim(nome)))
  WHERE ativo = true;

CREATE OR REPLACE FUNCTION public.app_admin_buscar_clientes_ordem(p_token text, p_busca text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_busca text;
  v_clientes jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  v_busca := btrim(COALESCE(p_busca, ''));
  IF length(v_busca) > 120 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A busca deve ter até 120 caracteres.');
  END IF;
  IF length(v_busca) < 2 THEN
    RETURN jsonb_build_object('sucesso', true, 'clientes', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome), '[]'::jsonb)
  INTO v_clientes
  FROM (
    SELECT id, nome
    FROM public.clientes
    WHERE empresa_id = v.empresa_id
      AND ativo = true
      AND position(lower(v_busca) in lower(nome)) > 0
    ORDER BY nome
    LIMIT 10
  ) c;
  RETURN jsonb_build_object('sucesso', true, 'clientes', v_clientes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_criar_cliente_ordem(p_token text, p_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_nome text;
  v_cliente record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  v_nome := NULLIF(btrim(COALESCE(p_nome, '')), '');
  IF v_nome IS NULL OR length(v_nome) > 180 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um nome de cliente com até 180 caracteres.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v.empresa_id::text || ':' || lower(v_nome), 0));
  SELECT id, nome INTO v_cliente
  FROM public.clientes
  WHERE empresa_id = v.empresa_id AND lower(btrim(nome)) = lower(v_nome) AND ativo = true
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('sucesso', true, 'id', v_cliente.id, 'nome', v_cliente.nome, 'existente', true);
  END IF;

  INSERT INTO public.clientes (nome, ativo, empresa_id)
  VALUES (v_nome, true, v.empresa_id)
  RETURNING id, nome INTO v_cliente;
  RETURN jsonb_build_object('sucesso', true, 'id', v_cliente.id, 'nome', v_cliente.nome, 'existente', false);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível cadastrar o cliente. Atualize a busca e tente novamente.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_criar_ordem_painel_v2(
  p_token text,
  p_cliente_id uuid,
  p_descricao text,
  p_prioridade text,
  p_prazo date,
  p_observacoes text,
  p_tamanhos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_cliente record;
  v_item jsonb;
  v_nome text;
  v_tamanho text;
  v_prioridade text;
  v_numero text;
  v_ordem_id uuid;
  v_quantidade integer := 0;
  v_unitario numeric(12,2);
  v_total numeric(14,2) := 0;
  v_tamanhos text[] := ARRAY[]::text[];
  v_item_count integer;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado. Apenas administradores podem cadastrar ordens.');
  END IF;

  SELECT id, nome INTO v_cliente
  FROM public.clientes
  WHERE id = p_cliente_id AND empresa_id = v.empresa_id AND ativo = true
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione um cliente ativo cadastrado nesta empresa.');
  END IF;
  v_nome := v_cliente.nome;
  v_prioridade := lower(btrim(COALESCE(p_prioridade, 'normal')));
  IF NULLIF(btrim(COALESCE(p_descricao, '')), '') IS NULL OR length(btrim(p_descricao)) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a descrição do lote (até 500 caracteres).');
  END IF;
  IF v_prioridade NOT IN ('baixa', 'normal', 'alta', 'urgente') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Prioridade inválida.');
  END IF;
  IF p_prazo IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o prazo previsto para o lote.');
  END IF;
  IF length(COALESCE(p_observacoes, '')) > 5000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'As observações devem ter até 5.000 caracteres.');
  END IF;
  IF COALESCE(jsonb_typeof(p_tamanhos), '') <> 'array' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a grade de tamanhos, quantidades e valores unitários.');
  END IF;
  v_item_count := jsonb_array_length(p_tamanhos);
  IF v_item_count < 1 OR v_item_count > 50 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade deve conter entre 1 e 50 tamanhos.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    IF COALESCE(jsonb_typeof(v_item), '') <> 'object'
      OR v_item - ARRAY['tamanho', 'quantidade', 'valor_unitario']::text[] <> '{}'::jsonb THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada item da grade deve conter apenas tamanho, quantidade e valor unitário.');
    END IF;
    v_tamanho := upper(btrim(COALESCE(v_item->>'tamanho', '')));
    IF v_tamanho = '' OR length(v_tamanho) > 24 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um nome de tamanho válido (até 24 caracteres).');
    END IF;
    IF v_tamanho = ANY(v_tamanhos) THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Há tamanhos repetidos na grade.');
    END IF;
    IF COALESCE(v_item->>'quantidade', '') !~ '^[0-9]{1,7}$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A quantidade de cada tamanho deve ser um número inteiro positivo.');
    END IF;
    IF (v_item->>'quantidade')::integer < 1 OR (v_item->>'quantidade')::integer > 1000000 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A quantidade por tamanho deve ficar entre 1 e 1.000.000.');
    END IF;
    IF COALESCE(v_item->>'valor_unitario', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o valor unitário com no máximo duas casas decimais.');
    END IF;
    v_unitario := (v_item->>'valor_unitario')::numeric;
    IF v_unitario <= 0 OR v_unitario > 9999999999.99 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O valor unitário deve ser maior que zero e estar dentro do limite permitido.');
    END IF;
    v_quantidade := v_quantidade + (v_item->>'quantidade')::integer;
    IF v_quantidade > 1000000 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A quantidade total da ordem não pode exceder 1.000.000 de unidades.');
    END IF;
    v_total := v_total + ((v_item->>'quantidade')::integer * v_unitario);
    IF v_total > 999999999999.99 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O valor total calculado excede o limite permitido.');
    END IF;
    v_tamanhos := array_append(v_tamanhos, v_tamanho);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'tamanho', v_tamanho,
      'quantidade', (v_item->>'quantidade')::integer,
      'valor_unitario', v_unitario,
      'subtotal', round((v_item->>'quantidade')::integer * v_unitario, 2)
    ));
  END LOOP;
  v_total := round(v_total, 2);

  LOOP
    v_numero := 'OS-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.ordens_servico_numero_seq')::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.numero = v_numero);
  END LOOP;

  INSERT INTO public.ordens_servico (
    numero, cliente_id, cliente_nome, descricao, status, prioridade, data_entrada,
    prazo, quantidade, valor_total, observacoes, created_by, empresa_id
  ) VALUES (
    v_numero, v_cliente.id, v_nome, btrim(p_descricao), 'recebida', v_prioridade, current_date,
    p_prazo, v_quantidade, v_total, NULLIF(btrim(COALESCE(p_observacoes, '')), ''), v.usuario_id, v.empresa_id
  ) RETURNING id INTO v_ordem_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    INSERT INTO public.ordens_servico_tamanhos (ordem_id, empresa_id, tamanho, quantidade, valor_unitario)
    VALUES (v_ordem_id, v.empresa_id, upper(btrim(v_item->>'tamanho')), (v_item->>'quantidade')::integer, (v_item->>'valor_unitario')::numeric);
  END LOOP;

  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, depois)
  VALUES (v.empresa_id, v_ordem_id, v.usuario_id, 'ordem_criada', jsonb_build_object(
    'numero', v_numero, 'cliente_id', v_cliente.id, 'cliente', v_nome, 'descricao', btrim(p_descricao),
    'quantidade', v_quantidade, 'valor_total', v_total,
    'memoria_calculo', jsonb_build_object('formula', 'soma de quantidade × valor_unitário por tamanho', 'itens', v_itens, 'total', v_total)
  ));

  RETURN jsonb_build_object('sucesso', true, 'id', v_ordem_id, 'numero', v_numero,
    'cliente_id', v_cliente.id, 'cliente_nome', v_nome, 'quantidade', v_quantidade, 'valor_total', v_total, 'itens', v_itens);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível reservar um número único para a ordem. Tente novamente.');
  WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Há valores inválidos na ordem. Confira o cliente, a grade, o prazo e os valores unitários.');
END;
$function$;

DO $migration$
DECLARE
  v_dashboard text;
BEGIN
  v_dashboard := pg_get_functiondef('public.app_admin_painel_ordens(text)'::regprocedure);
  IF position('''quantidade'', s.quantidade,' in v_dashboard) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a grade do painel de ordens para incluir valor unitário.';
  END IF;
  v_dashboard := replace(v_dashboard, '''quantidade'', s.quantidade,', '''quantidade'', s.quantidade, ''valor_unitario'', s.valor_unitario,');
  EXECUTE v_dashboard;
END;
$migration$;

REVOKE ALL ON FUNCTION public.app_admin_buscar_clientes_ordem(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_criar_cliente_ordem(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_criar_ordem_painel_v2(text, uuid, text, text, date, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_buscar_clientes_ordem(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_criar_cliente_ordem(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_criar_ordem_painel_v2(text, uuid, text, text, date, text, jsonb) TO anon, authenticated;

COMMIT;
