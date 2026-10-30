-- Fluxo de atestados com CID, revisão auditável e acesso a anexos por URL assinada.
-- O CID é dado de saúde: só as RPCs de empregado e de revisão médica o projetam.

ALTER TABLE public.atestados
  ADD COLUMN IF NOT EXISTS cid text;

CREATE TABLE IF NOT EXISTS public.atestados_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atestado_id uuid NOT NULL REFERENCES public.atestados(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  evento text NOT NULL CHECK (evento IN ('enviado', 'aceito', 'recusado', 'registro_anterior')),
  status_anterior text,
  status_novo text NOT NULL,
  justificativa text,
  actor_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atestados_auditoria_atestado_created_idx
  ON public.atestados_auditoria (atestado_id, created_at);
CREATE INDEX IF NOT EXISTS atestados_auditoria_empresa_created_idx
  ON public.atestados_auditoria (empresa_id, created_at);

ALTER TABLE public.atestados_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.atestados_auditoria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.atestados FROM PUBLIC, anon, authenticated;

-- O bucket legado é privado, mas tinha policies que permitiam leitura e upload
-- a anon/authenticated para qualquer objeto. Novos arquivos usam Edge Functions
-- com service_role no bucket documentos-privados.
DROP POLICY IF EXISTS "Upload atestados 1stcshm_0" ON storage.objects;
DROP POLICY IF EXISTS "Leitura atestados 1stcshm_0" ON storage.objects;

-- Registros anteriores não tinham auditoria; marcar explicitamente a limitação,
-- sem inventar quem analisou nem reconstruir justificativas não registradas.
INSERT INTO public.atestados_auditoria (
  atestado_id, empresa_id, funcionario_id, evento, status_anterior, status_novo,
  justificativa, actor_usuario_id, actor_role, created_at
)
SELECT
  a.id,
  coalesce(a.empresa_id, f.empresa_id, public.app_empresa_unica()),
  a.funcionario_id,
  'registro_anterior',
  NULL,
  coalesce(a.status, 'pendente'),
  NULL,
  NULL,
  'historico_anterior',
  coalesce(a.created_at, now())
FROM public.atestados a
JOIN public.funcionarios f ON f.id = a.funcionario_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.atestados_auditoria x WHERE x.atestado_id = a.id
);

