-- Etapa 3: publica eventos operacionais para atualização em tempo real do painel.
DO $$
DECLARE
  tabela text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tabela IN ARRAY ARRAY[
      'financeiro_lancamentos',
      'ordens_servico',
      'producao_lotes',
      'atestados',
      'rh_solicitacoes',
      'rh_avisos',
      'registros_ponto'
    ] LOOP
      IF to_regclass('public.' || tabela) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_publication p ON p.oid = pr.prpubid
          WHERE p.pubname = 'supabase_realtime'
            AND c.relnamespace = 'public'::regnamespace
            AND c.relname = tabela
        ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tabela);
      END IF;
    END LOOP;
  END IF;
END $$;
