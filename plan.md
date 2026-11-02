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
- `src/features/PointManagementDashboard.tsx`: navegação do módulo Gestão de ponto, consulta individual paginada da equipe, importações e estados de carregamento/erro.
- `src/features/PointSchedulesPanel.tsx`: criação e edição de modelos de jornada, atribuições, vigências e histórico por funcionário.
- `src/features/point-management.css`: estilos responsivos do módulo, reutilizando as cores RF e componentes existentes.
- `src/lib/point-import-parser.ts`: leitura resiliente dos relatórios diários/mensais em CSV, XLS e XLSX.
- `src/lib/api.ts`: chamadas RPC tipadas.
- `src/lib/types.ts`: contratos de domínio.
- `supabase/migrations/0094_point_management_schedules.sql`: estrutura aditiva das jornadas versionadas e RPCs administrativos multiempresa.
- `supabase/migrations/0095_point_import_validation_details.sql`: expõe apenas CPF de origem e erros de validação necessários à prévia, sem retornar o JSON bruto completo.
- `public/manus-routes.json`: rotas de produto.

## Módulo completo — Gestão de ponto

### Experiência do gestor

- Renomear o item administrativo atual **Importar ponto** para **Gestão de ponto**, sem remover o acesso de funcionário a **Meu ponto**.
- Reunir três áreas do mesmo módulo: **Ponto da equipe**, **Importações** e **Jornadas**.
- Abrir a consulta da equipe com a competência atual calculada no horário local do navegador. O gestor vê um funcionário por página, pode buscar por nome/CPF e navegar entre pessoas com paginação; funcionários sem marcação no mês continuam consultáveis.
- Manter um título global para o módulo, colocar filtros imediatamente abaixo das abas e mostrar uma única faixa compacta com nome/cargo e navegação. Não repetir o nome em “Ponto”, “Ficha individual” e “Ficha mensal”; remover da ficha de ponto os metadados admissionais/situação que não ajudam a analisar as marcações.
- Selecionar o primeiro funcionário retornado na abertura e manter busca por nome/CPF e controles anterior/próximo visíveis.
- Ao iniciar busca ou trocar a página, limpar a ficha anterior no mesmo evento e incluir busca/página na chave dos dados para nunca renderizar registros de outra seleção durante o carregamento.
- Consultar mês por funcionário, exibir todos os dias do período, marcações, horas trabalhadas, ocorrências e dados de jornada quando existentes. Mostrar horas extras 50% e 100% conforme os valores recebidos no arquivo de origem.
- Comparar jornada prevista e realizada de forma informativa, sem converter diferença em extra legal, falta ou desconto automático. A classificação de hora extra permanece baseada nos campos explicitamente importados até o usuário definir regras adicionais.

### Importação preservada e aprimorada

- Preservar leitura de CSV e XLS/XLSX, cruzamento exclusivamente por CPF, prévia antes de gravar, identificação de inconsistências, aplicação parcial de linhas válidas, histórico e arquivamento rastreável.
- Para XLS/XLSX diário e mensal, procurar cabeçalho nas primeiras linhas de todas as abas e continuar após abas vazias; reconhecer épocas Excel 1900/1904; preservar linhas com marcações mesmo sem CPF/nome.
- Validar os 11 dígitos do CPF antes de aceitar vínculo. Recuperar zero inicial somente quando a célula Excel é numérica e o CPF reconstruído passa nos dígitos verificadores; rejeitar CPFs inválidos sem procurar funcionário e guardar o original para exibição mascarada. CSV não recebe preenchimento automático.
- Para CSV, reconhecer vírgula, ponto e vírgula ou tabulação. Nome divergente entre cadastro e relógio não bloqueia CPF correspondente.
- Tornar os resultados operacionais explícitos: linhas vinculadas por CPF, linhas não localizadas, motivo disponível, estado (pendente/aplicada/arquivada) e orientação contextual acessível por ícone de informação. A RPC de listagem retorna apenas CPF de origem e erros de validação, sem expor o JSON bruto completo.
- Iniciar cada nova importação com a competência do mês atual, no fuso local; permitir editar a competência antes de enviar. Converter a seleção visual de mês para o contrato existente `MM/AAAA`.
- Continuar usando as RPCs existentes `app_importar_ponto`, `app_listar_ponto_importado`, `app_aplicar_importacao_ponto` e `app_ignorar_importacao_ponto`.

### Jornada e vínculo

- Oferecer modelos reutilizáveis de jornada com dois modos: horários fixos por dia da semana e carga horária semanal distribuída pelos dias selecionados, com ajuste diário. Cada dia pode ser descanso ou ter um ou mais períodos de trabalho, contemplando jornada integral e meio período.
- Cadastrar inicialmente modelos sem atribuição automática: **Meio período — tarde (13h–17h)** de segunda a sexta; **Diarista — padrão informado (44h)** e **CLT — padrão informado (44h)** com segunda a quinta 07h–11h e 12h–17h e sexta 07h–11h e 12h–16h. Manter os últimos dois modelos separados para futuras regras por vínculo; a jornada não define tributos nem tratamento legal.
- Criar, editar e inativar modelos sem reescrever versões anteriores. Ao atribuir ou alterar a jornada de um funcionário, registrar data de vigência e preservar o histórico.
- Permitir atribuição para os tipos de vínculo existentes, inclusive diaristas, sem presumir carga legal ou elegibilidade trabalhista apenas pelo vínculo.
- Preservar `funcionarios.horario_trabalho` e `horario_intervalo` em texto e todo o histórico atual; não inferir nem converter automaticamente esses textos em jornadas estruturadas.

### Persistência, acesso e operação

- Armazenar modelos versionados, períodos semanais e atribuições em novas estruturas relacionais/JSON validadas no Supabase. Implementar gravação/leitura via RPCs `SECURITY DEFINER` que validam sessão, perfil administrativo e `empresa_id`; não conceder acesso público direto às tabelas.
- A migração de jornadas é exclusivamente aditiva: cria novas estruturas e funções, sem atualizar, apagar ou recalcular registros existentes. A extensão de listagem também mantém o escopo de gestor e tenant.
- Desenvolver e validar primeiro no checkout local do repositório GitHub Pages `dprasamconfeccoes-coder/rasam-gestao`, preservando o visual e os padrões existentes. Compilar e revisar código antes da homologação.
- O workflow do GitHub publica automaticamente em GitHub Pages ao receber push em `main`; mudanças de produção devem corresponder ao escopo aprovado pelo usuário.

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
