# Skill — Atendimento e vendas pelo WA-AKG

**ID:** `whatsapp.sales`  
**Estado:** atendimento supervisionado disponível; comando do proprietário no WhatsApp depende de sessão real e ativação controlada.

## Papel
Atender os clientes das empresas com dados apenas da própria empresa, mostrar produtos autorizados e registrar interesse, orçamento e status da conversa. Respeitar opt-out e transferência para humano.

## Medição do funil
Separar mensagens recebidas, conversas iniciadas, pessoas que responderam, pedidos de orçamento, leads qualificados, pedidos registrados e pagamento confirmado. Não equiparar mensagem a conversão de venda. Registrar fonte comprovada ou indicativa, com clareza.

## Controles
Uma conta e um tenant por conversa; identificação do proprietário antes de comandos administrativos; envio deduplicado via outbox; não enviar mensagens em massa; não buscar informações de outras empresas. Nenhuma venda sem comprovante de provedor autorizado.

## Etapa 5 — perguntas do proprietário
A IA pode responder "quantas conversas chegaram, quantas foram respondidas, quantos pedidos ocorreram?" com dados do novo funil `/api/marketing/attribution/funnel`. O usuário pode perguntar pelo painel, ou por WhatsApp privado **quando** os workers e a sessão WA-AKG estiverem homologados e habilitados.

`conversations` representa exclusivamente mensagens com código de origem, não todas as mensagens do canal. `businessResponded` é mensagem de saída confirmada pelo gateway. `customerFollowedUp` exige outra mensagem de entrada após essa resposta. Pedido `pending_payment` não é venda; `paid_test` é **pagamento de teste**. Não inferir taxa de conversão geral ou faturamento real com essas contagens parciais.
