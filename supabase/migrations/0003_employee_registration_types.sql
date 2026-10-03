-- RF Gestão: tipos de cadastro para funcionários completos e administrativos básicos.
-- O cadastro básico mantém somente os dados necessários ao acesso e à operação.

alter table public.funcionarios
  add column if not exists cadastro_tipo text not null default 'completo';

alter table public.funcionarios drop constraint if exists funcionarios_cadastro_tipo_check;
alter table public.funcionarios add constraint funcionarios_cadastro_tipo_check
  check (cadastro_tipo in ('completo', 'basico'));

create index if not exists idx_funcionarios_cadastro_tipo
  on public.funcionarios (cadastro_tipo);

comment on column public.funcionarios.cadastro_tipo is
  'completo para ficha trabalhista integral; basico para funcionários administrativos em teste ou operação sem todos os campos trabalhistas.';
