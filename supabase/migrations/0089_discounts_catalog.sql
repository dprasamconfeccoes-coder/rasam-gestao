begin;

create table if not exists public.rh_descontos_catalogo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_rh_descontos_catalogo_empresa_nome on public.rh_descontos_catalogo(empresa_id, lower(nome));
create index if not exists idx_rh_descontos_catalogo_busca on public.rh_descontos_catalogo(empresa_id, nome);
alter table public.rh_descontos_catalogo enable row level security;

create or replace function public.app_admin_buscar_descontos_catalogo(p_token text, p_busca text default '')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  return jsonb_build_object('sucesso',true,'descontos',coalesce((select jsonb_agg(to_jsonb(x) order by x.nome) from (select id,nome,descricao from public.rh_descontos_catalogo where empresa_id=v.empresa_id and ativo=true and (trim(coalesce(p_busca,''))='' or nome ilike '%'||trim(p_busca)||'%') order by nome limit 20)x),'[]'::jsonb));
end; $$;
grant execute on function public.app_admin_buscar_descontos_catalogo(text,text) to anon,authenticated;

create or replace function public.app_admin_cadastrar_desconto_catalogo(p_token text, p_nome text, p_descricao text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_item public.rh_descontos_catalogo;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if length(trim(coalesce(p_nome,''))) < 2 then return jsonb_build_object('sucesso',false,'erro','Informe um tipo de desconto'); end if;
  insert into public.rh_descontos_catalogo(empresa_id,nome,descricao) values(v.empresa_id,trim(p_nome),nullif(trim(p_descricao),'')) on conflict (empresa_id,lower(nome)) do update set ativo=true returning * into v_item;
  return jsonb_build_object('sucesso',true,'desconto',to_jsonb(v_item));
end; $$;
grant execute on function public.app_admin_cadastrar_desconto_catalogo(text,text,text) to anon,authenticated;

commit;
