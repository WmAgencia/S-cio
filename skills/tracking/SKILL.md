# Skill — Especialista em rastreamento e atribuição

**ID:** `tracking.conversions`  
**Estado:** planejamento e diagnóstico; instalação automática em sites externos ainda não homologada.

## Site e checkout
1. Identificar domínio e fornecedor do checkout; confirmar autorização para editar cada propriedade.
2. Verificar Pixel/Dataset existente antes de criar outro. Meta Pixel no navegador e Conversions API no servidor devem respeitar consentimento, LGPD e isolamento por empresa.
3. Eventos de funil: PageView, ViewContent, AddToCart, InitiateCheckout, Lead e Purchase conforme ações de fato observadas.
4. Deduplicar browser `eventID` e servidor `event_id` com mesmo `event_name`.
5. Só enviar Purchase após webhook assinado e pagamento confirmado; cliques, mensagens, boletos ou Pix gerados não são pagamentos.
6. Validar no Events Manager e apresentar evidências, qualidade de sinal e limites de atribuição.

## WhatsApp
Não existe Pixel instalado **dentro** de uma conversa do WhatsApp. Para anúncios de mensagens, relacionar métricas Meta e dados efetivos do WA-AKG. Código no link pré-preenchido é um sinal **indicativo**, não prova de clique ou compra. Diferenciar conversas iniciadas, respostas, qualificações, orçamentos, vendas declaradas e valores recebidos.

## Google
Quando a API for integrada, usar Google tag/Google Ads conversion actions com os mesmos controles; não afirmar que estão instaladas atualmente.

## Etapa 5 — funil WA-AKG mensurável (somente leitura)
Consultar `/api/marketing/attribution/funnel` no tenant autorizado. Por código observado em mensagem realmente recebida: contar conversas distintas; respostas `outbound` **somente com `provider_id` confirmado** após a mensagem vinculada; cliente que respondeu após a primeira resposta da empresa; pedidos de orçamento e interesses criados depois da mensagem; pedidos cadastrados e pagamentos **somente do Stripe em modo teste** confirmados pela base de pedidos.

O relatório não demonstra entrega de anúncio Meta, clique Meta, integração CAPI, pagamento real, nem faturamento. Campos `livePaidOrders` e `liveRevenueCents` permanecem `null` até existir um provedor de produção autenticado, nunca deduzidos de intenções. Não somar o mesmo cliente em campanhas duplicadas sem examinar deduplicação/primeiro toque.

Atenção: a coleta de mensagens é passiva e depende de conexão WA-AKG real e `SOCIO_ATTRIBUTION_ENABLED` habilitado explicitamente após homologação. Não ativar apenas para produzir números.

## Limites de medição que precisam ser ditos ao dono

Toda leitura de resultado carrega incerteza. O Sócio declara a incerteza em vez de escondê-la:

- **Janela de atribuição**: 7 dias clique / 1 dia visualização é o padrão; 1 dia clique é mais conservador. Mudar a janela muda o número sem mudar a campanha. Sempre informar qual janela está em uso.
- **Atribuição modelada**: a Meta usa modelagem estatística quando não consegue observar a conversão. Isso é estimativa, não contagem.
- **Bloqueio de rastreamento e iOS**: parte das conversões reais não é vista. O número reportado tende a ser menor que o real, e a diferença não é uniforme.
- **Pixel + CAPI**: quando os dois enviam o mesmo evento, a deduplicação precisa estar correta; sem isso, a contagem dobra e o custo por resultado cai artificialmente.
- **Consentimento e LGPD**: eventos só podem ser coletados com base legal e consentimento quando exigido. Não instalar rastreamento "para medir melhor" sem o dono resolver isso.
- **Conversa de WhatsApp**: a Meta conta conversas iniciadas; o negócio conta vendas. As duas contagens nunca devem ser somadas nem tratadas como a mesma coisa.
- **Receita**: só existe ROAS quando existe receita confirmada por provedor de pagamento. Enquanto não houver, o relatório diz "receita não verificada" e trabalha com custo por conversa.

## Diagnóstico de rastreamento quebrado

Sinais: eventos param de chegar, `Purchase` sem valor, dois Pixels na mesma página, evento com nome diferente do catálogo, volume de conversão maior que o número de pedidos reais, ou custo por resultado caindo de forma abrupta sem mudança de campanha.

Nesses casos, parar de otimizar com base no número até a fonte ser checada. Nunca "corrigir" inflando eventos: evento inventado nunca é aceito.
