-- Avatar pessoal do funcionário, usado pela sidebar, topbar e tela Meu perfil.
alter table public.funcionarios
  add column if not exists avatar_url text;

create or replace function public.app_atualizar_avatar(p_token text, p_avatar_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario record;
  v_avatar text := nullif(trim(coalesce(p_avatar_url, '')), '');
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.funcionario_id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  end if;

  if v_avatar is not null and (
    length(v_avatar) > 800000
    or v_avatar !~ '^data:image/(jpeg|png|webp);base64,'
  ) then
    return jsonb_build_object('sucesso', false, 'erro', 'A imagem precisa ser JPG, PNG ou WebP e ter até 800 KB.');
  end if;

  update public.funcionarios
     set avatar_url = v_avatar,
         updated_at = now()
   where id = v_usuario.funcionario_id;

  insert into public.auditoria_acoes(usuario_id, acao, entidade, detalhes)
  values (
    v_usuario.usuario_id,
    case when v_avatar is null then 'removeu_avatar' else 'atualizou_avatar' end,
    'funcionarios',
    jsonb_build_object('funcionario_id', v_usuario.funcionario_id)
  );

  return jsonb_build_object('sucesso', true, 'avatar_url', v_avatar);
end;
$$;

grant execute on function public.app_atualizar_avatar(text, text) to anon, authenticated;
