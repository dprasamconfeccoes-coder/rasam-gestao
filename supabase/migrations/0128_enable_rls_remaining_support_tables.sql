-- Homologação de segurança: nenhuma tabela pública de suporte deve ficar fora do RLS.
-- O frontend usa RPCs SECURITY DEFINER e não precisa de acesso direto a essas tabelas.
begin;

alter table public.documentos_empresa_auditoria enable row level security;
alter table public.ponto_inconsistencias enable row level security;
alter table public.rh_ferias_calculos enable row level security;
alter table public.rh_ferias_documentos enable row level security;
alter table public.rh_ferias_import_linhas enable row level security;
alter table public.rh_ferias_importacoes enable row level security;
alter table public.rh_ferias_programacao_historica enable row level security;

revoke all privileges on table
  public.documentos_empresa_auditoria,
  public.ponto_inconsistencias,
  public.rh_ferias_calculos,
  public.rh_ferias_documentos,
  public.rh_ferias_import_linhas,
  public.rh_ferias_importacoes,
  public.rh_ferias_programacao_historica
from anon, authenticated;

commit;
