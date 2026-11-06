# Auditoria de reaproveitamento do Prospector no Sócio
Data: 2026-11-06. Base consultada: `WmAgencia/Prospector` e `WmAgencia/S-cio`, branches main. Documento de planejamento; não representa implementação destas funções.

## Objetivo e princípio
Reaproveitar comportamentos, lógica e padrões de interface validados no código do Prospector, mantendo o Sócio como SaaS multiempresa independente: PostgreSQL Railway como produção atual, `tenant_id` e RBAC em todas as consultas, treinamento versionado, canais WhatsApp vinculados à empresa, segredos e sessões isolados. Não reutilizar SQLite, diretórios de dados, credenciais, preço interno da Consecom ou sessões WA-AKG do Prospector.

## 1 — Treinamento e inteligência artificial (prioridade máxima)
| Recurso Prospector | Fontes | Sócio hoje | Adaptação sugerida |
| --- | --- | --- | --- |
| Entrevista adaptativa por empresa | `dashboard/francisca-training-interview.mjs` | Campos manuais + análise de históricos | Assistente guiado com perguntas por produto/serviço, preço, prazo, público, região, objeções, limitações e handoff |
| Texto/áudio no treinamento | `dashboard/training.mjs`, `dashboard/public/simple-app.js` | Sem entrevista falada guiada | STT temporário, texto revisável e confirmação, nunca ativar sem aprovação |
| Quatro etapas e UI lado a lado | `docs/painel-v3-plano-implementacao-2026-11-05.md`, `dashboard/public/simple-app.js` | Treinamento automático e Markdown | Etapas empresa → entrevista → seleção consentida de históricos → revisar/testar/aprovar; desktop duas colunas |
| Manual global de vendas | `dashboard/francisca-vendas-global.md` | Prompt comercial básico | Técnicas sem fatos de clientes, separadas das regras e catálogo por tenant; primeira integração isolada em PR #46 |
| Provas sociais aprovadas | `dashboard/training-sales-extras.mjs`, `dashboard/sales-training-documents.mjs` | Catálogo de produtos com imagens | Upload privado de imagens/PDFs, links, depoimentos autorizados e cases; aprovação, validade e compartilhamento só autorizado |
| Política de fechamento e pagamento | `dashboard/training-sales-extras.mjs`, `dashboard/sales-payment-flow.mjs` | Orçamentos humanos e sem pagamento automatizado | Proprietário escolhe apenas avisar ou conduzir fechamento; meios de pagamento, entrada/saldo, preço validado, PIX seguro; comprovante não é liquidação |
| Estilo aprendido com exemplos | `dashboard/sales-tone-playbook.mjs`, `docs/sales-style-2026-11-05.md` | Conhecimento por histórico e prompt | Extrair linguagem genérica após consentimento, sem copiar nomes, dados, preços ou texto integral |
| Contexto de conversa e guia dinâmico | `dashboard/francisca-chat-coach.mjs`, `dashboard/francisca-context-bank.mjs` | Histórico curto + regras de orçamento | Resposta contextual, evitar repetição, uma pergunta por vez, reconhecer correções e intenções |
| Decisão auditável e aprendizado rotulado | `dashboard/decision-intelligence/engine.mjs`, `learning.mjs` | Detecção determinística de vendas/orçamentos | Classificar interesse, dúvidas, recusa, prioridade, e revisão; aprender só de exemplos rotulados |
| Fallback dinâmico de modelos | `dashboard/groq-models.mjs` | Fallback estático em `groq-client.mjs` | Catálogo compatível, tarefas conversation/quick/voice, timeouts, métricas e fallback sem reenvio WhatsApp |
| Simulador generativo e regressões | `dashboard/simulation/francisca-duel-100.mjs`, `francisca-sales-smoke.mjs`, `tests/` | Laboratório e testes | 100+ personas fictícias por comércio, 0 envio externo, avaliar objeções, preços, ambiguidade, memória e limites; simulado não equivale a mundo real |

## 2 — Interface e experiência
| Recurso | Fonte | Adaptação |
| --- | --- | --- |
| Navegação full-screen, cards, hierarquia e foco | `dashboard/public/simple-app.js`, `product-theme.css`, `dashboard-purple.css` | Aproveitar padrões de composição; manter identidade e paleta própria do Sócio |
| Painel visual de resultados e Kanban | `dashboard/kanban.mjs`, `public/simple-app.js` | Funil atendimento → qualificado → orçamento → negociação → fechado, com status persistidos e sem receita fictícia |
| Caixa tipo WhatsApp Web, takeover | `dashboard/conversation-handoff.mjs`, `public/simple-app.js` | Melhorar inbox já existente, indicadores IA/humano, atalhos e legibilidade móvel |
| Múltiplos WhatsApps nomeados, QR modal, estados | `dashboard/waakg-session-registry.mjs`, `public/simple-app.js` | Reaproveitar UX; sessões reais permanecem exclusivas do Sócio |
| Francisca flutuante no painel | `dashboard/francisca-panel.mjs`, `public/francisca-live.mjs` | Assistente ao dono com acesso a ferramentas de leitura por tenant e perfil com permissões |
| Progresso e gestão de treinamento | `dashboard/training.mjs`, `public/simple-app.js` | Reaproveitar painel de status e revisão, preservando versionamento e retomada atuais |
| Calendário operacional | `dashboard/prospecting-calendar.mjs` | Mostrar atendimentos, propostas, vendas confirmadas e histórico do próprio comércio |
| Alertas discretos e confiabilidade | `dashboard/notifications.mjs`, `waakg-live-status.mjs` | Status resumido e ação reconectar; proprietário pode receber alertas consentidos |
| Voz por turnos, interrupção local, métricas | `dashboard/francisca-voice-*.mjs`, `francisca-call-observability.mjs` | Fase avançada, sem prometer full-duplex; medição de STT/LLM/TTS e acessibilidade |

