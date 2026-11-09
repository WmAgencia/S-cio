# Sócio Inteligente — etapa 2: memória contextual persistente

## Fonte e decisão de arquitetura
Adaptado conceitualmente de Prospector/dashboard/francisca-conversation-memory.mjs e francisca-conversation-state.mjs. O Prospector usa uma tabela SQLite para continuar o atendimento. O Sócio utiliza PostgreSQL e isola empresas por tenant_id; por isso este módulo foi reescrito com transações e chaves compostas, sem copiar SQLite, textos privados ou condições comerciais da Consecom.

## O que está implementado
- Memória compacta por tenant + conversa: apenas rótulos enumerados dos assuntos, tópicos citados em respostas, quantidade limitada de turnos e indicador de atendimento anterior.
- Retenção de 30 dias desde a última atualização de tópicos; limpeza física dos registros expirados ao iniciar e a cada hora, inclusive se a gravação de novos resumos estiver desligada.
- Cursor composto (created_at,id), processamento incremental de até quatro lotes de 200 mensagens por execução, transações com FOR UPDATE para impedir processamento duplicado entre réplicas.
- Entrada protegida: somente conversas vinculadas ao próprio tenant; notas internas excluídas; até 30 dias de histórico considerados no primeiro processamento.
- Contexto recente do atendimento e da simulação continuam funcionando sem banco de memória. Memória é um reforço de contexto, não fonte de fatos comerciais.
- Endpoint autenticado GET/DELETE /api/conversations/:uuid/ai-memory, com permissão training.manage.
- Controles dentro da caixa de entrada para quem pode gerenciar o treinamento: consultar assuntos ou limpar os resumos com confirmação.
- Limpar memória não exclui mensagens do WhatsApp: avança o cursor para que mensagens antigas não recriem os tópicos.
- Migração do schema Railway e SQL privado do Supabase, sem alterar DATABASE_URL ou executar migração remota.

## Ativação (segura por padrão)
A leitura/escrita de resumos durante o atendimento fica desligada enquanto SOCIO_CONVERSATION_MEMORY_ENABLED não for "true". Não ative antes de aprovação dos testes, migração do banco correspondente e homologação com dados autorizados. A flag NÃO ativa respostas WhatsApp: envio ainda depende das chaves e do controle de handoff existentes. Nunca usar a existência da memória como permissão para enviar, vender, cobrar, agendar ou alterar campanhas.

## Privacidade e limites
- Nunca duplicar conteúdo das mensagens, telefone, CPF, e-mail, chaves, notas internas ou nomes na tabela de memória.
- Nunca inferir pagamento concluído, aceite comercial, permissão para disparar mensagens ou disponibilidade de produtos dos rótulos de assunto.
- A memória não retém detalhes semânticos específicos ("o cliente disse que o preço final é ..."); recorda apenas o assunto discutido. Reconhece a continuidade entre sessões, não substitui o histórico ou o catálogo oficial.
- A exclusão protege o resumo derivado. Exclusão de histórico/contato segue a política existente do módulo de mensagens; apagar a memória não equivale a apagar todos os dados pessoais.
- A migração do Supabase deve ser aplicada ao schema privado ANTES de iniciar uma instância com o inventário de tabelas atualizado; não rodar o schema público da Railway no Supabase.

## Testes
- Sintaxe e regressão de UI + rotas existentes.
- Resumos enum-only sem vazamento de conteúdos, rate-limits e flag desabilitada.
- Integração PostgreSQL com tenants distintos, múltiplas réplicas, cursor, exclusão e expiração.
- Suite de CI principal, auditoria de dependências e worker de backup.

## Pendências futuras
- Painel detalhado de retenção/consentimento e exclusão total do histórico quando solicitado.
- Resumos de fatos não sensíveis com proveniência e confirmação explícita, além de busca semântica autorizada.
- Observabilidade de precisão, latência e recuperação em clientes de homologação.
