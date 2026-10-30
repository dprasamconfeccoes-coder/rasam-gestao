-- Ponto: funcionário vê somente seus registros; admin/administrador podem consultar a equipe com filtros.
drop function if exists public.app_listar_ponto(text, integer);

create or replace function public.app_listar_ponto(
  p_token text,
  p_limite integer default 180,
  p_inicio date default null,
  p_fim date default null,
  p_funcionario_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_result jsonb;
  v_global boolean;
  v_funcionario_id uuid;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  end if;

  v_global := v_usuario.perfil in ('admin', 'administrador');
  if not v_global and p_funcionario_id is not null and p_funcionario_id <> v_usuario.funcionario_id then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao seu próprio ponto');
  end if;
  v_funcionario_id := case when v_global then p_funcionario_id else v_usuario.funcionario_id end;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc, x.nome), '[]'::jsonb)
    into v_result
  from (
    select
      r.id,
      r.funcionario_id,
      r.data,
      r.entrada,
      r.saida_almoco,
      r.volta_almoco,
      r.saida,
      r.horas_trabalhadas,
      r.status,
      f.nome,
      f.cpf,
      f.cargo
    from public.registros_ponto r
    join public.funcionarios f on f.id = r.funcionario_id
    where f.empresa_id = v_usuario.empresa_id
      and (v_funcionario_id is null or r.funcionario_id = v_funcionario_id)
      and (p_inicio is null or r.data >= p_inicio)
      and (p_fim is null or r.data <= p_fim)
    order by r.data desc, f.nome
    limit least(greatest(coalesce(p_limite, 180), 1), 1000)
  ) x;

  return jsonb_build_object(
    'sucesso', true,
    'registros', v_result,
    'escopo', case when v_global then 'equipe' else 'individual' end,
    'perfil', v_usuario.perfil,
    'funcionario_id', v_funcionario_id,
    'inicio', p_inicio,
    'fim', p_fim
  );
end;
$$;

grant execute on function public.app_listar_ponto(text, integer, date, date, uuid) to anon, authenticated;
