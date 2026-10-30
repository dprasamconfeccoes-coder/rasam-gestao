-- Fail closed: invalid or expired custom session tokens must never be treated
-- as a NULL profile by RPCs that rely on these helpers.
-- Public RPC names and grants remain unchanged; valid-session behavior is kept.

CREATE OR REPLACE FUNCTION public.app_usuario_por_token(p_token text)
RETURNS TABLE(
  usuario_id uuid,
  funcionario_id uuid,
  perfil text,
  nome text,
  cargo text,
  cpf text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.funcionario_id,
    public.app_legacy_profile_for_role(public.app_role_code_for_user(u.id)),
    coalesce(f.nome, u.nome_exibicao, 'Usuário administrativo'),
    coalesce(f.cargo, ''),
    coalesce(f.cpf, u.cpf)
  FROM public.sessoes s
  JOIN public.usuarios u ON u.id = s.usuario_id
  LEFT JOIN public.funcionarios f ON f.id = u.funcionario_id
  WHERE s.token = p_token
    AND s.expira_em > now()
    AND u.ativo = true
    AND (
      public.app_role_code_for_user(u.id) <> 'funcionario'
      OR (f.id IS NOT NULL AND f.ativo = true)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_tenant_usuario(p_token text)
RETURNS TABLE(
  usuario_id uuid,
  empresa_id uuid,
  funcionario_id uuid,
  perfil text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    public.app_empresa_unica(),
    u.funcionario_id,
    public.app_legacy_profile_for_role(public.app_role_code_for_user(u.id))
  FROM public.sessoes s
  JOIN public.usuarios u ON u.id = s.usuario_id
  WHERE s.token = p_token
    AND s.expira_em > now()
    AND u.ativo = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '28000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_logout(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;

  DELETE FROM public.sessoes
  WHERE token = p_token
    AND expira_em > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  END IF;

  RETURN jsonb_build_object('sucesso', true);
END;
$function$;
