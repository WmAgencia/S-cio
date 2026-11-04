# Sócio — Integração exclusiva com Meta Ads

**Escopo vigente (04/11/2026): somente Meta Ads.**

O proprietário da empresa acessa **Anúncios e métricas → Conectar Meta Ads**, autoriza pelo login hospedado do Pipeboard e retorna automaticamente ao Sócio. A aplicação usa OAuth com PKCE S256, estado de uso único, sessão vinculada à empresa, limite de validade do pedido e credenciais cifradas. O Sócio verifica o acesso de **leitura às contas publicitárias** no retorno; só afirma que uma conta foi confirmada após uma leitura bem-sucedida.

A operação permanece **somente leitura**. O Sócio não cria anúncios, não modifica campanhas e não altera orçamento sem um processo futuro separado de autorização.

- Servidor MCP Meta Ads: https://meta-ads.mcp.pipeboard.co/
- Gerenciamento externo das permissões/contas: https://pipeboard.co/connections
- Código principal: `marketing-oauth.mjs`
- Endpoints: `POST /api/marketing/oauth/start` com `provider: "meta"`, `GET /api/marketing/oauth/callback`, `POST /api/marketing/oauth/meta/test`, `POST /api/marketing/oauth/meta/disconnect`, `GET /api/marketing/oauth`.

## Google Ads descontinuado

O Google Ads foi retirado da tela, da autorização OAuth, do teste de contas e do recebimento de relatórios por Scripts. Nenhuma nova conexão é aceita. Na inicialização, o Sócio consome tentativas OAuth antigas do Google, revoga os **tokens locais** antigos e desabilita chaves do Google Ads Scripts armazenadas anteriormente. **As métricas históricas são preservadas no PostgreSQL**, mas não são exibidas no painel de Meta Ads.

A revogação local não revoga consentimentos eventualmente registrados fora do Sócio; o titular também pode gerenciar autorizações antigas diretamente no parceiro.

As tabelas históricas de migração foram mantidas para preservar integridade e evitar exclusão de dados. Módulos legados de Google não possuem rotas públicas de utilização.

## Instagram

Instagram não faz parte da interface de anúncios. O laboratório privado de Instagram, de etapas anteriores, permanece isolado e sem qualquer ação automática. Ele não interfere na experiência de Meta Ads.

## Condições para acesso real

A conexão de um clique requer que cada cliente faça login e autorize a própria conta no Pipeboard. Uma autorização de login não é garantia de que uma conta de anúncios foi liberada. O painel distingue essas condições e permite testar a leitura novamente.

Permanecem sem alterações os backups, a operação multiempresa, o WhatsApp e os demais módulos do Sócio.
