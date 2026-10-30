BEGIN;

-- Dados comerciais e financeiros adicionais permanecem ligados à ordem existente.
ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS cliente_nome text,
  ADD COLUMN IF NOT EXISTS status_pagamento text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS pago_em date,
  ADD COLUMN IF NOT EXISTS nota_fiscal_numero text,
  ADD COLUMN IF NOT EXISTS nota_fiscal_emitida_em date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ordens_servico_status_pagamento_check'
      AND conrelid = 'public.ordens_servico'::regclass
  ) THEN
    ALTER TABLE public.ordens_servico
      ADD CONSTRAINT ordens_servico_status_pagamento_check
      CHECK (status_pagamento IN ('pendente', 'pago'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ordens_servico_nota_fiscal_numero_length_check'
      AND conrelid = 'public.ordens_servico'::regclass
  ) THEN
    ALTER TABLE public.ordens_servico
      ADD CONSTRAINT ordens_servico_nota_fiscal_numero_length_check
      CHECK (nota_fiscal_numero IS NULL OR length(nota_fiscal_numero) <= 40);
  END IF;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS public.ordens_servico_numero_seq AS bigint START WITH 1;
CREATE INDEX IF NOT EXISTS idx_ordens_servico_empresa_status_prazo
  ON public.ordens_servico (empresa_id, status, prazo);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_empresa_pagamento_nf
  ON public.ordens_servico (empresa_id, status_pagamento, nota_fiscal_emitida_em);

CREATE TABLE IF NOT EXISTS public.ordens_servico_tamanhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  tamanho text NOT NULL CHECK (length(btrim(tamanho)) BETWEEN 1 AND 24),
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 1000000),
  quantidade_produzida integer NOT NULL DEFAULT 0 CHECK (quantidade_produzida >= 0),
  quantidade_costurada integer NOT NULL DEFAULT 0 CHECK (quantidade_costurada >= 0),
  quantidade_entregue integer NOT NULL DEFAULT 0 CHECK (quantidade_entregue >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ordem_id, tamanho),
  CHECK (quantidade_produzida <= quantidade),
  CHECK (quantidade_costurada <= quantidade_produzida),
  CHECK (quantidade_entregue <= quantidade_costurada)
);
CREATE INDEX IF NOT EXISTS idx_ordens_tamanhos_empresa_ordem
  ON public.ordens_servico_tamanhos (empresa_id, ordem_id, tamanho);

-- Ordens antigas continuam visíveis e ganham uma linha explícita sem inferir a grade real.
INSERT INTO public.ordens_servico_tamanhos (ordem_id, empresa_id, tamanho, quantidade)
SELECT o.id, o.empresa_id, 'Não informado', o.quantidade
FROM public.ordens_servico o
WHERE o.empresa_id IS NOT NULL
  AND o.quantidade > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.ordens_servico_tamanhos s WHERE s.ordem_id = o.id
  );

CREATE TABLE IF NOT EXISTS public.ordens_servico_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  ordem_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  evento text NOT NULL CHECK (evento IN ('ordem_criada', 'status_alterado', 'financeiro_nf_atualizado', 'progresso_atualizado')),
  antes jsonb,
  depois jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordens_auditoria_empresa_ordem
  ON public.ordens_servico_auditoria (empresa_id, ordem_id, created_at DESC);

