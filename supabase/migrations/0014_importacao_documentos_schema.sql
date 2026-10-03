-- Dados reais importados dos documentos oficiais do Drive; linhas inválidas ficam preservadas no bruto.
alter table public.financeiro_lancamentos add column if not exists fonte_documento text;
alter table public.financeiro_parcelamentos add column if not exists fonte_documento text;
alter table public.financeiro_parcelas add column if not exists fonte_documento text;
create table if not exists public.documentos_financeiros_importados (id uuid primary key default gen_random_uuid(), arquivo_nome text not null, linha integer not null, tipo text not null, dados jsonb not null, valor numeric(14,2), vencimento date, validacao text not null default 'valido', created_at timestamptz not null default now(), unique(arquivo_nome, linha, tipo));
alter table public.documentos_financeiros_importados enable row level security;
create table if not exists public.folhas_pagamento_linhas (id uuid primary key default gen_random_uuid(), arquivo_nome text not null, competencia text not null, linha integer not null, funcionario_nome text not null, dados jsonb not null, created_at timestamptz not null default now(), unique(arquivo_nome, linha));
alter table public.folhas_pagamento_linhas enable row level security;
