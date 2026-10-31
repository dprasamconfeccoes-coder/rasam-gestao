begin;

-- A RPC app_admin_listar_ferias_gestao foi atualizada no projeto Supabase
-- na migration vacation_document_links_v3 para devolver aviso_documento
-- e recibo_documento com os links privados/origem de cada período.
comment on function public.app_admin_listar_ferias_gestao(text) is
  'Gestão de férias com reconciliação, avatar e links de aviso e recibo';

commit;
