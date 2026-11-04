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

## Etapa 3 — Orçamentos versionados e pedidos supervisionados (04/11/2026)

Na guia **Vendas e orçamentos**, o proprietário ou administrador seleciona uma
**conversa existente** e até 15 itens do catálogo. O servidor confere a empresa,
recalcula preços oficiais e estoque disponível, guarda um instantâneo dos itens
e cria um rascunho. Não aceita preços arbitrários enviados pelo navegador.

**Revisar** gera uma nova versão, invalida o link anterior e preserva o histórico.
**Gerar link** devolve um endereço com token aleatório, validade de sete dias e
aprovação exclusiva daquela proposta. A equipe deve enviar o link por um canal
autorizado; o Sócio **não o dispara automaticamente**. A pessoa informa o nome e
confirma os itens e valores. Uma aprovação repetida retorna o mesmo pedido;
uma proposta aprovada não pode ser substituída. Recusar não cria pedido.

A aprovação cria um pedido `pending_payment`, **não é pagamento, reserva de estoque,
venda finalizada, comprovante nem confirmação de entrega**. O estoque é validado
na aprovação, mas não reservado ou abatido pela aceitação. Equipes devem reconferir
a disponibilidade antes do cumprimento. O sistema não gera links falsos de pagamento.

Opcionalmente, chaves **Stripe `sk_test_`** e `whsec_`, junto de
`SOCIO_PUBLIC_URL` HTTPS, habilitam checkout de teste para pedidos aprovados.
O servidor rejeita `sk_live_`, somente aceita sessões `cs_test_`, usa idempotência,
valida assinatura do webhook em `POST /webhooks/stripe-test`, tipo de evento,
valor, moeda, ID e `livemode=false`. Pagamento confirmado nesse fluxo registra
somente `paid_test`: **não há movimentação de dinheiro real nem baixa de estoque**.
Não há reembolso automático de pagamentos reais ou sandbox.

A futura ativação comercial de cobranças reais exige configuração por empresa,
conta de pagamentos autorizada, recebedor correto, webhooks verificados, política de
reembolso, conciliação, testes de ponta a ponta e aprovação explícita. Tampouco
estão habilitados envio automático de imagens pelo WhatsApp ou reserva de estoque.

### Testes
`tests/sales-commerce.test.mjs` protege validações de entrada, modo sandbox e HMAC.
`tests/e2e.test.mjs` executa PostgreSQL real efêmero, catálogo real de teste,
versão invalidadora, token de cliente, aprovação idempotente e isolamento por tenant.
Verificar GitHub Actions e healthcheck Railway após cada publicação.


## Etapa 4 — Equipe, isolamento e auditoria

O proprietário gerencia administradores e atendentes, pode revogar sessões ao desativar uma pessoa
e acompanha eventos críticos por empresa. Administradores podem convidar somente atendentes.
Atendentes trabalham no WhatsApp e consultam o catálogo, sem acesso a dados internos de
treinamento, auditoria, vendas e gestão de permissões. Todos podem alterar sua própria
senha, o que encerra outras sessões. Permissões são verificadas em cada requisição
no servidor, não somente na interface.

As relações entre canal/conversa e conversa/mensagem agora possuem chaves estrangeiras
compostas pelo tenant. Novos vínculos cruzados são rejeitados no PostgreSQL. A validação
retroativa de vínculos antigos permanece uma tarefa administrativa que requer conferência.

Foi preparado um utilitário para backup **criptografado** de PostgreSQL e ensaio de
restauração em base descartável. A CI testa esse fluxo automaticamente com dados
fictícios; **não foram ativados backup agendado ou restauração de produção**.
Fotos e sessões gateway não integram o snapshot PostgreSQL.

Detalhes, matriz de acesso, comandos, riscos e pendências:
[docs/socio-phase4-team-backup-20261104.md](docs/socio-phase4-team-backup-20261104.md)


## Etapa 5 — Confiabilidade e preparação para Supabase

O backend **permanece em produção no PostgreSQL Railway**. O esquema privado
Supabase `socio_app` foi alinhado para as 28 tabelas do Sócio, está vazio
e não é exposto a `anon`/`authenticated`. Nenhum dado real foi migrado.

O migrador possui preflight de paridade de colunas/PKs, destino vazio e
assinatura por conteúdo de cada tabela. O modo de manutenção bloqueia
webhooks e escritas HTTP, pausa workers e mantém leituras. O teste automatizado
usa bancos descartáveis com duas empresas e pedidos simulados, inclusive
falha provocada para verificar rollback. A ferramenta **não executa cutover
de `DATABASE_URL`** e exige quatro confirmações operacionais antes de copiar.

A dependência `sharp` foi atualizada para a versão corrigida `0.35.5`;
o CI agora exige `npm audit --omit=dev --audit-level=high`.

Veja critérios, comandos, inventário S3/WA-AKG e plano de reversão:
[docs/socio-phase5-supabase-cutover-20261104.md](docs/socio-phase5-supabase-cutover-20261104.md)


## Instagram profissional — Fase 6

Uma nova guia Instagram permite que cada empresa autorize uma conta profissional
por OAuth com a Meta. O backend valida assinaturas de webhooks, salva mensagens
somente no tenant vinculado, protege tokens cifrados e permite respostas humanas
apenas depois de mensagem recente. Inclui revogação de acesso e deduplicação.
A IA automática **não** responde no Instagram nesta versão.

Sem aplicativo Instagram Login autorizado e suas credenciais em Railway, a
funcionalidade permanece visível como **não configurada**. Não foram enviadas DMs
reais ou feitas conexões não autorizadas. Configuração e limites:
[docs/socio-instagram-phase6.md](docs/socio-instagram-phase6.md).


## Instagram sem aplicativo Meta próprio + Meta Ads + Google Ads

O painel Sócio agora inclui laboratório privado aiograpi-rest v6.0.0 (somente health até uma conta de teste autorizada), conexão de **leitura** Pipeboard Meta Ads por empresa e integração de relatórios Google Ads Scripts autenticados com HMAC. Nenhuma campanha é criada ou ativada; nenhum Instagram comercial é acessado automaticamente. Consulte [o guia de configuração](docs/socio-open-marketing-integrations.md) antes de usar com clientes. Produção continua no PostgreSQL Railway.
