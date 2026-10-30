-- Fase 4 RH: ciclo de vida do vínculo empregatício.
alter table public.funcionarios add column if not exists data_demissao date;
alter table public.funcionarios add column if not exists motivo_demissao text;

create or replace function public.app_admin_registrar_admissao(
  p_token text, p_funcionario_id uuid, p_data_admissao date,
  p_tipo_vinculo text default null, p_cargo text default null,
  p_valor_mensal numeric default null, p_valor_diaria numeric default null,
  p_registrado boolean default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_func public.funcionarios%rowtype; v_reg boolean;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  select * into v_func from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id limit 1;
  if v_func.id is null then return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado'); end if;
  if p_data_admissao is null then return jsonb_build_object('sucesso',false,'erro','Informe a data de admissão'); end if;
  v_reg:=coalesce(p_registrado,coalesce(nullif(p_tipo_vinculo,''),v_func.tipo_vinculo)='formal');
  update public.funcionarios set data_admissao=p_data_admissao,data_demissao=null,motivo_demissao=null,ativo=true,
    tipo_vinculo=coalesce(nullif(trim(p_tipo_vinculo),''),tipo_vinculo),cargo=coalesce(nullif(trim(p_cargo),''),cargo),
    salario=coalesce(p_valor_mensal,p_valor_diaria,salario),valor_mensal=coalesce(p_valor_mensal,valor_mensal),valor_diaria=coalesce(p_valor_diaria,valor_diaria),
    registrado=v_reg,elegivel_holerite=v_reg,elegivel_escritorio=v_reg
    where id=p_funcionario_id and empresa_id=v.empresa_id;
  update public.usuarios set ativo=true where funcionario_id=p_funcionario_id and empresa_id=v.empresa_id;
  insert into public.funcionario_timeline(empresa_id,funcionario_id,evento,descricao,origem,created_by)
  values(v.empresa_id,p_funcionario_id,'Admissão registrada','Vínculo admitido em '||to_char(p_data_admissao,'DD/MM/YYYY'),'rh',v.usuario_id);
  return jsonb_build_object('sucesso',true,'funcionario_id',p_funcionario_id);
end; $$;

create or replace function public.app_admin_demitir_funcionario(p_token text,p_funcionario_id uuid,p_data_demissao date,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_func public.funcionarios%rowtype;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  select * into v_func from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id limit 1;
  if v_func.id is null then return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado'); end if;
  if p_data_demissao is null then return jsonb_build_object('sucesso',false,'erro','Informe a data de demissão'); end if;
  if v_func.data_admissao is not null and p_data_demissao < v_func.data_admissao then return jsonb_build_object('sucesso',false,'erro','A demissão não pode ser anterior à admissão'); end if;
  if nullif(trim(p_motivo),'') is null then return jsonb_build_object('sucesso',false,'erro','Informe o motivo da demissão'); end if;
  update public.funcionarios set ativo=false,data_demissao=p_data_demissao,motivo_demissao=trim(p_motivo) where id=p_funcionario_id and empresa_id=v.empresa_id;
  update public.usuarios set ativo=false where funcionario_id=p_funcionario_id and empresa_id=v.empresa_id;
  delete from public.sessoes where usuario_id in (select id from public.usuarios where funcionario_id=p_funcionario_id and empresa_id=v.empresa_id);
  insert into public.funcionario_timeline(empresa_id,funcionario_id,evento,descricao,origem,created_by)
  values(v.empresa_id,p_funcionario_id,'Demissão registrada','Desligamento em '||to_char(p_data_demissao,'DD/MM/YYYY')||' · '||trim(p_motivo),'rh',v.usuario_id);
  return jsonb_build_object('sucesso',true,'funcionario_id',p_funcionario_id);
end; $$;

create or replace function public.app_admin_reintegrar_funcionario(p_token text,p_funcionario_id uuid,p_data_admissao date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_func public.funcionarios%rowtype;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  select * into v_func from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id limit 1;
  if v_func.id is null then return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado'); end if;
  if p_data_admissao is null then return jsonb_build_object('sucesso',false,'erro','Informe a nova data de admissão'); end if;
  update public.funcionarios set ativo=true,data_admissao=p_data_admissao,data_demissao=null,motivo_demissao=null where id=p_funcionario_id and empresa_id=v.empresa_id;
  update public.usuarios set ativo=true,primeiro_acesso=true where funcionario_id=p_funcionario_id and empresa_id=v.empresa_id;
  insert into public.funcionario_timeline(empresa_id,funcionario_id,evento,descricao,origem,created_by)
  values(v.empresa_id,p_funcionario_id,'Reintegração registrada','Novo vínculo ativo desde '||to_char(p_data_admissao,'DD/MM/YYYY'),'rh',v.usuario_id);
  return jsonb_build_object('sucesso',true,'funcionario_id',p_funcionario_id);
end; $$;

-- Mantém a listagem administrativa compatível e expõe os dados de desligamento.
drop function if exists public.app_listar_funcionarios(text);
create function public.app_listar_funcionarios(p_token text)
returns table(id uuid,nome text,cpf text,cargo text,data_admissao date,data_demissao date,motivo_demissao text,tipo_vinculo text,salario numeric,ativo boolean,perfil text,avatar_url text,situacao text)
language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text;
begin
  select au.perfil into v_perfil from public.app_usuario_por_token(p_token) au limit 1;
  if v_perfil not in ('admin','administrador','gestor') then return; end if;
  return query select f.id,f.nome::text,f.cpf::text,f.cargo::text,f.data_admissao,f.data_demissao,f.motivo_demissao,f.tipo_vinculo::text,f.salario, f.ativo,coalesce(u.perfil,'funcionario')::text,f.avatar_url::text,
    case when not f.ativo then 'Inativo' when exists(select 1 from public.rh_afastamentos a where a.funcionario_id=f.id and a.status='ativo' and a.inicio<=current_date and (a.fim is null or a.fim>=current_date)) then 'Afastado' when exists(select 1 from public.rh_ferias fer where fer.funcionario_id=f.id and fer.status in ('agendada','em_gozo') and fer.inicio<=current_date and (fer.fim is null or fer.fim>=current_date)) then 'Em férias' else 'Trabalhando' end::text
    from public.funcionarios f left join public.usuarios u on u.funcionario_id=f.id order by f.ativo desc,f.nome limit 500;
end; $$;
grant execute on function public.app_admin_registrar_admissao(text,uuid,date,text,text,numeric,numeric,boolean) to anon,authenticated;
grant execute on function public.app_admin_demitir_funcionario(text,uuid,date,text) to anon,authenticated;
grant execute on function public.app_admin_reintegrar_funcionario(text,uuid,date) to anon,authenticated;
grant execute on function public.app_listar_funcionarios(text) to anon,authenticated;
