# Auditoria complementar do Sócio

Base desta rodada: `45b868075dbd1c09c56d6f74a167a27a1b3f63fd` (PR #41). Ambiente local em `E:\auditoria-socio\repo`, PostgreSQL 16.15 descartável e serviços externos simulados.

## Correções desta rodada

| Área | Problema confirmado | Resultado |
| --- | --- | --- |
| Módulos | Simulador, importações e teste Groq não estavam no bloqueio de IA; rotas Instagram não acompanhavam o módulo de atendimento. | Autorização aplicada também nessas rotas. O simulador não consulta catálogo desabilitado. |
| Painel | Desabilitar WhatsApp fazia a página inicial solicitar APIs bloqueadas e falhar. | Painel carrega sem essas chamadas; atalhos indisponíveis ficam ocultos. Resumos não retornam dados de módulos desabilitados. |
| Minha conta | Desabilitar o módulo de equipe ocultava também a troca da própria senha e telefone. | Segurança da própria conta permanece acessível sem liberar gestão de colaboradores. Empresas pausadas podem trocar suas próprias credenciais. |
| Autenticação | Limite de 15 tentativas era compartilhado por todas as contas atrás do mesmo proxy. | Limitação por identidade normalizada, com limite adicional por origem. Uma conta inválida não bloqueia automaticamente outra. |
| Entrada HTTP | Cookie com escape inválido e JSON nulo/primitivo podiam produzir erro interno. | Cookie inválido exige autenticação; corpo JSON deve ser objeto, com erro 400 para formatos incompatíveis. |
| Atendimento | Conversas nunca abertas não eram consideradas não lidas. | Mensagens recebidas ficam não lidas até marcação explícita de leitura. Atribuição recusa colaboradores inativos. |
| Rascunhos | Autosave pendente podia operar sobre a conversa recém-selecionada ou restaurar texto já enviado. | Salvamento captura a conversa e serializa gravações por conversa; rascunhos locais ainda não salvos são preservados durante atualização da lista. |
| Interface assíncrona | Preferências, paginação e atualização periódica podiam aplicar respostas atrasadas em outra conversa. | Verificação da conversa e do histórico antes de aplicar respostas; pesquisa descarta resultados ultrapassados. Troca de conversa aguarda um envio em andamento. |
| IA | Modo de atendimento podia mudar enquanto o envio aguardava o gateway. | Verificação final de empresa, canal, usuário, modo e agente antes de enviar. Respostas antigas são canceladas se chegou nova pergunta ou resposta da empresa. |
| Encerramento | Resolver uma conversa mantinha a indicação de IA ativa e permitia retomada indevida depois. | Resolver ou assumir atendimento humano desativa a IA nessa conversa. |
| Idempotência | Repetir consulta de envio confirmado podia falhar após encerramento ou desconexão. | Repetição retorna o recibo original sem nova transmissão, desde que corresponda à mensagem original. |
| Triagem comercial | Os primeiros 40/60 candidatos rejeitados eram consultados repetidamente e impediam alcançar pedidos mais antigos. | Cursor composto rotativo por pool, com desempate por ID e precisão PostgreSQL. Perguntas de valor também entram na seleção de orçamentos. |
| Histórico importado | Conversas antigas eram registradas com data atual; contatos apenas com mídia geravam conversas vazias. | Data da conversa acompanha a última mensagem persistida; lotes sem texto válido são ignorados. |
| Gráficos | Agrupamento diário/mensal dependia do fuso do banco, diferente do horário de Brasília usado nos indicadores. | Intervalos e agrupamento definidos explicitamente em `America/Sao_Paulo`. Períodos inválidos são recusados. |
| Treinamento | Criação do trabalho usava outra transação e podia deixar tarefa órfã. | Trabalho, itens e execução automática são gravados na mesma transação, com savepoint para tratar falhas. |
| OAuth | Callback podia concluir uma autorização iniciada antes da pausa da empresa ou desativação do módulo. | Acesso e disponibilidade são verificados novamente antes de contactar o provedor. |
| Diagnóstico | Sincronização era mostrada como desabilitada quando a variável estava ausente, embora o worker funcionasse por padrão. | Diagnóstico e worker usam a mesma regra de ativação. |
| Paginação de auditoria | Eventos com o mesmo horário podiam desaparecer na divisão de páginas. | Cursor de timestamp e ID, com `hasMore` e `nextCursor`, preservando a compatibilidade com datas antigas. |
| Datas inválidas | Datas normalizadas pelo JavaScript, mas inválidas no PostgreSQL, podiam chegar ao banco. | Validação de formato e calendário antes de executar SQL. |
| Progresso visual | A largura da barra de treinamento era escrita em HTML inline bloqueado pela CSP. | Largura aplicada como propriedade DOM, sem afrouxar a política de segurança. |

## Validação

- Suíte completa com PostgreSQL real: **131 testes aprovados**, sem falhas ou testes ignorados.
- Verificações adicionais de interface e regressões: salvamento atrasado, alternância de conversas, limpeza de rascunho em fila, cancelamento de resposta de IA, rotação de triagem, fuso de Brasília, paginação de auditoria e módulos desabilitados.
- Testes de transação verificam que rollback remove o trabalho de análise e seus itens juntos.
- Edge real: login, navegação pelas dez áreas do painel, visualização móvel de 390 px e carregamento da própria conta com os módulos WhatsApp, IA, orçamentos e equipe desabilitados. A administração de equipe permanece inacessível nesse cenário.
- Verificação real da largura da barra de treinamento sob a CSP da aplicação.
- `npm audit --omit=dev`: nenhuma vulnerabilidade conhecida nas dependências resolvidas.
- `git diff --check` e verificação de sintaxe dos arquivos JavaScript.

Uma execução paralela do CI identificou também uma corrida na limpeza do banco descartável dos testes. O encerramento agora aguarda o processo da aplicação e as conexões antes de excluir a base, sem derrubar conexões à força.

As integrações de envio e pagamento são verificadas com fixtures. Nenhuma compra ou mensagem para clientes é necessária para estes testes. A publicação segue PR e CI, seguida de verificação do healthcheck e do conteúdo servido no domínio existente.

## Melhorias que continuam exigindo evolução estrutural

1. O gateway ainda limita sua enumeração a 50 conversas e o acesso ao histórico é parcial. Remover esse limite exige contrato de paginação ou eventos do provedor; o sistema deve continuar informando essa cobertura parcial.
2. Os limitadores em memória não compartilham estado entre réplicas. Uma expansão horizontal deve usar armazenamento compartilhado e uma política explícita de confiança no proxy.
3. Alertas por atraso de sincronização, filas antigas e falhas persistentes precisam de métricas operacionais e monitoramento contínuo.
4. Pagamentos reais, cancelamento de pedidos, devoluções e baixa definitiva de estoque continuam sendo uma evolução separada do fluxo Stripe de teste.
5. Parte da suíte antiga verifica texto de código. Os novos testes comportamentais devem continuar substituindo essas verificações gradualmente.
6. Políticas de retenção e exclusão de mensagens, exercícios de recuperação e rotação de credenciais precisam de rotina operacional própria.

Esta rodada não altera credenciais, não migra bancos de produção e não amplia as permissões de acesso entre empresas.
