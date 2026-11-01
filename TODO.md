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


## Melhoria da tela administrativa de funcionários — anexo 2026-11-01
- [ ] **Prévia mensal ao selecionar funcionário:** ao clicar em um resultado da busca administrativa, limpar o foco da lista e mostrar somente uma prévia do funcionário com avatar, competência selecionável, horas trabalhadas/extras, faltas, ausências e alertas de ponto; incluir link para abrir o prontuário completo.
- [ ] **Prontuário completo refinado:** abrir os detalhes em modal, com avatar e nome no cabeçalho, abas de resumo, linha do tempo, ponto, atestados, afastamentos, justificativas, advertências, férias, documentos, holerites, benefícios e descontos; exibir a barra de rolagem das abas somente quando o cursor estiver sobre a faixa ou quando ela receber foco.
- [ ] **Linha do tempo relevante:** não registrar dias de ponto normais; mostrar somente inconsistências, horas extras, faltas, afastamentos, atestados, justificativas e demais movimentos relevantes.
- [ ] **Publicação de teste:** validar o build e publicar a branch de teste no GitHub Pages sem alterar a branch principal.
- [ ] **Prévia executiva refinada:** a prévia mensal deve separar identidade, vínculo/remuneração, indicadores de jornada e alertas relevantes, usando espaçamento, hierarquia tipográfica e estados visuais claros; o gestor deve conseguir compreender a competência sem abrir o prontuário completo.
- [ ] **Ponto com apresentação operacional:** a aba de ponto deve usar uma listagem própria com data, entrada, saída, horas trabalhadas, extras e situação, em vez da lista genérica de registros, sem inventar valores quando o dado não existir.
