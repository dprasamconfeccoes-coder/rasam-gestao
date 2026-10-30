BEGIN;

ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS producao_iniciada_em timestamptz,
  ADD COLUMN IF NOT EXISTS producao_concluida_em timestamptz,
  ADD COLUMN IF NOT EXISTS financeiro_liberado_em timestamptz,
  ADD COLUMN IF NOT EXISTS financeiro_liberado_por uuid REFERENCES public.usuarios(id);

ALTER TABLE public.ordens_servico_auditoria
  DROP CONSTRAINT IF EXISTS ordens_servico_auditoria_evento_check;
ALTER TABLE public.ordens_servico_auditoria
  ADD CONSTRAINT ordens_servico_auditoria_evento_check
  CHECK (evento IN (
    'ordem_criada', 'status_alterado', 'financeiro_nf_atualizado', 'progresso_atualizado',
    'financeiro_liberado', 'documento_adicionado'
  ));

CREATE TABLE IF NOT EXISTS public.ordens_servico_producao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  ordem_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  evento text NOT NULL CHECK (evento IN (
    'producao_iniciada', 'progresso_atualizado', 'entrega_parcial',
    'entrega_completa', 'financeiro_liberado'
  )),
  unidades_produzidas_delta integer NOT NULL DEFAULT 0,
  unidades_costuradas_delta integer NOT NULL DEFAULT 0,
  unidades_entregues_delta integer NOT NULL DEFAULT 0,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordens_producao_eventos_empresa_data
  ON public.ordens_servico_producao_eventos (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ordens_producao_eventos_ordem_data
  ON public.ordens_servico_producao_eventos (ordem_id, created_at DESC);
ALTER TABLE public.ordens_servico_producao_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ordens_servico_producao_eventos FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ordens_servico_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  ordem_id uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('nota_fiscal', 'comprovante_pagamento')),
  storage_path text NOT NULL UNIQUE,
  nome_arquivo text NOT NULL CHECK (length(btrim(nome_arquivo)) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordens_documentos_empresa_ordem
  ON public.ordens_servico_documentos (empresa_id, ordem_id, created_at DESC);
ALTER TABLE public.ordens_servico_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ordens_servico_documentos FROM PUBLIC, anon, authenticated;

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
      o.producao_iniciada_em, o.producao_concluida_em, o.financeiro_liberado_em,
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
        SELECT jsonb_agg(jsonb_build_object(
          'id', d.id, 'tipo', d.tipo, 'nome_arquivo', d.nome_arquivo,
          'mime_type', d.mime_type, 'tamanho_bytes', d.tamanho_bytes, 'created_at', d.created_at
        ) ORDER BY d.created_at DESC)
        FROM public.ordens_servico_documentos d
        WHERE d.ordem_id = o.id AND d.empresa_id = v.empresa_id
      ), '[]'::jsonb) AS documentos,
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
    'aguardando_pagamento', count(*) FILTER (WHERE status_pagamento = 'pendente' AND (financeiro_liberado_em IS NOT NULL OR status = 'entregue') AND status <> 'cancelada'),
    'notas_fiscais_emitidas', count(*) FILTER (WHERE nota_fiscal_emitida_em IS NOT NULL AND status <> 'cancelada'),
    'sem_nota_fiscal', count(*) FILTER (WHERE nota_fiscal_emitida_em IS NULL AND status <> 'cancelada'),
    'vencidas', count(*) FILTER (WHERE prazo < current_date AND status NOT IN ('entregue', 'cancelada')),
    'vencem_em_7_dias', count(*) FILTER (WHERE prazo BETWEEN current_date AND current_date + 7 AND status NOT IN ('entregue', 'cancelada')),
    'valor_ordens_ativas', COALESCE(sum(valor_total) FILTER (WHERE status NOT IN ('entregue', 'cancelada')), 0),
    'valor_aguardando_pagamento', COALESCE(sum(valor_total) FILTER (WHERE status_pagamento = 'pendente' AND (financeiro_liberado_em IS NOT NULL OR status = 'entregue') AND status <> 'cancelada'), 0),
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

