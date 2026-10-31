begin;

-- A interface solicita um link assinado ao Edge Function somente após o clique.
-- Esta RPC não deve retornar nem reconstruir URLs do Google Drive.
create or replace function public.app_admin_listar_ferias_gestao(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v record;
  v_rows jsonb;
  v_imports jsonb;
  v_reconciliation jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin', 'administrador') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao administrador');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.inicio nulls last, x.nome), '[]'::jsonb)
    into v_rows
  from (
    select
      r.id,
      r.funcionario_id,
      f.nome,
      f.cpf,
      f.cargo,
      f.avatar_url,
      r.periodo_aquisitivo_inicio,
      r.periodo_aquisitivo_fim,
      r.inicio,
      r.fim,
      r.retorno_em,
      r.aviso_emitido_em,
      r.pagamento_previsto_em,
      r.pagamento_efetivo_em,
      r.dias_gozo,
      r.dias_abono,
      r.abono_solicitado,
      r.status,
      r.importacao_status,
      r.origem_importacao,
      r.observacoes,
      (select count(*)::int
         from public.rh_ferias_documentos d
        where d.ferias_id = r.id and d.empresa_id = v.empresa_id
          and d.tipo = 'aviso' and d.storage_path is not null) as avisos_count,
      (select count(*)::int
         from public.rh_ferias_documentos d
        where d.ferias_id = r.id and d.empresa_id = v.empresa_id
          and d.tipo = 'recibo' and d.storage_path is not null) as recibos_count,
      (select count(*)::int
         from public.rh_ferias_documentos d
        where d.ferias_id = r.id and d.empresa_id = v.empresa_id
          and d.storage_path is not null) as documentos_count,
      (select jsonb_build_object('id', d.id, 'tipo', d.tipo, 'arquivo_nome', d.arquivo_nome)
         from public.rh_ferias_documentos d
        where d.ferias_id = r.id and d.empresa_id = v.empresa_id
          and d.tipo = 'aviso' and d.storage_path is not null
        order by d.created_at desc limit 1) as aviso_documento,
      (select jsonb_build_object('id', d.id, 'tipo', d.tipo, 'arquivo_nome', d.arquivo_nome)
         from public.rh_ferias_documentos d
        where d.ferias_id = r.id and d.empresa_id = v.empresa_id
          and d.tipo = 'recibo' and d.storage_path is not null
        order by d.created_at desc limit 1) as recibo_documento,
      case
        when (select count(*) from public.rh_ferias_documentos d
               where d.ferias_id = r.id and d.empresa_id = v.empresa_id
                 and d.tipo = 'aviso' and d.storage_path is not null) > 0
         and (select count(*) from public.rh_ferias_documentos d
               where d.ferias_id = r.id and d.empresa_id = v.empresa_id
                 and d.tipo = 'recibo' and d.storage_path is not null) = 0
          then 'aviso_sem_recibo'
        when (select count(*) from public.rh_ferias_documentos d
               where d.ferias_id = r.id and d.empresa_id = v.empresa_id
                 and d.tipo = 'recibo' and d.storage_path is not null) > 0
         and (select count(*) from public.rh_ferias_documentos d
               where d.ferias_id = r.id and d.empresa_id = v.empresa_id
                 and d.tipo = 'aviso' and d.storage_path is not null) = 0
          then 'recibo_sem_aviso'
        else 'conciliado'
      end as reconciliacao_status,
      (select row_to_json(c)
         from public.rh_ferias_calculos c
        where c.ferias_id = r.id and c.empresa_id = v.empresa_id
        limit 1) as calculo
    from public.rh_ferias r
    join public.funcionarios f on f.id = r.funcionario_id
    where r.empresa_id = v.empresa_id
    limit 1000
  ) x;

  v_reconciliation := jsonb_build_object(
    'avisos_total', (select count(*)::int from public.rh_ferias_documentos d
      where d.empresa_id = v.empresa_id and d.tipo = 'aviso' and d.storage_path is not null),
    'recibos_total', (select count(*)::int from public.rh_ferias_documentos d
      where d.empresa_id = v.empresa_id and d.tipo = 'recibo' and d.storage_path is not null),
    'avisos_sem_recibo', (select count(*)::int from public.rh_ferias r
      where r.empresa_id = v.empresa_id
        and exists (select 1 from public.rh_ferias_documentos d
          where d.ferias_id = r.id and d.empresa_id = v.empresa_id
            and d.tipo = 'aviso' and d.storage_path is not null)
        and not exists (select 1 from public.rh_ferias_documentos d
          where d.ferias_id = r.id and d.empresa_id = v.empresa_id
            and d.tipo = 'recibo' and d.storage_path is not null)),
    'recibos_sem_aviso', (select count(*)::int from public.rh_ferias_documentos d
      where d.empresa_id = v.empresa_id and d.tipo = 'recibo'
        and d.storage_path is not null
        and (d.ferias_id is null or not exists (select 1
          from public.rh_ferias_documentos a
          where a.ferias_id = d.ferias_id and a.empresa_id = v.empresa_id
            and a.tipo = 'aviso' and a.storage_path is not null)))
  );

  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc), '[]'::jsonb)
    into v_imports
  from (
    select
      i.id,
      i.tipo,
      i.origem,
      i.pasta_nome,
      i.total_linhas,
      i.linhas_vinculadas,
      i.linhas_pendentes,
      i.status,
      i.observacoes,
      i.created_at,
      coalesce((select jsonb_agg(to_jsonb(l) order by l.nome_extraido)
        from public.rh_ferias_import_linhas l
        where l.importacao_id = i.id limit 1000), '[]'::jsonb) as linhas
    from public.rh_ferias_importacoes i
    where i.empresa_id = v.empresa_id
    order by i.created_at desc
    limit 50
  ) i;

  return jsonb_build_object(
    'sucesso', true,
    'ferias', v_rows,
    'importacoes', v_imports,
    'reconciliacao', v_reconciliation
  );
end;
$function$;

comment on function public.app_admin_listar_ferias_gestao(text) is
  'Gestão de férias com documentos exclusivamente do Storage privado; links são gerados sob demanda.';

commit;
