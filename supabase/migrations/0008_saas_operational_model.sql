-- RF Gestão SaaS: modelo multiempresa e domínio operacional completo.
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  nome_fantasia text not null,
  cnpj text,
  logo_url text,
  moeda text not null default 'BRL',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.configuracoes_empresa (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  vale_valor numeric(12,2) not null default 300,
  vale_exige_falta_zero boolean not null default true,
  limite_holerites integer not null default 6,
  regras jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.empresas (id,razao_social,nome_fantasia) values ('00000000-0000-0000-0000-000000000001','Rafaela Fernandes Confecções','RF Gestão') on conflict (id) do nothing;
insert into public.configuracoes_empresa (empresa_id) values ('00000000-0000-0000-0000-000000000001') on conflict (empresa_id) do nothing;

alter table public.funcionarios add column if not exists empresa_id uuid references public.empresas(id);
alter table public.funcionarios add column if not exists tipo_vinculo text not null default 'formal' check (tipo_vinculo in ('formal','informal','experiencia'));
alter table public.funcionarios add column if not exists registrado boolean not null default true;
alter table public.funcionarios add column if not exists valor_mensal numeric(14,2);
alter table public.funcionarios add column if not exists valor_diaria numeric(14,2);
alter table public.funcionarios add column if not exists experiencia_inicio date;
alter table public.funcionarios add column if not exists experiencia_fim date;
alter table public.funcionarios add column if not exists elegivel_holerite boolean not null default true;
alter table public.funcionarios add column if not exists elegivel_escritorio boolean not null default true;
alter table public.funcionarios add column if not exists elegivel_vale boolean not null default true;
update public.funcionarios set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.funcionarios set registrado=(tipo_vinculo='formal'), elegivel_holerite=(tipo_vinculo='formal'), elegivel_escritorio=(tipo_vinculo='formal') where tipo_vinculo is not null;
alter table public.usuarios add column if not exists empresa_id uuid references public.empresas(id);
update public.usuarios u set empresa_id=f.empresa_id from public.funcionarios f where u.funcionario_id=f.id and u.empresa_id is null;

-- Tenant columns for every existing operational aggregate.
alter table public.registros_ponto add column if not exists empresa_id uuid references public.empresas(id);
alter table public.justificativas_ponto add column if not exists empresa_id uuid references public.empresas(id);
alter table public.atestados add column if not exists empresa_id uuid references public.empresas(id);
alter table public.holerites add column if not exists empresa_id uuid references public.empresas(id);
alter table public.rh_avisos add column if not exists empresa_id uuid references public.empresas(id);
alter table public.rh_solicitacoes add column if not exists empresa_id uuid references public.empresas(id);
alter table public.financeiro_lancamentos add column if not exists empresa_id uuid references public.empresas(id);
alter table public.dividas_gestao add column if not exists empresa_id uuid references public.empresas(id);
alter table public.clientes add column if not exists empresa_id uuid references public.empresas(id);
alter table public.ordens_servico add column if not exists empresa_id uuid references public.empresas(id);
alter table public.producao_lotes add column if not exists empresa_id uuid references public.empresas(id);
alter table public.rh_ferias add column if not exists empresa_id uuid references public.empresas(id);
alter table public.rh_afastamentos add column if not exists empresa_id uuid references public.empresas(id);
alter table public.ponto_importacoes add column if not exists empresa_id uuid references public.empresas(id);
alter table public.acordos_trabalhistas add column if not exists empresa_id uuid references public.empresas(id);
alter table public.documentos_empresa add column if not exists empresa_id uuid references public.empresas(id);
alter table public.vale_alimentacao_competencias add column if not exists empresa_id uuid references public.empresas(id);

update public.registros_ponto r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.justificativas_ponto r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.atestados r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.holerites r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.rh_solicitacoes r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.rh_ferias r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.rh_afastamentos r set empresa_id=f.empresa_id from public.funcionarios f where r.funcionario_id=f.id and r.empresa_id is null;
update public.rh_avisos set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.financeiro_lancamentos set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.dividas_gestao set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.clientes set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.ordens_servico set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.producao_lotes set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.ponto_importacoes set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.acordos_trabalhistas set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.documentos_empresa set empresa_id='00000000-0000-0000-0000-000000000001' where empresa_id is null;
update public.vale_alimentacao_competencias v set empresa_id=f.empresa_id from public.funcionarios f where v.funcionario_id=f.id and v.empresa_id is null;

create table if not exists public.funcionario_documentos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  categoria text not null, titulo text not null, arquivo_url text, arquivo_nome text, validade date, observacoes text, created_by uuid references public.usuarios(id), created_at timestamptz not null default now()
);
create table if not exists public.funcionario_advertencias (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  data_ocorrencia date not null, tipo text not null, descricao text not null, medida text, arquivo_url text, created_by uuid references public.usuarios(id), created_at timestamptz not null default now()
);
create table if not exists public.funcionario_timeline (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  evento text not null, descricao text not null, data_evento date not null default current_date, origem text, created_by uuid references public.usuarios(id), created_at timestamptz not null default now()
);
create table if not exists public.financeiro_recorrencias (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), descricao text not null, categoria text not null, fornecedor text, valor numeric(14,2) not null, periodicidade text not null check (periodicidade in ('mensal','semanal','anual')), proximo_vencimento date not null, ativo boolean not null default true, created_by uuid references public.usuarios(id), created_at timestamptz not null default now()
);
create table if not exists public.financeiro_parcelamentos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), tipo text not null, credor text not null, descricao text not null, valor_entrada numeric(14,2) not null default 0, quantidade_parcelas integer not null, valor_padrao numeric(14,2) not null, data_primeiro_vencimento date not null, created_by uuid references public.usuarios(id), created_at timestamptz not null default now()
);
create table if not exists public.financeiro_parcelas (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), parcelamento_id uuid references public.financeiro_parcelamentos(id) on delete cascade, numero integer not null, valor numeric(14,2) not null, vencimento date not null, status text not null default 'pendente' check (status in ('pendente','pago','vencido','cancelado')), pago_em date, comprovante_url text, comprovante_nome text, baixado_por uuid references public.usuarios(id), unique(parcelamento_id,numero)
);
create table if not exists public.fechamentos_mensais (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), competencia text not null, status text not null default 'aberto' check (status in ('aberto','calculado','enviado','fechado')), incluir_informais_vale boolean not null default false, observacoes text, criado_por uuid references public.usuarios(id), created_at timestamptz not null default now(), unique(empresa_id,competencia)
);
create table if not exists public.fechamento_funcionarios (
  id uuid primary key default gen_random_uuid(), fechamento_id uuid not null references public.fechamentos_mensais(id) on delete cascade, funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  dias_trabalhados numeric(8,2) not null default 0, faltas integer not null default 0, faltas_injustificadas integer not null default 0, atrasos_minutos integer not null default 0, horas_extras_50 numeric(8,2) not null default 0, horas_extras_100 numeric(8,2) not null default 0, dsr_horas numeric(8,2) not null default 0, dsr_desconto numeric(14,2) not null default 0, vale_elegivel boolean not null default false, vale_valor numeric(12,2) not null default 0, observacoes text, unique(fechamento_id,funcionario_id)
);
create index if not exists idx_func_docs_func on public.funcionario_documentos(funcionario_id,created_at desc);
create index if not exists idx_func_warn_func on public.funcionario_advertencias(funcionario_id,data_ocorrencia desc);
create index if not exists idx_fin_parcelas_venc on public.financeiro_parcelas(vencimento,status);
