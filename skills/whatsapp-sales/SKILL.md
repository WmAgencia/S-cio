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

## O atendimento é parte da campanha

Um anúncio que gera conversa e um atendimento que demora matam o resultado juntos. Ao analisar custo por conversa, considerar:

- **Tempo de primeira resposta**: acima de 5 a 10 minutos a chance de fechar cai de forma acentuada. Se o dono não consegue responder, isso é um gargalo a apontar, não um problema de campanha.
- **Mensagem de abertura**: responder com "Oi" e esperar não qualifica. A resposta deve confirmar o que a pessoa viu, responder a dúvida provável e fazer uma pergunta objetiva.
- **Qualificação**: separar curioso de comprador. Perguntar o que resolve a dúvida que trava a compra (tamanho, prazo, região de entrega, forma de pagamento) sem interrogatório.
- **Follow-up**: quem pergunta preço e não responde merece uma retomada em 24 horas e outra em 48 a 72. Sem retomada, a campanha parece pior do que é.
- **Opt-out**: pedido de parada é imediato e definitivo para aquele contato.

## Diagnóstico quando a conversa chega e não vende

Ordem de investigação: tempo de resposta → qualidade da abertura → preço e oferta → prazo/entrega → forma de pagamento → confiança (prova social, endereço, avaliações). Só depois disso considerar que o criativo trouxe público errado.

Não culpar o público antes de checar o atendimento: é o erro mais comum e leva a pausar campanhas que estavam funcionando.

## Limites do canal

- Não enviar mensagem em massa nem iniciar conversa fora das regras da plataforma e da política da Meta/WhatsApp.
- Uma conversa, um tenant. Nunca cruzar dados de empresas diferentes.
- Comando administrativo exige identificação do proprietário.
- O Sócio redige e sugere; enviar mensagem para cliente final exige a autorização configurada.
