-- Complemento do hardening: remove EXECUTE herdado via PUBLIC.
-- Apenas as RPCs app_* ficam explicitamente disponíveis ao cliente.

begin;

revoke all privileges on all functions in schema public from public;
revoke all privileges on all functions in schema public from anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and left(p.proname, 4) = 'app_'
  loop
    execute format('grant execute on function %s to anon, authenticated', r.signature);
  end loop;
end
$$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

commit;