CREATE OR REPLACE FUNCTION public.salvar_atestado_v2(
  p_token text,
  p_tipo text,
  p_data_atendimento date,
  p_dias integer,
  p_observacao text,
  p_cid text,
  p_arquivo_url text,
  p_arquivo_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_empresa_id uuid;
  v_cid text;
  v_id uuid;
  v_actor_role text;
BEGIN
  SELECT * INTO v_usuario
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  IF v_usuario.usuario_id IS NULL OR v_usuario.funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A sessão não está vinculada a um funcionário');
  END IF;

  SELECT f.empresa_id INTO v_empresa_id
  FROM public.funcionarios f
  WHERE f.id = v_usuario.funcionario_id AND f.ativo = true
  LIMIT 1;

  IF v_empresa_id IS NULL OR v_empresa_id IS DISTINCT FROM public.app_empresa_unica() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado na empresa ativa');
  END IF;

  IF p_tipo IS NULL OR p_tipo NOT IN (
    'Atestado médico', 'Declaração de comparecimento',
    'Atestado de acompanhante', 'Justificativa', 'Outro'
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Tipo de documento inválido');
  END IF;

  IF p_data_atendimento IS NULL OR p_data_atendimento > current_date THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma data de consulta válida');
  END IF;

  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Os dias de afastamento devem estar entre 1 e 365');
  END IF;

  v_cid := nullif(upper(btrim(coalesce(p_cid, ''))), '');
  IF v_cid IS NOT NULL AND (
    length(v_cid) > 10 OR v_cid !~ '^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$'
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe um CID válido ou deixe em branco se não constar no documento');
  END IF;

  IF length(btrim(coalesce(p_observacao, ''))) > 1000 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A observação deve ter no máximo 1.000 caracteres');
  END IF;

  IF p_arquivo_url IS NULL
     OR length(p_arquivo_url) > 512
     OR (
       p_arquivo_url !~ ('^atestados/' || v_usuario.funcionario_id::text || '/[A-Za-z0-9_.-]{1,240}$')
       AND p_arquivo_url !~ ('^' || v_usuario.funcionario_id::text || '/[A-Za-z0-9_.-]{1,240}$')
     )
     OR p_arquivo_nome IS NULL
     OR length(btrim(p_arquivo_nome)) < 1
     OR length(p_arquivo_nome) > 255 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Referência de arquivo inválida');
  END IF;

  v_actor_role := public.app_role_code_for_user(v_usuario.usuario_id);

  INSERT INTO public.atestados (
    empresa_id, funcionario_id, tipo, data_atendimento, dias, cid,
    observacao, arquivo_url, arquivo_nome, status, status_label,
    observacao_rh, conferido_em, created_at, updated_at
  ) VALUES (
    v_empresa_id, v_usuario.funcionario_id, btrim(p_tipo), p_data_atendimento,
    p_dias, v_cid, nullif(btrim(coalesce(p_observacao, '')), ''),
    p_arquivo_url, btrim(p_arquivo_nome), 'aguardando',
    'Aguardando análise do RH', NULL, NULL, now(), now()
  ) RETURNING id INTO v_id;

  INSERT INTO public.atestados_auditoria (
    atestado_id, empresa_id, funcionario_id, evento, status_anterior,
    status_novo, actor_usuario_id, actor_role
  ) VALUES (
    v_id, v_empresa_id, v_usuario.funcionario_id, 'enviado', NULL,
    'aguardando', v_usuario.usuario_id, v_actor_role
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'atestado_id', v_id,
    'status', 'aguardando',
    'status_label', 'Aguardando análise do RH',
    'arquivo_nome', btrim(p_arquivo_nome)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_atestado_v2(text, text, date, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_atestado_v2(text, text, date, integer, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.salvar_atestado(
  p_token text,
  p_tipo text,
  p_data_atendimento date,
  p_dias integer,
  p_observacao text,
  p_arquivo_url text,
  p_arquivo_nome text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.salvar_atestado_v2(
    p_token, p_tipo, p_data_atendimento, p_dias, p_observacao,
    NULL, p_arquivo_url, p_arquivo_nome
  );
  RETURN v_result::json;
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_atestado(text, text, date, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_atestado(text, text, date, integer, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_listar_atestados(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_usuario
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  IF v_usuario.funcionario_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão não vinculada a um funcionário');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.id, a.tipo, a.data_atendimento, a.dias, a.cid, a.observacao,
      a.arquivo_url, a.arquivo_nome, a.status, a.status_label,
      a.observacao_rh, a.conferido_em, a.created_at,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'evento', ev.evento,
          'status_anterior', ev.status_anterior,
          'status_novo', ev.status_novo,
          'justificativa', ev.justificativa,
          'responsavel', CASE
            WHEN ev.evento = 'registro_anterior' THEN 'Registro anterior à auditoria'
            WHEN ev.actor_role = 'administrador_sistema' THEN 'Administrador do sistema'
            WHEN ev.actor_role = 'administrativo' THEN 'Administrador da empresa'
            WHEN ev.evento = 'enviado' THEN 'Funcionário'
            ELSE 'Recursos Humanos'
          END,
          'created_at', ev.created_at
        ) ORDER BY ev.created_at ASC, ev.id ASC)
        FROM public.atestados_auditoria ev
        WHERE ev.atestado_id = a.id
      ), '[]'::jsonb) AS timeline
    FROM public.atestados a
    WHERE a.funcionario_id = v_usuario.funcionario_id
    ORDER BY a.created_at DESC
    LIMIT 100
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'atestados', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_listar_atestados(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_atestados(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_empresa_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.app_tem_permissao(p_token, 'documents.medical.review') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  v_empresa_id := public.app_empresa_unica();

  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'prioridade' ORDER BY x.prioridade, x.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.id, a.funcionario_id, a.tipo, a.data_atendimento, a.dias, a.cid,
      a.observacao, a.arquivo_nome, a.status, a.status_label,
      a.observacao_rh, a.conferido_em, a.created_at,
      f.nome,
      CASE WHEN a.status IN ('aguardando', 'pendente') THEN 0 ELSE 1 END AS prioridade,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'evento', ev.evento,
          'status_anterior', ev.status_anterior,
          'status_novo', ev.status_novo,
          'justificativa', ev.justificativa,
          'responsavel', CASE
            WHEN ev.evento = 'registro_anterior' THEN 'Registro anterior à auditoria'
            WHEN ev.actor_role = 'administrador_sistema' THEN 'Administrador do sistema'
            WHEN ev.actor_role = 'administrativo' THEN 'Administrador da empresa'
            WHEN ev.evento = 'enviado' THEN 'Funcionário'
            ELSE 'Recursos Humanos'
          END,
          'created_at', ev.created_at
        ) ORDER BY ev.created_at ASC, ev.id ASC)
        FROM public.atestados_auditoria ev
        WHERE ev.atestado_id = a.id
      ), '[]'::jsonb) AS timeline
    FROM public.atestados a
    JOIN public.funcionarios f ON f.id = a.funcionario_id
    WHERE a.empresa_id = v_empresa_id
    ORDER BY CASE WHEN a.status IN ('aguardando', 'pendente') THEN 0 ELSE 1 END, a.created_at DESC
    LIMIT 500
  ) x;

  RETURN jsonb_build_object('sucesso', true, 'atestados', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_admin_atestados(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_decidir_atestado(
  p_token text, p_id uuid, p_status text, p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_empresa_id uuid;
  v_status_anterior text;
  v_actor_role text;
BEGIN
  SELECT * INTO v_usuario
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  IF NOT public.app_tem_permissao(p_token, 'documents.medical.review') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('aceito', 'recusado') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Escolha aceitar ou recusar o atestado');
  END IF;

  IF p_status = 'recusado' AND length(btrim(coalesce(p_observacao, ''))) < 5 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe uma justificativa de pelo menos 5 caracteres para recusar');
  END IF;

  v_empresa_id := public.app_empresa_unica();

  SELECT a.status INTO v_status_anterior
  FROM public.atestados a
  WHERE a.id = p_id AND a.empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Atestado não encontrado');
  END IF;

  IF v_status_anterior IS NULL OR v_status_anterior NOT IN ('aguardando', 'pendente') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Este atestado já foi analisado');
  END IF;

  v_actor_role := public.app_role_code_for_user(v_usuario.usuario_id);

  UPDATE public.atestados
  SET status = p_status,
      status_label = CASE WHEN p_status = 'aceito' THEN 'Aceito' ELSE 'Recusado' END,
      observacao_rh = nullif(btrim(coalesce(p_observacao, '')), ''),
      conferido_em = now(),
      updated_at = now()
  WHERE id = p_id AND empresa_id = v_empresa_id;

  INSERT INTO public.atestados_auditoria (
    atestado_id, empresa_id, funcionario_id, evento, status_anterior,
    status_novo, justificativa, actor_usuario_id, actor_role
  )
  SELECT a.id, a.empresa_id, a.funcionario_id, p_status, v_status_anterior,
         p_status, nullif(btrim(coalesce(p_observacao, '')), ''),
         v_usuario.usuario_id, v_actor_role
  FROM public.atestados a
  WHERE a.id = p_id AND a.empresa_id = v_empresa_id;

  RETURN jsonb_build_object('sucesso', true, 'status', p_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.app_admin_decidir_atestado(text, uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_atestado_documento_path(p_token text, p_atestado_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_usuario record;
  v_empresa_id uuid;
  v_atestado public.atestados%rowtype;
BEGIN
  SELECT * INTO v_usuario
  FROM public.app_usuario_por_token(p_token)
  LIMIT 1;

  v_empresa_id := public.app_empresa_unica();

  SELECT * INTO v_atestado
  FROM public.atestados a
  WHERE a.id = p_atestado_id AND a.empresa_id = v_empresa_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Atestado não encontrado');
  END IF;

  IF v_usuario.funcionario_id IS DISTINCT FROM v_atestado.funcionario_id
     AND NOT public.app_tem_permissao(p_token, 'documents.medical.review') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;

  IF v_atestado.arquivo_url IS NULL OR v_atestado.arquivo_url = '' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Arquivo não disponível');
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'caminho', v_atestado.arquivo_url,
    'arquivo_nome', v_atestado.arquivo_nome
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.app_atestado_documento_path(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_atestado_documento_path(text, uuid) TO service_role;


-- O prontuário genérico também é acessível a gestores sem a permissão de revisão
-- médica; remover CID da projeção ampla, mantendo-o somente nas RPCs autorizadas.
DO $migration$
DECLARE
  v_definition text;
  v_patched text;
BEGIN
  SELECT pg_get_functiondef('public.app_admin_prontuario(text,uuid)'::regprocedure)
  INTO v_definition;

  v_patched := replace(
    v_definition,
    'jsonb_agg(to_jsonb(a) order by a.created_at desc)',
    'jsonb_agg((to_jsonb(a) - ''cid'') order by a.created_at desc)'
  );

  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'Não foi possível localizar a projeção de atestados em app_admin_prontuario';
  END IF;

  EXECUTE v_patched;
END;
$migration$;
