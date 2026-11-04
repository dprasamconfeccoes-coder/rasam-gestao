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

A autenticação e o primeiro acesso são validados pelo servidor. Credenciais temporárias devem ser trocadas no primeiro acesso.

## Tipos de cadastro de funcionário

- **Completo:** usado para os empregados da ficha trabalhista, com os dados de registro disponíveis como CBO, CTPS, FGTS, salário, admissão e demais documentos.
- **Básico:** usado para funcionários administrativos, gestores ou pessoas em período de teste, mantendo apenas os dados necessários para identificação, acesso e operação — nome, CPF, nascimento, telefone, endereço e documentos disponíveis.

A coluna `funcionarios.cadastro_tipo` diferencia os dois cenários (`completo` ou `basico`). O cadastro básico não exige o preenchimento artificial de campos trabalhistas que ainda não existem.

## Supabase

As migrações locais estão em `supabase/migrations/`. A fonte da `0096_financial_integration_core` foi recuperada do histórico Supabase e versionada neste repositório; as mudanças `0102` e `0103` desta rodada foram aplicadas ao projeto principal. Como o servidor usa versões timestamp e o histórico completo ainda possui divergências semânticas, não execute `supabase db push` nem `migration repair` até concluir a reconciliação. A carga real da ficha não é armazenada neste repositório.

As permissões administrativas são validadas pelas RPCs do Supabase. A **Central operacional** permite visualizar o ponto da equipe, exportar relatórios, tratar justificativas e atestados, responder solicitações de RH, publicar avisos e holerites, atualizar baixas de dívidas e conduzir ordens e lotes de produção.

O primeiro acesso é verificado também ao restaurar uma sessão existente; recarregar a página não libera o portal antes da troca da senha temporária. O portal do funcionário não recebe o módulo financeiro, dívidas ou administração; o prontuário exibe apenas os lançamentos de benefícios/descontos vinculados ao próprio funcionário.

## Operação com dados reais

- **Importar ponto:** o painel administrativo aceita os CSVs diário e mensal, reconhece os cabeçalhos do exportador, cruza exclusivamente por CPF e registra as linhas não encontradas como divergência auditável.
- **Relatórios:** a tela de importações gera uma tabela pronta para impressão em PDF do ponto e uma conferência de vale-alimentação sem conceder elegibilidade automaticamente.
- **Acordos:** parcelas quitadas e futuras do relatório de pagamentos são persistidas em `acordos_trabalhistas` e `acordo_parcelas`.
- **Documentos:** o regimento interno é pesquisável dentro do portal; a CCT 2025/2026 fica disponível como documento normativo para consulta.
- **Dados carregados:** foram persistidas 1.085 linhas de ponto (35 diárias e 1.050 mensais), com 630 registros de jornada cruzados para funcionários cadastrados. As divergências permanecem visíveis no histórico de importações.

## Publicação

O workflow `.github/workflows/deploy-pages.yml` gera o build e publica o conteúdo estático no GitHub Pages. Os valores `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são públicos e podem ser definidos como Repository Variables; nenhuma chave privada deve ser adicionada ao projeto.
