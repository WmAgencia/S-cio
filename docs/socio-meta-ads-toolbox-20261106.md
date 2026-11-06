# Sócio — Caixa de ferramentas Meta Ads oficial (06/11/2026)

## Alcance real desta etapa

O WhatsApp continua **exclusivamente** no gateway dedicado WA-AKG do Sócio. A Marketing API oficial da Meta é usada apenas para publicidade, contas de anúncios e métricas. **Nenhuma migração para WhatsApp Cloud API**.

A branch da PR está empilhada sobre `feat/socio-whatsapp-attribution-20261106` (PR #57); portanto, deve ser integrada após a revisão daquela PR, e não mesclada diretamente sem conferir compatibilidade.

### Ferramentas do Sócio antes desta etapa
- OAuth Facebook/Meta pelo app oficial, seleção de conta por empresa e permissões `ads_read` / `ads_management`.
- Consultas campanhas, conjuntos, anúncios, imagens, páginas, cidades, métricas agregadas, cobrança e saldo exposto pelo provedor.
- Upload de imagem pela Marketing API e biblioteca privada de vídeos/URLs temporárias pelo módulo complementar.
- Preparar e confirmar planos de criação de campanha para site, pausa/ativação, orçamento de conjunto, renomeação; salvar resultados/IDs parciais.

### Ferramentas acrescentadas
1. Biblioteca de criativos, vídeos, públicos personalizados, pixels e conversões personalizadas.
2. Relatórios por conta/campanha/conjunto/anúncio, hoje/ontem/7 dias/30 dias, divisão por faixa etária/gênero/país/região/plataforma/posicionamento/dispositivo, com cálculo de custo, CTR, CPC e investimento.
3. Diagnóstico de desempenho por campanha, sem alterar automaticamente o gasto.
4. Preparação e criação de campanhas **Click-to-WhatsApp** com `OUTCOME_ENGAGEMENT`, `destination_type=WHATSAPP`, `CONVERSATIONS`, `promoted_object` de Página/número conectado da empresa; todos os recursos são criados **PAUSADOS**. A Meta poderá rejeitar conta/página/número incompatíveis; validar com uma conta própria antes de usar em cliente.
5. Criação de anúncios individuais com imagem dentro de conjuntos existentes, também **PAUSADOS**.
6. Prévia de alteração de orçamento em campanhas (CBO) e em conjuntos, sujeita a compatibilidade com o tipo de orçamento e validação da Meta.
7. Comandos em português no painel para consultar resultados, pausar/ativar, mudar orçamento e orientar a criação, sem execução automática nem livre acesso ao Graph; confirmação passa pelo mesmo fluxo `meta_ads_plans`.
8. Agendamento diário de relatório por empresa/fuso/horário (padrão 20h), snapshots no painel somente; worker opt-in `SOCIO_META_REPORTS_ENABLED=true` após homologação, sem WhatsApp/grupos.
9. [PR #57] Geração de links WhatsApp com código observado, isolados por tenant, com sinal de atribuição **indicativo**, não prova clique/lead/venda Meta.

### Segurança e compliance
- Nunca confundir token de Meta do ChatGPT/plugin com OAuth do app Sócio: é preciso que cada empresa autorize o aplicativo Sócio no próprio sistema.
- Todas as operações oficiais resolvem a conta selecionada, conferem token ativo e permissões do usuário/tenant; nunca expõem token no frontend. Escritas exigem prévia salva + confirmação e idempotência; timeout incerto nunca é reenviado automaticamente.
- Criar anúncio não significa ativá-lo. As quatro entidades de campanha ficam pausadas; ativação é operação separada autorizada.
- Sem criação de campanhas de categorias especiais, sem saldo automático, cartão, pagamento ou transferência de fundos.
- Relatórios da Meta mostram métricas da Meta, sem declarar que cliques são conversas WA-AKG ou vendas; o rastreamento PR #57 só fornece indicativo.
- API oficial Meta Ads e WA-AKG separados, inclusive no deploy. Importação do Prospector não toca seus clientes, banco ou WhatsApps.

### Ainda faltam homologação e implementação adicional
- Teste OAuth real com app Meta Developers já cadastrado, callback, `ads_read`, `ads_management`, seleção de conta e ciclo Meta de leitura/POST PAUSED em conta própria autorizada. Confirmar status do app/permissões externas.
- Click-to-WhatsApp: validar que Página e número WA-AKG estão efetivamente vinculados na Meta e que cada creative/adset é aceito. O tipo CTWA pode ter restrições conforme conta, versão da API e Página.
- Testar UI em navegadores reais, mobile e desktop e compatibilidade com menus existentes. Todos os testes automatizados usam respostas Meta simuladas, não publicação real.
- Vídeos: a biblioteca existe, mas a criação de anúncios de vídeo pelo construtor oficial ainda requer desenvolvimento e homologação.
- Grupos WhatsApp: WA-AKG atualmente importa conversas individuais e não garante metadados/participantes de grupos. Não habilitar execução por grupo sem validação de origem, ACL de membros e deduplicação do gateway.
- IA natural-language: comandos no painel já geram *prévias determinísticas*. Para execução pelo WhatsApp, incluir worker autenticado de eventos/canais, aprovações, limites de orçamento e auditoria antes de permitir mensagens externas.
- Envio automático de relatórios ao WhatsApp, vendas confirmadas e pagamento nativo exigem confirmação do gateway/provedor e autorização LGPD.
- PR #50 (treinamento Prospector) está separada, não representa recurso já publicado.

## Ordem de homologação proposta
1. Rebase/revisar PR #57 e PR desta caixa de ferramentas sem perder a segurança atual.
2. Aplicar schema somente em banco descartável, validar CI e testes com duas empresas.
3. Testar OAuth completo, contas disponíveis e consultas avançadas no Meta Ads da Consecom.
4. Criar campanha CTWA pausada em conta de teste; conferir na Meta IDs, creative e público; não ativar sem nova autorização.
5. Testar um anúncio em conjunto existente e a prévia de orçamento CBO; **não alterar campanhas reais durante QA**.
6. Ativar relatórios no Railway depois de confirmar snapshots e isolamento, sem envio WhatsApp; em seguida homologar grupos WA-AKG caso gateway suporte.
7. Validar responsividade/acessibilidade e somente então publicar a branch por merge de PR aprovada.
