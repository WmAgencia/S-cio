# Sócio — Etapa 5: rastreamento de conversas, respostas e vendas

## Situação do projeto antes desta entrega

A Etapa 5 parte do MVP `whatsapp-attribution.mjs`: links `wa.me` com código pré-preenchido por tenant, conta Meta selecionada, número WA-AKG e identificadores opcionais de campanha/conjunto/anúncio. O scanner opt-in registra somente mensagens recebidas de fato, primeiro toque e isolamento por tenant. A presença de um código NÃO comprova o clique de anúncio nem a venda.

A plataforma também tem:
- Criação/consulta de pixels via API oficial da Meta — **não** instala automaticamente em sites de terceiros nem ativa a CAPI.
- Pedidos supervisionados e Stripe **exclusivamente em modo de teste**. Sem pagamento real validado neste serviço, não há dados confiáveis de receita real.
- Gateway WA-AKG em Railway, porém o último diagnóstico retornou **zero sessões conectadas**, impedindo homologação física deste fluxo.

## Entregas implementadas

1. `whatsapp-funnel.mjs`: relatório somente leitura e isolado por empresa. A consulta usa registros reais do banco de conversas, com subconsultas correlacionadas por tenant e por conversa para impedir multiplicação de pedidos, contagem de mensagens de outras empresas e duplo crédito de pagamentos.
2. Métricas por link: conversas com código, conversas respondidas pela empresa com mensagem outbound reconhecida pelo provedor, clientes que responderam depois, média de tempo até a primeira resposta, orçamentos, interesses de compra, pedidos cadastrados, pagamentos de **teste** Stripe e valor de teste.
3. Pagamentos reais/receita de produção aparecem como **indisponíveis (null)**, nunca com valor ou número fabricado. Orçamentos, intenções e pedidos pendentes não se tornam `Purchase`.
4. Endpoint autenticado `GET /api/marketing/attribution/funnel` com `marketing.read` e os módulos Meta Ads + WhatsApp; nenhuma mensagem é enviada, e nenhuma campanha é editada.
5. Resposta conversacional pelo painel e futuramente pelo número privado WA-AKG autorizado: "quantas conversas chegaram e responderam no WhatsApp?" usa dados da tabela, não texto fixo ou estimativas.
6. Tela de rastreamento passa a mostrar respostas, follow-ups, pedidos e pagamentos de sandbox explicitamente identificados.
7. Testes de escopo, aprovação, dados ausentes, cartão de pedido e confirmação de pagamento **somente teste**, além de ensaio com PostgreSQL temporário e duas empresas.

## Semântica e limitações

- `conversations` é somente o conjunto de conversas onde um código foi observado, **não o total de conversas WhatsApp da empresa**.
- `businessResponded` requer uma mensagem outbound após a atribuição, com `provider_id` registrado; rascunhos locais sem comprovante do provedor não contam.
- `customerFollowedUp` exige nova mensagem inbound depois da primeira resposta da empresa.
- `purchaseIntents` não comprova pagamento; `ordersCreated` não prova liquidação.
- `sandboxPaidOrders` e `sandboxRevenueCents` contam somente pedidos do `stripe_test`, status `paid_test` e `paid_at` depois da primeira mensagem com código; servem apenas para QA. Estes valores não entram em ROAS ou vendas reais.
- `livePaidOrders=null` e `liveRevenueCents=null` até webhook autenticado de um provedor autorizado de produção; sem contato com contas de terceiros.
- Atribuição é **indicativa** pelo texto pré-preenchido. Não inventar ID de anúncio obtido pelo WA-AKG e não marcar como comprovado um clique Meta.
- Retorno limitado a 100 links por consulta; ao atingir 100, informa parcial.
- `SOCIO_ATTRIBUTION_ENABLED` continua desligado até uma sessão real de teste e consentimento. Esta PR não muda flags nem aciona CAPI.
- LGPD: processamento de dados e consentimento/legítima base precisam ser revisados para cada negócio. Nunca transmitir conteúdo de conversa ou dados pessoais para a Meta sem as autorizações e configurações exigidas.

## Validações ainda necessárias para finalizar a etapa completa

1. Conectar uma sessão WA-AKG de teste, enviar uma mensagem com código e verificar ingestão/contagem real com o worker explicitamente habilitado no piloto.
2. Validar metadados de indicação Click-to-WhatsApp em payloads reais antes de usar atribuição de confiança maior.
3. Para sites, vincular domínio/checkout sob autorização, instalar Pixel no navegador, configurar CAPI com deduplicação e validar eventos no Gerenciador de Eventos da Meta após consentimento.
4. Homologar webhook de pagamento **em produção** com assinatura verificada, valor, pedido e tenant para possibilitar registrar vendas reais.
5. Confrontar leads e vendas com métricas Meta e Google Ads (Google ainda sem OAuth/API) antes de calcular ROAS.
6. Testar duas empresas reais com consentimento para garantir que nenhuma informação se misture.

## Critério de publicação desta iteração

CI completo com PostgreSQL e regressões, worker backup OK, Railway SUCCESS e serviço inicializado. Isso **não** equivale à homologação de CAPI, vendas reais ou WA-AKG físico.
