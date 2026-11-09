# Sócio — Primeira entrega paralela das etapas 1, 2 e 3
Data: 2026-11-09

## 1. WhatsApp e fotos do proprietário
O worker socio-owner-skill-inbox.mjs agora exige uma sessão WA-AKG realmente conectada ao mesmo número e canal antes de executar comandos do proprietário, incluindo "Sócio, pode criar". A consulta usa o ambiente configurado; sessões desligadas ou divergentes impedem efeitos na Meta. A ponte socio-owner-skill-media.mjs também valida a sessão com o ambiente correto antes de consultar fotos e áudios.

As proteções existentes continuam: mensagem individual, owner/admin verificado no tenant, limite e tipo da mídia, recibos idempotentes e campanhas aguardando imagem. Áudio não aprova ações financeiras. Não há suporte a comandos de grupo.

## 2. Meta Ads e revisão de criativos
Novo socio-creative-studio.mjs gera três versões de títulos e textos com ângulos de apresentação, consultivo e objetivo. O gerador usa somente categoria, cidade e empresa informados; não inventa valores, descontos, estoque, avaliações ou resultados.
Declarações publicitárias potencialmente não verificadas bloqueiam a preparação do plano e pedem descrição factual. O painel mostra três alternativas, mas a opção 1 é a única vinculada ao plano Meta atual; as opções 2 e 3 são referências de revisão e não são publicadas. Para executar a criação pausada continua sendo exigida autorização textual; veiculação e gasto são aprovações separadas.
Esta etapa ainda não oferece geração visual com IA nem cria vídeos de anúncios.

## 3. Atendimento consultivo e vendas
Novo socio-sales-conversation.mjs identifica heurísticas de intenção de compra, objeção de preço, comparação, orçamento, preço, entrega, pagamento, recusa, suporte, reembolso e pedido de humano. O ai-replies.mjs aplica orientações específicas no prompt, respeitando conhecimento aprovado, catálogo e isolamento entre empresas.
O método não cria pedido, cobrança, mensagem ou desconto. Não interpreta uma intenção como venda paga nem promete ações não realizadas.
Ainda é necessária avaliação humana de conversas reais, acompanhamento de resultados e integração de pagamento de produção.

## Verificações e condições de publicação
Executar testes completos Node/PostgreSQL e backup-worker; provar ausência de ações Meta antes de autenticação, resposta sem claims não aprovadas, e independência entre empresas e conversas. Fazer healthcheck da Railway após merge.

O gateway WA-AKG estava acessível, mas com zero sessões conectadas na última verificação. Nenhuma flag de processamento de comando, mídia ou áudio do proprietário será habilitada sem um número piloto autorizado e homologação física.
As três frentes podem evoluir juntas sem representar a conclusão total das etapas 1, 2 e 3 nem do projeto Sócio 100%.
