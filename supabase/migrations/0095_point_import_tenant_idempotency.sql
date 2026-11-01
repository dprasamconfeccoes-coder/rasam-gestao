-- Aplicar atomicamente; após commit, rollback é uma migration compensatória revisada ou restauração de snapshot.
BEGIN;

-- 0095: Importação de ponto com tenant coerente, datas determinísticas e aplicação idempotente.
-- O CNPJ canônico não fica versionado nesta migration: novas fichas usam empresas.cnpj.
ALTER TABLE public.fechamentos_mensais
  ADD COLUMN IF NOT EXISTS source_fingerprint text;


ALTER TABLE public.ponto_importacoes
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

ALTER TABLE public.ponto_import_linhas
  ALTER COLUMN data DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ponto_import_linhas_import_empresa_func_data_0095
  ON public.ponto_import_linhas (importacao_id, empresa_id, funcionario_id, data);
CREATE INDEX IF NOT EXISTS idx_ponto_importacoes_aplicadas_empresa_data_0095
  ON public.ponto_importacoes (empresa_id, applied_at DESC, created_at DESC)
  WHERE status = 'aplicada';
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracoes_empresa_empresa_id_0095
  ON public.configuracoes_empresa (empresa_id)
  WHERE empresa_id IS NOT NULL;

COMMENT ON COLUMN public.ponto_import_linhas.data IS
  'NULL somente quando a data de origem for inválida; raw_data preserva o valor original e a linha não pode ser aplicada.';

DO $legacy_date_backfill$
DECLARE
  v_row record;
  v_data date;
