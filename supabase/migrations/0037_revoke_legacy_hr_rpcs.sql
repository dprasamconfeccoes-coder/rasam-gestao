-- As implementações legadas ficam internas; somente os wrappers hardenizados são públicos.
revoke execute on function public.app_admin_listar_ferias_legacy(text) from public,anon,authenticated;
revoke execute on function public.app_admin_criar_ferias_legacy(text,uuid,date,date,date,date,text,text) from public,anon,authenticated;
revoke execute on function public.app_admin_atualizar_ferias_legacy(text,uuid,date,date,text,text) from public,anon,authenticated;
revoke execute on function public.app_admin_listar_afastamentos_legacy(text) from public,anon,authenticated;
revoke execute on function public.app_admin_criar_afastamento_legacy(text,uuid,text,date,date,text,text) from public,anon,authenticated;
revoke execute on function public.app_admin_atualizar_afastamento_legacy(text,uuid,date,text,text) from public,anon,authenticated;
revoke execute on function public.app_admin_registrar_admissao_legacy(text,uuid,date,text,text,numeric,numeric,boolean) from public,anon,authenticated;
revoke execute on function public.app_admin_demitir_funcionario_legacy(text,uuid,date,text) from public,anon,authenticated;
revoke execute on function public.app_admin_reintegrar_funcionario_legacy(text,uuid,date) from public,anon,authenticated;
