# Rasam Gestão

Sistema unificado da Raça Confecções: gestão administrativa, visão do gestor e portal do funcionário em uma aplicação responsiva e instalável.

## Desenvolvimento

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

O frontend usa as RPCs `app_*` do projeto Supabase configurado no ambiente. O cliente público não recebe service key; a autorização e os dados passam pelas funções que validam o token de sessão.

## Acesso inicial

O login usa CPF. Para as contas importadas da ficha de empregado, a senha inicial é a data de nascimento no formato `DDMMAAAA`. O primeiro acesso exige troca para uma senha com pelo menos oito caracteres.

## Supabase

A migração versionada está em `supabase/migrations/0001_unified_rasam_gestao.sql`. A carga real da ficha foi executada diretamente no projeto Supabase e não é armazenada neste repositório.

## Publicação

O workflow `.github/workflows/deploy-pages.yml` gera o build e publica o conteúdo estático no GitHub Pages. Os valores `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são públicos e podem ser definidos como Repository Variables; nenhuma chave privada deve ser adicionada ao projeto.
