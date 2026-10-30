BEGIN;

REVOKE ALL ON FUNCTION public.app_listar_documentos(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_admin_atualizar_documento_interno(text, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_listar_documentos(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_documento_interno(text, uuid, text, text, text, boolean) TO service_role;

COMMIT;
