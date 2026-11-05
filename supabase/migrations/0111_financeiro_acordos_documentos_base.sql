BEGIN;

-- RF Gestão: forma de pagamento, comprovantes privados e relatórios de Acordos.
-- Esta migration não materializa Acordos no ledger financeiro: o domínio continua
-- operacional e separado para evitar dupla contabilização em Contas a pagar/DRE.

ALTER TABLE public.financeiro_lancamentos
  ADD COLUMN IF NOT EXISTS forma_pagamento text NOT NULL DEFAULT 'outro',
  ADD COLUMN IF NOT EXISTS pago_por uuid REFERENCES public.usuarios(id);

ALTER TABLE public.acordo_parcelas
  ADD COLUMN IF NOT EXISTS forma_pagamento text NOT NULL DEFAULT 'outro',
  ADD COLUMN IF NOT EXISTS pago_por uuid REFERENCES public.usuarios(id);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'financeiro_lancamentos_forma_pagamento_check'
      AND conrelid = 'public.financeiro_lancamentos'::regclass
  ) THEN
    ALTER TABLE public.financeiro_lancamentos
      ADD CONSTRAINT financeiro_lancamentos_forma_pagamento_check
      CHECK (forma_pagamento IN ('pix','transferencia','boleto','outro'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'acordo_parcelas_forma_pagamento_check'
      AND conrelid = 'public.acordo_parcelas'::regclass
  ) THEN
    ALTER TABLE public.acordo_parcelas
      ADD CONSTRAINT acordo_parcelas_forma_pagamento_check
      CHECK (forma_pagamento IN ('pix','transferencia','boleto','outro'));
  END IF;
END;
$constraints$;

CREATE TABLE IF NOT EXISTS public.financeiro_lancamentos_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  lancamento_id uuid NOT NULL REFERENCES public.financeiro_lancamentos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('documento_pagamento','comprovante')),
  storage_path text NOT NULL,
  arquivo_nome text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes > 0),
  uploaded_by uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.acordo_parcelas_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  acordo_parcela_id uuid NOT NULL REFERENCES public.acordo_parcelas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('documento_pagamento','comprovante')),
  storage_path text NOT NULL,
  arquivo_nome text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes > 0),
  uploaded_by uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financeiro_lancamentos_documentos_alvo
  ON public.financeiro_lancamentos_documentos(empresa_id, lancamento_id, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acordo_parcelas_documentos_alvo
  ON public.acordo_parcelas_documentos(empresa_id, acordo_parcela_id, tipo, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_lancamentos_documentos_path
  ON public.financeiro_lancamentos_documentos(empresa_id, storage_path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acordo_parcelas_documentos_path
  ON public.acordo_parcelas_documentos(empresa_id, storage_path);

ALTER TABLE public.financeiro_lancamentos_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acordo_parcelas_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.financeiro_lancamentos_documentos,
  public.acordo_parcelas_documentos FROM PUBLIC, anon, authenticated;

-- Helper estrito: o perfil legado e o role code precisam identificar um administrador.
-- A sessão também precisa estar ativa e o usuário, habilitado.
CREATE OR REPLACE FUNCTION public.app_financeiro_admin_allowed(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile text;
  v_role text;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN false;
  END IF;

  SELECT lower(coalesce(u.perfil, '')), public.app_role_code_for_user(u.id)
    INTO v_profile, v_role
  FROM public.sessoes s
  JOIN public.usuarios u ON u.id = s.usuario_id
  WHERE s.token = p_token
    AND s.expira_em > now()
    AND u.ativo IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN v_profile IN ('admin', 'administrador') OR v_role = 'administrador_sistema';
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$function$;

-- Leitura financeira: preserva as chaves e limites do contrato atual, mas deixa o
-- domínio restrito a administradores e acrescenta forma/anexos sem expor caminhos.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_hoje date := public.app_financeiro_data_local();
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;

  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  PERFORM public.app_financeiro_materializar_recorrencias(v.empresa_id);

  RETURN jsonb_build_object(
    'sucesso', true,
    'contas', (
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento NULLS LAST, x.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT y.*
        FROM (
          SELECT
            u.id, u.tipo, u.categoria, u.descricao, u.fornecedor, u.valor,
            u.competencia, u.vencimento,
            u.status, u.pago_em, u.origem, u.origem_id, u.fonte_registro,
            u.divida_id, u.parcela_numero, u.total_parcelas, u.serie_id,
            u.observacoes, u.created_at,
            coalesce(fl.forma_pagamento, 'outro') AS forma_pagamento,
            CASE WHEN fl.id IS NULL THEN '[]'::jsonb ELSE coalesce((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', d.id,
                  'tipo', d.tipo,
                  'arquivo_nome', d.arquivo_nome,
                  'mime_type', d.mime_type,
                  'tamanho_bytes', d.tamanho_bytes,
                  'created_at', d.created_at
                ) ORDER BY d.created_at DESC
              )
              FROM public.financeiro_lancamentos_documentos d
              WHERE d.empresa_id = v.empresa_id
                AND d.lancamento_id = fl.id
            ), '[]'::jsonb) END AS documentos
          FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) u
          LEFT JOIN public.financeiro_lancamentos fl
            ON fl.id = u.id
           AND fl.empresa_id = v.empresa_id
           AND u.fonte_registro = 'ledger'

          UNION ALL

          SELECT
            l.id, l.tipo, l.categoria, l.descricao, l.fornecedor, l.valor,
            coalesce(l.competencia, l.vencimento), l.vencimento,
            CASE WHEN l.status IN ('pendente', 'vencido') AND l.vencimento < v_hoje
                 THEN 'vencido' ELSE l.status END,
            l.pago_em, l.origem, l.origem_id, 'ledger'::text,
            NULL::uuid, l.parcela_numero, l.total_parcelas, l.serie_id,
            l.observacoes, l.created_at, coalesce(l.forma_pagamento, 'outro'),
            coalesce((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', d.id,
                  'tipo', d.tipo,
                  'arquivo_nome', d.arquivo_nome,
                  'mime_type', d.mime_type,
                  'tamanho_bytes', d.tamanho_bytes,
                  'created_at', d.created_at
                ) ORDER BY d.created_at DESC
              )
              FROM public.financeiro_lancamentos_documentos d
              WHERE d.empresa_id = v.empresa_id
                AND d.lancamento_id = l.id
            ), '[]'::jsonb) AS documentos
          FROM public.financeiro_lancamentos l
          WHERE l.empresa_id = v.empresa_id
            AND l.tipo = 'receber'
        ) y
        ORDER BY y.vencimento NULLS LAST, y.created_at DESC
        LIMIT 1500
      ) x
    ),
    'recorrencias', (
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.proximo_vencimento), '[]'::jsonb)
      FROM (
        SELECT id, descricao, categoria, fornecedor, valor, periodicidade,
          proximo_vencimento, ativo
        FROM public.financeiro_recorrencias
        WHERE empresa_id = v.empresa_id
        ORDER BY ativo DESC, proximo_vencimento
        LIMIT 300
      ) x
    ),
    'parcelas', (
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento), '[]'::jsonb)
      FROM (
        SELECT p.id, p.numero, p.valor, p.vencimento, p.status, p.pago_em,
          p.comprovante_nome, p.fonte_documento, s.credor, s.descricao
        FROM public.financeiro_parcelas p
        JOIN public.financeiro_parcelamentos s ON s.id = p.parcelamento_id
        WHERE p.empresa_id = v.empresa_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.dividas_gestao d
            WHERE d.parcelamento_origem_id = s.id
            LIMIT 1
          )
        ORDER BY p.vencimento
        LIMIT 1000
      ) x
    ),
    'dividas', '[]'::jsonb,
    'receitas_ordens', '[]'::jsonb,
    'resumo', jsonb_build_object(
      'despesas_pendentes', coalesce((
        SELECT sum(a.valor)
        FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status IN ('pendente', 'vencido')
      ), 0),
      'despesas_vencidas', coalesce((
        SELECT sum(a.valor)
        FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status IN ('pendente', 'vencido') AND a.vencimento < v_hoje
      ), 0),
      'receitas_pendentes', coalesce((
        SELECT sum(l.valor)
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id
          AND l.tipo = 'receber'
          AND l.status IN ('pendente', 'vencido')
      ), 0),
      'receitas_recebidas', coalesce((
        SELECT sum(l.valor)
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id
          AND l.tipo = 'receber'
          AND l.status = 'pago'
      ), 0),
      'receitas_ordens_previstas', 0,
      'ordens_aguardando_pagamento', coalesce((
        SELECT count(*)
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id
          AND l.tipo = 'receber'
          AND l.origem = 'ordem_servico'
          AND l.status IN ('pendente', 'vencido')
      ), 0)
    )
  );