BEGIN
  FOR v_row IN
    SELECT l.id, l.raw_data->>'data' AS data_origem, l.encontrado, l.funcionario_id
    FROM public.ponto_import_linhas l
  LOOP
    v_data := NULL;
    BEGIN
      IF v_row.data_origem ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T].*)?$' THEN
        v_data := make_date(
          substring(v_row.data_origem FROM 1 FOR 4)::integer,
          substring(v_row.data_origem FROM 6 FOR 2)::integer,
          substring(v_row.data_origem FROM 9 FOR 2)::integer
        );
      ELSIF v_row.data_origem ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}([ T].*)?$' THEN
        v_data := make_date(
          substring(v_row.data_origem FROM '[0-9]{4}')::integer,
          substring(v_row.data_origem FROM '/([0-9]{1,2})/')::integer,
          substring(v_row.data_origem FROM '^([0-9]{1,2})/')::integer
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_data := NULL;
    END;

    IF v_data IS NULL THEN
      IF v_row.encontrado IS TRUE OR v_row.funcionario_id IS NOT NULL THEN
        RAISE EXCEPTION 'Há uma linha com data de origem inválida marcada como encontrada; reconcilie-a antes da migration 0095.';
      END IF;
      UPDATE public.ponto_import_linhas
      SET data = NULL,
          inconsistencia = coalesce(nullif(inconsistencia, ''), 'Data de origem inválida; a data sentinela foi removida.')
      WHERE id = v_row.id;
    ELSE
      UPDATE public.ponto_import_linhas
      SET data = v_data
      WHERE id = v_row.id AND data IS DISTINCT FROM v_data;
    END IF;
  END LOOP;
END;
$legacy_date_backfill$;

DO $cpf_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE cpf IS NOT NULL AND length(regexp_replace(cpf, '[^0-9]', '', 'g')) = 11
    GROUP BY regexp_replace(cpf, '[^0-9]', '', 'g')
    HAVING count(*) > 1
    LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE cpf IS NOT NULL AND length(regexp_replace(cpf, '[^0-9]', '', 'g')) = 11
    GROUP BY regexp_replace(cpf, '[^0-9]', '', 'g')
    HAVING count(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há CPFs duplicados após normalização; resolva-os antes da migration 0095.';
  END IF;
END;
$cpf_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_cpf_normalizado
  ON public.usuarios (regexp_replace(cpf, '[^0-9]', '', 'g'))
  WHERE cpf IS NOT NULL AND length(regexp_replace(cpf, '[^0-9]', '', 'g')) = 11;

CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionarios_cpf_normalizado
  ON public.funcionarios (regexp_replace(cpf, '[^0-9]', '', 'g'))
  WHERE cpf IS NOT NULL AND length(regexp_replace(cpf, '[^0-9]', '', 'g')) = 11;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ponto_importacoes_fingerprint
  ON public.ponto_importacoes (empresa_id, request_fingerprint)
  WHERE request_fingerprint IS NOT NULL;

DO $vinculo_type_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE tipo_vinculo IS NOT NULL
      AND tipo_vinculo NOT IN ('formal', 'informal', 'experiencia', 'diarista')
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há tipos de vínculo não reconhecidos; revise-os antes da migration 0095.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.funcionarios'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tipo_vinculo%'
      AND conname <> 'funcionarios_tipo_vinculo_check'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há outra CHECK que depende de tipo_vinculo; revise-a antes da migration 0095.';
  END IF;
END;
$vinculo_type_preflight$;

ALTER TABLE public.funcionarios DROP CONSTRAINT IF EXISTS funcionarios_tipo_vinculo_check;
ALTER TABLE public.funcionarios
  ADD CONSTRAINT funcionarios_tipo_vinculo_check
  CHECK (tipo_vinculo IN ('formal', 'informal', 'experiencia', 'diarista')) NOT VALID;
ALTER TABLE public.funcionarios VALIDATE CONSTRAINT funcionarios_tipo_vinculo_check;

DO $remuneracao_vinculo_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE (tipo_vinculo = 'diarista' AND (salario IS NOT NULL OR valor_mensal IS NOT NULL OR salario_periodo IS DISTINCT FROM 'Diária' OR valor_diaria IS NULL OR valor_diaria <= 0))
       OR (tipo_vinculo IS DISTINCT FROM 'diarista' AND (valor_diaria IS NOT NULL OR salario_periodo = 'Diária'))
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há remunerações que não correspondem ao tipo de vínculo; revise-as antes da migration 0095.';
  END IF;
END;
$remuneracao_vinculo_preflight$;

ALTER TABLE public.funcionarios
  ADD CONSTRAINT funcionarios_remuneracao_por_vinculo_check
  CHECK (
    (tipo_vinculo = 'diarista' AND salario IS NULL AND valor_mensal IS NULL AND salario_periodo IS NOT DISTINCT FROM 'Diária' AND valor_diaria IS NOT NULL AND valor_diaria > 0)
    OR (tipo_vinculo IS DISTINCT FROM 'diarista' AND valor_diaria IS NULL AND salario_periodo IS DISTINCT FROM 'Diária')
  ) NOT VALID;
ALTER TABLE public.funcionarios VALIDATE CONSTRAINT funcionarios_remuneracao_por_vinculo_check;

-- Deriva o tenant histórico da conta que importou; não presume que a empresa
-- ativa hoje seja dona de todos os lotes antigos.
UPDATE public.ponto_importacoes i
SET empresa_id = u.empresa_id
FROM public.usuarios u
WHERE i.empresa_id IS NULL
  AND i.imported_by = u.id
  AND u.empresa_id IS NOT NULL;

DO $tenant_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ponto_importacoes WHERE empresa_id IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'Há importações antigas sem tenant determinável pelo importador; associe-as manualmente antes da migration 0095.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i ON i.id = l.importacao_id
    WHERE l.empresa_id IS NOT NULL AND l.empresa_id <> i.empresa_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há linhas de importação com tenant diferente do lote; corrija-as antes da migration 0095.';
  END IF;
END;
$tenant_preflight$;

UPDATE public.ponto_import_linhas l
SET empresa_id = i.empresa_id
FROM public.ponto_importacoes i
WHERE i.id = l.importacao_id
  AND l.empresa_id IS NULL;

DO $tenant_postflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i ON i.id = l.importacao_id
    WHERE l.empresa_id IS DISTINCT FROM i.empresa_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'O tenant das linhas importadas não corresponde ao tenant do lote após o backfill.';
  END IF;
END;
$tenant_postflight$;

UPDATE public.registros_ponto r
SET empresa_id = f.empresa_id
FROM public.funcionarios f
WHERE r.funcionario_id = f.id
  AND r.empresa_id IS NULL
  AND f.empresa_id IS NOT NULL;

UPDATE public.justificativas_ponto j
SET empresa_id = f.empresa_id
FROM public.funcionarios f
WHERE j.funcionario_id = f.id
  AND j.empresa_id IS NULL
  AND f.empresa_id IS NOT NULL;

DO $point_tenant_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.registros_ponto WHERE empresa_id IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'Há registros de ponto sem tenant após o backfill; associe-os antes da migration 0095.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.registros_ponto r
    JOIN public.funcionarios f ON f.id = r.funcionario_id
    WHERE r.empresa_id IS DISTINCT FROM f.empresa_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há registros de ponto cujo tenant diverge do funcionário; corrija-os antes da migration 0095.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ponto_inconsistencias p
    JOIN public.funcionarios f ON f.id = p.funcionario_id
    WHERE p.empresa_id IS DISTINCT FROM f.empresa_id
    LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM public.justificativas_ponto j
    JOIN public.funcionarios f ON f.id = j.funcionario_id
    WHERE j.empresa_id IS DISTINCT FROM f.empresa_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Há inconsistências ou justificativas com tenant diferente do funcionário; corrija-as antes da migration 0095.';
  END IF;
END;
$point_tenant_preflight$;

WITH agrupadas AS (
  SELECT l.importacao_id, l.funcionario_id, l.data,
    count(*)::integer AS quantidade,
    count(DISTINCT ROW(
      l.previsto, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
      l.total_normais, l.total_noturno, l.dia_falta, l.horas_atraso,
      l.abono, l.extra_50, l.extra_100, l.desconta_dsr, l.justificativas
    ))::integer AS variantes
  FROM public.ponto_import_linhas l
  JOIN public.ponto_importacoes i ON i.id = l.importacao_id AND i.empresa_id = l.empresa_id
  JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = l.empresa_id
  WHERE i.status = 'aplicada'
    AND l.encontrado = true
    AND l.funcionario_id IS NOT NULL
    AND l.data IS NOT NULL
  GROUP BY l.importacao_id, l.funcionario_id, l.data
  HAVING count(*) > 1
), ranqueadas AS (
  SELECT l.id, a.variantes,
    row_number() OVER (
      PARTITION BY l.importacao_id, l.funcionario_id, l.data
      ORDER BY l.created_at, l.id
    ) AS ordem
  FROM public.ponto_import_linhas l
  JOIN agrupadas a
    ON a.importacao_id = l.importacao_id
   AND a.funcionario_id = l.funcionario_id
   AND a.data = l.data
)
UPDATE public.ponto_import_linhas l
SET inconsistencia = CASE
  WHEN r.variantes > 1 THEN 'Duplicidade histórica conflitante; os metadados do grupo não serão exibidos.'
  ELSE 'Linha duplicada histórica idêntica; cópia redundante não exibida.'
END
FROM ranqueadas r
WHERE l.id = r.id
  AND l.inconsistencia IS NULL
  AND (r.variantes > 1 OR r.ordem > 1);

CREATE OR REPLACE FUNCTION public.app_tenant_usuario(p_token text)
RETURNS TABLE(usuario_id uuid, empresa_id uuid, funcionario_id uuid, perfil text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    u.id::uuid,
    u.empresa_id::uuid,
    u.funcionario_id::uuid,
    public.app_legacy_profile_for_role(public.app_role_code_for_user(u.id))::text
  FROM public.sessoes s
  JOIN public.usuarios u ON u.id = s.usuario_id
  JOIN public.empresas e ON e.id = u.empresa_id AND e.ativo = true
  LEFT JOIN public.funcionarios f ON f.id = u.funcionario_id
  WHERE s.token = p_token
    AND s.expira_em > now()
    AND u.ativo = true
    AND (
      (
        public.app_role_code_for_user(u.id) = 'funcionario'
        AND f.id IS NOT NULL
        AND f.ativo = true
        AND f.empresa_id = u.empresa_id
        AND regexp_replace(f.cpf, '[^0-9]', '', 'g') = regexp_replace(u.cpf, '[^0-9]', '', 'g')
      )
      OR (
        public.app_role_code_for_user(u.id) <> 'funcionario'
        AND (
          u.funcionario_id IS NULL
          OR (
            f.id IS NOT NULL
            AND f.empresa_id = u.empresa_id
            AND regexp_replace(f.cpf, '[^0-9]', '', 'g') = regexp_replace(u.cpf, '[^0-9]', '', 'g')
          )
        )
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_usuario_por_token(p_token text)
RETURNS TABLE(usuario_id uuid, funcionario_id uuid, perfil text, nome text, cargo text, cpf text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    t.usuario_id::uuid,
    t.funcionario_id::uuid,
    t.perfil::text,
    coalesce(f.nome, u.nome_exibicao, 'Usuário administrativo')::text,
    coalesce(f.cargo, '')::text,
    coalesce(f.cpf, u.cpf)::text
  FROM public.app_tenant_usuario(p_token) t
  JOIN public.usuarios u ON u.id = t.usuario_id
  LEFT JOIN public.funcionarios f
    ON f.id = t.funcionario_id
   AND f.empresa_id = t.empresa_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_sessao(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v jsonb;
BEGIN
  BEGIN
    SELECT jsonb_build_object(
      'usuario_id', u.id,
      'funcionario_id', u.funcionario_id,
      'perfil', t.perfil,
      'perfil_acesso', public.app_role_code_for_user(u.id),
      'nome', coalesce(f.nome, u.nome_exibicao, 'Administrador'),
      'cargo', coalesce(f.cargo, ''),
      'cpf', coalesce(f.cpf, u.cpf),
      'primeiro_acesso', coalesce(u.primeiro_acesso, false)
    )
    INTO v
    FROM public.app_tenant_usuario(p_token) t
    JOIN public.usuarios u ON u.id = t.usuario_id
    LEFT JOIN public.funcionarios f
      ON f.id = t.funcionario_id
     AND f.empresa_id = t.empresa_id
    LIMIT 1;
  EXCEPTION WHEN SQLSTATE '28000' THEN
    RETURN jsonb_build_object('valido', false);
  END;

  IF v IS NULL THEN
    RETURN jsonb_build_object('valido', false);
  END IF;
  RETURN jsonb_build_object('valido', true) || v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_login(p_cpf text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario public.usuarios%ROWTYPE;
  v_funcionario public.funcionarios%ROWTYPE;
  v_role text;
  v_token text;
  v_expira timestamptz;
BEGIN
  p_cpf := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  IF length(p_cpf) <> 11 OR coalesce(p_senha, '') = '' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  END IF;

  SELECT u.* INTO v_usuario
  FROM public.usuarios u
  WHERE regexp_replace(u.cpf, '[^0-9]', '', 'g') = p_cpf
    AND u.ativo = true;

  IF NOT FOUND OR v_usuario.senha_hash IS NULL OR crypt(p_senha, v_usuario.senha_hash) <> v_usuario.senha_hash THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  END IF;

  IF v_usuario.empresa_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.empresas e WHERE e.id = v_usuario.empresa_id AND e.ativo = true LIMIT 1
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  END IF;

  v_role := public.app_role_code_for_user(v_usuario.id);
  IF v_usuario.funcionario_id IS NOT NULL THEN
    SELECT f.* INTO v_funcionario
    FROM public.funcionarios f
    WHERE f.id = v_usuario.funcionario_id
      AND f.empresa_id = v_usuario.empresa_id
      AND regexp_replace(f.cpf, '[^0-9]', '', 'g') = regexp_replace(v_usuario.cpf, '[^0-9]', '', 'g');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
    END IF;
  ELSIF v_role = 'funcionario' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  END IF;

  IF v_role = 'funcionario' AND (v_funcionario.id IS NULL OR v_funcionario.ativo IS DISTINCT FROM true) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  END IF;

  DELETE FROM public.sessoes
  WHERE usuario_id = v_usuario.id OR expira_em <= now();

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expira := now() + interval '8 hours';
  INSERT INTO public.sessoes(usuario_id, token, expira_em)
  VALUES (v_usuario.id, v_token, v_expira);

  UPDATE public.usuarios
  SET ultimo_login = now(), updated_at = now()
  WHERE id = v_usuario.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'primeiro_acesso', v_usuario.primeiro_acesso,
    'token', v_token,
    'usuario_id', v_usuario.id,
    'funcionario_id', v_usuario.funcionario_id,
    'nome', coalesce(v_funcionario.nome, v_usuario.nome_exibicao, 'Administrador'),
    'cargo', coalesce(v_funcionario.cargo, ''),
    'perfil', public.app_legacy_profile_for_role(v_role),
    'perfil_acesso', v_role,
    'cpf', coalesce(v_funcionario.cpf, v_usuario.cpf),
    'expira_em', v_expira
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.criar_senha_primeiro_acesso(
  p_cpf text,
  p_data_nascimento text,
  p_nova_senha text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_funcionario public.funcionarios%ROWTYPE;
  v_usuario_existente public.usuarios%ROWTYPE;
  v_cpf text;
  v_data_nascimento_digitos text;
  v_data_nascimento date;
  v_senha_hash text;
  v_token text;
  v_expiracao timestamptz;
  v_usuario_id uuid;
BEGIN
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  IF length(v_cpf) <> 11 THEN
    RETURN json_build_object('sucesso', false, 'erro', 'Dados não conferem');
  END IF;
  IF length(coalesce(p_nova_senha, '')) < 8 THEN
    RETURN json_build_object('sucesso', false, 'erro', 'A nova senha deve ter pelo menos 8 caracteres');
  END IF;

  v_data_nascimento_digitos := regexp_replace(coalesce(p_data_nascimento, ''), '[^0-9]', '', 'g');
  IF length(v_data_nascimento_digitos) <> 8 THEN
    RETURN json_build_object('sucesso', false, 'erro', 'Data de nascimento inválida');
  END IF;
  BEGIN
    v_data_nascimento := make_date(
      substring(v_data_nascimento_digitos FROM 5 FOR 4)::integer,
      substring(v_data_nascimento_digitos FROM 3 FOR 2)::integer,
      substring(v_data_nascimento_digitos FROM 1 FOR 2)::integer
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('sucesso', false, 'erro', 'Data de nascimento inválida');
  END;

  SELECT f.* INTO v_funcionario
  FROM public.funcionarios f
  WHERE regexp_replace(f.cpf, '[^0-9]', '', 'g') = v_cpf
    AND f.data_nascimento = v_data_nascimento
    AND f.ativo = true
    AND EXISTS (
      SELECT 1 FROM public.empresas e
      WHERE e.id = f.empresa_id AND e.ativo = true
      LIMIT 1
    );

  IF NOT FOUND THEN
    RETURN json_build_object('sucesso', false, 'erro', 'Dados não conferem');
  END IF;

  v_senha_hash := crypt(p_nova_senha, gen_salt('bf'));
  SELECT u.* INTO v_usuario_existente
  FROM public.usuarios u
  WHERE regexp_replace(u.cpf, '[^0-9]', '', 'g') = v_cpf;

  IF FOUND THEN
    IF v_usuario_existente.empresa_id IS DISTINCT FROM v_funcionario.empresa_id
       OR v_usuario_existente.funcionario_id IS DISTINCT FROM v_funcionario.id
       OR v_usuario_existente.ativo IS DISTINCT FROM true
       OR v_usuario_existente.primeiro_acesso IS DISTINCT FROM true THEN
      RETURN json_build_object('sucesso', false, 'erro', 'Dados não conferem');
    END IF;
    UPDATE public.usuarios
    SET senha_hash = v_senha_hash,
        primeiro_acesso = false,
        updated_at = now()
    WHERE id = v_usuario_existente.id;
    v_usuario_id := v_usuario_existente.id;
  ELSE
    BEGIN
      INSERT INTO public.usuarios (
        empresa_id, cpf, senha_hash, funcionario_id, primeiro_acesso, ativo, perfil, nome_exibicao
      )
      VALUES (
        v_funcionario.empresa_id,
        regexp_replace(v_funcionario.cpf, '[^0-9]', '', 'g'),
        v_senha_hash,
        v_funcionario.id,
        false,
        true,
        'funcionario',
        v_funcionario.nome
      )
      RETURNING id INTO v_usuario_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN json_build_object('sucesso', false, 'erro', 'Dados não conferem');
    END;
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expiracao := now() + interval '30 days';
  INSERT INTO public.sessoes(usuario_id, token, expira_em)
  VALUES (v_usuario_id, v_token, v_expiracao);

  RETURN json_build_object(
    'sucesso', true,
    'token', v_token,
    'funcionario_id', v_funcionario.id,
    'nome', v_funcionario.nome,
    'cargo', v_funcionario.cargo,
    'expira_em', v_expiracao
  );
END;
$function$;

COMMENT ON FUNCTION public.criar_senha_primeiro_acesso(text, text, text) IS
  'Bootstrap interno e privado; não conceder a anon/authenticated. O cliente define senha via app_definir_senha com token de sessão.';
REVOKE ALL ON FUNCTION public.criar_senha_primeiro_acesso(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_cadastrar_funcionario(
  p_token text,
  p_nome text,
  p_cpf text,
  p_data_nascimento date,
  p_tipo_vinculo text,
  p_cargo text,
  p_telefone text,
  p_endereco text,
  p_valor_mensal numeric,
  p_valor_diaria numeric,
  p_liberar_acesso boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
  v_id uuid;
  v_user uuid;
  v_reg boolean;
  v_cpf text;
  v_empresa_razao_social text;
  v_empresa_cnpj text;
  v_salario numeric;
  v_valor_mensal numeric;
  v_valor_diaria numeric;
  v_salario_periodo text;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF coalesce(p_liberar_acesso, false) AND NOT public.app_tem_permissao(p_token, 'users.create') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Somente o administrador do sistema pode criar acesso de usuário');
  END IF;

  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;

  v_cpf := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  IF trim(coalesce(p_nome, '')) = '' OR length(v_cpf) <> 11 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Nome e CPF são obrigatórios');
  END IF;
  IF p_tipo_vinculo IS NULL OR p_tipo_vinculo NOT IN ('formal', 'informal', 'experiencia', 'diarista') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de vínculo inválido');
  END IF;
  IF coalesce(p_valor_mensal, 0) < 0 OR coalesce(p_valor_diaria, 0) < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Os valores de remuneração não podem ser negativos');
  END IF;
  IF coalesce(p_liberar_acesso, false) AND p_data_nascimento IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a data de nascimento para criar o acesso');
  END IF;
  IF coalesce(p_valor_mensal, 0) > 0 AND coalesce(p_valor_diaria, 0) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe remuneração mensal ou diária, não ambas');
  END IF;
  IF coalesce(p_valor_diaria, 0) > 0 AND p_tipo_vinculo <> 'diarista' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor diário só pode ser informado para vínculo diarista');
  END IF;
  IF p_tipo_vinculo = 'diarista' AND coalesce(p_valor_mensal, 0) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Vínculo diarista não pode receber remuneração mensal');
  END IF;
  IF p_tipo_vinculo = 'formal' AND coalesce(p_valor_mensal, 0) <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Para vínculo formal, informe o valor mensal');
  END IF;
  IF p_tipo_vinculo = 'diarista' AND coalesce(p_valor_diaria, 0) <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Para vínculo diarista, informe o valor da diária');
  END IF;

  -- Namespace próprio por CPF, também usado pela importação. Lotes múltiplos
  -- adquirem os CPFs em ordem crescente antes de consultar/cadastrar pessoas.
  PERFORM pg_advisory_xact_lock(20261101, hashtext(v_cpf));
  IF EXISTS (
    SELECT 1 FROM public.funcionarios f
    WHERE regexp_replace(f.cpf, '[^0-9]', '', 'g') = v_cpf
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF já cadastrado');
  END IF;

  SELECT e.razao_social,
         regexp_replace(coalesce(e.cnpj, ''), '[^0-9]', '', 'g')
  INTO v_empresa_razao_social, v_empresa_cnpj
  FROM public.empresas e
  WHERE e.id = v.empresa_id AND e.ativo = true
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Empresa não encontrada');
  END IF;
  IF length(v_empresa_cnpj) <> 14 THEN
    v_empresa_cnpj := NULL;
  END IF;

  v_reg := p_tipo_vinculo = 'formal';
  v_valor_mensal := CASE WHEN p_valor_mensal > 0 THEN p_valor_mensal ELSE NULL END;
  v_valor_diaria := CASE WHEN p_valor_diaria > 0 THEN p_valor_diaria ELSE NULL END;
  -- A diária nunca é copiada para salario; o fechamento mensal usa salario como base.
  v_salario := v_valor_mensal;
  v_salario_periodo := CASE
    WHEN v_valor_mensal IS NOT NULL THEN 'Mês'
    WHEN v_valor_diaria IS NOT NULL THEN 'Diária'
    ELSE 'Mês'
  END;

  INSERT INTO public.funcionarios (
    empresa_id, empregador_razao_social, empregador_cnpj,
    nome, cpf, data_nascimento, tipo_vinculo, registrado, cargo,
    telefone_celular, endereco, salario, salario_periodo, valor_mensal, valor_diaria,
    elegivel_holerite, elegivel_escritorio, elegivel_vale, ativo, cadastro_tipo
  )
  VALUES (
    v.empresa_id, v_empresa_razao_social, v_empresa_cnpj,
    trim(p_nome), v_cpf, p_data_nascimento, p_tipo_vinculo, v_reg,
    nullif(trim(p_cargo), ''), nullif(trim(p_telefone), ''), nullif(trim(p_endereco), ''),
    v_salario, v_salario_periodo, v_valor_mensal, v_valor_diaria,
    v_reg, v_reg, true, true, CASE WHEN v_reg THEN 'completo' ELSE 'basico' END
  )
  RETURNING id INTO v_id;

  IF p_liberar_acesso THEN
    INSERT INTO public.usuarios (
      empresa_id, cpf, senha_hash, funcionario_id, primeiro_acesso, ativo, perfil, nome_exibicao
    )
    VALUES (
      v.empresa_id,
      v_cpf,
      crypt(to_char(p_data_nascimento, 'DDMMYYYY'), gen_salt('bf')),
      v_id,
      true,
      true,
      'funcionario',
      trim(p_nome)
    )
    RETURNING id INTO v_user;

    INSERT INTO public.app_user_roles(usuario_id, role_code)
    VALUES (v_user, 'funcionario')
    ON CONFLICT (usuario_id) DO UPDATE SET role_code = 'funcionario';
  END IF;

  INSERT INTO public.funcionario_timeline(empresa_id, funcionario_id, evento, descricao, origem, created_by)
  VALUES (v.empresa_id, v_id, 'Cadastro criado', 'Funcionário cadastrado no sistema', 'cadastro', v.usuario_id);

  RETURN jsonb_build_object('sucesso', true, 'funcionario_id', v_id, 'usuario_id', v_user);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'CPF já cadastrado');
END;
$function$;

-- Valores de remuneração nulos significam “não alterar”; diária nunca é inferida como salário mensal.
CREATE OR REPLACE FUNCTION public.app_admin_registrar_admissao_legacy(
  p_token text,
  p_funcionario_id uuid,
  p_data_admissao date,
  p_tipo_vinculo text DEFAULT NULL,
  p_cargo text DEFAULT NULL,
  p_valor_mensal numeric DEFAULT NULL,
  p_valor_diaria numeric DEFAULT NULL,
  p_registrado boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_func public.funcionarios%ROWTYPE;
  v_tipo_vinculo text;
  v_reg boolean;
  v_mensal numeric;
  v_diaria numeric;
  v_atualizadas integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.perfil NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao administrador');
  END IF;

  SELECT * INTO v_func
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id AND f.empresa_id = v_usuario.empresa_id
  LIMIT 1;
  IF v_func.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado');
  END IF;
  IF p_data_admissao IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a data de admissão');
  END IF;
  IF coalesce(p_valor_mensal, 0) < 0 OR coalesce(p_valor_diaria, 0) < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Os valores de remuneração não podem ser negativos');
  END IF;
  v_tipo_vinculo := coalesce(nullif(trim(p_tipo_vinculo), ''), v_func.tipo_vinculo);
  IF v_tipo_vinculo IS NULL OR v_tipo_vinculo NOT IN ('formal', 'informal', 'experiencia', 'diarista') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de vínculo inválido');
  END IF;
  IF coalesce(p_valor_mensal, 0) > 0 AND coalesce(p_valor_diaria, 0) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe remuneração mensal ou diária, não ambas');
  END IF;
  IF coalesce(p_valor_diaria, 0) > 0 AND v_tipo_vinculo <> 'diarista' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor diário só pode ser informado para vínculo diarista');
  END IF;
  IF v_tipo_vinculo = 'diarista' AND coalesce(p_valor_mensal, 0) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Vínculo diarista não pode receber remuneração mensal');
  END IF;
  IF v_tipo_vinculo = 'diarista'
     AND v_func.tipo_vinculo IS DISTINCT FROM 'diarista'
     AND coalesce(p_valor_diaria, 0) <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o valor da diária ao alterar o vínculo para diarista');
  END IF;

  v_reg := CASE WHEN v_tipo_vinculo = 'diarista' THEN false ELSE coalesce(p_registrado, v_tipo_vinculo = 'formal') END;
  v_mensal := CASE WHEN p_valor_mensal > 0 THEN p_valor_mensal ELSE NULL END;
  v_diaria := CASE WHEN p_valor_diaria > 0 THEN p_valor_diaria ELSE NULL END;

  UPDATE public.funcionarios
  SET data_admissao = p_data_admissao,
      data_demissao = NULL,
      motivo_demissao = NULL,
      ativo = true,
      tipo_vinculo = v_tipo_vinculo,
      cargo = coalesce(nullif(trim(p_cargo), ''), cargo),
      salario = CASE WHEN v_tipo_vinculo = 'diarista' THEN NULL WHEN v_mensal IS NOT NULL THEN v_mensal WHEN v_func.tipo_vinculo = 'diarista' THEN NULL ELSE salario END,
      salario_periodo = CASE WHEN v_tipo_vinculo = 'diarista' THEN 'Diária' WHEN v_mensal IS NOT NULL THEN 'Mês' WHEN v_func.tipo_vinculo = 'diarista' THEN 'Mês' ELSE salario_periodo END,
      valor_mensal = CASE WHEN v_tipo_vinculo = 'diarista' THEN NULL WHEN v_mensal IS NOT NULL THEN v_mensal WHEN v_func.tipo_vinculo = 'diarista' THEN NULL ELSE valor_mensal END,
      valor_diaria = CASE WHEN v_tipo_vinculo = 'diarista' THEN coalesce(v_diaria, CASE WHEN v_func.tipo_vinculo = 'diarista' THEN valor_diaria ELSE NULL END) ELSE NULL END,
      registrado = v_reg,
      elegivel_holerite = v_reg,
      elegivel_escritorio = v_reg
  WHERE id = p_funcionario_id AND empresa_id = v_usuario.empresa_id;
  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;
  IF v_atualizadas <> 1 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado');
  END IF;

  UPDATE public.usuarios
  SET ativo = true
  WHERE funcionario_id = p_funcionario_id
    AND empresa_id = v_usuario.empresa_id;

  INSERT INTO public.funcionario_timeline(empresa_id, funcionario_id, evento, descricao, origem, created_by)
  VALUES (
    v_usuario.empresa_id, p_funcionario_id, 'Admissão registrada',
    'Vínculo admitido em ' || to_char(p_data_admissao, 'DD/MM/YYYY'),
    'rh', v_usuario.usuario_id
  );
  RETURN jsonb_build_object('sucesso', true, 'funcionario_id', p_funcionario_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_ponto_horario_placeholder(p_valor text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT nullif(trim(coalesce(p_valor, '')), '') IS NULL
    OR lower(trim(coalesce(p_valor, ''))) IN (
      '-', '--', '---', '—', '–', '‐', '−', '--:--', '—:—', '...', '…', '/', '*', '**',
      'n/a', 'na', 'n/d', 'n/p', 's/m', 'não', 'nao', 'n', 'false',
      'falta', 'folga', 'ferias', 'férias', 'atestado', 'afastamento',
      'abono', 'feriado', 'dsr', 'repouso', 'descanso',
      'sem marcação', 'sem marcacao', 'sem ponto', 'sem registro', 'sem batida'
    )
    OR lower(trim(coalesce(p_valor, ''))) ~ '^(falta|folga|ferias|férias|atestado|afast|abono|feriado|dsr|repouso|descanso|não|nao)([[:space:][:punct:]].*)?$'
    OR lower(trim(coalesce(p_valor, ''))) ~ '^sem[[:space:]]'
    OR lower(trim(coalesce(p_valor, ''))) IN ('---', '...', '…', '/', '*', '**', '‐', '−');
$function$;

CREATE OR REPLACE FUNCTION public.app_importar_ponto(
  p_token text,
  p_tipo text,
  p_competencia text,
  p_arquivo_nome text,
  p_linhas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_importacao uuid;
  v_existente public.ponto_importacoes%ROWTYPE;
  v_linha jsonb;
  v_funcionario_id uuid;
  v_total integer := 0;
  v_encontradas integer := 0;
  v_nao_encontradas integer := 0;
  v_cpfs jsonb := '[]'::jsonb;
  v_data date;
  v_data_texto text;
  v_cpf text;
  v_nome text;
  v_inconsistencia text;
  v_e1 time;
  v_s1 time;
  v_e2 time;
  v_s2 time;
  v_arquivo_nome text;
  v_fingerprint text;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('diario', 'mensal') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo de ponto inválido');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
     OR right(p_competencia, 4) = '0000' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência deve estar no formato MM/AAAA e conter mês entre 01 e 12');
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo de ponto inválido');
  END IF;
  IF jsonb_array_length(p_linhas) = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo de ponto inválido');
  END IF;

  v_arquivo_nome := coalesce(nullif(trim(p_arquivo_nome), ''), 'ponto.csv');
  v_fingerprint := encode(extensions.digest(jsonb_build_array(
    v_usuario.empresa_id::text,
    p_tipo,
    coalesce(p_competencia, ''),
    p_linhas
  )::text, 'sha256'), 'hex');

  -- Namespace distinto dos locks de CPF; o índice UNIQUE abaixo é a garantia final.
  PERFORM pg_advisory_xact_lock(20261102, hashtext(v_fingerprint));

  SELECT i.* INTO v_existente
  FROM public.ponto_importacoes i
  WHERE i.empresa_id = v_usuario.empresa_id
    AND i.request_fingerprint = v_fingerprint;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', true,
      'importacao_id', v_existente.id,
      'status', v_existente.status,
      'total_linhas', v_existente.total_linhas,
      'linhas_encontradas', v_existente.linhas_encontradas,
      'linhas_nao_encontradas', v_existente.linhas_nao_encontradas,
      'cpfs_nao_encontrados', v_existente.cpfs_nao_encontrados,
      'reutilizada', true
    );
  END IF;

  -- Adquire os locks pela chave advisory (hash e CPF), em ordem comum entre lotes.
  FOR v_cpf IN
    SELECT cpfs.cpf
    FROM (
      SELECT DISTINCT regexp_replace(coalesce(item.value->>'cpf', ''), '[^0-9]', '', 'g') AS cpf
      FROM jsonb_array_elements(p_linhas) AS item(value)
      WHERE length(regexp_replace(coalesce(item.value->>'cpf', ''), '[^0-9]', '', 'g')) = 11
    ) cpfs
    ORDER BY hashtext(cpfs.cpf), cpfs.cpf
  LOOP
    PERFORM pg_advisory_xact_lock(20261101, hashtext(v_cpf));
  END LOOP;

  INSERT INTO public.ponto_importacoes (
    empresa_id, tipo, competencia, arquivo_nome, imported_by, status, request_fingerprint
  )
  VALUES (
    v_usuario.empresa_id, p_tipo, p_competencia, v_arquivo_nome,
    v_usuario.usuario_id, 'pendente', v_fingerprint
  )
  RETURNING id INTO v_importacao;

  FOR v_linha IN SELECT value FROM jsonb_array_elements(p_linhas)
  LOOP
    v_total := v_total + 1;
    v_funcionario_id := NULL;
    v_inconsistencia := NULL;
    v_cpf := regexp_replace(coalesce(v_linha->>'cpf', ''), '[^0-9]', '', 'g');
    v_nome := coalesce(nullif(trim(v_linha->>'nome'), ''), 'Nome não informado');
    v_data_texto := trim(coalesce(v_linha->>'data', ''));
    v_data := NULL;

    -- Aceita ISO YYYY-MM-DD ou dia/mês/ano; make_date não depende de DateStyle.
    BEGIN
      IF v_data_texto ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        v_data := make_date(
          substring(v_data_texto FROM 1 FOR 4)::integer,
          substring(v_data_texto FROM 6 FOR 2)::integer,
          substring(v_data_texto FROM 9 FOR 2)::integer
        );
      ELSIF v_data_texto ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN
        v_data := make_date(
          split_part(v_data_texto, '/', 3)::integer,
          split_part(v_data_texto, '/', 2)::integer,
          split_part(v_data_texto, '/', 1)::integer
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_data := NULL;
    END;

    IF length(v_cpf) <> 11 THEN
      v_inconsistencia := 'CPF ausente ou inválido';
    ELSIF v_data IS NULL THEN
      v_inconsistencia := 'Data do registro inválida';
    ELSE
      SELECT f.id INTO v_funcionario_id
      FROM public.funcionarios f
      WHERE regexp_replace(f.cpf, '[^0-9]', '', 'g') = v_cpf
        AND f.empresa_id = v_usuario.empresa_id
        AND f.ativo = true;
      IF v_funcionario_id IS NULL THEN
        v_inconsistencia := 'CPF não encontrado no cadastro ativo';
      END IF;
    END IF;

    IF v_inconsistencia IS NULL AND jsonb_typeof(v_linha->'import_validation_errors') = 'array' THEN
      SELECT left(nullif(trim(err.mensagem), ''), 300) INTO v_inconsistencia
      FROM jsonb_array_elements_text(v_linha->'import_validation_errors') WITH ORDINALITY AS err(mensagem, ordem)
      WHERE nullif(trim(err.mensagem), '') IS NOT NULL
      ORDER BY err.ordem
      LIMIT 1;
    END IF;

    IF v_inconsistencia IS NULL THEN
      SELECT CASE
        WHEN campos.horario THEN format('Horário %s inválido; use HH:MM entre 00:00 e 23:59.', campos.nome)
        ELSE format('Duração %s inválida; use HH:MM com minutos 00–59 ou horas decimais.', campos.nome)
      END
      INTO v_inconsistencia
      FROM (VALUES
        (1, 'Entrada 1', v_linha->>'entrada_1', true),
        (2, 'Saída 1', v_linha->>'saida_1', true),
        (3, 'Entrada 2', v_linha->>'entrada_2', true),
        (4, 'Saída 2', v_linha->>'saida_2', true),
        (5, 'horas normais', v_linha->>'total_normais', false),
        (6, 'horas noturnas', v_linha->>'total_noturno', false),
        (7, 'atraso', v_linha->>'horas_atraso', false),
        (8, 'extra 50%', v_linha->>'extra_50', false),
        (9, 'extra 100%', v_linha->>'extra_100', false)
      ) AS campos(ordem, nome, valor, horario)
      WHERE nullif(trim(coalesce(campos.valor, '')), '') IS NOT NULL
        AND CASE
          WHEN campos.horario THEN trim(campos.valor) !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(campos.valor)
          ELSE trim(campos.valor) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$'
        END
      ORDER BY campos.ordem
      LIMIT 1;
    END IF;

    v_e1 := CASE WHEN trim(coalesce(v_linha->>'entrada_1', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      THEN trim(v_linha->>'entrada_1')::time ELSE NULL END;
    v_s1 := CASE WHEN trim(coalesce(v_linha->>'saida_1', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      THEN trim(v_linha->>'saida_1')::time ELSE NULL END;
    v_e2 := CASE WHEN trim(coalesce(v_linha->>'entrada_2', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      THEN trim(v_linha->>'entrada_2')::time ELSE NULL END;
    v_s2 := CASE WHEN trim(coalesce(v_linha->>'saida_2', '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      THEN trim(v_linha->>'saida_2')::time ELSE NULL END;

    INSERT INTO public.ponto_import_linhas (
      importacao_id, empresa_id, funcionario_id, cpf, nome_csv, data, previsto,
      entrada_1, saida_1, entrada_2, saida_2, total_normais, total_noturno,
      dia_falta, horas_atraso, abono, extra_50, extra_100, desconta_dsr,
      justificativas, encontrado, inconsistencia, raw_data
    )
    VALUES (
      v_importacao, v_usuario.empresa_id, v_funcionario_id, v_cpf, v_nome, v_data,
      v_linha->>'previsto', v_e1, v_s1, v_e2, v_s2,
      v_linha->>'total_normais', v_linha->>'total_noturno', v_linha->>'dia_falta',
      v_linha->>'horas_atraso', v_linha->>'abono', v_linha->>'extra_50',
      v_linha->>'extra_100', v_linha->>'desconta_dsr', v_linha->>'justificativas',
      v_funcionario_id IS NOT NULL, v_inconsistencia, v_linha
    );

    IF v_funcionario_id IS NULL THEN
      v_nao_encontradas := v_nao_encontradas + 1;
      v_cpfs := v_cpfs || jsonb_build_array(CASE WHEN v_cpf = '' THEN v_nome ELSE v_cpf END);
    ELSE
      v_encontradas := v_encontradas + 1;
    END IF;
  END LOOP;

  UPDATE public.ponto_importacoes
  SET total_linhas = v_total,
      linhas_encontradas = v_encontradas,
      linhas_nao_encontradas = v_nao_encontradas,
      cpfs_nao_encontrados = v_cpfs
  WHERE id = v_importacao
    AND empresa_id = v_usuario.empresa_id;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (
    v_usuario.usuario_id,
    'analisou_importacao_ponto',
    'ponto_importacoes',
    jsonb_build_object(
      'importacao_id', v_importacao,
      'tipo', p_tipo,
      'competencia', p_competencia,
      'total_linhas', v_total,
      'linhas_encontradas', v_encontradas,
      'linhas_nao_encontradas', v_nao_encontradas
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'importacao_id', v_importacao,
    'status', 'pendente',
    'total_linhas', v_total,
    'linhas_encontradas', v_encontradas,
    'linhas_nao_encontradas', v_nao_encontradas,
    'cpfs_nao_encontrados', v_cpfs,
    'reutilizada', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_aplicar_importacao_ponto(p_token text, p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_importacao public.ponto_importacoes%ROWTYPE;
  v_aplicadas integer := 0;
  v_duplicadas integer := 0;
  v_grupos_conflitantes integer := 0;
  v_linhas_inconsistentes integer := 0;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  SELECT * INTO v_importacao
  FROM public.ponto_importacoes
  WHERE id = p_importacao_id
    AND empresa_id = v_usuario.empresa_id
  FOR UPDATE;
  IF v_importacao.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Importação não encontrada');
  END IF;
  IF v_importacao.status <> 'pendente' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Esta importação já foi processada');
  END IF;

  WITH agrupadas AS (
    SELECT l.funcionario_id, l.data,
      count(*)::integer AS quantidade,
      count(DISTINCT ROW(
        l.previsto, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
        l.total_normais, l.total_noturno, l.dia_falta, l.horas_atraso,
        l.abono, l.extra_50, l.extra_100, l.desconta_dsr, l.justificativas
      ))::integer AS variantes
    FROM public.ponto_import_linhas l
    JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    WHERE l.importacao_id = p_importacao_id
      AND l.empresa_id = v_usuario.empresa_id
      AND l.encontrado = true
      AND l.inconsistencia IS NULL
      AND l.funcionario_id IS NOT NULL
      AND l.data IS NOT NULL
    GROUP BY l.funcionario_id, l.data
  )
  SELECT coalesce(sum(a.quantidade - 1), 0)::integer,
         count(*) FILTER (WHERE a.quantidade > 1 AND a.variantes > 1)::integer
  INTO v_duplicadas, v_grupos_conflitantes
  FROM agrupadas a;

  -- Conflitos pessoa/data não são escolhidos arbitrariamente; cópias idênticas
  -- preservam uma linha e marcam somente as redundantes para a revisão.
  WITH agrupadas AS (
    SELECT l.funcionario_id, l.data,
      count(*)::integer AS quantidade,
      count(DISTINCT ROW(
        l.previsto, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
        l.total_normais, l.total_noturno, l.dia_falta, l.horas_atraso,
        l.abono, l.extra_50, l.extra_100, l.desconta_dsr, l.justificativas
      ))::integer AS variantes
    FROM public.ponto_import_linhas l
    JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    WHERE l.importacao_id = p_importacao_id
      AND l.empresa_id = v_usuario.empresa_id
      AND l.encontrado = true
      AND l.inconsistencia IS NULL
      AND l.funcionario_id IS NOT NULL
      AND l.data IS NOT NULL
    GROUP BY l.funcionario_id, l.data
  ), ranqueadas AS (
    SELECT l.id, a.quantidade, a.variantes,
      row_number() OVER (PARTITION BY l.funcionario_id, l.data ORDER BY l.created_at, l.id) AS ordem
    FROM public.ponto_import_linhas l
    JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    JOIN agrupadas a ON a.funcionario_id = l.funcionario_id AND a.data = l.data
    WHERE l.importacao_id = p_importacao_id
      AND l.empresa_id = v_usuario.empresa_id
      AND l.encontrado = true
      AND l.inconsistencia IS NULL
      AND l.funcionario_id IS NOT NULL
      AND l.data IS NOT NULL
  )
  UPDATE public.ponto_import_linhas l
  SET inconsistencia = CASE
    WHEN r.variantes > 1 THEN 'Duplicidade conflitante para a mesma pessoa/data; o grupo não foi aplicado.'
    ELSE 'Linha duplicada idêntica para a mesma pessoa/data; esta cópia não foi aplicada.'
  END
  FROM ranqueadas r
  WHERE l.id = r.id
    AND r.quantidade > 1
    AND (r.variantes > 1 OR r.ordem > 1);

  UPDATE public.ponto_import_linhas l
  SET inconsistencia = coalesce(nullif(l.inconsistencia, ''), 'Registro existente para a mesma pessoa/data pertence a outro tenant; a linha não foi aplicada.')
  FROM public.funcionarios f
  JOIN public.registros_ponto r ON r.funcionario_id = f.id
  WHERE l.importacao_id = p_importacao_id
    AND l.empresa_id = v_usuario.empresa_id
    AND l.encontrado = true
    AND l.funcionario_id = f.id
    AND f.empresa_id = v_usuario.empresa_id
    AND r.data = l.data
    AND r.empresa_id IS DISTINCT FROM v_usuario.empresa_id;

  WITH chaves_sem_conflito AS (
    SELECT l.funcionario_id, l.data
    FROM public.ponto_import_linhas l
    JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    WHERE l.importacao_id = p_importacao_id
      AND l.empresa_id = v_usuario.empresa_id
      AND l.encontrado = true
      AND l.inconsistencia IS NULL
      AND l.funcionario_id IS NOT NULL
      AND l.data IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.registros_ponto r
        WHERE r.funcionario_id = l.funcionario_id
          AND r.data = l.data
          AND r.empresa_id IS DISTINCT FROM v_usuario.empresa_id
      )
    GROUP BY l.funcionario_id, l.data
    HAVING count(DISTINCT ROW(
      l.previsto, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
      l.total_normais, l.total_noturno, l.dia_falta, l.horas_atraso,
      l.abono, l.extra_50, l.extra_100, l.desconta_dsr, l.justificativas
    )) = 1
  ), selecionadas AS (
    SELECT DISTINCT ON (l.funcionario_id, l.data)
      l.funcionario_id, l.data, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2, l.dia_falta, l.total_normais
    FROM public.ponto_import_linhas l
    JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    JOIN chaves_sem_conflito c
      ON c.funcionario_id = l.funcionario_id AND c.data = l.data
    WHERE l.importacao_id = p_importacao_id
      AND l.empresa_id = v_usuario.empresa_id
      AND l.encontrado = true
      AND l.inconsistencia IS NULL
      AND l.funcionario_id IS NOT NULL
      AND l.data IS NOT NULL
    ORDER BY l.funcionario_id, l.data, l.created_at, l.id
  )
  INSERT INTO public.registros_ponto AS existing (
    empresa_id, funcionario_id, data, entrada, saida_almoco, volta_almoco, saida, horas_trabalhadas, status
  )
  SELECT
    v_usuario.empresa_id,
    s.funcionario_id,
    s.data,
    s.entrada_1,
    s.saida_1,
    s.entrada_2,
    s.saida_2,
    CASE
      WHEN trim(coalesce(s.total_normais, '')) ~ '^[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?$'
      THEN make_interval(secs => (
        split_part(trim(s.total_normais), ':', 1)::numeric * 3600
        + split_part(trim(s.total_normais), ':', 2)::numeric * 60
        + coalesce(nullif(split_part(trim(s.total_normais), ':', 3), '')::numeric, 0)
      )::double precision)
      WHEN trim(coalesce(s.total_normais, '')) ~ '^[0-9]+([,.][0-9]+)?$'
      THEN make_interval(secs => (replace(trim(s.total_normais), ',', '.')::numeric * 3600)::double precision)
      ELSE NULL
    END,
    CASE WHEN nullif(trim(coalesce(s.dia_falta, '')), '') IS NOT NULL AND lower(trim(s.dia_falta)) NOT IN ('não','nao','n','0','false') THEN 'falta' ELSE 'normal' END
  FROM selecionadas s
  ON CONFLICT (funcionario_id, data) DO UPDATE
  SET empresa_id = EXCLUDED.empresa_id,
      entrada = EXCLUDED.entrada,
      saida_almoco = EXCLUDED.saida_almoco,
      volta_almoco = EXCLUDED.volta_almoco,
      saida = EXCLUDED.saida,
      horas_trabalhadas = coalesce(EXCLUDED.horas_trabalhadas, existing.horas_trabalhadas),
      status = EXCLUDED.status
  WHERE existing.empresa_id = EXCLUDED.empresa_id;

  GET DIAGNOSTICS v_aplicadas = ROW_COUNT;

  SELECT count(*)::integer INTO v_linhas_inconsistentes
  FROM public.ponto_import_linhas l
  WHERE l.importacao_id = p_importacao_id
    AND l.empresa_id = v_usuario.empresa_id
    AND l.inconsistencia IS NOT NULL;

  UPDATE public.ponto_importacoes
  SET status = 'aplicada', applied_at = now(), applied_by = v_usuario.usuario_id
  WHERE id = p_importacao_id
    AND empresa_id = v_usuario.empresa_id;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (
    v_usuario.usuario_id,
    'aplicou_importacao_ponto',
    'ponto_importacoes',
    jsonb_build_object(
      'importacao_id', p_importacao_id,
      'linhas_aplicadas', v_aplicadas,
      'linhas_inconsistentes', v_linhas_inconsistentes,
      'linhas_duplicadas', v_duplicadas,
      'grupos_duplicados_conflitantes', v_grupos_conflitantes
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'status', 'aplicada',
    'linhas_aplicadas', v_aplicadas,
    'linhas_inconsistentes', v_linhas_inconsistentes,
    'linhas_duplicadas', v_duplicadas,
    'grupos_duplicados_conflitantes', v_grupos_conflitantes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_ignorar_importacao_ponto(p_token text, p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_status text;
  v_status_final text;
  v_atualizadas integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  SELECT i.status INTO v_status
  FROM public.ponto_importacoes i
  WHERE i.id = p_importacao_id
    AND i.empresa_id = v_usuario.empresa_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Importação não encontrada');
  END IF;
  IF v_status = 'ignorada' THEN
    RETURN jsonb_build_object('sucesso', true, 'status', v_status, 'arquivada', true);
  END IF;
  IF v_status NOT IN ('pendente', 'aplicada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estado da importação não permite arquivamento');
  END IF;

  UPDATE public.ponto_importacoes
  SET status = CASE WHEN v_status = 'pendente' THEN 'ignorada' ELSE status END,
      archived_at = coalesce(archived_at, now())
  WHERE id = p_importacao_id
    AND empresa_id = v_usuario.empresa_id
    AND status = v_status;
  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;
  IF v_atualizadas <> 1 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A importação mudou de estado; atualize o histórico e tente novamente');
  END IF;
  v_status_final := CASE WHEN v_status = 'pendente' THEN 'ignorada' ELSE 'aplicada' END;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (
    v_usuario.usuario_id,
    CASE WHEN v_status = 'pendente' THEN 'ignorou_importacao_ponto' ELSE 'arquivou_importacao_ponto' END,
    'ponto_importacoes',
    jsonb_build_object('importacao_id', p_importacao_id, 'status', v_status_final)
  );
  RETURN jsonb_build_object('sucesso', true, 'status', v_status_final, 'arquivada', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_listar_ponto(
  p_token text,
  p_limite integer DEFAULT 180,
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL,
  p_funcionario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_result jsonb;
  v_global boolean;
  v_funcionario_id uuid;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;

  v_global := v_usuario.perfil IN ('admin', 'administrador', 'gestor');
  IF NOT v_global AND p_funcionario_id IS NOT NULL AND p_funcionario_id <> v_usuario.funcionario_id THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao seu próprio ponto');
  END IF;
  v_funcionario_id := CASE WHEN v_global THEN p_funcionario_id ELSE v_usuario.funcionario_id END;
  IF NOT v_global AND v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não vinculado à sessão');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.data DESC, x.nome), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      r.id, r.funcionario_id, r.data, r.entrada, r.saida_almoco, r.volta_almoco, r.saida,
      r.horas_trabalhadas, r.status, f.nome, f.cpf, f.cargo,
      imp.previsto, imp.extra_50, imp.extra_100, imp.dia_falta, imp.horas_atraso,
      imp.desconta_dsr, imp.justificativas, imp.inconsistencia,
      CASE
        WHEN nullif(trim(coalesce(imp.dia_falta, '')), '') IS NOT NULL AND lower(trim(imp.dia_falta)) NOT IN ('não','nao','n','0','false') THEN 'falta'
        WHEN public.app_horas_decimal(imp.horas_atraso) > 0 THEN 'atraso'
        WHEN nullif(trim(coalesce(imp.inconsistencia, '')), '') IS NOT NULL THEN 'inconsistencia'
        ELSE NULL
      END AS inconsistencia_tipo,
      coalesce(inc.status, 'pendente') AS inconsistencia_status,
      coalesce(inc.justificativa, j.motivo) AS inconsistencia_justificativa,
      j.id AS justificativa_id,
      j.status AS justificativa_status,
      j.motivo AS justificativa_motivo,
      j.resposta_rh AS justificativa_resposta,
      j.arquivo_url AS justificativa_arquivo_url,
      j.arquivo_nome AS justificativa_arquivo_nome
    FROM public.registros_ponto r
    JOIN public.funcionarios f ON f.id = r.funcionario_id
    LEFT JOIN LATERAL (
      SELECT l.previsto, l.extra_50, l.extra_100, l.dia_falta, l.horas_atraso,
        l.desconta_dsr, l.justificativas, l.inconsistencia
      FROM public.ponto_import_linhas l
      JOIN public.ponto_importacoes i ON i.id = l.importacao_id AND i.empresa_id = l.empresa_id
      WHERE l.funcionario_id = r.funcionario_id
        AND l.data = r.data
        AND l.empresa_id = v_usuario.empresa_id
        AND i.empresa_id = v_usuario.empresa_id
        AND i.status = 'aplicada'
        AND l.inconsistencia IS NULL
        AND l.entrada_1 IS NOT DISTINCT FROM r.entrada
        AND l.saida_1 IS NOT DISTINCT FROM r.saida_almoco
        AND l.entrada_2 IS NOT DISTINCT FROM r.volta_almoco
        AND l.saida_2 IS NOT DISTINCT FROM r.saida
        AND CASE
          WHEN trim(coalesce(l.total_normais, '')) = '' THEN true
          WHEN trim(l.total_normais) ~ '^[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?$' THEN
            make_interval(secs => (
              split_part(trim(l.total_normais), ':', 1)::numeric * 3600
              + split_part(trim(l.total_normais), ':', 2)::numeric * 60
              + coalesce(nullif(split_part(trim(l.total_normais), ':', 3), '')::numeric, 0)
            )::double precision) IS NOT DISTINCT FROM r.horas_trabalhadas
          WHEN trim(l.total_normais) ~ '^[0-9]+([,.][0-9]+)?$' THEN
            make_interval(secs => (replace(trim(l.total_normais), ',', '.')::numeric * 3600)::double precision) IS NOT DISTINCT FROM r.horas_trabalhadas
          ELSE false
        END
        AND (CASE WHEN nullif(trim(coalesce(l.dia_falta, '')), '') IS NOT NULL AND lower(trim(l.dia_falta)) NOT IN ('não','nao','n','0','false') THEN 'falta' ELSE 'normal' END) = r.status
      ORDER BY i.applied_at DESC NULLS LAST, i.created_at DESC, i.id DESC, l.created_at, l.id
      LIMIT 1
    ) imp ON true
    LEFT JOIN LATERAL (
      SELECT p.status, p.justificativa
      FROM public.ponto_inconsistencias p
      WHERE p.funcionario_id = r.funcionario_id
        AND p.data = r.data
        AND p.tipo = 'ponto'
        AND p.empresa_id = v_usuario.empresa_id
      ORDER BY p.updated_at DESC
      LIMIT 1
    ) inc ON true
    LEFT JOIN LATERAL (
      SELECT j.id, j.status, j.motivo, j.resposta_rh, j.arquivo_url, j.arquivo_nome
      FROM public.justificativas_ponto j
      WHERE j.funcionario_id = r.funcionario_id
        AND j.data_registro = r.data
        AND j.empresa_id = v_usuario.empresa_id
      ORDER BY j.created_at DESC
      LIMIT 1
    ) j ON true
    WHERE f.empresa_id = v_usuario.empresa_id
      AND r.empresa_id = v_usuario.empresa_id
      AND r.empresa_id = f.empresa_id
      AND (v_funcionario_id IS NULL OR r.funcionario_id = v_funcionario_id)
      AND (p_inicio IS NULL OR r.data >= p_inicio)
      AND (p_fim IS NULL OR r.data <= p_fim)
    ORDER BY r.data DESC, f.nome
    LIMIT least(greatest(coalesce(p_limite, 180), 1), 1000)
  ) x;

  RETURN jsonb_build_object(
    'sucesso', true,
    'registros', v_result,
    'escopo', CASE WHEN v_global THEN 'equipe' ELSE 'individual' END,
    'perfil', v_usuario.perfil,
    'funcionario_id', v_funcionario_id,
    'inicio', p_inicio,
    'fim', p_fim
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_listar_ponto(text, integer, date, date, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_listar_ponto_importado(
  p_token text,
  p_tipo text DEFAULT NULL,
  p_importacao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.data DESC, x.nome_csv), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT l.id, l.cpf, l.nome_csv, l.data, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
      l.total_normais, l.extra_50, l.extra_100, l.dia_falta, l.horas_atraso,
      l.justificativas, l.encontrado, l.inconsistencia, i.tipo, i.competencia, i.status
    FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i ON i.id = l.importacao_id AND l.empresa_id = i.empresa_id
    LEFT JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = i.empresa_id
    WHERE i.empresa_id = v_usuario.empresa_id
      AND l.empresa_id = v_usuario.empresa_id
      AND (l.funcionario_id IS NULL OR f.id IS NOT NULL)
      AND (p_tipo IS NULL OR i.tipo = p_tipo)
      AND (p_importacao_id IS NULL OR i.id = p_importacao_id)
    ORDER BY l.data DESC NULLS LAST, l.nome_csv
    LIMIT 1500
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'registros', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_listar_importacoes(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT i.id, i.tipo, i.competencia, i.arquivo_nome, i.imported_by, i.total_linhas,
      i.linhas_encontradas, i.linhas_nao_encontradas, i.cpfs_nao_encontrados,
      (SELECT count(*)::integer FROM public.ponto_import_linhas li
       WHERE li.importacao_id = i.id AND li.empresa_id = i.empresa_id
         AND li.inconsistencia IS NOT NULL) AS linhas_inconsistentes,
      i.status, i.applied_at, i.archived_at, i.created_at,
      coalesce(f.nome, u.nome_exibicao, 'Usuário') AS imported_by_name
    FROM public.ponto_importacoes i
    LEFT JOIN public.usuarios u ON u.id = i.imported_by AND u.empresa_id = i.empresa_id
    LEFT JOIN public.funcionarios f ON f.id = u.funcionario_id AND f.empresa_id = i.empresa_id
    WHERE i.empresa_id = v_usuario.empresa_id
    ORDER BY i.created_at DESC
    LIMIT 50
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'importacoes', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_importar_ponto(text, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_aplicar_importacao_ponto(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_ignorar_importacao_ponto(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_ponto_importado(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_importacoes(text) TO anon, authenticated;


-- Mantém o contrato legado da listagem, mas restringe o resultado ao tenant da sessão.
CREATE OR REPLACE FUNCTION public.app_listar_funcionarios(p_token text)
RETURNS TABLE(
  id uuid, nome text, cpf text, cargo text, data_admissao date, data_demissao date,
  motivo_demissao text, tipo_vinculo text, salario numeric, ativo boolean,
  perfil text, avatar_url text, situacao text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR coalesce(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao,
    f.data_demissao, f.motivo_demissao, f.tipo_vinculo::text, f.salario,
    f.ativo, coalesce(u.perfil, 'funcionario')::text, f.avatar_url::text,
    CASE
      WHEN NOT f.ativo THEN 'Inativo'
      WHEN EXISTS (
        SELECT 1 FROM public.rh_afastamentos a
        WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id
          AND a.status = 'ativo' AND a.inicio <= current_date
          AND (a.fim IS NULL OR a.fim >= current_date)
      ) THEN 'Afastado'
      WHEN EXISTS (
        SELECT 1 FROM public.rh_ferias fer
        WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id
          AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date
          AND (fer.fim IS NULL OR fer.fim >= current_date)
      ) THEN 'Em férias'
      ELSE 'Trabalhando'
    END::text
  FROM public.funcionarios f
  LEFT JOIN public.usuarios u ON u.funcionario_id = f.id AND u.empresa_id = v.empresa_id
  WHERE f.empresa_id = v.empresa_id
  ORDER BY f.ativo DESC, f.nome
  LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.app_listar_funcionarios(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_funcionarios(text) TO anon, authenticated, service_role;

-- Contrato aditivo para telas que precisam distinguir salário e valor diário.
CREATE OR REPLACE FUNCTION public.app_listar_funcionarios_v2(p_token text)
RETURNS TABLE(
  id uuid, nome text, cpf text, cargo text, data_admissao date, data_demissao date,
  motivo_demissao text, tipo_vinculo text, salario numeric, valor_mensal numeric,
  valor_diaria numeric, salario_periodo text, ativo boolean, perfil text,
  avatar_url text, situacao text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR coalesce(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao,
    f.data_demissao, f.motivo_demissao, f.tipo_vinculo::text, f.salario,
    f.valor_mensal, f.valor_diaria, f.salario_periodo::text, f.ativo,
    coalesce(u.perfil, 'funcionario')::text, f.avatar_url::text,
    CASE
      WHEN NOT f.ativo THEN 'Inativo'
      WHEN EXISTS (
        SELECT 1 FROM public.rh_afastamentos a
        WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id
          AND a.status = 'ativo' AND a.inicio <= current_date
          AND (a.fim IS NULL OR a.fim >= current_date)
      ) THEN 'Afastado'
      WHEN EXISTS (
        SELECT 1 FROM public.rh_ferias fer
        WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id
          AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date
          AND (fer.fim IS NULL OR fer.fim >= current_date)
      ) THEN 'Em férias'
      ELSE 'Trabalhando'
    END::text
  FROM public.funcionarios f
  LEFT JOIN public.usuarios u ON u.funcionario_id = f.id AND u.empresa_id = v.empresa_id
  WHERE f.empresa_id = v.empresa_id
  ORDER BY f.ativo DESC, f.nome
  LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.app_listar_funcionarios_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_funcionarios_v2(text) TO anon, authenticated, service_role;

-- O prontuário próprio expõe somente a remuneração do funcionário vinculado à sessão.
CREATE OR REPLACE FUNCTION public.app_meu_prontuario(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_funcionario jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.funcionario_id IS NULL
     OR COALESCE(v.perfil, '') <> 'funcionario' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso permitido somente ao prontuário do próprio funcionário.');
  END IF;

  SELECT jsonb_build_object(
    'id', f.id,
    'nome', f.nome,
    'cpf', f.cpf,
    'data_nascimento', f.data_nascimento,
    'tipo_vinculo', f.tipo_vinculo,
    'cargo', f.cargo,
    'funcao', f.funcao,
    'data_admissao', f.data_admissao,
    'salario', f.salario,
    'salario_periodo', f.salario_periodo,
    'valor_mensal', f.valor_mensal,
    'valor_diaria', f.valor_diaria,
    'horario_trabalho', f.horario_trabalho,
    'horario_intervalo', f.horario_intervalo,
    'telefone_celular', f.telefone_celular,
    'endereco', f.endereco,
    'ativo', f.ativo,
    'data_demissao', f.data_demissao,
    'tipo_desligamento', f.tipo_desligamento
  ) INTO v_funcionario
  FROM public.funcionarios f
  WHERE f.id = v.funcionario_id AND f.empresa_id = v.empresa_id
  LIMIT 1;

  IF v_funcionario IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Seu prontuário não está vinculado à sessão. Procure o RH.');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'funcionario', v_funcionario,
    'advertencias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'data_ocorrencia', a.data_ocorrencia, 'tipo', a.tipo, 'descricao', a.descricao, 'medida', a.medida, 'created_at', a.created_at) ORDER BY a.data_ocorrencia DESC, a.created_at DESC) FROM public.funcionario_advertencias a WHERE a.funcionario_id = v.funcionario_id AND a.empresa_id = v.empresa_id), '[]'::jsonb),
    'atestados', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'data_atendimento', a.data_atendimento, 'dias', a.dias, 'status', a.status, 'status_label', a.status_label, 'observacao', a.observacao, 'arquivo_nome', a.arquivo_nome, 'created_at', a.created_at) ORDER BY a.data_atendimento DESC, a.created_at DESC) FROM public.atestados a WHERE a.funcionario_id = v.funcionario_id AND a.empresa_id = v.empresa_id), '[]'::jsonb),
    'justificativas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'data_registro', j.data_registro, 'tipo', j.tipo, 'motivo', j.motivo, 'status', j.status, 'resposta_rh', j.resposta_rh, 'arquivo_nome', j.arquivo_nome, 'created_at', j.created_at) ORDER BY j.data_registro DESC, j.created_at DESC) FROM public.justificativas_ponto j WHERE j.funcionario_id = v.funcionario_id AND j.empresa_id = v.empresa_id), '[]'::jsonb),
    'ferias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'periodo_aquisitivo_inicio', f.periodo_aquisitivo_inicio, 'periodo_aquisitivo_fim', f.periodo_aquisitivo_fim, 'inicio', f.inicio, 'fim', f.fim, 'status', f.status, 'dias_gozo', f.dias_gozo, 'dias_abono', f.dias_abono, 'created_at', f.created_at) ORDER BY f.inicio DESC, f.created_at DESC) FROM public.rh_ferias f WHERE f.funcionario_id = v.funcionario_id AND f.empresa_id = v.empresa_id), '[]'::jsonb),
    'afastamentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'inicio', a.inicio, 'fim', a.fim, 'motivo', a.motivo, 'status', a.status, 'created_at', a.created_at) ORDER BY a.inicio DESC, a.created_at DESC) FROM public.rh_afastamentos a WHERE a.funcionario_id = v.funcionario_id AND a.empresa_id = v.empresa_id), '[]'::jsonb),
    'documentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'categoria', d.categoria, 'titulo', d.titulo, 'arquivo_nome', d.arquivo_nome, 'validade', d.validade, 'created_at', d.created_at) ORDER BY d.created_at DESC) FROM public.funcionario_documentos d WHERE d.funcionario_id = v.funcionario_id AND d.empresa_id = v.empresa_id), '[]'::jsonb)
  );
END;
$$;

-- Busca tenant-safe existente com remuneração detalhada; diária é filtrada separadamente do salário mensal.
CREATE OR REPLACE FUNCTION public.app_admin_buscar_funcionarios(
  p_token text,
  p_busca text DEFAULT NULL,
  p_situacao text DEFAULT NULL,
  p_tipo_vinculo text DEFAULT NULL,
  p_cargo text DEFAULT NULL,
  p_salario_min numeric DEFAULT NULL,
  p_salario_max numeric DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limite integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_total integer := 0;
  v_registros jsonb := '[]'::jsonb;
  v_busca text := lower(btrim(coalesce(p_busca, '')));
  v_cpf text := regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g');
  v_situacao text := nullif(btrim(coalesce(p_situacao, '')), '');
  v_tipo text := nullif(btrim(coalesce(p_tipo_vinculo, '')), '');
  v_cargo text := lower(btrim(coalesce(p_cargo, '')));
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado', 'registros', '[]'::jsonb, 'total', 0, 'offset', v_offset, 'limite', v_limite);
  END IF;

  WITH base AS (
    SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao, f.data_demissao,
      f.motivo_demissao, f.tipo_vinculo::text, f.salario, f.valor_mensal, f.valor_diaria, f.salario_periodo::text, f.ativo,
      COALESCE(u.perfil, 'funcionario')::text AS perfil, f.avatar_url::text,
      CASE
        WHEN NOT f.ativo THEN 'Inativo'
        WHEN EXISTS (
          SELECT 1 FROM public.rh_afastamentos a
          WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id
            AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)
        ) THEN 'Afastado'
        WHEN EXISTS (
          SELECT 1 FROM public.rh_ferias fer
          WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id
            AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)
        ) THEN 'Em férias'
        ELSE 'Trabalhando'
      END::text AS situacao
    FROM public.funcionarios f
    LEFT JOIN public.usuarios u ON u.funcionario_id = f.id AND u.empresa_id = v.empresa_id
    WHERE f.empresa_id = v.empresa_id
      AND (v_busca = '' OR lower(f.nome) LIKE '%' || v_busca || '%'
        OR lower(coalesce(f.cargo, '')) LIKE '%' || v_busca || '%'
        OR (v_cpf <> '' AND regexp_replace(f.cpf, '[^0-9]', '', 'g') LIKE '%' || v_cpf || '%'))
      AND (v_situacao IS NULL OR (
        CASE
          WHEN NOT f.ativo THEN 'Inativo'
          WHEN EXISTS (SELECT 1 FROM public.rh_afastamentos a WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'Afastado'
          WHEN EXISTS (SELECT 1 FROM public.rh_ferias fer WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)) THEN 'Em férias'
          ELSE 'Trabalhando'
        END
      ) = v_situacao)
      AND (v_tipo IS NULL OR f.tipo_vinculo = v_tipo)
      AND (v_cargo = '' OR lower(coalesce(f.cargo, '')) LIKE '%' || v_cargo || '%')
      AND (p_salario_min IS NULL OR (CASE WHEN f.tipo_vinculo = 'diarista' THEN coalesce(f.valor_diaria, 0) ELSE coalesce(f.valor_mensal, f.salario, 0) END) >= p_salario_min)
      AND (p_salario_max IS NULL OR (CASE WHEN f.tipo_vinculo = 'diarista' THEN coalesce(f.valor_diaria, 0) ELSE coalesce(f.valor_mensal, f.salario, 0) END) <= p_salario_max)
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao, f.data_demissao,
      f.motivo_demissao, f.tipo_vinculo::text, f.salario, f.valor_mensal, f.valor_diaria, f.salario_periodo::text, f.ativo,
      COALESCE(u.perfil, 'funcionario')::text AS perfil, f.avatar_url::text,
      CASE
        WHEN NOT f.ativo THEN 'Inativo'
        WHEN EXISTS (SELECT 1 FROM public.rh_afastamentos a WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'Afastado'
        WHEN EXISTS (SELECT 1 FROM public.rh_ferias fer WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)) THEN 'Em férias'
        ELSE 'Trabalhando'
      END::text AS situacao
    FROM public.funcionarios f
    LEFT JOIN public.usuarios u ON u.funcionario_id = f.id AND u.empresa_id = v.empresa_id
    WHERE f.empresa_id = v.empresa_id
      AND (v_busca = '' OR lower(f.nome) LIKE '%' || v_busca || '%'
        OR lower(coalesce(f.cargo, '')) LIKE '%' || v_busca || '%'
        OR (v_cpf <> '' AND regexp_replace(f.cpf, '[^0-9]', '', 'g') LIKE '%' || v_cpf || '%'))
      AND (v_situacao IS NULL OR (
        CASE
          WHEN NOT f.ativo THEN 'Inativo'
          WHEN EXISTS (SELECT 1 FROM public.rh_afastamentos a WHERE a.funcionario_id = f.id AND a.empresa_id = v.empresa_id AND a.status = 'ativo' AND a.inicio <= current_date AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'Afastado'
          WHEN EXISTS (SELECT 1 FROM public.rh_ferias fer WHERE fer.funcionario_id = f.id AND fer.empresa_id = v.empresa_id AND fer.status IN ('agendada', 'em_gozo') AND fer.inicio <= current_date AND (fer.fim IS NULL OR fer.fim >= current_date)) THEN 'Em férias'
          ELSE 'Trabalhando'
        END
      ) = v_situacao)
      AND (v_tipo IS NULL OR f.tipo_vinculo = v_tipo)
      AND (v_cargo = '' OR lower(coalesce(f.cargo, '')) LIKE '%' || v_cargo || '%')
      AND (p_salario_min IS NULL OR (CASE WHEN f.tipo_vinculo = 'diarista' THEN coalesce(f.valor_diaria, 0) ELSE coalesce(f.valor_mensal, f.salario, 0) END) >= p_salario_min)
      AND (p_salario_max IS NULL OR (CASE WHEN f.tipo_vinculo = 'diarista' THEN coalesce(f.valor_diaria, 0) ELSE coalesce(f.valor_mensal, f.salario, 0) END) <= p_salario_max)
    ORDER BY f.ativo DESC, f.nome ASC
    OFFSET v_offset LIMIT v_limite
  )
  SELECT coalesce(jsonb_agg(to_jsonb(base) ORDER BY base.ativo DESC, base.nome ASC), '[]'::jsonb)
  INTO v_registros FROM base;

  RETURN jsonb_build_object('sucesso', true, 'registros', v_registros, 'total', v_total, 'offset', v_offset, 'limite', v_limite);
END;
$$;


-- Parser compartilhado pelo fechamento de folha: HH:MM estrito, segundos opcionais e decimal explícito.
CREATE OR REPLACE FUNCTION public.app_horas_decimal(p_valor text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v text := trim(coalesce(p_valor, ''));
  v_h numeric;
  v_m numeric;
  v_s numeric;
BEGIN
  IF v = '' THEN RETURN 0; END IF;
  IF v ~ '^[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?$' THEN
    v_h := split_part(v, ':', 1)::numeric;
    v_m := split_part(v, ':', 2)::numeric;
    v_s := coalesce(nullif(split_part(v, ':', 3), '')::numeric, 0);
    RETURN v_h + v_m / 60 + v_s / 3600;
  END IF;
  IF v ~ '^[0-9]+([,.][0-9]+)?$' THEN
    RETURN replace(v, ',', '.')::numeric;
  END IF;
  RETURN 0;
END;
$function$;


-- Mantém formatos legados inválidos visíveis para revisão; não reescreve registros de ponto históricos.
UPDATE public.ponto_import_linhas l
SET inconsistencia = coalesce(nullif(l.inconsistencia, ''), CASE
  WHEN nullif(trim(coalesce(l.raw_data->>'entrada_1', '')), '') IS NOT NULL AND trim(l.raw_data->>'entrada_1') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'entrada_1') THEN 'Horário de entrada 1 de origem inválido; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.raw_data->>'saida_1', '')), '') IS NOT NULL AND trim(l.raw_data->>'saida_1') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'saida_1') THEN 'Horário de saída 1 de origem inválido; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.raw_data->>'entrada_2', '')), '') IS NOT NULL AND trim(l.raw_data->>'entrada_2') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'entrada_2') THEN 'Horário de entrada 2 de origem inválido; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.raw_data->>'saida_2', '')), '') IS NOT NULL AND trim(l.raw_data->>'saida_2') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'saida_2') THEN 'Horário de saída 2 de origem inválido; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.total_normais, '')), '') IS NOT NULL AND trim(l.total_normais) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$' THEN 'Duração de horas normais inválida; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.total_noturno, '')), '') IS NOT NULL AND trim(l.total_noturno) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$' THEN 'Duração de horas noturnas inválida; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.horas_atraso, '')), '') IS NOT NULL AND trim(l.horas_atraso) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$' THEN 'Duração de atraso inválida; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.extra_50, '')), '') IS NOT NULL AND trim(l.extra_50) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$' THEN 'Duração de extra 50% inválida; revisar antes de usar.'
  WHEN nullif(trim(coalesce(l.extra_100, '')), '') IS NOT NULL AND trim(l.extra_100) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$' THEN 'Duração de extra 100% inválida; revisar antes de usar.'
  ELSE l.inconsistencia
END)
FROM public.ponto_importacoes i
WHERE i.id = l.importacao_id
  AND i.empresa_id = l.empresa_id
  AND (
    (nullif(trim(coalesce(l.raw_data->>'entrada_1', '')), '') IS NOT NULL AND trim(l.raw_data->>'entrada_1') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'entrada_1'))
    OR (nullif(trim(coalesce(l.raw_data->>'saida_1', '')), '') IS NOT NULL AND trim(l.raw_data->>'saida_1') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'saida_1'))
    OR (nullif(trim(coalesce(l.raw_data->>'entrada_2', '')), '') IS NOT NULL AND trim(l.raw_data->>'entrada_2') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'entrada_2'))
    OR (nullif(trim(coalesce(l.raw_data->>'saida_2', '')), '') IS NOT NULL AND trim(l.raw_data->>'saida_2') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' AND NOT public.app_ponto_horario_placeholder(l.raw_data->>'saida_2'))
    OR (nullif(trim(coalesce(l.total_normais, '')), '') IS NOT NULL AND trim(l.total_normais) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$')
    OR (nullif(trim(coalesce(l.total_noturno, '')), '') IS NOT NULL AND trim(l.total_noturno) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$')
    OR (nullif(trim(coalesce(l.horas_atraso, '')), '') IS NOT NULL AND trim(l.horas_atraso) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$')
    OR (nullif(trim(coalesce(l.extra_50, '')), '') IS NOT NULL AND trim(l.extra_50) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$')
    OR (nullif(trim(coalesce(l.extra_100, '')), '') IS NOT NULL AND trim(l.extra_100) !~ '^([0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?|[0-9]+([,.][0-9]+)?)$')
  );


-- Fingerprint privado da origem da prévia: a confirmação exige exatamente o mesmo snapshot.
CREATE OR REPLACE FUNCTION public.app_fechamento_source_fingerprint(
  p_empresa_id uuid,
  p_competencia text,
  p_incluir_informais_vale boolean
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
WITH faixa AS (
  SELECT to_date(p_competencia || '-01', 'YYYY-MM-DD')::date AS inicio,
         (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date AS fim
), snapshot AS (
  SELECT jsonb_build_object(
    'version', 'payroll-close-v2',
    'empresa_id', p_empresa_id,
    'competencia', p_competencia,
    'incluir_informais_vale', coalesce(p_incluir_informais_vale, false),
    'configuracao', coalesce((
      SELECT jsonb_build_object('regras', c.regras, 'vale_valor', c.vale_valor)
      FROM public.configuracoes_empresa c
      WHERE c.empresa_id = p_empresa_id
    ), '{}'::jsonb),
    'funcionarios', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'cpf', f.cpf, 'ativo', f.ativo,
        'salario', f.salario, 'registrado', f.registrado,
        'elegivel_vale', f.elegivel_vale, 'tipo_vinculo', f.tipo_vinculo,
        'valor_mensal', f.valor_mensal, 'valor_diaria', f.valor_diaria,
        'salario_periodo', f.salario_periodo
      ) ORDER BY f.id)
      FROM public.funcionarios f
      WHERE f.empresa_id = p_empresa_id
    ), '[]'::jsonb),
    'pontos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'linha_id', q.linha_id, 'importacao_id', q.importacao_id,
        'import_created_at', q.import_created_at, 'applied_at', q.applied_at,
        'funcionario_id', q.funcionario_id, 'data', q.data,
        'previsto', q.previsto, 'justificativas', q.justificativas,
        'dia_falta', q.dia_falta, 'horas_atraso', q.horas_atraso,
        'extra_50', q.extra_50, 'extra_100', q.extra_100,
        'desconta_dsr', q.desconta_dsr,
        'entrada_1', q.entrada_1, 'saida_1', q.saida_1,
        'entrada_2', q.entrada_2, 'saida_2', q.saida_2,
        'total_normais', q.total_normais, 'abono', q.abono
      ) ORDER BY q.funcionario_id, q.data)
      FROM (
        SELECT DISTINCT ON (l.funcionario_id, l.data)
          l.id AS linha_id, i.id AS importacao_id, i.created_at AS import_created_at,
          i.applied_at, l.funcionario_id, l.data, l.previsto, l.justificativas,
          l.dia_falta, l.horas_atraso, l.extra_50, l.extra_100,
          l.desconta_dsr, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
          l.total_normais, l.abono
        FROM public.ponto_import_linhas l
        JOIN public.ponto_importacoes i
          ON i.id = l.importacao_id AND i.empresa_id = l.empresa_id
        JOIN public.funcionarios f
          ON f.id = l.funcionario_id AND f.empresa_id = p_empresa_id
        CROSS JOIN faixa d
        WHERE l.empresa_id = p_empresa_id
          AND i.empresa_id = p_empresa_id
          AND i.status = 'aplicada'
          AND l.encontrado = true
          AND nullif(trim(coalesce(l.inconsistencia, '')), '') IS NULL
          AND l.funcionario_id IS NOT NULL
          AND l.data IS NOT NULL
          AND l.data BETWEEN d.inicio AND d.fim
          AND f.ativo = true
        ORDER BY l.funcionario_id, l.data,
          i.applied_at DESC NULLS LAST, i.created_at DESC, l.created_at DESC, l.id DESC
      ) q
    ), '[]'::jsonb),
    'atestados', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'funcionario_id', a.funcionario_id,
        'data_atendimento', a.data_atendimento, 'dias', a.dias, 'status', a.status
      ) ORDER BY a.id)
      FROM public.atestados a
      JOIN public.funcionarios f ON f.id = a.funcionario_id AND f.empresa_id = p_empresa_id
      CROSS JOIN faixa d
      WHERE a.data_atendimento <= d.fim
        AND a.data_atendimento + greatest(coalesce(a.dias, 1), 1) > d.inicio
    ), '[]'::jsonb),
    'afastamentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', af.id, 'funcionario_id', af.funcionario_id,
        'inicio', af.inicio, 'fim', af.fim, 'status', af.status
      ) ORDER BY af.id)
      FROM public.rh_afastamentos af
      JOIN public.funcionarios f ON f.id = af.funcionario_id AND f.empresa_id = p_empresa_id
      CROSS JOIN faixa d
      WHERE af.inicio <= d.fim AND (af.fim IS NULL OR af.fim >= d.inicio)
    ), '[]'::jsonb),
    'inconsistencias_ponto', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pi.id, 'funcionario_id', pi.funcionario_id,
        'data', pi.data, 'tipo', pi.tipo, 'status', pi.status
      ) ORDER BY pi.funcionario_id, pi.data, pi.id)
      FROM public.ponto_inconsistencias pi
      JOIN public.funcionarios f ON f.id = pi.funcionario_id AND f.empresa_id = p_empresa_id
      CROSS JOIN faixa d
      WHERE pi.tipo = 'ponto' AND pi.data BETWEEN d.inicio AND d.fim
    ), '[]'::jsonb),
    'solicitacoes_justificativa', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', jp.id, 'funcionario_id', jp.funcionario_id,
        'data_registro', jp.data_registro, 'tipo', jp.tipo, 'status', jp.status
      ) ORDER BY jp.funcionario_id, jp.data_registro, jp.id)
      FROM public.justificativas_ponto jp
      JOIN public.funcionarios f ON f.id = jp.funcionario_id AND f.empresa_id = p_empresa_id
      CROSS JOIN faixa d
      WHERE jp.data_registro BETWEEN d.inicio AND d.fim
    ), '[]'::jsonb)
  ) AS payload
)
SELECT encode(extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex')
FROM snapshot;
$function$;
REVOKE ALL ON FUNCTION public.app_fechamento_source_fingerprint(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- Fechamento fail-closed: nenhuma linha inválida/não encontrada de outro tenant pode afetar a folha.
create or replace function public.app_admin_calcular_fechamento(p_token text,p_competencia text,p_incluir_informais_vale boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid; v_status text; v_inicio date; v_fim date; v_divisor numeric:=220; v_resumo jsonb; v_incluir boolean; v_source_fingerprint text;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or v.perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if p_competencia is null or p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia, 4) = '0000' then return jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12'); end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll-close:' || v.empresa_id::text, 0));
  v_inicio:=to_date(p_competencia||'-01','YYYY-MM-DD'); v_fim:=(v_inicio+interval '1 month-1 day')::date;
  select coalesce(nullif((regras->>'divisor_horas')::numeric,0),220) into v_divisor from public.configuracoes_empresa where empresa_id=v.empresa_id;
  v_incluir := coalesce(p_incluir_informais_vale, false);
  SELECT status INTO v_status FROM public.fechamentos_mensais
  WHERE empresa_id = v.empresa_id AND competencia = p_competencia
  FOR UPDATE;
  IF v_status = 'fechado' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência já fechada; recálculo exige fluxo formal de reabertura.');
  END IF;
  v_source_fingerprint := public.app_fechamento_source_fingerprint(v.empresa_id, p_competencia, v_incluir);
  insert into public.fechamentos_mensais(empresa_id,competencia,incluir_informais_vale,status,criado_por,confirmado_por,confirmado_at,regra_snapshot,observacoes,source_fingerprint)
  values(v.empresa_id,p_competencia,v_incluir,'calculado',v.usuario_id,null,null,jsonb_build_object('versao_regra','v4','divisor_horas',v_divisor,'adicional_50',1.5,'adicional_100',2.0,'base_dsr','salario/30 por ocorrência marcada e falta injustificada','abono','cada flag positiva abate uma falta injustificada do mês; não é duração'),'Prévia calculada; aguarda confirmação explícita do gestor.',v_source_fingerprint)
  on conflict(empresa_id,competencia) do update set incluir_informais_vale=excluded.incluir_informais_vale,status='calculado',confirmado_por=null,confirmado_at=null,regra_snapshot=excluded.regra_snapshot,observacoes=excluded.observacoes,source_fingerprint=excluded.source_fingerprint,criado_por=excluded.criado_por
  returning id into v_id;
  delete from public.fechamento_funcionarios where fechamento_id=v_id;
  with ultima as (
    select distinct on(l.funcionario_id,l.data) l.* from public.ponto_import_linhas l join public.ponto_importacoes i on i.id=l.importacao_id and i.empresa_id=l.empresa_id where i.empresa_id=v.empresa_id and l.empresa_id=v.empresa_id and i.status='aplicada' and l.encontrado=true and nullif(trim(coalesce(l.inconsistencia,'')),'') is null and l.funcionario_id is not null and l.data is not null and l.data between v_inicio and v_fim order by l.funcionario_id,l.data,i.applied_at desc nulls last,i.created_at desc,l.created_at desc,l.id desc
  ), classificados as (
    select f.id as funcionario_id,f.salario,u.data,u.previsto,u.justificativas,u.dia_falta,u.abono,u.horas_atraso,u.extra_50,u.extra_100,u.desconta_dsr,
      (coalesce(u.entrada_1::text,'')<>'' or coalesce(u.saida_1::text,'')<>'' or coalesce(u.entrada_2::text,'')<>'' or coalesce(u.saida_2::text,'')<>'' or nullif(trim(coalesce(u.total_normais,'')),'') is not null) as tem_marcacao,
      lower(coalesce(u.previsto,'')||' '||coalesce(u.justificativas,'')) like '%ferias%' or lower(coalesce(u.previsto,'')||' '||coalesce(u.justificativas,'')) like '%férias%' as ferias,
      (exists(select 1 from public.atestados a where a.funcionario_id=f.id and a.status='aceito' and u.data>=a.data_atendimento and u.data<a.data_atendimento+greatest(coalesce(a.dias,1),1)) or exists(select 1 from public.rh_afastamentos af where af.funcionario_id=f.id and af.status='ativo' and u.data>=af.inicio and (af.fim is null or u.data<=af.fim))) as afastamento,
      exists(select 1 from public.ponto_inconsistencias pi where pi.funcionario_id=f.id and pi.data=u.data and pi.tipo='ponto' and pi.status='justificada') as justificativa_aprovada
    from public.funcionarios f join ultima u on u.funcionario_id=f.id where f.empresa_id=v.empresa_id and f.ativo=true
  ), marcados as (
    select c.*,
      ((nullif(trim(coalesce(c.dia_falta,'')),'') is not null and lower(trim(c.dia_falta)) not in('não','nao','n','0','false')) or (nullif(trim(coalesce(c.previsto,'')),'') is not null and not c.tem_marcacao and not c.ferias and not c.afastamento)) as falta_apontada,
      (nullif(trim(coalesce(c.abono,'')),'') is not null and lower(trim(c.abono)) not in('não','nao','n','0','false')) as abono_marcado,
      (nullif(trim(coalesce(c.desconta_dsr,'')),'') is not null and lower(trim(c.desconta_dsr)) in('sim','s','true','1')) as dsr_marcado
    from classificados c
  ), finais as (
    select m.*,(m.falta_apontada and (m.justificativa_aprovada or nullif(trim(coalesce(m.justificativas,'')),'') is not null or m.ferias or m.afastamento)) as falta_justificada
    from marcados m
  ), agregado as (
    select f.id as funcionario_id,f.salario,f.elegivel_vale,f.registrado,
      count(*) filter(where x.tem_marcacao)::numeric as dias_trabalhados,
      count(*) filter(where x.falta_apontada)::integer as faltas,
      count(*) filter(where x.falta_apontada and not x.falta_justificada)::integer as injustificadas_base,
      count(*) filter(where x.falta_apontada and x.falta_justificada)::integer as justificadas_base,
      count(*) filter(where x.abono_marcado)::integer as abonos_marcados,
      coalesce(sum(public.app_horas_decimal(x.horas_atraso)*60),0)::integer as atrasos_minutos,
      coalesce(sum(public.app_horas_decimal(x.extra_50)),0) as horas_extras_50,
      coalesce(sum(public.app_horas_decimal(x.extra_100)),0) as horas_extras_100,
      count(*) filter(where x.dsr_marcado)::numeric as dsr_horas,
      count(*) filter(where not x.tem_marcacao and not x.falta_apontada and not x.ferias and not x.afastamento)::integer as dias_folga,
      count(*) filter(where x.ferias)::integer as dias_ferias,
      count(*) filter(where x.afastamento)::integer as dias_afastamento
    from public.funcionarios f
    left join finais x on x.funcionario_id=f.id
    where f.empresa_id=v.empresa_id and f.ativo=true
    group by f.id,f.salario,f.elegivel_vale,f.registrado
  )
  insert into public.fechamento_funcionarios(fechamento_id,funcionario_id,dias_trabalhados,faltas,faltas_injustificadas,faltas_justificadas,atrasos_minutos,horas_extras_50,horas_extras_100,dsr_horas,dsr_desconto,hora_base,horas_extras_50_valor,horas_extras_100_valor,dias_folga,dias_ferias,dias_afastamento,vale_elegivel,vale_valor,ocorrencias,observacoes)
  select v_id,a.funcionario_id,a.dias_trabalhados,a.faltas,
    greatest(a.injustificadas_base-a.abonos_marcados,0),
    a.faltas-greatest(a.injustificadas_base-a.abonos_marcados,0),
    a.atrasos_minutos,a.horas_extras_50,a.horas_extras_100,
    case when greatest(a.injustificadas_base-a.abonos_marcados,0)>0 then a.dsr_horas else 0 end,
    case when coalesce(a.salario,0)>0 and greatest(a.injustificadas_base-a.abonos_marcados,0)>0 then round((a.salario/30)*a.dsr_horas,2) else 0 end,
    case when coalesce(a.salario,0)>0 then round(a.salario/v_divisor,4) else 0 end,
    case when coalesce(a.salario,0)>0 then round(a.horas_extras_50*(a.salario/v_divisor)*1.5,2) else 0 end,
    case when coalesce(a.salario,0)>0 then round(a.horas_extras_100*(a.salario/v_divisor)*2,2) else 0 end,
    a.dias_folga,a.dias_ferias,a.dias_afastamento,
    (a.elegivel_vale and (v_incluir or a.registrado) and greatest(a.injustificadas_base-a.abonos_marcados,0)=0),
    case when a.elegivel_vale and (v_incluir or a.registrado) and greatest(a.injustificadas_base-a.abonos_marcados,0)=0
      then coalesce((select vale_valor from public.configuracoes_empresa where empresa_id=v.empresa_id),300) else 0 end,
    jsonb_build_object('regra','v4','divisor_horas',v_divisor,
      'abonos_marcados',a.abonos_marcados,'abonos_aplicados',least(a.abonos_marcados,a.injustificadas_base),
      'faltas_injustificadas_base',a.injustificadas_base,
      'dias_com_marcacao',a.dias_trabalhados,'dias_folga',a.dias_folga,
      'dias_ferias',a.dias_ferias,'dias_afastamento',a.dias_afastamento,
      'faltas_justificadas',a.faltas-greatest(a.injustificadas_base-a.abonos_marcados,0),
      'faltas_injustificadas',greatest(a.injustificadas_base-a.abonos_marcados,0)),
    case when greatest(a.injustificadas_base-a.abonos_marcados,0)>0
      then 'Há faltas injustificadas; revisar antes de confirmar.' else null end
  from agregado a;
  select jsonb_build_object('funcionarios',count(*),'faltas_injustificadas',coalesce(sum(faltas_injustificadas),0),'faltas_justificadas',coalesce(sum(faltas_justificadas),0),'horas_extras_50',coalesce(sum(horas_extras_50),0),'horas_extras_100',coalesce(sum(horas_extras_100),0),'extras_50_valor',coalesce(sum(horas_extras_50_valor),0),'extras_100_valor',coalesce(sum(horas_extras_100_valor),0),'dsr_desconto',coalesce(sum(dsr_desconto),0)) into v_resumo from public.fechamento_funcionarios where fechamento_id=v_id;
  update public.fechamentos_mensais set observacoes='Prévia calculada; aguarda confirmação explícita do gestor. Resumo: '||v_resumo::text where id=v_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v.usuario_id,'calculou_previa_fechamento','fechamentos_mensais',jsonb_build_object('fechamento_id',v_id,'competencia',p_competencia,'regras',jsonb_build_object('divisor_horas',v_divisor,'afastamentos_rh',true),'source_fingerprint',v_source_fingerprint,'resumo',v_resumo));
  return jsonb_build_object('sucesso',true,'fechamento_id',v_id,'competencia',p_competencia,'status','calculado','source_fingerprint',v_source_fingerprint,'resumo',v_resumo,'mensagem','Prévia calculada. Revise e confirme a mesma versão da prévia.');
end; $$;


-- A prévia retorna o token que deve acompanhar a confirmação explícita.
CREATE OR REPLACE FUNCTION public.app_admin_visualizar_fechamento(p_token text, p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_fechamento record;
  v_resumo jsonb;
  v_linhas jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia, 4) = '0000' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  SELECT * INTO v_fechamento
  FROM public.fechamentos_mensais
  WHERE empresa_id = v_usuario.empresa_id AND competencia = p_competencia
  LIMIT 1;
  IF v_fechamento.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Prévia não encontrada; calcule antes de consultar');
  END IF;
  SELECT jsonb_build_object(
    'funcionarios', count(*),
    'faltas_injustificadas', coalesce(sum(faltas_injustificadas), 0),
    'faltas_justificadas', coalesce(sum(faltas_justificadas), 0),
    'horas_extras_50', coalesce(sum(horas_extras_50), 0),
    'horas_extras_100', coalesce(sum(horas_extras_100), 0),
    'extras_50_valor', coalesce(sum(horas_extras_50_valor), 0),
    'extras_100_valor', coalesce(sum(horas_extras_100_valor), 0),
    'dsr_desconto', coalesce(sum(dsr_desconto), 0)
  ) INTO v_resumo
  FROM public.fechamento_funcionarios
  WHERE fechamento_id = v_fechamento.id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT f.nome, f.cpf, f.salario, ff.dias_trabalhados, ff.dias_folga,
      ff.dias_ferias, ff.dias_afastamento, ff.faltas, ff.faltas_justificadas,
      ff.faltas_injustificadas, ff.atrasos_minutos, ff.horas_extras_50,
      ff.horas_extras_50_valor, ff.horas_extras_100, ff.horas_extras_100_valor,
      ff.dsr_horas, ff.dsr_desconto, ff.observacoes
    FROM public.fechamento_funcionarios ff
    JOIN public.funcionarios f ON f.id = ff.funcionario_id AND f.empresa_id = v_usuario.empresa_id
    WHERE ff.fechamento_id = v_fechamento.id
    LIMIT 1000
  ) x;
  RETURN jsonb_build_object(
    'sucesso', true, 'fechamento_id', v_fechamento.id,
    'competencia', p_competencia, 'status', v_fechamento.status,
    'confirmado_at', v_fechamento.confirmado_at,
    'source_fingerprint', v_fechamento.source_fingerprint,
    'resumo', v_resumo, 'linhas', v_linhas, 'regras', v_fechamento.regra_snapshot
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_visualizar_fechamento(text, text) TO anon, authenticated;

-- Confirma somente se a tela apresenta a mesma versão e todas as fontes ainda coincidem.
CREATE OR REPLACE FUNCTION public.app_admin_confirmar_fechamento(
  p_token text,
  p_competencia text,
  p_confirmacao text,
  p_source_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_fechamento record;
  v_current_fingerprint text;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(p_competencia, 4) = '0000' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  IF upper(trim(coalesce(p_confirmacao, ''))) <> 'CONFIRMAR' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Digite CONFIRMAR para fechar a competência');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:' || v_usuario.empresa_id::text, 0));
  IF p_source_fingerprint IS NULL OR p_source_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Versão da prévia ausente ou inválida; recalcule e revise antes de confirmar');
  END IF;
  SELECT * INTO v_fechamento
  FROM public.fechamentos_mensais
  WHERE empresa_id = v_usuario.empresa_id AND competencia = p_competencia
  FOR UPDATE;
  IF v_fechamento.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Prévia não encontrada; calcule antes de confirmar');
  END IF;
  IF v_fechamento.source_fingerprint IS NULL
     OR v_fechamento.source_fingerprint IS DISTINCT FROM p_source_fingerprint THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A prévia exibida foi substituída. Recalcule e revise novamente antes de confirmar.');
  END IF;
  IF v_fechamento.status = 'fechado' THEN
    RETURN jsonb_build_object('sucesso', true, 'status', 'fechado', 'mensagem', 'Competência já estava fechada',
      'source_fingerprint', v_fechamento.source_fingerprint);
  END IF;
  v_current_fingerprint := public.app_fechamento_source_fingerprint(
    v_usuario.empresa_id, p_competencia, v_fechamento.incluir_informais_vale
  );
  IF v_current_fingerprint IS DISTINCT FROM v_fechamento.source_fingerprint THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Os dados de ponto, cadastro ou afastamento mudaram desde a prévia. Recalcule e revise antes de confirmar.');
  END IF;
  UPDATE public.fechamentos_mensais
  SET status = 'fechado', confirmado_por = v_usuario.usuario_id,
      confirmado_at = now(),
      observacoes = coalesce(observacoes, '') || ' Fechamento confirmado pelo gestor.'
  WHERE id = v_fechamento.id AND empresa_id = v_usuario.empresa_id;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (v_usuario.usuario_id, 'confirmou_fechamento_folha', 'fechamentos_mensais',
    jsonb_build_object('fechamento_id', v_fechamento.id, 'competencia', p_competencia,
      'source_fingerprint', v_fechamento.source_fingerprint,
      'status_anterior', v_fechamento.status, 'status_novo', 'fechado'));
  RETURN jsonb_build_object('sucesso', true, 'status', 'fechado',
    'fechamento_id', v_fechamento.id, 'competencia', p_competencia,
    'source_fingerprint', v_fechamento.source_fingerprint);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_confirmar_fechamento(text, text, text, text) TO anon, authenticated;

