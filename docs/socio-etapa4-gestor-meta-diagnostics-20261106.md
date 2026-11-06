# Sócio — Etapa 4: gestor de tráfego Meta Ads supervisionado

## Entrega de código desta etapa

- Diagnóstico profissional somente leitura com `meta-traffic-diagnostics.mjs`, usando informações efetivamente retornadas pela **Marketing API da conta selecionada**.
- Junta resultados de campanhas (gasto, impressões, cliques) e situações atuais de anúncios quando a Meta permitir; identifica `DISAPPROVED`, `WITH_ISSUES`, `PENDING_REVIEW`, ausência de métricas, zero entrega observado e amostras pequenas.
- Nenhuma linha de `insights` jamais é confundida com zero gasto ou zero impressões; páginas incompletas e ausência de acesso a status são sinalizadas.
- Resposta em português diretamente na conversa: `Analise meus anúncios de hoje`, `Otimize minhas campanhas Meta Ads`, `Por que meus anúncios estão rejeitados?`. A resposta apresenta evidência, recomendação e nenhuma alteração automática.
- A visão avançada Meta apresenta os diagnósticos sem duplicar os cartões de insights.
- `ads.performance.diagnose` adicionada ao catálogo; orientação do especialista `meta.optimization` atualizada.
- Operações de criação de campanhas PAUSADAS, edição de orçamento, ativação e pausa **continuam no fluxo de plano + confirmação existente**. Nunca usar diagnóstico para mutar contas sem pedido e confirmação específicos.

## O que já estava pronto e foi preservado

1. OAuth oficial Meta Ads; conta escolhida e escopo do usuário por empresa.
2. Consultas de públicos, criativos, pixels, campanhas e relatórios.
3. Criação de campanha com Página, imagem, cidade, orçamento e destino site/WhatsApp, com validações e confirmação.
4. Pixel oficial pode ser criado via ferramenta revisada; instalação de eventos no site e CAPI não vêm automaticamente com a criação do pixel.
5. WA-AKG continua como canal WhatsApp; o Pixel não é instalado em conversas.

## Limites e próximos itens para homologação de autonomia real

- Diagnóstico **não mede conversões reais do WhatsApp, pedidos pagos, ROAS ou CPL** sem ligar fontes de atribuição e pagamentos verificados (Etapa 5).
- Uma recomendação não é uma mutação. A ativação ou mudança de orçamento deve ter limites aprovados por tenant, auditoria, confirmação e autorização de negócio.
- A Meta decide aprovação do anúncio, elegibilidade de público, objetivo aceito e orçamento mínimo; testes simulados não provam que uma campanha real será aprovada.
- A consulta traz no máximo 100 registros por endpoint por chamada e informa quando os resultados são parciais.
- A homologação definitiva exige sessão Meta autenticada e conta de teste/Consecom autorizada, criação real pausada e verificação dos IDs no Gerenciador de Anúncios, sem alterar campanhas existentes.
- Relatórios de execução, alertas proativos e otimizações com guardrails por tenant ficam como trabalhos adicionais.

## Critérios de qualidade
- Testes de idempotência da API existente preservados, nenhuma criação automática ou despesa durante deploy.
- Anúncios rejeitados detectados somente de status retornados.
- Amostra pequena, ausência de dados, zero entrega e problemas confirmados não são confundidos.
- Fluxo de diagnóstico no WhatsApp privado usa o mesmo roteador já existente; worker WA-AKG permanece desligado sem sessão homologada.
- CI e backup em verde e Railway SUCCESS antes de declarar publicação.
