-- RF Gestão: primeiro acesso também é respeitado ao restaurar uma sessão.
create or replace function public.app_sessao(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
 select jsonb_build_object(
   'usuario_id', u.id,
   'funcionario_id', u.funcionario_id,
   'perfil', u.perfil,
   'nome', f.nome,
   'cargo', coalesce(f.cargo,''),
   'cpf', f.cpf,
   'primeiro_acesso', coalesce(u.primeiro_acesso,false)
 ) into v
 from public.sessoes s
 join public.usuarios u on u.id=s.usuario_id
 join public.funcionarios f on f.id=u.funcionario_id
 where s.token=p_token and s.expira_em>now() and u.ativo=true and f.ativo=true
 limit 1;
 if v is null then return jsonb_build_object('valido',false); end if;
 return jsonb_build_object('valido',true)||v;
end;
$$;
