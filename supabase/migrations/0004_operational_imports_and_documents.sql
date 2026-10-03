-- RF Gestão: importação operacional, ponto, benefícios, acordos e documentos internos.

create table if not exists public.ponto_importacoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('diario','mensal')),
  competencia text,
  arquivo_nome text not null,
  imported_by uuid references public.usuarios(id),
  total_linhas integer not null default 0,
  linhas_encontradas integer not null default 0,
  linhas_nao_encontradas integer not null default 0,
  cpfs_nao_encontrados jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ponto_import_linhas (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.ponto_importacoes(id) on delete cascade,
  funcionario_id uuid references public.funcionarios(id),
  cpf text not null,
  nome_csv text not null,
  data date not null,
  previsto text,
  entrada_1 time,
  saida_1 time,
  entrada_2 time,
  saida_2 time,
  total_normais text,
  total_noturno text,
  dia_falta text,
  horas_atraso text,
  abono text,
  extra_50 text,
  extra_100 text,
  desconta_dsr text,
  justificativas text,
  encontrado boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ponto_import_linhas_cpf on public.ponto_import_linhas(cpf);
create index if not exists idx_ponto_import_linhas_data on public.ponto_import_linhas(data desc);

create table if not exists public.vale_alimentacao_competencias (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  elegivel boolean not null default false,
  dias integer,
  valor numeric(12,2),
  observacoes text,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  unique (competencia, funcionario_id)
);

create table if not exists public.acordos_trabalhistas (
  id uuid primary key default gen_random_uuid(),
  empresa text not null default 'Rafaela Fernandes',
  processo text not null unique,
  favorecido text,
  observacoes text,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);
create table if not exists public.acordo_parcelas (
  id uuid primary key default gen_random_uuid(),
  acordo_id uuid not null references public.acordos_trabalhistas(id) on delete cascade,
  numero integer not null,
  valor numeric(12,2) not null,
  vencimento date,
  status text not null default 'pendente' check (status in ('quitada','pendente','atrasada')),
  observacoes text,
  unique (acordo_id, numero)
);
create index if not exists idx_acordo_parcelas_vencimento on public.acordo_parcelas(vencimento, status);

create table if not exists public.documentos_empresa (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null check (categoria in ('regimento','cct','ponto','outro')),
  arquivo_nome text,
  arquivo_url text,
  conteudo_texto text,
  disponivel_funcionarios boolean not null default false,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_documentos_empresa_titulo on public.documentos_empresa(titulo);

create or replace function public.app_importar_ponto(
  p_token text, p_tipo text, p_competencia text, p_arquivo_nome text, p_linhas jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_usuario record; v_importacao uuid; v_linha jsonb; v_funcionario_id uuid;
  v_total integer := 0; v_encontradas integer := 0; v_nao_encontradas integer := 0;
  v_cpfs jsonb := '[]'::jsonb; v_data date; v_cpf text; v_nome text;
  v_e1 time; v_s1 time; v_e2 time; v_s2 time;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo');
  end if;
  if p_tipo not in ('diario','mensal') or jsonb_typeof(p_linhas) <> 'array' then
    return jsonb_build_object('sucesso',false,'erro','Arquivo de ponto inválido');
  end if;
  insert into public.ponto_importacoes(tipo,competencia,arquivo_nome,imported_by)
  values (p_tipo,p_competencia,coalesce(nullif(trim(p_arquivo_nome),''),'ponto.csv'),v_usuario.usuario_id)
  returning id into v_importacao;
  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_total := v_total + 1;
    v_cpf := regexp_replace(coalesce(v_linha->>'cpf',''),'[^0-9]','','g');
    v_nome := coalesce(v_linha->>'nome','Nome não informado');
    begin v_data := (v_linha->>'data')::date; exception when others then v_data := null; end;
    if length(v_cpf) <> 11 or v_data is null then
      v_nao_encontradas := v_nao_encontradas + 1;
      v_cpfs := v_cpfs || jsonb_build_array(coalesce(v_cpf,v_nome));
      insert into public.ponto_import_linhas(importacao_id,cpf,nome_csv,data,encontrado,raw_data)
      values (v_importacao,v_cpf,v_nome,coalesce(v_data,current_date),false,v_linha);
      continue;
    end if;
    select f.id into v_funcionario_id from public.funcionarios f
    where regexp_replace(f.cpf,'[^0-9]','','g') = v_cpf and f.ativo = true limit 1;
    v_e1 := case when (v_linha->>'entrada_1') ~ '^\d{2}:\d{2}$' then (v_linha->>'entrada_1')::time else null end;
    v_s1 := case when (v_linha->>'saida_1') ~ '^\d{2}:\d{2}$' then (v_linha->>'saida_1')::time else null end;
    v_e2 := case when (v_linha->>'entrada_2') ~ '^\d{2}:\d{2}$' then (v_linha->>'entrada_2')::time else null end;
    v_s2 := case when (v_linha->>'saida_2') ~ '^\d{2}:\d{2}$' then (v_linha->>'saida_2')::time else null end;
    insert into public.ponto_import_linhas(importacao_id,funcionario_id,cpf,nome_csv,data,previsto,entrada_1,saida_1,entrada_2,saida_2,total_normais,total_noturno,dia_falta,horas_atraso,abono,extra_50,extra_100,desconta_dsr,justificativas,encontrado,raw_data)
    values (v_importacao,v_funcionario_id,v_cpf,v_nome,v_data,v_linha->>'previsto',v_e1,v_s1,v_e2,v_s2,v_linha->>'total_normais',v_linha->>'total_noturno',v_linha->>'dia_falta',v_linha->>'horas_atraso',v_linha->>'abono',v_linha->>'extra_50',v_linha->>'extra_100',v_linha->>'desconta_dsr',v_linha->>'justificativas',v_funcionario_id is not null,v_linha);
    if v_funcionario_id is null then
      v_nao_encontradas := v_nao_encontradas + 1; v_cpfs := v_cpfs || jsonb_build_array(v_cpf);
    else
      v_encontradas := v_encontradas + 1;
      insert into public.registros_ponto(funcionario_id,data,entrada,saida_almoco,volta_almoco,saida,status)
      values (v_funcionario_id,v_data,v_e1,v_s1,v_e2,v_s2,case when coalesce(v_linha->>'dia_falta','') <> '' then 'falta' else 'normal' end)
      on conflict (funcionario_id,data) do update set entrada=excluded.entrada,saida_almoco=excluded.saida_almoco,volta_almoco=excluded.volta_almoco,saida=excluded.saida,status=excluded.status;
    end if;
  end loop;
  update public.ponto_importacoes set total_linhas=v_total,linhas_encontradas=v_encontradas,linhas_nao_encontradas=v_nao_encontradas,cpfs_nao_encontrados=v_cpfs where id=v_importacao;
  return jsonb_build_object('sucesso',true,'importacao_id',v_importacao,'total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas,'cpfs_nao_encontrados',v_cpfs);
end; $$;

create or replace function public.app_listar_importacoes(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result from (select * from public.ponto_importacoes order by created_at desc limit 50) x; return jsonb_build_object('sucesso',true,'importacoes',v_result); end; $$;

create or replace function public.app_listar_ponto_importado(p_token text,p_tipo text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc,x.nome_csv),'[]'::jsonb) into v_result from (select l.id,l.cpf,l.nome_csv,l.data,l.entrada_1,l.saida_1,l.entrada_2,l.saida_2,l.total_normais,l.extra_50,l.extra_100,l.dia_falta,l.horas_atraso,l.justificativas,l.encontrado,i.tipo,i.competencia from public.ponto_import_linhas l join public.ponto_importacoes i on i.id=l.importacao_id where p_tipo is null or i.tipo=p_tipo order by l.data desc limit 1500) x; return jsonb_build_object('sucesso',true,'registros',v_result); end; $$;

create or replace function public.app_listar_acordos(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; select coalesce(jsonb_agg(to_jsonb(x) order by x.vencimento nulls last),'[]'::jsonb) into v_result from (select p.id,a.processo,a.favorecido,p.numero,p.valor,p.vencimento,p.status,p.observacoes from public.acordo_parcelas p join public.acordos_trabalhistas a on a.id=p.acordo_id order by p.vencimento nulls last limit 500) x; return jsonb_build_object('sucesso',true,'parcelas',v_result); end; $$;

create or replace function public.app_listar_documentos(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil is null then return jsonb_build_object('sucesso',false,'erro','Sessão inválida'); end if; select coalesce(jsonb_agg(to_jsonb(x) order by x.titulo),'[]'::jsonb) into v_result from (select id,titulo,categoria,arquivo_nome,arquivo_url,conteudo_texto,disponivel_funcionarios,created_at from public.documentos_empresa where disponivel_funcionarios or v_perfil in ('admin','administrador','gestor')) x; return jsonb_build_object('sucesso',true,'documentos',v_result); end; $$;

create unique index if not exists uq_registros_ponto_funcionario_data on public.registros_ponto(funcionario_id,data);
grant execute on function public.app_importar_ponto(text,text,text,text,jsonb) to anon,authenticated;
grant execute on function public.app_listar_importacoes(text) to anon,authenticated;
grant execute on function public.app_listar_ponto_importado(text,text) to anon,authenticated;
grant execute on function public.app_listar_acordos(text) to anon,authenticated;
grant execute on function public.app_listar_documentos(text) to anon,authenticated;
