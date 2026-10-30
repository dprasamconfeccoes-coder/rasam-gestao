-- Fechamento de folha auditável: prévia calculada, confirmação explícita e regras reproduzíveis.
alter table public.fechamentos_mensais
  add column if not exists confirmado_por uuid references public.usuarios(id),
  add column if not exists confirmado_at timestamptz,
  add column if not exists regra_snapshot jsonb;
alter table public.fechamento_funcionarios
  add column if not exists faltas_justificadas integer default 0,
  add column if not exists dias_folga integer default 0,
  add column if not exists dias_ferias integer default 0,
  add column if not exists dias_afastamento integer default 0,
  add column if not exists hora_base numeric default 0,
  add column if not exists horas_extras_50_valor numeric default 0,
  add column if not exists horas_extras_100_valor numeric default 0,
  add column if not exists ocorrencias jsonb default '{}'::jsonb;

create or replace function public.app_horas_decimal(p_valor text)
returns numeric language plpgsql immutable as $$
declare v text:=trim(coalesce(p_valor,'')); v_h numeric; v_m numeric;
begin
  if v='' then return 0; end if;
  if v ~ '^[0-9]{1,3}:[0-9]{2}' then
    v_h:=substring(v from '^([0-9]{1,3})')::numeric;
    v_m:=substring(v from '^[0-9]{1,3}:([0-9]{2})')::numeric;
    return v_h+v_m/60;
  end if;
  if v ~ '^[0-9]+([,.][0-9]+)?$' then return replace(v,',','.')::numeric; end if;
  return 0;
end; $$;

