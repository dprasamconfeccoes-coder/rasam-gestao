# Validação frontend — RF Gestão

Data: 04/10/2026

## Escopos testados

- Login com perfil administrador: aprovado.
- Dashboard administrador com dados reais: 24 funcionários, 8 contas pendentes, R$ 120.000,00 em dívidas.
- Central financeira com 562 compromissos: aprovado.
- Tema claro/cinza com rosa RF e estados semânticos: aplicado.
- Perfil funcionário em primeiro acesso: acessado com senha temporária autorizada.
- Ponto, solicitações ao RH, atestados e avisos: validar após concluir o portal.
- Responsividade: breakpoints existentes para 1050px, 760px e 420px; sidebar móvel, tabelas com rolagem horizontal e formulários empilhados.

## Convenção visual

- Verde: regular, quitado, ativo, positivo.
- Amarelo: pendente, em análise, aguardando.
- Vermelho: vencido, atrasado, negativo, recusado, divergência.
- Rosa RF: navegação ativa e ações principais.

## Validação técnica

- `pnpm check`: aprovado.
- `pnpm build`: aprovado.
- Manifesto: 15 rotas válidas.
- Portal funcionário Alessandra: aprovado; acesso restrito, ponto com status visual e solicitação RH responsiva.
- Fluxo de correção de ponto: solicitação criada com status pendente; decisão administrativa em andamento.
- RH administrativo: solicitação localizada, resposta registrada e status alterado para atendida.
- Ajuste de teste: o banco exige valores técnicos (`atendida`); a interface mantém o rótulo humano “Atendida”.
- Portal funcionário após decisão: aprovado; o pedido aparece como `atendida`, com resposta do RH e pill visual verde.
- Tela móvel observada: layout responsivo com navegação lateral recolhível, cards em 2 colunas no celular, formulários empilhados e tabela de ponto com rolagem horizontal.
