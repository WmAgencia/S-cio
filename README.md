# Sócio — por Consecom

SaaS multiempresa de atendimento e vendas. Projeto independente do Prospector: nunca compartilha banco, sessões ou informações de clientes com o sistema de prospecção.

## Funcionalidades entregues no MVP

- Painel premium responsivo e acesso de proprietário, administrador e atendente.
- Administração Consecom para cadastrar clientes, planos e alternar entre empresas.
- Contas isoladas por empresa (tenant_id em todas as consultas de dados).
- Login seguro com scrypt, sessões persistentes, cookie HttpOnly/SameSite e CSRF.
- Cadastro de WhatsApps, produtos, descrições e preços oficiais.
- Associação de sessões WA-AKG existentes após conferência do número pelo administrador Consecom e histórico disponível com sincronização, pausas e progresso.
- Importação de múltiplas conversas do WhatsApp em `.txt`, `.md` ou ZIP de exportação sem mídia; ZIPs são extraídos em memória com limites de tamanho, sem armazenar o arquivo bruto.
- Base Markdown anonimizada por empresa. Interlocutores ganham nomes genéricos; padrões de telefone, e-mail, links e documentos numéricos são mascarados.
- Análise de conversas **já importadas** com progresso persistente, pausa, retomada, cancelamento, relatório de padrões e Markdown em rascunho, sujeito à aprovação humana.
- Configuração de nome, tom e instruções do agente.
- Simulador de atendimento com Groq (quando a chave estiver configurada). Nunca envia mensagens.
- Webhook verificado por assinatura SHA256 para receber mensagens de texto da WhatsApp Business Platform; o vínculo do identificador do número à empresa é restrito ao administrador da Consecom.
- Caixa de entrada, histórico, classificação e notas internas.
- Testes automatizados com PostgreSQL efêmero no GitHub Actions.

## Fundação Supabase — em preparação, não conectada à produção

O projeto Wmagencia `svbdigkomsbugiyufdtc` recebeu migrations aditivas em `supabase/migrations/`, contendo 14 tabelas de tenant, canais, mensagens, produtos, mídias e análises com RLS e bucket privado `socio-media`. As contas do Sócio Railway **não foram migradas** e suas credenciais de login antigas não funcionam automaticamente no Supabase Auth. O banco principal continua sendo o PostgreSQL Railway até que a migração com validação, backup, mapeamento de usuários e teste de rollback seja concluída.

## Análise de conversas

Em Treinamento, após importar os exemplos, clique em **Analisar conversas**. O processamento opera sobre as amostras anonimizadas guardadas pelo próprio Sócio; permite importar pelo gateway os históricos disponíveis nas sessões WA-AKG previamente vinculadas; a sincronização e a análise de Markdown continuam duas ações separadas. O progresso é por fonte processada, não por caracteres ou por conversas externas. Ao final, revise o relatório e o Markdown e use **Aprovar conhecimento** para substituir o conhecimento atual do agente. Novos arquivos importados são armazenados como fontes e não modificam o prompt do agente até que uma versão da análise seja aprovada. A aprovação não dispara mensagens externas. Expressões como “fechar pedido” não provam venda; precisamos de confirmação de vendas/CRM para analisar conversão real.

## Integração WA-AKG exclusiva do Sócio — conexão por QR Code

O gateway WA-AKG e seu MySQL foram provisionados no mesmo projeto Railway `socio-consecom`, mas são serviços independentes do Prospector. O gateway é **privado** (`socio-waakg.railway.internal:3000`) e não recebe domínio público. Ele instala uma versão fixa de WA-AKG, cria uma única conta de integração por segredo de servidor e desliga as rotinas nativas de resposta e toda função de envio (`SOCIO_GATEWAY_READ_ONLY=true`).

