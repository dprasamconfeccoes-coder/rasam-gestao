# Entrega integral RF Gestão SaaS

- [ ] **Multiempresa e identidade:** cada empresa deve possuir configurações, marca, documentos, funcionários, usuários e dados operacionais isolados por `tenant_id`; a empresa atual deve ser preservada como tenant padrão.
- [ ] **Cadastro de vínculos:** o administrador deve cadastrar funcionário formal/CLT ou informal/experiência, com valor mensal ou diária, datas do vínculo e regras de elegibilidade para holerite, escritório e vale.
- [ ] **Prontuário completo:** cada funcionário deve possuir uma página com dados, documentos, atestados, advertências, justificativas, férias, afastamentos, ponto e timeline.
- [ ] **Fechamento mensal:** o sistema deve consolidar ponto, faltas injustificadas, atrasos, saídas antecipadas, horas extras, DSR e decisões de RH por competência.
- [ ] **Relatórios oficiais:** gerar planilha/relatório do escritório e relatório do vale-alimentação; informais ficam fora do escritório e podem ser incluídos no vale mediante opção explícita.
- [ ] **Vale-alimentação:** calcular elegibilidade pelo mês, com regra de R$ 300 e perda automática por falta injustificada não abonada.
- [ ] **Financeiro completo:** cadastrar contas recorrentes, despesas, acordos trabalhistas, parcelamentos com entrada e múltiplas faixas de valores, baixar parcelas e anexar comprovantes PDF/imagem.
- [ ] **Holerites:** publicar/importar holerites em lote, restringir a funcionários formais e exibir no portal somente os seis últimos.
- [ ] **Importar holerite:** em Controle, o gestor ou administrador deve abrir uma tela própria, selecionar o funcionário, selecionar a competência mensal e escolher um PDF do computador; o upload deve registrar o holerite, manter o arquivo privado, exibir o histórico de importações e permitir abertura por URL temporária assinada tanto para o funcionário quanto para o operador.
- [ ] **Funcionários como prontuário pesquisável:** transformar a tela Funcionários em uma busca explícita, sem listar todos os cadastros ao abrir; permitir pesquisa por nome, CPF, situação, tipo de vínculo, cargo e faixa salarial, com paginação e acesso a um funcionário por vez.
- [ ] **Ações no prontuário:** concentrar cadastro, holerites, benefícios, descontos, advertências, férias, documentos, ponto e timeline no prontuário individual, respeitando permissões e registrando auditoria.
- [ ] **Advertências:** registrar ocorrências e medidas disciplinares com motivo, descrição, data, responsável, anexo opcional e cancelamento/retificação auditável sem apagar histórico.
- [ ] **Catálogo de benefícios:** cadastrar benefícios obrigatórios, convencionais ou de iniciativa da empresa, com descrição, regra de cálculo, valor padrão, elegibilidade, vigência e status.
- [ ] **Catálogo de descontos:** cadastrar produtos, marmitas, convênios, adiantamentos e outros descontos, com regra de cálculo, autorização, recorrência e parcelamento.
- [ ] **Lançamentos por competência:** lançar benefícios e descontos individualmente ou em lote, com competência, valor, origem, descrição, autorização, parcelas e status até a aplicação na folha.
- [ ] **Integração com fechamento:** exibir benefícios e descontos na prévia mensal, permitir revisão antes da confirmação e bloquear alterações diretas após o fechamento, usando ajustes auditáveis.
- [ ] **Central sem redundância:** consolidar ações administrativas em um único workspace por domínio, sem duplicar menus ou CRUDs.
- [ ] **Portal do funcionário:** manter acesso somente à própria jornada, justificativas, atestados, solicitações, avisos, documentos, benefício e holerites elegíveis.

## Entrega do módulo Gestão de ponto

- [ ] **Menu e áreas do módulo:** substituir o rótulo administrativo “Importar ponto” por “Gestão de ponto”, mantendo “Meu ponto” para funcionários, e reunir as áreas “Ponto da equipe”, “Importações” e “Jornadas” sem duplicar ações administrativas.
- [ ] **Consulta mensal da equipe:** carregar funcionários por busca e paginação server-side, apresentar uma pessoa por página e permitir navegação anterior/próxima; a lista deve incluir pessoas sem marcações na competência consultada e respeitar o tenant/perfil validado no servidor.
- [ ] **Detalhamento individual diário:** permitir selecionar competência mensal, mostrar todos os dias do mês e as marcações, horas trabalhadas, faltas/atrasos/inconsistências e os valores diários de hora extra 50% e 100% quando vierem da importação; diferenças entre previsto e realizado devem ser informativas e não classificadas automaticamente como hora extra legal.
- [ ] **Competência padrão correta na importação:** ao iniciar uma nova importação, pré-selecionar o mês atual no horário local, permitir a edição pelo operador e enviar a competência no formato `MM/AAAA` aceito pelo backend.
- [ ] **Importação e auditoria preservadas:** continuar aceitando os modelos CSV e Excel usados pelo exportador, cruzar funcionários exclusivamente por CPF, exibir prévia antes da aplicação, deixar inconsistências revisáveis, aplicar somente linhas válidas e preservar histórico, operador, arquivo, competência e arquivamento.
- [ ] **Modelos completos de jornada:** permitir criar, consultar, editar/versionar e inativar jornadas reutilizáveis por horários fixos semanais ou por carga horária total semanal distribuída nos dias selecionados; cada dia deve poder ser descanso, integral ou meio período, com ajuste diário de carga e um ou mais períodos de trabalho.
- [ ] **Atribuição e histórico de jornada:** permitir atribuir jornada a funcionários formais/CLT, informais, em experiência e diaristas; registrar vigência de cada atribuição e preservar a jornada anterior quando houver mudança, sem reescrever períodos fechados ou inferir estrutura a partir de horários legados em texto.
- [ ] **Segurança e compatibilidade da migração:** criar somente estruturas e RPCs aditivas para jornada; validar sessão, perfil administrativo e `empresa_id` no backend, sem conceder acesso público direto às novas tabelas e sem alterar/apagar dados ou registros de ponto existentes.
