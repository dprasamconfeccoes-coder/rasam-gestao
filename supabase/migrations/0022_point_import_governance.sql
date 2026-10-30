-- Governança da importação de ponto: prévia, aplicação parcial, status e rastreabilidade.
alter table public.ponto_importacoes
  add column if not exists status text,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by uuid references public.usuarios(id),
  add column if not exists archived_at timestamptz;

update public.ponto_importacoes
   set status = case when linhas_encontradas > 0 then 'aplicada' else 'pendente' end
 where status is null or status = '';

alter table public.ponto_importacoes
  alter column status set default 'pendente',
  alter column status set not null;

alter table public.ponto_importacoes
  drop constraint if exists ponto_importacoes_status_check;
alter table public.ponto_importacoes
  add constraint ponto_importacoes_status_check
  check (status in ('pendente','aplicada','ignorada'));

alter table public.ponto_import_linhas
  add column if not exists inconsistencia text;

create or replace function public.app_importar_ponto(
  p_token text, p_tipo text, p_competencia text, p_arquivo_nome text, p_linhas jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_usuario record; v_importacao uuid; v_linha jsonb; v_funcionario_id uuid;
  v_total integer := 0; v_encontradas integer := 0; v_nao_encontradas integer := 0;
  v_cpfs jsonb := '[]'::jsonb; v_data date; v_cpf text; v_nome text; v_inconsistencia text;
  v_e1 time; v_s1 time; v_e2 time; v_s2 time;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo');
  end if;
  if p_tipo not in ('diario','mensal') or jsonb_typeof(p_linhas) <> 'array' then
    return jsonb_build_object('sucesso',false,'erro','Arquivo de ponto inválido');
  end if;

  insert into public.ponto_importacoes(tipo,competencia,arquivo_nome,imported_by,status)
  values (p_tipo,p_competencia,coalesce(nullif(trim(p_arquivo_nome),''),'ponto.csv'),v_usuario.usuario_id,'pendente')
  returning id into v_importacao;

  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_total := v_total + 1;
    v_funcionario_id := null;
    v_inconsistencia := null;
    v_cpf := regexp_replace(coalesce(v_linha->>'cpf',''),'[^0-9]','','g');
    v_nome := coalesce(nullif(trim(v_linha->>'nome'),''),'Nome não informado');
    begin v_data := (v_linha->>'data')::date; exception when others then v_data := null; end;

    if length(v_cpf) <> 11 then
      v_inconsistencia := 'CPF ausente ou inválido';
    elsif v_data is null then
      v_inconsistencia := 'Data do registro inválida';
    else
      select f.id into v_funcionario_id from public.funcionarios f
      where regexp_replace(f.cpf,'[^0-9]','','g') = v_cpf and f.ativo = true limit 1;
      if v_funcionario_id is null then v_inconsistencia := 'CPF não encontrado no cadastro ativo'; end if;
    end if;

    v_e1 := case when (v_linha->>'entrada_1') ~ '^\d{2}:\d{2}' then (v_linha->>'entrada_1')::time else null end;
    v_s1 := case when (v_linha->>'saida_1') ~ '^\d{2}:\d{2}' then (v_linha->>'saida_1')::time else null end;
    v_e2 := case when (v_linha->>'entrada_2') ~ '^\d{2}:\d{2}' then (v_linha->>'entrada_2')::time else null end;
    v_s2 := case when (v_linha->>'saida_2') ~ '^\d{2}:\d{2}' then (v_linha->>'saida_2')::time else null end;

    insert into public.ponto_import_linhas(importacao_id,funcionario_id,cpf,nome_csv,data,previsto,entrada_1,saida_1,entrada_2,saida_2,total_normais,total_noturno,dia_falta,horas_atraso,abono,extra_50,extra_100,desconta_dsr,justificativas,encontrado,inconsistencia,raw_data)
    values (v_importacao,v_funcionario_id,v_cpf,v_nome,coalesce(v_data,current_date),v_linha->>'previsto',v_e1,v_s1,v_e2,v_s2,v_linha->>'total_normais',v_linha->>'total_noturno',v_linha->>'dia_falta',v_linha->>'horas_atraso',v_linha->>'abono',v_linha->>'extra_50',v_linha->>'extra_100',v_linha->>'desconta_dsr',v_linha->>'justificativas',v_funcionario_id is not null,v_inconsistencia,v_linha);

    if v_funcionario_id is null then
      v_nao_encontradas := v_nao_encontradas + 1;
      v_cpfs := v_cpfs || jsonb_build_array(case when v_cpf = '' then v_nome else v_cpf end);
    else
      v_encontradas := v_encontradas + 1;
    end if;
  end loop;

  update public.ponto_importacoes set total_linhas=v_total,linhas_encontradas=v_encontradas,linhas_nao_encontradas=v_nao_encontradas,cpfs_nao_encontrados=v_cpfs where id=v_importacao;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  values (v_usuario.usuario_id,'analisou_importacao_ponto','ponto_importacoes',jsonb_build_object('importacao_id',v_importacao,'tipo',p_tipo,'competencia',p_competencia,'total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas));
  return jsonb_build_object('sucesso',true,'importacao_id',v_importacao,'status','pendente','total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas,'cpfs_nao_encontrados',v_cpfs);
end; $$;

create or replace function public.app_aplicar_importacao_ponto(p_token text, p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_usuario record; v_importacao record; v_aplicadas integer;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo'); end if;
  select * into v_importacao from public.ponto_importacoes where id=p_importacao_id for update;
  if v_importacao.id is null then return jsonb_build_object('sucesso',false,'erro','Importação não encontrada'); end if;
  if v_importacao.status <> 'pendente' then return jsonb_build_object('sucesso',false,'erro','Esta importação já foi processada'); end if;

  insert into public.registros_ponto(funcionario_id,data,entrada,saida_almoco,volta_almoco,saida,status)
  select funcionario_id,data,entrada_1,saida_1,entrada_2,saida_2,case when coalesce(trim(dia_falta),'') <> '' then 'falta' else 'normal' end
    from public.ponto_import_linhas
   where importacao_id=p_importacao_id and encontrado=true and funcionario_id is not null
  on conflict (funcionario_id,data) do update set entrada=excluded.entrada,saida_almoco=excluded.saida_almoco,volta_almoco=excluded.volta_almoco,saida=excluded.saida,status=excluded.status;
  get diagnostics v_aplicadas = row_count;

  update public.ponto_importacoes set status='aplicada',applied_at=now(),applied_by=v_usuario.usuario_id where id=p_importacao_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values (v_usuario.usuario_id,'aplicou_importacao_ponto','ponto_importacoes',jsonb_build_object('importacao_id',p_importacao_id,'linhas_aplicadas',v_aplicadas,'linhas_inconsistentes',v_importacao.linhas_nao_encontradas));
  return jsonb_build_object('sucesso',true,'status','aplicada','linhas_aplicadas',v_aplicadas,'linhas_inconsistentes',v_importacao.linhas_nao_encontradas);
end; $$;

create or replace function public.app_ignorar_importacao_ponto(p_token text, p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_usuario record; v_status text;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo'); end if;
  select status into v_status from public.ponto_importacoes where id=p_importacao_id;
  if v_status is null then return jsonb_build_object('sucesso',false,'erro','Importação não encontrada'); end if;
  update public.ponto_importacoes set status='ignorada',archived_at=coalesce(archived_at,now()) where id=p_importacao_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values (v_usuario.usuario_id,'ignorou_importacao_ponto','ponto_importacoes',jsonb_build_object('importacao_id',p_importacao_id));
  return jsonb_build_object('sucesso',true,'status','ignorada');
end; $$;

drop function if exists public.app_listar_ponto_importado(text,text);
create or replace function public.app_listar_ponto_importado(p_token text,p_tipo text default null,p_importacao_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
  select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
  if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc,x.nome_csv),'[]'::jsonb) into v_result
    from (select l.id,l.cpf,l.nome_csv,l.data,l.entrada_1,l.saida_1,l.entrada_2,l.saida_2,l.total_normais,l.extra_50,l.extra_100,l.dia_falta,l.horas_atraso,l.justificativas,l.encontrado,l.inconsistencia,i.tipo,i.competencia,i.status
            from public.ponto_import_linhas l join public.ponto_importacoes i on i.id=l.importacao_id
           where (p_tipo is null or i.tipo=p_tipo) and (p_importacao_id is null or i.id=p_importacao_id)
           order by l.data desc limit 1500) x;
  return jsonb_build_object('sucesso',true,'registros',v_result);
end; $$;

grant execute on function public.app_aplicar_importacao_ponto(text,uuid) to anon,authenticated;
grant execute on function public.app_ignorar_importacao_ponto(text,uuid) to anon,authenticated;
grant execute on function public.app_listar_ponto_importado(text,text,uuid) to anon,authenticated;

create or replace function public.app_listar_importacoes(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
  select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
  if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
    from (select i.id,i.tipo,i.competencia,i.arquivo_nome,i.imported_by,i.total_linhas,i.linhas_encontradas,i.linhas_nao_encontradas,i.cpfs_nao_encontrados,i.status,i.applied_at,i.archived_at,i.created_at,coalesce(f.nome,u.nome_exibicao,'Usuário') as imported_by_name
            from public.ponto_importacoes i left join public.usuarios u on u.id=i.imported_by left join public.funcionarios f on f.id=u.funcionario_id
           order by i.created_at desc limit 50) x;
  return jsonb_build_object('sucesso',true,'importacoes',v_result);
end; $$;
