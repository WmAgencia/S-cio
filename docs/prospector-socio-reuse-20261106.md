# Aproveitamento do Prospector no Sócio — análise 06/11/2026

## Fontes examinadas
- Prospector: `dashboard/francisca-training-interview.mjs`, `dashboard/training-markdown.mjs`, `dashboard/francisca-vendas-global.md`, `dashboard/francisca-chat-coach.mjs`, `docs/painel-v3-plano-implementacao-2026-11-05.md`.
- Sócio: `ai-replies.mjs`, `training-auto.mjs`, `public/app.js`, `docs/socio-ui-audit-20261104.md`, `README.md`.
- Este PR implementa somente a primeira integração segura: método comercial global no prompt. Não declara UI do Prospector migrada nem conexão WhatsApp validada.

## Fase 1 — Inteligência comercial (neste PR)
- Método de vendas global com foco em atendimento receptivo, sem preços ou fatos de empresas.
- Método global separado de catálogo e Markdown aprovado por empresa.
- Preservar bloqueios de envio, handoff humano, tenants e verificação de fontes.

## Fase 2 — Treinamento conversacional adaptativo
- Aproveitar a entrevista estruturada da Francisca: empresa, público, serviços individuais, valor ou orçamento, região, forma de compra, qualificação, tom, objeções, handoff, restrições, notificações e abordagem.
- UI de quatro etapas: perfil da empresa, entrevista em texto/voz, seleção consentida de conversas e revisão/aprovação.
- Gerar Markdown por empresa como rascunho versionado; editar, comparar, simular, aprovar e reverter.
- O Sócio já tem análise de conversas, anonimização, progresso e aprovação; reutilizar esses serviços em vez de substituir a base.
- Treinamento por voz precisa de microfone, transcrição e feedback de erros reais; não prometer full-duplex sem validação técnica.
- Abordagem inicial oferecida como opção configurável, sem criar prospecção automática.

## Fase 3 — UI/UX do Prospector para o Sócio
- Preservar tema e marca Sócio; portar padrões, não copiar integralmente CSS/HTML.
- Visão geral enxuta com indicadores, kanban comercial e estado discreto de WhatsApp.
- Conversas no padrão WhatsApp Web, com transferência `Assumir conversa` / `Entregar para IA`, indicador do operador, estados vazios e carregando.
- Conexões nomeadas, vários números por empresa, modal QR com desfoque e progresso de conexão.
- Treinamento em assistente de quatro etapas; após aprovação, chat/avaliação + perfil da IA em duas colunas no desktop e coluna única no mobile.
- Alertas da sessão desconectada com ação clara; sem repetição de banners gigantes.
- Mobile, acessibilidade, foco, teclado, feedback de ações, movimento reduzido e testes de responsividade.

## Fase 4 — Ferramentas e operação
- Contexto de conversa, análise de sucesso com evidência verificável, base de conhecimento global + individual.
- Alertas de oportunidades e supervisão humana de preços/orçamentos.
- Voz e Francisca administrativa só com ferramentas explicitamente autorizadas e auditadas.
- Treinamento, atendimento e ferramentas devem validar `tenant_id` no servidor. Não compartilhar banco, sessões ou históricos com Prospector.
- Prospector e Sócio usam gateways independentes: não copiar segredos, IDs de sessão ou tokens.

## Homologação antes de produção
- Testes multiempresa: nenhum treinamento, produto, lead, mensagem, resposta ou histórico vaza entre tenants.
- Histórico importado sem autorização não vira conhecimento ativo.
- Testes de preço inexistente, cliente irritado, opt-out, orçamento, handoff, repetição, prompt injection.
- Navegador real desktop 1440/1280, tablet e mobile 390/360; foco/teclado/leitor, estados sem dados e com dados.
- QR, reconnect, permissões e notificações com números autorizados; não prometer envios reais sem confirmação.
- Nada de publicação automática antes de CI e revisão.