No painel, o proprietário ou administrador da empresa entra em **WhatsApps → Conectar novo número**, gera seu QR e escaneia no WhatsApp > Dispositivos conectados. A sessão possui identificador aleatório e vínculo exclusivo ao tenant. O QR aparece como imagem na interface, nunca a chave do gateway. Ao reconhecer o telefone conectado, o Sócio atualiza o canal com o número verificado. Controles disponíveis: verificar, reiniciar, pausar e desconectar. O mesmo número conectado não pode pertencer a duas empresas.

O histórico já armazenado pelo WA-AKG pode ser sincronizado na guia Treinamento; imagens e vídeos ainda não são analisados automaticamente. O Markdown gerado exige aprovação antes de alterar a IA. Não se envia nenhuma mensagem nesta fase.

A ligação depende do WhatsApp do proprietário **escanear o QR**: isso não pode ser feito automaticamente por quem administra a infraestrutura. O gateway não fica público, e suas variáveis (`WA_AKG_API_KEY`, `SOCIO_GATEWAY_ADMIN_PASSWORD`, `AUTH_SECRET`) ficam somente no Railway.

**Limite e conformidade:** o modo atual usa uma integração não oficial baseada em WhatsApp Web, sujeita a incompatibilidades e eventuais restrições do WhatsApp. Para oferecer a operação em escala, há uma etapa futura de migração/alternativa para WhatsApp Business Platform oficial, conforme elegibilidade e requisitos. A importação de mensagens deve ser feita com autorização e política de retenção.

## Catálogo comercial — produtos, fotos, variações e campanhas

A guia **Produtos e serviços** permite criar e editar produtos com nome, descrição, SKU opcional, preço em centavos, preço anterior opcional, estoque e disponibilidade. É possível adicionar até **25 variações** com preço e estoque próprios e até **8 fotografias** por produto.

As imagens passam por transcodificação no servidor (JPG otimizado, 1600 px, sem EXIF), ficam armazenadas no bucket privado Railway `socio-product-media` e são exibidas somente por rotas autenticadas com `tenant_id` confirmado. O cliente nunca recebe credenciais S3 nem um URL público do bucket. A aplicação usa variáveis de referência `SOCIO_S3_ENDPOINT`, `SOCIO_S3_BUCKET`, `SOCIO_S3_ACCESS_KEY`, `SOCIO_S3_SECRET_KEY` e `SOCIO_S3_REGION`. Este armazenamento é exclusivo para a versão Railway, sem alterar o Supabase preparado para migração futura.

**Vincular campanhas** registra uma relação manual com um ID do Meta Ads ou Google Ads; ela aparece como **Não verificada**, sem consultar contas ou executar anúncios. A sincronização por OAuth e a execução de campanhas ficam para a etapa específica de marketing.

O **laboratório de IA** inclui preços, opções e disponibilidade do catálogo oficial no prompt, e pode mostrar as fotos privadas de produtos cujo nome corresponda claramente ao texto perguntado. Isso **não envia fotos pelo WhatsApp** nem confirma automaticamente pedidos. Se `GROQ_API_KEY` não estiver configurada, o laboratório informa que precisa dessa configuração para gerar respostas. Produtos e variações com estoque zero são marcados como indisponíveis.

Tamanhos e limites: foto original até 3 MB por requisição ao backend (o navegador otimiza fotos maiores antes do envio), conversão validada por Sharp, até 8 fotos por produto e até 500 produtos por empresa. Consulte o painel para administrar imagens e variações.

## WA-AKG: leitura de históricos sem disparos

O aplicativo aceita um gateway WA-AKG próprio, usando variáveis secretas do Railway `WA_AKG_BASE_URL`, `WA_AKG_API_KEY` e `CHANNEL_ENCRYPTION_KEY` (mínimo 32 caracteres). Não reutilize credenciais do Prospector nem um gateway que misture contas de terceiros. Use HTTPS ou endereço privado `.railway.internal`.

