begin;

-- Reassocia o histórico ainda sem tenant usando relações existentes; não altera status nem remove dados.
update public.ponto_importacoes i
set empresa_id=u.empresa_id
from public.usuarios u
where i.empresa_id is null and i.imported_by=u.id and u.empresa_id is not null;

update public.ponto_import_linhas l
set empresa_id=i.empresa_id
from public.ponto_importacoes i
where l.empresa_id is null and l.importacao_id=i.id and i.empresa_id is not null;

update public.justificativas_ponto j
set empresa_id=f.empresa_id
from public.funcionarios f
where j.empresa_id is null and j.funcionario_id=f.id and f.empresa_id is not null;

-- As RPCs SECURITY DEFINER administrativas precisam filtrar pelo tenant da sessão.
create or replace function public.app_admin_ponto(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_result jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or coalesce(v.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso negado');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc,x.nome),'[]'::jsonb)
  into v_result
  from (
    select r.id,r.data,r.entrada,r.saida_almoco,r.volta_almoco,r.saida,r.horas_trabalhadas,r.status,
           f.id as funcionario_id,f.nome,f.cpf,f.cargo
    from public.registros_ponto r
    join public.funcionarios f on f.id=r.funcionario_id
    where f.empresa_id=v.empresa_id and f.ativo=true
    order by r.data desc,f.nome
    limit 3000
  ) x;

  return jsonb_build_object('sucesso',true,'registros',v_result);
end;
$$;

create or replace function public.app_admin_justificativas(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_result jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or coalesce(v.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso negado');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.data_registro desc),'[]'::jsonb)
  into v_result
  from (
    select j.id,j.funcionario_id,j.data_registro,j.tipo,j.motivo,j.arquivo_nome,j.status,
           j.resposta_rh,j.analisado_em,f.nome,f.cpf
    from public.justificativas_ponto j
    join public.funcionarios f on f.id=j.funcionario_id and f.empresa_id=j.empresa_id
    where j.empresa_id=v.empresa_id
    order by j.data_registro desc
    limit 500
  ) x;

  return jsonb_build_object('sucesso',true,'justificativas',v_result);
end;
$$;

create or replace function public.app_admin_decidir_justificativa(
  p_token text,p_id uuid,p_status text,p_resposta text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or coalesce(v.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso negado');
  end if;
  if p_status is null or p_status not in ('aceita','recusada','pendente') then
    return jsonb_build_object('sucesso',false,'erro','Status inválido');
  end if;

  update public.justificativas_ponto j
  set status=p_status,
      resposta_rh=trim(p_resposta),
      analisado_por=v.usuario_id,
      analisado_em=case when p_status='pendente' then null else now() end,
      updated_at=now()
  where j.id=p_id
    and j.empresa_id=v.empresa_id
    and exists (
      select 1 from public.funcionarios f
      where f.id=j.funcionario_id and f.empresa_id=v.empresa_id
    );
  if not found then return jsonb_build_object('sucesso',false,'erro','Justificativa não encontrada'); end if;

  return jsonb_build_object('sucesso',true);
end;
$$;

-- Novas importações e cada linha recebem empresa_id da sessão, não do arquivo recebido.
create or replace function public.app_importar_ponto(
  p_token text,p_tipo text,p_competencia text,p_arquivo_nome text,p_linhas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_importacao uuid;
  v_linha jsonb;
  v_funcionario_id uuid;
  v_total integer := 0;
  v_encontradas integer := 0;
  v_nao_encontradas integer := 0;
  v_cpfs jsonb := '[]'::jsonb;
  v_data date;
  v_cpf text;
  v_nome text;
  v_inconsistencia text;
  v_e1 time;
  v_s1 time;
  v_e2 time;
  v_s2 time;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.empresa_id is null
     or coalesce(v_usuario.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo');
  end if;
  if p_tipo is null or p_tipo not in ('diario','mensal') or jsonb_typeof(p_linhas) is distinct from 'array' then
    return jsonb_build_object('sucesso',false,'erro','Arquivo de ponto inválido');
  end if;
  if jsonb_array_length(p_linhas) > 5000 then
    return jsonb_build_object('sucesso',false,'erro','O arquivo excede o limite de 5.000 linhas');
  end if;

  insert into public.ponto_importacoes(empresa_id,tipo,competencia,arquivo_nome,imported_by,status)
  values(v_usuario.empresa_id,p_tipo,p_competencia,coalesce(nullif(trim(p_arquivo_nome),''),'ponto.csv'),v_usuario.usuario_id,'pendente')
  returning id into v_importacao;

  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_total := v_total + 1;
    v_funcionario_id := null;
    v_inconsistencia := null;
    v_cpf := regexp_replace(coalesce(v_linha->>'cpf',''),'[^0-9]','','g');
    v_nome := coalesce(nullif(trim(v_linha->>'nome'),''),'Nome não informado');
    begin
      v_data := (v_linha->>'data')::date;
    exception when others then
      v_data := null;
    end;

    if length(v_cpf) <> 11 then
      v_inconsistencia := 'CPF ausente ou inválido';
    elsif v_data is null then
      v_inconsistencia := 'Data do registro inválida';
    else
      select f.id into v_funcionario_id
      from public.funcionarios f
      where regexp_replace(f.cpf,'[^0-9]','','g')=v_cpf
        and f.empresa_id=v_usuario.empresa_id
        and f.ativo=true
      limit 1;
      if v_funcionario_id is null then v_inconsistencia := 'CPF não encontrado no cadastro ativo'; end if;
    end if;

    v_e1 := case when trim(coalesce(v_linha->>'entrada_1','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'entrada_1') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    v_s1 := case when trim(coalesce(v_linha->>'saida_1','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'saida_1') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    v_e2 := case when trim(coalesce(v_linha->>'entrada_2','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'entrada_2') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    v_s2 := case when trim(coalesce(v_linha->>'saida_2','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'saida_2') from '^[0-9]{2}:[0-9]{2}')::time else null end;

    insert into public.ponto_import_linhas(
      empresa_id,importacao_id,funcionario_id,cpf,nome_csv,data,previsto,entrada_1,saida_1,
      entrada_2,saida_2,total_normais,total_noturno,dia_falta,horas_atraso,abono,extra_50,
      extra_100,desconta_dsr,justificativas,encontrado,inconsistencia,raw_data
    ) values (
      v_usuario.empresa_id,v_importacao,v_funcionario_id,v_cpf,v_nome,v_data,
      v_linha->>'previsto',v_e1,v_s1,v_e2,v_s2,v_linha->>'total_normais',v_linha->>'total_noturno',
      v_linha->>'dia_falta',v_linha->>'horas_atraso',v_linha->>'abono',v_linha->>'extra_50',
      v_linha->>'extra_100',v_linha->>'desconta_dsr',v_linha->>'justificativas',
      v_funcionario_id is not null,v_inconsistencia,v_linha
    );

    if v_funcionario_id is null then
      v_nao_encontradas := v_nao_encontradas + 1;
      v_cpfs := v_cpfs || jsonb_build_array(case when v_cpf='' then v_nome else v_cpf end);
    else
      v_encontradas := v_encontradas + 1;
    end if;
  end loop;

  update public.ponto_importacoes
  set total_linhas=v_total,linhas_encontradas=v_encontradas,
      linhas_nao_encontradas=v_nao_encontradas,cpfs_nao_encontrados=v_cpfs
  where id=v_importacao and empresa_id=v_usuario.empresa_id;

  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  values(v_usuario.usuario_id,'analisou_importacao_ponto','ponto_importacoes',
    jsonb_build_object('importacao_id',v_importacao,'tipo',p_tipo,'competencia',p_competencia,
      'total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas));

  return jsonb_build_object('sucesso',true,'importacao_id',v_importacao,'status','pendente',
    'total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas,
    'cpfs_nao_encontrados',v_cpfs);
end;
$$;

create or replace function public.app_aplicar_importacao_ponto(p_token text,p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_importacao record;
  v_aplicadas integer;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.empresa_id is null
     or coalesce(v_usuario.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo');
  end if;

  select * into v_importacao
  from public.ponto_importacoes
  where id=p_importacao_id and empresa_id=v_usuario.empresa_id
  for update;
  if v_importacao.id is null then return jsonb_build_object('sucesso',false,'erro','Importação não encontrada'); end if;
  if v_importacao.status <> 'pendente' then return jsonb_build_object('sucesso',false,'erro','Esta importação já foi processada'); end if;

  insert into public.registros_ponto(funcionario_id,data,entrada,saida_almoco,volta_almoco,saida,status)
  select l.funcionario_id,l.data,l.entrada_1,l.saida_1,l.entrada_2,l.saida_2,
         case when coalesce(trim(l.dia_falta),'')<>'' then 'falta' else 'normal' end
  from public.ponto_import_linhas l
  join public.funcionarios f on f.id=l.funcionario_id and f.empresa_id=v_usuario.empresa_id
  where l.importacao_id=p_importacao_id and l.empresa_id=v_usuario.empresa_id
    and l.encontrado=true and l.funcionario_id is not null
  on conflict (funcionario_id,data) do update
    set entrada=excluded.entrada,saida_almoco=excluded.saida_almoco,
        volta_almoco=excluded.volta_almoco,saida=excluded.saida,status=excluded.status;
  get diagnostics v_aplicadas = row_count;

  update public.ponto_importacoes
  set status='aplicada',applied_at=now(),applied_by=v_usuario.usuario_id
  where id=p_importacao_id and empresa_id=v_usuario.empresa_id;

  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  values(v_usuario.usuario_id,'aplicou_importacao_ponto','ponto_importacoes',
    jsonb_build_object('importacao_id',p_importacao_id,'linhas_aplicadas',v_aplicadas,
      'linhas_inconsistentes',v_importacao.linhas_nao_encontradas));

  return jsonb_build_object('sucesso',true,'status','aplicada','linhas_aplicadas',v_aplicadas,
    'linhas_inconsistentes',v_importacao.linhas_nao_encontradas);
end;
$$;

create or replace function public.app_ignorar_importacao_ponto(p_token text,p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_status text;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.empresa_id is null
     or coalesce(v_usuario.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo');
  end if;

  select i.status into v_status
  from public.ponto_importacoes i
  where i.id=p_importacao_id and i.empresa_id=v_usuario.empresa_id
  for update;
  if v_status is null then return jsonb_build_object('sucesso',false,'erro','Importação não encontrada'); end if;

  update public.ponto_importacoes
  set status=case when status='aplicada' then status else 'ignorada' end,
      archived_at=coalesce(archived_at,now())
  where id=p_importacao_id and empresa_id=v_usuario.empresa_id;

  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  values(v_usuario.usuario_id,'arquivou_importacao_ponto','ponto_importacoes',
    jsonb_build_object('importacao_id',p_importacao_id,'status_anterior',v_status));

  return jsonb_build_object('sucesso',true,
    'status',case when v_status='aplicada' then 'aplicada' else 'ignorada' end);
end;
$$;

create or replace function public.app_listar_importacoes(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_result jsonb;
begin
  select * into v_usuario from public.app_tenant_usuario(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.empresa_id is null
     or coalesce(v_usuario.perfil,'') not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso negado');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select i.id,i.tipo,i.competencia,i.arquivo_nome,i.imported_by,i.total_linhas,
           i.linhas_encontradas,i.linhas_nao_encontradas,i.cpfs_nao_encontrados,
           i.status,i.applied_at,i.archived_at,i.created_at,
           coalesce(f.nome,u.nome_exibicao,'Usuário') as imported_by_name
    from public.ponto_importacoes i
    left join public.usuarios u on u.id=i.imported_by and u.empresa_id=i.empresa_id
    left join public.funcionarios f on f.id=u.funcionario_id and f.empresa_id=i.empresa_id
    where i.empresa_id=v_usuario.empresa_id
    order by i.created_at desc
    limit 50
  ) x;

  return jsonb_build_object('sucesso',true,'importacoes',v_result);
end;
$$;

-- A justificativa deve corresponder a um registro do funcionário autenticado no tenant.
create or replace function public.app_criar_justificativa_ponto(
  p_token text,p_data date,p_tipo text,p_motivo text,
  p_arquivo_url text default null,p_arquivo_nome text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_registro uuid;
  v_id uuid;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or v.funcionario_id is null then
    return jsonb_build_object('sucesso',false,'erro','Sessão sem funcionário vinculado');
  end if;
  if p_data is null or length(trim(coalesce(p_motivo,'')))<5 then
    return jsonb_build_object('sucesso',false,'erro','Informe a data e uma justificativa com pelo menos 5 caracteres');
  end if;

  select r.id into v_registro
  from public.registros_ponto r
  join public.funcionarios f on f.id=r.funcionario_id and f.empresa_id=v.empresa_id
  where r.funcionario_id=v.funcionario_id and r.data=p_data
  limit 1;
  if v_registro is null then
    return jsonb_build_object('sucesso',false,'erro','Não há registro de ponto para a data informada');
  end if;

  insert into public.justificativas_ponto(
    funcionario_id,registro_ponto_id,data_registro,tipo,motivo,arquivo_url,arquivo_nome,status,empresa_id
  ) values (
    v.funcionario_id,v_registro,p_data,coalesce(nullif(trim(p_tipo),''),'Ponto'),trim(p_motivo),
    nullif(trim(coalesce(p_arquivo_url,'')),''),nullif(trim(coalesce(p_arquivo_nome,'')),''),'pendente',v.empresa_id
  ) returning id into v_id;

  insert into public.ponto_inconsistencias(empresa_id,funcionario_id,data,tipo,detalhe,status,justificativa,updated_at)
  values(v.empresa_id,v.funcionario_id,p_data,'ponto',coalesce(nullif(trim(p_tipo),''),'Ponto'),'pendente',trim(p_motivo),now())
  on conflict(funcionario_id,data,tipo) do update
    set detalhe=excluded.detalhe,status='pendente',justificativa=excluded.justificativa,
        updated_at=now(),analisado_por=null,analisado_em=null;

  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  values(v.usuario_id,'enviou_justificativa_ponto','justificativas_ponto',
    jsonb_build_object('justificativa_id',v_id,'data',p_data,'tipo',p_tipo,'tem_anexo',p_arquivo_url is not null));

  return jsonb_build_object('sucesso',true,'id',v_id,'status','pendente');
end;
$$;

revoke all on function public.app_admin_ponto(text) from public;
revoke all on function public.app_admin_justificativas(text) from public;
revoke all on function public.app_admin_decidir_justificativa(text,uuid,text,text) from public;
revoke all on function public.app_importar_ponto(text,text,text,text,jsonb) from public;
revoke all on function public.app_aplicar_importacao_ponto(text,uuid) from public;
revoke all on function public.app_ignorar_importacao_ponto(text,uuid) from public;
revoke all on function public.app_listar_importacoes(text) from public;
revoke all on function public.app_criar_justificativa_ponto(text,date,text,text,text,text) from public;

grant execute on function public.app_admin_ponto(text) to anon,authenticated;
grant execute on function public.app_admin_justificativas(text) to anon,authenticated;
grant execute on function public.app_admin_decidir_justificativa(text,uuid,text,text) to anon,authenticated;
grant execute on function public.app_importar_ponto(text,text,text,text,jsonb) to anon,authenticated;
grant execute on function public.app_aplicar_importacao_ponto(text,uuid) to anon,authenticated;
grant execute on function public.app_ignorar_importacao_ponto(text,uuid) to anon,authenticated;
grant execute on function public.app_listar_importacoes(text) to anon,authenticated;
grant execute on function public.app_criar_justificativa_ponto(text,date,text,text,text,text) to anon,authenticated;

comment on function public.app_admin_ponto(text) is 'Lista ponto restrito ao tenant da sessão administrativa.';
comment on function public.app_admin_justificativas(text) is 'Lista justificativas restritas ao tenant da sessão administrativa.';
comment on function public.app_admin_decidir_justificativa(text,uuid,text,text) is 'Decide justificativas somente dentro do tenant da sessão administrativa.';
comment on function public.app_importar_ponto(text,text,text,text,jsonb) is 'Importa ponto com empresa_id derivado da sessão e funcionário restrito ao mesmo tenant.';
comment on function public.app_aplicar_importacao_ponto(text,uuid) is 'Aplica importação de ponto somente se pertencer ao tenant da sessão.';
comment on function public.app_ignorar_importacao_ponto(text,uuid) is 'Arquiva importação somente se pertencer ao tenant da sessão.';
comment on function public.app_listar_importacoes(text) is 'Lista importações de ponto do tenant da sessão.';
comment on function public.app_criar_justificativa_ponto(text,date,text,text,text,text) is 'Cria justificativa vinculada a registro de ponto existente do funcionário autenticado.';

commit;
