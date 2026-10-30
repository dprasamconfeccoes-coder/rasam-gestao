-- Métricas da importação e revisão de inconsistências diretamente na ficha de ponto.
create table if not exists public.ponto_inconsistencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  funcionario_id uuid not null references public.funcionarios(id),
  data date not null,
  tipo text not null default 'ponto',
  detalhe text,
  status text not null default 'pendente' check (status in ('pendente','aprovada','justificada')),
  justificativa text,
  analisado_por uuid references public.usuarios(id),
  analisado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funcionario_id, data, tipo)
);

create or replace function public.app_listar_ponto(
  p_token text,
  p_limite integer default 180,
  p_inicio date default null,
  p_fim date default null,
  p_funcionario_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_usuario record; v_result jsonb; v_global boolean; v_funcionario_id uuid;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null then return jsonb_build_object('sucesso',false,'erro','Sessão inválida'); end if;
  v_global := v_usuario.perfil in ('admin','administrador','gestor');
  if not v_global and p_funcionario_id is not null and p_funcionario_id <> v_usuario.funcionario_id then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao seu próprio ponto'); end if;
  v_funcionario_id := case when v_global then p_funcionario_id else v_usuario.funcionario_id end;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc,x.nome),'[]'::jsonb) into v_result
  from (
    select r.id,r.funcionario_id,r.data,r.entrada,r.saida_almoco,r.volta_almoco,r.saida,r.horas_trabalhadas,r.status,
      f.nome,f.cpf,f.cargo,
      imp.extra_50,imp.extra_100,imp.dia_falta,imp.horas_atraso,imp.justificativas,imp.inconsistencia,
      case when nullif(trim(coalesce(imp.dia_falta,'')),'') is not null then 'falta' when nullif(trim(coalesce(imp.horas_atraso,'')),'') is not null then 'atraso' when nullif(trim(coalesce(imp.inconsistencia,'')),'') is not null then 'inconsistencia' else null end as inconsistencia_tipo,
      coalesce(inc.status,'pendente') as inconsistencia_status,
      inc.justificativa as inconsistencia_justificativa
    from public.registros_ponto r
    join public.funcionarios f on f.id=r.funcionario_id
    left join lateral (select l.extra_50,l.extra_100,l.dia_falta,l.horas_atraso,l.justificativas,l.inconsistencia from public.ponto_import_linhas l join public.ponto_importacoes i on i.id=l.importacao_id where l.funcionario_id=r.funcionario_id and l.data=r.data and i.status='aplicada' order by i.created_at desc limit 1) imp on true
    left join lateral (select p.status,p.justificativa from public.ponto_inconsistencias p where p.funcionario_id=r.funcionario_id and p.data=r.data and p.tipo='ponto' order by p.updated_at desc limit 1) inc on true
    where f.empresa_id=v_usuario.empresa_id and (v_funcionario_id is null or r.funcionario_id=v_funcionario_id) and (p_inicio is null or r.data>=p_inicio) and (p_fim is null or r.data<=p_fim)
    order by r.data desc,f.nome limit least(greatest(coalesce(p_limite,180),1),1000)
  ) x;
  return jsonb_build_object('sucesso',true,'registros',v_result,'escopo',case when v_global then 'equipe' else 'individual' end,'perfil',v_usuario.perfil,'funcionario_id',v_funcionario_id,'inicio',p_inicio,'fim',p_fim);
end; $$;

grant execute on function public.app_listar_ponto(text,integer,date,date,uuid) to anon,authenticated;

create or replace function public.app_decidir_inconsistencia_ponto(p_token text,p_funcionario_id uuid,p_data date,p_status text,p_justificativa text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_usuario record; v_tipo text;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if p_status not in ('aprovada','justificada') then return jsonb_build_object('sucesso',false,'erro','Status de inconsistência inválido'); end if;
  if not exists (select 1 from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v_usuario.empresa_id) then return jsonb_build_object('sucesso',false,'erro','Funcionário não pertence à empresa'); end if;
  insert into public.ponto_inconsistencias(empresa_id,funcionario_id,data,tipo,detalhe,status,justificativa,analisado_por,analisado_em,updated_at)
  values(v_usuario.empresa_id,p_funcionario_id,p_data,'ponto',null,p_status,nullif(trim(coalesce(p_justificativa,'')),''),v_usuario.usuario_id,now(),now())
  on conflict(funcionario_id,data,tipo) do update set status=excluded.status,justificativa=excluded.justificativa,analisado_por=excluded.analisado_por,analisado_em=excluded.analisado_em,updated_at=now();
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v_usuario.usuario_id,case when p_status='aprovada' then 'aprovou_inconsistencia_ponto' else 'justificou_inconsistencia_ponto' end,'ponto_inconsistencias',jsonb_build_object('funcionario_id',p_funcionario_id,'data',p_data,'status',p_status));
  return jsonb_build_object('sucesso',true,'status',p_status);
end; $$;

grant execute on function public.app_decidir_inconsistencia_ponto(text,uuid,date,text,text) to anon,authenticated;
