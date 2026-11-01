BEGIN;

CREATE TABLE IF NOT EXISTS public.ponto_jornadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  grupo_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao > 0),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 100),
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 500),
  modo text NOT NULL CHECK (modo IN ('horarios_fixos', 'carga_semanal')),
  carga_semanal_minutos integer NOT NULL CHECK (carga_semanal_minutos BETWEEN 0 AND 10080),
  dias_semana jsonb NOT NULL CHECK (jsonb_typeof(dias_semana) = 'object'),
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ponto_jornadas_empresa_grupo_versao_key UNIQUE (empresa_id, grupo_id, versao)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ponto_jornadas_grupo_ativa
  ON public.ponto_jornadas (empresa_id, grupo_id)
  WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_ponto_jornadas_empresa_ativas
  ON public.ponto_jornadas (empresa_id, lower(nome))
  WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.ponto_jornada_atribuicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id),
  jornada_id uuid NOT NULL REFERENCES public.ponto_jornadas(id),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ponto_jornada_atribuicoes_vigencia_check
    CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ponto_jornada_atribuicoes_funcionario_inicio_key
    UNIQUE (empresa_id, funcionario_id, vigencia_inicio)
);

CREATE INDEX IF NOT EXISTS idx_ponto_jornada_atribuicoes_consulta
  ON public.ponto_jornada_atribuicoes (empresa_id, funcionario_id, vigencia_inicio DESC, vigencia_fim);
CREATE INDEX IF NOT EXISTS idx_ponto_jornada_atribuicoes_jornada
  ON public.ponto_jornada_atribuicoes (empresa_id, jornada_id, vigencia_inicio DESC);

