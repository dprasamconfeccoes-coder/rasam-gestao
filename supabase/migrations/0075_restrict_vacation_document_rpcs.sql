begin;

-- Estas RPCs são chamadas somente pelo Edge Function ferias-documento,
-- com a service role. O aplicativo cliente não deve executá-las diretamente.
revoke all on function public.app_admin_ferias_documento_preflight(text, uuid) from public, anon, authenticated;
revoke all on function public.app_admin_registrar_ferias_documento(text, uuid, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.app_admin_ferias_documento_path(text, uuid) from public, anon, authenticated;

grant execute on function public.app_admin_ferias_documento_preflight(text, uuid) to service_role;
grant execute on function public.app_admin_registrar_ferias_documento(text, uuid, text, text, text, text, bigint) to service_role;
grant execute on function public.app_admin_ferias_documento_path(text, uuid) to service_role;

commit;
