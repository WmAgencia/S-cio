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
