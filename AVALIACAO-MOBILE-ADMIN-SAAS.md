# Avaliação real — funcionário, administrador e evolução SaaS

## Escopo validado

A validação foi feita com uma conta real de funcionário e com o administrador **Renan Ricardo**. A sessão do funcionário foi restaurada ao estado de primeiro acesso após o teste, mantendo a senha padrão autorizada para a simulação.

## Resultado do funcionário

O perfil `funcionario` recebeu somente:

- Visão geral;
- Meu perfil;
- Meu ponto;
- Holerites;
- Atestados;
- Solicitações ao RH;
- Avisos;
- Documentos internos.

O funcionário não recebeu módulos de dívidas, financeiro, importação, acordos ou central administrativa. A captura mobile mostrou boa adaptação em 390×844 px. As telas de visão geral e atestados ficam legíveis, com cards empilhados e navegação recolhida.

## Resultado do administrador

O perfil `admin` do Renan acessou a Central operacional em 390×844 px, com abas para ponto geral, justificativas, atestados, solicitações de RH, holerites, avisos, dívidas e produção. O conteúdo cabe na viewport, mas a tabela de ponto precisa de uma segunda rodada visual: cargos longos comprimem a linha em telas estreitas. A recomendação é trocar a tabela mobile por cards ou permitir rolagem horizontal explícita.

## Bugs corrigidos

1. `app_listar_funcionarios` retornava HTTP 400 por ambiguidade entre a variável `perfil` e a coluna `perfil`; a função foi qualificada e os tipos de retorno foram normalizados.
2. `app_listar_ordens` retornava HTTP 400 porque ordenava por `created_at`, coluna inexistente; a ordenação passou a usar `prazo`.
3. O primeiro acesso podia ser contornado ao recarregar uma sessão; `app_sessao` agora retorna `primeiro_acesso` e o frontend mantém a tela de troca de senha.

## Redundância identificada

A Central operacional deve ser tratada como **workspace administrativo**, não como um segundo menu paralelo. Na evolução SaaS, as ações administrativas devem ser consolidadas em uma única área com abas e permissões por ação; o menu lateral deve oferecer apenas atalhos para páginas, sem duplicar CRUDs.

## Próxima arquitetura SaaS

Antes de comercializar para outras empresas, o produto precisa adotar isolamento por `tenant_id` em funcionários, usuários, ponto, RH, financeiro, documentos, ordens, produção e avisos; políticas RLS por empresa; convite e onboarding de empresa; papéis configuráveis; trilha de auditoria; armazenamento de documentos por tenant; exportações; configurações de marca; e cobrança/plano separados da operação.

A etapa atual corrige os bugs e valida os perfis reais. A transformação SaaS completa deve ser uma fase própria, pois altera schema, autorização, navegação e modelo comercial; não deve ser feita como novos remendos sobre o protótipo atual.
