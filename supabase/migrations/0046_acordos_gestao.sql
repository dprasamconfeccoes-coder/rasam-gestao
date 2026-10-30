BEGIN;

ALTER TABLE public.acordos_trabalhistas
  ADD COLUMN IF NOT EXISTS funcionario_cpf text;

ALTER TABLE public.acordo_parcelas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'parcela',
  ADD COLUMN IF NOT EXISTS pago_em date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'acordos_trabalhistas_funcionario_cpf_digits_check'
      AND conrelid = 'public.acordos_trabalhistas'::regclass
  ) THEN
    ALTER TABLE public.acordos_trabalhistas
      ADD CONSTRAINT acordos_trabalhistas_funcionario_cpf_digits_check
      CHECK (funcionario_cpf IS NULL OR (length(funcionario_cpf) = 11 AND funcionario_cpf !~ '[^0-9]'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'acordo_parcelas_tipo_check'
      AND conrelid = 'public.acordo_parcelas'::regclass
  ) THEN
    ALTER TABLE public.acordo_parcelas
      ADD CONSTRAINT acordo_parcelas_tipo_check CHECK (tipo IN ('entrada', 'parcela'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_acordos_empresa_created
  ON public.acordos_trabalhistas (empresa_id, created_at DESC, processo);

ALTER TABLE public.acordos_trabalhistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acordo_parcelas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.acordos_trabalhistas, public.acordo_parcelas FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.acordos_trabalhistas_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  acordo_id uuid NOT NULL REFERENCES public.acordos_trabalhistas(id),
  parcela_id uuid REFERENCES public.acordo_parcelas(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  evento text NOT NULL CHECK (evento IN ('acordo_criado', 'status_alterado')),
  motivo text,
  antes jsonb,
  depois jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acordos_auditoria_acordo_created
  ON public.acordos_trabalhistas_auditoria (empresa_id, acordo_id, created_at DESC);

ALTER TABLE public.acordos_trabalhistas_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.acordos_trabalhistas_auditoria FROM PUBLIC, anon, authenticated;

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
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;

  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(x) ORDER BY x.processo, x.numero),
    '[]'::jsonb
  )
  INTO v_result
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
      p.observacoes
    FROM public.acordo_parcelas p
    JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
    WHERE a.empresa_id = v.empresa_id
    ORDER BY a.created_at DESC, a.processo, p.numero
    LIMIT 5000
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'parcelas', v_result);
END;
$function$;

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
DECLARE
  v record;
  v_processo text;
  v_nome text;
  v_cpf text;
  v_cpf_soma integer;
  v_cpf_digito integer;
  v_item jsonb;
  v_tipo text;
  v_numero integer;
  v_valor numeric;
  v_vencimento date;
  v_obs text;
  v_acordo_id uuid;
  v_item_count integer := 0;
  v_entrada_count integer := 0;
  v_seen_numbers integer[] := ARRAY[]::integer[];
  v_total numeric := 0;
  i integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;

  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  v_processo := NULLIF(btrim(COALESCE(p_processo, '')), '');
  v_nome := NULLIF(btrim(COALESCE(p_funcionario_nome, '')), '');
  v_cpf := regexp_replace(COALESCE(p_funcionario_cpf, ''), '[^0-9]', '', 'g');

  IF v_processo IS NULL OR length(v_processo) > 180 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um número de processo válido, com até 180 caracteres.');
  END IF;
  IF v_nome IS NOT NULL AND length(v_nome) > 160 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O nome do funcionário deve ter até 160 caracteres.');
  END IF;
  IF length(COALESCE(p_observacoes, '')) > 5000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'As observações devem ter até 5.000 caracteres.');
  END IF;
  IF v_cpf <> '' THEN
    IF length(v_cpf) <> 11 OR v_cpf = repeat(substr(v_cpf, 1, 1), 11) THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF inválido. Confira os 11 dígitos informados.');
    END IF;

    v_cpf_soma := 0;
    FOR i IN 1..9 LOOP
      v_cpf_soma := v_cpf_soma + substr(v_cpf, i, 1)::integer * (11 - i);
    END LOOP;
    v_cpf_digito := (v_cpf_soma * 10) % 11;
    IF v_cpf_digito = 10 THEN v_cpf_digito := 0; END IF;
    IF v_cpf_digito <> substr(v_cpf, 10, 1)::integer THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF inválido. Confira os dígitos verificadores.');
    END IF;

    v_cpf_soma := 0;
    FOR i IN 1..10 LOOP
      v_cpf_soma := v_cpf_soma + substr(v_cpf, i, 1)::integer * (12 - i);
    END LOOP;
    v_cpf_digito := (v_cpf_soma * 10) % 11;
    IF v_cpf_digito = 10 THEN v_cpf_digito := 0; END IF;
    IF v_cpf_digito <> substr(v_cpf, 11, 1)::integer THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF inválido. Confira os dígitos verificadores.');
    END IF;
  END IF;

  IF COALESCE(jsonb_typeof(p_parcelas), '') <> 'array' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a lista de parcelas do acordo.');
  END IF;
  v_item_count := jsonb_array_length(p_parcelas);
  IF v_item_count < 1 OR v_item_count > 120 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O acordo deve ter entre 1 e 120 itens de pagamento.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.acordos_trabalhistas a
    WHERE a.empresa_id = v.empresa_id AND lower(btrim(a.processo)) = lower(v_processo)
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Já existe um acordo cadastrado com esse número de processo.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_parcelas) AS items(value) LOOP
    IF COALESCE(jsonb_typeof(v_item), '') <> 'object' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada item de pagamento precisa ser um objeto válido.');
    END IF;
    IF v_item - ARRAY['tipo', 'numero', 'valor', 'vencimento', 'observacoes']::text[] <> '{}'::jsonb THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A lista de parcelas contém campos não permitidos.');
    END IF;

    v_tipo := lower(btrim(COALESCE(v_item->>'tipo', 'parcela')));
    IF v_tipo NOT IN ('entrada', 'parcela') THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O tipo do item deve ser entrada ou parcela.');
    END IF;
    IF v_tipo = 'entrada' THEN
      v_entrada_count := v_entrada_count + 1;
      IF v_entrada_count > 1 THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Um acordo pode ter somente uma entrada.');
      END IF;
      v_numero := 0;
    ELSE
      IF COALESCE(v_item->>'numero', '') !~ '^[0-9]{1,4}$' THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um número de parcela inteiro e positivo.');
      END IF;
      v_numero := (v_item->>'numero')::integer;
      IF v_numero < 1 OR v_numero > 9999 THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'O número da parcela deve ficar entre 1 e 9.999.');
      END IF;
      IF v_numero = ANY(v_seen_numbers) THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Há números de parcela repetidos neste acordo.');
      END IF;
      v_seen_numbers := array_append(v_seen_numbers, v_numero);
    END IF;

    IF COALESCE(v_item->>'valor', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um valor positivo com no máximo duas casas decimais.');
    END IF;
    v_valor := (v_item->>'valor')::numeric;
    IF v_valor <= 0 OR v_valor > 9999999999.99 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O valor de cada pagamento deve ser maior que zero e compatível com o limite do sistema.');
    END IF;

    IF COALESCE(v_item->>'vencimento', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um vencimento válido para cada item.');
    END IF;
    v_vencimento := (v_item->>'vencimento')::date;
    v_obs := NULLIF(btrim(COALESCE(v_item->>'observacoes', '')), '');
    IF v_obs IS NOT NULL AND length(v_obs) > 500 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A observação de cada parcela deve ter até 500 caracteres.');
    END IF;

    v_total := v_total + v_valor;
  END LOOP;

  INSERT INTO public.acordos_trabalhistas (
    processo, favorecido, funcionario_cpf, observacoes, created_by, empresa_id
  ) VALUES (
    v_processo, v_nome, NULLIF(v_cpf, ''), NULLIF(btrim(COALESCE(p_observacoes, '')), ''), v.usuario_id, v.empresa_id
  ) RETURNING id INTO v_acordo_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_parcelas) AS items(value) LOOP
    v_tipo := lower(btrim(COALESCE(v_item->>'tipo', 'parcela')));
    IF v_tipo = 'entrada' THEN
      v_numero := 0;
    ELSE
      v_numero := (v_item->>'numero')::integer;
    END IF;
    v_valor := (v_item->>'valor')::numeric;
    v_vencimento := (v_item->>'vencimento')::date;
    v_obs := NULLIF(btrim(COALESCE(v_item->>'observacoes', '')), '');

    INSERT INTO public.acordo_parcelas (acordo_id, numero, tipo, valor, vencimento, status, pago_em, observacoes)
    VALUES (v_acordo_id, v_numero, v_tipo, v_valor, v_vencimento, 'pendente', NULL, v_obs);
  END LOOP;

  INSERT INTO public.acordos_trabalhistas_auditoria (
    empresa_id, acordo_id, usuario_id, evento, depois
  ) VALUES (
    v.empresa_id,
    v_acordo_id,
    v.usuario_id,
    'acordo_criado',
    jsonb_build_object('quantidade_itens', v_item_count, 'valor_total', v_total, 'funcionario_informado', v_nome IS NOT NULL, 'cpf_informado', v_cpf <> '')
  );

  RETURN jsonb_build_object('sucesso', true, 'acordo_id', v_acordo_id, 'quantidade_parcelas', v_item_count);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Já existe um acordo com esse número de processo.');
  WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Há valores, números ou datas inválidos no acordo. Confira os campos e tente novamente.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_atualizar_status_acordo(
  p_token text,
  p_parcela_id uuid,
  p_status text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_status text;
  v_motivo text;
  v_before jsonb;
  v_after jsonb;
  v_acordo_id uuid;
  v_parcela record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou empresa inválida.');
  END IF;
  IF COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  v_status := lower(btrim(COALESCE(p_status, '')));
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_status NOT IN ('quitada', 'pendente') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A parcela só pode ser marcada como quitada ou pendente.');
  END IF;
  IF v_motivo IS NOT NULL AND length(v_motivo) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A justificativa deve ter até 500 caracteres.');
  END IF;

  SELECT p.id, p.acordo_id, p.numero, p.tipo, p.valor, p.vencimento, p.status, p.pago_em, p.observacoes
  INTO v_parcela
  FROM public.acordo_parcelas p
  JOIN public.acordos_trabalhistas a ON a.id = p.acordo_id
  WHERE p.id = p_parcela_id AND a.empresa_id = v.empresa_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Parcela não encontrada neste escopo administrativo.');
  END IF;
  IF v_parcela.status = v_status THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A parcela já está nesse status.');
  END IF;
  IF v_parcela.status = 'quitada' AND v_status = 'pendente' AND v_motivo IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma justificativa para reabrir uma parcela quitada.');
  END IF;

  v_acordo_id := v_parcela.acordo_id;
  v_before := to_jsonb(v_parcela);

  UPDATE public.acordo_parcelas p
  SET status = v_status,
      pago_em = CASE WHEN v_status = 'quitada' THEN current_date ELSE NULL END
  WHERE p.id = p_parcela_id
    AND EXISTS (
      SELECT 1 FROM public.acordos_trabalhistas a
      WHERE a.id = p.acordo_id AND a.empresa_id = v.empresa_id
    )
  RETURNING to_jsonb(p) INTO v_after;

  INSERT INTO public.acordos_trabalhistas_auditoria (
    empresa_id, acordo_id, parcela_id, usuario_id, evento, motivo, antes, depois
  ) VALUES (
    v.empresa_id, v_acordo_id, p_parcela_id, v.usuario_id, 'status_alterado', v_motivo, v_before, v_after
  );

  RETURN jsonb_build_object('sucesso', true, 'status', v_status, 'pago_em', CASE WHEN v_status = 'quitada' THEN current_date ELSE NULL END);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_listar_acordos(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_salvar_acordo(text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_status_acordo(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_acordos(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_acordo(text, text, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_status_acordo(text, uuid, text, text) TO anon, authenticated;

COMMIT;