END;
$function$;

-- Acordos: contrato principal preservado, agora estritamente admin-only e com
-- forma de pagamento e metadados não sensíveis dos anexos.
CREATE OR REPLACE FUNCTION public.app_listar_acordos(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_result jsonb;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;

  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  SELECT coalesce(
    jsonb_agg(to_jsonb(x) ORDER BY x.processo, x.numero),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT
      p.id,
      a.id AS acordo_id,
      a.processo,
      a.favorecido AS funcionario_nome,
      a.funcionario_cpf,
      a.observacoes AS acordo_observacoes,
      p.tipo,
      p.numero,
      p.valor,
      p.vencimento,
      CASE
        WHEN p.status = 'quitada' THEN 'quitada'
        WHEN p.vencimento IS NOT NULL AND p.vencimento < current_date THEN 'atrasada'
        ELSE 'pendente'
      END AS status,
      p.pago_em,
      p.forma_pagamento,
      p.observacoes,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'tipo', d.tipo,
            'arquivo_nome', d.arquivo_nome,
            'mime_type', d.mime_type,
            'tamanho_bytes', d.tamanho_bytes,
            'created_at', d.created_at
          ) ORDER BY d.created_at DESC
        )
        FROM public.acordo_parcelas_documentos d
        WHERE d.empresa_id = v.empresa_id
          AND d.acordo_parcela_id = p.id
      ), '[]'::jsonb) AS documentos
    FROM public.acordo_parcelas p
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
    WHERE a.empresa_id = v.empresa_id
    ORDER BY a.created_at DESC, a.processo, p.numero
    LIMIT 5000
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'parcelas', v_result);
END;
$function$;

-- Valida o objeto de destino e devolve somente o prefixo necessário para o Edge
-- Function montar um caminho privado. O caminho completo nunca sai deste RPC.

REVOKE ALL ON FUNCTION public.app_financeiro_admin_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_financeiro_admin_allowed(text) TO service_role;
REVOKE ALL ON FUNCTION public.app_admin_financeiro(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_listar_acordos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_acordos(text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
