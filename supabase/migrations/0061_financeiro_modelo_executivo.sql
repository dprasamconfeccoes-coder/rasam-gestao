-- Modelo financeiro executivo: preserva os lançamentos existentes e adiciona
-- dimensões estruturadas para séries, competência, origem e centro de custo.
CREATE TABLE IF NOT EXISTS public.financeiro_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'ambos' CHECK (tipo IN ('pagar','receber','ambos')),
  natureza text NOT NULL DEFAULT 'operacional' CHECK (natureza IN ('operacional','investimento','financiamento','outros')),
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nome)
);

CREATE TABLE IF NOT EXISTS public.financeiro_centros_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nome)
);

CREATE TABLE IF NOT EXISTS public.financeiro_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pagar','receber')),
  descricao text NOT NULL,
  fornecedor text,
  categoria_id uuid REFERENCES public.financeiro_categorias(id),
  centro_custo_id uuid REFERENCES public.financeiro_centros_custo(id),
  valor_parcela numeric(14,2) NOT NULL CHECK (valor_parcela > 0),
  quantidade_parcelas integer CHECK (quantidade_parcelas IS NULL OR quantidade_parcelas BETWEEN 1 AND 120),
  periodicidade text CHECK (periodicidade IS NULL OR periodicidade IN ('semanal','mensal','anual')),
  primeiro_vencimento date,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'manual',
  origem_id uuid,
  observacoes text,
  created_by uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS serie_id uuid REFERENCES public.financeiro_series(id) ON DELETE SET NULL;
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS parcela_numero integer;
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS total_parcelas integer;
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS competencia date;
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS fornecedor text;
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES public.financeiro_categorias(id);
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS centro_custo_id uuid REFERENCES public.financeiro_centros_custo(id);
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';
ALTER TABLE public.financeiro_lancamentos ADD COLUMN IF NOT EXISTS origem_id uuid;

INSERT INTO public.financeiro_categorias (empresa_id,nome,tipo,natureza)
SELECT e.id, x.nome, x.tipo, x.natureza
FROM public.empresas e
CROSS JOIN (VALUES
  ('Operacional','ambos','operacional'),('Água','pagar','operacional'),('Energia','pagar','operacional'),
  ('Internet','pagar','operacional'),('Aluguel','pagar','operacional'),('Honorários','pagar','operacional'),
  ('Folha','pagar','operacional'),('Impostos','pagar','operacional'),('Vendas','receber','operacional'),('Outros','ambos','outros')
) AS x(nome,tipo,natureza)
WHERE e.id IS NOT NULL
ON CONFLICT (empresa_id,nome) DO NOTHING;

INSERT INTO public.financeiro_centros_custo (empresa_id,nome)
SELECT e.id, x.nome
FROM public.empresas e
CROSS JOIN (VALUES ('Administrativo'),('Produção'),('Comercial'),('Recursos humanos'),('Logística'),('Diretoria')) AS x(nome)
WHERE e.id IS NOT NULL
ON CONFLICT (empresa_id,nome) DO NOTHING;

UPDATE public.financeiro_lancamentos l
SET competencia = COALESCE(l.competencia, l.vencimento)
WHERE l.competencia IS NULL;

CREATE INDEX IF NOT EXISTS idx_fin_lanc_empresa_competencia ON public.financeiro_lancamentos(empresa_id, competencia, tipo, status);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_empresa_origem ON public.financeiro_lancamentos(empresa_id, origem, origem_id);
CREATE INDEX IF NOT EXISTS idx_fin_series_empresa_ativo ON public.financeiro_series(empresa_id, ativo, tipo);
CREATE INDEX IF NOT EXISTS idx_fin_categoria_empresa_ativa ON public.financeiro_categorias(empresa_id, ativa);

