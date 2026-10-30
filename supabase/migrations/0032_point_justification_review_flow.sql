-- Fluxo completo de justificativa na ficha de ponto: decisão do RH, recusa com motivo
-- e retorno do resultado para o funcionário na própria tela.
alter table public.ponto_inconsistencias drop constraint if exists ponto_inconsistencias_status_check;
alter table public.ponto_inconsistencias add constraint ponto_inconsistencias_status_check
  check (status in ('pendente','aprovada','justificada','recusada'));

create or replace function public.app_decidir_justificativa_ponto(
  p_token text,
  p_id uuid,
  p_status text,
  p_resposta text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_justificativa record;
  v_resposta text;
  v_inconsistencia_status text;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  end if;
  if p_status not in ('aceita','recusada','pendente') then
    return jsonb_build_object('sucesso', false, 'erro', 'Status de decisão inválido');
  end if;

  select j.id, j.funcionario_id, j.data_registro
    into v_justificativa
  from public.justificativas_ponto j
  join public.funcionarios f on f.id = j.funcionario_id
  where j.id = p_id and f.empresa_id = v_usuario.empresa_id
  limit 1;

  if v_justificativa.id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Justificativa não encontrada');
  end if;

  v_resposta := nullif(trim(coalesce(p_resposta, '')), '');
  if p_status = 'recusada' and v_resposta is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Informe o motivo da recusa');
  end if;
  v_inconsistencia_status := case
    when p_status = 'aceita' then 'justificada'
    when p_status = 'recusada' then 'recusada'
    else 'pendente'
  end;

  update public.justificativas_ponto
     set status = p_status,
         resposta_rh = v_resposta,
         analisado_por = v_usuario.usuario_id,
         analisado_em = case when p_status = 'pendente' then null else now() end,
         updated_at = now()
   where id = v_justificativa.id;

  update public.ponto_inconsistencias
     set status = v_inconsistencia_status,
         justificativa = coalesce(v_resposta, justificativa),
         analisado_por = v_usuario.usuario_id,
         analisado_em = case when p_status = 'pendente' then null else now() end,
         updated_at = now()
   where funcionario_id = v_justificativa.funcionario_id
     and data = v_justificativa.data_registro
     and tipo = 'ponto';

  insert into public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  values (
    v_usuario.usuario_id,
    case when p_status = 'aceita' then 'aceitou_justificativa_ponto'
         when p_status = 'recusada' then 'recusou_justificativa_ponto'
         else 'reabriu_justificativa_ponto' end,
    'justificativas_ponto',
    jsonb_build_object('justificativa_id', p_id, 'funcionario_id', v_justificativa.funcionario_id,
      'data', v_justificativa.data_registro, 'status', p_status, 'tem_resposta', v_resposta is not null)
  );

  return jsonb_build_object('sucesso', true, 'status', p_status);
end;
$$;

grant execute on function public.app_decidir_justificativa_ponto(text, uuid, text, text) to anon, authenticated;

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

  v_global := v_usuario.perfil in ('admin','administrador','gestor');
  if not v_global and p_funcionario_id is not null and p_funcionario_id <> v_usuario.funcionario_id then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso restrito ao seu próprio ponto');
  end if;
  v_funcionario_id := case when v_global then p_funcionario_id else v_usuario.funcionario_id end;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc, x.nome), '[]'::jsonb)
    into v_result
  from (
    select
      r.id, r.funcionario_id, r.data, r.entrada, r.saida_almoco, r.volta_almoco, r.saida,
      r.horas_trabalhadas, r.status, f.nome, f.cpf, f.cargo,
      imp.previsto, imp.extra_50, imp.extra_100, imp.dia_falta, imp.horas_atraso,
      imp.desconta_dsr, imp.justificativas, imp.inconsistencia,
      case
        when nullif(trim(coalesce(imp.dia_falta,'')), '') is not null then 'falta'
        when nullif(trim(coalesce(imp.horas_atraso,'')), '') is not null then 'atraso'
        when nullif(trim(coalesce(imp.inconsistencia,'')), '') is not null then 'inconsistencia'
        else null
      end as inconsistencia_tipo,
      coalesce(inc.status, 'pendente') as inconsistencia_status,
      coalesce(inc.justificativa, j.motivo) as inconsistencia_justificativa,
      j.id as justificativa_id,
      j.status as justificativa_status,
      j.motivo as justificativa_motivo,
      j.resposta_rh as justificativa_resposta,
      j.arquivo_url as justificativa_arquivo_url,
      j.arquivo_nome as justificativa_arquivo_nome
    from public.registros_ponto r
    join public.funcionarios f on f.id = r.funcionario_id
    left join lateral (
      select l.previsto, l.extra_50, l.extra_100, l.dia_falta, l.horas_atraso,
        l.desconta_dsr, l.justificativas, l.inconsistencia
      from public.ponto_import_linhas l
      join public.ponto_importacoes i on i.id = l.importacao_id
      where l.funcionario_id = r.funcionario_id and l.data = r.data and i.status = 'aplicada'
      order by i.created_at desc limit 1
    ) imp on true
    left join lateral (
      select p.status, p.justificativa
      from public.ponto_inconsistencias p
      where p.funcionario_id = r.funcionario_id and p.data = r.data and p.tipo = 'ponto'
      order by p.updated_at desc limit 1
    ) inc on true
    left join lateral (
      select j.id, j.status, j.motivo, j.resposta_rh, j.arquivo_url, j.arquivo_nome
      from public.justificativas_ponto j
      where j.funcionario_id = r.funcionario_id and j.data_registro = r.data
      order by j.created_at desc limit 1
    ) j on true
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
