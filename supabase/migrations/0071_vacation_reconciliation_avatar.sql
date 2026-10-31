begin;

-- Mantém a RPC administrativa de férias alinhada ao retorno usado pela tela:
-- avatar_url, avisos_count, recibos_count, reconciliacao_status e resumo.
-- A definição completa foi aplicada no projeto Supabase como migration
-- vacation_reconciliation_and_employee_avatar.

comment on function public.app_admin_listar_ferias_gestao(text) is
  'Gestão administrativa de férias com avatar e reconciliação de avisos e recibos';

commit;