create or replace function public.app_admin_calcular_fechamento(p_token text,p_competencia text,p_incluir_informais_vale boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid; v_inicio date; v_fim date; v_divisor numeric:=220; v_resumo jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if p_competencia !~ '^[0-9]{4}-[0-9]{2}$' then return jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM'); end if;
  v_inicio:=to_date(p_competencia||'-01','YYYY-MM-DD'); v_fim:=(v_inicio+interval '1 month-1 day')::date;
  select coalesce(nullif((regras->>'divisor_horas')::numeric,0),220) into v_divisor from public.configuracoes_empresa where empresa_id=v.empresa_id;
  insert into public.fechamentos_mensais(empresa_id,competencia,incluir_informais_vale,status,criado_por,confirmado_por,confirmado_at,regra_snapshot,observacoes)
  values(v.empresa_id,p_competencia,p_incluir_informais_vale,'calculado',v.usuario_id,null,null,jsonb_build_object('divisor_horas',v_divisor,'adicional_50',1.5,'adicional_100',2.0,'base_dsr','salario/30 por ocorrência marcada e falta injustificada'),'Prévia calculada; aguarda confirmação explícita do gestor.')
  on conflict(empresa_id,competencia) do update set incluir_informais_vale=excluded.incluir_informais_vale,status='calculado',confirmado_por=null,confirmado_at=null,regra_snapshot=excluded.regra_snapshot,observacoes=excluded.observacoes,criado_por=excluded.criado_por
  returning id into v_id;
  delete from public.fechamento_funcionarios where fechamento_id=v_id;
  with ultima as (
    select distinct on(l.funcionario_id,l.data) l.* from public.ponto_import_linhas l join public.ponto_importacoes i on i.id=l.importacao_id where i.empresa_id=v.empresa_id and i.status='aplicada' and l.data between v_inicio and v_fim order by l.funcionario_id,l.data,i.created_at desc
  ), classificados as (
    select f.id as funcionario_id,f.salario,u.data,u.previsto,u.justificativas,u.dia_falta,u.horas_atraso,u.extra_50,u.extra_100,u.desconta_dsr,
      (coalesce(u.entrada_1::text,'')<>'' or coalesce(u.saida_1::text,'')<>'' or coalesce(u.entrada_2::text,'')<>'' or coalesce(u.saida_2::text,'')<>'' or nullif(trim(coalesce(u.total_normais,'')),'') is not null) as tem_marcacao,
      lower(coalesce(u.previsto,'')||' '||coalesce(u.justificativas,'')) like '%ferias%' or lower(coalesce(u.previsto,'')||' '||coalesce(u.justificativas,'')) like '%férias%' as ferias,
      exists(select 1 from public.atestados a where a.funcionario_id=f.id and a.status='aceito' and u.data>=a.data_atendimento and u.data<a.data_atendimento+greatest(coalesce(a.dias,1),1)) as afastamento,
      exists(select 1 from public.ponto_inconsistencias pi where pi.funcionario_id=f.id and pi.data=u.data and pi.tipo='ponto' and pi.status='justificada') as justificativa_aprovada
    from public.funcionarios f join ultima u on u.funcionario_id=f.id where f.empresa_id=v.empresa_id and f.ativo=true
  ), marcados as (
    select c.*,
      (nullif(trim(coalesce(c.dia_falta,'')),'') is not null and lower(trim(c.dia_falta)) not in('não','nao','n','0')) or (nullif(trim(coalesce(c.previsto,'')),'') is not null and not c.tem_marcacao and not c.ferias and not c.afastamento) as falta_apontada,
      (nullif(trim(coalesce(c.desconta_dsr,'')),'') is not null and lower(trim(c.desconta_dsr)) in('sim','s','true','1')) as dsr_marcado
    from classificados c
  ), finais as (
    select m.*,(m.falta_apontada and (m.justificativa_aprovada or nullif(trim(coalesce(m.justificativas,'')),'') is not null or m.ferias or m.afastamento)) as falta_justificada
    from marcados m
  )
  insert into public.fechamento_funcionarios(fechamento_id,funcionario_id,dias_trabalhados,faltas,faltas_injustificadas,faltas_justificadas,atrasos_minutos,horas_extras_50,horas_extras_100,dsr_horas,dsr_desconto,hora_base,horas_extras_50_valor,horas_extras_100_valor,dias_folga,dias_ferias,dias_afastamento,vale_elegivel,vale_valor,ocorrencias,observacoes)
  select v_id,f.id,
    count(*) filter(where x.tem_marcacao)::numeric,
    count(*) filter(where x.falta_apontada)::integer,
    count(*) filter(where x.falta_apontada and not x.falta_justificada)::integer,
    count(*) filter(where x.falta_apontada and x.falta_justificada)::integer,
    coalesce(sum(public.app_horas_decimal(x.horas_atraso)*60),0)::integer,
    coalesce(sum(public.app_horas_decimal(x.extra_50)),0),coalesce(sum(public.app_horas_decimal(x.extra_100)),0),
    case when count(*) filter(where x.falta_apontada and not x.falta_justificada)>0 then count(*) filter(where x.dsr_marcado) else 0 end,
    case when coalesce(f.salario,0)>0 and count(*) filter(where x.falta_apontada and not x.falta_justificada)>0 then round((f.salario/30)*count(*) filter(where x.dsr_marcado),2) else 0 end,
    case when coalesce(f.salario,0)>0 then round(f.salario/v_divisor,4) else 0 end,
    case when coalesce(f.salario,0)>0 then round(sum(public.app_horas_decimal(x.extra_50))*(f.salario/v_divisor)*1.5,2) else 0 end,
    case when coalesce(f.salario,0)>0 then round(sum(public.app_horas_decimal(x.extra_100))*(f.salario/v_divisor)*2,2) else 0 end,
    count(*) filter(where not x.tem_marcacao and not x.falta_apontada and not x.ferias and not x.afastamento)::integer,
    count(*) filter(where x.ferias)::integer,count(*) filter(where x.afastamento)::integer,
    (f.elegivel_vale and (p_incluir_informais_vale or f.registrado) and count(*) filter(where x.falta_apontada and not x.falta_justificada)=0),
    case when f.elegivel_vale and (p_incluir_informais_vale or f.registrado) and count(*) filter(where x.falta_apontada and not x.falta_justificada)=0 then coalesce((select vale_valor from public.configuracoes_empresa where empresa_id=v.empresa_id),300) else 0 end,
    jsonb_build_object('regra','v2','divisor_horas',v_divisor,'dias_com_marcacao',count(*) filter(where x.tem_marcacao),'dias_folga',count(*) filter(where not x.tem_marcacao and not x.falta_apontada and not x.ferias and not x.afastamento),'dias_ferias',count(*) filter(where x.ferias),'dias_afastamento',count(*) filter(where x.afastamento),'faltas_justificadas',count(*) filter(where x.falta_apontada and x.falta_justificada),'faltas_injustificadas',count(*) filter(where x.falta_apontada and not x.falta_justificada)),
    case when count(*) filter(where x.falta_apontada and not x.falta_justificada)>0 then 'Há faltas injustificadas; revisar antes de confirmar.' else null end
  from public.funcionarios f left join finais x on x.funcionario_id=f.id where f.empresa_id=v.empresa_id and f.ativo=true group by f.id,f.salario,f.elegivel_vale,f.registrado;
  select jsonb_build_object('funcionarios',count(*),'faltas_injustificadas',coalesce(sum(faltas_injustificadas),0),'faltas_justificadas',coalesce(sum(faltas_justificadas),0),'horas_extras_50',coalesce(sum(horas_extras_50),0),'horas_extras_100',coalesce(sum(horas_extras_100),0),'extras_50_valor',coalesce(sum(horas_extras_50_valor),0),'extras_100_valor',coalesce(sum(horas_extras_100_valor),0),'dsr_desconto',coalesce(sum(dsr_desconto),0)) into v_resumo from public.fechamento_funcionarios where fechamento_id=v_id;
  update public.fechamentos_mensais set observacoes='Prévia calculada; aguarda confirmação explícita do gestor. Resumo: '||v_resumo::text where id=v_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v.usuario_id,'calculou_previa_fechamento','fechamentos_mensais',jsonb_build_object('fechamento_id',v_id,'competencia',p_competencia,'regras',jsonb_build_object('divisor_horas',v_divisor,'adicional_50',1.5,'adicional_100',2.0),'resumo',v_resumo));
  return jsonb_build_object('sucesso',true,'fechamento_id',v_id,'competencia',p_competencia,'status','calculado','resumo',v_resumo,'mensagem','Prévia calculada. Confirme explicitamente para fechar a competência.');
