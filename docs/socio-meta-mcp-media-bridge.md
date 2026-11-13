# Sócio — Extensão de Mídia para o MCP Oficial Meta Ads (05/11/2026)

## O que é
Não altera nem substitui o MCP oficial Meta Ads. Acrescenta um **MCP complementar** de preparação de vídeos, no Sócio, com identidade de empresa e armazenamento privado. O MCP oficial continua criando criativos e anúncios, consultando métricas e publicando após consentimento explícito do gestor.

## Funcionamento
1. Acesse Sócio → Meta Ads → Biblioteca de vídeos.
2. Selecione MP4 ou MOV até 90 MB, envie. O arquivo é mantido em S3 privado em ads-private/<tenant>/<uuid>/source.mp4 e ganha status ready.
3. Gere **URL para Meta** (HTTPS, assinada HMAC-SHA256, expira em 20 minutos, suporta HEAD, Range/206). Cole-a no fluxo da ferramenta OFICIAL ads_creative_upload_media com upload_source=URL, media_type=VIDEO. Não persista o link em relatórios, GitHub ou logs.
4. Após confirmação de upload e processamento pela Meta, use ads_create_creative e ads_create_ad no MCP oficial. A ativação por ads_activate_entity depende de autorização do proprietário e limites de gasto.
5. Vídeos já entregues à Meta são apagados do bucket privado depois da janela de retenção (`SOCIO_AD_VIDEO_RETENTION_DAYS`, padrão 7 dias, entre 1 e 30). A cópia que o anúncio usa fica na conta de anúncios; a linha de `ads_media` permanece apenas como histórico com status `expired`. Vídeos sem recibo de entrega não são removidos por essa rotina.
6. ChatGPT/Codex clientes MCP compatíveis com Bearer podem conectar o segundo servidor em https://<socio>/mcp/ads-media. Gere a chave em Meta Ads no painel; a chave é exibida **uma vez**, dura 30 dias e pode ser revogada. A chave só permite operações de mídia do tenant: nunca chama a Meta ou aumenta gasto.

## Ferramentas MCP expostas
- ads_media_create_upload_link(filename) — cria ticket por 15 minutos e devolve página de upload por link.
- ads_media_list(limit) — lista mídias autorizadas da empresa, sem URL pública.
- ads_media_status(asset_id) — mostra se o upload foi concluído.
- ads_media_get_url(asset_id) — exporta URL HMAC por 20 minutos.
- ads_media_import_whatsapp(channel_id,jid,message_id,filename) — importa binário do WA-AKG depois de provar canal da empresa, tipo vídeo da mensagem, remetente do número do gestor autenticado. Sem enviar mensagens ou ativar o bot.

## Segurança
- S3 credenciais server-side; nem a URL S3 nem a key de acesso são entregues ao navegador.
- Conteúdo é validado por cabeçalho ftyp e máximo 90MB e transmitido por arquivo temporário local; não usa base64 por HTTP. É recomendável adicionar varredura antivírus e inspeção de vídeo por ffprobe antes de aceitar fontes públicas externas.
- Autenticação do Sócio (cookie HttpOnly + CSRF) no painel e APIs privadas. A extensão MCP usa token separado aleatório e hash SHA-256 guardado no PostgreSQL; a identidade é consultada ao acessar cada ferramenta e exige tenant ativo e meta_ads habilitado.
- A URL para Meta é um bearer link temporário: qualquer pessoa que a obtenha pode ler o vídeo até expirar. Não inclua nos logs, Analytics, mensagens públicas nem e-mails.
- Rotas de importação WhatsApp só aceitam download no gateway privado já configurado e somente do contato individual associado ao telefone do gestor. Redirecionamentos externos do gateway são recusados.
- Revogação de chave MCP não afeta campanhas nem tokens da Meta.
- Criação e publicação de campanhas NÃO são funcionalidades deste MCP. Nenhuma campanha foi alterada neste desenvolvimento.

## Limitações e integração futura
- **ChatGPT web** pode exigir OAuth 2.1 e plano/workspace compatível com custom MCP; o bearer-only é apropriado a clientes que oferecem essa autenticação. Esta implantação não instala a extensão automaticamente neste chat.
- O anexo MP4 desta conversa não aparece automaticamente no MCP. Em clientes sem seleção de arquivo, a ferramenta fornece página de upload por link, sem copiar para link público permanente.
- A importação WhatsApp é feita por ferramenta ou API explícita com ID da mensagem, não por monitoramento automático nem por um comando em linguagem natural no WhatsApp. Para isso, o Sócio ainda precisará de um worker autorizado de comandos, áudio/transcrição, resposta WhatsApp e confirmação de publicação. Não alegar que esse fluxo já esteja ativo.
- O backend Sócio atual usa Pipeboard para Meta Ads em leitura. A extensão não transforma esse Pipeboard em MCP oficial nem copia credenciais da sessão ChatGPT.

## Verificações
- Testes em tests/ads-media.test.mjs cobrem tenant isolation, hash, MIME, tickets, URLs, importação e scope.
- A migração de tabelas Railway está em schema.sql; espelho futuro de Supabase privado em supabase/migrations/20261105_ads_media_mcp_bridge.sql.
- Confirmar CI, deployment Railway e primeiro teste real S3 → URL assinada → ads_creative_upload_media antes de habilitar operação com clientes.
