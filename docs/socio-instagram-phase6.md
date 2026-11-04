# Sócio — Fase 6: Instagram profissional (04/11/2026)

## Entrega técnica

- Instagram Business/Creator por empresa, via Instagram API with Instagram Login. Não usa a integração WhatsApp, anúncios ou prospecção.
- Proprietários e administradores iniciam OAuth. Estado de 256 bits, hash no PostgreSQL, expiração em 10 minutos e consumo único.
- Callback server-side. Token de longa duração é cifrado AES-256-GCM com uma chave derivada da variável privada CHANNEL_ENCRYPTION_KEY. Nunca aparece no navegador ou em logs.
- Canal por perfil Instagram único: um IG user ID não pode ser reivindicado por outra empresa.
- Webhook exclusivo GET/POST /webhooks/instagram com desafio de verificação, assinatura HMAC SHA-256, rejeição de eco, mídia não suportada, mensagem repetida e contas desconectadas.
- Conversas entram no inbox do Sócio, com origem Instagram ou WhatsApp identificada. Os três filtros aprovados de atendimento permanecem.
- Respostas somente manuais e após mensagem recente do cliente (últimas 23 horas). Máximo 1.000 caracteres e bloqueio de IA automática para esse canal.
- Registro de envio por UUID para evitar duplicação: resultados desconhecidos nunca são reenviados automaticamente.
- Desconexão transacional com revogação da credencial local, auditoria e preservação do histórico do tenant.
- Novas tabelas instagram_oauth_states, instagram_accounts e instagram_outbox com integridade referencial por tenant.
- Ambiente Supabase privado preparado com 31 tabelas, sem dados de clientes e sem exposição ao Data API.

## Configuração da Meta necessária para habilitar

As seguintes variáveis pertencem ao servidor Railway socio-app, jamais ao frontend:

- SOCIO_PUBLIC_URL: URL HTTPS pública, sem caminho.
- INSTAGRAM_APP_ID: ID do aplicativo Meta com Instagram Login configurado.
- INSTAGRAM_APP_SECRET: segredo oficial do aplicativo.
- INSTAGRAM_WEBHOOK_VERIFY_TOKEN: segredo aleatório compartilhado entre o webhook Meta e Railway.
- CHANNEL_ENCRYPTION_KEY: a chave privada existente para proteção de credenciais.
- INSTAGRAM_GRAPH_VERSION: opcional, padrão v26.0, sujeito às versões habilitadas pela Meta.

Redirect URI oficial: https://socio-app-production-762c.up.railway.app/api/instagram/oauth/callback

Webhook URI: https://socio-app-production-762c.up.railway.app/webhooks/instagram

Escopos necessários: instagram_business_basic e instagram_business_manage_messages. Revisão de app e permissões podem ser necessárias antes de conectar clientes externos.

Documentação Meta:
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api

## Segurança e verificação

Testes automatizados com PostgreSQL descartável e respostas Meta simuladas comprovam autorização com estado único, criptografia, assinatura webhook, deduplicação, isolamento entre duas empresas, resposta humana idempotente, recusa fora da janela e revogação. Testes HTTP verificam ausência de envio quando nenhuma conta autorizou a integração e exigência de CSRF.

Sem ID/segredo de aplicativo Meta e autorização de uma conta profissional, a guia mostra corretamente a integração como não configurada. Não inventar credenciais nem enviar mensagens reais a terceiros.

Faltam: conexão real de conta empresarial consentida, envio e recebimento de teste entre duas contas autorizadas, análise e homologação Meta, reconexão antes do vencimento dos tokens, e monitoração específica dos webhooks Instagram.

A integração não altera a conexão ao PostgreSQL Railway de produção nem instala Supabase Auth. Nenhum contato é abordado de forma proativa.