end; $$;

drop function if exists public.app_admin_visualizar_fechamento(text,text);
create function public.app_admin_visualizar_fechamento(p_token text,p_competencia text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record;v_id uuid;v_resumo jsonb;v_linhas jsonb;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;if v.usuario_id is null or v.perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado');end if;
 select id into v_id from public.fechamentos_mensais where empresa_id=v.empresa_id and competencia=p_competencia limit 1;if v_id is null then return jsonb_build_object('sucesso',false,'erro','Calcule a prévia antes de consultar');end if;
 select jsonb_build_object('funcionarios',count(*),'faltas_injustificadas',coalesce(sum(faltas_injustificadas),0),'faltas_justificadas',coalesce(sum(faltas_justificadas),0),'horas_extras_50',coalesce(sum(horas_extras_50),0),'horas_extras_100',coalesce(sum(horas_extras_100),0),'extras_50_valor',coalesce(sum(horas_extras_50_valor),0),'extras_100_valor',coalesce(sum(horas_extras_100_valor),0),'dsr_desconto',coalesce(sum(dsr_desconto),0)) into v_resumo from public.fechamento_funcionarios where fechamento_id=v_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]'::jsonb) into v_linhas from (select f.nome,f.cpf,f.salario,ff.dias_trabalhados,ff.dias_folga,ff.dias_ferias,ff.dias_afastamento,ff.faltas,ff.faltas_justificadas,ff.faltas_injustificadas,ff.atrasos_minutos,ff.horas_extras_50,ff.horas_extras_50_valor,ff.horas_extras_100,ff.horas_extras_100_valor,ff.dsr_horas,ff.dsr_desconto,ff.observacoes from public.fechamento_funcionarios ff join public.funcionarios f on f.id=ff.funcionario_id where ff.fechamento_id=v_id limit 1000)x;
 return jsonb_build_object('sucesso',true,'fechamento_id',v_id,'competencia',p_competencia,'status',v.status,'confirmado_at',v.confirmado_at,'resumo',v_resumo,'linhas',v_linhas,'regras',v.regra_snapshot);
end; $$;
grant execute on function public.app_admin_visualizar_fechamento(text,text) to anon,authenticated;

create or replace function public.app_admin_confirmar_fechamento(p_token text,p_competencia text,p_confirmacao text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record;v_id uuid;v_status text;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;if v.usuario_id is null or v.perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado');end if;
 if upper(trim(coalesce(p_confirmacao,'')))<>'CONFIRMAR' then return jsonb_build_object('sucesso',false,'erro','Digite CONFIRMAR para fechar a competência');end if;
 select id,status into v_id,v_status from public.fechamentos_mensais where empresa_id=v.empresa_id and competencia=p_competencia for update;if v_id is null then return jsonb_build_object('sucesso',false,'erro','Prévia não encontrada; calcule antes de confirmar');end if;if v_status='fechado' then return jsonb_build_object('sucesso',true,'status','fechado','mensagem','Competência já estava fechada');end if;
 update public.fechamentos_mensais set status='fechado',confirmado_por=v.usuario_id,confirmado_at=now(),observacoes=coalesce(observacoes,'')||' Fechamento confirmado pelo gestor.' where id=v_id;
 insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v.usuario_id,'confirmou_fechamento_folha','fechamentos_mensais',jsonb_build_object('fechamento_id',v_id,'competencia',p_competencia,'status_anterior',v_status,'status_novo','fechado'));
 return jsonb_build_object('sucesso',true,'status','fechado','fechamento_id',v_id,'competencia',p_competencia);
end; $$;
grant execute on function public.app_admin_confirmar_fechamento(text,text,text) to anon,authenticated;