ALTER TABLE public.ponto_jornadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ponto_jornada_atribuicoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ponto_jornadas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ponto_jornada_atribuicoes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_listar_jornadas_ponto(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_jornadas jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo', 'jornadas', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.nome, item.versao DESC), '[]'::jsonb)
    INTO v_jornadas
  FROM (
    SELECT j.id, j.grupo_id, j.versao, j.nome, j.descricao, j.modo,
      j.carga_semanal_minutos, j.dias_semana, j.ativo, j.created_at,
      (SELECT count(DISTINCT a.funcionario_id)::integer
         FROM public.ponto_jornada_atribuicoes a
        WHERE a.empresa_id = v_usuario.empresa_id
          AND a.jornada_id = j.id
          AND a.vigencia_inicio <= current_date
          AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= current_date)
      ) AS funcionarios_vigentes
    FROM public.ponto_jornadas j
    WHERE j.empresa_id = v_usuario.empresa_id AND j.ativo = true
    ORDER BY lower(j.nome), j.versao DESC
    LIMIT 200
  ) item;

  RETURN jsonb_build_object('sucesso', true, 'jornadas', v_jornadas);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_salvar_jornada_ponto(
  p_token text,
  p_id uuid DEFAULT NULL,
  p_nome text DEFAULT NULL,
  p_descricao text DEFAULT NULL,
  p_modo text DEFAULT NULL,
  p_carga_semanal_minutos integer DEFAULT 0,
  p_dias_semana jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_atual public.ponto_jornadas%ROWTYPE;
  v_grupo_id uuid;
  v_id uuid;
  v_versao integer;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_descricao text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_dia record;
  v_periodo record;
  v_inicio text;
  v_fim text;
  v_inicio_minutos integer;
  v_fim_minutos integer;
  v_fim_anterior integer;
  v_minutos integer;
  v_total_semanal integer := 0;
  v_dias_chaves integer;
  v_detalhes jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  IF char_length(v_nome) < 2 OR char_length(v_nome) > 100 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O nome da jornada deve ter entre 2 e 100 caracteres.');
  END IF;
  IF char_length(coalesce(v_descricao, '')) > 500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A descrição deve ter no máximo 500 caracteres.');
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('horarios_fixos', 'carga_semanal') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione um modo de jornada válido.');
  END IF;
  IF jsonb_typeof(p_dias_semana) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A semana da jornada está incompleta.');
  END IF;

  SELECT count(*) INTO v_dias_chaves FROM jsonb_object_keys(p_dias_semana);
  IF v_dias_chaves <> 7 OR EXISTS (
    SELECT 1 FROM generate_series(1, 7) AS gs(day_number)
    WHERE NOT (p_dias_semana ? day_number::text)
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A jornada deve informar os sete dias da semana.');
  END IF;

  FOR v_dia IN SELECT key, value FROM jsonb_each(p_dias_semana) ORDER BY key::integer
  LOOP
    IF jsonb_typeof(v_dia.value) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_dia.value->'ativo') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_dia.value->'periodos') IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Revise a configuração de cada dia da jornada.');
    END IF;

    IF p_modo = 'horarios_fixos' AND (v_dia.value->>'ativo')::boolean THEN
      IF jsonb_array_length(v_dia.value->'periodos') < 1
         OR jsonb_array_length(v_dia.value->'periodos') > 4 THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada dia ativo deve ter de um a quatro períodos.');
      END IF;
      v_fim_anterior := -1;
      FOR v_periodo IN SELECT value FROM jsonb_array_elements(v_dia.value->'periodos')
      LOOP
        v_inicio := coalesce(v_periodo.value->>'inicio', '');
        v_fim := coalesce(v_periodo.value->>'fim', '');
        IF jsonb_typeof(v_periodo.value) IS DISTINCT FROM 'object'
           OR v_inicio !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR v_fim !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
          RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe horários válidos no formato HH:MM.');
        END IF;
        v_inicio_minutos := split_part(v_inicio, ':', 1)::integer * 60 + split_part(v_inicio, ':', 2)::integer;
        v_fim_minutos := split_part(v_fim, ':', 1)::integer * 60 + split_part(v_fim, ':', 2)::integer;
        IF v_fim_minutos <= v_inicio_minutos THEN
          RETURN jsonb_build_object('sucesso', false, 'erro', 'O fim de cada período deve ser posterior ao início.');
        END IF;
        IF v_inicio_minutos < v_fim_anterior THEN
          RETURN jsonb_build_object('sucesso', false, 'erro', 'Os períodos de cada dia devem estar em ordem e não podem se sobrepor.');
        END IF;
        v_fim_anterior := v_fim_minutos;
        v_total_semanal := v_total_semanal + (v_fim_minutos - v_inicio_minutos);
      END LOOP;
    ELSIF p_modo = 'carga_semanal' THEN
      IF coalesce(v_dia.value->>'minutos', '') !~ '^[0-9]{1,5}$' THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma carga diária em minutos válida.');
      END IF;
      v_minutos := (v_dia.value->>'minutos')::integer;
      IF v_minutos < 0 OR v_minutos > 10080
         OR ((v_dia.value->>'ativo')::boolean AND v_minutos = 0)
         OR (NOT (v_dia.value->>'ativo')::boolean AND v_minutos <> 0) THEN
        RETURN jsonb_build_object('sucesso', false, 'erro', 'Confira os minutos de cada dia ativo e de descanso.');
      END IF;
      v_total_semanal := v_total_semanal + v_minutos;
    END IF;
  END LOOP;

  IF v_total_semanal < 1 OR v_total_semanal > 10080 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A carga semanal deve ser maior que zero e não pode ultrapassar 168 horas.');
  END IF;
  IF p_modo = 'carga_semanal' AND p_carga_semanal_minutos IS DISTINCT FROM v_total_semanal THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A soma das cargas diárias precisa corresponder ao total semanal.');
  END IF;

  IF p_id IS NULL THEN
    v_grupo_id := gen_random_uuid();
    v_versao := 1;
  ELSE
    SELECT * INTO v_atual
    FROM public.ponto_jornadas
    WHERE id = p_id AND empresa_id = v_usuario.empresa_id AND ativo = true
    FOR UPDATE;
    IF v_atual.id IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Modelo de jornada ativo não encontrado nesta empresa.');
    END IF;
    v_grupo_id := v_atual.grupo_id;
    SELECT coalesce(max(j.versao), 0) + 1 INTO v_versao
    FROM public.ponto_jornadas j
    WHERE j.empresa_id = v_usuario.empresa_id AND j.grupo_id = v_grupo_id;
    UPDATE public.ponto_jornadas SET ativo = false WHERE id = v_atual.id AND empresa_id = v_usuario.empresa_id;
  END IF;

  INSERT INTO public.ponto_jornadas (
    empresa_id, grupo_id, versao, nome, descricao, modo,
    carga_semanal_minutos, dias_semana, ativo, created_by
  ) VALUES (
    v_usuario.empresa_id, v_grupo_id, v_versao, v_nome, v_descricao, p_modo,
    v_total_semanal, p_dias_semana, true, v_usuario.usuario_id
  ) RETURNING id INTO v_id;

  v_detalhes := jsonb_build_object(
    'jornada_id', v_id,
    'grupo_id', v_grupo_id,
    'versao', v_versao,
    'nome', v_nome,
    'modo', p_modo,
    'carga_semanal_minutos', v_total_semanal,
    'substituiu_jornada_id', CASE WHEN p_id IS NULL THEN NULL ELSE p_id END
  );
  INSERT INTO public.auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_usuario.usuario_id, CASE WHEN p_id IS NULL THEN 'criou_jornada_ponto' ELSE 'versionou_jornada_ponto' END,
          'ponto_jornadas', v_id, v_detalhes);

  RETURN jsonb_build_object('sucesso', true, 'jornada_id', v_id, 'grupo_id', v_grupo_id, 'versao', v_versao);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_inativar_jornada_ponto(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_jornada public.ponto_jornadas%ROWTYPE;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  UPDATE public.ponto_jornadas j
     SET ativo = false
   WHERE j.id = p_id AND j.empresa_id = v_usuario.empresa_id AND j.ativo = true
   RETURNING j.* INTO v_jornada;
  IF v_jornada.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Modelo ativo não encontrado nesta empresa.');
  END IF;

  INSERT INTO public.auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_usuario.usuario_id, 'inativou_jornada_ponto', 'ponto_jornadas', v_jornada.id,
          jsonb_build_object('grupo_id', v_jornada.grupo_id, 'versao', v_jornada.versao, 'nome', v_jornada.nome));
  RETURN jsonb_build_object('sucesso', true, 'jornada_id', v_jornada.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_listar_jornada_funcionario_ponto(
  p_token text,
  p_funcionario_id uuid,
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_funcionario_id uuid;
  v_atribuicoes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo', 'atribuicoes', '[]'::jsonb);
  END IF;
  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL AND p_inicio > p_fim THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O período de consulta é inválido.', 'atribuicoes', '[]'::jsonb);
  END IF;

  SELECT f.id INTO v_funcionario_id
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id AND f.empresa_id = v_usuario.empresa_id
  LIMIT 1;
  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado nesta empresa.', 'atribuicoes', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.vigencia_inicio DESC, item.created_at DESC), '[]'::jsonb)
    INTO v_atribuicoes
  FROM (
    SELECT a.id, a.funcionario_id, a.jornada_id, j.nome AS jornada_nome,
      j.versao AS jornada_versao, j.modo, j.carga_semanal_minutos,
      j.dias_semana, a.vigencia_inicio, a.vigencia_fim, a.created_at
    FROM public.ponto_jornada_atribuicoes a
    JOIN public.ponto_jornadas j ON j.id = a.jornada_id AND j.empresa_id = a.empresa_id
    WHERE a.empresa_id = v_usuario.empresa_id
      AND a.funcionario_id = v_funcionario_id
      AND (p_fim IS NULL OR a.vigencia_inicio <= p_fim)
      AND (p_inicio IS NULL OR a.vigencia_fim IS NULL OR a.vigencia_fim >= p_inicio)
    ORDER BY a.vigencia_inicio DESC, a.created_at DESC
    LIMIT 200
  ) item;

  RETURN jsonb_build_object('sucesso', true, 'funcionario_id', v_funcionario_id, 'atribuicoes', v_atribuicoes);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_atribuir_jornada_ponto(
  p_token text,
  p_funcionario_id uuid,
  p_jornada_id uuid,
  p_vigencia_inicio date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_funcionario_id uuid;
  v_jornada public.ponto_jornadas%ROWTYPE;
  v_exata public.ponto_jornada_atribuicoes%ROWTYPE;
  v_anterior public.ponto_jornada_atribuicoes%ROWTYPE;
  v_proxima_inicio date;
  v_nova_fim date;
  v_id uuid;
  v_overlap_count integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;
  IF p_vigencia_inicio IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe a data de início da vigência.');
  END IF;

  SELECT f.id INTO v_funcionario_id
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id AND f.empresa_id = v_usuario.empresa_id
  FOR UPDATE;
  IF v_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado nesta empresa.');
  END IF;

  SELECT * INTO v_jornada
  FROM public.ponto_jornadas j
  WHERE j.id = p_jornada_id AND j.empresa_id = v_usuario.empresa_id AND j.ativo = true
  LIMIT 1
  FOR UPDATE;
  IF v_jornada.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione uma versão ativa de jornada desta empresa.');
  END IF;

  SELECT * INTO v_exata
  FROM public.ponto_jornada_atribuicoes a
  WHERE a.empresa_id = v_usuario.empresa_id
    AND a.funcionario_id = v_funcionario_id
    AND a.vigencia_inicio = p_vigencia_inicio
  FOR UPDATE;
  IF v_exata.id IS NOT NULL THEN
    IF v_exata.jornada_id = v_jornada.id THEN
      RETURN jsonb_build_object('sucesso', true, 'atribuicao_id', v_exata.id, 'vigencia_inicio', p_vigencia_inicio, 'vigencia_fim', v_exata.vigencia_fim, 'reutilizada', true);
    END IF;
    UPDATE public.ponto_jornada_atribuicoes
       SET jornada_id = v_jornada.id, updated_by = v_usuario.usuario_id, updated_at = now()
     WHERE id = v_exata.id AND empresa_id = v_usuario.empresa_id;
    INSERT INTO public.auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes)
    VALUES (v_usuario.usuario_id, 'corrigiu_atribuicao_jornada_ponto', 'ponto_jornada_atribuicoes', v_exata.id,
            jsonb_build_object('funcionario_id', v_funcionario_id, 'vigencia_inicio', p_vigencia_inicio,
              'jornada_anterior_id', v_exata.jornada_id, 'jornada_nova_id', v_jornada.id));
    RETURN jsonb_build_object('sucesso', true, 'atribuicao_id', v_exata.id, 'vigencia_inicio', p_vigencia_inicio, 'vigencia_fim', v_exata.vigencia_fim, 'corrigida', true);
  END IF;

  SELECT count(*) INTO v_overlap_count
  FROM public.ponto_jornada_atribuicoes a
  WHERE a.empresa_id = v_usuario.empresa_id
    AND a.funcionario_id = v_funcionario_id
    AND a.vigencia_inicio <= p_vigencia_inicio
    AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= p_vigencia_inicio);
  IF v_overlap_count > 1 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Há vigências sobrepostas neste histórico. Corrija a sobreposição antes de atribuir uma nova jornada.');
  END IF;

  SELECT * INTO v_anterior
  FROM public.ponto_jornada_atribuicoes a
  WHERE a.empresa_id = v_usuario.empresa_id
    AND a.funcionario_id = v_funcionario_id
    AND a.vigencia_inicio < p_vigencia_inicio
    AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= p_vigencia_inicio)
  ORDER BY a.vigencia_inicio DESC
  LIMIT 1
  FOR UPDATE;
  IF v_anterior.id IS NOT NULL THEN
    UPDATE public.ponto_jornada_atribuicoes
       SET vigencia_fim = p_vigencia_inicio - 1,
           updated_by = v_usuario.usuario_id,
           updated_at = now()
     WHERE id = v_anterior.id AND empresa_id = v_usuario.empresa_id;
  END IF;

  SELECT min(a.vigencia_inicio) INTO v_proxima_inicio
  FROM public.ponto_jornada_atribuicoes a
  WHERE a.empresa_id = v_usuario.empresa_id
    AND a.funcionario_id = v_funcionario_id
    AND a.vigencia_inicio > p_vigencia_inicio;
  v_nova_fim := CASE WHEN v_proxima_inicio IS NULL THEN NULL ELSE v_proxima_inicio - 1 END;
  IF v_nova_fim IS NOT NULL AND v_nova_fim < p_vigencia_inicio THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A data escolhida conflita com outra vigência registrada.');
  END IF;

  INSERT INTO public.ponto_jornada_atribuicoes (
    empresa_id, funcionario_id, jornada_id, vigencia_inicio, vigencia_fim, created_by, updated_by
  ) VALUES (
    v_usuario.empresa_id, v_funcionario_id, v_jornada.id, p_vigencia_inicio, v_nova_fim, v_usuario.usuario_id, v_usuario.usuario_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_usuario.usuario_id, 'atribuiu_jornada_ponto', 'ponto_jornada_atribuicoes', v_id,
          jsonb_build_object('funcionario_id', v_funcionario_id, 'jornada_id', v_jornada.id,
            'vigencia_inicio', p_vigencia_inicio, 'vigencia_fim', v_nova_fim,
            'jornada_anterior_id', v_anterior.jornada_id,
            'atribuicao_anterior_id', v_anterior.id,
            'vigencia_anterior_inicio', v_anterior.vigencia_inicio,
            'vigencia_anterior_fim_original', v_anterior.vigencia_fim,
            'vigencia_anterior_fim_nova', CASE WHEN v_anterior.id IS NULL THEN NULL ELSE p_vigencia_inicio - 1 END));

  RETURN jsonb_build_object('sucesso', true, 'atribuicao_id', v_id, 'vigencia_inicio', p_vigencia_inicio, 'vigencia_fim', v_nova_fim);
END;
$$;

REVOKE ALL ON FUNCTION public.app_admin_listar_jornadas_ponto(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_salvar_jornada_ponto(text, uuid, text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_inativar_jornada_ponto(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_listar_jornada_funcionario_ponto(text, uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_atribuir_jornada_ponto(text, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_listar_jornadas_ponto(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_salvar_jornada_ponto(text, uuid, text, text, text, integer, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_inativar_jornada_ponto(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_listar_jornada_funcionario_ponto(text, uuid, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atribuir_jornada_ponto(text, uuid, uuid, date) TO anon, authenticated;

COMMIT;
