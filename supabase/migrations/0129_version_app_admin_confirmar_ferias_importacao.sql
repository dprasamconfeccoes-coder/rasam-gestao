create or replace function public.app_admin_confirmar_ferias_importacao(p_token text, p_id uuid, p_observacoes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  l record;
  v_count int := 0;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin', 'administrador') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao administrador');
  end if;

  for l in
    select * from public.rh_ferias_import_linhas
    where id = p_id and empresa_id = v.empresa_id
    limit 1
  loop
    if l.ferias_id is null then
      return jsonb_build_object('sucesso', false, 'erro', 'A linha ainda não possui férias vinculadas');
    end if;

    update public.rh_ferias_import_linhas
    set status = 'conferida', updated_at = now()
    where id = l.id;

    update public.rh_ferias_documentos
    set status_conferencia = 'conferido',
        conferido_em = now(),
        conferido_por = v.usuario_id,
        observacoes = coalesce(nullif(trim(p_observacoes), ''), observacoes),
        updated_at = now()
    where id = l.documento_id and empresa_id = v.empresa_id;

    update public.rh_ferias
    set importacao_status = 'conferida',
        observacoes = coalesce(nullif(trim(p_observacoes), ''), observacoes),
        updated_at = now()
    where id = l.ferias_id and empresa_id = v.empresa_id;

    v_count := 1;
  end loop;

  if v_count = 0 then
    return jsonb_build_object('sucesso', false, 'erro', 'Linha de importação não encontrada');
  end if;

  update public.rh_ferias_importacoes i
  set linhas_pendentes = (
        select count(*)
        from public.rh_ferias_import_linhas x
        where x.importacao_id = i.id
          and x.status in ('pendente', 'vinculada', 'divergente')
      ),
      status = case when (
        select count(*)
        from public.rh_ferias_import_linhas x
        where x.importacao_id = i.id
          and x.status in ('pendente', 'vinculada', 'divergente')
      ) = 0 then 'conferida' else 'parcial' end,
      updated_at = now()
  where i.id = (
    select importacao_id from public.rh_ferias_import_linhas where id = p_id limit 1
  );

  return jsonb_build_object('sucesso', true, 'id', p_id);
end;
$$;

grant execute on function public.app_admin_confirmar_ferias_importacao(text, uuid, text) to anon, authenticated;
