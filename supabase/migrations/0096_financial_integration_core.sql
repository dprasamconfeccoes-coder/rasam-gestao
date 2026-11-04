BEGIN;
-- Integração financeira transversal: OS -> AR, recorrências/RH -> AP e leitura
-- consolidada do subledger de dívidas sem copiar parcelas para o ledger.
ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS data_entrega date,
  ADD COLUMN IF NOT EXISTS vencimento_financeiro date;
ALTER TABLE public.rh_beneficios_lancamentos
  ADD COLUMN IF NOT EXISTS fornecedor text,
  ADD COLUMN IF NOT EXISTS vencimento date,
  ADD COLUMN IF NOT EXISTS financeiro_lancamento_id uuid REFERENCES public.financeiro_lancamentos(id) ON DELETE SET NULL;
ALTER TABLE public.rh_descontos_lancamentos
  ADD COLUMN IF NOT EXISTS vencimento date,
  ADD COLUMN IF NOT EXISTS financeiro_lancamento_id uuid REFERENCES public.financeiro_lancamentos(id) ON DELETE SET NULL;
ALTER TABLE public.financeiro_recorrencias
  ADD COLUMN IF NOT EXISTS dia_vencimento smallint,
  ADD COLUMN IF NOT EXISTS mes_vencimento smallint;
UPDATE public.financeiro_recorrencias
SET dia_vencimento = EXTRACT(DAY FROM proximo_vencimento)::smallint,
    mes_vencimento = EXTRACT(MONTH FROM proximo_vencimento)::smallint
WHERE dia_vencimento IS NULL OR mes_vencimento IS NULL;
ALTER TABLE public.financeiro_recorrencias
  ALTER COLUMN dia_vencimento SET DEFAULT 1,
  ALTER COLUMN dia_vencimento SET NOT NULL,
  ALTER COLUMN mes_vencimento SET DEFAULT 1,
  ALTER COLUMN mes_vencimento SET NOT NULL;
ALTER TABLE public.financeiro_recorrencias
  DROP CONSTRAINT IF EXISTS financeiro_recorrencias_dia_vencimento_check,
  DROP CONSTRAINT IF EXISTS financeiro_recorrencias_mes_vencimento_check;
ALTER TABLE public.financeiro_recorrencias
  ADD CONSTRAINT financeiro_recorrencias_dia_vencimento_check CHECK (dia_vencimento BETWEEN 1 AND 31),
  ADD CONSTRAINT financeiro_recorrencias_mes_vencimento_check CHECK (mes_vencimento BETWEEN 1 AND 12);
CREATE OR REPLACE FUNCTION public.app_financeiro_recorrencia_set_anchor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $function$
BEGIN
  NEW.dia_vencimento := EXTRACT(DAY FROM NEW.proximo_vencimento)::smallint;
  NEW.mes_vencimento := EXTRACT(MONTH FROM NEW.proximo_vencimento)::smallint;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_financeiro_recorrencia_set_anchor ON public.financeiro_recorrencias;
CREATE TRIGGER trg_financeiro_recorrencia_set_anchor
BEFORE INSERT ON public.financeiro_recorrencias
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_recorrencia_set_anchor();
CREATE INDEX IF NOT EXISTS idx_financeiro_recorrencias_due
  ON public.financeiro_recorrencias(ativo, proximo_vencimento, empresa_id);
CREATE INDEX IF NOT EXISTS idx_dividas_parcelas_financeiro_leitura
  ON public.dividas_parcelas(empresa_id, ativo, vencimento, status);
CREATE INDEX IF NOT EXISTS idx_financeiro_lancamentos_empresa_tipo_due
  ON public.financeiro_lancamentos(empresa_id, tipo, vencimento, status);
-- Uma origem operacional só pode produzir uma obrigação no ledger. Recorrências
-- usam a competência como chave da ocorrência para permitir vários ciclos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_lancamentos_origem_operacional
  ON public.financeiro_lancamentos(empresa_id, origem, origem_id)
  WHERE origem IN ('ordem_servico', 'rh_beneficio', 'rh_desconto') AND origem_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_lancamentos_recorrencia_ocorrencia
  ON public.financeiro_lancamentos(empresa_id, origem_id, competencia)
  WHERE origem = 'recorrencia' AND origem_id IS NOT NULL AND competencia IS NOT NULL;
