-- Enriquecer a listagem administrativa com avatar persistido e situação operacional atual.
drop function if exists public.app_listar_funcionarios(text);

create or replace function public.app_listar_funcionarios(p_token text)
returns table(
  id uuid,
  nome text,
  cpf text,
  cargo text,
  data_admissao date,
  salario numeric,
  ativo boolean,
  perfil text,
  avatar_url text,
  situacao text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_perfil text;
begin
  select au.perfil into v_perfil from public.app_usuario_por_token(p_token) au limit 1;
  if v_perfil not in ('admin','administrador','gestor') then return; end if;

  return query
  select
    f.id,
    f.nome::text,
    f.cpf::text,
    f.cargo::text,
    f.data_admissao,
    f.salario,
    f.ativo,
    coalesce(u.perfil,'funcionario')::text,
    f.avatar_url::text,
    case
      when not f.ativo then 'Inativo'
      when exists (
        select 1 from public.rh_afastamentos a
         where a.funcionario_id = f.id
           and a.status = 'ativo'
           and a.inicio <= current_date
           and (a.fim is null or a.fim >= current_date)
      ) then 'Afastado'
      when exists (
        select 1 from public.rh_ferias fer
         where fer.funcionario_id = f.id
           and fer.status in ('agendada','em_gozo')
           and fer.inicio <= current_date
           and (fer.fim is null or fer.fim >= current_date)
      ) then 'Em férias'
      else 'Trabalhando'
    end::text
  from public.funcionarios f
  left join public.usuarios u on u.funcionario_id = f.id
  order by f.ativo desc, f.nome
  limit 500;
end;
$$;

grant execute on function public.app_listar_funcionarios(text) to anon, authenticated;
