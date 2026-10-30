-- Arquivar alertas após aplicar os registros válidos sem reclassificar a importação como ignorada.
create or replace function public.app_ignorar_importacao_ponto(p_token text, p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_usuario record; v_status text;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo'); end if;
  select status into v_status from public.ponto_importacoes where id=p_importacao_id;
  if v_status is null then return jsonb_build_object('sucesso',false,'erro','Importação não encontrada'); end if;
  update public.ponto_importacoes
     set status = case when status = 'aplicada' then status else 'ignorada' end,
         archived_at = coalesce(archived_at,now())
   where id=p_importacao_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes)
  values (v_usuario.usuario_id,'arquivou_importacao_ponto','ponto_importacoes',jsonb_build_object('importacao_id',p_importacao_id,'status_anterior',v_status));
  return jsonb_build_object('sucesso',true,'status',case when v_status = 'aplicada' then 'aplicada' else 'ignorada' end);
end; $$;

grant execute on function public.app_ignorar_importacao_ponto(text,uuid) to anon,authenticated;
