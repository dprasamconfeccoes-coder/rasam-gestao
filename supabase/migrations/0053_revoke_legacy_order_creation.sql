BEGIN;

-- A interface atual usa app_admin_criar_ordem_painel_v2, que valida cliente por empresa
-- e calcula o total usando preço unitário por tamanho. A RPC legada aceita um total
-- arbitrário e cria ordens sem cliente_id/preço por tamanho; retire acesso aos papéis
-- públicos autenticados para impedir que clientes antigos/Chamadas REST contornem as regras.
REVOKE ALL ON FUNCTION public.app_admin_criar_ordem_painel(text, text, text, text, date, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMIT;
