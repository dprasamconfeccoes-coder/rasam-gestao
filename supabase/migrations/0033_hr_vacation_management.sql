-- Fase 2 RH: gestão administrativa de férias com escopo por empresa.
create or replace function public.app_admin_listar_ferias(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_rows jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador');
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.inicio nulls last, x.nome), '[]'::jsonb)
    into v_rows
  from (
    select r.id, r.funcionario_id, f.nome, f.cpf, f.cargo,
           r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim,
           r.inicio, r.fim, r.status, r.observacoes,
           r.created_at, r.updated_at
      from public.rh_ferias r
      join public.funcionarios f on f.id = r.funcionario_id
     where r.empresa_id = v.empresa_id
     order by r.inicio nulls last, f.nome
     limit 1000
  ) x;
  return jsonb_build_object('sucesso',true,'ferias',v_rows);
end;
$$;

create or replace function public.app_admin_criar_ferias(
  p_token text,
  p_funcionario_id uuid,
  p_periodo_aquisitivo_inicio date,
  p_periodo_aquisitivo_fim date,
  p_inicio date,
  p_fim date,
  p_status text default 'agendada',
  p_observacoes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_id uuid;
  v_status text := coalesce(nullif(trim(p_status),''),'agendada');
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador');
  end if;
  if not exists (select 1 from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id) then
    return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado na empresa');
  end if;
  if p_periodo_aquisitivo_inicio is null or p_periodo_aquisitivo_fim is null or p_periodo_aquisitivo_inicio > p_periodo_aquisitivo_fim then
    return jsonb_build_object('sucesso',false,'erro','Informe um período aquisitivo válido');
  end if;
  if p_inicio is null or p_fim is null or p_inicio > p_fim then
    return jsonb_build_object('sucesso',false,'erro','Informe um período de férias válido');
  end if;
  if v_status not in ('agendada','em_gozo','concluida','cancelada') then
    return jsonb_build_object('sucesso',false,'erro','Status de férias inválido');
  end if;
  if v_status <> 'cancelada' and exists (
    select 1 from public.rh_ferias r
     where r.empresa_id=v.empresa_id and r.funcionario_id=p_funcionario_id
       and r.status <> 'cancelada' and r.inicio <= p_fim and r.fim >= p_inicio
  ) then
    return jsonb_build_object('sucesso',false,'erro','Já existe férias sobrepostas para este funcionário');
  end if;
  insert into public.rh_ferias(empresa_id,funcionario_id,periodo_aquisitivo_inicio,periodo_aquisitivo_fim,inicio,fim,status,observacoes)
  values(v.empresa_id,p_funcionario_id,p_periodo_aquisitivo_inicio,p_periodo_aquisitivo_fim,p_inicio,p_fim,v_status,nullif(trim(p_observacoes),''))
  returning id into v_id;
  return jsonb_build_object('sucesso',true,'id',v_id);
end;
$$;

create or replace function public.app_admin_atualizar_ferias(
  p_token text,
  p_id uuid,
  p_inicio date,
  p_fim date,
  p_status text,
  p_observacoes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_row public.rh_ferias%rowtype;
  v_status text := coalesce(nullif(trim(p_status),''),'agendada');
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador');
  end if;
  if p_inicio is null or p_fim is null or p_inicio > p_fim then
    return jsonb_build_object('sucesso',false,'erro','Informe um período de férias válido');
  end if;
  if v_status not in ('agendada','em_gozo','concluida','cancelada') then
    return jsonb_build_object('sucesso',false,'erro','Status de férias inválido');
  end if;
  select * into v_row from public.rh_ferias r where r.id=p_id and r.empresa_id=v.empresa_id limit 1;
  if v_row.id is null then
    return jsonb_build_object('sucesso',false,'erro','Período de férias não encontrado');
  end if;
  if v_status <> 'cancelada' and exists (
    select 1 from public.rh_ferias r
     where r.empresa_id=v.empresa_id and r.funcionario_id=v_row.funcionario_id and r.id<>p_id
       and r.status <> 'cancelada' and r.inicio <= p_fim and r.fim >= p_inicio
  ) then
    return jsonb_build_object('sucesso',false,'erro','Já existe férias sobrepostas para este funcionário');
  end if;
  update public.rh_ferias
     set inicio=p_inicio, fim=p_fim, status=v_status,
         observacoes=nullif(trim(p_observacoes),''), updated_at=now()
   where id=p_id and empresa_id=v.empresa_id;
  return jsonb_build_object('sucesso',true,'id',p_id);
end;
$$;
