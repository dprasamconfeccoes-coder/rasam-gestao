BEGIN;

CREATE OR REPLACE FUNCTION public.app_importar_extrato_ponto(p_token text, p_tipo text, p_competencia text, p_arquivo_nome text, p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $function$
DECLARE v_usuario record; v_importacao uuid; v_linha jsonb; v_funcionario_id uuid; v_nome text; v_total integer := 0; v_encontradas integer := 0; v_nao_encontradas integer := 0; v_inconsistentes integer := 0; v_achados jsonb := '[]'::jsonb; v_inconsistencia text;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL OR COALESCE(v_usuario.perfil, '') NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo'); END IF;
  IF p_tipo NOT IN ('extrato_diario','extrato_mensal') OR jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Extrato de ponto inválido'); END IF;
  IF jsonb_array_length(p_linhas) < 1 OR jsonb_array_length(p_linhas) > 5000 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'O extrato deve conter entre 1 e 5.000 linhas'); END IF;
  IF COALESCE(p_competencia, '') !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Competência inválida; use MM/AAAA'); END IF;
  INSERT INTO public.ponto_importacoes(empresa_id, tipo, competencia, arquivo_nome, imported_by, status) VALUES (v_usuario.empresa_id, p_tipo, p_competencia, COALESCE(NULLIF(BTRIM(p_arquivo_nome), ''), 'extrato-ponto.csv'), v_usuario.usuario_id, 'pendente') RETURNING id INTO v_importacao;
  FOR v_linha IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_total := v_total + 1; v_nome := COALESCE(NULLIF(BTRIM(v_linha->>'nome'), ''), 'Nome não informado'); v_funcionario_id := NULL; v_inconsistencia := NULL;
    SELECT f.id INTO v_funcionario_id FROM public.funcionarios f WHERE f.empresa_id = v_usuario.empresa_id AND f.ativo = true AND lower(translate(regexp_replace(trim(f.nome), '\s+', ' ', 'g'), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) = lower(translate(regexp_replace(trim(v_nome), '\s+', ' ', 'g'), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) ORDER BY f.id LIMIT 1;
    IF v_funcionario_id IS NULL THEN v_inconsistencia := 'Nome não localizado de forma única no cadastro ativo; confirme o funcionário antes de usar o resumo.'; v_nao_encontradas := v_nao_encontradas + 1; v_achados := v_achados || jsonb_build_array(v_nome); ELSE v_encontradas := v_encontradas + 1; END IF;
    IF v_linha->>'total_normais' IS NULL AND v_linha->>'total_noturno' IS NULL AND v_linha->>'dia_falta' IS NULL AND v_linha->>'horas_atraso' IS NULL AND v_linha->>'abono' IS NULL AND v_linha->>'extra_50' IS NULL AND v_linha->>'desconta_dsr' IS NULL THEN v_inconsistencia := COALESCE(v_inconsistencia || ' ', '') || 'Linha sem totais de ponto.'; v_inconsistentes := v_inconsistentes + 1; END IF;
    INSERT INTO public.ponto_import_resumos(empresa_id, importacao_id, funcionario_id, nome_csv, total_normais, total_noturno, dia_falta, horas_atraso, abono, extra_50, desconta_dsr, encontrado, inconsistencia, raw_data) VALUES (v_usuario.empresa_id, v_importacao, v_funcionario_id, v_nome, NULLIF(BTRIM(v_linha->>'total_normais'), ''), NULLIF(BTRIM(v_linha->>'total_noturno'), ''), NULLIF(BTRIM(v_linha->>'dia_falta'), ''), NULLIF(BTRIM(v_linha->>'horas_atraso'), ''), NULLIF(BTRIM(v_linha->>'abono'), ''), NULLIF(BTRIM(v_linha->>'extra_50'), ''), NULLIF(BTRIM(v_linha->>'desconta_dsr'), ''), v_funcionario_id IS NOT NULL, NULLIF(BTRIM(v_inconsistencia), ''), v_linha);
  END LOOP;
  UPDATE public.ponto_importacoes SET total_linhas = v_total, linhas_encontradas = v_encontradas, linhas_nao_encontradas = v_nao_encontradas, linhas_com_inconsistencia = v_inconsistentes, cpfs_nao_encontrados = v_achados WHERE id = v_importacao AND empresa_id = v_usuario.empresa_id;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes) VALUES (v_usuario.usuario_id, 'analisou_extrato_ponto', 'ponto_importacoes', jsonb_build_object('importacao_id', v_importacao, 'tipo', p_tipo, 'total_linhas', v_total, 'linhas_encontradas', v_encontradas, 'linhas_nao_encontradas', v_nao_encontradas, 'linhas_com_inconsistencia', v_inconsistentes));
  RETURN jsonb_build_object('sucesso', true, 'importacao_id', v_importacao, 'total_linhas', v_total, 'linhas_encontradas', v_encontradas, 'linhas_nao_encontradas', v_nao_encontradas, 'linhas_com_inconsistencia', v_inconsistentes, 'cpfs_nao_encontrados', v_achados);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_aplicar_importacao_extrato(p_token text, p_importacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $function$
DECLARE v_usuario record; v_importacao record; v_invalidas integer; v_nao_vinculadas integer;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR COALESCE(v_usuario.perfil, '') NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao painel administrativo'); END IF;
  SELECT * INTO v_importacao FROM public.ponto_importacoes WHERE id = p_importacao_id AND empresa_id = v_usuario.empresa_id FOR UPDATE;
  IF v_importacao.id IS NULL OR v_importacao.tipo NOT IN ('extrato_diario','extrato_mensal') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Resumo de ponto não encontrado'); END IF;
  IF v_importacao.status <> 'pendente' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Este resumo já foi processado'); END IF;
  SELECT count(*)::integer INTO v_invalidas FROM public.ponto_import_resumos WHERE importacao_id = p_importacao_id AND NULLIF(BTRIM(COALESCE(inconsistencia, '')), '') LIKE '%Linha sem totais%';
  IF v_invalidas > 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Há linhas sem totais de ponto. Corrija o arquivo e reimporte.', 'linhas_invalidas', v_invalidas); END IF;
  SELECT count(*)::integer INTO v_nao_vinculadas FROM public.ponto_import_resumos WHERE importacao_id = p_importacao_id AND NOT encontrado;
  UPDATE public.ponto_importacoes SET status = 'aplicada', applied_at = now(), applied_by = v_usuario.usuario_id WHERE id = p_importacao_id;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes) VALUES (v_usuario.usuario_id, 'aplicou_extrato_ponto', 'ponto_importacoes', jsonb_build_object('importacao_id', p_importacao_id, 'politica', 'resumo_sem_batidas', 'nomes_pendentes', v_nao_vinculadas));
  RETURN jsonb_build_object('sucesso', true, 'status', 'aplicada', 'linhas_aplicadas', v_importacao.total_linhas, 'nomes_pendentes', v_nao_vinculadas);
END;
$function$;

COMMIT;
