# Sócio — Instagram privado + Pipeboard Meta Ads + Google Ads Scripts

**Implantação de infraestrutura:** 04/11/2026.

## Decisão técnica

O usuário escolheu substituir a dependência de criar um aplicativo próprio no Meta Developers por três conectores. Nenhum módulo autoriza edição ou envio sem ação posterior do proprietário.

### 1. Instagram: aiograpi-rest 6.0.0

- Fonte: https://github.com/subzeroid/aiograpi-rest
- Imagem fixada: `ghcr.io/subzeroid/aiograpi-rest:6.0.0`.
- Railway: serviço `socio-instagram-lab`, DNS **privado** `socio-instagram-lab.railway.internal:8000`, sem domínio público, com volume persistente separado em `/data`; healthcheck `/health`.
- Sócio: variável `SOCIO_INSTAGRAM_LAB_URL=http://socio-instagram-lab.railway.internal:8000/`, com origem validada e consulta **GET /health somente**. Nenhuma senha, cookie ou sessão pessoal é compartilhada pelo navegador.
- O serviço não é uma API oficial da Meta. Login, 2FA, desafios, restrições, disponibilidade de rotas e possível bloqueio de conta são riscos reais; não há garantia de estabilidade. Os autores alertam contra executar contas comerciais em datacenter sem gestão operacional.
- **Estado atual:** binário instalado e serviço isolado operacional; nenhuma conta associada e nenhuma postagem, Reel, Story ou DM enviado. A próxima fase de testes precisará de **conta própria de teste consentida**, com avaliação de segurança antes de permitir funções de gravação e publicação.

Não repassar `sessionid`, senha ou códigos 2FA via chat, print, GitHub ou logs. O serviço não deve receber URL pública.

### 2. Meta Ads: Pipeboard hospedado

- Fonte: https://github.com/pipeboard-co/meta-ads-mcp (Business Source License 1.1; instalação local requer aplicativo Meta Developer) e https://github.com/pipeboard-co/pipeboard-cli (Apache-2.0).
- Usar o servidor **hospedado** `https://meta-ads.mcp.pipeboard.co/`, que usa sua própria autorização oficial. Não instalar MCP local, não usar tokens Meta diretamente nem embutir um token Pipeboard compartilhado em todo o SaaS.
- Proprietário/admin da empresa: abrir Sócio → Anúncios e métricas → Meta Ads; informar somente ID `act_...`, rótulo e token gerado em https://pipeboard.co/api-tokens.
- O Sócio chama exclusivamente `mcp_meta_ads_get_ad_accounts`, método de **leitura**, e só confirma a conexão se o retorno mencionar a conta informada. A credencial fica cifrada AES-256-GCM com chave derivada de `CHANNEL_ENCRYPTION_KEY`; somente o vínculo, não o token, é mostrado depois.
- **Limites:** nenhuma criação/pausa/alteração de campanha, orçamento, público ou anúncio. Para ambientes de agência, exigir token de escopo por conta e leitura apenas, conforme plano Pipeboard. Permissões finas podem exigir planos pagos.
- **Licença/comercial:** verificar os Termos Pipeboard e se integração dentro de um SaaS white-label/multiempresa é permitida antes de oferecer a terceiros. O projeto BSL de MCP local **não foi incorporado ou redistribuído**.

### 3. Google Ads Scripts: relatório assinado por conta

- Integração própria inspirada pela documentação Google Ads Scripts e boas práticas do projeto https://github.com/Brainlabs-Digital/Google-Ads-Scripts (GPL-2.0). **Nenhum código da Brainlabs foi copiado**; geramos script de autoria do Sócio para evitar incorporação da licença GPL em produto comercial.
- Conta individual: proprietário/admin informa **ID de 10 dígitos** da conta e rótulo em Sócio → Anúncios e métricas → Google Ads. O Sócio produz uma chave de integração aleatória e script JS **exibido somente uma vez**. Ao gerar novamente, a chave anterior deixa de funcionar.
- Em https://ads.google.com: Ferramentas → Ações em massa → Scripts → Novo script. Cole o código, conceda permissão da própria conta, revise o modo Preview, execute uma vez e então agende no Google Ads.
- O script somente consulta `AdsApp.search` com campanhas e métricas agregadas dos últimos 7 dias, até 100 linhas por execução; envia HTTPS `UrlFetchApp.fetch` com HMAC-SHA256 `X-Socio-Signature-256`, ID único e data de envio. **Não escreve campanhas nem altera valores de orçamento**.
- Sócio: `POST /webhooks/google-ads/:id` recusa relatórios sem assinatura válida, fora da conta vinculada, com mais de 10 minutos, antigos demais, repetidos ou com métricas fora de limites. Salva somente resumo de campanha no tenant correto; não recebe emails, leads ou públicos.
- A unidade do gasto é a moeda configurada na conta Google Ads, **não necessariamente BRL**. `costMicros` é interpretado como milhões da unidade monetária. Relatórios representam somente até 100 linhas por execução, portanto cobertura parcial é possível. 
- Autorizar e executar scripts gera concessão de acesso Google Ads; não existe acesso sem permissão da pessoa que controla a conta.

## Permissões e segurança

- Somente `owner`/`admin` têm `marketing.read` e `marketing.manage`.
- Rotas de configuração exigem login, cookie seguro, CSRF e identificação da empresa ativa.
- Tokens são derivados da variável existente `CHANNEL_ENCRYPTION_KEY` e cifrados AES-256-GCM. Não ficam em texto claro na tabela nem são devolvidos em rotas GET.
- Toda ligação `marketing_connections`, `marketing_report_receipts` e `marketing_daily_metrics` possui `tenant_id` e FK composta de integridade para impedir troca cruzada de empresas.
- Revogar integração limpa a credencial local e impede novos recebimentos; dados históricos agregados são preservados conforme política de retenção.
- Supabase privado continua **somente ambiente de preparação** com 34 tabelas e sem `USAGE` do schema `socio_app` para `anon` ou `authenticated`. Produção ainda usa Railway PostgreSQL.

## Requisitos de homologação

1. Conta Instagram **controlada e de teste**, com autorização do titular; identificar riscos e rever política da plataforma antes de oferecer publicação/DM.
2. Conta Pipeboard e token **restrito** exclusivamente ao Meta Ads da empresa. Verificar resposta de leitura real; fluxo de escrita permanece desativado.
3. Conta Google Ads autorizada; copiar script e conferir relatório recebido, identificação e totais com dados reais da própria conta.
4. Verificar revogação e isolamento com duas empresas consentidas. Ações que gastam orçamento exigem fluxo separado com aprovação explícita e teto configurado.
5. Guardar segredos da infraestrutura em cofre externo e monitorar custos do novo serviço Railway e dos eventuais planos Pipeboard.

## Fonte de verdade

- Repositório Sócio: https://github.com/WmAgencia/S-cio
- Ambiente produção: https://socio-app-production-762c.up.railway.app
- Documentação Google Ads Scripts: https://developers.google.com/google-ads/scripts/docs/start
- Pipeboard escopos: https://pipeboard.co/guides/api-token-permissions
