# Sócio — Plano de implantação completo e critérios de aceite
Data de referência: 04/11/2026

## Princípios operacionais

- **Sócio não é Prospector.** Nenhum recurso de prospecção, automação de disparos para contatos novos ou compartilhamento de conversas/tenants entre projetos.
- **Dados reais, sem simulações na produção.** Mostrar "configurado" não implica "conectado", "mensagem aceita" não implica "entregue/lida", e "serviço online" não implica funcionalidade validada.
- **Um tenant por empresa.** SQL sempre escopado, funções de envio nunca recebem número fornecido pelo navegador; o destino é a conversa pré-existente da empresa.
- **IA somente após entrega explícita** e somente para mensagens recebidas posteriormente. Solicitação de humano ou interrupção impede novas respostas automatizadas.
- **Canais/segredos protegidos.** Rotacionar segredos publicados em conversas; usar Railway Variables e jamais commitar credenciais.
- **Sem migração de produção sem reconciliação.** O PostgreSQL Railway continua fonte primária até cópia, contagens, verificação de referências, backup e rollback ensaiado.

## Fases, entregáveis e aprovação

### Fase 1 — Atendimento real (prioridade atual)
**Entregáveis:** QR Code verdadeiro, reconexão, múltiplos números por tenant, recepção e sincronização de texto, caixa WhatsApp com filtros Todas/IA/Humano, transferência responsável, envio humano autorizado com confirmação, Groq para teste e IA com conhecimento aprovado.

**Aceite obrigatório:**
1. Sessão vinculada por QR, número confirmado, reconectada depois de reiniciar gateway.
2. Mensagem recebida aparece na conversa certa, uma vez; nota interna fica invisível ao cliente.
3. Conversa assumida pelo humano → IA deixa de responder e humano consegue enviar uma resposta.
4. Conversa entregue à IA → IA responde a uma mensagem **nova** com contexto aprovado; não usa notas internas.
5. Erro, timeout e repetição da mesma requisição não criam mensagens duplicadas.
6. Verificação de CSRF, acesso por tenant e controle do gateway com testes automatizados e com dois telefones controlados.
7. Comandos de parar e pedido de humano interrompem automação.
8. **Áudio/mídia:** não habilitar antes de políticas de tamanho, tipo, armazenamento, inspeção, retenção e testes reais.

**Estado na auditoria inicial:** infra saudável, API Groq cadastrada, WhatsApp sem sessões conectadas no último registro. Código de atendimento individual presente; teste real de número e envio ainda pendente.

### Fase 2 — Aprendizado e conhecimento
- Análise de histórico disponível por canal da empresa, com consentimento/autorização.
- Progresso calculado a partir das importações e tarefas reais, incluindo casos de erro.
- Markdown como **rascunho**, revisão explícita, versões e rollback.
- Relatório de cobertura parcial; não inferir vendas comprovadas a partir de expressões de interesse.
**Aceite:** teste com histórico consentido, amostras conhecidas, conferência de conteúdo e rollback de versão.

### Fase 3 — Catálogo e vendas
- Cadastro de produtos/serviços, fotos, preços, SKU, variações, estoque e disponibilidade.
- Orçamento versionado associado à conversa; pedido com aprovação do cliente.
- Pagamentos via provedor autorizado, idempotência de cobrança, webhook verificado, comprovante e reembolso.
**Aceite:** testes de preços/estoque, pedido de teste, cobrança em sandbox e evidências de confirmação. Nunca cobrar cliente real em teste.

### Fase 4 — Multiempresa e equipe
- Cadastro por CNPJ público, owner/administrador/atendente, permissões por operação, auditoria e sessões.
- Isolamento cruzado testado para conversas, mídia, produtos, agentes, pedidos e arquivos.
- Backups e recuperação ensaiados.
**Aceite:** testes de autorização negativos e simulação de recuperação em ambiente isolado.

### Fase 5 — Supabase e confiabilidade
- Inventário de 25 tabelas existentes no esquema privado `socio_app`, estrutura posterior adaptada por migrações.
- Captura segura dos registros do Railway, checagem de contagens/constraints/hash, backup, janela de manutenção e rollback.
- Só trocar `DATABASE_URL` após validação e autorização, sem perder tenant master, sessão e histórico.
**Aceite:** reconciliação zero divergência e healthcheck antes/depois com plano de retorno.

### Fase 6 — Instagram
- Conexão autorizada de conta profissional e permissões de mensagens; configuração por tenant.
- Inbox com origem correta e limites da plataforma, revogação e respeito à privacidade.
**Aceite:** envio e recebimento de teste em contas autorizadas; isolamento e revogação.

### Fase 7 — Meta Ads
- Conectar contas autorizadas de cada empresa; relatório e insight antes de propor ações.
- Ações de campanha protegidas por permissões e aprovação explícita; orçamento máximo por tenant.
**Aceite:** leitura sem mutação, criação em pausa e conferência de cobrança/segmentação.

### Fase 8 — Google Ads
- OAuth, conta vinculada por tenant, consultas de campanhas e desempenho.
- Mudanças com limites de orçamento, aprovação e auditoria.
**Aceite:** leitura correta de conta de teste e mudanças reversíveis.

### Fase 9 — Central de comandos e voz
- Ferramentas seguras de consultar conversas, filtrar dados, responder como dono e produzir relatórios.
- Orquestrador que distingue solicitação do dono vs. cliente; confirmação para qualquer envio.
- Voz, transcrição e interrupção com autenticação de dono, histórico separado e controles de custo.
**Aceite:** matriz de ferramentas por perfil, ataques de prompt injection e verificação de chamadas em ambiente de teste.

### Fase 10 — Comercialização SaaS
- Planos, assinatura, faturas, trial, limites por canal/usuário/mensagem, suporte e LGPD.
- Monitoramento de custos Groq/gateway, logs sem segredos, política de retenção e exclusão.
**Aceite:** onboarding e cancelamento completos, cobrança sandbox, restauração de backup, termos e atendimento de suporte.

## Pendências de terceiros e decisões

- **WhatsApp real:** precisa de telefone que possa escanear QR; sem ele não declarar fase 1 concluída.
- **Groq:** a variável existe em produção, mas sua aceitação deve ser testada por uma chamada real controlada. Segredo publicado em chat deve ser rotacionado.
- **Instagram/Meta/Google Ads:** requerem autorização, contas e escopos de cada empresa antes de ativar módulos.
- **Pagamentos:** dependem de provedor, planos e titular da conta.
- **Supabase:** esquema criado mas dados vazios; falta acesso autorizado à origem e plano de corte.
- **Manutenção do WA-AKG:** analisar vulnerabilidades de dependências em imagem/lockfile e evitar portas públicas.

## Ordem de execução

1. Entregar diagnósticos verificáveis na UI e remover notas internas do contexto de IA.
2. Corrigir integridade dos envios (idempotência, permissões, confirmação e auditoria).
3. Testar Groq autenticado sem guardar respostas/segredos e testar QR em telefone autorizado.
4. Demonstrar humano ↔ IA e treinamento em conversa real.
5. Só então avançar a vendas, integrações, voz e infraestrutura de faturamento. Cada fase requer testes, revisão e deploy seguro.
