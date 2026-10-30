-- Fase 3 RH: gestão administrativa de afastamentos e integração ao fechamento.
create or replace function public.app_admin_listar_afastamentos(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_rows jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.inicio desc,x.nome),'[]'::jsonb) into v_rows
    from (select a.id,a.funcionario_id,f.nome,f.cpf,f.cargo,a.tipo,a.inicio,a.fim,a.motivo,a.status,a.created_at,a.updated_at
            from public.rh_afastamentos a join public.funcionarios f on f.id=a.funcionario_id
           where a.empresa_id=v.empresa_id order by a.inicio desc,f.nome limit 1000)x;
  return jsonb_build_object('sucesso',true,'afastamentos',v_rows);
end; $$;

create or replace function public.app_admin_criar_afastamento(p_token text,p_funcionario_id uuid,p_tipo text,p_inicio date,p_fim date,p_motivo text default null,p_status text default 'ativo')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid; v_status text:=coalesce(nullif(trim(p_status),''),'ativo');
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id) then return jsonb_build_object('sucesso',false,'erro','Funcionário não encontrado na empresa'); end if;
  if nullif(trim(p_tipo),'') is null then return jsonb_build_object('sucesso',false,'erro','Informe o tipo de afastamento'); end if;
  if p_inicio is null or (p_fim is not null and p_fim<p_inicio) then return jsonb_build_object('sucesso',false,'erro','Informe um período de afastamento válido'); end if;
  if v_status not in ('ativo','encerrado','cancelado') then return jsonb_build_object('sucesso',false,'erro','Status de afastamento inválido'); end if;
  if v_status<>'cancelado' and exists(select 1 from public.rh_afastamentos a where a.empresa_id=v.empresa_id and a.funcionario_id=p_funcionario_id and a.status<>'cancelado' and (a.fim is null or p_inicio<=a.fim) and (p_fim is null or a.inicio<=p_fim)) then return jsonb_build_object('sucesso',false,'erro','Já existe afastamento sobreposto para este funcionário'); end if;
  insert into public.rh_afastamentos(empresa_id,funcionario_id,tipo,inicio,fim,motivo,status) values(v.empresa_id,p_funcionario_id,trim(p_tipo),p_inicio,p_fim,nullif(trim(p_motivo),''),v_status) returning id into v_id;
  return jsonb_build_object('sucesso',true,'id',v_id);
end; $$;

