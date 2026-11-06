begin;

create or replace function public.app_admin_relatorio_atestados(
  p_token text, p_inicio date default null, p_fim date default null
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v record;
  v_linhas jsonb;
  v_total integer;
  v_pendentes integer;
  v_aceitos integer;
  v_recusados integer;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin','administrador') then
    return jsonb_build_object('sucesso',false,'erro','Relatório disponível somente para administradores');
  end if;
  select count(*)::int,
    count(*) filter (where lower(coalesce(a.status,'')) in ('aguardando','pendente','em_analise'))::int,
    count(*) filter (where lower(coalesce(a.status,'')) in ('aceito','aceita','aprovado','aprovada'))::int,
    count(*) filter (where lower(coalesce(a.status,'')) in ('recusado','recusada','reprovado','reprovada'))::int
  into v_total,v_pendentes,v_aceitos,v_recusados
  from public.atestados a join public.funcionarios f on f.id=a.funcionario_id and f.empresa_id=v.empresa_id
  where (p_inicio is null or a.data_atendimento >= p_inicio)
    and (p_fim is null or a.data_atendimento <= p_fim);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data_atendimento desc, x.nome), '[]'::jsonb)
  into v_linhas
  from (
    select a.id, f.nome, a.tipo, a.data_atendimento, a.dias, a.status,
      a.status_label, a.cid, a.arquivo_nome, a.created_at, a.conferido_em
    from public.atestados a
    join public.funcionarios f on f.id=a.funcionario_id and f.empresa_id=v.empresa_id
    where (p_inicio is null or a.data_atendimento >= p_inicio)
      and (p_fim is null or a.data_atendimento <= p_fim)
    order by a.data_atendimento desc, f.nome
    limit 500
  ) x;
  return jsonb_build_object('sucesso',true,'inicio',p_inicio,'fim',p_fim,
    'resumo',jsonb_build_object('total',v_total,'pendentes',v_pendentes,'aceitos',v_aceitos,'recusados',v_recusados),
    'linhas',v_linhas);
end; $$;

grant execute on function public.app_admin_relatorio_atestados(text,date,date) to anon,authenticated;

create or replace function public.app_admin_relatorio_solicitacoes(
  p_token text, p_inicio date default null, p_fim date default null
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v record;
  v_linhas jsonb;
  v_total integer;
  v_abertas integer;
  v_em_analise integer;
  v_atendidas integer;
  v_recusadas integer;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin','administrador') then
    return jsonb_build_object('sucesso',false,'erro','Relatório disponível somente para administradores');
  end if;
  select count(*)::int,
    count(*) filter (where lower(coalesce(s.status,'')) in ('pendente','aberta','nova'))::int,
    count(*) filter (where lower(coalesce(s.status,''))='em_analise')::int,
    count(*) filter (where lower(coalesce(s.status,'')) in ('atendida','concluida','aprovada'))::int,
    count(*) filter (where lower(coalesce(s.status,'')) in ('recusada','reprovada'))::int
  into v_total,v_abertas,v_em_analise,v_atendidas,v_recusadas
  from public.rh_solicitacoes s join public.funcionarios f on f.id=s.funcionario_id and f.empresa_id=v.empresa_id
  where (p_inicio is null or s.created_at::date >= p_inicio)
    and (p_fim is null or s.created_at::date <= p_fim);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.nome), '[]'::jsonb)
  into v_linhas
  from (
    select s.id, f.nome, s.tipo, s.descricao, s.status, s.resposta,
      s.anexo_nome, s.created_at, s.analisado_em
    from public.rh_solicitacoes s
    join public.funcionarios f on f.id=s.funcionario_id and f.empresa_id=v.empresa_id
    where (p_inicio is null or s.created_at::date >= p_inicio)
      and (p_fim is null or s.created_at::date <= p_fim)
    order by s.created_at desc, f.nome
    limit 500
  ) x;
  return jsonb_build_object('sucesso',true,'inicio',p_inicio,'fim',p_fim,
    'resumo',jsonb_build_object('total',v_total,'abertas',v_abertas,'em_analise',v_em_analise,'atendidas',v_atendidas,'recusadas',v_recusadas),
    'linhas',v_linhas);
end; $$;

grant execute on function public.app_admin_relatorio_solicitacoes(text,date,date) to anon,authenticated;

commit;
