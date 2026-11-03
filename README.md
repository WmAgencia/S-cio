# Sócio — por Consecom

SaaS multiempresa de atendimento e vendas. Projeto independente do Prospector: nunca compartilha banco, sessões ou informações de clientes com o sistema de prospecção.

## Funcionalidades entregues no MVP

- Painel premium responsivo e acesso de proprietário, administrador e atendente.
- Administração Consecom para cadastrar clientes, planos e alternar entre empresas.
- Contas isoladas por empresa (tenant_id em todas as consultas de dados).
- Login seguro com scrypt, sessões persistentes, cookie HttpOnly/SameSite e CSRF.
- Cadastro de WhatsApps, produtos, descrições e preços oficiais.
- Importação de conversas exportadas do WhatsApp em .txt ou .md. Para .zip, extrair o texto primeiro.
- Base Markdown anonimizada por empresa. Interlocutores ganham nomes genéricos; padrões de telefone, e-mail, links e documentos numéricos são mascarados.
- Configuração de nome, tom e instruções do agente.
- Simulador de atendimento com Groq (quando a chave estiver configurada). Nunca envia mensagens.
- Webhook verificado por assinatura SHA256 para receber mensagens de texto da WhatsApp Business Platform; o vínculo do identificador do número à empresa é restrito ao administrador da Consecom.
- Caixa de entrada, histórico, classificação e notas internas.
- Testes automatizados com PostgreSQL efêmero no GitHub Actions.

## Deploy Railway

1. Use projeto Railway separado, de preferência 'socio-consecom', com PostgreSQL privado e serviço web GitHub WmAgencia/S-cio / main.
2. No serviço web defina DATABASE_URL apontando para a variável de referência Postgres.DATABASE_URL. O Railway fornece PORT.
3. Configure SETUP_TOKEN com pelo menos 32 caracteres criptograficamente aleatórios (visível apenas nas variáveis seguras do Railway). Nunca coloque esse token no repositório ou compartilhe publicamente.
4. NODE_ENV=production.
5. Gere domínio HTTPS Railway. No primeiro acesso, informe token, nome, empresa, e-mail e senha forte. Depois a instalação fica fechada para novas contas principais.
6. Opcional: GROQ_API_KEY e GROQ_MODEL (padrão llama-3.3-70b-versatile) para o laboratório.
7. Opcional: META_WEBHOOK_VERIFY_TOKEN e META_APP_SECRET para o webhook Meta em /webhooks/whatsapp. O administrador precisa validar o Phone Number ID para associar cada número à empresa correta.

## Segurança e limites

MVP para testes e pilotos supervisionados, ainda não preparado para venda irrestrita. Não oferece envios automáticos, conexão real de WhatsApp sem credenciais oficiais, cobrança Stripe, redefinição de senha, backups de restauração testados, exclusão/retensão LGPD, chamadas de voz, importação direta de ZIP ou isolamento PostgreSQL RLS adicional. O campo de plano é administrativo e não efetua cobranças.

Treine o agente somente com conversas cuja utilização esteja autorizada. A anonimização inicial trata padrões comuns, mas não garante remoção completa de todos os dados pessoais inseridos no texto; revise arquivos antes de importar.

A configuração do agente como "Preparado" nunca inicia atendimento real ou mensagens externas.

## Desenvolvimento

Node.js 20+ e PostgreSQL.

Comandos: npm install, npm test e npm start.

O teste e2e requer DATABASE_URL apontando para um Postgres descartável. O GitHub Actions provisiona esse Postgres automaticamente; não use banco de produção para rodar o teste de instalação.
