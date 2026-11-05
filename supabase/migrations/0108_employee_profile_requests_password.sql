BEGIN;

ALTER TABLE public.rh_solicitacoes
  ADD COLUMN IF NOT EXISTS dados_alteracao jsonb;

-- Perfil próprio: o vínculo vem exclusivamente da sessão autenticada.
CREATE OR REPLACE FUNCTION public.app_meu_perfil(p_token text)
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
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão sem vínculo de funcionário');
  END IF;

  SELECT to_jsonb(f) - 'empresa_id' - 'created_at' - 'updated_at'
    INTO v_result
  FROM public.funcionarios f
  WHERE f.id = v.funcionario_id AND f.empresa_id = v.empresa_id
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'funcionario', v_result);
END;
$$;

-- A edição da ficha completa é reaproveitada; valor_diaria é validado e salvo na mesma transação.
CREATE OR REPLACE FUNCTION public.app_admin_atualizar_ficha_com_diaria(
  p_token text,
  p_funcionario_id uuid,
  p_dados jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_tipo_vinculo text;
  v_daily numeric;
  v_salary numeric;
  v_result jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR p_funcionario_id IS NULL OR jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou dados da ficha inválidos');
  END IF;

  SELECT f.tipo_vinculo INTO v_tipo_vinculo
  FROM public.funcionarios f WHERE f.id = p_funcionario_id AND f.empresa_id = v.empresa_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado nesta empresa'); END IF;

  v_daily := nullif(btrim(p_dados->>'valor_diaria'), '')::numeric;
  v_salary := nullif(btrim(p_dados->>'salario'), '')::numeric;
  IF v_tipo_vinculo = 'diarista' AND (coalesce(v_daily, 0) <= 0 OR coalesce(v_salary, 0) > 0) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Para diarista, informe uma diária maior que zero e não informe salário mensal');
  END IF;
  IF v_tipo_vinculo IS DISTINCT FROM 'diarista' AND coalesce(v_daily, 0) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O valor da diária só pode ser informado para vínculo diarista');
  END IF;

  v_result := public.app_admin_atualizar_funcionario(p_token, p_funcionario_id, p_dados);
  IF coalesce(v_result->>'sucesso', 'false') <> 'true' THEN RETURN v_result; END IF;

  IF v_tipo_vinculo = 'diarista' THEN
    UPDATE public.funcionarios SET valor_diaria = v_daily, updated_at = now()
    WHERE id = p_funcionario_id AND empresa_id = v.empresa_id;
  END IF;
  RETURN v_result;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Verifique o formato do valor da diária');
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_ficha_completa(p_token text, p_funcionario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_funcionario jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR p_funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão ou funcionário inválido');
  END IF;

  SELECT to_jsonb(f) - 'empresa_id' - 'created_at' - 'updated_at'
    INTO v_funcionario
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id AND f.empresa_id = v.empresa_id
  LIMIT 1;
  IF v_funcionario IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado nesta empresa');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'funcionario', v_funcionario);
END;
$$;

-- Pedidos cadastrais específicos: só campos de contato/endereço e beneficiários.
CREATE OR REPLACE FUNCTION public.app_criar_solicitacao_alteracao_cadastral(
  p_token text,
  p_campo text,
  p_novo_valor text,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_funcionario public.funcionarios%ROWTYPE;
  v_campo text := lower(btrim(coalesce(p_campo, '')));
  v_valor text := nullif(btrim(coalesce(p_novo_valor, '')), '');
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_atual text;
  v_rotulo text;
  v_id uuid;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.self.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida ou sem permissão para solicitar ao RH');
  END IF;
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Usuário sem vínculo de funcionário');
  END IF;
  IF v_campo NOT IN ('endereco', 'cep', 'telefone_residencial', 'telefone_celular', 'beneficiarios') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Campo cadastral não permitido para solicitação');
  END IF;
  IF v_valor IS NULL OR char_length(v_valor) > (CASE v_campo WHEN 'endereco' THEN 1000 WHEN 'beneficiarios' THEN 2500 WHEN 'cep' THEN 9 ELSE 20 END) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um valor válido dentro do limite permitido');
  END IF;
  IF char_length(v_motivo) < 10 OR char_length(v_motivo) > 1500 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Explique o motivo em 10 a 1.500 caracteres');
  END IF;

  SELECT * INTO v_funcionario FROM public.funcionarios f
  WHERE f.id = v.funcionario_id AND f.empresa_id = v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado'); END IF;

  CASE v_campo
    WHEN 'endereco' THEN v_atual := v_funcionario.endereco; v_rotulo := 'Endereço residencial';
    WHEN 'cep' THEN v_atual := v_funcionario.cep; v_rotulo := 'CEP';
    WHEN 'telefone_residencial' THEN v_atual := v_funcionario.telefone_residencial; v_rotulo := 'Telefone residencial';
    WHEN 'telefone_celular' THEN v_atual := v_funcionario.telefone_celular; v_rotulo := 'Telefone celular';
    WHEN 'beneficiarios' THEN v_atual := v_funcionario.beneficiarios; v_rotulo := 'Beneficiários';
  END CASE;
  IF v_atual IS NOT DISTINCT FROM v_valor THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'O novo valor é igual ao que já consta no cadastro');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rh_solicitacoes s
    WHERE s.funcionario_id = v.funcionario_id AND s.empresa_id = v.empresa_id
      AND s.dados_alteracao->>'campo' = v_campo
      AND s.status IN ('pendente', 'aberta', 'nova', 'em_analise')
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Já existe uma solicitação aberta para esse campo');
  END IF;

  INSERT INTO public.rh_solicitacoes (funcionario_id, empresa_id, tipo, descricao, status, dados_alteracao)
  VALUES (
    v.funcionario_id, v.empresa_id, 'Correção cadastral',
    'Alteração solicitada: ' || v_rotulo || E'\nValor proposto: ' || v_valor || E'\nMotivo informado: ' || v_motivo,
    'pendente',
    jsonb_build_object('campo', v_campo, 'rotulo', v_rotulo, 'valor_atual', v_atual, 'valor_proposto', v_valor)
  ) RETURNING id INTO v_id;

  INSERT INTO public.rh_solicitacoes_auditoria (
    solicitacao_id, funcionario_id, empresa_id, actor_usuario_id, actor_role,
    evento, status_anterior, status_novo, comentario
  ) VALUES (
    v_id, v.funcionario_id, v.empresa_id, v.usuario_id,
    COALESCE(public.app_role_code_for_user(v.usuario_id), 'funcionario'),
    'solicitacao_aberta', NULL, 'pendente', 'Alteração cadastral proposta: ' || v_rotulo
  );
  RETURN jsonb_build_object('sucesso', true, 'id', v_id, 'status', 'pendente');
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_listar_alteracoes_cadastrais(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR NOT public.app_tem_permissao(p_token, 'requests.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY CASE WHEN q.status IN ('pendente', 'aberta', 'nova', 'em_analise') THEN 0 ELSE 1 END, q.created_at DESC, q.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT s.id, s.funcionario_id, f.nome, s.status, s.descricao, s.resposta,
      s.dados_alteracao, s.created_at, s.updated_at
    FROM public.rh_solicitacoes s
    JOIN public.funcionarios f ON f.id = s.funcionario_id AND f.empresa_id = v.empresa_id
    WHERE s.empresa_id = v.empresa_id
      AND s.dados_alteracao IS NOT NULL
    ORDER BY CASE WHEN s.status IN ('pendente', 'aberta', 'nova', 'em_analise') THEN 0 ELSE 1 END, s.created_at DESC, s.id DESC
    LIMIT 200
  ) q;
  RETURN jsonb_build_object('sucesso', true, 'solicitacoes', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_admin_decidir_alteracao_cadastral(
  p_token text,
  p_id uuid,
  p_status text,
  p_resposta text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_usuario_id uuid;
  v_empresa_id uuid;
  v_funcionario record;
  v_request public.rh_solicitacoes%ROWTYPE;
  v_current text;
  v_campo text;
  v_novo text;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_resposta text := nullif(btrim(coalesce(p_resposta, '')), '');
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR NOT public.app_tem_permissao(p_token, 'requests.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  v_usuario_id := v.usuario_id;
  v_empresa_id := v.empresa_id;
  IF p_id IS NULL OR v_status NOT IN ('atendida', 'recusada') OR char_length(coalesce(v_resposta, '')) < 5 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma decisão válida e uma resposta de pelo menos 5 caracteres');
  END IF;

  SELECT * INTO v_request FROM public.rh_solicitacoes s
  WHERE s.id = p_id AND s.empresa_id = v_empresa_id AND s.dados_alteracao IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação cadastral não encontrada'); END IF;
  IF v_request.status NOT IN ('pendente', 'aberta', 'nova', 'em_analise') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Esta solicitação já foi decidida');
  END IF;
  v_campo := v_request.dados_alteracao->>'campo';
  v_novo := v_request.dados_alteracao->>'valor_proposto';
  IF v_campo NOT IN ('endereco', 'cep', 'telefone_residencial', 'telefone_celular', 'beneficiarios') OR v_novo IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Os dados da solicitação não são válidos');
  END IF;

  SELECT * INTO v_funcionario FROM public.funcionarios f
  WHERE f.id = v_request.funcionario_id AND f.empresa_id = v_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado nesta empresa'); END IF;

  CASE v_campo
    WHEN 'endereco' THEN v_current := v_funcionario.endereco;
    WHEN 'cep' THEN v_current := v_funcionario.cep;
    WHEN 'telefone_residencial' THEN v_current := v_funcionario.telefone_residencial;
    WHEN 'telefone_celular' THEN v_current := v_funcionario.telefone_celular;
    WHEN 'beneficiarios' THEN v_current := v_funcionario.beneficiarios;
  END CASE;
  IF v_status = 'atendida' THEN
    IF v_current IS DISTINCT FROM (v_request.dados_alteracao->>'valor_atual') THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'O cadastro mudou desde o pedido. Recarregue a ficha e peça uma nova alteração para evitar sobrescrever dados atuais.');
    END IF;
    EXECUTE format('UPDATE public.funcionarios SET %I = $1, updated_at = now() WHERE id = $2 AND empresa_id = $3', v_campo)
      USING v_novo, v_request.funcionario_id, v_empresa_id;
  END IF;

  UPDATE public.rh_solicitacoes SET status = v_status, resposta = v_resposta,
    analisado_por = v_usuario_id, analisado_em = now(), updated_at = now()
  WHERE id = p_id AND empresa_id = v_empresa_id;
  INSERT INTO public.rh_solicitacoes_auditoria (
    solicitacao_id, funcionario_id, empresa_id, actor_usuario_id, actor_role,
    evento, status_anterior, status_novo, comentario
  ) VALUES (
    p_id, v_request.funcionario_id, v_empresa_id, v_usuario_id,
    COALESCE(public.app_role_code_for_user(v_usuario_id), 'administrativo'),
    CASE WHEN v_status = 'atendida' THEN 'alteracao_cadastral_aprovada' ELSE 'alteracao_cadastral_recusada' END,
    v_request.status, v_status, v_resposta
  );
  RETURN jsonb_build_object('sucesso', true, 'status', v_status);
END;
$$;

-- Impede que a resposta genérica marque uma alteração estruturada como atendida sem aplicar o novo valor.
CREATE OR REPLACE FUNCTION public.app_admin_responder_solicitacao(
  p_token text,
  p_id uuid,
  p_status text,
  p_resposta text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_usuario_id uuid;
  v_empresa_id uuid;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_resposta text := NULLIF(btrim(COALESCE(p_resposta, '')), '');
  v_current record;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'requests.manage') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  SELECT usuario_id INTO v_usuario_id FROM public.app_usuario_por_token(p_token) LIMIT 1;
  v_empresa_id := public.app_empresa_unica();
  IF p_id IS NULL OR v_status NOT IN ('pendente', 'em_analise', 'atendida', 'recusada', 'cancelada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação ou status inválido');
  END IF;
  IF v_status IN ('atendida', 'recusada') AND char_length(COALESCE(v_resposta, '')) < 5 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma resposta de pelo menos 5 caracteres para concluir ou recusar');
  END IF;
  IF EXISTS (SELECT 1 FROM public.rh_solicitacoes s WHERE s.id = p_id AND s.empresa_id = v_empresa_id AND s.dados_alteracao IS NOT NULL) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Use a decisão específica de alteração cadastral para aplicar o valor proposto');
  END IF;

  SELECT s.funcionario_id, s.empresa_id, s.status, s.resposta INTO v_current
  FROM public.rh_solicitacoes s WHERE s.id = p_id AND s.empresa_id = v_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação não encontrada nesta empresa'); END IF;
  UPDATE public.rh_solicitacoes SET status = v_status, resposta = COALESCE(v_resposta, v_current.resposta),
    analisado_por = v_usuario_id, analisado_em = now(), updated_at = now()
  WHERE id = p_id AND empresa_id = v_empresa_id;
  IF v_current.status IS DISTINCT FROM v_status OR (v_resposta IS NOT NULL AND v_current.resposta IS DISTINCT FROM v_resposta) THEN
    INSERT INTO public.rh_solicitacoes_auditoria (
      solicitacao_id, funcionario_id, empresa_id, actor_usuario_id, actor_role,
      evento, status_anterior, status_novo, comentario
    ) VALUES (
      p_id, v_current.funcionario_id, v_empresa_id, v_usuario_id,
      COALESCE(public.app_role_code_for_user(v_usuario_id), 'administrativo'),
      CASE WHEN v_current.status IS DISTINCT FROM v_status THEN 'status_alterado' ELSE 'resposta_atualizada' END,
      v_current.status, v_status, COALESCE(v_resposta, v_current.resposta)
    );
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'status', v_status);
END;
$$;

-- Troca voluntária com verificação da senha atual; o fluxo de primeiro acesso permanece separado.
CREATE OR REPLACE FUNCTION public.app_alterar_senha(
  p_token text,
  p_senha_atual text,
  p_nova_senha text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_senha_hash text;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); END IF;
  IF length(coalesce(p_nova_senha, '')) < 8 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A nova senha deve ter pelo menos 8 caracteres');
  END IF;
  IF p_nova_senha IS DISTINCT FROM p_senha_atual THEN
    SELECT senha_hash INTO v_senha_hash FROM public.usuarios WHERE id = v.usuario_id LIMIT 1;
    IF v_senha_hash IS NULL OR crypt(coalesce(p_senha_atual, ''), v_senha_hash) <> v_senha_hash THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'A senha atual não confere');
    END IF;
  ELSE
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A nova senha deve ser diferente da senha atual');
  END IF;
  UPDATE public.usuarios SET senha_hash = crypt(p_nova_senha, gen_salt('bf')), primeiro_acesso = false, updated_at = now()
  WHERE id = v.usuario_id;
  INSERT INTO public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  VALUES (v.usuario_id, 'alterou_senha_autenticada', 'usuarios', '{}'::jsonb);
  RETURN jsonb_build_object('sucesso', true);
END;
$$;

REVOKE ALL ON FUNCTION public.app_admin_atualizar_ficha_com_diaria(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_ficha_completa(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_criar_solicitacao_alteracao_cadastral(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_listar_alteracoes_cadastrais(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_decidir_alteracao_cadastral(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_alterar_senha(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_ficha_com_diaria(text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_ficha_completa(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_criar_solicitacao_alteracao_cadastral(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_listar_alteracoes_cadastrais(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_decidir_alteracao_cadastral(text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_alterar_senha(text, text, text) TO anon, authenticated;

COMMIT;
