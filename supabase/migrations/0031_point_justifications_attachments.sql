-- Justificativa individual vinculada ao dia, com opcional de anexo e auditoria.
create or replace function public.app_criar_justificativa_ponto(p_token text,p_data date,p_tipo text,p_motivo text,p_arquivo_url text default null,p_arquivo_nome text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record;v_registro uuid;v_id uuid;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.funcionario_id is null then return jsonb_build_object('sucesso',false,'erro','Sessão sem funcionário vinculado');end if;
  if p_data is null or length(trim(coalesce(p_motivo,'')))<5 then return jsonb_build_object('sucesso',false,'erro','Informe a data e uma justificativa com pelo menos 5 caracteres');end if;
  select id into v_registro from public.registros_ponto where funcionario_id=v.funcionario_id and data=p_data limit 1;
  insert into public.justificativas_ponto(funcionario_id,registro_ponto_id,data_registro,tipo,motivo,arquivo_url,arquivo_nome,status,empresa_id)
  values(v.funcionario_id,v_registro,p_data,coalesce(nullif(trim(p_tipo),''),'Ponto'),trim(p_motivo),nullif(trim(coalesce(p_arquivo_url,'')),''),nullif(trim(coalesce(p_arquivo_nome,'')),''),'pendente',v.empresa_id)
  returning id into v_id;
  insert into public.ponto_inconsistencias(empresa_id,funcionario_id,data,tipo,detalhe,status,justificativa,updated_at)
  values(v.empresa_id,v.funcionario_id,p_data,'ponto',coalesce(nullif(trim(p_tipo),''),'Ponto'),'pendente',trim(p_motivo),now())
  on conflict(funcionario_id,data,tipo) do update set detalhe=excluded.detalhe,status='pendente',justificativa=excluded.justificativa,updated_at=now(),analisado_por=null,analisado_em=null;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v.usuario_id,'enviou_justificativa_ponto','justificativas_ponto',jsonb_build_object('justificativa_id',v_id,'data',p_data,'tipo',p_tipo,'tem_anexo',p_arquivo_url is not null));
  return jsonb_build_object('sucesso',true,'id',v_id,'status','pendente');
end; $$;
grant execute on function public.app_criar_justificativa_ponto(text,date,text,text,text,text) to anon,authenticated;

create or replace function public.app_listar_ponto(p_token text,p_limite integer default 180,p_inicio date default null,p_fim date default null,p_funcionario_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_usuario record;v_result jsonb;v_global boolean;v_funcionario_id uuid;
begin
 select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;if v_usuario.usuario_id is null then return jsonb_build_object('sucesso',false,'erro','Sessão inválida');end if;v_global:=v_usuario.perfil in('admin','administrador','gestor');if not v_global and p_funcionario_id is not null and p_funcionario_id<>v_usuario.funcionario_id then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao seu próprio ponto');end if;v_funcionario_id:=case when v_global then p_funcionario_id else v_usuario.funcionario_id end;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc,x.nome),'[]'::jsonb) into v_result from(select r.id,r.funcionario_id,r.data,r.entrada,r.saida_almoco,r.volta_almoco,r.saida,r.horas_trabalhadas,r.status,f.nome,f.cpf,f.cargo,imp.previsto,imp.extra_50,imp.extra_100,imp.dia_falta,imp.horas_atraso,imp.desconta_dsr,imp.justificativas,imp.inconsistencia,case when nullif(trim(coalesce(imp.dia_falta,'')),'') is not null then 'falta' when nullif(trim(coalesce(imp.horas_atraso,'')),'') is not null then 'atraso' when nullif(trim(coalesce(imp.inconsistencia,'')),'') is not null then 'inconsistencia' else null end as inconsistencia_tipo,coalesce(inc.status,'pendente') as inconsistencia_status,coalesce(inc.justificativa,j.motivo) as inconsistencia_justificativa,j.motivo as justificativa_motivo,j.arquivo_url as justificativa_arquivo_url,j.arquivo_nome as justificativa_arquivo_nome
 from public.registros_ponto r join public.funcionarios f on f.id=r.funcionario_id
 left join lateral(select l.previsto,l.extra_50,l.extra_100,l.dia_falta,l.horas_atraso,l.desconta_dsr,l.justificativas,l.inconsistencia from public.ponto_import_linhas l join public.ponto_importacoes i on i.id=l.importacao_id where l.funcionario_id=r.funcionario_id and l.data=r.data and i.status='aplicada' order by i.created_at desc limit 1) imp on true
 left join lateral(select p.status,p.justificativa from public.ponto_inconsistencias p where p.funcionario_id=r.funcionario_id and p.data=r.data and p.tipo='ponto' order by p.updated_at desc limit 1) inc on true
 left join lateral(select j.motivo,j.arquivo_url,j.arquivo_nome from public.justificativas_ponto j where j.funcionario_id=r.funcionario_id and j.data_registro=r.data order by j.created_at desc limit 1) j on true
 where f.empresa_id=v_usuario.empresa_id and(v_funcionario_id is null or r.funcionario_id=v_funcionario_id) and(p_inicio is null or r.data>=p_inicio) and(p_fim is null or r.data<=p_fim) order by r.data desc,f.nome limit least(greatest(coalesce(p_limite,180),1),1000))x;
 return jsonb_build_object('sucesso',true,'registros',v_result,'escopo',case when v_global then 'equipe' else 'individual' end,'perfil',v_usuario.perfil,'funcionario_id',v_funcionario_id,'inicio',p_inicio,'fim',p_fim);
end; $$;
grant execute on function public.app_listar_ponto(text,integer,date,date,uuid) to anon,authenticated;