## 3 — Comercial, operações e SaaS
| Recurso | Fonte | Adaptação |
| --- | --- | --- |
| Sinais comerciais e próxima ação | `dashboard/sales-intelligence.mjs` | Priorização de oportunidades do Sócio, sem inferir atributos sensíveis |
| Aprovações de preço/condições | `dashboard/owner-price-approvals.mjs` | Aprovação humana rastreável para descontos, condições e orçamentos |
| Comprovantes e etapas do Pix | `dashboard/sales-payment-flow.mjs` | Registro de imagem/comprovante para revisão; status comercial separado de pagamento verificado |
| Notificações ao dono e relatórios | `dashboard/notifications.mjs`, `platform-analytics.mjs` | Eventos por tenant, métricas comprováveis, sem números inventados |
| Áudio recebido e mensagens por voz | `dashboard/waakg-audio-inbound.mjs`, `waakg-audio-outbound.mjs` | Tipos, tamanho, armazenamento, consentimento e transcrição; enviar só conforme autorização |
| Resposta texto/áudio/ambos | `dashboard/groq-reply-channels.mjs` | Preferência por contato com fallback seguro para texto |
| Conexão e operação resilientes | `dashboard/queue-health.mjs`, `waakg-live-status.mjs` | Diagnóstico de atrasos, mensagens de status incerto, sem reenvio duplicado |
| Assistente do proprietário com ferramentas | `dashboard/francisca-owner-voice-actions.mjs`, `francisca-voice-orchestrator.mjs` | Consulta de vendas, estoque, WhatsApps e equipe; alterações sujeitas a controles autenticados |
| Painel master e indicadores SaaS | `dashboard/platform.mjs`, `platform-analytics.mjs`, `platform-store.mjs` | Monitorar ativações, engajamento, demonstrações, conversão e tickets, sem copiar arquitetura SQLite |
| Onboarding de 7 dias | Proposta comercial própria do Sócio; Prospector tem cadastro e painéis de acesso | Implementar status de teste com data inicial/final, métricas de uso, relatório dia 7, aceite de mensalidade e suspensão não destrutiva; o campo `status='trial'` existente não implementa expiração automática |

## 4 — Não importar
- Prospecção fria automatizada, buscas Google Maps/OSM, cadência 08h–17h30, reciclagem de leads, mensagens não solicitadas, campanhas com limite 250/dia e sistema de créditos por abordagem.
- Scripts, preços, números, políticas e conhecimento particular da operação Consecom.
- Banco SQLite, sessões, tokens, diretórios e chave WA-AKG do Prospector.
- Capacidade declarada como planejamento ou simulação (por exemplo áudio de turnos apresentado como full-duplex, 100 cenários sintéticos apresentados como 100 vendas reais).

## 5 — Ordem sugerida
1. **P0:** unir treinamento adaptativo (incluindo provas sociais e escolha de handoff/fechamento) com análise, Markdown versionado, revisão e laboratório já existentes; testes por tenant.
2. **P0:** integrar guia comercial global de PR #46 após CI e revisão; classificar contexto, objetivo e próximo passo sem autorizar novas ferramentas.
3. **P1:** melhorar UI, inbox, QR, Kanban, indicadores e notificações, com revisão de navegador real desktop/tablet/mobile.
4. **P1:** aprimorar fallback Groq, avaliação com personas fictícias e telemetria idempotente.
5. **P2:** áudio de clientes, Francisca administrativa e comandos de voz com limites operacionais.
6. **P2:** demonstração de 7 dias, relatório de ativação e assinatura mensal, após definir planos e configuração de custos.

## 6 — Critérios de aceite
- Testes de autorização por tenant e papel, sem fontes cruzadas entre empresas.
- Nada do histórico vira conhecimento ativo sem consentimento, anonimização e aprovação.
- Preços, estoque e descontos somente de registros válidos; comprovante não comprova liquidação; não há cobrança automática no teste gratuito.
- Escritas externas precisam de gateway habilitado, canal verificado, autorização e idempotência; respostas incertas não são reenviadas.
- Testes de navegador autenticado em desktop e mobile; regressões de acessibilidade e voz.
- Somente publicar após CI e revisão; sem alterar produção a partir deste documento.

Referências principais:
- Prospector PR #113 (UI v3) foi mesclada à branch main, mas isso não garante publicação/homologação real.
- Sócio PR #46 é rascunho, aberta; seu manual comercial ainda não faz parte da main.
