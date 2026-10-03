-- Escopo de indicadores por perfil e bucket privado para documentos de RH.

insert into storage.buckets (id, name, public)
values ('documentos-privados', 'documentos-privados', false)
on conflict (id) do update set public = false;

create or replace function public.app_dashboard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_total integer;
  v_ferias integer;
  v_afastados integer;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  end if;

  if v_usuario.perfil not in ('admin','administrador','gestor') then
    return jsonb_build_object(
      'sucesso', true,
      'perfil', v_usuario.perfil,
      'nome', v_usuario.nome,
      'cargo', coalesce(v_usuario.cargo,''),
      'indicadores', jsonb_build_object(
        'funcionarios_ativos', 0,
        'em_ferias', 0,
        'em_afastamento', 0,
        'ordens_ativas', 0,
        'lotes_em_costura', 0,
        'contas_pendentes', 0,
        'saldo_dividas', 0
      )
    );
  end if;

  select count(*)::int into v_total from public.funcionarios where ativo = true;
  select count(*)::int into v_ferias from public.rh_ferias where status in ('agendada','em_gozo') and (inicio is null or inicio <= current_date) and (fim is null or fim >= current_date);
  select count(*)::int into v_afastados from public.rh_afastamentos where status = 'ativo' and inicio <= current_date and (fim is null or fim >= current_date);

  return jsonb_build_object(
    'sucesso', true,
    'perfil', v_usuario.perfil,
    'nome', v_usuario.nome,
    'cargo', coalesce(v_usuario.cargo,''),
    'indicadores', jsonb_build_object(
      'funcionarios_ativos', v_total,
      'em_ferias', v_ferias,
      'em_afastamento', v_afastados,
      'ordens_ativas', (select count(*)::int from public.ordens_servico where status in ('recebida','em_producao','costurada')),
      'lotes_em_costura', (select count(*)::int from public.producao_lotes where status = 'em_costura'),
      'contas_pendentes', (select count(*)::int from public.financeiro_lancamentos where status in ('pendente','vencido')),
      'saldo_dividas', coalesce((select sum(saldo_devedor) from public.dividas_gestao where status <> 'quitada'), 0)
    )
  );
end;
$$;
