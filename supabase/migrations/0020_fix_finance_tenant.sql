-- Corrige o tenant das contas administrativas legadas e evita empresa_id nulo nas RPCs financeiras.
-- O fallback só é usado para usuários sem empresa vinculada; não altera tenants já definidos.

update public.funcionarios
set empresa_id = '00000000-0000-0000-0000-000000000001'
where empresa_id is null;

update public.usuarios u
set empresa_id = coalesce(u.empresa_id, f.empresa_id, '00000000-0000-0000-0000-000000000001'::uuid),
    updated_at = now()
from public.funcionarios f
where f.id = u.funcionario_id
  and u.empresa_id is null;

create or replace function public.app_tenant_usuario(p_token text)
returns table(usuario_id uuid, empresa_id uuid, funcionario_id uuid, perfil text)
language sql
security definer
set search_path=public,extensions
as $$
  select
    u.id,
    coalesce(u.empresa_id, f.empresa_id, '00000000-0000-0000-0000-000000000001'::uuid) as empresa_id,
    u.funcionario_id,
    u.perfil
  from public.sessoes s
  join public.usuarios u on u.id = s.usuario_id
  left join public.funcionarios f on f.id = u.funcionario_id
  where s.token = p_token
    and s.expira_em > now()
    and u.ativo = true
  limit 1;
$$;

grant execute on function public.app_tenant_usuario(text) to anon, authenticated;
