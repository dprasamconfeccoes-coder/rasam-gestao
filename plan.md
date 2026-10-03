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

## Design

Movimento visual: **editorial operacional dark**, com alto contraste e acentos magenta/dourado RF. Princípios: clareza em decisões, densidade controlada, estados explícitos e mobile-first. O layout usa navegação lateral no desktop e navegação recolhida no celular; cards substituem tabelas estreitas. A marca usa RF como selo e tipografia sans geométrica, com microcopy direta e operacional.

## Estrutura

- `src/features/AdminCenter.tsx`: workspace administrativo unificado.
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
