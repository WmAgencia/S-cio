# Sócio — Skills de tráfego por conversa (MVP)

## Objetivo

O cliente não precisa saber configurar Meta Ads. Exemplo suportado:

> Sócio, quero divulgar roupas femininas em Sorocaba, gastando seis reais por dia.

O sistema usa a Marketing API oficial do aplicativo Sócio. O atendimento segue no WA-AKG, **não** na WhatsApp Cloud API oficial.

## Skills registradas

| ID | Função | Estado |
| --- | --- | --- |
| `ads.campaign.launch` | Extrair briefing, escolher destino, descobrir recursos, preparar campanha com criação pausada após autorização textual | Implementada para painel |
| `ads.pixel.setup` | Ler e preparar criação oficial do pixel com aprovação | Existia no fluxo `meta_ads_plans` |
| `ads.performance.read` | Consultar campanhas/insights oficiais | Existia |
| `ads.whatsapp.attribution` | Atribuição indicativa por código no WA-AKG | Disponível, não é atribuição Meta confirmada |
| `ads.whatsapp.owner_commands` | Comandos para número privado do proprietário via WA-AKG | Código opt-in; NÃO habilitar sem homologação |
| `ads.conversions.capi` | Pixel no site, CAPI, deduplicação e Purchase por webhook | **Pendente:** cada site precisa de integração própria |

## Como funciona a skill de campanha

1. Verifica o usuário, empresa e conta selecionada; somente owner/admin com `marketing.manage` e módulo IA habilitado.
2. Entende produto, cidade e orçamento diário em reais; o pedido `seis reais por dia` vira 600 centavos, sem alterar o valor.
3. Consulta cidades reais na Meta, Página autorizada e fotos já enviadas. Só escolhe automaticamente quando a correspondência é inequívoca.
4. Se não houver foto correta, pergunta **apenas pela foto**. O dono pode anexá-la na conversa do painel; upload é feito à conta Meta autorizada.
5. Se houver somente um WhatsApp WA-AKG autorizado, escolhe esse destino. Se não houver, pergunta ou solicita a conexão; não usa número de outra empresa.
6. Quando o destino é **site**, consulta Pixels da conta e prepara a criação de um novo apenas se a Meta não listar nenhum. Se já existe, não duplica. O novo Pixel e a campanha ficam sob **uma única aprovação textual**, mas os eventos só funcionam após instalação no site.
7. Prepara título e texto sem inventar preços, estoques ou descontos. Pode ajustar mulheres `genders: [2]` para moda feminina, mas isso **não representa uma opção comprovada de segmentar pessoas com intenção de compra**. Se a Meta rejeitar o direcionamento, o Sócio deve reportar o problema sem disparar a campanha.
8. Salva a prévia por 15 minutos; o dono responde `pode criar` na conversa. A skill reutiliza o mesmo executor oficial, com registro e proteção contra execução repetida.
9. Cria o Pixel, quando necessário, e depois campanha, conjunto, criativo e anúncio **PAUSADOS**. Ativação com gasto financeiro continua sendo uma decisão separada, sujeita a autorização e limites.
10. Registra IDs reais retornados e permite conferir resultado no histórico. Resultados parciais ou incertos não são repetidos automaticamente.

### Canais

- **Painel Sócio:** `POST /api/marketing/skills/chat`, autenticado por sessão e CSRF. Foto no mesmo chat, sem formulários de configuração Meta.
- **WhatsApp privado do proprietário:** worker `processOwnerSkillInbox`, SOMENTE se `SOCIO_OWNER_COMMANDS_ENABLED=true`, `SOCIO_OUTBOUND_ENABLED=true` e sessão WA-AKG testada. Filtra mensagens **de entrada** com prefixo `Sócio,`, identificador WA-AKG confiável, telefone **do mesmo tenant**, usuário ativo `owner/admin`, permissões e deduplicação de cada mensagem. Respostas enviadas uma vez pelo outbox existente; timeout incerto não gera reenvio.
- **Grupos WhatsApp:** **não liberados**. O importador atual do WA-AKG deliberadamente só aceita JIDs individuais. Precisamos de eventos de grupo autenticados, participantes verificáveis, ACL e autorização financeira antes de liberar grupos e áudio.

### Rastreamento correto

Um **Pixel não é instalado em conversas do WhatsApp**. Para anúncios de conversa, usamos sinais de Meta Ads e as mensagens do WA-AKG, diferenciando uma referência indicativa de um lead com origem verificada.

Para campanhas direcionadas a site:
- Pixel do navegador, com consentimento.
- Conversions API (CAPI) server-side, com credenciais/consentimento próprios.
- `eventID` browser = `event_id` servidor para deduplicar eventos.
- `Purchase` apenas após webhook autenticado do provedor confirmando pagamento; nenhuma venda é inferida de mensagem, clique ou orçamento.
- Conectar Pixel/CAPI para cada domínio e checkout; essa integração **não pode ser prometida como concluída apenas pela criação de um Pixel**.

### Próximas skills

- Melhoria de campanhas com relatórios recorrentes, limites de autorização de gastos por empresa, sugestão de novos criativos e monitoramento de métricas confirmadas.
- Captura de imagens, áudios e grupos WA-AKG com eventos do gateway homologados.
- `checkout.connect`, `pixel.install`, `capi.verify` e `purchase.reconcile` somente após conexão de cada site/conta de pagamento.

## Homologação necessária antes de ativar WhatsApp e produção

1. Validar testes unitários, SQL/PostgreSQL e publicação da interface no mobile/desktop.
2. Conectar uma conta Meta autorizada e conferir busca de cidade, seleção de Página e criação **PAUSADA** de teste.
3. Em uma sessão WA-AKG conectada de teste, enviar `Sócio, quero vender roupa feminina em Sorocaba, seis reais por dia` de número **registrado como owner**. Confirmar que número de cliente ou outro tenant não executa.
4. Enviar `Sócio, pode criar`; conferir IDs e que não houve publicação nem gasto.
5. Validar outbox com timeout, idempotência e recuperação manual de respostas incertas.
6. Só depois habilitar `SOCIO_OWNER_COMMANDS_ENABLED=true`, inicialmente para um tenant de teste.

**Não alterar automaticamente campanhas ativas, limites ou configurações dos clientes.**
