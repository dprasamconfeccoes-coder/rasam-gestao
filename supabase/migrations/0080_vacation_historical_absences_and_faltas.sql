begin;

create or replace function public.app_admin_listar_ferias_programacao_historica(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v record; v_rows jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin','administrador') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador');
  end if;
  with distinct_ferias as (
    select distinct on (r.funcionario_id, r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim, r.inicio, r.fim) r.*
    from public.rh_ferias r
    where r.empresa_id = v.empresa_id
    order by r.funcionario_id, r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim, r.inicio, r.fim, r.updated_at desc, r.created_at desc
  ), sistema as (
    select funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim,
      sum(coalesce(dias_gozo, case when inicio is not null and fim is not null then (fim - inicio + 1) else 0 end))::numeric as dias_gozados_sistema,
      count(*)::int as periodos_sistema
    from distinct_ferias
    group by funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nome_relatorio, x.aquisitivo_inicio), '[]'::jsonb) into v_rows
  from (
    select h.id, h.codigo_empregado, h.nome_relatorio, h.data_admissao, h.vencimento_ferias, h.ferias_vencidas, h.ferias_programadas, h.aquisitivo_inicio, h.aquisitivo_fim, h.dias_direito, h.dias_gozados_relatorio, h.dias_restantes_relatorio, h.limite_gozo, h.dias_afastamento, h.dias_faltas, h.fonte_emissao, h.fonte_nome,
      h.funcionario_id, f.nome as nome_sistema, f.data_admissao as data_admissao_sistema,
      coalesce(nullif(regexp_replace(h.dias_afastamento, '[^0-9]', '', 'g'), ''), '0')::numeric + coalesce((select sum(greatest(coalesce(a.fim, current_date) - a.inicio + 1, 0))::numeric from public.rh_afastamentos a where a.empresa_id=v.empresa_id and a.funcionario_id=h.funcionario_id and upper(coalesce(a.tipo,'')) like '%INSS%' and lower(coalesce(a.status,'')) not in ('cancelado','cancelada','rejeitado','rejeitada') and a.inicio <= h.aquisitivo_fim and coalesce(a.fim,current_date) >= h.aquisitivo_inicio),0) as dias_afastamento_inss,
      coalesce(nullif(regexp_replace(h.dias_faltas, '[^0-9]', '', 'g'), ''), '0')::numeric + coalesce((select count(*)::numeric from public.ponto_import_linhas p where p.empresa_id=v.empresa_id and p.funcionario_id=h.funcionario_id and p.data between h.aquisitivo_inicio and h.aquisitivo_fim and trim(coalesce(p.dia_falta,'')) = '1'),0) as dias_faltas_total,
      coalesce(s.dias_gozados_sistema,0) as dias_gozados_sistema,
      coalesce(h.dias_gozados_relatorio,0) + coalesce(s.dias_gozados_sistema,0) as dias_gozados_total,
      coalesce(s.periodos_sistema,0) as periodos_sistema,
      greatest(coalesce(h.dias_direito,0) - coalesce(h.dias_gozados_relatorio,0) - coalesce(s.dias_gozados_sistema,0),0) as dias_disponiveis,
      greatest(coalesce(h.dias_gozados_relatorio,0) + coalesce(s.dias_gozados_sistema,0) - coalesce(h.dias_direito,0),0) as dias_excedentes,
      (select count(*)::int from public.rh_ferias r join public.rh_ferias_documentos d on d.ferias_id = r.id and d.empresa_id = r.empresa_id where r.empresa_id=v.empresa_id and r.funcionario_id=h.funcionario_id and r.periodo_aquisitivo_inicio=h.aquisitivo_inicio and r.periodo_aquisitivo_fim=h.aquisitivo_fim and d.tipo='aviso' and d.storage_path is not null) as avisos_sistema,
      (select count(*)::int from public.rh_ferias r join public.rh_ferias_documentos d on d.ferias_id = r.id and d.empresa_id = r.empresa_id where r.empresa_id=v.empresa_id and r.funcionario_id=h.funcionario_id and r.periodo_aquisitivo_inicio=h.aquisitivo_inicio and r.periodo_aquisitivo_fim=h.aquisitivo_fim and d.tipo='recibo' and d.storage_path is not null) as recibos_sistema,
      case
        when h.funcionario_id is null then 'sem_vinculo'
        when coalesce(h.dias_gozados_relatorio,0) + coalesce(s.dias_gozados_sistema,0) > coalesce(h.dias_direito,0) then 'dias_excedentes'
        when coalesce(s.periodos_sistema,0)=0 and coalesce(h.dias_gozados_relatorio,0)=0 then 'sem_ferias_lancadas'
        else 'conferido'
      end as situacao_confronto
    from public.rh_ferias_programacao_historica h
    left join public.funcionarios f on f.id=h.funcionario_id
    left join sistema s on s.funcionario_id=h.funcionario_id and s.periodo_aquisitivo_inicio=h.aquisitivo_inicio and s.periodo_aquisitivo_fim=h.aquisitivo_fim
    where h.empresa_id=v.empresa_id
    limit 100
  ) x;
  return jsonb_build_object('sucesso',true,'programacao',v_rows);
end; $$;

comment on function public.app_admin_listar_ferias_programacao_historica(text) is 'Retorna os saldos contínuos de férias: carga inicial mais lançamentos atuais do Supabase.';
commit;
