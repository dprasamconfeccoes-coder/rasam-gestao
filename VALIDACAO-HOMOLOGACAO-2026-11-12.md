# RF Gestão — Validação de homologação sintética

**Data:** 12/11/2026
**Projeto Supabase:** `nunnryxospkvjalbngoa`
**Repositório:** `dprasamconfeccoes-coder/rasam-gestao`

## Resultado geral

A aplicação passou pela rodada de validação local e remota com dados sintéticos. O build, TypeScript, manifesto de rotas, shell público desktop/mobile e carregamento dos módulos lazy foram aprovados.

## Testes executados

- `pnpm run check`: aprovado.
- `pnpm run build`: aprovado; 1.958 módulos transformados.
- `git diff --check`: aprovado.
- `GET /`: HTTP 200 e HTML do RF Gestão.
- `GET /manus-routes.json`: HTTP 200, JSON válido e 18 rotas declaradas.
- Captura visual desktop: 1440×900 aprovada.
- Captura visual mobile: 390×844 aprovada.
- Auditoria de imports lazy: 19 imports apontando para exports existentes.
- Auditoria de chamadas RPC do frontend: sem mismatch nominal encontrado.
- Busca por dados mockados explícitos: nenhum mock/dummy/fake/coming soon nos dashboards.
- RLS: habilitado nas tabelas públicas; acesso direto não possui políticas e o modelo usa RPCs com escopo por token.
- Token inválido: `validar_token` retornou `valido=false`.
- Escrita sintética via RPC sem sessão válida: recusada com “Sessão inválida”; nenhum registro de teste foi criado.
- Integridade básica: sem CPFs duplicados; constraints de valores, status, vínculos e unicidade presentes.

## Correções aplicadas

1. Renumerado o arquivo local duplicado `0081_vacation_oldest_acquisition_and_clt_rules.sql` para `0084_vacation_oldest_acquisition_and_clt_rules.sql`, eliminando conflito de versão local.
2. Criada e aplicada a migration `fix_security_and_vacation_confirmation_audit`, registrada no Supabase em `20261112215905`.
3. A confirmação de importação de férias passou a registrar a ação `confirmou_importacao_ferias` em `auditoria_acoes`.
4. Fixado `search_path = public, extensions` nas seis funções apontadas pelo advisor: logout, login, validar token, geração de URL de atestado, listagem de atestados e contagem anual de acompanhante.

## Limitações conhecidas e decisão de segurança

O advisor ainda lista avisos de `RLS enabled no policy` e `SECURITY DEFINER executável por anon`. Isso é intencional no desenho atual: as tabelas não aceitam acesso direto e a aplicação utiliza RPCs `SECURITY DEFINER` com validação explícita de `p_token`, perfil e empresa. Revogar `anon` dessas funções sem migrar o mecanismo de autenticação quebraria o frontend atual. O risco deve ser reavaliado junto com eventual migração para autenticação nativa/cookies HttpOnly.

Também permanece como melhoria futura a migração do token mantido em `sessionStorage` para cookie seguro HttpOnly, se o modelo de sessão for alterado.

## Artefatos visuais

As capturas finais estão em `/home/ubuntu/rasam-data/qa-login-desktop-2026-11-12.png` e `/home/ubuntu/rasam-data/qa-login-mobile-2026-11-12.png`.