-- Mantém a assinatura antiga segura: clientes desatualizados não podem confirmar sem token da tela.
CREATE OR REPLACE FUNCTION public.app_admin_confirmar_fechamento(p_token text, p_competencia text, p_confirmacao text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN jsonb_build_object('sucesso', false,
    'erro', 'Atualize a prévia e o cliente para confirmar a versão exibida com segurança.');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_confirmar_fechamento(text, text, text) TO anon, authenticated;

-- Mutação de qualquer fonte relevante invalida prévias abertas dentro da mesma transação.
CREATE OR REPLACE FUNCTION public.app_invalidar_previa_fechamento_on_source_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old_empresa uuid;
  v_new_empresa uuid;
  v_old_funcionario uuid;
  v_new_funcionario uuid;
  v_empresa uuid;
BEGIN
  IF TG_TABLE_NAME IN ('funcionarios', 'ponto_import_linhas', 'ponto_importacoes', 'configuracoes_empresa') THEN
    IF TG_OP <> 'INSERT' THEN
      v_old_empresa := nullif(to_jsonb(OLD)->>'empresa_id', '')::uuid;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new_empresa := nullif(to_jsonb(NEW)->>'empresa_id', '')::uuid;
    END IF;
    IF TG_OP = 'UPDATE' AND v_old_empresa IS DISTINCT FROM v_new_empresa THEN
      RAISE EXCEPTION 'empresa_id é imutável nesta tabela; use um fluxo explícito de transferência';
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      v_old_funcionario := nullif(to_jsonb(OLD)->>'funcionario_id', '')::uuid;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new_funcionario := nullif(to_jsonb(NEW)->>'funcionario_id', '')::uuid;
    END IF;
    IF v_old_funcionario IS NOT NULL THEN
      SELECT f.empresa_id INTO v_old_empresa FROM public.funcionarios f WHERE f.id = v_old_funcionario;
    END IF;
    IF v_new_funcionario IS NOT NULL THEN
      SELECT f.empresa_id INTO v_new_empresa FROM public.funcionarios f WHERE f.id = v_new_funcionario;
    END IF;
  END IF;

  FOR v_empresa IN
    SELECT DISTINCT ids.empresa_id
    FROM unnest(ARRAY[v_old_empresa, v_new_empresa]) AS ids(empresa_id)
    WHERE ids.empresa_id IS NOT NULL
    ORDER BY ids.empresa_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:' || v_empresa::text, 0));
    UPDATE public.fechamentos_mensais
    SET source_fingerprint = NULL
    WHERE empresa_id = v_empresa
      AND status = 'calculado'
      AND source_fingerprint IS NOT NULL;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.app_invalidar_previa_fechamento_on_source_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_invalidate_close_employee ON public.funcionarios;
CREATE TRIGGER app_invalidate_close_employee AFTER INSERT OR UPDATE OR DELETE ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_point_lines ON public.ponto_import_linhas;
CREATE TRIGGER app_invalidate_close_point_lines AFTER INSERT OR UPDATE OR DELETE ON public.ponto_import_linhas
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_point_imports ON public.ponto_importacoes;
CREATE TRIGGER app_invalidate_close_point_imports AFTER INSERT OR UPDATE OR DELETE ON public.ponto_importacoes
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_company_config ON public.configuracoes_empresa;
CREATE TRIGGER app_invalidate_close_company_config AFTER INSERT OR UPDATE OR DELETE ON public.configuracoes_empresa
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_medical_leaves ON public.atestados;
CREATE TRIGGER app_invalidate_close_medical_leaves AFTER INSERT OR UPDATE OR DELETE ON public.atestados
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_hr_leaves ON public.rh_afastamentos;
CREATE TRIGGER app_invalidate_close_hr_leaves AFTER INSERT OR UPDATE OR DELETE ON public.rh_afastamentos
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_point_justifications ON public.ponto_inconsistencias;
CREATE TRIGGER app_invalidate_close_point_justifications AFTER INSERT OR UPDATE OR DELETE ON public.ponto_inconsistencias
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();
DROP TRIGGER IF EXISTS app_invalidate_close_employee_justifications ON public.justificativas_ponto;
CREATE TRIGGER app_invalidate_close_employee_justifications AFTER INSERT OR UPDATE OR DELETE ON public.justificativas_ponto
FOR EACH ROW EXECUTE FUNCTION public.app_invalidar_previa_fechamento_on_source_change();

-- A API administrativa legada mantém sua permissão explícita, mas sincroniza as duas tabelas de justificativa.
CREATE OR REPLACE FUNCTION public.app_admin_decidir_justificativa(
  p_token text, p_id uuid, p_status text, p_resposta text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'point.justifications.review') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  RETURN public.app_decidir_justificativa_ponto(p_token, p_id, p_status, p_resposta);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_decidir_justificativa(text, uuid, text, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_decidir_justificativa_ponto(text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- O relatório usa somente uma prévia válida e a mesma opção de elegibilidade registrada nela.
CREATE OR REPLACE FUNCTION public.app_admin_relatorio_fechamento(
  p_token text, p_competencia text, p_tipo text,
  p_incluir_informais_vale boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
  v_fechamento record;
  v_id uuid;
  v_rows jsonb;
  v_include boolean;
  v_current_fingerprint text;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR left(p_competencia, 4) = '0000' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência deve estar no formato AAAA-MM e conter mês entre 01 e 12');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('escritorio', 'vale') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de relatório inválido');
  END IF;
  v_include := coalesce(p_incluir_informais_vale, false);
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:' || v_usuario.empresa_id::text, 0));
  SELECT * INTO v_fechamento
  FROM public.fechamentos_mensais
  WHERE empresa_id = v_usuario.empresa_id AND competencia = p_competencia
  LIMIT 1;
  IF v_fechamento.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Calcule a prévia antes de emitir o relatório');
  END IF;
  IF v_fechamento.status NOT IN ('calculado', 'fechado') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A prévia não está disponível para relatório');
  END IF;
  IF p_tipo = 'vale' AND v_include IS DISTINCT FROM coalesce(v_fechamento.incluir_informais_vale, false) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A opção de informais mudou; recalcule a prévia antes de emitir o relatório');
  END IF;
  IF v_fechamento.status = 'calculado' THEN
    IF v_fechamento.source_fingerprint IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A prévia foi invalidada por alterações; recalcule antes de emitir o relatório');
    END IF;
    v_current_fingerprint := public.app_fechamento_source_fingerprint(
      v_usuario.empresa_id, p_competencia, v_fechamento.incluir_informais_vale
    );
    IF v_current_fingerprint IS DISTINCT FROM v_fechamento.source_fingerprint THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Os dados mudaram desde a prévia; recalcule antes de emitir o relatório');
    END IF;
  END IF;
  v_id := v_fechamento.id;
  IF p_tipo = 'escritorio' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.nome, f.cpf, f.cargo, f.registrado, ff.dias_trabalhados,
        ff.dias_folga, ff.dias_ferias, ff.dias_afastamento, ff.faltas,
        ff.faltas_justificadas, ff.faltas_injustificadas, ff.atrasos_minutos,
        ff.horas_extras_50, ff.horas_extras_50_valor, ff.horas_extras_100,
        ff.horas_extras_100_valor, ff.dsr_horas, ff.dsr_desconto, ff.hora_base
      FROM public.fechamento_funcionarios ff
      JOIN public.funcionarios f ON f.id = ff.funcionario_id AND f.empresa_id = v_usuario.empresa_id
      WHERE ff.fechamento_id = v_id AND f.elegivel_escritorio = true AND f.registrado = true
      LIMIT 1000
    ) x;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.nome, f.cpf, f.registrado, ff.faltas_justificadas,
        ff.faltas_injustificadas, ff.vale_elegivel, ff.vale_valor, ff.dsr_desconto
      FROM public.fechamento_funcionarios ff
      JOIN public.funcionarios f ON f.id = ff.funcionario_id AND f.empresa_id = v_usuario.empresa_id
      WHERE ff.fechamento_id = v_id AND ff.vale_elegivel
        AND (v_include OR f.registrado)
      LIMIT 1000
    ) x;
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'competencia', p_competencia,
    'tipo', p_tipo, 'status', v_fechamento.status, 'linhas', v_rows, 'auditavel', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_relatorio_fechamento(text, text, text, boolean) TO anon, authenticated;

-- A UI chama esta RPC pública; null em remuneração significa preservar o valor já cadastrado.
CREATE OR REPLACE FUNCTION public.app_admin_registrar_admissao(
  p_token text,
  p_funcionario_id uuid,
  p_data_admissao date,
  p_tipo_vinculo text DEFAULT NULL,
  p_cargo text DEFAULT NULL,
  p_valor_mensal numeric DEFAULT NULL,
  p_valor_diaria numeric DEFAULT NULL,
  p_registrado boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_usuario record;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  RETURN public.app_admin_registrar_admissao_legacy(
    p_token, p_funcionario_id, p_data_admissao, p_tipo_vinculo,
    p_cargo, p_valor_mensal, p_valor_diaria, p_registrado
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.app_admin_registrar_admissao(text, uuid, date, text, text, numeric, numeric, boolean) TO anon, authenticated;

COMMIT;