CREATE OR REPLACE FUNCTION public.app_admin_painel_fabrica(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_resumo jsonb;
  v_lotes jsonb;
  v_tendencia jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito à gestão da produção.');
  END IF;

  WITH lotes AS (
    SELECT o.id, o.status, o.prazo, o.quantidade, o.financeiro_liberado_em, o.status_pagamento,
      COALESCE(sum(s.quantidade), 0)::integer AS solicitadas,
      COALESCE(sum(s.quantidade_produzida), 0)::integer AS produzidas,
      COALESCE(sum(s.quantidade_costurada), 0)::integer AS costuradas,
      COALESCE(sum(s.quantidade_entregue), 0)::integer AS entregues
    FROM public.ordens_servico o
    LEFT JOIN public.ordens_servico_tamanhos s ON s.ordem_id = o.id AND s.empresa_id = v.empresa_id
    WHERE o.empresa_id = v.empresa_id AND o.status <> 'cancelada'
    GROUP BY o.id
  )
  SELECT jsonb_build_object(
    'lotes_ativos', count(*) FILTER (WHERE status NOT IN ('entregue', 'cancelada')),
    'lotes_aguardando_inicio', count(*) FILTER (WHERE status = 'recebida'),
    'lotes_em_producao', count(*) FILTER (WHERE status = 'em_producao'),
    'lotes_prontos_entrega', count(*) FILTER (WHERE costuradas >= solicitadas AND solicitadas > 0 AND entregues < solicitadas),
    'lotes_entregues', count(*) FILTER (WHERE status = 'entregue'),
    'lotes_atrasados', count(*) FILTER (WHERE prazo < current_date AND status NOT IN ('entregue', 'cancelada')),
    'lotes_aguardando_pagamento', count(*) FILTER (WHERE status_pagamento = 'pendente' AND (financeiro_liberado_em IS NOT NULL OR status = 'entregue')),
    'unidades_solicitadas', COALESCE(sum(solicitadas), 0),
    'unidades_produzidas', COALESCE(sum(produzidas), 0),
    'unidades_costuradas', COALESCE(sum(costuradas), 0),
    'unidades_entregues', COALESCE(sum(entregues), 0),
    'unidades_aguardando_costura', COALESCE(sum(greatest(produzidas - costuradas, 0)), 0),
    'unidades_prontas_entrega', COALESCE(sum(greatest(costuradas - entregues, 0)), 0)
  ) INTO v_resumo FROM lotes;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST, x.prioridade DESC, x.created_at DESC), '[]'::jsonb)
  INTO v_lotes
  FROM (
    SELECT o.id, o.numero, COALESCE(NULLIF(o.cliente_nome, ''), c.nome) AS cliente,
      o.descricao, o.status, o.prioridade, o.data_entrada, o.prazo, o.quantidade,
      o.producao_iniciada_em, o.producao_concluida_em, o.financeiro_liberado_em,
      o.created_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'tamanho', s.tamanho, 'quantidade', s.quantidade,
        'quantidade_produzida', s.quantidade_produzida,
        'quantidade_costurada', s.quantidade_costurada,
        'quantidade_entregue', s.quantidade_entregue
      ) ORDER BY s.tamanho) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS tamanhos,
      COALESCE(sum(s.quantidade), 0)::integer AS unidades_solicitadas,
      COALESCE(sum(s.quantidade_produzida), 0)::integer AS unidades_produzidas,
      COALESCE(sum(s.quantidade_costurada), 0)::integer AS unidades_costuradas,
      COALESCE(sum(s.quantidade_entregue), 0)::integer AS unidades_entregues
    FROM public.ordens_servico o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id AND c.empresa_id = v.empresa_id
    LEFT JOIN public.ordens_servico_tamanhos s ON s.ordem_id = o.id AND s.empresa_id = v.empresa_id
    WHERE o.empresa_id = v.empresa_id AND o.status <> 'cancelada'
    GROUP BY o.id, c.nome
    ORDER BY o.prazo NULLS LAST, o.prioridade DESC, o.created_at DESC
    LIMIT 500
  ) x;

  WITH dias AS (
    SELECT generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 13,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day')::date AS dia
  ), eventos AS (
    SELECT (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
      sum(e.unidades_produzidas_delta)::integer AS produzidas,
      sum(e.unidades_costuradas_delta)::integer AS costuradas,
      sum(e.unidades_entregues_delta)::integer AS entregues
    FROM public.ordens_servico_producao_eventos e
    WHERE e.empresa_id = v.empresa_id
      AND e.created_at >= now() - interval '14 days'
    GROUP BY (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'data', dias.dia,
    'produzidas', COALESCE(eventos.produzidas, 0),
    'costuradas', COALESCE(eventos.costuradas, 0),
    'entregues', COALESCE(eventos.entregues, 0)
  ) ORDER BY dias.dia), '[]'::jsonb)
  INTO v_tendencia
  FROM dias LEFT JOIN eventos ON eventos.dia = dias.dia;

  RETURN jsonb_build_object('sucesso', true, 'resumo', v_resumo, 'lotes', v_lotes, 'tendencia', v_tendencia);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_iniciar_producao(p_token text, p_ordem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito à gestão da produção.');
  END IF;
  SELECT id, numero, status INTO v_ordem
  FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Lote não encontrado.'); END IF;
  IF v_ordem.status <> 'recebida' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Somente lotes aguardando início podem ser iniciados.');
  END IF;
  v_antes := jsonb_build_object('status', v_ordem.status);
  UPDATE public.ordens_servico
  SET status = 'em_producao', producao_iniciada_em = now(), updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status', status, 'producao_iniciada_em', producao_iniciada_em) INTO v_depois;
  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'status_alterado', v_antes, v_depois);
  INSERT INTO public.ordens_servico_producao_eventos (empresa_id, ordem_id, usuario_id, evento, detalhes)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'producao_iniciada', jsonb_build_object('status', 'em_producao'));
  RETURN jsonb_build_object('sucesso', true, 'status', 'em_producao');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_salvar_progresso_fabrica(
  p_token text, p_ordem_id uuid, p_tamanhos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_item jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_quantidade integer;
  v_count integer;
  v_antes jsonb;
  v_depois jsonb;
  v_prod_antes integer := 0;
  v_cost_antes integer := 0;
  v_entrega_antes integer := 0;
  v_prod_depois integer := 0;
  v_cost_depois integer := 0;
  v_entrega_depois integer := 0;
  v_status_novo text;
  v_status_depois jsonb;
  v_evento text;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito à gestão da produção.');
  END IF;
  IF COALESCE(jsonb_typeof(p_tamanhos), '') <> 'array' OR jsonb_array_length(p_tamanhos) < 1 OR jsonb_array_length(p_tamanhos) > 50 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma grade de produção válida.');
  END IF;
  SELECT id, numero, status, quantidade INTO v_ordem
  FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Lote não encontrado neste escopo.'); END IF;
  IF v_ordem.status IN ('recebida', 'cancelada', 'entregue') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Inicie o lote antes de atualizar ou consulte um lote já concluído.');
  END IF;
  SELECT count(*), COALESCE(sum(quantidade_produzida), 0), COALESCE(sum(quantidade_costurada), 0), COALESCE(sum(quantidade_entregue), 0)
  INTO v_count, v_prod_antes, v_cost_antes, v_entrega_antes
  FROM public.ordens_servico_tamanhos WHERE ordem_id = p_ordem_id AND empresa_id = v.empresa_id;
  IF v_count < 1 OR jsonb_array_length(p_tamanhos) <> v_count THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade enviada deve conter todos os tamanhos do lote.');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'tamanho', s.tamanho, 'quantidade', s.quantidade,
    'quantidade_produzida', s.quantidade_produzida,
    'quantidade_costurada', s.quantidade_costurada,
    'quantidade_entregue', s.quantidade_entregue
  ) ORDER BY s.tamanho), '[]'::jsonb)
  INTO v_antes FROM public.ordens_servico_tamanhos s
  WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tamanhos) AS sizes(value) LOOP
    IF COALESCE(jsonb_typeof(v_item), '') <> 'object'
      OR v_item - ARRAY['id', 'quantidade_produzida', 'quantidade_costurada', 'quantidade_entregue']::text[] <> '{}'::jsonb
      OR COALESCE(v_item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR COALESCE(v_item->>'quantidade_produzida', '') !~ '^[0-9]{1,7}$'
      OR COALESCE(v_item->>'quantidade_costurada', '') !~ '^[0-9]{1,7}$'
      OR COALESCE(v_item->>'quantidade_entregue', '') !~ '^[0-9]{1,7}$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade contém campos ou quantidades inválidas.');
    END IF;
    v_id := (v_item->>'id')::uuid;
    IF v_id = ANY(v_ids) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'A grade contém tamanhos repetidos.'); END IF;
    v_ids := array_append(v_ids, v_id);
    SELECT s.quantidade INTO v_quantidade FROM public.ordens_servico_tamanhos s
    WHERE s.id = v_id AND s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Uma linha de tamanho não pertence a este lote.'); END IF;
    IF (v_item->>'quantidade_entregue')::integer > (v_item->>'quantidade_costurada')::integer
      OR (v_item->>'quantidade_costurada')::integer > (v_item->>'quantidade_produzida')::integer
      OR (v_item->>'quantidade_produzida')::integer > v_quantidade THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Validação: entregue ≤ costurada ≤ produzida ≤ solicitada em cada tamanho.');
    END IF;
  END LOOP;
  IF cardinality(v_ids) <> v_count THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Inclua cada tamanho do lote exatamente uma vez.'); END IF;

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
  ) ORDER BY s.tamanho), '[]'::jsonb),
    COALESCE(sum(s.quantidade_produzida), 0), COALESCE(sum(s.quantidade_costurada), 0), COALESCE(sum(s.quantidade_entregue), 0)
  INTO v_depois, v_prod_depois, v_cost_depois, v_entrega_depois
  FROM public.ordens_servico_tamanhos s
  WHERE s.ordem_id = p_ordem_id AND s.empresa_id = v.empresa_id;

  IF v_antes IS DISTINCT FROM v_depois THEN
    v_status_novo := CASE
      WHEN v_entrega_depois >= v_ordem.quantidade THEN 'entregue'
      WHEN v_entrega_depois > 0 THEN 'expedida'
      WHEN v_cost_depois >= v_ordem.quantidade THEN 'costurada'
      ELSE 'em_producao'
    END;
    UPDATE public.ordens_servico
    SET status = v_status_novo,
        producao_iniciada_em = COALESCE(producao_iniciada_em, now()),
        producao_concluida_em = CASE WHEN v_cost_depois >= v_ordem.quantidade THEN COALESCE(producao_concluida_em, now()) ELSE producao_concluida_em END,
        updated_at = now()
    WHERE id = p_ordem_id AND empresa_id = v.empresa_id
    RETURNING jsonb_build_object('status', status, 'updated_at', updated_at, 'producao_concluida_em', producao_concluida_em) INTO v_status_depois;
    IF v_status_novo IS DISTINCT FROM v_ordem.status THEN
      INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
      VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'status_alterado', jsonb_build_object('status', v_ordem.status), v_status_depois);
    END IF;
    INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
    VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'progresso_atualizado', v_antes, v_depois);
    v_evento := CASE
      WHEN v_entrega_depois > v_entrega_antes AND v_entrega_depois >= v_ordem.quantidade THEN 'entrega_completa'
      WHEN v_entrega_depois <> v_entrega_antes THEN 'entrega_parcial'
      ELSE 'progresso_atualizado'
    END;
    INSERT INTO public.ordens_servico_producao_eventos (
      empresa_id, ordem_id, usuario_id, evento, unidades_produzidas_delta,
      unidades_costuradas_delta, unidades_entregues_delta, detalhes
    ) VALUES (
      v.empresa_id, p_ordem_id, v.usuario_id, v_evento,
      v_prod_depois - v_prod_antes, v_cost_depois - v_cost_antes,
      v_entrega_depois - v_entrega_antes,
      jsonb_build_object('status', v_status_novo, 'antes', v_antes, 'depois', v_depois)
    );
  ELSE
    SELECT jsonb_build_object('status', status, 'updated_at', updated_at, 'producao_concluida_em', producao_concluida_em)
    INTO v_status_depois FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'status', v_status_depois->>'status', 'tamanhos', v_depois,
    'unidades_produzidas', v_prod_depois, 'unidades_costuradas', v_cost_depois, 'unidades_entregues', v_entrega_depois);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_liberar_ordem_financeiro(p_token text, p_ordem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_ordem record;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito à gestão da produção.');
  END IF;
  SELECT o.id, o.numero, o.status, o.financeiro_liberado_em, o.status_pagamento,
    COALESCE((SELECT sum(s.quantidade_entregue) FROM public.ordens_servico_tamanhos s WHERE s.ordem_id = o.id AND s.empresa_id = v.empresa_id), 0) AS entregues
  INTO v_ordem FROM public.ordens_servico o
  WHERE o.id = p_ordem_id AND o.empresa_id = v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Lote não encontrado.'); END IF;
  IF v_ordem.status <> 'entregue' OR v_ordem.entregues < (SELECT quantidade FROM public.ordens_servico WHERE id = p_ordem_id AND empresa_id = v.empresa_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Libere para pagamento somente após a entrega completa do lote.');
  END IF;
  IF v_ordem.financeiro_liberado_em IS NOT NULL THEN
    RETURN jsonb_build_object('sucesso', true, 'alterado', false, 'mensagem', 'O lote já foi liberado para financeiro.');
  END IF;
  v_antes := jsonb_build_object('financeiro_liberado_em', null, 'status_pagamento', v_ordem.status_pagamento);
  UPDATE public.ordens_servico SET financeiro_liberado_em = now(), financeiro_liberado_por = v.usuario_id, updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('financeiro_liberado_em', financeiro_liberado_em, 'status_pagamento', status_pagamento) INTO v_depois;
  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'financeiro_liberado', v_antes, v_depois);
  INSERT INTO public.ordens_servico_producao_eventos (empresa_id, ordem_id, usuario_id, evento, detalhes)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'financeiro_liberado', jsonb_build_object('financeiro_liberado_em', v_depois->>'financeiro_liberado_em'));
  RETURN jsonb_build_object('sucesso', true, 'alterado', true, 'financeiro_liberado_em', v_depois->>'financeiro_liberado_em');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem_financeiro(
  p_token text, p_ordem_id uuid, p_status_pagamento text, p_nota_fiscal_numero text
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
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  v_status_pagamento := lower(btrim(COALESCE(p_status_pagamento, '')));
  v_nota := NULLIF(btrim(COALESCE(p_nota_fiscal_numero, '')), '');
  IF v_status_pagamento NOT IN ('pendente', 'pago') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Status de pagamento inválido.'); END IF;
  IF v_nota IS NOT NULL AND length(v_nota) > 40 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'O número da nota fiscal deve ter até 40 caracteres.'); END IF;

  SELECT status, status_pagamento, pago_em, nota_fiscal_numero, nota_fiscal_emitida_em,
    financeiro_liberado_em, valor_total
  INTO v_ordem FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada neste escopo administrativo.'); END IF;
  IF v_status_pagamento = 'pago' AND v_ordem.status_pagamento <> 'pago'
    AND v_ordem.financeiro_liberado_em IS NULL AND v_ordem.status <> 'entregue' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O lote precisa estar concluído e liberado pela Produção antes da baixa do pagamento.');
  END IF;
  v_antes := to_jsonb(v_ordem);
  UPDATE public.ordens_servico
  SET status_pagamento = v_status_pagamento,
      pago_em = CASE WHEN v_status_pagamento = 'pago' THEN COALESCE(pago_em, current_date) ELSE NULL END,
      nota_fiscal_numero = v_nota,
      nota_fiscal_emitida_em = CASE WHEN v_nota IS NULL THEN NULL
        WHEN v_nota IS DISTINCT FROM nota_fiscal_numero OR nota_fiscal_emitida_em IS NULL THEN current_date
        ELSE nota_fiscal_emitida_em END,
      updated_at = now()
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id
  RETURNING jsonb_build_object('status_pagamento', status_pagamento, 'pago_em', pago_em,
    'nota_fiscal_numero', nota_fiscal_numero, 'nota_fiscal_emitida_em', nota_fiscal_emitida_em,
    'financeiro_liberado_em', financeiro_liberado_em) INTO v_depois;
  IF v_antes IS DISTINCT FROM v_depois THEN
    INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, antes, depois)
    VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'financeiro_nf_atualizado', v_antes, v_depois);
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'status_pagamento', v_status_pagamento,
    'nota_fiscal_numero', v_nota, 'pago_em', CASE WHEN v_status_pagamento = 'pago' THEN current_date ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_ordem_documento_preflight(p_token text, p_ordem_id uuid, p_tipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record; v_ordem record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  IF p_tipo NOT IN ('nota_fiscal', 'comprovante_pagamento') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de documento inválido.');
  END IF;
  SELECT id, status, financeiro_liberado_em INTO v_ordem FROM public.ordens_servico
  WHERE id = p_ordem_id AND empresa_id = v.empresa_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada.'); END IF;
  IF v_ordem.status <> 'entregue' AND v_ordem.financeiro_liberado_em IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Documentos financeiros ficam disponíveis após a liberação do lote.');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'empresa_id', v.empresa_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_registrar_ordem_documento(
  p_token text, p_ordem_id uuid, p_tipo text, p_storage_path text,
  p_nome_arquivo text, p_mime_type text, p_tamanho_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record; v_id uuid; v_prefix text;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  IF p_tipo NOT IN ('nota_fiscal', 'comprovante_pagamento')
    OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    OR p_tamanho_bytes NOT BETWEEN 1 AND 10485760
    OR length(btrim(COALESCE(p_nome_arquivo, ''))) NOT BETWEEN 1 AND 255 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Metadados ou arquivo inválidos.');
  END IF;
  v_prefix := 'ordens-servico/' || v.empresa_id::text || '/' || p_ordem_id::text || '/' || p_tipo || '/';
  IF p_storage_path IS NULL OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Caminho de armazenamento inválido.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.id = p_ordem_id AND o.empresa_id = v.empresa_id
    AND (o.status = 'entregue' OR o.financeiro_liberado_em IS NOT NULL)) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Ordem não encontrada ou ainda não liberada.');
  END IF;
  INSERT INTO public.ordens_servico_documentos
    (empresa_id, ordem_id, tipo, storage_path, nome_arquivo, mime_type, tamanho_bytes, uploaded_by)
  VALUES (v.empresa_id, p_ordem_id, p_tipo, p_storage_path, btrim(p_nome_arquivo), p_mime_type, p_tamanho_bytes, v.usuario_id)
  RETURNING id INTO v_id;
  INSERT INTO public.ordens_servico_auditoria (empresa_id, ordem_id, usuario_id, evento, depois)
  VALUES (v.empresa_id, p_ordem_id, v.usuario_id, 'documento_adicionado',
    jsonb_build_object('documento_id', v_id, 'tipo', p_tipo, 'nome_arquivo', btrim(p_nome_arquivo), 'mime_type', p_mime_type, 'tamanho_bytes', p_tamanho_bytes));
  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_ordem_documento_path(p_token text, p_documento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record; v_doc record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado.');
  END IF;
  SELECT storage_path, nome_arquivo, mime_type INTO v_doc FROM public.ordens_servico_documentos
  WHERE id = p_documento_id AND empresa_id = v.empresa_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Documento não encontrado.'); END IF;
  RETURN jsonb_build_object('sucesso', true, 'caminho', v_doc.storage_path,
    'nome', v_doc.nome_arquivo, 'mime_type', v_doc.mime_type);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ordem(p_token text, p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN public.app_admin_atualizar_ordem_status(p_token, p_id, p_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_iniciar_producao(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_salvar_progresso_fabrica(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_liberar_ordem_financeiro(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_ordem_documento_preflight(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_registrar_ordem_documento(text, uuid, text, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_ordem_documento_path(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_painel_fabrica(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_iniciar_producao(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_progresso_fabrica(text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_liberar_ordem_financeiro(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_ordem_documento_preflight(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_ordem_documento(text, uuid, text, text, text, text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_ordem_documento_path(text, uuid) TO anon, authenticated;

COMMIT;
