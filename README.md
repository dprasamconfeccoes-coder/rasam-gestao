# RF Gestão

Sistema unificado da Rafaela Fernandes: gestão administrativa, visão do gestor e portal do funcionário em uma aplicação responsiva e instalável.

## Desenvolvimento

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

O frontend usa as RPCs `app_*` do projeto Supabase configurado no ambiente. O cliente público não recebe service key; a autorização e os dados passam pelas funções que validam o token de sessão.

## Acesso inicial

O login usa CPF. Para as contas importadas da ficha de empregado, a senha inicial é a data de nascimento no formato `DDMMAAAA`. O primeiro acesso exige troca para uma senha com pelo menos oito caracteres.

## Tipos de cadastro de funcionário

- **Completo:** usado para os empregados da ficha trabalhista, com os dados de registro disponíveis como CBO, CTPS, FGTS, salário, admissão e demais documentos.
- **Básico:** usado para funcionários administrativos, gestores ou pessoas em período de teste, mantendo apenas os dados necessários para identificação, acesso e operação — nome, CPF, nascimento, telefone, endereço e documentos disponíveis.

A coluna `funcionarios.cadastro_tipo` diferencia os dois cenários (`completo` ou `basico`). O cadastro básico não exige o preenchimento artificial de campos trabalhistas que ainda não existem.

## Supabase

As migrações versionadas estão em `supabase/migrations/0001_unified_rasam_gestao.sql`, `0002_private_documents_scope.sql` e `0003_employee_registration_types.sql`. A carga real da ficha foi executada diretamente no projeto Supabase e não é armazenada neste repositório.

## Publicação

O workflow `.github/workflows/deploy-pages.yml` gera o build e publica o conteúdo estático no GitHub Pages. Os valores `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são públicos e podem ser definidos como Repository Variables; nenhuma chave privada deve ser adicionada ao projeto.