ALTER TABLE public.ordens_servico_tamanhos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_servico_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ordens_servico_tamanhos, public.ordens_servico_auditoria FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_painel_ordens(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordens jsonb;
  v_resumo jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado. Esta tela é exclusiva de administradores.');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST, x.created_at DESC), '[]'::jsonb)
  INTO v_ordens
  FROM (
    SELECT
      o.id, o.numero, COALESCE(NULLIF(o.cliente_nome, ''), c.nome) AS cliente,
      o.descricao, o.status, o.prioridade, o.data_entrada, o.prazo,
      o.quantidade, o.valor_total, o.observacoes, o.created_at, o.updated_at,
      o.status_pagamento, o.pago_em, o.nota_fiscal_numero, o.nota_fiscal_emitida_em,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id, 'tamanho', s.tamanho, 'quantidade', s.quantidade,
          'quantidade_produzida', s.quantidade_produzida,
          'quantidade_costurada', s.quantidade_costurada,
          'quantidade_entregue', s.quantidade_entregue
        ) ORDER BY s.tamanho)
        FROM public.ordens_servico_tamanhos s
        WHERE s.ordem_id = o.id AND s.empresa_id = v.empresa_id
      ), '[]'::jsonb) AS tamanhos,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
        FROM (
          SELECT a.evento, a.antes, a.depois, a.created_at, u.nome_exibicao AS responsavel
          FROM public.ordens_servico_auditoria a
          LEFT JOIN public.usuarios u ON u.id = a.usuario_id
          WHERE a.ordem_id = o.id AND a.empresa_id = v.empresa_id
          ORDER BY a.created_at DESC
          LIMIT 6
        ) h
      ), '[]'::jsonb) AS historico
    FROM public.ordens_servico o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id AND c.empresa_id = v.empresa_id
    WHERE o.empresa_id = v.empresa_id
    ORDER BY o.prazo NULLS LAST, o.created_at DESC
    LIMIT 500
  ) x;

  SELECT jsonb_build_object(
    'total_ordens', count(*),
    'ordens_ativas', count(*) FILTER (WHERE status NOT IN ('entregue', 'cancelada')),
    'recebidas', count(*) FILTER (WHERE status = 'recebida'),
    'em_producao', count(*) FILTER (WHERE status = 'em_producao'),
    'costuradas', count(*) FILTER (WHERE status = 'costurada'),
    'expedidas', count(*) FILTER (WHERE status = 'expedida'),
    'entregues', count(*) FILTER (WHERE status = 'entregue'),
    'pagas', count(*) FILTER (WHERE status_pagamento = 'pago' AND status <> 'cancelada'),
    'aguardando_pagamento', count(*) FILTER (WHERE status_pagamento = 'pendente' AND status <> 'cancelada'),
    'notas_fiscais_emitidas', count(*) FILTER (WHERE nota_fiscal_emitida_em IS NOT NULL AND status <> 'cancelada'),
    'sem_nota_fiscal', count(*) FILTER (WHERE nota_fiscal_emitida_em IS NULL AND status <> 'cancelada'),
    'vencidas', count(*) FILTER (WHERE prazo < current_date AND status NOT IN ('entregue', 'cancelada')),
    'vencem_em_7_dias', count(*) FILTER (WHERE prazo BETWEEN current_date AND current_date + 7 AND status NOT IN ('entregue', 'cancelada')),
    'valor_ordens_ativas', COALESCE(sum(valor_total) FILTER (WHERE status NOT IN ('entregue', 'cancelada')), 0),
    'valor_aguardando_pagamento', COALESCE(sum(valor_total) FILTER (WHERE status_pagamento = 'pendente' AND status <> 'cancelada'), 0),
    'valor_pago', COALESCE(sum(valor_total) FILTER (WHERE status_pagamento = 'pago' AND status <> 'cancelada'), 0),
    'unidades_total', COALESCE((SELECT sum(s.quantidade) FROM public.ordens_servico_tamanhos s JOIN public.ordens_servico o ON o.id = s.ordem_id WHERE s.empresa_id = v.empresa_id AND o.status <> 'cancelada'), 0),
    'unidades_produzidas', COALESCE((SELECT sum(s.quantidade_produzida) FROM public.ordens_servico_tamanhos s JOIN public.ordens_servico o ON o.id = s.ordem_id WHERE s.empresa_id = v.empresa_id AND o.status <> 'cancelada'), 0),
    'unidades_costuradas', COALESCE((SELECT sum(s.quantidade_costurada) FROM public.ordens_servico_tamanhos s JOIN public.ordens_servico o ON o.id = s.ordem_id WHERE s.empresa_id = v.empresa_id AND o.status <> 'cancelada'), 0),
    'aguardando_costura', COALESCE((SELECT sum(s.quantidade_produzida - s.quantidade_costurada) FROM public.ordens_servico_tamanhos s JOIN public.ordens_servico o ON o.id = s.ordem_id WHERE s.empresa_id = v.empresa_id AND o.status <> 'cancelada'), 0),
    'unidades_entregues', COALESCE((SELECT sum(s.quantidade_entregue) FROM public.ordens_servico_tamanhos s JOIN public.ordens_servico o ON o.id = s.ordem_id WHERE s.empresa_id = v.empresa_id AND o.status <> 'cancelada'), 0)
  )
  INTO v_resumo
  FROM public.ordens_servico
  WHERE empresa_id = v.empresa_id;

  RETURN jsonb_build_object('sucesso', true, 'resumo', v_resumo, 'ordens', v_ordens);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_criar_ordem_painel(
  p_token text,
  p_cliente_nome text,
  p_descricao text,
  p_prioridade text,
  p_prazo date,
  p_valor_total numeric,
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
  v_item jsonb;
  v_nome text;
  v_tamanho text;
  v_prioridade text;
  v_numero text;
  v_ordem_id uuid;
  v_quantidade integer := 0;
  v_tamanhos text[] := ARRAY[]::text[];
  v_item_count integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado. Apenas administradores podem cadastrar ordens.');
  END IF;

  v_nome := NULLIF(btrim(COALESCE(p_cliente_nome, '')), '');
  v_prioridade := lower(btrim(COALESCE(p_prioridade, 'normal')));
  IF v_nome IS NULL OR length(v_nome) > 180 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o nome do cliente (até 180 caracteres).');
  END IF;
  IF NULLIF(btrim(COALESCE(p_descricao, '')), '') IS NULL OR length(btrim(p_descricao)) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a descrição do lote (até 500 caracteres).');
  END IF;
  IF v_prioridade NOT IN ('baixa', 'normal', 'alta', 'urgente') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Prioridade inválida.');
  END IF;
  IF p_prazo IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o prazo previsto para o lote.');
  END IF;
  IF p_valor_total IS NULL OR p_valor_total <= 0 OR p_valor_total > 999999999999.99 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O valor total deve ser maior que zero e ter no máximo duas casas decimais.');
  END IF;
  IF p_valor_total <> round(p_valor_total, 2) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O valor total pode ter no máximo duas casas decimais.');
  END IF;
  IF length(COALESCE(p_observacoes, '')) > 5000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'As observações devem ter até 5.000 caracteres.');
  END IF;
  IF COALESCE(jsonb_typeof(p_tamanhos), '') <> 'array' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a grade de tamanhos e quantidades.');
  END IF;
  v_item_count := jsonb_array_length(p_tamanhos);
  IF v_item_count < 1 OR v_item_count > 50 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade deve conter entre 1 e 50 tamanhos.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    IF COALESCE(jsonb_typeof(v_item), '') <> 'object' OR v_item - ARRAY['tamanho', 'quantidade']::text[] <> '{}'::jsonb THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada item da grade deve conter apenas tamanho e quantidade.');
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
    v_quantidade := v_quantidade + (v_item->>'quantidade')::integer;
    IF v_quantidade > 1000000 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A quantidade total da ordem não pode exceder 1.000.000 de unidades.');
    END IF;
    v_tamanhos := array_append(v_tamanhos, v_tamanho);
  END LOOP;

  LOOP
    v_numero := 'OS-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.ordens_servico_numero_seq')::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.numero = v_numero);
  END LOOP;

  INSERT INTO public.ordens_servico (
    numero, cliente_nome, descricao, status, prioridade, data_entrada,
    prazo, quantidade, valor_total, observacoes, created_by, empresa_id
  ) VALUES (
    v_numero, v_nome, btrim(p_descricao), 'recebida', v_prioridade, current_date,
    p_prazo, v_quantidade, p_valor_total, NULLIF(btrim(COALESCE(p_observacoes, '')), ''), v.usuario_id, v.empresa_id
  ) RETURNING id INTO v_ordem_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    INSERT INTO public.ordens_servico_tamanhos (ordem_id, empresa_id, tamanho, quantidade)
    VALUES (v_ordem_id, v.empresa_id, upper(btrim(v_item->>'tamanho')), (v_item->>'quantidade')::integer);
  END LOOP;

  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, depois)
  VALUES (
    v.empresa_id, v_ordem_id, v.usuario_id, 'ordem_criada',
    jsonb_build_object('numero', v_numero, 'cliente', v_nome, 'descricao', btrim(p_descricao), 'quantidade', v_quantidade, 'valor_total', p_valor_total, 'tamanhos', p_tamanhos)
  );

  RETURN jsonb_build_object('sucesso', true, 'id', v_ordem_id, 'numero', v_numero, 'quantidade', v_quantidade);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não foi possível reservar um número único para a ordem. Tente novamente.');
  WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Há valores inválidos na ordem. Confira a grade, o prazo e o valor.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_status(
  p_token text,
  p_ordem_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_status text;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;

  v_status := lower(btrim(COALESCE(p_status, '')));
  IF v_status NOT IN ('recebida', 'em_producao', 'costurada', 'expedida', 'entregue', 'cancelada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Status operacional inválido.');
  END IF;

  SELECT id, numero, status, prioridade, prazo, quantidade, valor_total
  INTO v_ordem
  FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;
  IF v_ordem.status = v_status THEN
    RETURN jsonb_build_object('sucesso', true, 'status', v_status, 'alterado', false);
  END IF;
  IF v_status = 'entregue' AND COALESCE((
    SELECT sum(s.quantidade_entregue)
    FROM public.ordens_servico_tamanhos s
    WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id
  ), 0) < v_ordem.quantidade THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Atualize as quantidades entregues de todos os tamanhos antes de concluir a ordem.');
  END IF;

  v_antes := to_jsonb(v_ordem);
  UPDATE public.ordens_servico
  SET status = v_status, updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status', status, 'updated_at', updated_at) INTO v_depois;

  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'status_alterado', v_antes, v_depois);

  RETURN jsonb_build_object('sucesso', true, 'status', v_status, 'alterado', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_financeiro(
  p_token text,
  p_ordem_id uuid,
  p_status_pagamento text,
  p_nota_fiscal_numero text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_status_pagamento text;
  v_nota text;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;

  v_status_pagamento := lower(btrim(COALESCE(p_status_pagamento, '')));
  v_nota := NULLIF(btrim(COALESCE(p_nota_fiscal_numero, '')), '');
  IF v_status_pagamento NOT IN ('pendente', 'pago') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Status de pagamento inválido.');
  END IF;
  IF v_nota IS NOT NULL AND length(v_nota) > 40 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O número da nota fiscal deve ter até 40 caracteres.');
  END IF;

  SELECT status_pagamento, pago_em, nota_fiscal_numero, nota_fiscal_emitida_em
  INTO v_ordem
  FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;

  v_antes := to_jsonb(v_ordem);
  UPDATE public.ordens_servico
  SET status_pagamento = v_status_pagamento,
      pago_em = CASE WHEN v_status_pagamento = 'pago' THEN COALESCE(pago_em, current_date) ELSE NULL END,
      nota_fiscal_numero = v_nota,
      nota_fiscal_emitida_em = CASE
        WHEN v_nota IS NULL THEN NULL
        WHEN v_nota IS DISTINCT FROM nota_fiscal_numero OR nota_fiscal_emitida_em IS NULL THEN current_date
        ELSE nota_fiscal_emitida_em
      END,
      updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status_pagamento', status_pagamento, 'pago_em', pago_em, 'nota_fiscal_numero', nota_fiscal_numero, 'nota_fiscal_emitida_em', nota_fiscal_emitida_em) INTO v_depois;

  IF v_antes IS DISTINCT FROM v_depois THEN
    INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
    VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'financeiro_nf_atualizado', v_antes, v_depois);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'status_pagamento', v_status_pagamento, 'nota_fiscal_numero', v_nota);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_progresso(
  p_token text,
  p_ordem_id uuid,
  p_tamanhos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_item jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_produzida integer;
  v_costurada integer;
  v_entregue integer;
  v_quantidade integer;
  v_antes jsonb;
  v_depois jsonb;
  v_count integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  IF COALESCE(jsonb_typeof(p_tamanhos), '') <> 'array' OR jsonb_array_length(p_tamanhos) > 50 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma atualização válida para a grade.');
  END IF;

  PERFORM 1 FROM public.ordens_servico o
  WHERE o.id = p_ordem_id AND o.empresa_id = v.empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ordens_servico_tamanhos s
  WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;
  IF v_count < 1 OR jsonb_array_length(p_tamanhos) <> v_count THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A atualização precisa conter todas as linhas de tamanho da ordem.');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'tamanho', s.tamanho, 'quantidade', s.quantidade,
    'quantidade_produzida', s.quantidade_produzida,
    'quantidade_costurada', s.quantidade_costurada,
    'quantidade_entregue', s.quantidade_entregue
  ) ORDER BY s.tamanho), '[]'::jsonb)
  INTO v_antes
  FROM public.ordens_servico_tamanhos s
  WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    IF COALESCE(jsonb_typeof(v_item), '') <> 'object'
      OR v_item - ARRAY['id', 'quantidade_produzida', 'quantidade_costurada', 'quantidade_entregue']::text[] <> '{}'::jsonb THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A atualização de progresso contém campos inválidos.');
    END IF;
    IF COALESCE(v_item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Identificador de tamanho inválido.');
    END IF;
    v_id := (v_item->>'id')::uuid;
    IF v_id = ANY(v_ids) THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade contém uma linha repetida.');
    END IF;
    v_ids := array_append(v_ids, v_id);
    IF COALESCE(v_item->>'quantidade_produzida', '') !~ '^[0-9]{1,7}$'
      OR COALESCE(v_item->>'quantidade_costurada', '') !~ '^[0-9]{1,7}$'
      OR COALESCE(v_item->>'quantidade_entregue', '') !~ '^[0-9]{1,7}$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'As quantidades precisam ser números inteiros não negativos.');
    END IF;

    v_produzida := (v_item->>'quantidade_produzida')::integer;
    v_costurada := (v_item->>'quantidade_costurada')::integer;
    v_entregue := (v_item->>'quantidade_entregue')::integer;

    SELECT s.quantidade INTO v_quantidade
    FROM public.ordens_servico_tamanhos s
    WHERE s.id = v_id AND s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Uma linha de tamanho não pertence a esta ordem.');
    END IF;
    IF v_entregue > v_costurada OR v_costurada > v_produzida OR v_produzida > v_quantidade THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Revise a sequência das quantidades: entregue ≤ costurada ≤ produzida ≤ solicitada.');
    END IF;
  END LOOP;

  IF cardinality(v_ids) <> v_count THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A atualização precisa incluir cada tamanho da ordem uma única vez.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    v_id := (v_item->>'id')::uuid;
    UPDATE public.ordens_servico_tamanhos s
    SET quantidade_produzida = (v_item->>'quantidade_produzida')::integer,
        quantidade_costurada = (v_item->>'quantidade_costurada')::integer,
        quantidade_entregue = (v_item->>'quantidade_entregue')::integer,
        updated_at = now()
    WHERE s.id = v_id AND s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'tamanho', s.tamanho, 'quantidade', s.quantidade,
    'quantidade_produzida', s.quantidade_produzida,
    'quantidade_costurada', s.quantidade_costurada,
    'quantidade_entregue', s.quantidade_entregue
  ) ORDER BY s.tamanho), '[]'::jsonb)
  INTO v_depois
  FROM public.ordens_servico_tamanhos s
  WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;

  IF v_antes IS DISTINCT FROM v_depois THEN
    INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
    VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'progresso_atualizado', v_antes, v_depois);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'tamanhos', v_depois);
