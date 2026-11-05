BEGIN;
-- Escritas, consultas financeiras executivas e Acordos: somente administradores.
ALTER FUNCTION public.app_admin_financeiro_executivo(text, date, date)
  RENAME TO app_admin_financeiro_executivo_i112;
ALTER FUNCTION public.app_admin_financeiro_lancamento_salvar(
  text, uuid, text, text, text, numeric, date, text
) RENAME TO app_admin_financeiro_lancamento_salvar_i112;
ALTER FUNCTION public.app_admin_financeiro_lancamento_status(text, uuid, text)
  RENAME TO app_admin_financeiro_lancamento_status_i112;
ALTER FUNCTION public.app_admin_financeiro_lancamento_excluir(text, uuid)
  RENAME TO app_admin_financeiro_lancamento_excluir_i112;
ALTER FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(
  text, text, text, text, numeric, date, integer, text, text
) RENAME TO app_admin_financeiro_lancamentos_serie_salvar_i112;
ALTER FUNCTION public.app_admin_criar_recorrencia(
  text, text, text, text, numeric, text, date
) RENAME TO app_admin_criar_recorrencia_i112;
ALTER FUNCTION public.app_admin_criar_parcelamento(
  text, text, text, text, numeric, integer, numeric, date, jsonb
) RENAME TO app_admin_criar_parcelamento_i112;
ALTER FUNCTION public.app_admin_quitar_parcela(text, uuid, text, text)
  RENAME TO app_admin_quitar_parcela_i112;