ALTER TABLE public.financeiro_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_centros_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_series ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_executivo(p_token text, p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE
  v record; v_inicio date := COALESCE(p_inicio, date_trunc('month', current_date)::date - interval '5 months'); v_fim date := COALESCE(p_fim, current_date);
  v_periodo_inicio date := date_trunc('month', v_inicio)::date; v_periodo_fim date := (date_trunc('month', v_fim) + interval '1 month - 1 day')::date;
  v_dias_vencidos integer; v_receber_pendente numeric; v_pagar_pendente numeric; v_receita_realizada numeric; v_despesa_realizada numeric; v_saldo numeric;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  SELECT count(*)::integer, COALESCE(sum(CASE WHEN tipo='receber' THEN valor ELSE 0 END),0), COALESCE(sum(CASE WHEN tipo='pagar' THEN valor ELSE 0 END),0)
  INTO v_dias_vencidos, v_receber_pendente, v_pagar_pendente
  FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND status IN ('pendente','vencido') AND vencimento < current_date;
  SELECT COALESCE(sum(valor),0) INTO v_receita_realizada FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status='pago' AND COALESCE(pago_em,vencimento) BETWEEN v_inicio AND v_fim;
  SELECT COALESCE(sum(valor),0) INTO v_despesa_realizada FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status='pago' AND COALESCE(pago_em,vencimento) BETWEEN v_inicio AND v_fim;
  v_saldo := v_receita_realizada - v_despesa_realizada;
  RETURN jsonb_build_object(
    'sucesso',true,
    'periodo',jsonb_build_object('inicio',v_inicio,'fim',v_fim),
    'kpis',jsonb_build_object(
      'receitas_realizadas',v_receita_realizada,
      'despesas_realizadas',v_despesa_realizada,
      'resultado_realizado',v_saldo,
      'receitas_a_receber',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status IN ('pendente','vencido') AND vencimento BETWEEN v_inicio AND v_periodo_fim),0) + COALESCE((SELECT sum(valor_total) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente'),0),
      'despesas_a_pagar',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento BETWEEN v_inicio AND v_periodo_fim),0),
      'despesas_vencidas',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento < current_date),0),
      'receitas_ordens_previstas',COALESCE((SELECT sum(valor_total) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente'),0),
      'ordens_aguardando_pagamento',COALESCE((SELECT count(*) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente'),0),
      'compromissos_recorrentes',COALESCE((SELECT sum(valor) FROM public.financeiro_recorrencias WHERE empresa_id=v.empresa_id AND ativo),0),
      'recorrencias_ativas',COALESCE((SELECT count(*) FROM public.financeiro_recorrencias WHERE empresa_id=v.empresa_id AND ativo),0),
      'saldo_projetado',v_saldo + COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status IN ('pendente','vencido') AND vencimento >= current_date AND vencimento <= v_periodo_fim),0) - COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento >= current_date AND vencimento <= v_periodo_fim),0)
    ),
    'evolucao',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.mes),'[]'::jsonb) FROM (SELECT gs::date AS mes,
      COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status='pago' AND COALESCE(pago_em,vencimento) >= gs AND COALESCE(pago_em,vencimento) < gs + interval '1 month'),0) AS receitas_realizadas,
      COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status='pago' AND COALESCE(pago_em,vencimento) >= gs AND COALESCE(pago_em,vencimento) < gs + interval '1 month'),0) AS despesas_realizadas,
      COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='receber' AND status IN ('pendente','vencido') AND vencimento >= gs AND vencimento < gs + interval '1 month'),0) + COALESCE((SELECT sum(valor_total) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente' AND prazo >= gs AND prazo < gs + interval '1 month'),0) AS receitas_previstas,
      COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento >= gs AND vencimento < gs + interval '1 month'),0) AS despesas_previstas
      FROM generate_series(v_periodo_inicio, v_periodo_fim, interval '1 month') gs LIMIT 24)m),
    'categorias',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.valor DESC),'[]'::jsonb) FROM (SELECT COALESCE(NULLIF(trim(l.categoria),''),'Sem categoria') AS categoria, sum(l.valor) AS valor, count(*)::integer AS quantidade FROM public.financeiro_lancamentos l WHERE l.empresa_id=v.empresa_id AND l.tipo='pagar' AND l.status <> 'cancelado' AND l.vencimento BETWEEN v_inicio AND v_fim GROUP BY 1 ORDER BY sum(l.valor) DESC LIMIT 10)c),
    'aging',jsonb_build_object(
      'vencido',jsonb_build_object('quantidade',v_dias_vencidos,'valor',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento < current_date),0)),
      'hoje',jsonb_build_object('quantidade',COALESCE((SELECT count(*) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento=current_date),0),'valor',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento=current_date),0)),
      'sete_dias',jsonb_build_object('quantidade',COALESCE((SELECT count(*) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento > current_date AND vencimento <= current_date+7),0),'valor',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento > current_date AND vencimento <= current_date+7),0)),
      'trinta_dias',jsonb_build_object('quantidade',COALESCE((SELECT count(*) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento > current_date+7 AND vencimento <= current_date+30),0),'valor',COALESCE((SELECT sum(valor) FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id AND tipo='pagar' AND status IN ('pendente','vencido') AND vencimento > current_date+7 AND vencimento <= current_date+30),0))
    ),
    'alertas',jsonb_build_array(
      CASE WHEN v_dias_vencidos > 0 THEN jsonb_build_object('nivel','critico','titulo',v_dias_vencidos||' conta(s) vencida(s)','detalhe','Existem obrigações que exigem regularização imediata.') ELSE NULL END,
      CASE WHEN v_pagar_pendente > v_receber_pendente AND v_pagar_pendente > 0 THEN jsonb_build_object('nivel','atencao','titulo','Despesas vencidas superam receitas vencidas','detalhe','Revise o fluxo de caixa e priorize as próximas baixas.') ELSE NULL END,
      CASE WHEN COALESCE((SELECT sum(valor_total) FROM public.ordens_servico WHERE empresa_id=v.empresa_id AND status='entregue' AND status_pagamento='pendente'),0) > 0 THEN jsonb_build_object('nivel','informativo','titulo','Há ordens entregues aguardando recebimento','detalhe','Acompanhe a cobrança de clientes e o prazo médio de recebimento.') ELSE NULL END
    )
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_executivo(text,date,date) TO anon,authenticated;
