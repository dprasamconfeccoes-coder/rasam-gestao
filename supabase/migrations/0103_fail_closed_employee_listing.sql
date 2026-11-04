BEGIN;

-- Não transformar sessão inválida/perfil sem permissão em uma lista vazia que pareça válida.
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
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
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

COMMIT;
