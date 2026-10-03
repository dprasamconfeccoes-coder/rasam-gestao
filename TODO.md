# Entregas do Rasam Gestão

- [ ] **Login único por CPF e senha inicial da data de nascimento:** o sistema deve aceitar CPF e senha, identificar automaticamente funcionário, gestor ou administrador, aplicar expiração de sessão e exigir troca da senha temporária no primeiro acesso.
- [ ] **Controle de acesso por perfil:** funcionário acessa somente suas funcionalidades; gestor acessa também a visão gerencial; administrador acessa o conjunto completo. A autorização deve ser aplicada no frontend e nas RPCs/RLS do Supabase.
- [ ] **Sistema administrativo unificado:** reunir dashboard, ordens de serviço, produção, materiais, expedição, financeiro, contábil, dívidas, RH, folha, qualidade, relatórios e configurações sem depender de mocks, timers ou armazenamento temporário como banco.
- [ ] **Aplicativo do gestor incorporado:** entregar indicadores, alertas, filtros, ordens, lotes, produção, financeiro e RH dentro do mesmo login e banco.
- [ ] **Portal do funcionário incorporado:** entregar perfil, ponto, holerites, documentos, atestados, avisos, benefícios e solicitações ao RH com dados reais e registros persistidos.
- [ ] **Tipos de cadastro de funcionário:** o sistema deve aceitar cadastro completo para empregados com ficha trabalhista e cadastro básico para funcionários administrativos ou em teste de três meses, sem exigir CBO ou outros campos de registro ainda inexistentes; ambos devem poder acessar o aplicativo conforme o perfil.
- [ ] **Carga real da ficha de empregado:** extrair e inserir os empregados da ficha no Supabase, criar as contas iniciais e preservar os dados pessoais fora do repositório público.
- [ ] **Responsividade e PWA:** interface usável em celular, tablet e desktop, com manifesto, ícones, service worker e cache restrito ao shell público.
- [ ] **Publicação no GitHub Pages:** criar o repositório novo, configurar build reproduzível e publicar o frontend com fallback SPA, sem incluir chaves privadas ou dados pessoais.
- [ ] **Validação de produção:** executar diagnósticos, build, testes de RPC por perfil, proteção de acesso, manifesto, rotas, upload/download privado quando disponível e verificação da URL publicada.

- [x] **Importação real de ponto:** aceitar CSV diário e mensal, cruzar exclusivamente por CPF, persistir linhas encontradas e manter divergências auditáveis.
- [x] **Relatórios operacionais:** gerar impressão em PDF do ponto e conferência de vale-alimentação sem inventar elegibilidade.
- [x] **Acordos e financeiro:** persistir os quatro processos do relatório de pagamentos, oito parcelas com status quitada/pendente e os resumos financeiros do diagnóstico.
- [x] **Documentos internos:** disponibilizar regimento pesquisável e CCT 2025/2026 no módulo de documentos, com acesso conforme perfil.

- [x] **Administrador operacional Renan Ricardo:** o CPF 07056527930 deve identificar Renan Ricardo, permanecer com perfil admin e acessar todos os módulos administrativos e operacionais.
- [x] **Central operacional total:** visualizar ponto geral, decidir justificativas e atestados, responder RH, publicar avisos, consultar/publicar holerites, atualizar dívidas e conduzir produção e ordens.
