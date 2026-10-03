-- Fechamento mensal baseado no ponto importado real.
alter table public.ponto_import_linhas add column if not exists empresa_id uuid references public.empresas(id);
update public.ponto_import_linhas p set empresa_id=i.empresa_id from public.ponto_importacoes i where p.importacao_id=i.id and p.empresa_id is null;

create or replace function public.app_admin_calcular_fechamento(p_token text,p_competencia text,p_incluir_informais_vale boolean default false) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid; v_inicio date; v_fim date;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;
 if v.perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 if p_competencia !~ '^\d{4}-\d{2}$' then return jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM'); end if;
 v_inicio:=to_date(p_competencia||'-01','YYYY-MM-DD'); v_fim:=(v_inicio+interval '1 month-1 day')::date;
 insert into public.fechamentos_mensais(empresa_id,competencia,incluir_informais_vale,status,criado_por) values(v.empresa_id,p_competencia,p_incluir_informais_vale,'calculado',v.usuario_id) on conflict(empresa_id,competencia) do update set incluir_informais_vale=excluded.incluir_informais_vale,status='calculado' returning id into v_id;
 delete from public.fechamento_funcionarios where fechamento_id=v_id;
 insert into public.fechamento_funcionarios(fechamento_id,funcionario_id,dias_trabalhados,faltas,faltas_injustificadas,atrasos_minutos,horas_extras_50,horas_extras_100,dsr_horas,dsr_desconto,vale_elegivel,vale_valor,observacoes)
 select v_id,f.id,p.dias_trabalhados,p.faltas,greatest(p.faltas-coalesce(p.abonos,0),0),p.atrasos_minutos,p.extra_50,p.extra_100,p.dsr_horas,case when coalesce(f.salario,0)>0 then round((f.salario/30)*p.dsr_horas,2) else 0 end,(f.elegivel_vale and (p_incluir_informais_vale or f.registrado) and greatest(p.faltas-coalesce(p.abonos,0),0)=0),case when f.elegivel_vale and (p_incluir_informais_vale or f.registrado) and greatest(p.faltas-coalesce(p.abonos,0),0)=0 then coalesce((select vale_valor from public.configuracoes_empresa where empresa_id=v.empresa_id),300) else 0 end,case when p.faltas>0 then 'Faltas importadas do ponto; revise justificativas antes de fechar.' else null end
 from public.funcionarios f left join lateral (select count(*) filter(where coalesce(pi.dia_falta,'')='')::numeric as dias_trabalhados,count(*) filter(where lower(coalesce(pi.dia_falta,'')) not in ('','não','nao','n','0'))::integer as faltas,coalesce(sum(case when trim(coalesce(pi.extra_50,''))~'^[0-9]+([,.][0-9]+)?$' then replace(trim(pi.extra_50),',','.')::numeric else 0 end),0) as extra_50,coalesce(sum(case when trim(coalesce(pi.extra_100,''))~'^[0-9]+([,.][0-9]+)?$' then replace(trim(pi.extra_100),',','.')::numeric else 0 end),0) as extra_100,coalesce(sum(case when trim(coalesce(pi.horas_atraso,''))~'^\d+:\d+$' then split_part(pi.horas_atraso,':',1)::integer*60+split_part(pi.horas_atraso,':',2)::integer when trim(coalesce(pi.horas_atraso,''))~'^\d+$' then trim(pi.horas_atraso)::integer else 0 end),0)::integer as atrasos_minutos,count(*) filter(where lower(coalesce(pi.desconta_dsr,'')) in ('sim','s','true','1'))::numeric as dsr_horas,count(*) filter(where lower(coalesce(pi.abono,'')) not in ('','não','nao','n','0'))::integer as abonos from public.ponto_import_linhas pi where pi.funcionario_id=f.id and pi.empresa_id=v.empresa_id and pi.data between v_inicio and v_fim) p on true where f.empresa_id=v.empresa_id and f.ativo=true;
 update public.fechamentos_mensais set status='calculado' where id=v_id;
 return jsonb_build_object('sucesso',true,'fechamento_id',v_id,'competencia',p_competencia,'origem','ponto_importado');
end; $$;
grant execute on function public.app_admin_calcular_fechamento(text,text,boolean) to anon,authenticated;
