# Sócio Inteligente — auditoria e etapa 1 (branch de desenvolvimento)

## Escopo e limites
Este pacote evolui o atendimento e o laboratório sem trocar Groq, executar ações externas, enviar WhatsApp, mudar o banco ou habilitar recursos por padrão. O código existente de roteamento de ferramentas, aprovações, handoff e isolamento por tenant permanece responsável pela autorização.

| Ponto | Antes | Entregue nesta etapa | Ainda necessário |
|---|---|---|---|
| 1. Naturalidade | Instruções distintas e fechos repetitivos possíveis | Regras compartilhadas de linguagem natural, remoção restrita de saudações repetidas e alguns encerramentos automáticos | Avaliação humana de amostras reais e personalização por segmento |
| 2. Memória | Até 18 mensagens recentes + Markdown aprovado | Contexto cronológico limitado, sem notas internas, e histórico conversacional isolado no laboratório | Memória duradoura por cliente com consentimento, retenção, exclusão e proveniência |
| 3. Conhecimento | Markdown aprovado cortado pelo começo | Recuperação textual de seções relevantes, mantendo seções explicitamente rotuladas de regras/limites; 100% local e determinística | Busca híbrida/pgvector, relevância medida, citações de fonte e revisão humana |
| 4. Ferramentas | Roteador com permissão e confirmação humana | Preservado e protegido por teste de integração: o laboratório não acessa o roteador | Catálogo versionado e avaliações de execução entre ferramentas |
| 5. Voz/imagem | Ponte de mídia do proprietário com flags e validação | Fluxos preservados e nenhuma ativação implícita | Testes reais de WhatsApp e processamento multimodal do cliente, com consentimento e limites de custo |
| 6. Laboratório | Teste de mensagem isolada com regras diferentes | Instruções equivalentes às da produção, histórico local limitado a 12 turnos, sinais heurísticos de naturalidade | Conjunto de casos de avaliação humana e métricas de qualidade/precisão por empresa |

## Regras de segurança preservadas
- Apenas conversas explicitamente atribuídas à IA podem receber respostas automáticas; a configuração de envio existente continua obrigatória.
- O roteador de ferramentas continua exigindo permissões e aprovação explícita antes de alterações em campanhas, valores ou mensagens.
- O laboratório continua somente simulação: histórico temporário na tela, sem escrita no banco e sem envio.
- O conhecimento aprovado da empresa e as falas do cliente são dados não confiáveis, nunca permissões para executar comandos.
- Consultas de conhecimento usam somente o Markdown fornecido para a empresa ativa; não há busca entre tenants.
- A revisão automática mede apenas sinais de estilo; não é pontuação de precisão factual ou validação de segurança.
- Mídias, áudio e comandos de proprietário permanecem sujeitos às opções de ativação e verificações anteriores.

## Validação
Rodar:
- node --check socio-intelligence.mjs
- node --check ai-replies.mjs
- node --check server.mjs
- node --check public/app.js
- node --test tests/socio-intelligence.test.mjs
- npm test (CI inclui PostgreSQL temporário)
- A CI também verifica o build do serviço de backup e npm audit.

## Teste funcional manual antes de ativar qualquer atendimento real
1. No laboratório de uma empresa de testes, configurar uma personalidade e uma versão aprovada de conhecimento.
2. Perguntar sobre serviço, resposta a orçamento, dúvidas de preço, pergunta repetida e solicitação de humano.
3. Testar ao menos três turnos encadeados; confirmar que a IA não repete cumprimentos nem responde com dados de outra empresa.
4. Comparar as respostas com o Markdown aprovado e o catálogo real.
5. Verificar que nenhuma mensagem é enviada pelo laboratório; testar handoff humano e o não-reenvio em ambiente isolado.
6. Fazer uma revisão humana de respostas que mencionem desconto, prazo, estoque, pagamento ou ação real.

## Implantação
Este PR deve ser revisado e a CI precisa aprovar antes de considerar merge para main. Nenhuma flag de autoenvio ou mídia deve ser habilitada por esta alteração. Não há migração de banco.


## Adaptação de componentes do Prospector — continuidade v1

Foi realizada uma leitura de arquivos do Prospector em seu branch main de novembro de 2026. Fontes consultadas:
- Prospector/dashboard/francisca-conversation-state.mjs
- Prospector/dashboard/francisca-conversation-memory.mjs
- Prospector/dashboard/francisca-context-bank.mjs
- Prospector/dashboard/francisca-chat-coach.mjs
- Prospector/dashboard/francisca-dialogue-style.mjs
- Prospector/dashboard/francisca-voice-context.mjs
- Prospector/dashboard/francisca-semantic-turn.mjs

**Portabilidade seletiva:** o módulo socio-prospector-continuity.mjs foi criado com classificação genérica de intenções, tópicos recentes, continuação, correção, mudança de assunto e perguntas múltiplas. Os rótulos não incluem mensagem bruta, telefone, e-mail, documento ou valor. A recuperação ocorre sobre até 80 mensagens existentes da própria empresa e conversa, já armazenadas pelo Sócio; não há tabela nova nem memória cruzada entre negócios. O laboratório gera os mesmos sinais a partir de seu histórico de sessão local, sem salvar esses turnos.

**Proteções do Prospector adaptadas:** limpeza conservadora de saudações e bordões repetidos, mas mantendo textos quando o cliente pede literalmente um roteiro ou uma frase de saudação. Pedidos explícitos para parar ou falar com uma pessoa recebem handoff humano antes da chamada ao modelo.

**Já existia no Sócio (não duplicar):**
- socio-thalita-dialogue-style.mjs: port anterior da Francisca, com regras de voz e pós-processamento.
- public/socio-francisca-live.mjs: microfone contínuo, reconhecimento de pausas e mecanismo de interrupção de fala.
- socio-training-interview.mjs: entrevista guiada por empresa e Markdown de conhecimento sujeito à aprovação.
- socio-skill-router.mjs: ferramenta administrativa que preserva permissões e confirmações.

**Não copiar diretamente:** as ofertas e condições da Consecom, scripts de abordagem ativa, tabelas SQLite do Prospector, credenciais, memórias pessoais do proprietário, notificações comerciais de prospecção ou comandos que ignoram permissões do Sócio.

### Limitações intencionais
Este port preserva continuidade no recorte de 80 mensagens persistidas do chat, não uma memória de longo prazo ilimitada. A classificação é heurística e só sugere contexto para a resposta; não interpreta texto como autorização, pagamento confirmado, cliente opt-in, desconto aprovado ou envio confirmado. Memória duradoura com retenção, consentimento e exclusão deve ser implementada e testada em etapa separada. Recursos multimodais não são ativados por esta alteração.
