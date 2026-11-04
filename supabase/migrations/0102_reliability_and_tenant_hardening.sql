BEGIN;

-- A linha inválida permanece auditável sem preencher uma data fictícia.
ALTER TABLE public.ponto_import_linhas ALTER COLUMN data DROP NOT NULL;
ALTER TABLE public.ponto_importacoes
  ADD COLUMN IF NOT EXISTS linhas_com_inconsistencia integer NOT NULL DEFAULT 0;

-- Listagem administrativa: falha fechada e limitada à empresa da sessão.
CREATE OR REPLACE FUNCTION public.app_listar_funcionarios(p_token text)
RETURNS TABLE(
  id uuid, nome text, cpf text, cargo text, data_admissao date, data_demissao date,
  motivo_demissao text, tipo_vinculo text, salario numeric, ativo boolean,
  perfil text, avatar_url text, situacao text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao,
         f.data_demissao, f.motivo_demissao, f.tipo_vinculo::text, f.salario,
         f.ativo, COALESCE(u.perfil, 'funcionario')::text, f.avatar_url::text,
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
  LEFT JOIN LATERAL (
    SELECT usuario.perfil
    FROM public.usuarios usuario
    WHERE usuario.funcionario_id = f.id AND usuario.empresa_id = v.empresa_id
    ORDER BY usuario.ativo DESC
    LIMIT 1
  ) u ON true
  WHERE f.empresa_id = v.empresa_id
  ORDER BY f.ativo DESC, f.nome
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.app_listar_funcionarios(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_funcionarios(text) TO anon, authenticated;

-- O portal pessoal recebe metadados mínimos; URL e caminho de Storage nunca são listados.
CREATE OR REPLACE FUNCTION public.app_listar_holerites(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.ano DESC, x.mes DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT h.id, h.mes, h.ano, h.arquivo_nome, h.disponivel, h.created_at
    FROM public.holerites h
    JOIN public.funcionarios f
      ON f.id = h.funcionario_id AND f.empresa_id = v.empresa_id
    WHERE h.funcionario_id = v.funcionario_id AND h.empresa_id = v.empresa_id
      AND h.disponivel = true AND NULLIF(BTRIM(h.storage_path), '') IS NOT NULL
    ORDER BY h.ano DESC, h.mes DESC
    LIMIT 60
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'holerites', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.app_listar_holerites(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_holerites(text) TO anon, authenticated;

-- A lista administrativa de holerites não devolve URL nem CPF; documentos privados
-- só são abertos depois de autorização e emissão de URL assinada pela Edge Function.
CREATE OR REPLACE FUNCTION public.app_admin_holerites(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.ano DESC, x.mes DESC, x.nome), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT h.id, h.funcionario_id, h.mes, h.ano, h.arquivo_nome, h.disponivel,
           (NULLIF(BTRIM(h.storage_path), '') IS NOT NULL) AS tem_arquivo_privado,
           h.created_at, f.nome
    FROM public.holerites h
    JOIN public.funcionarios f
      ON f.id = h.funcionario_id AND f.empresa_id = v.empresa_id
    WHERE h.empresa_id = v.empresa_id
    ORDER BY h.ano DESC, h.mes DESC, f.nome
    LIMIT 1000
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'holerites', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.app_admin_holerites(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_holerites(text) TO anon, authenticated;

-- Desativa caminhos legados que aceitavam URL direta ou não isolavam tenant.
REVOKE ALL ON FUNCTION public.app_admin_registrar_holerite(text, uuid, integer, integer, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_lote(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Importação: valida CPF/data/horários no servidor, mantém erro por linha e não grava
-- registros de ponto até a confirmação posterior do lote inteiro.
CREATE OR REPLACE FUNCTION public.app_importar_ponto(
  p_token text, p_tipo text, p_competencia text, p_arquivo_nome text, p_linhas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_importacao uuid;
  v_linha jsonb;
  v_funcionario_id uuid;
  v_total integer := 0;
  v_encontradas integer := 0;
  v_nao_encontradas integer := 0;
  v_inconsistentes integer := 0;
  v_cpfs jsonb := '[]'::jsonb;
  v_data date;
  v_cpf text;
  v_nome text;
  v_inconsistencia text;
  v_e1 time;
  v_s1 time;
  v_e2 time;
  v_s2 time;
  v_time_text text;
  v_sum integer;
  v_digit integer;
  v_i integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('diario', 'mensal')
     OR jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo de ponto inválido');
  END IF;
  IF jsonb_array_length(p_linhas) < 1 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O arquivo não contém linhas para analisar');
  END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O arquivo excede o limite de 5.000 linhas');
  END IF;
  IF COALESCE(p_competencia, '') !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência inválida; use MM/AAAA');
  END IF;

  INSERT INTO public.ponto_importacoes(empresa_id, tipo, competencia, arquivo_nome, imported_by, status)
  VALUES (v_usuario.empresa_id, p_tipo, p_competencia,
          COALESCE(NULLIF(BTRIM(p_arquivo_nome), ''), 'ponto.csv'), v_usuario.usuario_id, 'pendente')
  RETURNING id INTO v_importacao;

  FOR v_linha IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_total := v_total + 1;
    v_funcionario_id := NULL;
    v_inconsistencia := NULL;
    v_data := NULL;
    v_e1 := NULL; v_s1 := NULL; v_e2 := NULL; v_s2 := NULL;
    v_cpf := regexp_replace(COALESCE(v_linha->>'cpf', ''), '[^0-9]', '', 'g');
    v_nome := COALESCE(NULLIF(BTRIM(v_linha->>'nome'), ''), 'Nome não informado');

    -- Valida dígitos verificadores no banco; não confia na validação do navegador.
    IF length(v_cpf) <> 11 OR v_cpf = repeat(substr(v_cpf, 1, 1), 11) THEN
      v_inconsistencia := 'CPF ausente ou inválido';
    ELSE
      v_sum := 0;
      FOR v_i IN 1..9 LOOP
        v_sum := v_sum + substr(v_cpf, v_i, 1)::integer * (11 - v_i);
      END LOOP;
      v_digit := mod(v_sum * 10, 11);
      IF v_digit = 10 THEN v_digit := 0; END IF;
      IF v_digit <> substr(v_cpf, 10, 1)::integer THEN
        v_inconsistencia := 'CPF ausente ou inválido';
      ELSE
        v_sum := 0;
        FOR v_i IN 1..10 LOOP
          v_sum := v_sum + substr(v_cpf, v_i, 1)::integer * (12 - v_i);
        END LOOP;
        v_digit := mod(v_sum * 10, 11);
        IF v_digit = 10 THEN v_digit := 0; END IF;
        IF v_digit <> substr(v_cpf, 11, 1)::integer THEN
          v_inconsistencia := 'CPF ausente ou inválido';
        END IF;
      END IF;
    END IF;

    IF v_inconsistencia IS NULL THEN
      SELECT f.id INTO v_funcionario_id
      FROM public.funcionarios f
      WHERE regexp_replace(f.cpf, '[^0-9]', '', 'g') = v_cpf
        AND f.empresa_id = v_usuario.empresa_id
        AND f.ativo = true
      LIMIT 1;
      IF v_funcionario_id IS NULL THEN
        v_inconsistencia := 'CPF não encontrado no cadastro ativo desta empresa';
      END IF;
    END IF;

    IF COALESCE(BTRIM(v_linha->>'data'), '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Data do registro inválida');
    ELSE
      BEGIN
        v_data := (v_linha->>'data')::date;
      EXCEPTION WHEN OTHERS THEN
        v_data := NULL;
        v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Data do registro inválida');
      END;
    END IF;

    v_time_text := NULLIF(BTRIM(v_linha->>'entrada_1'), '');
    IF v_time_text IS NOT NULL THEN
      BEGIN
        IF v_time_text !~ '^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$' THEN RAISE EXCEPTION 'horário inválido'; END IF;
        v_e1 := v_time_text::time;
      EXCEPTION WHEN OTHERS THEN
        v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Horário de entrada 1 inválido');
      END;
    END IF;
    v_time_text := NULLIF(BTRIM(v_linha->>'saida_1'), '');
    IF v_time_text IS NOT NULL THEN
      BEGIN
        IF v_time_text !~ '^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$' THEN RAISE EXCEPTION 'horário inválido'; END IF;
        v_s1 := v_time_text::time;
      EXCEPTION WHEN OTHERS THEN
        v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Horário de saída 1 inválido');
      END;
    END IF;
    v_time_text := NULLIF(BTRIM(v_linha->>'entrada_2'), '');
    IF v_time_text IS NOT NULL THEN
      BEGIN
        IF v_time_text !~ '^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$' THEN RAISE EXCEPTION 'horário inválido'; END IF;
        v_e2 := v_time_text::time;
      EXCEPTION WHEN OTHERS THEN
        v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Horário de entrada 2 inválido');
      END;
    END IF;
    v_time_text := NULLIF(BTRIM(v_linha->>'saida_2'), '');
    IF v_time_text IS NOT NULL THEN
      BEGIN
        IF v_time_text !~ '^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$' THEN RAISE EXCEPTION 'horário inválido'; END IF;
        v_s2 := v_time_text::time;
      EXCEPTION WHEN OTHERS THEN
        v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Horário de saída 2 inválido');
      END;
    END IF;

    IF v_funcionario_id IS NOT NULL AND v_data IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.ponto_import_linhas prior
      WHERE prior.importacao_id = v_importacao
        AND prior.funcionario_id = v_funcionario_id AND prior.data = v_data
    ) THEN
      v_inconsistencia := concat_ws('; ', NULLIF(v_inconsistencia, ''), 'Funcionário e data repetidos neste arquivo');
    END IF;

    INSERT INTO public.ponto_import_linhas(
      empresa_id, importacao_id, funcionario_id, cpf, nome_csv, data, previsto,
      entrada_1, saida_1, entrada_2, saida_2, total_normais, total_noturno,
      dia_falta, horas_atraso, abono, extra_50, extra_100, desconta_dsr,
      justificativas, encontrado, inconsistencia, raw_data
    ) VALUES (
      v_usuario.empresa_id, v_importacao, v_funcionario_id, v_cpf, v_nome, v_data,
      v_linha->>'previsto', v_e1, v_s1, v_e2, v_s2, v_linha->>'total_normais',
      v_linha->>'total_noturno', v_linha->>'dia_falta', v_linha->>'horas_atraso',
      v_linha->>'abono', v_linha->>'extra_50', v_linha->>'extra_100',
      v_linha->>'desconta_dsr', v_linha->>'justificativas',
      v_funcionario_id IS NOT NULL, NULLIF(v_inconsistencia, ''), v_linha
    );

    IF v_funcionario_id IS NULL THEN
      v_nao_encontradas := v_nao_encontradas + 1;
      v_cpfs := v_cpfs || jsonb_build_array(CASE WHEN v_cpf = '' THEN v_nome ELSE v_cpf END);
    ELSE
      v_encontradas := v_encontradas + 1;
    END IF;
    IF NULLIF(v_inconsistencia, '') IS NOT NULL THEN
      v_inconsistentes := v_inconsistentes + 1;
    END IF;
  END LOOP;

  UPDATE public.ponto_importacoes
  SET total_linhas = v_total, linhas_encontradas = v_encontradas,
      linhas_nao_encontradas = v_nao_encontradas,
      linhas_com_inconsistencia = v_inconsistentes,
      cpfs_nao_encontrados = v_cpfs
  WHERE id = v_importacao AND empresa_id = v_usuario.empresa_id;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (v_usuario.usuario_id, 'analisou_importacao_ponto', 'ponto_importacoes',
    jsonb_build_object('importacao_id', v_importacao, 'tipo', p_tipo,
      'competencia', p_competencia, 'total_linhas', v_total,
      'linhas_encontradas', v_encontradas, 'linhas_nao_encontradas', v_nao_encontradas,
      'linhas_com_inconsistencia', v_inconsistentes));

  RETURN jsonb_build_object('sucesso', true, 'importacao_id', v_importacao,
    'status', 'pendente', 'total_linhas', v_total,
    'linhas_encontradas', v_encontradas, 'linhas_nao_encontradas', v_nao_encontradas,
    'linhas_com_inconsistencia', v_inconsistentes, 'cpfs_nao_encontrados', v_cpfs);
END;
$$;
REVOKE ALL ON FUNCTION public.app_importar_ponto(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_importar_ponto(text, text, text, text, jsonb) TO anon, authenticated;

-- A aplicação é atômica: qualquer linha inválida interrompe o lote antes de gravar.
-- Se houver batidas existentes, a interface deve pedir confirmação explícita para substituir.
DROP FUNCTION IF EXISTS public.app_aplicar_importacao_ponto(text, uuid);
CREATE FUNCTION public.app_aplicar_importacao_ponto(
  p_token text, p_importacao_id uuid, p_confirmar_substituicao boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_importacao record;
  v_aplicadas integer := 0;
  v_invalidas integer := 0;
  v_duplicadas integer := 0;
  v_existentes integer := 0;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo');
  END IF;

  SELECT * INTO v_importacao
  FROM public.ponto_importacoes
  WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id
  FOR UPDATE;
  IF v_importacao.id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Importação não encontrada');
  END IF;
  IF v_importacao.status <> 'pendente' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Esta importação já foi processada');
  END IF;

  SELECT count(*) INTO v_invalidas
  FROM public.ponto_import_linhas l
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND (l.funcionario_id IS NULL OR l.data IS NULL OR NOT COALESCE(l.encontrado, false)
      OR NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NOT NULL);
  IF v_invalidas > 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'A importação contém linhas sem correspondência ou inconsistentes. Corrija o arquivo e faça uma nova análise; nenhuma batida foi gravada.',
      'linhas_invalidas', v_invalidas);
  END IF;

  SELECT count(*) INTO v_duplicadas FROM (
    SELECT l.funcionario_id, l.data
    FROM public.ponto_import_linhas l
    WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    GROUP BY l.funcionario_id, l.data HAVING count(*) > 1
  ) duplicadas;
  IF v_duplicadas > 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'Há mais de uma linha para o mesmo funcionário e data. Corrija o arquivo antes de aplicar.',
      'chaves_duplicadas', v_duplicadas);
  END IF;

  SELECT count(*) INTO v_existentes
  FROM public.ponto_import_linhas l
  JOIN public.registros_ponto r
    ON r.funcionario_id = l.funcionario_id AND r.data = l.data
  JOIN public.funcionarios f
    ON f.id = r.funcionario_id AND f.empresa_id = v_usuario.empresa_id
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id;
  IF v_existentes > 0 AND NOT COALESCE(p_confirmar_substituicao, false) THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'Já existem batidas para uma ou mais datas deste lote. Confirme explicitamente a substituição.',
      'confirmacao_substituicao_requerida', true, 'registros_existentes', v_existentes);
  END IF;

  INSERT INTO public.registros_ponto(
    empresa_id, funcionario_id, data, entrada, saida_almoco,
    volta_almoco, saida, status
  )
  SELECT v_usuario.empresa_id, l.funcionario_id, l.data, l.entrada_1,
         l.saida_1, l.entrada_2, l.saida_2,
         CASE WHEN COALESCE(BTRIM(l.dia_falta), '') <> '' THEN 'falta' ELSE 'normal' END
  FROM public.ponto_import_linhas l
  JOIN public.funcionarios f
    ON f.id = l.funcionario_id AND f.empresa_id = v_usuario.empresa_id
  WHERE l.importacao_id = p_importacao_id AND l.empresa_id = v_usuario.empresa_id
    AND l.encontrado = true AND l.funcionario_id IS NOT NULL AND l.data IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(l.inconsistencia, '')), '') IS NULL
  ON CONFLICT (funcionario_id, data) DO UPDATE
    SET empresa_id = EXCLUDED.empresa_id,
        entrada = EXCLUDED.entrada, saida_almoco = EXCLUDED.saida_almoco,
        volta_almoco = EXCLUDED.volta_almoco, saida = EXCLUDED.saida,
        status = EXCLUDED.status;
  GET DIAGNOSTICS v_aplicadas = ROW_COUNT;

  UPDATE public.ponto_importacoes
  SET status = 'aplicada', applied_at = now(), applied_by = v_usuario.usuario_id
  WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id;

  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (v_usuario.usuario_id, 'aplicou_importacao_ponto', 'ponto_importacoes',
    jsonb_build_object('importacao_id', p_importacao_id, 'linhas_aplicadas', v_aplicadas,
      'linhas_com_inconsistencia', v_importacao.linhas_com_inconsistencia,
      'registros_substituidos_confirmados', v_existentes));

  RETURN jsonb_build_object('sucesso', true, 'status', 'aplicada',
    'linhas_aplicadas', v_aplicadas,
    'linhas_com_inconsistencia', v_importacao.linhas_com_inconsistencia,
    'registros_substituidos', v_existentes);
END;
$$;
REVOKE ALL ON FUNCTION public.app_aplicar_importacao_ponto(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_aplicar_importacao_ponto(text, uuid, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_listar_importacoes(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT i.id, i.tipo, i.competencia, i.arquivo_nome, i.imported_by, i.total_linhas,
           i.linhas_encontradas, i.linhas_nao_encontradas, i.linhas_com_inconsistencia,
           i.cpfs_nao_encontrados, i.status, i.applied_at, i.archived_at, i.created_at,
           COALESCE(f.nome, u.nome_exibicao, 'Usuário') AS imported_by_name
    FROM public.ponto_importacoes i
    LEFT JOIN public.usuarios u ON u.id = i.imported_by AND u.empresa_id = i.empresa_id
    LEFT JOIN public.funcionarios f ON f.id = u.funcionario_id AND f.empresa_id = i.empresa_id
    WHERE i.empresa_id = v.empresa_id
    ORDER BY i.created_at DESC
    LIMIT 50
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'importacoes', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.app_listar_importacoes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_importacoes(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_listar_ponto_importado(
  p_token text, p_tipo text DEFAULT NULL::text, p_importacao_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR COALESCE(v_usuario.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.data DESC NULLS LAST, x.nome_csv), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT l.id, l.cpf, l.raw_data->>'cpf_arquivo' AS cpf_arquivo,
           CASE WHEN jsonb_typeof(l.raw_data->'import_validation_errors') = 'array'
                THEN l.raw_data->'import_validation_errors' ELSE '[]'::jsonb END AS import_validation_errors,
           l.nome_csv, l.data, l.entrada_1, l.saida_1, l.entrada_2, l.saida_2,
           l.total_normais, l.extra_50, l.extra_100, l.dia_falta, l.horas_atraso,
           l.justificativas, l.encontrado, l.inconsistencia, i.tipo, i.competencia, i.status
    FROM public.ponto_import_linhas l
    JOIN public.ponto_importacoes i ON i.id = l.importacao_id AND l.empresa_id = i.empresa_id
    LEFT JOIN public.funcionarios f ON f.id = l.funcionario_id AND f.empresa_id = i.empresa_id
    WHERE i.empresa_id = v_usuario.empresa_id AND l.empresa_id = v_usuario.empresa_id
      AND (l.funcionario_id IS NULL OR f.id IS NOT NULL)
      AND (p_tipo IS NULL OR i.tipo = p_tipo)
      AND (p_importacao_id IS NULL OR i.id = p_importacao_id)
    ORDER BY l.data DESC NULLS LAST, l.nome_csv
    LIMIT 5000
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'registros', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.app_listar_ponto_importado(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_listar_ponto_importado(text, text, uuid) TO anon, authenticated;

-- Dashboard financeiro/operacional: ordens canceladas não compõem o total do período.
CREATE OR REPLACE FUNCTION public.app_admin_dashboard_periodo(p_token text, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL
     OR COALESCE(v.perfil, '') NOT IN ('admin', 'administrador', 'gestor') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe as datas inicial e final');
  END IF;
  IF p_inicio > p_fim THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A data inicial não pode ser posterior à data final');
  END IF;
  IF p_fim - p_inicio > 366 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Selecione no máximo 367 dias');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'financeiro', jsonb_build_object(
      'receitas_realizadas', COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id AND l.tipo = 'receber' AND l.status = 'pago'
          AND COALESCE(l.pago_em, l.vencimento) BETWEEN p_inicio AND p_fim), 0),
      'despesas_realizadas', COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status = 'pago' AND COALESCE(a.pago_em, a.vencimento) BETWEEN p_inicio AND p_fim), 0),
      'recebiveis_com_vencimento', COALESCE((SELECT sum(l.valor) FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = v.empresa_id AND l.tipo = 'receber'
          AND l.status IN ('pendente', 'vencido') AND l.vencimento BETWEEN p_inicio AND p_fim), 0),
      'pagamentos_com_vencimento', COALESCE((SELECT sum(a.valor) FROM public.app_financeiro_contas_pagar_unificadas(v.empresa_id) a
        WHERE a.status IN ('pendente', 'vencido') AND a.vencimento BETWEEN p_inicio AND p_fim), 0)
    ),
    'ordens', (SELECT jsonb_build_object('quantidade', count(*)::integer,
      'pecas', COALESCE(sum(o.quantidade), 0), 'valor', COALESCE(sum(o.valor_total), 0))
      FROM public.ordens_servico o WHERE o.empresa_id = v.empresa_id
        AND o.data_entrada BETWEEN p_inicio AND p_fim AND COALESCE(o.status, '') <> 'cancelada'),
    'producao', (SELECT jsonb_build_object('ordens_com_evento', count(DISTINCT e.ordem_id)::integer,
      'produzidas', COALESCE(sum(e.unidades_produzidas_delta), 0),
      'costuradas', COALESCE(sum(e.unidades_costuradas_delta), 0),
      'entregues', COALESCE(sum(e.unidades_entregues_delta), 0))
      FROM public.ordens_servico_producao_eventos e WHERE e.empresa_id = v.empresa_id
        AND e.created_at >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND e.created_at < ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')),
    'ponto', (SELECT jsonb_build_object('total', COALESCE(sum(x.quantidade), 0),
      'por_status', COALESCE(jsonb_agg(jsonb_build_object('status', x.status, 'quantidade', x.quantidade) ORDER BY x.status), '[]'::jsonb))
      FROM (SELECT COALESCE(r.status, 'sem status') AS status, count(*)::integer AS quantidade
        FROM public.registros_ponto r JOIN public.funcionarios f ON f.id = r.funcionario_id
        WHERE f.empresa_id = v.empresa_id AND r.data BETWEEN p_inicio AND p_fim GROUP BY r.status) x),
    'inconsistencias_ponto', (SELECT jsonb_build_object('total', count(*)::integer,
      'pendentes', count(*) FILTER (WHERE i.status = 'pendente')::integer)
      FROM public.ponto_inconsistencias i WHERE i.empresa_id = v.empresa_id AND i.data BETWEEN p_inicio AND p_fim),
    'ausencias', jsonb_build_object(
      'ferias_sobrepostas', (SELECT count(*)::integer FROM public.rh_ferias f JOIN public.funcionarios x ON x.id = f.funcionario_id
        WHERE x.empresa_id = v.empresa_id AND COALESCE(f.status, '') <> 'cancelada'
          AND COALESCE(f.fim, f.inicio) >= p_inicio AND f.inicio <= p_fim),
      'ferias_iniciadas', (SELECT count(*)::integer FROM public.rh_ferias f JOIN public.funcionarios x ON x.id = f.funcionario_id
        WHERE x.empresa_id = v.empresa_id AND COALESCE(f.status, '') <> 'cancelada' AND f.inicio BETWEEN p_inicio AND p_fim),
      'afastamentos_sobrepostos', (SELECT count(*)::integer FROM public.rh_afastamentos a JOIN public.funcionarios x ON x.id = a.funcionario_id
        WHERE x.empresa_id = v.empresa_id AND COALESCE(a.status, '') <> 'cancelado'
          AND COALESCE(a.fim, p_fim) >= p_inicio AND a.inicio <= p_fim),
      'afastamentos_iniciados', (SELECT count(*)::integer FROM public.rh_afastamentos a JOIN public.funcionarios x ON x.id = a.funcionario_id
        WHERE x.empresa_id = v.empresa_id AND COALESCE(a.status, '') <> 'cancelado' AND a.inicio BETWEEN p_inicio AND p_fim)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_dashboard_periodo(text, date, date) TO anon, authenticated;

COMMIT;