create or replace function public.app_admin_atualizar_afastamento(p_token text,p_id uuid,p_fim date,p_motivo text,p_status text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_row public.rh_afastamentos%rowtype; v_status text:=coalesce(nullif(trim(p_status),''),'ativo');
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  if v_status not in ('ativo','encerrado','cancelado') then return jsonb_build_object('sucesso',false,'erro','Status de afastamento inválido'); end if;
  select * into v_row from public.rh_afastamentos a where a.id=p_id and a.empresa_id=v.empresa_id limit 1;
  if v_row.id is null then return jsonb_build_object('sucesso',false,'erro','Afastamento não encontrado'); end if;
  if p_fim is not null and p_fim<v_row.inicio then return jsonb_build_object('sucesso',false,'erro','A data de fim não pode ser anterior ao início'); end if;
  update public.rh_afastamentos set fim=p_fim,motivo=nullif(trim(p_motivo),''),status=v_status,updated_at=now() where id=p_id and empresa_id=v.empresa_id;
  return jsonb_build_object('sucesso',true,'id',p_id);
end; $$;

-- O fechamento passa a reconhecer também os afastamentos lançados pelo RH,
-- além dos atestados aceitos e das marcações de férias importadas.
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
      (exists(select 1 from public.atestados a where a.funcionario_id=f.id and a.status='aceito' and u.data>=a.data_atendimento and u.data<a.data_atendimento+greatest(coalesce(a.dias,1),1)) or exists(select 1 from public.rh_afastamentos af where af.funcionario_id=f.id and af.status='ativo' and u.data>=af.inicio and (af.fim is null or u.data<=af.fim))) as afastamento,
      exists(select 1 from public.ponto_inconsistencias pi where pi.funcionario_id=f.id and pi.data=u.data and pi.tipo='ponto' and pi.status='justificada') as justificativa_aprovada
    from public.funcionarios f join ultima u on u.funcionario_id=f.id where f.empresa_id=v.empresa_id and f.ativo=true
  ), marcados as (
    select c.*,
      ((nullif(trim(coalesce(c.dia_falta,'')),'') is not null and lower(trim(c.dia_falta)) not in('não','nao','n','0')) or (nullif(trim(coalesce(c.previsto,'')),'') is not null and not c.tem_marcacao and not c.ferias and not c.afastamento)) as falta_apontada,
      (nullif(trim(coalesce(c.desconta_dsr,'')),'') is not null and lower(trim(c.desconta_dsr)) in('sim','s','true','1')) as dsr_marcado
    from classificados c
  ), finais as (
    select m.*,(m.falta_apontada and (m.justificativa_aprovada or nullif(trim(coalesce(m.justificativas,'')),'') is not null or m.ferias or m.afastamento)) as falta_justificada from marcados m
  )
  insert into public.fechamento_funcionarios(fechamento_id,funcionario_id,dias_trabalhados,faltas,faltas_injustificadas,faltas_justificadas,atrasos_minutos,horas_extras_50,horas_extras_100,dsr_horas,dsr_desconto,hora_base,horas_extras_50_valor,horas_extras_100_valor,dias_folga,dias_ferias,dias_afastamento,vale_elegivel,vale_valor,ocorrencias,observacoes)
  select v_id,f.id,count(*) filter(where x.tem_marcacao)::numeric,count(*) filter(where x.falta_apontada)::integer,count(*) filter(where x.falta_apontada and not x.falta_justificada)::integer,count(*) filter(where x.falta_apontada and x.falta_justificada)::integer,coalesce(sum(public.app_horas_decimal(x.horas_atraso)*60),0)::integer,coalesce(sum(public.app_horas_decimal(x.extra_50)),0),coalesce(sum(public.app_horas_decimal(x.extra_100)),0),case when count(*) filter(where x.falta_apontada and not x.falta_justificada)>0 then count(*) filter(where x.dsr_marcado) else 0 end,case when coalesce(f.salario,0)>0 and count(*) filter(where x.falta_apontada and not x.falta_justificada)>0 then round((f.salario/30)*count(*) filter(where x.dsr_marcado),2) else 0 end,case when coalesce(f.salario,0)>0 then round(f.salario/v_divisor,4) else 0 end,case when coalesce(f.salario,0)>0 then round(sum(public.app_horas_decimal(x.extra_50))*(f.salario/v_divisor)*1.5,2) else 0 end,case when coalesce(f.salario,0)>0 then round(sum(public.app_horas_decimal(x.extra_100))*(f.salario/v_divisor)*2,2) else 0 end,count(*) filter(where not x.tem_marcacao and not x.falta_apontada and not x.ferias and not x.afastamento)::integer,count(*) filter(where x.ferias)::integer,count(*) filter(where x.afastamento)::integer,(f.elegivel_vale and (p_incluir_informais_vale or f.registrado) and count(*) filter(where x.falta_apontada and not x.falta_justificada)=0),case when f.elegivel_vale and (p_incluir_informais_vale or f.registrado) and count(*) filter(where x.falta_apontada and not x.falta_justificada)=0 then coalesce((select vale_valor from public.configuracoes_empresa where empresa_id=v.empresa_id),300) else 0 end,jsonb_build_object('regra','v3','divisor_horas',v_divisor,'dias_com_marcacao',count(*) filter(where x.tem_marcacao),'dias_folga',count(*) filter(where not x.tem_marcacao and not x.falta_apontada and not x.ferias and not x.afastamento),'dias_ferias',count(*) filter(where x.ferias),'dias_afastamento',count(*) filter(where x.afastamento),'faltas_justificadas',count(*) filter(where x.falta_apontada and x.falta_justificada),'faltas_injustificadas',count(*) filter(where x.falta_apontada and not x.falta_justificada)),case when count(*) filter(where x.falta_apontada and not x.falta_justificada)>0 then 'Há faltas injustificadas; revisar antes de confirmar.' else null end
  from public.funcionarios f left join finais x on x.funcionario_id=f.id where f.empresa_id=v.empresa_id and f.ativo=true group by f.id,f.salario,f.elegivel_vale,f.registrado;
  select jsonb_build_object('funcionarios',count(*),'faltas_injustificadas',coalesce(sum(faltas_injustificadas),0),'faltas_justificadas',coalesce(sum(faltas_justificadas),0),'horas_extras_50',coalesce(sum(horas_extras_50),0),'horas_extras_100',coalesce(sum(horas_extras_100),0),'extras_50_valor',coalesce(sum(horas_extras_50_valor),0),'extras_100_valor',coalesce(sum(horas_extras_100_valor),0),'dsr_desconto',coalesce(sum(dsr_desconto),0)) into v_resumo from public.fechamento_funcionarios where fechamento_id=v_id;
  update public.fechamentos_mensais set observacoes='Prévia calculada; aguarda confirmação explícita do gestor. Resumo: '||v_resumo::text where id=v_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v.usuario_id,'calculou_previa_fechamento','fechamentos_mensais',jsonb_build_object('fechamento_id',v_id,'competencia',p_competencia,'regras',jsonb_build_object('divisor_horas',v_divisor,'afastamentos_rh',true),'resumo',v_resumo));
  return jsonb_build_object('sucesso',true,'fechamento_id',v_id,'competencia',p_competencia,'status','calculado','resumo',v_resumo,'mensagem','Prévia calculada. Confirme explicitamente para fechar a competência.');
end; $$;
