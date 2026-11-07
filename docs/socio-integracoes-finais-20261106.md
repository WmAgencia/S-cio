# Sócio — Consolidação das frentes pendentes (2026-11-06)

## Entregue em código (habilitação segura)

### 1. Assinaturas e sete dias de teste
- Checkout de assinatura Stripe por ação explícita do proprietário, sem cobrar ao criar empresas; preços definidos exclusivamente pelas variáveis privadas `SOCIO_STRIPE_PRICE_ESSENCIAL`, `SOCIO_STRIPE_PRICE_EQUIPE` e `SOCIO_STRIPE_PRICE_VOZ`.
- Nenhum preço, recorrência ou taxa foi inventado. O checkout exibe os valores oficiais da Stripe para aprovação do assinante.
- `/api/billing/status`, `/api/billing/checkout`, `/api/billing/portal`; webhook `/webhooks/stripe-saas` usando assinatura Stripe no payload bruto e limite de tempo de 5 minutos; eventos idempotentes.
- Registro em `socio_billing_accounts` e `socio_billing_webhook_events` separado dos `sales_orders` de clientes e Stripe modo TESTE.
- Diferencia ambiente test/live, pagamento realizado e conta cadastrada. **Nunca altera `tenants.status` nem executa suspensão automática**. Para um teste com menos de 48h restantes, impede iniciar checkout que eliminaria antecipadamente a gratuidade.
- Necessário para habilitar: preços dos três planos, chave Stripe, segredo do webhook, URL pública HTTPS e `SOCIO_BILLING_ENABLED=true`. Atualmente **nenhuma credencial de assinatura** está cadastrada no serviço Railway. Não ativar essa flag antes da homologação de test mode e das condições comerciais.

### 2. Google Ads oficial
- OAuth 2.0 com PKCE, estado único, prazo de 10 minutos e vinculação à sessão/tenant; refresh token cifrado no banco, nunca entregue ao navegador. Rotas `/api/google-ads/connect`, `/api/google-ads/oauth/callback`, `/api/google-ads/status`, `/api/google-ads/accounts`, `/api/google-ads/accounts/select`, `/api/google-ads/disconnect`.
- Acesso a contas diretamente autorizadas via `GET https://googleads.googleapis.com/v26/customers:listAccessibleCustomers` com `developer-token` obrigatório, conforme documentação do Google: https://developers.google.com/google-ads/api/rest/auth
- O conector é **somente leitura**; não cria campanhas, cobrança ou conversões. Clientes subordinados de MCC exigem enumeração adicional para operações de agência.
- Requisitos para conectar: um aplicativo OAuth de Google Ads aprovado, `SOCIO_GOOGLE_OAUTH_CLIENT_ID`, `SOCIO_GOOGLE_OAUTH_CLIENT_SECRET`, `SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN`, `CHANNEL_ENCRYPTION_KEY` e opt-in `SOCIO_GOOGLE_ADS_ENABLED=true`. Em produção essas credenciais Google ainda não foram fornecidas.

### 3. Pixel, site e Meta Conversions API
- `POST /api/tracking/sites` cadastra domínio HTTPS + Pixel da **conta Meta autorizada**, validando a posse via consulta da API; emite segredo aleatório **somente uma vez** para o backend daquele site. A conexão começa DESATIVADA.
- `GET /api/tracking/sites`, `PUT /api/tracking/sites/{id}/enabled` e webhook `POST /webhooks/site-events`. O webhook usa `x-socio-site-id`, `x-socio-timestamp` e `x-socio-signature=sha256=<hex>` sobre a concatenação `timestamp + "." + raw-json-bytes`.
- Exige `consent:true`, mesmo domínio HTTPS, `event_id` UUID e eventos autorizados (`PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Lead`). O mesmo ID deve ser enviado ao Meta Pixel como `eventID` para deduplicação.
- **`Purchase` é proibido neste webhook**. Uma venda precisa vir de pagamento real confirmado por integração independente, não de clique, intenção, conversa ou formulário.
- `SOCIO_SITE_EVENTS_ENABLED` ativa a coleta assinada somente após um teste real. `SOCIO_META_CAPI_ENABLED` ativa o encaminhamento à API Meta quando houver cookie de identificação consentido, Pixel aprovado e credencial de anúncios com permissão. Não ativa automaticamente.
- Respostas incertas da Meta são registradas e **não reenviadas automaticamente**. Não expõe conteúdo de conversas, e-mail ou telefone do cliente.
- **A etapa não instala código em sites de terceiros automaticamente**. A agência precisa autorizar cada site/domínio e implantar a integração entre consentimento, Pixel/browser e backend. Sem validação no Events Manager, não afirmar que os eventos reais foram entregues.

### 4. Diagnóstico unificado
- `GET /api/integrations/readiness`: painel do proprietário que informa bloqueios de Stripe, Google Ads, Meta CAPI, WhatsApp WA-AKG, vendas reais e relatórios recorrentes Meta.
- UI de Relatórios tem diagnóstico, estado de assinatura, botões de Checkout/Portal que só aparecem quando configurados e fluxo para conectar Google Ads via OAuth e selecionar uma conta, sem expor credenciais.
- A consulta não liga workers, cria anúncios, cobra assinantes nem envia mensagens.

## Bloqueadores externos e homologação real

1. **WA-AKG** — servidor está acessível e autorizado, mas o último teste informou `sessions:0`. É necessária uma sessão real e conversa privada de teste, com autorização do dono. Grupos não são homologados.
2. **Google Ads** — aplicativo OAuth + developer token precisam estar disponíveis e aprovados; fazer conexão pelo botão de OAuth e testar `listAccessibleCustomers`. A criação de campanhas Google e Google tag ainda não foi implementada/homologada.
3. **Stripe SaaS** — definir preços, política de cobrança, consentimento e impostos, configurar webhooks reais, testar checkout em sandbox e somente depois habilitar modo live com autorização explícita.
4. **Receita de clientes** — webhooks de checkout **de produção dos próprios clientes** precisam ser conectados por tenant para atribuir vendas; não confundir com a cobrança SaaS acima. `Purchase`/ROAS de produção ainda não podem ser afirmados.
5. **Pixel/CAPI** — autorizar cada domínio, instalar Pixel no navegador e eventos com consentimento, integrar assinatura HMAC do backend, conferir deduplicação e testar no Events Manager.
6. **Automações e alertas** — preservar flags opt-in; homologar workers em ambiente controlado antes de liberar disparos, relatórios ou otimização recorrente. Monitoramento interno e backups existentes são mantidos; alertas externos requerem canal autorizado.

## Protocolo de ativação recomendado

1. Rodar testes de unidade e integração (inclusive PostgreSQL), CI e backup; deploy saudável no Railway.
2. Homologar Google OAuth, Stripe **teste**, um site próprio com evento Lead e um número WA-AKG real com consentimento.
3. Verificar eventos, status, idempotência e isolamento entre empresas, usando contas com gastos/cobranças controlados e explícitos.
4. Definir preços e autorizações para produção. Só então habilitar `SOCIO_BILLING_ENABLED`, `SOCIO_SITE_EVENTS_ENABLED`, `SOCIO_META_CAPI_ENABLED` ou workers correspondentes.
5. Não divulgar o Sócio como gestor de Google Ads, faturamento de produção ou CAPI homologada até existir prova dos resultados externos.

## Contrato de qualidade

Esta entrega prepara integração e visibilidade das pendências, mas **não contorna aprovações do Google ou Meta, não cria sessão WhatsApp e não infere receita financeira não comprovada**. Todas as alterações mantêm a segregação de empresas e a revisão de gastos e mensagens.
