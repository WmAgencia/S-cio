# Sócio — avaliação de ferramentas e evolução do rastreamento, 06/11/2026

## Evidências verificadas
- Repositório main `WmAgencia/S-cio` no commit `bf7db39bdb6713ef1ad475c36c4f31e88bc77986` e `socio-app` no Railway com implantação SUCCESS deste commit (16:40 UTC).
- Railway production mantém o PostgreSQL, o WA-AKG e o app Sócio. As variáveis `SOCIO_META_APP_ID`, `SOCIO_META_APP_SECRET`, `META_GRAPH_VERSION`, `WA_AKG_BASE_URL`, `WA_AKG_API_KEY`, `CHANNEL_ENCRYPTION_KEY` e `GROQ_API_KEY` estão presentes; não divulgamos valores ou avaliamos acesso real só por sua presença.
- `meta-official.mjs`: login Meta, contas autorizadas, seleção por empresa e revogação/desautorização.
- `meta-ads-tools.mjs`: campanhas, conjuntos, anúncios, insights, imagens, páginas, informações financeiras; operações de criação/pausa/ativação/nome/orçamento com prévia salva e confirmação. Criação guiada é para tráfego a site e deixa os objetos PAUSED.
- `waakg-adapter.mjs`, `inbox-live-sync.mjs`, `socio-outbound.mjs`: canal WA-AKG por empresa e importação de texto. Grupos, mídia e origem de anúncio não são capturados automaticamente nesse fluxo.
- `sales-intents.mjs` e `quote-requests.mjs`: sinais comerciais e orçamento supervisionado; pedidos e intenções não comprovam vendas pagas.
- `training-auto.mjs`: análise assistida de conversas e Markdown sujeito a aprovação.
- PR #50 de integração Prospector é rascunho, não foi mesclada na main. Não declarar treinamento por entrevista/voz já publicado sem merge, rebase e homologação.

## Implementado nesta PR (somente branch)
1. Links `wa.me` com mensagem pré-preenchida e código aleatório, por empresa/conta selecionada/número WA-AKG, com duração de 90 dias.
2. Importação passiva da evidência: worker opt-in extrai códigos de mensagens reais `inbound` já salvas, mesmo canal e tenant, intervalo temporal válido. Primeiro código por conversa e deduplicação, sem disparar mensagens.
3. Relatório com contagem de conversas, pedidos de orçamento e intenções de compra ligados ao código; **indicativo**, nunca "conversão comprovada pela Meta" ou faturamento.
4. Tela Meta Ads com criação, cópia, desativação de link e métricas. Sem mutação de campanha nem gasto.
5. Banco PostgreSQL isolado por tenant; espelho Supabase privado para cutover futuro; flag `SOCIO_ATTRIBUTION_ENABLED=true` habilita worker apenas após validação.
6. Testes de permissão, isolamento, links, observação, duas empresas e idempotência com PostgreSQL temporário.

## Próximas ferramentas por prioridade
| Prioridade | Falta | Critério de aceite |
| --- | --- | --- |
| P0 | Homologar OAuth Meta com o aplicativo real em conta autorizada, incluindo ads_read e ads_management | Confirmar consulta de campanha e prévia gravada sem gastos; validar callback, token e renovação |
| P0 | Validar payloads reais de WA-AKG para referral/CTWA e grupo | Identificar campos reais em um chat de teste; nenhum dado conjecturado; grupos só se sustentados pelo gateway |
| P0 | Motor robusto de atribuição estilo Tintim | Origem confirmada só com identificador verificável; evento de clique diferente de conversa; separar atribuição indicativa/confirmada |
| P0 | Comandos da IA pelo WhatsApp/grupo | Autorizar membros, tenant, orçamentos máximos, prévia, idempotência, execução, registro; canais e imagens compatíveis |
| P0 | Criação de anúncios Click-to-WhatsApp | Conjunto/criativo objetivo mensagens; validação pela conta Meta e eventos reais, sem inferir suporte só pelo modo tráfego a site |
| P1 | Relatórios recorrentes por empresa (20h ou intervalo) | Agendamento por fuso, separação métrica Meta/WA/venda confirmada, idempotência de entrega e opt-in |
| P1 | Operação comercial completa | Catálogo, mídia, atendimento/IA, botões com fallback a texto, pagamentos verificados em checkout real |
| P1 | Treinamento Prospector/PR #50 | Rebase seguro na main atual, QA de voz e revisão antes da publicação |
| P2 | Retenção, auditoria, consentimento LGPD, escalabilidade do rastreio | Expiração, exportação/exclusão, monitoramento, limites e documentação comercial |

## Limites do MVP de atribuição
- A pessoa pode apagar ou encaminhar o código. Presença de código não prova que clicou no anúncio nem que a Meta o exibiu.
- Links pré-preenchidos não funcionam igualmente para todos os formatos Click-to-WhatsApp. Nos anúncios diretos, validar metadata real do gateway; não substituir o canal oficial WhatsApp pelo WA-AKG.
- O rastreio só ocorre se o cliente **enviar** a mensagem com o código.
- Nenhuma campanha é vinculada automaticamente a um link, nem há evento de conversão reportado à Meta nesta etapa.
- Nenhuma venda é marcada como paga; indicadores comerciais são separados.
- Flag `SOCIO_ATTRIBUTION_ENABLED` fica desativada por padrão.
- Nunca mesclar ou publicar sem CI e teste real autorizado com duas empresas e um número WA-AKG.

## Próxima homologação
1. Aplicar migração apenas em banco temporário e conferir FKs/índices/consulta.
2. Gerar link usando empresa A e WA-AKG conectado; enviar mensagem voluntária de número próprio autorizado.
3. Confirmar que empresa B não vê o link, contato ou qualquer métrica da A.
4. Conferir o relatório com códigos observados e o filtro da conta Meta.
5. Depois escolher anúncios de teste e confrontar IDs vindos do provedor com os dados reais do WhatsApp.
