begin;

create or replace function public.app_admin_listar_lancamentos_folha(
  p_token text,
  p_tipo text default 'todos',
  p_funcionario_id uuid default null,
  p_competencia date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v record;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  return jsonb_build_object(
    'sucesso', true,
    'beneficios', case when p_tipo in ('todos','beneficio') then coalesce((select jsonb_agg(to_jsonb(x) order by x.competencia desc, x.created_at desc) from (select b.id,b.funcionario_id,f.nome,b.beneficio_nome,b.competencia,b.valor,b.status,b.motivo,b.observacoes,b.created_at from public.rh_beneficios_lancamentos b join public.funcionarios f on f.id=b.funcionario_id and f.empresa_id=v.empresa_id where b.empresa_id=v.empresa_id and (p_funcionario_id is null or b.funcionario_id=p_funcionario_id) and (p_competencia is null or date_trunc('month',b.competencia)=date_trunc('month',p_competencia)) order by b.competencia desc,b.created_at desc limit 200)x),'[]'::jsonb) else '[]'::jsonb end,
    'descontos', case when p_tipo in ('todos','desconto') then coalesce((select jsonb_agg(to_jsonb(x) order by x.competencia desc, x.created_at desc) from (select d.id,d.funcionario_id,f.nome,d.tipo,d.descricao,d.competencia,d.valor,d.status,d.observacoes,d.created_at from public.rh_descontos_lancamentos d join public.funcionarios f on f.id=d.funcionario_id and f.empresa_id=v.empresa_id where d.empresa_id=v.empresa_id and (p_funcionario_id is null or d.funcionario_id=p_funcionario_id) and (p_competencia is null or date_trunc('month',d.competencia)=date_trunc('month',p_competencia)) order by d.competencia desc,d.created_at desc limit 200)x),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

grant execute on function public.app_admin_listar_lancamentos_folha(text,text,uuid,date) to anon, authenticated;

create or replace function public.app_admin_lancar_beneficio(
  p_token text, p_funcionario_id uuid, p_beneficio_nome text, p_competencia date, p_valor numeric default null, p_status text default 'liberado', p_motivo text default null, p_observacoes text default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if trim(coalesce(p_beneficio_nome,''))='' or p_competencia is null then return jsonb_build_object('sucesso',false,'erro','Benefício e competência são obrigatórios'); end if;
  if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id) then return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado'); end if;
  insert into public.rh_beneficios_lancamentos(empresa_id,funcionario_id,beneficio_nome,competencia,valor,status,motivo,observacoes) values(v.empresa_id,p_funcionario_id,trim(p_beneficio_nome),date_trunc('month',p_competencia)::date,p_valor,coalesce(nullif(trim(p_status),''),'liberado'),nullif(trim(p_motivo),''),nullif(trim(p_observacoes),'')) returning id into v_id;
  insert into public.funcionario_timeline(empresa_id,funcionario_id,evento,descricao,origem,created_by) values(v.empresa_id,p_funcionario_id,'Benefício lançado',trim(p_beneficio_nome)||' · competência '||to_char(p_competencia,'MM/YYYY'),'folha',v.usuario_id);
  return jsonb_build_object('sucesso',true,'id',v_id);
end; $$;
grant execute on function public.app_admin_lancar_beneficio(text,uuid,text,date,numeric,text,text,text) to anon,authenticated;

create or replace function public.app_admin_lancar_desconto(
  p_token text, p_funcionario_id uuid, p_tipo text, p_descricao text, p_competencia date, p_valor numeric, p_status text default 'lancado', p_observacoes text default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if trim(coalesce(p_tipo,''))='' or trim(coalesce(p_descricao,''))='' or p_competencia is null or p_valor is null or p_valor < 0 then return jsonb_build_object('sucesso',false,'erro','Tipo, descrição, competência e valor válido são obrigatórios'); end if;
  if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id) then return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado'); end if;
  insert into public.rh_descontos_lancamentos(empresa_id,funcionario_id,tipo,descricao,competencia,valor,status,observacoes) values(v.empresa_id,p_funcionario_id,trim(p_tipo),trim(p_descricao),date_trunc('month',p_competencia)::date,p_valor,coalesce(nullif(trim(p_status),''),'lancado'),nullif(trim(p_observacoes),'')) returning id into v_id;
  insert into public.funcionario_timeline(empresa_id,funcionario_id,evento,descricao,origem,created_by) values(v.empresa_id,p_funcionario_id,'Desconto lançado',trim(p_descricao)||' · competência '||to_char(p_competencia,'MM/YYYY'),'folha',v.usuario_id);
  return jsonb_build_object('sucesso',true,'id',v_id);
end; $$;
grant execute on function public.app_admin_lancar_desconto(text,uuid,text,text,date,numeric,text,text) to anon,authenticated;

commit;
