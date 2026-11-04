# Sócio · Conversas no padrão WhatsApp (04/11/2026)

## Entregue na aba Conversas

- Layout responsivo de conversa, com lista de contatos, mensagens, painel lateral de detalhes e visual espresso/laranja/verde existente.
- Pesquisa por contato, telefone e corpo de mensagem; filtros não lidas, favoritas, fixadas, atendimento humano/IA assistiva, resolvidas e arquivadas.
- Bolhas e separadores por data, histórico paginado, seleção de mensagens, cópia, favoritos e reações **internas**.
- Duplo clique para responder como nota interna, clique esquerdo para abrir ações, clique direito, arraste direita/esquerda, gesto longo no celular, navegação por teclado e atalhos.
- Resposta citada **interna** com vínculo à mensagem original, encaminhamento como nota interna para outra conversa da mesma empresa.
- Rascunhos persistidos por conversa, responsáveis da equipe, etiquetas, marcação de leitura, silenciar, arquivar, fixar e alternância humano / IA assistiva.
- IA: botão para gerar sugestão por Groq (simulador já existente), sempre para revisão humana. Não envia automaticamente.
- Configurações de acessibilidade: texto ampliado, contraste alto, lista compacta, rótulos, foco, ajuda de atalhos, suporte a movimento reduzido.
- Sincronização MANUAL de histórico de texto por canal WA-AKG autorizado e conectado, em lotes de 5 conversas, até 50 conversas da listagem do gateway. Importa até 100 mensagens de texto por contato por execução, com deduplicação e nome de contato quando disponível.
- Atualização da tela a cada 12 s, consultando a base da própria empresa enquanto a aba está aberta. Não é push/WebSocket do WhatsApp.

## Segurança e limites explícitos

- Nunca reutilizar a aplicação Prospector: apenas `WmAgencia/S-cio`, gateway `socio-waakg`, base e sessão da empresa atual.
- O gateway da aplicação é `SOCIO_GATEWAY_READ_ONLY=true` e bloqueia `sendMessage` no Baileys, além de desativar o bot nativo. O usuário **não deve ver uma falsa confirmação de envio**.
- Enviar texto, editar/remover/reagir no WhatsApp, encaminhar externamente, mídia e áudio de saída estão **indisponíveis** até criar e auditar uma integração segura de transmissão autorizada. Em vez disso existem notas, reações e favoritos **internos**. Os controles de áudio/anexo explicam a indisponibilidade.
- A sincronização importa texto disponível, não mídias, áudios, documentos, grupos, entregas/lidas de WhatsApp ou histórico completo. A API WA-AKG seleciona os 50 chats mais recentes e essa etapa lê somente 100 mensagens por contato. A sincronização se inicia por ação explícita e é idempotente.
- APIs novas: `GET /api/inbox/v2`, `GET /api/inbox/capabilities`, `POST /api/inbox/sync`, `GET /api/conversations/:id/history`, `PATCH /api/conversations/:id/ui`, `POST /api/conversations/:id/notes`, `POST /api/conversations/:id/forward-internal`, `PATCH /api/conversations/:id/messages/:id/ui`.
- Toda API exige sessão; mutações exigem CSRF; consultas e mudanças usam `tenant_id` e verificações de IDs e permissão; JIDs não são publicados no navegador; IDs de mensagem persistidos são hashes da fonte.
- Fluxo de mídia exigirá armazenamento protegido, controle de formato/tamanho, antifraude e testes end-to-end; não reutilizar o bucket de catálogo como mídia de WhatsApp sem modelo de acesso.

## Verificação

Testes em `tests/inbox-v2.test.mjs`, `tests/inbox-browser-smoke.test.mjs` e `tests/e2e.test.mjs` cobrem SQL e CSRF, isolamento multiempresa, pesquisa, notas citadas, favoritas, rascunhos, importação de texto real simulada e ausência de endpoint de envio externo.

O mig­rador Railway→Supabase inclui agora também as duas novas tabelas, mas **a troca de produção para Supabase continua não realizada**. O banco ativo permanece no Railway até migração segura autorizada e verificada.
