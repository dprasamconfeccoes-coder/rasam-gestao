-- Rasam Gestão: schema unificado e autorização por sessão CPF.
-- Migração incremental: preserva as tabelas existentes do portal.

create extension if not exists pgcrypto;

alter table public.usuarios
  add column if not exists perfil text not null default 'funcionario',
  add column if not exists nome_exibicao text,
  add column if not exists ultimo_login timestamptz;

alter table public.usuarios drop constraint if exists usuarios_perfil_check;
alter table public.usuarios add constraint usuarios_perfil_check
  check (perfil in ('funcionario', 'gestor', 'administrador', 'admin'));

create index if not exists idx_usuarios_cpf_normalizado
  on public.usuarios (regexp_replace(cpf, '[^0-9]', '', 'g'));

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text,
  contato text,
  telefone text,
  email text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ordens_servico (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  cliente_id uuid references public.clientes(id),
  descricao text not null,
  status text not null default 'recebida' check (status in ('recebida','em_producao','costurada','expedida','entregue','cancelada')),
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  data_entrada date not null default current_date,
  prazo date,
  quantidade integer not null default 0 check (quantidade >= 0),
  valor_total numeric(14,2) not null default 0,
  observacoes text,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.producao_lotes (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid references public.ordens_servico(id) on delete cascade,
  nome text not null,
  quantidade integer not null default 0 check (quantidade >= 0),
  status text not null default 'em_costura' check (status in ('em_costura','costurado','entregue','pago','atrasado')),
  prazo date,
  responsavel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financeiro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pagar','receber')),
  categoria text not null,
  descricao text not null,
  valor numeric(14,2) not null check (valor >= 0),
  vencimento date not null,
  pago_em date,
  status text not null default 'pendente' check (status in ('pendente','pago','vencido','cancelado')),
  observacoes text,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dividas_gestao (
  id uuid primary key default gen_random_uuid(),
  credor text not null,
  descricao text not null,
  valor_original numeric(14,2) not null check (valor_original >= 0),
  saldo_devedor numeric(14,2) not null check (saldo_devedor >= 0),
  vencimento date,
  status text not null default 'ativa' check (status in ('ativa','quitada','renegociada')),
  observacoes text,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_ferias (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  periodo_aquisitivo_inicio date not null,
  periodo_aquisitivo_fim date not null,
  inicio date,
  fim date,
  status text not null default 'agendada' check (status in ('agendada','em_gozo','concluida','cancelada')),
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_afastamentos (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo text not null,
  inicio date not null,
  fim date,
  motivo text,
  status text not null default 'ativo' check (status in ('ativo','encerrado','cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_avisos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  conteudo text not null,
  prioridade text not null default 'normal' check (prioridade in ('normal','importante','urgente')),
  publicado boolean not null default false,
  publicado_em timestamptz,
  created_by uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo text not null,
  descricao text not null,
  anexo_url text,
  anexo_nome text,
  status text not null default 'pendente' check (status in ('pendente','em_analise','atendida','recusada','cancelada')),
  resposta text,
  analisado_por uuid references public.usuarios(id),
  analisado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auditoria_acoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id),
  acao text not null,
  entidade text,
  entidade_id uuid,
  detalhes jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ordens_status_prazo on public.ordens_servico(status, prazo);
create index if not exists idx_lotes_status_prazo on public.producao_lotes(status, prazo);
create index if not exists idx_financeiro_status_vencimento on public.financeiro_lancamentos(status, vencimento);
create index if not exists idx_ferias_funcionario on public.rh_ferias(funcionario_id, inicio);
create index if not exists idx_afastamentos_funcionario on public.rh_afastamentos(funcionario_id, inicio);
create index if not exists idx_solicitacoes_funcionario on public.rh_solicitacoes(funcionario_id, created_at desc);

alter table public.clientes enable row level security;
alter table public.ordens_servico enable row level security;
alter table public.producao_lotes enable row level security;
alter table public.financeiro_lancamentos enable row level security;
alter table public.dividas_gestao enable row level security;
alter table public.rh_ferias enable row level security;
alter table public.rh_afastamentos enable row level security;
alter table public.rh_avisos enable row level security;
alter table public.rh_solicitacoes enable row level security;
alter table public.auditoria_acoes enable row level security;

-- A aplicação usa RPCs com token próprio; não há leitura direta anônima das tabelas.
-- As políticas abaixo mantêm o acesso direto bloqueado para anon/authenticated.

create or replace function public.app_usuario_por_token(p_token text)
returns table(usuario_id uuid, funcionario_id uuid, perfil text, nome text, cargo text, cpf text)
language sql
security definer
set search_path = public, extensions
as $$
  select u.id, u.funcionario_id, u.perfil, f.nome, f.cargo, f.cpf
  from public.sessoes s
  join public.usuarios u on u.id = s.usuario_id
  join public.funcionarios f on f.id = u.funcionario_id
  where s.token = p_token
    and s.expira_em > now()
    and u.ativo = true
    and f.ativo = true
  limit 1;
$$;

create or replace function public.app_login(p_cpf text, p_senha text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_funcionario public.funcionarios%rowtype;
  v_token text;
  v_expira timestamptz;
begin
  p_cpf := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  if length(p_cpf) <> 11 or coalesce(p_senha, '') = '' then
    return jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  end if;

  select u.* into v_usuario
  from public.usuarios u
  where regexp_replace(u.cpf, '[^0-9]', '', 'g') = p_cpf and u.ativo = true
  limit 1;

  if not found or v_usuario.senha_hash is null or crypt(p_senha, v_usuario.senha_hash) <> v_usuario.senha_hash then
    return jsonb_build_object('sucesso', false, 'erro', 'CPF ou senha inválidos');
  end if;

  select f.* into v_funcionario from public.funcionarios f where f.id = v_usuario.funcionario_id and f.ativo = true limit 1;
  if not found then
    return jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado');
  end if;

  delete from public.sessoes where usuario_id = v_usuario.id or expira_em <= now();
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expira := now() + interval '8 hours';
  insert into public.sessoes(usuario_id, token, expira_em) values (v_usuario.id, v_token, v_expira);
  update public.usuarios set ultimo_login = now(), updated_at = now() where id = v_usuario.id;

  return jsonb_build_object(
    'sucesso', true,
    'primeiro_acesso', v_usuario.primeiro_acesso,
    'token', v_token,
    'usuario_id', v_usuario.id,
    'funcionario_id', v_funcionario.id,
    'nome', v_funcionario.nome,
    'cargo', coalesce(v_funcionario.cargo, ''),
    'perfil', v_usuario.perfil,
    'cpf', v_funcionario.cpf,
    'expira_em', v_expira
  );
end;
$$;

create or replace function public.app_definir_senha(p_token text, p_nova_senha text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_usuario_id uuid;
begin
  if length(coalesce(p_nova_senha, '')) < 8 then
    return jsonb_build_object('sucesso', false, 'erro', 'A nova senha deve ter pelo menos 8 caracteres');
  end if;
  select usuario_id into v_usuario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  update public.usuarios set senha_hash = crypt(p_nova_senha, gen_salt('bf')), primeiro_acesso = false, updated_at = now() where id = v_usuario_id;
  insert into public.auditoria_acoes(usuario_id, acao, entidade, detalhes) values (v_usuario_id, 'alterou_senha_primeiro_acesso', 'usuarios', '{}'::jsonb);
  return jsonb_build_object('sucesso', true);
end;
$$;

create or replace function public.app_sessao(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  select jsonb_build_object('usuario_id', usuario_id, 'funcionario_id', funcionario_id, 'perfil', perfil, 'nome', nome, 'cargo', coalesce(cargo,''), 'cpf', cpf)
  into v from public.app_usuario_por_token(p_token) limit 1;
  if v is null then return jsonb_build_object('valido', false); end if;
  return jsonb_build_object('valido', true) || v;
end;
$$;

create or replace function public.app_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.sessoes where token = p_token;
  return jsonb_build_object('sucesso', true);
end;
$$;

create or replace function public.app_dashboard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_usuario record; v_total integer; v_ferias integer; v_afastados integer;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
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

create or replace function public.app_listar_funcionarios(p_token text)
returns table(id uuid, nome text, cpf text, cargo text, data_admissao date, salario numeric, ativo boolean, perfil text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_perfil text;
begin
  select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
  if v_perfil not in ('admin','administrador','gestor') then return; end if;
  return query
    select f.id, f.nome, f.cpf, f.cargo, f.data_admissao, f.salario, f.ativo, coalesce(u.perfil,'funcionario')
    from public.funcionarios f left join public.usuarios u on u.funcionario_id = f.id
    order by f.ativo desc, f.nome
    limit 500;
end;
$$;

create or replace function public.app_meu_perfil(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_funcionario_id uuid; v_result jsonb;
begin
  select funcionario_id into v_funcionario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_funcionario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  select to_jsonb(f) into v_result from public.funcionarios f where f.id = v_funcionario_id limit 1;
  return jsonb_build_object('sucesso', true, 'funcionario', v_result);
end;
$$;

create or replace function public.app_listar_ponto(p_token text, p_limite integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_funcionario_id uuid; v_result jsonb;
begin
  select funcionario_id into v_funcionario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_funcionario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc), '[]'::jsonb) into v_result
  from (select * from public.registros_ponto where funcionario_id = v_funcionario_id order by data desc limit least(greatest(coalesce(p_limite,180),1),365)) x;
  return jsonb_build_object('sucesso', true, 'registros', v_result);
end;
$$;

create or replace function public.app_listar_holerites(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_funcionario_id uuid; v_result jsonb;
begin
  select funcionario_id into v_funcionario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_funcionario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ano desc, x.mes desc), '[]'::jsonb) into v_result
  from (select * from public.holerites where funcionario_id = v_funcionario_id and disponivel = true order by ano desc, mes desc limit 60) x;
  return jsonb_build_object('sucesso', true, 'holerites', v_result);
end;
$$;

create or replace function public.app_listar_avisos(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_usuario_id uuid; v_result jsonb;
begin
  select usuario_id into v_usuario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.publicado_em desc nulls last, x.created_at desc), '[]'::jsonb) into v_result from (select id, titulo, conteudo, prioridade, publicado_em, created_at from public.rh_avisos where publicado = true order by publicado_em desc nulls last, created_at desc limit 100) x;
  return jsonb_build_object('sucesso', true, 'avisos', v_result);
end;
$$;

create or replace function public.app_listar_solicitacoes(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_funcionario_id uuid; v_result jsonb;
begin
  select funcionario_id into v_funcionario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_funcionario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_result from (select id, tipo, descricao, anexo_nome, status, resposta, created_at from public.rh_solicitacoes where funcionario_id = v_funcionario_id order by created_at desc limit 100) x;
  return jsonb_build_object('sucesso', true, 'solicitacoes', v_result);
end;
$$;

create or replace function public.app_criar_solicitacao(p_token text, p_tipo text, p_descricao text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_funcionario_id uuid; v_id uuid;
begin
  select funcionario_id into v_funcionario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_funcionario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  if length(trim(coalesce(p_tipo,''))) < 2 or length(trim(coalesce(p_descricao,''))) < 5 then return jsonb_build_object('sucesso', false, 'erro', 'Preencha o tipo e a descrição'); end if;
  insert into public.rh_solicitacoes(funcionario_id, tipo, descricao) values (v_funcionario_id, trim(p_tipo), trim(p_descricao)) returning id into v_id;
  return jsonb_build_object('sucesso', true, 'id', v_id);
end;
$$;

create or replace function public.app_listar_atestados(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_funcionario_id uuid; v_result jsonb;
begin
  select funcionario_id into v_funcionario_id from public.app_usuario_por_token(p_token) limit 1;
  if v_funcionario_id is null then return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_result from (select id, tipo, data_atendimento, dias, observacao, arquivo_url, arquivo_nome, status, status_label, observacao_rh, created_at from public.atestados where funcionario_id = v_funcionario_id order by created_at desc limit 100) x;
  return jsonb_build_object('sucesso', true, 'atestados', v_result);
end;
$$;

create or replace function public.app_listar_ordens(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_perfil text; v_result jsonb;
begin
  select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
  if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.prazo nulls last, x.created_at desc), '[]'::jsonb) into v_result from (select o.id, o.numero, o.descricao, o.status, o.prioridade, o.data_entrada, o.prazo, o.quantidade, o.valor_total, c.nome as cliente from public.ordens_servico o left join public.clientes c on c.id = o.cliente_id order by o.prazo nulls last, o.created_at desc limit 300) x;
  return jsonb_build_object('sucesso', true, 'ordens', v_result);
end;
$$;

-- O primeiro usuário já existente é o responsável inicial pela administração do ambiente.
update public.usuarios set perfil = 'admin', nome_exibicao = coalesce(nome_exibicao, 'Administrador'), updated_at = now()
where id = (select id from public.usuarios order by created_at asc limit 1);

-- Permite chamadas RPC pelo cliente público; as funções validam o token antes de qualquer dado.
grant execute on function public.app_usuario_por_token(text) to anon, authenticated;
grant execute on function public.app_login(text,text) to anon, authenticated;
grant execute on function public.app_definir_senha(text,text) to anon, authenticated;
grant execute on function public.app_sessao(text) to anon, authenticated;
grant execute on function public.app_logout(text) to anon, authenticated;
grant execute on function public.app_dashboard(text) to anon, authenticated;
grant execute on function public.app_listar_funcionarios(text) to anon, authenticated;
grant execute on function public.app_meu_perfil(text) to anon, authenticated;
grant execute on function public.app_listar_ponto(text,integer) to anon, authenticated;
grant execute on function public.app_listar_holerites(text) to anon, authenticated;
grant execute on function public.app_listar_avisos(text) to anon, authenticated;
grant execute on function public.app_listar_solicitacoes(text) to anon, authenticated;
grant execute on function public.app_criar_solicitacao(text,text,text) to anon, authenticated;
grant execute on function public.app_listar_atestados(text) to anon, authenticated;
grant execute on function public.app_listar_ordens(text) to anon, authenticated;
