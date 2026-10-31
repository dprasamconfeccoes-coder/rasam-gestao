begin;

alter table public.rh_ferias
  add column if not exists aviso_emitido_em date,
  add column if not exists ciencia_em date,
  add column if not exists pagamento_previsto_em date,
  add column if not exists pagamento_efetivo_em date,
  add column if not exists retorno_em date,
  add column if not exists dias_gozo integer,
  add column if not exists dias_abono integer,
  add column if not exists abono_solicitado boolean not null default false,
  add column if not exists origem_importacao text,
  add column if not exists importacao_status text not null default 'manual';

create table if not exists public.rh_ferias_calculos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), ferias_id uuid not null references public.rh_ferias(id) on delete cascade,
  faltas_injustificadas integer, salario_base numeric(14,2), media_horas numeric(14,2), media_valores numeric(14,2), outras_vantagens numeric(14,2), base_calculo numeric(14,2), valor_ferias numeric(14,2), valor_terco_ferias numeric(14,2), valor_abono numeric(14,2), valor_terco_abono numeric(14,2), valor_dobra numeric(14,2), valor_terco_dobra numeric(14,2), valor_salario_familia numeric(14,2), valor_primeira_parcela_13 numeric(14,2), valor_previdencia numeric(14,2), valor_irrf numeric(14,2), total_proventos numeric(14,2), total_descontos numeric(14,2), total_liquido numeric(14,2), moeda text not null default 'BRL', dados_extraidos jsonb not null default '{}'::jsonb, conferido_em timestamptz, conferido_por uuid references public.usuarios(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (ferias_id)
);

create table if not exists public.rh_ferias_documentos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id), funcionario_id uuid not null references public.funcionarios(id) on delete cascade, ferias_id uuid references public.rh_ferias(id) on delete set null,
  tipo text not null check (tipo in ('aviso','recibo','solicitacao_abono','outro')), arquivo_nome text not null, storage_path text, mime_type text not null default 'application/pdf', tamanho_bytes bigint, sha256 text, drive_file_id text, drive_url_origem text, extraido_em timestamptz, conferido_em timestamptz, conferido_por uuid references public.usuarios(id), status_conferencia text not null default 'pendente' check (status_conferencia in ('pendente','conferido','divergente','rejeitado')), observacoes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (empresa_id, drive_file_id)
);

create table if not exists public.rh_ferias_importacoes (
  id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id), tipo text not null default 'aviso', origem text not null default 'google_drive', pasta_nome text, total_linhas integer not null default 0, linhas_vinculadas integer not null default 0, linhas_pendentes integer not null default 0, status text not null default 'pendente' check (status in ('pendente','parcial','conferida','rejeitada')), observacoes text, created_by uuid references public.usuarios(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.rh_ferias_import_linhas (
  id uuid primary key default gen_random_uuid(), importacao_id uuid not null references public.rh_ferias_importacoes(id) on delete cascade, empresa_id uuid references public.empresas(id), funcionario_id uuid references public.funcionarios(id), nome_extraido text not null, cpf_extraido text, cadastro_extraido text, periodo_aquisitivo_inicio date, periodo_aquisitivo_fim date, inicio date, fim date, retorno_em date, pagamento_previsto_em date, aviso_emitido_em date, abono_solicitado boolean not null default false, arquivo_nome text not null, drive_file_id text, drive_url_origem text, status text not null default 'pendente' check (status in ('pendente','vinculada','conferida','divergente','rejeitada')), divergencia text, ferias_id uuid references public.rh_ferias(id) on delete set null, documento_id uuid references public.rh_ferias_documentos(id) on delete set null, dados_extraidos jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists idx_rh_ferias_empresa_inicio on public.rh_ferias(empresa_id, inicio);
create index if not exists idx_rh_ferias_docs_func on public.rh_ferias_documentos(empresa_id, funcionario_id, created_at desc);
create index if not exists idx_rh_ferias_import_linhas_status on public.rh_ferias_import_linhas(importacao_id, status);

-- As RPCs app_admin_listar_ferias_gestao, app_admin_confirmar_ferias_importacao e app_admin_rejeitar_ferias_importacao foram aplicadas no projeto Supabase e permanecem versionadas no histórico da aplicação.
commit;
