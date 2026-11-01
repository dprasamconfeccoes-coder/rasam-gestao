# Plano integral — RF Gestão SaaS

## Objetivo
Transformar o RF Gestão em uma plataforma multiempresa para RH, ponto, financeiro, benefícios, documentos e produção, preservando os dados reais atuais e eliminando a duplicidade da Central Operacional.

## Decisões de produto

- **Multiempresa:** toda operação pertence a uma empresa (`tenant_id`), com empresa padrão criada para os dados atuais.
- **Vínculos:** funcionários formais/CLT e informais/experiência convivem no mesmo sistema; o vínculo controla elegibilidade para holerite, relatórios oficiais e vale-alimentação.
- **Prontuário:** página individual reúne cadastro, documentos, atestados, justificativas, advertências, ponto e timeline.
- **Fechamento:** competência mensal calcula faltas injustificadas, horas extras, DSR, descontos e elegibilidade do vale; gera relatórios de escritório e cartão.
- **Financeiro:** contas recorrentes, despesas, acordos parcelados, entradas, múltiplos valores, baixas e comprovantes.
- **Permissões:** funcionário acessa somente sua vida funcional; gestor administra RH; administrador controla empresa, financeiro e relatórios.
- **Navegação:** uma única área administrativa com abas por domínio; atalhos não duplicam CRUDs.
- **Importação de holerites:** a área Controle terá uma tela dedicada para gestores e administradores selecionarem funcionário, competência e PDF; o arquivo será guardado em bucket privado e aberto por URL assinada temporária no portal.
- **Funcionários como prontuário:** o menu Funcionários será a porta de entrada do departamento administrativo; por padrão não carregará registros, exigirá uma busca explícita e abrirá um prontuário operacional por pessoa.
- **Busca administrativa:** a consulta de funcionários será server-side, paginada e filtrável por nome, CPF, situação, vínculo, cargo e faixa salarial; os resultados só aparecerão após a ação Buscar.
- **Ações no prontuário:** o prontuário concentrará cadastro, holerites, benefícios, descontos, advertências, férias, documentos, ponto e timeline, preservando permissões e auditoria por ação.

## Design

Movimento visual: **editorial operacional dark**, com alto contraste e acentos magenta/dourado RF. Princípios: clareza em decisões, densidade controlada, estados explícitos e mobile-first. O layout usa navegação lateral no desktop e navegação recolhida no celular; cards substituem tabelas estreitas. A marca usa RF como selo e tipografia sans geométrica, com microcopy direta e operacional.

## Estrutura

- `src/features/AdminCenter.tsx`: workspace administrativo unificado.
- `src/features/PayslipImportDashboard.tsx`: importação administrativa e histórico de holerites.
- `src/features/EmployeeDirectory.tsx`: busca administrativa e entrada para o prontuário do funcionário (próxima etapa).
- `src/lib/api.ts`: chamadas RPC tipadas.
- `src/lib/types.ts`: contratos de domínio.
- `supabase/migrations/0008_saas_operational_model.sql`: tenant, vínculos, prontuário, fechamento, benefícios e financeiro.
- `supabase/migrations/0009_saas_operational_rpcs.sql`: RPCs de cadastro, prontuário, fechamento e relatórios.
- `public/manus-routes.json`: rotas de produto.

## Entregas incluídas

1. Modelo multiempresa e configurações por empresa.
2. Cadastro formal/informal com valores por mês/diária e elegibilidades.
3. Prontuário completo com documentos, advertências e timeline.
4. Fechamento mensal de ponto com extras, faltas, DSR e justificativas.
5. Relatório de escritório e relatório de vale-alimentação com opção de informais.
6. Financeiro recorrente, parcelamentos variáveis, baixas e comprovantes.
7. Holerites limitados aos seis últimos e bloqueados para informais.
8. Central administrativa consolidada, sem módulos duplicados.
9. Portal do funcionário preservado com acesso somente à própria operação.
10. Importação de holerites por funcionário e competência, com PDF privado e URL assinada.

## Roadmap de RH — próximas etapas

1. **Prontuário pesquisável:** transformar Funcionários em uma busca explícita, sem carregar todos os cadastros inicialmente; abrir um funcionário por vez em um workspace de prontuário.
2. **Advertências:** registrar medida disciplinar, ocorrido, motivo, anexos, responsável, auditoria e retificação/cancelamento sem apagar histórico.
3. **Catálogo de benefícios e descontos:** cadastrar tipos, natureza, regras de cálculo, valor padrão, autorização, recorrência e status.
4. **Lançamentos por competência:** lançar benefícios e descontos para um funcionário ou em lote, com origem, observação, parcelas, autorização e estados de processamento.
5. **Integração com fechamento:** mostrar os lançamentos na prévia mensal, permitir revisão antes da confirmação e bloquear alterações diretas após o fechamento.


## Continuação — tela de funcionários e prontuário

A tela administrativa mantém a busca inteligente server-side e passa a tratar a seleção como uma prévia operacional inline: o clique em uma pessoa substitui o diretório por um resumo mensal com competência selecionável, avatar, horas, extras, faltas e alertas relevantes. Um CTA explícito abre o prontuário completo em modal, sem conceder essa tela ao perfil funcionário.

O modal completo reutiliza as coleções do prontuário já existentes e organiza as áreas em abas. O cabeçalho combina avatar circular, nome, cargo, vínculo e situação. As abas preservam a faixa compacta e só exibem scrollbar quando houver hover/foco, mantendo acessibilidade por teclado. A linha do tempo passa a filtrar eventos de ponto normais e preserva apenas movimentos relevantes; as abas de atestados, afastamentos, justificativas, advertências, férias, documentos, holerites, benefícios e descontos continuam prontas para receber os atalhos de lançamento das RPCs existentes.

A publicação de teste usa o workflow já versionado em `.github/workflows/deploy-pages.yml`, acionado por uma branch de publicação temporária, sem merge em `main`. Não é necessária migration nova enquanto a prévia consumir as coleções já retornadas por `app_admin_prontuario`.

## Refinamento visual — prévia executiva e ponto

A prévia deve funcionar como uma tela de decisão para o gestor, e não como um recorte do prontuário: identidade e contexto do vínculo ficam separados dos indicadores da competência; cada indicador mostra valor e interpretação curta; alertas relevantes aparecem em uma lista objetiva; e a ação de abrir o prontuário permanece secundária, porém evidente. A superfície clara usa bordas suaves, sombras discretas, tipografia hierárquica e espaçamento consistente para reduzir a sensação de conteúdo colado.

O prontuário mantém a mesma linguagem visual e passa a renderizar ponto em uma lista operacional própria, com data, entrada, saída, horas trabalhadas, extras e situação em colunas legíveis. Os dados exibidos são exclusivamente os retornados pelo prontuário, preservando a distinção entre remuneração mensal e diária e sem criar valores de compensação.