CREATE OR REPLACE FUNCTION public.app_financeiro_data_local()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  SELECT timezone('America/Sao_Paulo', now())::date
$function$;
REVOKE ALL ON FUNCTION public.app_financeiro_data_local() FROM PUBLIC, anon, authenticated;
-- Read model somente; baixas de parcelas seguem sendo executadas no módulo Dívidas.
CREATE OR REPLACE FUNCTION public.app_financeiro_contas_pagar_unificadas(p_empresa_id uuid)
RETURNS TABLE (
  id uuid,
  tipo text,
  categoria text,
  descricao text,
  fornecedor text,
  valor numeric,
  competencia date,
  vencimento date,
  status text,
  pago_em date,
  origem text,
  origem_id uuid,
  fonte_registro text,
  divida_id uuid,
  parcela_numero integer,
  total_parcelas integer,
  serie_id uuid,
  observacoes text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT l.id, l.tipo, l.categoria, l.descricao, l.fornecedor, l.valor,
    COALESCE(l.competencia, l.vencimento), l.vencimento,
    CASE WHEN l.status IN ('pendente','vencido') AND l.vencimento < public.app_financeiro_data_local() THEN 'vencido' ELSE l.status END,
    l.pago_em, l.origem, l.origem_id, 'ledger'::text, NULL::uuid,
    l.parcela_numero, l.total_parcelas, l.serie_id, l.observacoes, l.created_at
  FROM public.financeiro_lancamentos l
  WHERE l.empresa_id = p_empresa_id AND l.tipo = 'pagar'
  UNION ALL
  SELECT p.id, 'pagar'::text, 'Parcelamento'::text,
    concat_ws(' · ', NULLIF(btrim(s.descricao), ''), 'Parcela ' || p.numero::text),
    s.credor, p.valor, p.vencimento, p.vencimento,
    CASE WHEN p.status = 'pago' THEN 'pago'
      WHEN p.status = 'cancelado' THEN 'cancelado'
      WHEN p.vencimento < public.app_financeiro_data_local() THEN 'vencido' ELSE 'pendente' END,
    p.pago_em, 'parcelamento_legado'::text, p.id, 'parcela_financeira'::text, NULL::uuid,
    p.numero, s.quantidade_parcelas, NULL::uuid, s.fonte_documento, s.created_at
  FROM public.financeiro_parcelas p
  JOIN public.financeiro_parcelamentos s ON s.id = p.parcelamento_id AND s.empresa_id = p.empresa_id
  WHERE p.empresa_id = p_empresa_id AND s.tipo = 'pagar'
    AND NOT EXISTS (
      SELECT 1 FROM public.dividas_parcelas dp
      WHERE dp.source_finance_parcela_id = p.id
      LIMIT 1
    )
  UNION ALL
  SELECT p.id, 'pagar'::text, COALESCE(NULLIF(btrim(d.categoria), ''), 'Outros'),
    concat_ws(' · ', NULLIF(btrim(d.credor), ''), NULLIF(btrim(d.descricao), ''),
      CASE WHEN p.tipo_item = 'entrada' THEN 'Entrada' WHEN p.tipo_item = 'saldo_legado' THEN 'Saldo legado' ELSE 'Parcela ' || p.numero::text END),
    d.credor, p.valor, p.vencimento, p.vencimento,
    CASE WHEN p.status = 'paga' THEN 'pago'
      WHEN p.vencimento IS NOT NULL AND p.vencimento < public.app_financeiro_data_local() THEN 'vencido' ELSE 'pendente' END,
    p.pago_em, 'divida'::text, p.id, 'divida_parcela'::text, p.divida_id,
    p.numero, NULL::integer, NULL::uuid, d.observacoes, p.created_at
  FROM public.dividas_parcelas p
  JOIN public.dividas_gestao d ON d.id = p.divida_id AND d.empresa_id = p.empresa_id
  WHERE p.empresa_id = p_empresa_id AND p.ativo IS TRUE
    AND d.status NOT IN ('inativa','renegociada')
    AND (p.status = 'paga' OR d.status = 'ativa')
$function$;
REVOKE ALL ON FUNCTION public.app_financeiro_contas_pagar_unificadas(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_financeiro_materializar_recorrencias(p_empresa_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  r record;
  v_cursor date;
  v_proxima date;
  v_primeiro_mes date;
  v_dia integer;
  v_mes integer;
  v_criadas integer := 0;
  v_hoje date := public.app_financeiro_data_local();
BEGIN
  FOR r IN
    SELECT fr.id, fr.empresa_id, fr.descricao, fr.categoria, fr.fornecedor, fr.valor,
      fr.periodicidade, fr.proximo_vencimento, fr.dia_vencimento, fr.mes_vencimento, fr.created_by
    FROM public.financeiro_recorrencias fr
    WHERE fr.ativo IS TRUE AND fr.proximo_vencimento <= v_hoje
      AND (p_empresa_id IS NULL OR fr.empresa_id = p_empresa_id)
    ORDER BY fr.proximo_vencimento, fr.id
    FOR UPDATE OF fr SKIP LOCKED
  LOOP
    v_cursor := r.proximo_vencimento;
    v_dia := COALESCE(r.dia_vencimento, EXTRACT(DAY FROM r.proximo_vencimento)::integer);
    v_mes := COALESCE(r.mes_vencimento, EXTRACT(MONTH FROM r.proximo_vencimento)::integer);
    WHILE v_cursor <= v_hoje LOOP
      IF r.valor > 0 THEN
        INSERT INTO public.financeiro_lancamentos (
          empresa_id, tipo, categoria, descricao, fornecedor, valor, competencia,
          vencimento, status, origem, origem_id, created_by
        ) VALUES (
          r.empresa_id, 'pagar', r.categoria, r.descricao, r.fornecedor, r.valor,
          v_cursor, v_cursor, 'pendente', 'recorrencia', r.id, r.created_by
        ) ON CONFLICT DO NOTHING;
        IF FOUND THEN v_criadas := v_criadas + 1; END IF;
      END IF;
      IF r.periodicidade = 'semanal' THEN
        v_proxima := v_cursor + 7;
      ELSIF r.periodicidade = 'anual' THEN
        v_primeiro_mes := make_date(EXTRACT(YEAR FROM v_cursor)::integer + 1, v_mes, 1);
        v_proxima := v_primeiro_mes + LEAST(v_dia, EXTRACT(DAY FROM (v_primeiro_mes + INTERVAL '1 month - 1 day'))::integer) - 1;
      ELSE
        v_primeiro_mes := (date_trunc('month', v_cursor)::date + INTERVAL '1 month')::date;
        v_proxima := v_primeiro_mes + LEAST(v_dia, EXTRACT(DAY FROM (v_primeiro_mes + INTERVAL '1 month - 1 day'))::integer) - 1;
      END IF;
      UPDATE public.financeiro_recorrencias
      SET proximo_vencimento = v_proxima
      WHERE id = r.id AND empresa_id = r.empresa_id;
      v_cursor := v_proxima;
    END LOOP;
  END LOOP;
  RETURN v_criadas;
END;
$function$;
REVOKE ALL ON FUNCTION public.app_financeiro_materializar_recorrencias(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_financeiro_hr_payable_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_tipo text;
  v_nome text;
  v_descricao text;
  v_valor numeric;
  v_fornecedor text;
  v_vencimento date;
  v_status text;
  v_competencia date;
  v_empresa_id uuid;
  v_id uuid;
  v_elegivel boolean;
BEGIN
  IF TG_TABLE_NAME = 'rh_beneficios_lancamentos' THEN
    v_tipo := 'rh_beneficio';
    v_nome := NEW.beneficio_nome;
    v_descricao := NEW.beneficio_nome || ' · benefício de folha';
    v_valor := NEW.valor;
    v_fornecedor := NEW.fornecedor;
    v_vencimento := NEW.vencimento;
    v_status := NEW.status;
    v_competencia := NEW.competencia;
    v_empresa_id := NEW.empresa_id;
    v_id := NEW.id;
    v_elegivel := lower(btrim(COALESCE(v_status, ''))) = 'liberado';
  ELSE
    v_tipo := 'rh_desconto';
    v_nome := NEW.tipo;
    v_descricao := concat_ws(' · ', NEW.tipo, NEW.descricao);
    v_valor := NEW.valor;
    v_fornecedor := NEW.fornecedor;
    v_vencimento := NEW.vencimento;
    v_status := NEW.status;
    v_competencia := NEW.competencia;
    v_empresa_id := NEW.empresa_id;
    v_id := NEW.id;
    v_elegivel := lower(btrim(COALESCE(v_status, ''))) IN ('lancado','ajustado');
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.id IS NOT DISTINCT FROM NEW.id
    AND OLD.empresa_id IS NOT DISTINCT FROM NEW.empresa_id
    AND OLD.fornecedor IS NOT DISTINCT FROM NEW.fornecedor
    AND OLD.vencimento IS NOT DISTINCT FROM NEW.vencimento
    AND OLD.valor IS NOT DISTINCT FROM NEW.valor
    AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF v_elegivel AND NULLIF(btrim(COALESCE(v_fornecedor, '')), '') IS NOT NULL
    AND v_vencimento IS NOT NULL AND COALESCE(v_valor, 0) > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      empresa_id, tipo, categoria, descricao, fornecedor, valor, competencia,
      vencimento, status, origem, origem_id
    ) VALUES (
      v_empresa_id, 'pagar', 'Folha', v_descricao, btrim(v_fornecedor), v_valor,
      v_competencia, v_vencimento, 'pendente', v_tipo, v_id
    ) ON CONFLICT DO NOTHING;
    SELECT l.id INTO v_id
    FROM public.financeiro_lancamentos l
    WHERE l.empresa_id = v_empresa_id AND l.origem = v_tipo AND l.origem_id = NEW.id
    LIMIT 1;
    UPDATE public.financeiro_lancamentos l
    SET categoria = 'Folha', descricao = v_descricao, fornecedor = btrim(v_fornecedor),
      valor = v_valor, competencia = v_competencia, vencimento = v_vencimento,
      status = CASE WHEN l.status = 'cancelado' THEN 'pendente' ELSE l.status END,
      updated_at = now()
    WHERE l.id = v_id AND l.empresa_id = v_empresa_id AND l.status <> 'pago';
  ELSE
    UPDATE public.financeiro_lancamentos l
    SET status = 'cancelado', pago_em = NULL, updated_at = now()
    WHERE l.empresa_id = v_empresa_id AND l.origem = v_tipo AND l.origem_id = NEW.id
      AND l.status <> 'pago';
    v_id := NULL;
  END IF;
  IF TG_TABLE_NAME = 'rh_beneficios_lancamentos' THEN
    IF NEW.financeiro_lancamento_id IS DISTINCT FROM v_id THEN
      UPDATE public.rh_beneficios_lancamentos SET financeiro_lancamento_id = v_id WHERE id = NEW.id;
    END IF;
  ELSE
    IF NEW.financeiro_lancamento_id IS DISTINCT FROM v_id THEN
      UPDATE public.rh_descontos_lancamentos SET financeiro_lancamento_id = v_id WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_rh_beneficios_financeiro ON public.rh_beneficios_lancamentos;
CREATE TRIGGER trg_rh_beneficios_financeiro
AFTER INSERT OR UPDATE ON public.rh_beneficios_lancamentos
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_hr_payable_trigger();
DROP TRIGGER IF EXISTS trg_rh_descontos_financeiro ON public.rh_descontos_lancamentos;
CREATE TRIGGER trg_rh_descontos_financeiro
AFTER INSERT OR UPDATE ON public.rh_descontos_lancamentos
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_hr_payable_trigger();
CREATE OR REPLACE FUNCTION public.app_admin_lancar_beneficio_financeiro(
  p_token text, p_funcionario_id uuid, p_beneficio_nome text, p_competencia date,
  p_valor numeric DEFAULT NULL, p_status text DEFAULT 'liberado', p_motivo text DEFAULT NULL,
  p_observacoes text DEFAULT NULL, p_fornecedor text DEFAULT NULL, p_vencimento date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_result jsonb; v_id uuid; v_financeiro_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF p_valor < 0 OR length(COALESCE(p_fornecedor, '')) > 200 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor ou fornecedor inválido');
  END IF;
  v_result := public.app_admin_lancar_beneficio(p_token, p_funcionario_id, p_beneficio_nome,
    p_competencia, p_valor, p_status, p_motivo, p_observacoes);
  IF COALESCE((v_result->>'sucesso')::boolean, false) IS NOT TRUE THEN RETURN v_result; END IF;
  v_id := (v_result->>'id')::uuid;
  UPDATE public.rh_beneficios_lancamentos
  SET fornecedor = NULLIF(btrim(COALESCE(p_fornecedor, '')), ''), vencimento = p_vencimento
  WHERE id = v_id AND empresa_id = v.empresa_id
  RETURNING financeiro_lancamento_id INTO v_financeiro_id;
  RETURN v_result || jsonb_build_object('financeiro_gerado', v_financeiro_id IS NOT NULL,
    'financeiro_lancamento_id', v_financeiro_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_lancar_beneficio_financeiro(text,uuid,text,date,numeric,text,text,text,text,date) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_lancar_desconto_financeiro(
  p_token text, p_funcionario_id uuid, p_tipo text, p_fornecedor text, p_descricao text,
  p_competencia date, p_valor numeric, p_status text DEFAULT 'lancado',
  p_observacoes text DEFAULT NULL, p_vencimento date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_result jsonb; v_id uuid; v_financeiro_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF length(COALESCE(p_fornecedor, '')) > 200 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Fornecedor inválido');
  END IF;
  v_result := public.app_admin_lancar_desconto(p_token, p_funcionario_id, p_tipo, p_fornecedor,
    p_descricao, p_competencia, p_valor, p_status, p_observacoes);
  IF COALESCE((v_result->>'sucesso')::boolean, false) IS NOT TRUE THEN RETURN v_result; END IF;
  v_id := (v_result->>'id')::uuid;
  UPDATE public.rh_descontos_lancamentos SET vencimento = p_vencimento
  WHERE id = v_id AND empresa_id = v.empresa_id
  RETURNING financeiro_lancamento_id INTO v_financeiro_id;
  RETURN v_result || jsonb_build_object('financeiro_gerado', v_financeiro_id IS NOT NULL,
    'financeiro_lancamento_id', v_financeiro_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_lancar_desconto_financeiro(text,uuid,text,text,text,date,numeric,text,text,date) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_financeiro_ordem_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_entregue integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'entregue' THEN
      RAISE EXCEPTION 'Uma ordem não pode ser criada diretamente como entregue.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status_pagamento = 'pago' AND NEW.status_pagamento <> 'pago' THEN
    RAISE EXCEPTION 'O recebimento já baixado não pode ser reaberto.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'entregue' AND NEW.status IS DISTINCT FROM 'entregue'
    AND NEW.status <> 'cancelada' THEN
    RAISE EXCEPTION 'Uma ordem entregue deve ser cancelada formalmente antes de reabrir sua etapa.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'entregue' AND OLD.status IS DISTINCT FROM 'entregue' THEN
    SELECT COALESCE(sum(s.quantidade_entregue), 0)::integer INTO v_entregue
    FROM public.ordens_servico_tamanhos s
    WHERE s.ordem_id = NEW.id AND s.empresa_id = NEW.empresa_id;
    IF v_entregue <> NEW.quantidade THEN
      RAISE EXCEPTION 'A ordem só pode ser entregue quando todas as unidades solicitadas estiverem entregues.' USING ERRCODE = '23514';
    END IF;
    NEW.data_entrega := public.app_financeiro_data_local();
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.app_financeiro_ordem_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_status text; v_paid date;
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.status = 'entregue' THEN
    IF NEW.status_pagamento = 'pago' THEN
      v_status := 'pago';
      v_paid := COALESCE(NEW.pago_em, public.app_financeiro_data_local());
    ELSE
      v_status := 'pendente';
      v_paid := NULL;
    END IF;
    INSERT INTO public.financeiro_lancamentos (
      empresa_id, tipo, categoria, descricao, fornecedor, valor, competencia,
      vencimento, status, pago_em, origem, origem_id, created_by
    ) VALUES (
      NEW.empresa_id, 'receber', 'Produção', concat_ws(' · ', NEW.numero, NEW.descricao),
      NEW.cliente_nome, NEW.valor_total, COALESCE(NEW.data_entrega, public.app_financeiro_data_local()),
      COALESCE(NEW.vencimento_financeiro, NEW.data_entrega, public.app_financeiro_data_local()),
      v_status, v_paid, 'ordem_servico', NEW.id, NEW.created_by
    ) ON CONFLICT DO NOTHING;
    UPDATE public.financeiro_lancamentos l
    SET categoria = 'Produção', descricao = concat_ws(' · ', NEW.numero, NEW.descricao),
      fornecedor = NEW.cliente_nome, valor = NEW.valor_total,
      competencia = COALESCE(NEW.data_entrega, public.app_financeiro_data_local()),
      vencimento = COALESCE(NEW.vencimento_financeiro, NEW.data_entrega, public.app_financeiro_data_local()),
      status = CASE WHEN NEW.status_pagamento = 'pago' THEN 'pago' WHEN l.status = 'cancelado' THEN 'pendente' ELSE l.status END,
      pago_em = CASE WHEN NEW.status_pagamento = 'pago' THEN COALESCE(NEW.pago_em, public.app_financeiro_data_local()) ELSE l.pago_em END,
      updated_at = now()
    WHERE l.empresa_id = NEW.empresa_id AND l.origem = 'ordem_servico' AND l.origem_id = NEW.id
      AND (l.status <> 'pago' OR NEW.status_pagamento = 'pago');
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'entregue' AND NEW.status = 'cancelada' THEN
    IF EXISTS (SELECT 1 FROM public.financeiro_lancamentos l
      WHERE l.empresa_id = NEW.empresa_id AND l.origem = 'ordem_servico' AND l.origem_id = NEW.id AND l.status = 'pago' LIMIT 1) THEN
      RAISE EXCEPTION 'O recebível já foi recebido; estorne o recebimento antes de cancelar a ordem.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.financeiro_lancamentos l
    SET status = 'cancelado', pago_em = NULL, updated_at = now()
    WHERE l.empresa_id = NEW.empresa_id AND l.origem = 'ordem_servico' AND l.origem_id = NEW.id
      AND l.status <> 'pago';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_ordens_financeiro_before_write ON public.ordens_servico;
CREATE TRIGGER trg_ordens_financeiro_before_write
BEFORE INSERT OR UPDATE ON public.ordens_servico
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_ordem_before_write();
DROP TRIGGER IF EXISTS trg_ordens_financeiro_after_write ON public.ordens_servico;
CREATE TRIGGER trg_ordens_financeiro_after_write
AFTER INSERT OR UPDATE ON public.ordens_servico
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_ordem_after_write();
-- Reconstrói recebíveis de ordens já entregues; em registros históricos sem data,
-- usa a data da última atualização como aproximação explícita e determinística.
UPDATE public.ordens_servico o
SET data_entrega = COALESCE(o.data_entrega, (o.updated_at AT TIME ZONE 'America/Sao_Paulo')::date, public.app_financeiro_data_local())
WHERE o.status = 'entregue';
CREATE OR REPLACE FUNCTION public.app_financeiro_sync_ordem_from_lancamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.origem <> 'ordem_servico' OR NEW.origem_id IS NULL
    OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  UPDATE public.ordens_servico o
  SET status_pagamento = CASE WHEN NEW.status = 'pago' THEN 'pago' ELSE 'pendente' END,
      pago_em = CASE WHEN NEW.status = 'pago' THEN COALESCE(NEW.pago_em, public.app_financeiro_data_local()) ELSE NULL END,
      updated_at = now()
  WHERE o.id = NEW.origem_id AND o.empresa_id = NEW.empresa_id;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_financeiro_sync_ordem ON public.financeiro_lancamentos;
CREATE TRIGGER trg_financeiro_sync_ordem
AFTER UPDATE OF status ON public.financeiro_lancamentos
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_sync_ordem_from_lancamento();
-- Impede que registros automatizados sejam apagados como se fossem lançamentos manuais.
CREATE OR REPLACE FUNCTION public.app_financeiro_proteger_origem_automatica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF OLD.origem IN ('ordem_servico','recorrencia','rh_beneficio','rh_desconto') THEN
    RAISE EXCEPTION 'Lançamentos de origem operacional não podem ser excluídos; cancele ou altere a origem.' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS trg_financeiro_proteger_origem_automatica ON public.financeiro_lancamentos;
CREATE TRIGGER trg_financeiro_proteger_origem_automatica
BEFORE DELETE ON public.financeiro_lancamentos
FOR EACH ROW EXECUTE FUNCTION public.app_financeiro_proteger_origem_automatica();
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_status(p_token text,p_id uuid,p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_status text; v_lancamento record; v_rows integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  v_status := lower(trim(coalesce(p_status,'')));
  IF v_status NOT IN ('pendente','pago','cancelado') THEN RETURN jsonb_build_object('sucesso',false,'erro','Status inválido'); END IF;
  SELECT id,origem,status INTO v_lancamento FROM public.financeiro_lancamentos
  WHERE id=p_id AND empresa_id=v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento não encontrado'); END IF;
  IF v_lancamento.origem='ordem_servico' AND v_status='cancelado' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Cancele a ordem de serviço para cancelar o recebível de produção.');
  END IF;
  UPDATE public.financeiro_lancamentos
  SET status=v_status,pago_em=CASE WHEN v_status='pago' THEN coalesce(pago_em,public.app_financeiro_data_local()) ELSE NULL END,updated_at=now()
  WHERE id=p_id AND empresa_id=v.empresa_id AND status <> 'pago';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento já pago ou não alterável'); END IF;
  RETURN jsonb_build_object('sucesso',true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_status(text,uuid,text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_salvar(
  p_token text, p_id uuid, p_tipo text, p_categoria text, p_descricao text,
  p_valor numeric, p_vencimento date, p_observacoes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_id uuid; v_tipo text; v_origem text;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  v_tipo := lower(trim(coalesce(p_tipo,'')));
  IF v_tipo NOT IN ('pagar','receber') THEN RETURN jsonb_build_object('sucesso',false,'erro','Escolha despesa ou receita'); END IF;
  IF NULLIF(trim(coalesce(p_categoria,'')),'') IS NULL OR NULLIF(trim(coalesce(p_descricao,'')),'') IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Categoria e descrição são obrigatórias'); END IF;
  IF COALESCE(p_valor,0)<=0 OR p_vencimento IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe um valor positivo e o vencimento'); END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.financeiro_lancamentos(empresa_id,tipo,categoria,descricao,valor,vencimento,status,observacoes,created_by,origem,competencia)
    VALUES(v.empresa_id,v_tipo,trim(p_categoria),trim(p_descricao),p_valor,p_vencimento,'pendente',nullif(trim(coalesce(p_observacoes,'')),''),v.usuario_id,'manual',p_vencimento)
    RETURNING id INTO v_id;
  ELSE
    SELECT origem INTO v_origem FROM public.financeiro_lancamentos WHERE id=p_id AND empresa_id=v.empresa_id FOR UPDATE;
    IF NOT FOUND OR v_origem <> 'manual' THEN RETURN jsonb_build_object('sucesso',false,'erro','Somente lançamentos manuais podem ser editados aqui.'); END IF;
    UPDATE public.financeiro_lancamentos SET tipo=v_tipo,categoria=trim(p_categoria),descricao=trim(p_descricao),valor=p_valor,
      vencimento=p_vencimento,competencia=p_vencimento,observacoes=nullif(trim(coalesce(p_observacoes,'')),''),updated_at=now()
    WHERE id=p_id AND empresa_id=v.empresa_id AND status <> 'pago' RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Lançamento não encontrado ou já pago'); END IF;
  END IF;
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_salvar(text,uuid,text,text,text,numeric,date,text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_hoje date := public.app_financeiro_data_local();
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  PERFORM public.app_financeiro_materializar_recorrencias(v.empresa_id);
  RETURN jsonb_build_object(
    'sucesso',true,
    'contas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento NULLS LAST,x.created_at DESC),'[]'::jsonb)
      FROM (
        SELECT * FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id)
        UNION ALL
        SELECT l.id,l.tipo,l.categoria,l.descricao,l.fornecedor,l.valor,COALESCE(l.competencia,l.vencimento),l.vencimento,
          CASE WHEN l.status IN ('pendente','vencido') AND l.vencimento<v_hoje THEN 'vencido' ELSE l.status END,
          l.pago_em,l.origem,l.origem_id,'ledger'::text,NULL::uuid,l.parcela_numero,l.total_parcelas,l.serie_id,l.observacoes,l.created_at
        FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber'
        ORDER BY vencimento NULLS LAST, created_at DESC LIMIT 1500
      ) x),
    'recorrencias',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.proximo_vencimento),'[]'::jsonb)
      FROM (SELECT id,descricao,categoria,fornecedor,valor,periodicidade,proximo_vencimento,ativo
        FROM public.financeiro_recorrencias WHERE empresa_id=v.empresa_id ORDER BY ativo DESC,proximo_vencimento LIMIT 300)x),
    'parcelas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb)
      FROM (SELECT p.id,p.numero,p.valor,p.vencimento,p.status,p.pago_em,p.comprovante_nome,p.fonte_documento,s.credor,s.descricao
        FROM public.financeiro_parcelas p JOIN public.financeiro_parcelamentos s ON s.id=p.parcelamento_id
        WHERE p.empresa_id=v.empresa_id AND NOT EXISTS (SELECT 1 FROM public.dividas_gestao d WHERE d.parcelamento_origem_id=s.id LIMIT 1)
        ORDER BY p.vencimento LIMIT 1000)x),
    'dividas','[]'::jsonb,
    'receitas_ordens','[]'::jsonb,
    'resumo',jsonb_build_object(
      'despesas_pendentes',COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido')),0),
      'despesas_vencidas',COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento<v_hoje),0),
      'receitas_pendentes',COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido')),0),
      'receitas_recebidas',COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status='pago'),0),
      'receitas_ordens_previstas',0,
      'ordens_aguardando_pagamento',COALESCE((SELECT count(*) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.origem='ordem_servico' AND l.status IN ('pendente','vencido')),0)
    )
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro(text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_executivo(
  p_token text, p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v record;
  v_hoje date := public.app_financeiro_data_local();
  v_inicio date := COALESCE(p_inicio, date_trunc('month', public.app_financeiro_data_local())::date - INTERVAL '5 months');
  v_fim date := COALESCE(p_fim, public.app_financeiro_data_local());
  v_periodo_inicio date;
  v_periodo_fim date;
  v_receber_vencido numeric := 0;
  v_pagar_vencido numeric := 0;
  v_qtd_vencidas integer := 0;
  v_receita_realizada numeric := 0;
  v_despesa_realizada numeric := 0;
  v_saldo numeric := 0;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF v_inicio > v_fim THEN RETURN jsonb_build_object('sucesso',false,'erro','Período inválido'); END IF;
  PERFORM public.app_financeiro_materializar_recorrencias(v.empresa_id);
  v_periodo_inicio := date_trunc('month',v_inicio)::date;
  v_periodo_fim := (date_trunc('month',v_fim)+INTERVAL '1 month - 1 day')::date;
  SELECT count(*)::integer INTO v_qtd_vencidas FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
    WHERE a.status IN ('pendente','vencido') AND a.vencimento < v_hoje;
  SELECT COALESCE(sum(a.valor),0) INTO v_pagar_vencido FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
    WHERE a.status IN ('pendente','vencido') AND a.vencimento < v_hoje;
  SELECT COALESCE(sum(l.valor),0) INTO v_receber_vencido FROM public.financeiro_lancamentos l
    WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido') AND l.vencimento<v_hoje;
  SELECT COALESCE(sum(l.valor),0) INTO v_receita_realizada FROM public.financeiro_lancamentos l
    WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status='pago' AND COALESCE(l.pago_em,l.vencimento) BETWEEN v_inicio AND v_fim;
  SELECT COALESCE(sum(a.valor),0) INTO v_despesa_realizada FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
    WHERE a.status='pago' AND COALESCE(a.pago_em,a.vencimento) BETWEEN v_inicio AND v_fim;
  v_saldo := v_receita_realizada-v_despesa_realizada;
  RETURN jsonb_build_object(
    'sucesso',true,'periodo',jsonb_build_object('inicio',v_inicio,'fim',v_fim),
    'kpis',jsonb_build_object(
      'receitas_realizadas',v_receita_realizada,
      'despesas_realizadas',v_despesa_realizada,
      'resultado_realizado',v_saldo,
      'receitas_a_receber',COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido') AND l.vencimento BETWEEN v_inicio AND v_periodo_fim),0),
      'despesas_a_pagar',COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento BETWEEN v_inicio AND v_periodo_fim),0),
      'despesas_vencidas',v_pagar_vencido,
      'receitas_ordens_previstas',0,
      'ordens_aguardando_pagamento',COALESCE((SELECT count(*) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.origem='ordem_servico' AND l.status IN ('pendente','vencido')),0),
      'compromissos_recorrentes',COALESCE((SELECT sum(r.valor) FROM public.financeiro_recorrencias r WHERE r.empresa_id=v.empresa_id AND r.ativo AND r.proximo_vencimento>v_hoje),0),
      'recorrencias_ativas',COALESCE((SELECT count(*) FROM public.financeiro_recorrencias r WHERE r.empresa_id=v.empresa_id AND r.ativo),0),
      'saldo_projetado',v_saldo
        +COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido') AND l.vencimento<=v_periodo_fim),0)
        -COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento<=v_periodo_fim),0)
    ),
    'evolucao',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.mes),'[]'::jsonb)
      FROM (
        SELECT gs::date AS mes,
          COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status='pago' AND COALESCE(l.pago_em,l.vencimento)>=gs AND COALESCE(l.pago_em,l.vencimento)<gs+INTERVAL '1 month'),0) AS receitas_realizadas,
          COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status='pago' AND COALESCE(a.pago_em,a.vencimento)>=gs AND COALESCE(a.pago_em,a.vencimento)<gs+INTERVAL '1 month'),0) AS despesas_realizadas,
          COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido') AND l.vencimento>=gs AND l.vencimento<gs+INTERVAL '1 month'),0) AS receitas_previstas,
          COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento>=gs AND a.vencimento<gs+INTERVAL '1 month'),0) AS despesas_previstas
        FROM generate_series(v_periodo_inicio,v_periodo_fim,INTERVAL '1 month') gs LIMIT 24
      )m),
    'categorias',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.valor DESC),'[]'::jsonb)
      FROM (SELECT COALESCE(NULLIF(btrim(a.categoria),''),'Sem categoria') AS categoria,
        sum(a.valor) AS valor,count(*)::integer AS quantidade
        FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status<>'cancelado' AND a.vencimento BETWEEN v_inicio AND v_fim
        GROUP BY 1 ORDER BY sum(a.valor) DESC LIMIT 10)c),
    'aging',jsonb_build_object(
      'vencido',jsonb_build_object('quantidade',v_qtd_vencidas,'valor',v_pagar_vencido),
      'hoje',jsonb_build_object('quantidade',COALESCE((SELECT count(*) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento=v_hoje),0),'valor',COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento=v_hoje),0)),
      'sete_dias',jsonb_build_object('quantidade',COALESCE((SELECT count(*) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento>v_hoje AND a.vencimento<=v_hoje+7),0),'valor',COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento>v_hoje AND a.vencimento<=v_hoje+7),0)),
      'trinta_dias',jsonb_build_object('quantidade',COALESCE((SELECT count(*) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento>v_hoje+7 AND a.vencimento<=v_hoje+30),0),'valor',COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento>v_hoje+7 AND a.vencimento<=v_hoje+30),0))
    ),
    'alertas',jsonb_build_array(
      CASE WHEN v_qtd_vencidas>0 THEN jsonb_build_object('nivel','critico','titulo',v_qtd_vencidas||' conta(s) vencida(s)','detalhe','Existem obrigações a pagar que exigem regularização imediata.') ELSE NULL END,
      CASE WHEN v_pagar_vencido>v_receber_vencido AND v_pagar_vencido>0 THEN jsonb_build_object('nivel','atencao','titulo','Despesas vencidas superam receitas vencidas','detalhe','Revise o fluxo de caixa e priorize as próximas baixas.') ELSE NULL END,
      CASE WHEN EXISTS(SELECT 1 FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.origem='ordem_servico' AND l.status IN ('pendente','vencido') LIMIT 1) THEN jsonb_build_object('nivel','informativo','titulo','Há ordens entregues aguardando recebimento','detalhe','Acompanhe os recebíveis de produção no ledger financeiro.') ELSE NULL END
    )
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_executivo(text,date,date) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_relatorio(
  p_token text, p_tipo text, p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v record;
  v_inicio date := COALESCE(p_inicio, date_trunc('month', public.app_financeiro_data_local())::date);
  v_fim date := COALESCE(p_fim, public.app_financeiro_data_local());
  v_tipo text := lower(trim(COALESCE(p_tipo, 'fluxo')));
  v_linhas jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF v_inicio > v_fim THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'A data inicial não pode ser posterior à data final'); END IF;
  PERFORM public.app_financeiro_materializar_recorrencias(v.empresa_id);
  IF v_tipo = 'fluxo' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.mes),'[]'::jsonb) FROM (
        SELECT date_trunc('month',m.data)::date AS mes,
          COALESCE(sum(m.valor) FILTER (WHERE m.tipo='receber' AND m.status='pago'),0) AS receitas_recebidas,
          COALESCE(sum(m.valor) FILTER (WHERE m.tipo='pagar' AND m.status='pago'),0) AS despesas_pagas,
          COALESCE(sum(m.valor) FILTER (WHERE m.tipo='receber' AND m.status IN ('pendente','vencido')),0) AS receitas_previstas,
          COALESCE(sum(m.valor) FILTER (WHERE m.tipo='pagar' AND m.status IN ('pendente','vencido')),0) AS despesas_previstas
        FROM (
          SELECT l.tipo,l.valor,l.status,COALESCE(l.competencia,l.vencimento) AS data FROM public.financeiro_lancamentos l
          WHERE l.empresa_id=v.empresa_id AND l.tipo='receber'
          UNION ALL
          SELECT a.tipo,a.valor,a.status,COALESCE(a.competencia,a.vencimento) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        )m WHERE m.data BETWEEN v_inicio AND v_fim GROUP BY 1 ORDER BY 1 LIMIT 24
      )x));
  END IF;
  IF v_tipo = 'categorias' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC),'[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(btrim(a.categoria),''),'Sem categoria') AS categoria,
          sum(a.valor) AS valor,count(*)::integer AS quantidade
        FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status<>'cancelado' AND a.vencimento BETWEEN v_inicio AND v_fim
        GROUP BY 1 ORDER BY 2 DESC LIMIT 50)x));
  END IF;
  IF v_tipo IN ('contas_pagar','contas_receber') THEN
    IF v_tipo='contas_pagar' THEN
      RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
        'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb) FROM (
          SELECT a.id,a.tipo,a.categoria,a.descricao,a.fornecedor,a.valor,a.competencia,a.vencimento,a.status,a.pago_em,
            a.origem,a.serie_id,a.parcela_numero,a.total_parcelas,a.observacoes,a.fonte_registro,a.origem_id,a.divida_id
          FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
          WHERE a.vencimento BETWEEN v_inicio AND v_fim ORDER BY a.vencimento LIMIT 1000)x));
    ELSE
      RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
        'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb) FROM (
          SELECT id,tipo,categoria,descricao,fornecedor,valor,competencia,vencimento,status,pago_em,origem,serie_id,parcela_numero,total_parcelas,observacoes,'ledger'::text AS fonte_registro,origem_id,NULL::uuid AS divida_id
          FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber'
            AND vencimento BETWEEN v_inicio AND v_fim ORDER BY vencimento LIMIT 500)x));
    END IF;
  END IF;
  IF v_tipo = 'producao' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.data_entrega),'[]'::jsonb) FROM (
        SELECT o.numero,o.descricao,c.nome AS cliente_nome,o.valor_total,o.status,o.status_pagamento,
          o.prazo,o.data_entrega,COALESCE(o.vencimento_financeiro,o.data_entrega) AS vencimento_financeiro
        FROM public.ordens_servico o LEFT JOIN public.clientes c ON c.id=o.cliente_id AND c.empresa_id=v.empresa_id
        WHERE o.empresa_id=v.empresa_id AND o.status='entregue'
          AND COALESCE(o.data_entrega,o.prazo) BETWEEN v_inicio AND v_fim
        ORDER BY COALESCE(o.data_entrega,o.prazo) LIMIT 500)x));
  END IF;
  IF v_tipo = 'dre' THEN
    WITH base AS (
      SELECT 1 ordem,'Receitas realizadas'::text grupo,COALESCE(sum(l.valor),0)::numeric valor
      FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status='pago' AND COALESCE(l.pago_em,l.vencimento) BETWEEN v_inicio AND v_fim
      UNION ALL SELECT 2,'Receitas previstas',COALESCE(sum(l.valor),0)::numeric
      FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido') AND l.vencimento BETWEEN v_inicio AND v_fim
      UNION ALL SELECT 3,'Despesas pagas',COALESCE(sum(a.valor),0)::numeric
      FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status='pago' AND COALESCE(a.pago_em,a.vencimento) BETWEEN v_inicio AND v_fim
      UNION ALL SELECT 4,'Despesas previstas',COALESCE(sum(a.valor),0)::numeric
      FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a WHERE a.status IN ('pendente','vencido') AND a.vencimento BETWEEN v_inicio AND v_fim
    ), totais AS (SELECT COALESCE(sum(valor) FILTER (WHERE grupo IN ('Receitas realizadas','Receitas previstas')),0)::numeric AS total_receitas FROM base)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo',base.grupo,'valor',base.valor,
      'participacao',CASE WHEN totais.total_receitas>0 THEN round(base.valor/totais.total_receitas*100,1) ELSE 0 END) ORDER BY base.ordem),'[]'::jsonb)
    INTO v_linhas FROM base CROSS JOIN totais;
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'linhas',v_linhas);
  END IF;
  IF v_tipo = 'inadimplencia' THEN
    WITH atrasos AS (
      SELECT v_fim-l.vencimento AS dias_atraso,l.valor FROM public.financeiro_lancamentos l
      WHERE l.empresa_id=v.empresa_id AND l.tipo='receber' AND l.status IN ('pendente','vencido') AND l.vencimento BETWEEN v_inicio AND v_fim AND l.vencimento<v_fim
    ), faixas AS (
      SELECT 1 ordem,'1 a 7 dias' faixa,count(*) FILTER (WHERE dias_atraso BETWEEN 1 AND 7)::integer quantidade,COALESCE(sum(valor) FILTER (WHERE dias_atraso BETWEEN 1 AND 7),0) valor FROM atrasos
      UNION ALL SELECT 2,'8 a 30 dias',count(*) FILTER (WHERE dias_atraso BETWEEN 8 AND 30)::integer quantidade,COALESCE(sum(valor) FILTER (WHERE dias_atraso BETWEEN 8 AND 30),0) valor FROM atrasos
      UNION ALL SELECT 3,'31 a 60 dias',count(*) FILTER (WHERE dias_atraso BETWEEN 31 AND 60)::integer quantidade,COALESCE(sum(valor) FILTER (WHERE dias_atraso BETWEEN 31 AND 60),0) valor FROM atrasos
      UNION ALL SELECT 4,'Mais de 60 dias',count(*) FILTER (WHERE dias_atraso>60)::integer quantidade,COALESCE(sum(valor) FILTER (WHERE dias_atraso>60),0) valor FROM atrasos
    ) SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) INTO v_linhas FROM faixas f;
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,'data_corte',v_fim,'linhas',v_linhas);
  END IF;
  IF v_tipo = 'recorrencias' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.proximo_vencimento),'[]'::jsonb) FROM (
        SELECT descricao,categoria,fornecedor,periodicidade,valor,
          CASE periodicidade WHEN 'anual' THEN valor WHEN 'semanal' THEN valor*52 ELSE valor*12 END AS projecao_anual,
          proximo_vencimento FROM public.financeiro_recorrencias
        WHERE empresa_id=v.empresa_id AND ativo AND proximo_vencimento BETWEEN v_inicio AND v_fim
        ORDER BY proximo_vencimento LIMIT 300)x));
  END IF;
  IF v_tipo = 'orcamento' THEN
    RETURN jsonb_build_object('sucesso',true,'tipo',v_tipo,'inicio',v_inicio,'fim',v_fim,
      'linhas',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.orcado DESC),'[]'::jsonb) FROM (
        SELECT categoria,round(sum(orcado),2) AS orcado,round(sum(realizado),2) AS realizado,
          round(sum(orcado)-sum(realizado),2) AS desvio,
          CASE WHEN sum(orcado)>0 THEN round(sum(realizado)/sum(orcado)*100,1) ELSE 0 END AS execucao
        FROM (
          SELECT categoria,valor_orcado AS orcado,0::numeric AS realizado FROM public.financeiro_orcamentos
          WHERE empresa_id=v.empresa_id AND competencia BETWEEN v_inicio AND v_fim
          UNION ALL
          SELECT COALESCE(NULLIF(btrim(a.categoria),''),'Sem categoria'),0::numeric,sum(a.valor)
          FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
          WHERE a.status='pago' AND COALESCE(a.competencia,a.vencimento) BETWEEN v_inicio AND v_fim
          GROUP BY a.categoria
        )s GROUP BY categoria ORDER BY 2 DESC LIMIT 100)x));
  END IF;
  RETURN jsonb_build_object('sucesso',false,'erro','Tipo de relatório inválido');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_relatorio(text,text,date,date) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(
  p_token text, p_ordem_id uuid, p_tamanhos jsonb, p_vencimento_financeiro date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  BEGIN
    UPDATE public.ordens_servico SET vencimento_financeiro = COALESCE(p_vencimento_financeiro, vencimento_financeiro), updated_at=now()
    WHERE id=p_ordem_id AND empresa_id=v.empresa_id AND status <> 'entregue';
    IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Ordem não encontrada neste escopo ou já entregue.'); END IF;
    v_result := public.app_admin_salvar_progresso_fabrica(p_token,p_ordem_id,p_tamanhos);
    IF COALESCE((v_result->>'sucesso')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_result->>'erro','Não foi possível salvar o progresso') USING ERRCODE='P0001';
    END IF;
    RETURN v_result;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('sucesso',false,'erro',SQLERRM);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso',false,'erro',SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(text,uuid,jsonb,date) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_meu_prontuario(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_funcionario jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.funcionario_id IS NULL OR COALESCE(v.perfil,'') <> 'funcionario' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso permitido somente ao prontuário do próprio funcionário.');
  END IF;
  SELECT jsonb_build_object(
    'id',f.id,'nome',f.nome,'cpf',f.cpf,'data_nascimento',f.data_nascimento,'tipo_vinculo',f.tipo_vinculo,
    'cargo',f.cargo,'funcao',f.funcao,'data_admissao',f.data_admissao,'salario',f.salario,
    'salario_periodo',f.salario_periodo,'horario_trabalho',f.horario_trabalho,'horario_intervalo',f.horario_intervalo,
    'telefone_celular',f.telefone_celular,'endereco',f.endereco,'ativo',f.ativo,'data_demissao',f.data_demissao,
    'tipo_desligamento',f.tipo_desligamento
  ) INTO v_funcionario
  FROM public.funcionarios f WHERE f.id=v.funcionario_id AND f.empresa_id=v.empresa_id LIMIT 1;
  IF v_funcionario IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Seu prontuário não está vinculado à sessão. Procure o RH.'); END IF;
  RETURN jsonb_build_object(
    'sucesso',true,'funcionario',v_funcionario,
    'advertencias',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'data_ocorrencia',a.data_ocorrencia,'tipo',a.tipo,'descricao',a.descricao,'medida',a.medida,'created_at',a.created_at) ORDER BY a.data_ocorrencia DESC,a.created_at DESC) FROM public.funcionario_advertencias a WHERE a.funcionario_id=v.funcionario_id AND a.empresa_id=v.empresa_id),'[]'::jsonb),
    'atestados',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'tipo',a.tipo,'data_atendimento',a.data_atendimento,'dias',a.dias,'status',a.status,'status_label',a.status_label,'observacao',a.observacao,'arquivo_nome',a.arquivo_nome,'created_at',a.created_at) ORDER BY a.data_atendimento DESC,a.created_at DESC) FROM public.atestados a WHERE a.funcionario_id=v.funcionario_id AND a.empresa_id=v.empresa_id),'[]'::jsonb),
    'justificativas',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'data_registro',j.data_registro,'tipo',j.tipo,'motivo',j.motivo,'status',j.status,'resposta_rh',j.resposta_rh,'arquivo_nome',j.arquivo_nome,'created_at',j.created_at) ORDER BY j.data_registro DESC,j.created_at DESC) FROM public.justificativas_ponto j WHERE j.funcionario_id=v.funcionario_id AND j.empresa_id=v.empresa_id),'[]'::jsonb),
    'ferias',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'periodo_aquisitivo_inicio',f.periodo_aquisitivo_inicio,'periodo_aquisitivo_fim',f.periodo_aquisitivo_fim,'inicio',f.inicio,'fim',f.fim,'status',f.status,'dias_gozo',f.dias_gozo,'dias_abono',f.dias_abono,'created_at',f.created_at) ORDER BY f.inicio DESC,f.created_at DESC) FROM public.rh_ferias f WHERE f.funcionario_id=v.funcionario_id AND f.empresa_id=v.empresa_id),'[]'::jsonb),
    'afastamentos',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'tipo',a.tipo,'inicio',a.inicio,'fim',a.fim,'motivo',a.motivo,'status',a.status,'created_at',a.created_at) ORDER BY a.inicio DESC,a.created_at DESC) FROM public.rh_afastamentos a WHERE a.funcionario_id=v.funcionario_id AND a.empresa_id=v.empresa_id),'[]'::jsonb),
    'documentos',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'categoria',d.categoria,'titulo',d.titulo,'arquivo_nome',d.arquivo_nome,'validade',d.validade,'created_at',d.created_at) ORDER BY d.created_at DESC) FROM public.funcionario_documentos d WHERE d.funcionario_id=v.funcionario_id AND d.empresa_id=v.empresa_id),'[]'::jsonb),
    'beneficios',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competencia DESC,x.created_at DESC) FROM (SELECT b.id,b.beneficio_nome,b.competencia,b.valor,b.status,b.motivo,b.observacoes,b.created_at FROM public.rh_beneficios_lancamentos b WHERE b.funcionario_id=v.funcionario_id AND b.empresa_id=v.empresa_id ORDER BY b.competencia DESC,b.created_at DESC LIMIT 60)x),'[]'::jsonb),
    'descontos',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competencia DESC,x.created_at DESC) FROM (SELECT d.id,d.tipo,d.descricao,d.competencia,d.valor,d.status,d.observacoes,d.created_at FROM public.rh_descontos_lancamentos d WHERE d.funcionario_id=v.funcionario_id AND d.empresa_id=v.empresa_id ORDER BY d.competencia DESC,d.created_at DESC LIMIT 60)x),'[]'::jsonb)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_meu_prontuario(text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_painel_ordens_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_data jsonb; v_ordens jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  v_data := public.app_admin_painel_ordens(p_token);
  IF COALESCE((v_data->>'sucesso')::boolean,false) IS NOT TRUE THEN RETURN v_data; END IF;
  SELECT COALESCE(jsonb_agg(j.item || jsonb_build_object(
      'data_entrega',o.data_entrega,'vencimento_financeiro',o.vencimento_financeiro
    ) ORDER BY j.ord),'[]'::jsonb)
  INTO v_ordens
  FROM jsonb_array_elements(COALESCE(v_data->'ordens','[]'::jsonb)) WITH ORDINALITY AS j(item,ord)
  LEFT JOIN public.ordens_servico o ON o.id=(j.item->>'id')::uuid AND o.empresa_id=v.empresa_id;
  RETURN v_data || jsonb_build_object('ordens',v_ordens);
END;
$function$;
REVOKE ALL ON FUNCTION public.app_admin_painel_ordens_financeiro(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_painel_ordens_financeiro(text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_admin_painel_fabrica_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v record; v_data jsonb; v_lotes jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso restrito à gestão da produção.');
  END IF;
  v_data := public.app_admin_painel_fabrica(p_token);
  IF COALESCE((v_data->>'sucesso')::boolean,false) IS NOT TRUE THEN RETURN v_data; END IF;
  SELECT COALESCE(jsonb_agg(j.item || jsonb_build_object(
      'data_entrega',o.data_entrega,'vencimento_financeiro',o.vencimento_financeiro,'status_pagamento',o.status_pagamento
    ) ORDER BY j.ord),'[]'::jsonb)
  INTO v_lotes
  FROM jsonb_array_elements(COALESCE(v_data->'lotes','[]'::jsonb)) WITH ORDINALITY AS j(item,ord)
  LEFT JOIN public.ordens_servico o ON o.id=(j.item->>'id')::uuid AND o.empresa_id=v.empresa_id;
  RETURN v_data || jsonb_build_object('lotes',v_lotes);
END;
$function$;
REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica_financeiro(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_painel_fabrica_financeiro(text) TO anon, authenticated;
-- Garante que concorrência no cron e nos acessos simultâneos use a mesma fila idempotente.
DO $schedule$
DECLARE v_job record; v_job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron não pôde ser habilitado; processamento sob demanda continuará disponível: %', SQLERRM;
  END;
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR v_job IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1' USING 'rf-finance-materialize-due-recurrences'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING v_job.jobid;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1,$2,$3)'
      INTO v_job_id
      USING 'rf-finance-materialize-due-recurrences','*/15 * * * *','SELECT public.app_financeiro_materializar_recorrencias(NULL);';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível registrar o cron de recorrências; processamento sob demanda continuará disponível: %', SQLERRM;
END;
$schedule$;
REVOKE ALL ON FUNCTION public.app_financeiro_recorrencia_set_anchor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financeiro_hr_payable_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_lancar_beneficio_financeiro(text,uuid,text,date,numeric,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_lancar_desconto_financeiro(text,uuid,text,text,text,date,numeric,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financeiro_ordem_before_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financeiro_ordem_after_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financeiro_sync_ordem_from_lancamento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financeiro_proteger_origem_automatica() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_status(text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_salvar(text,uuid,text,text,text,numeric,date,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_executivo(text,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_relatorio(text,text,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_salvar_progresso_fabrica_com_vencimento(text,uuid,jsonb,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_meu_prontuario(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_painel_ordens_financeiro(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_painel_fabrica_financeiro(text) FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
COMMIT;
