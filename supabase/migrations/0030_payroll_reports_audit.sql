create or replace function public.app_admin_relatorio_fechamento(p_token text,p_competencia text,p_tipo text,p_incluir_informais_vale boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record;v_id uuid;v_status text;v_rows jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado');end if;
  select id,status into v_id,v_status from public.fechamentos_mensais where empresa_id=v.empresa_id and competencia=p_competencia limit 1;
  if v_id is null then return jsonb_build_object('sucesso',false,'erro','Calcule a prévia antes de emitir o relatório');end if;
  if p_tipo='escritorio' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]'::jsonb) into v_rows from (select f.nome,f.cpf,f.cargo,f.registrado,ff.dias_trabalhados,ff.dias_folga,ff.dias_ferias,ff.dias_afastamento,ff.faltas,ff.faltas_justificadas,ff.faltas_injustificadas,ff.atrasos_minutos,ff.horas_extras_50,ff.horas_extras_50_valor,ff.horas_extras_100,ff.horas_extras_100_valor,ff.dsr_horas,ff.dsr_desconto,ff.hora_base from public.fechamento_funcionarios ff join public.funcionarios f on f.id=ff.funcionario_id where ff.fechamento_id=v_id and f.elegivel_escritorio=true and f.registrado=true limit 1000)x;
  else
    select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]'::jsonb) into v_rows from (select f.nome,f.cpf,f.registrado,ff.faltas_justificadas,ff.faltas_injustificadas,ff.vale_elegivel,ff.vale_valor,ff.dsr_desconto from public.fechamento_funcionarios ff join public.funcionarios f on f.id=ff.funcionario_id where ff.fechamento_id=v_id and ff.vale_elegivel and (p_incluir_informais_vale or f.registrado) limit 1000)x;
  end if;
  return jsonb_build_object('sucesso',true,'competencia',p_competencia,'tipo',p_tipo,'status',v_status,'linhas',v_rows,'auditavel',true);
end; $$;
grant execute on function public.app_admin_relatorio_fechamento(text,text,text,boolean) to anon,authenticated;
