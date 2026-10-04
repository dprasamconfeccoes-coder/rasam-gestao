-- Hardening de produção: o frontend usa exclusivamente RPCs SECURITY DEFINER.
-- As tabelas públicas não devem ser acessíveis diretamente por anon/authenticated.

begin;

-- Remove acesso direto a dados e estruturas de negócio.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

-- RPCs usadas pelo frontend: mantemos EXECUTE público porque o cliente usa a
-- chave publicável e a autorização é feita dentro das funções pelo token.
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
      and p.proname like 'app\_%' escape '\\'
  loop
    execute format('grant execute on function %s to anon, authenticated', r.signature);
  end loop;
end
$$;

-- Nenhuma tabela pública deve depender de grants diretos para ficar protegida.
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end
$$;

-- Impede que novas tabelas criadas pelo proprietário recebam acesso direto por padrão.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;
