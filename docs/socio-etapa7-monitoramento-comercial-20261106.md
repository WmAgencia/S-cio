# Sócio — Etapa 7: relatórios, monitoramento e gestão comercial do SaaS

## Entrega implementada

1. **Monitoramento operacional por empresa** — `GET /api/reports/monitor`, exclusivamente leitura, exige `audit.read`, tenant ativo e consulta somente seus registros:
   - mensagens recebidas nos últimos 30 dias;
   - respostas de saída apenas com ID do provedor confirmado;
   - novas conversas, conversas abertas cuja última entrada não teve posterior resposta comprovada;
   - pedidos de orçamento, orçamentos pendentes e envios confirmados;
   - intenções de compra e oportunidades abertas, pedidos cadastrados e pagamentos do Stripe **somente teste**;
   - alertas no painel para conversas sem resposta, orçamentos pendentes, oportunidades e ausência de canal marcado como conectado.
2. **Monitoramento master** — `GET /api/admin/monitor`, exclusivo do `platform_owner`. Resumo de empresas com estado `trial/active/paused`, janela de 7 dias estimada desde o cadastro, últimos registros de mensagens, pedidos e oportunidades. Sem revelar dados de clientes, mensagens, credenciais ou pagamentos.
3. **Interface** — aba Relatórios destaca os pontos de atenção; master Empresas mostra totais de contas e previsão de vencimento da janela gratuita, sem necessidade de navegar por cada cliente.
4. **Conversa comercial** — pedidos como "Sócio, me dê um relatório de vendas da empresa" passam a ler o monitor operacional real, sem alterar mensagens, anúncios nem cobranças. As skills de Meta, Google e WA-AKG mantêm suas rotas e separações.
5. **Testes** — filtros de autorização, não alteração do banco, cálculo de datas e Postgres temporário com duas empresas, uma com conversa sem resposta e outra com resposta confirmada.

## Fatos versus estimativas

- O estado `active` é apenas o status da conta cadastrada; **não** é evidência de assinatura paga.
- `trialEndsAt` é calculado como `created_at + 7 dias`. Ele é um **indicador comercial de calendário**, não um bloqueio executável, nem prova de aceite contratual ou início do período promocional. Contas antigas podem aparecer com a janela encerrada e ainda serem `trial`, pois não houve automação de expiração.
- Não foram criadas assinaturas reais nem transações de cobrança. `confirmedPayingCustomers` e `mrrCents` permanecem `null`.
- Um canal WA-AKG marcado `connected` no banco **não** é uma sessão realmente confirmada pelo gateway. Esse monitor não tem a função de provisionar sessões ou tocar em sua configuração.
- A contagem de respostas considera mensagens `outbound` com `provider_id`; mensagens importadas, falhas de coleta e atrasos na sincronização podem reduzir as métricas. A falta de resposta registrada não prova que a empresa ignorou o cliente por outro canal.
- Os alertas são sinais no painel, nunca envio automático de WhatsApp, e-mail ou campanhas.
- O relatório diário Meta Ads com opt-in e destino apenas no painel já existia e é preservado. Nenhuma campanha é alterada automaticamente.

## Pendências para fechamento comercial completo

- Homologar checkout e webhooks de **assinaturas SaaS em produção**, com reconciliação financeira, autorização e tratamento de inadimplência antes de calcular MRR e clientes pagantes.
- Definir explicitamente o marco inicial do trial (cadastro, primeiro login ou ativação) e política de aviso, renovação e eventual bloqueio. O prazo comercial de 7 dias não autoriza suspensão silenciosa.
- Conectar sessão WA-AKG real para validar mensagens entrantes/saintes, notificações e alertas proativos após opt-in.
- Implantar observabilidade externa (health check, erros, latência, RPO/RTO do backup) e alertas de infraestrutura em canal aprovado.
- Integrar conversões verificadas de sites/Stripe produção com o funil da Etapa 5 para atribuição de receita real.
- Homologar relatórios automáticos Meta Ads com conta conectada e aprovar limites de uso por cliente.

## Critérios de publicação

CI de testes, segurança e backup concluído, deploy `SUCCESS` no Railway e inicialização saudável. Isso garante o código publicado, **não** cobranças ou integrações externas ainda não homologadas.