ALTER FUNCTION public.app_admin_lancar_beneficio_financeiro(
  text, uuid, text, date, numeric, text, text, text, text, date
) RENAME TO app_admin_lancar_beneficio_financeiro_i112;
ALTER FUNCTION public.app_admin_lancar_desconto_financeiro(
  text, uuid, text, text, text, date, numeric, text, text, date
) RENAME TO app_admin_lancar_desconto_financeiro_i112;
ALTER FUNCTION public.app_admin_salvar_acordo(
  text, text, text, text, text, jsonb
) RENAME TO app_admin_salvar_acordo_i112;
ALTER FUNCTION public.app_admin_atualizar_status_acordo(text, uuid, text, text)
  RENAME TO app_admin_atualizar_status_acordo_i112;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_executivo_i112(text, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_salvar_i112(
  text, uuid, text, text, text, numeric, date, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_status_i112(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_excluir_i112(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar_i112(
  text, text, text, text, numeric, date, integer, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_criar_recorrencia_i112(
  text, text, text, text, numeric, text, date
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_criar_parcelamento_i112(
  text, text, text, text, numeric, integer, numeric, date, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_quitar_parcela_i112(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_lancar_beneficio_financeiro_i112(
  text, uuid, text, date, numeric, text, text, text, text, date
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_lancar_desconto_financeiro_i112(
  text, uuid, text, text, text, date, numeric, text, text, date
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_salvar_acordo_i112(
  text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_status_acordo_i112(
  text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
-- Financeiro: todas as operações protegidas pelo helper estrito. O contrato e
-- os DEFAULTs públicos permanecem exatamente iguais aos anteriores.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro_executivo(
  p_token text,
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_financeiro_executivo_i112(p_token, p_inicio, p_fim);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_salvar(
  p_token text,
  p_id uuid,
  p_tipo text,
  p_categoria text,
  p_descricao text,
  p_valor numeric,
  p_vencimento date,
  p_observacoes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_financeiro_lancamento_salvar_i112(
    p_token, p_id, p_tipo, p_categoria, p_descricao, p_valor, p_vencimento, p_observacoes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_status(
  p_token text,
  p_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_status text := lower(btrim(COALESCE(p_status, '')));
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;

  -- Nunca faça baixa sem método/data/comprovante pelo endpoint legado. A baixa
  -- correta é app_financeiro_lancamento_quitar, chamada pela Edge Function.
  IF v_status = 'pago' THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'A baixa financeira deve usar app_financeiro_lancamento_quitar via Edge, informando método, data e comprovante.'
    );
  END IF;
  IF v_status NOT IN ('pendente', 'cancelado') THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Status operacional inválido. Para baixa, use app_financeiro_lancamento_quitar via Edge.'
    );
  END IF;

  RETURN public.app_admin_financeiro_lancamento_status_i112(p_token, p_id, v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamento_excluir(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_financeiro_lancamento_excluir_i112(p_token, p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(
  p_token text,
  p_tipo text,
  p_categoria text,
  p_descricao text,
  p_valor numeric,
  p_primeiro_vencimento date,
  p_quantidade integer,
  p_periodicidade text,
  p_observacoes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_financeiro_lancamentos_serie_salvar_i112(
    p_token, p_tipo, p_categoria, p_descricao, p_valor, p_primeiro_vencimento,
    p_quantidade, p_periodicidade, p_observacoes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_criar_recorrencia(
  p_token text,
  p_descricao text,
  p_categoria text,
  p_fornecedor text,
  p_valor numeric,
  p_periodicidade text,
  p_proximo_vencimento date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_criar_recorrencia_i112(
    p_token, p_descricao, p_categoria, p_fornecedor, p_valor,
    p_periodicidade, p_proximo_vencimento
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_criar_parcelamento(
  p_token text,
  p_tipo text,
  p_credor text,
  p_descricao text,
  p_valor_entrada numeric,
  p_quantidade integer,
  p_valor_padrao numeric,
  p_primeiro_vencimento date,
  p_valores jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_criar_parcelamento_i112(
    p_token, p_tipo, p_credor, p_descricao, p_valor_entrada, p_quantidade,
    p_valor_padrao, p_primeiro_vencimento, p_valores
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_quitar_parcela(
  p_token text,
  p_id uuid,
  p_comprovante_url text DEFAULT NULL::text,
  p_comprovante_nome text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_quitar_parcela_i112(
    p_token, p_id, p_comprovante_url, p_comprovante_nome
  );
END;
$function$;

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
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_lancar_beneficio_financeiro_i112(
    p_token, p_funcionario_id, p_beneficio_nome, p_competencia, p_valor,
    p_status, p_motivo, p_observacoes, p_fornecedor, p_vencimento
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
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_lancar_desconto_financeiro_i112(
    p_token, p_funcionario_id, p_tipo, p_fornecedor, p_descricao, p_competencia,
    p_valor, p_status, p_observacoes, p_vencimento
  );
END;
$function$;

-- Acordos: somente admin/administrador ou administrador_sistema pelo helper da 0111.
CREATE OR REPLACE FUNCTION public.app_admin_salvar_acordo(
  p_token text,
  p_processo text,
  p_funcionario_nome text,
  p_funcionario_cpf text,
  p_observacoes text,
  p_parcelas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_salvar_acordo_i112(
    p_token, p_processo, p_funcionario_nome, p_funcionario_cpf, p_observacoes, p_parcelas
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_status_acordo(
  p_token text,
  p_parcela_id uuid,
  p_status text,
  p_motivo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record;
BEGIN
  IF NOT public.app_financeiro_admin_allowed(p_token) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito a administradores.');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  RETURN public.app_admin_atualizar_status_acordo_i112(
    p_token, p_parcela_id, p_status, p_motivo
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.app_admin_financeiro_executivo(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_salvar(
  text, uuid, text, text, text, numeric, date, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_status(text, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamento_excluir(text, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(
  text, text, text, text, numeric, date, integer, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_criar_recorrencia(
  text, text, text, text, numeric, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_criar_parcelamento(
  text, text, text, text, numeric, integer, numeric, date, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_quitar_parcela(text, uuid, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_lancar_beneficio_financeiro(
  text, uuid, text, date, numeric, text, text, text, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_lancar_desconto_financeiro(
  text, uuid, text, text, text, date, numeric, text, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_salvar_acordo(
  text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_status_acordo(
  text, uuid, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_executivo(text, date, date)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_salvar(
  text, uuid, text, text, text, numeric, date, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_status(text, uuid, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamento_excluir(text, uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_financeiro_lancamentos_serie_salvar(
  text, text, text, text, numeric, date, integer, text, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_criar_recorrencia(
  text, text, text, text, numeric, text, date
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_criar_parcelamento(
  text, text, text, text, numeric, integer, numeric, date, jsonb
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_quitar_parcela(text, uuid, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_lancar_beneficio_financeiro(
  text, uuid, text, date, numeric, text, text, text, text, date
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_lancar_desconto_financeiro(
  text, uuid, text, text, text, date, numeric, text, text, date
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_acordo(
  text, text, text, text, text, jsonb
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_status_acordo(
  text, uuid, text, text
) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
