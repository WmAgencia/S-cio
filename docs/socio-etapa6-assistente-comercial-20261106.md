# Sócio — Etapa 6: Assistente de vendas e orçamentos supervisionados

## Situação inicial confirmada

A produção Railway mantém `socio-app` com catálogo, variações de produtos, registro de interesse de compra, pedidos de orçamento, emissão e aprovação supervisionada de propostas, Stripe **apenas de teste**, treinamento de conversas e alertas de orçamento ao proprietário por WA-AKG com habilitação e consentimento explícitos.

O envio automático de respostas de atendimento continua sujeito ao `SOCIO_OUTBOUND_ENABLED`, `SOCIO_AUTOREPLY_ENABLED`, autorização humana, sessão ativa e deduplicação do gateway. O último startup indicou zero sessões WA-AKG conectadas; isso exige homologação física antes do uso comercial contínuo.

## Entregas desta PR

- `socio-sales-assistant.mjs` adiciona um assistente **somente leitura** por empresa, usando o banco real de produtos, variações (ativas e inativas), pedidos, oportunidades e presença de treinamento aprovado. Não cria mensagens, propostas, cobranças ou pedidos.
- O comando "prepare o orçamento do último pedido" ou "prepare o orçamento de <cliente>" encontra uma solicitação pendente, somente se identificável com segurança, e sugere uma cotação apenas quando o **nome do único produto, a quantidade, preço e estoque** são inequívocos; não faz suposição sobre variação, frete, prazo ou desconto.
- `POST /api/sales/assistant/chat` autorizado por `sales.read`, módulos `quotes`, `catalog`, `ai` e tenant ativo; rate limiting e auditoria sem armazenar no log conteúdo sensível do pedido.
- A área **Vendas** e a área **Orçamentos** apresentam uma conversa simples com a IA. Em pedidos pendentes há "Sugerir com IA"; sugestões válidas podem apenas **preencher os campos** para revisão. Salvar e enviar permanecem ações explícitas do proprietário.
- `commerce.assistant` integra o catálogo de SKILL.md e o roteador de proprietário, preservando Meta Ads, Google Ads, rastreamento e o WA-AKG.
- Testes unitários e de PostgreSQL com duas empresas asseguram que a IA não consulte dados de outro tenant e que nenhuma proposta seja emitida sem confirmação.

## Segurança e limites

- A IA responde com base no catálogo oficial, não em preço aleatório gerado por LLM. Mesmo se o usuário digitar "confirmo" em uma consulta, não existe ação de envio ou cobrança neste módulo.
- A presença de treinamento **aprovado** é comunicada como status. As versões preliminares ou de outra empresa nunca são apresentadas como treinamento operacional.
- A prévia não altera estoque, pedido, cliente, conversa ou orçamento. Produto inativo, variação pendente, estoque indefinido, pouca quantidade disponível ou preço nulo bloqueiam o cálculo.
- O sistema atual de pagamentos Stripe continua somente em sandbox; nenhuma intenção ou `paid_test` é anunciada como receita real.
- Um relatório de venda sem confirmação financeira de produção não é equivalente a uma venda paga.
- Comandos de vendas pelo WhatsApp exigem que os workers de proprietário do WA-AKG estejam homologados e habilitados. Nenhuma sessão é criada nem mensagem enviada neste PR.

## O que falta para a Etapa 6 ficar totalmente homologada

1. Conectar uma sessão WA-AKG de teste e validar alertas, mensagens privadas, passagem humano/IA, fotos/botões quando suportados.
2. Testar dados de catálogo em lojas reais, incluindo variações de tamanho e estoque, fotos, produtos inexistentes e alterações de preço durante uma proposta.
3. Validar envio supervisionado de orçamento e atendimento do início ao fim com uma empresa piloto, sem duplicidade e sem disparos não autorizados.
4. Evoluir sugestão em rascunho para autorização conversacional persistente com trilha de auditoria; não presumir que preencher campos equivale a um envio autorizado.
5. Homologar pagamento de produção com provedor assinado antes de afirmar vendas pagas e links de checkout reais.

## Aceite desta iteração

CI PostgreSQL + Node, backups, autenticação/isolamento e revisão do frontend em verde; merge em `main`; Railway `SUCCESS` e aplicação iniciada. A homologação real do atendimento WhatsApp e dos pagamentos continua em aberto.
