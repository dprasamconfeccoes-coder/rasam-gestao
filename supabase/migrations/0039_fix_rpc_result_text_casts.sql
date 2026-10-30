-- Fix valid-session RPCs: SECURITY DEFINER helpers return explicit types matching
-- their RETURNS TABLE declarations. CREATE OR REPLACE preserves existing grants.

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
    u.id::uuid,
    u.funcionario_id::uuid,
    public.app_legacy_profile_for_role(public.app_role_code_for_user(u.id))::text,
    coalesce(f.nome, u.nome_exibicao, 'Usuário administrativo')::text,
    coalesce(f.cargo, '')::text,
    coalesce(f.cpf, u.cpf)::text
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
    u.id::uuid,
    public.app_empresa_unica()::uuid,
    u.funcionario_id::uuid,
    public.app_legacy_profile_for_role(public.app_role_code_for_user(u.id))::text
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