Somente um administrador da Consecom pode associar uma sessão já conectada à empresa, mediante conferência exata do telefone reportado pelo gateway. Cada empresa enxerga apenas seus vínculos; nunca recebe o ID interno de sessão do provedor nem a chave API.

Em **Treinamento**, a empresa pode iniciar a sincronização das sessões vinculadas, pausar, retomar e visualizar quantos chats e mensagens foram importados. Depois, use **Analisar conversas** para gerar relatório e Markdown em rascunho, que requer aprovação humana.

**Limitações do gateway atual:** a API de listagem fornece até 50 chats por sessão, sem paginação; a leitura extrai no máximo 400 mensagens por chat. A cobertura parcial é explicitada no painel. Grupos, status e mídias ficam fora da análise. Não é um backup integral de WhatsApp e não comprova vendas.

IDs de conversas são criptografados em repouso com AES-GCM e vinculados ao tenant. O sistema guarda amostras sanitizadas e hashes para evitar duplicações. A anonimização por padrões não remove necessariamente nomes próprios mencionados no corpo; use apenas dados autorizados e revise os exemplos.

O Sócio agora pode criar sessões e mostrar QR por meio do gateway exclusivo, mas ainda não envia mensagens pelo WA-AKG. A configuração do bot nativo do gateway deve ser auditada antes de conectar clientes reais. As variáveis do gateway dedicado devem ser configuradas no Railway sem expor seus valores.

## Deploy Railway

1. Use projeto Railway separado, de preferência 'socio-consecom', com PostgreSQL privado e serviço web GitHub WmAgencia/S-cio / main.
2. No serviço web defina DATABASE_URL apontando para a variável de referência Postgres.DATABASE_URL. O Railway fornece PORT.
3. Configure SETUP_TOKEN com pelo menos 32 caracteres criptograficamente aleatórios (visível apenas nas variáveis seguras do Railway). Nunca coloque esse token no repositório ou compartilhe publicamente.
4. NODE_ENV=production.
5. Gere domínio HTTPS Railway. No primeiro acesso, informe token, nome, empresa, e-mail e senha forte. Depois a instalação fica fechada para novas contas principais.
6. Opcional: GROQ_API_KEY e GROQ_MODEL (padrão llama-3.3-70b-versatile) para o laboratório.
7. Opcional: META_WEBHOOK_VERIFY_TOKEN e META_APP_SECRET para o webhook Meta em /webhooks/whatsapp. O administrador precisa validar o Phone Number ID para associar cada número à empresa correta.

## Segurança e limites

MVP para testes e pilotos supervisionados, ainda não preparado para venda irrestrita. Não oferece envios automáticos, conexão real de WhatsApp sem credenciais oficiais, cobrança Stripe, redefinição de senha, backups de restauração testados, exclusão/retensão LGPD, chamadas de voz, isolamento RLS no PostgreSQL Railway (a base Supabase já está preparada, mas não é a base de produção). O campo de plano é administrativo e não efetua cobranças.

Treine o agente somente com conversas cuja utilização esteja autorizada. A anonimização inicial trata padrões comuns, mas não garante remoção completa de todos os dados pessoais inseridos no texto; revise arquivos antes de importar.

A configuração do agente como "Preparado" nunca inicia atendimento real ou mensagens externas.

## Desenvolvimento

Node.js 20+ e PostgreSQL.

Comandos: npm install, npm test e npm start.

Limites de importação: `.txt` e `.md` até 700 KB por arquivo; ZIP até 2 MB, contendo até 25 arquivos de conversa e no máximo 2,5 MB descompactados no total. Arquivos de mídia são ignorados. Conversas são anonimizadas por padrões antes de gerar a referência Markdown; nomes de arquivos não entram no prompt de IA. A anonimização automática não substitui uma revisão humana.

O teste e2e requer DATABASE_URL apontando para um Postgres descartável. O GitHub Actions provisiona esse Postgres automaticamente; não use banco de produção para rodar o teste de instalação.
