begin;

create index if not exists idx_funcionarios_empresa_nome
  on public.funcionarios(empresa_id, lower(nome));
create index if not exists idx_funcionarios_empresa_cpf
  on public.funcionarios(empresa_id, cpf);
create index if not exists idx_funcionarios_empresa_salario
  on public.funcionarios(empresa_id, salario);

create or replace function public.app_admin_buscar_funcionarios(
  p_token text,
  p_busca text default null,
  p_situacao text default null,
  p_tipo_vinculo text default null,
  p_cargo text default null,
  p_salario_min numeric default null,
  p_salario_max numeric default null,
  p_offset integer default 0,
  p_limite integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_total integer := 0;
  v_registros jsonb := '[]'::jsonb;
  v_busca text := lower(btrim(coalesce(p_busca, '')));
  v_cpf text := regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g');
  v_situacao text := nullif(btrim(coalesce(p_situacao, '')), '');
  v_tipo text := nullif(btrim(coalesce(p_tipo_vinculo, '')), '');
  v_cargo text := lower(btrim(coalesce(p_cargo, '')));
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('gestor', 'administrador', 'admin') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado', 'registros', '[]'::jsonb, 'total', 0, 'offset', v_offset, 'limite', v_limite);
  end if;

  with base as (
    select f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao, f.data_demissao,
           f.motivo_demissao, f.tipo_vinculo::text, f.salario, f.ativo,
           coalesce(u.perfil, 'funcionario')::text as perfil, f.avatar_url::text,
           case
             when not f.ativo then 'Inativo'
             when exists (select 1 from public.rh_afastamentos a where a.funcionario_id = f.id and a.empresa_id = v.empresa_id and a.status = 'ativo' and a.inicio <= current_date and (a.fim is null or a.fim >= current_date)) then 'Afastado'
             when exists (select 1 from public.rh_ferias fer where fer.funcionario_id = f.id and fer.empresa_id = v.empresa_id and fer.status in ('agendada', 'em_gozo') and fer.inicio <= current_date and (fer.fim is null or fer.fim >= current_date)) then 'Em férias'
             else 'Trabalhando'
           end::text as situacao
      from public.funcionarios f
      left join public.usuarios u on u.funcionario_id = f.id and u.empresa_id = v.empresa_id
     where f.empresa_id = v.empresa_id
       and (v_busca = '' or lower(f.nome) like '%' || v_busca || '%' or lower(coalesce(f.cargo, '')) like '%' || v_busca || '%' or regexp_replace(f.cpf, '[^0-9]', '', 'g') like '%' || v_cpf || '%')
       and (v_situacao is null or (case when not f.ativo then 'Inativo' when exists (select 1 from public.rh_afastamentos a where a.funcionario_id = f.id and a.empresa_id = v.empresa_id and a.status = 'ativo' and a.inicio <= current_date and (a.fim is null or a.fim >= current_date)) then 'Afastado' when exists (select 1 from public.rh_ferias fer where fer.funcionario_id = f.id and fer.empresa_id = v.empresa_id and fer.status in ('agendada', 'em_gozo') and fer.inicio <= current_date and (fer.fim is null or fer.fim >= current_date)) then 'Em férias' else 'Trabalhando' end) = v_situacao)
       and (v_tipo is null or f.tipo_vinculo = v_tipo)
       and (v_cargo = '' or lower(coalesce(f.cargo, '')) like '%' || v_cargo || '%')
       and (p_salario_min is null or coalesce(f.salario, 0) >= p_salario_min)
       and (p_salario_max is null or coalesce(f.salario, 0) <= p_salario_max)
  )
  select count(*) into v_total from base;

  with base as (
    select f.id, f.nome::text, f.cpf::text, f.cargo::text, f.data_admissao, f.data_demissao,
           f.motivo_demissao, f.tipo_vinculo::text, f.salario, f.ativo,
           coalesce(u.perfil, 'funcionario')::text as perfil, f.avatar_url::text,
           case
             when not f.ativo then 'Inativo'
             when exists (select 1 from public.rh_afastamentos a where a.funcionario_id = f.id and a.empresa_id = v.empresa_id and a.status = 'ativo' and a.inicio <= current_date and (a.fim is null or a.fim >= current_date)) then 'Afastado'
             when exists (select 1 from public.rh_ferias fer where fer.funcionario_id = f.id and fer.empresa_id = v.empresa_id and fer.status in ('agendada', 'em_gozo') and fer.inicio <= current_date and (fer.fim is null or fer.fim >= current_date)) then 'Em férias'
             else 'Trabalhando'
           end::text as situacao
      from public.funcionarios f
      left join public.usuarios u on u.funcionario_id = f.id and u.empresa_id = v.empresa_id
     where f.empresa_id = v.empresa_id
       and (v_busca = '' or lower(f.nome) like '%' || v_busca || '%' or lower(coalesce(f.cargo, '')) like '%' || v_busca || '%' or regexp_replace(f.cpf, '[^0-9]', '', 'g') like '%' || v_cpf || '%')
       and (v_situacao is null or (case when not f.ativo then 'Inativo' when exists (select 1 from public.rh_afastamentos a where a.funcionario_id = f.id and a.empresa_id = v.empresa_id and a.status = 'ativo' and a.inicio <= current_date and (a.fim is null or a.fim >= current_date)) then 'Afastado' when exists (select 1 from public.rh_ferias fer where fer.funcionario_id = f.id and fer.empresa_id = v.empresa_id and fer.status in ('agendada', 'em_gozo') and fer.inicio <= current_date and (fer.fim is null or fer.fim >= current_date)) then 'Em férias' else 'Trabalhando' end) = v_situacao)
       and (v_tipo is null or f.tipo_vinculo = v_tipo)
       and (v_cargo = '' or lower(coalesce(f.cargo, '')) like '%' || v_cargo || '%')
       and (p_salario_min is null or coalesce(f.salario, 0) >= p_salario_min)
       and (p_salario_max is null or coalesce(f.salario, 0) <= p_salario_max)
     order by f.ativo desc, f.nome asc
     offset v_offset limit v_limite
  )
  select coalesce(jsonb_agg(to_jsonb(base) order by base.ativo desc, base.nome asc), '[]'::jsonb) into v_registros from base;

  return jsonb_build_object('sucesso', true, 'registros', v_registros, 'total', v_total, 'offset', v_offset, 'limite', v_limite);
end;
$$;

grant execute on function public.app_admin_buscar_funcionarios(text, text, text, text, text, numeric, numeric, integer, integer) to anon, authenticated;

commit;