END;
$function$;

-- Endpoints antigos permanecem protegidos e no tenant correto; criação manual deixa de ser permitida.
CREATE OR REPLACE FUNCTION public.app_listar_ordens(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado. Esta tela é exclusiva de administradores.');
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST, x.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT o.id, o.numero, o.descricao, o.status, o.prioridade, o.data_entrada, o.prazo,
      o.quantidade, o.valor_total, COALESCE(NULLIF(o.cliente_nome, ''), c.nome) AS cliente, o.created_at
    FROM public.ordens_servico o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id AND c.empresa_id = v.empresa_id
    WHERE o.empresa_id = v.empresa_id
    ORDER BY o.prazo NULLS LAST, o.created_at DESC
    LIMIT 500
  ) x;
  RETURN jsonb_build_object('sucesso', true, 'ordens', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem(p_token text, p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado. Esta tela é exclusiva de administradores.');
  END IF;
  IF COALESCE(p_status, '') NOT IN ('recebida', 'em_producao', 'costurada', 'expedida', 'entregue', 'cancelada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Status inválido.');
  END IF;

  SELECT jsonb_build_object('status', status) INTO v_antes
  FROM public.ordens_servico WHERE id = p_id AND empresa_id = v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.');
  END IF;
  UPDATE public.ordens_servico
  SET status = p_status, updated_at = now()
  WHERE id = p_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status', status, 'updated_at', updated_at) INTO v_depois;
  IF v_antes IS DISTINCT FROM v_depois THEN
    INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
    VALUES (v.empresa_id, p_id, v.usuario_id, 'status_alterado', v_antes, v_depois);
  END IF;
  RETURN jsonb_build_object('sucesso', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_admin_painel_ordens(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_criar_ordem_painel(text, text, text, text, date, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem_status(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem_financeiro(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem_progresso(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_listar_ordens(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_ordem(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_criar_ordem(text, text, text, text, date, integer, numeric, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.app_admin_painel_ordens(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_criar_ordem_painel(text, text, text, text, date, numeric, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem_status(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem_financeiro(text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem_progresso(text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_ordens(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ordem(text, uuid, text) TO anon, authenticated;

COMMIT;
