# Sócio — Auditoria de UI, UX e fluxos de negócio (04/11/2026)

## Abrangência e fonte de verdade

Código em \`WmAgencia/S-cio\`, produção em \`https://socio-app-production-762c.up.railway.app/\`.
Revisão de interface: tela de login, sidebar, teclado, overview, cartões do catálogo, edição,
treinamento de IA, simulação, orçamentos, criação/administração de empresas, permissões
por empresa, confirmação de envio WhatsApp e segurança multiempresa.
As cores escuras café/laranja, sombras, botões arredondados, responsividade e preferência
por movimento reduzido foram preservadas.

### Erros reproduzidos e correções

| Área | Diagnóstico | Correção |
| --- | --- | --- |
| Inteligência Artificial | \`$('[data-restore-version]').forEach\` quebrava sem versão arquivada, retornando \`Cannot read properties of null (reading 'forEach')\` | \`$$\` retorna uma lista vazia e não falha |
| Orçamentos | Novos botões \`Preparar\`, \`Concluir\` e \`Arquivar\` inicialmente usavam seletores para apenas um elemento | Listas de botões associadas por \`querySelectorAll\` e testes com pedidos cadastrados |
| Login | Sem feedback de processamento, sem alternar visibilidade da senha nem aviso de Caps Lock | Botões Mostrar/Ocultar, \`aria-busy\`, aviso \`role=status\`, foco no erro, controle de dupla submissão |
| Catálogo com produtos | Listagem tinha pouca informação para comparação e exibia apenas status/preço em destaque | Foto 82px, nome em até 2 linhas, preço, SKU, número de fotos, estoque ou variações e disponibilidade; abrir detalhes via botão acessível |
| Mobile / acessibilidade | Novos painéis e modal careciam de estilos locais | Grade fluida, controles com foco visível, áreas clicáveis, \`prefers-reduced-motion\` e ações flexíveis |
| Empresa sem determinado módulo | Sidebar ocultar não era suficiente: endpoints ainda respondiam | Coluna JSONB por tenant, checks para cada endpoint, permissões efetivas no login e menus filtrados |
| Orçamentos solicitados pela IA | Não havia inbox de intenção e responsáveis precisavam procurar mensagens manualmente | Identificação de intenção em conversa real entregue à IA, fila com cliente, data, mensagem e ações de preparar, concluir ou arquivar |
| Aviso ao dono | Não havia opt-in, nenhuma entrega segura via WhatsApp | Proprietário autoriza no seu próprio perfil, número cadastrado no perfil com DDD, gateway vinculado à empresa, envio de **um único aviso** e estado \`sent\` / \`uncertain\`; sem reenvios ambíguos |
| Orçamentos comerciais | IA não deve gerar proposta com inventário/preço alucinado | Orientação explícita: catálogo aprovado apenas, nenhuma proposta, cobrança ou link enviados automaticamente |

### Administração de funcionalidades por empresa

O administrador master da Consecom, em **Empresas → Nova empresa**, marca:

- **WhatsApp** (conversas e conexão de números)
- **Produtos e serviços** (catálogo, estoque, mídia)
- **Vendas e orçamentos** (requisições, propostas e pedidos)
- **Inteligência Artificial** (treinamento, personalidade e simulação)
- **Meta Ads** (OAuth Pipeboard e leitura de contas)

O padrão sugerido para **novas** empresas é WhatsApp + Produtos + IA; Vendas/Orçamentos
e Meta Ads ficam desligados até seleção, mas podem ser habilitados na criação.
Orçamentos requerem WhatsApp e Produtos; a interface ativa dependências quando habilitado.
**Empresas existentes permanecem com os módulos habilitados por padrão**, para não
quebrar fluxos já usados.

A edição posterior fica no botão **Configurar** de cada empresa. Desativar um módulo
retira-o do menu **e** bloqueia seus endpoints pelo servidor; não deleta produtos,
orçamentos, tokens históricos ou conversas. A administração master e a autenticação
continuam acessíveis para reativar. Não se confunde autorização de usuário com recurso
habilitado da empresa.

### Fluxo de orçamento com IA

1. O cliente manda uma mensagem em uma conversa WhatsApp **real**, já entregue à IA
   e com agente ativado (não há abordagem de contatos novos).
2. O Sócio identifica conservadoramente solicitações de cotação/orçamento e cria
   **uma solicitação por mensagem** no tenant correto. Negativas como "não quero orçamento"
   não entram na fila.
3. A guia **Vendas e orçamentos** mostra a solicitação, permite preencher a
   proposta com **itens, preço e disponibilidade do catálogo**, e mantém a
   aprovação e o envio de link com um humano.
4. Se o dono autenticado habilitar a opção e houver gateway de envio funcionando,
   é tentada **uma única** notificação WhatsApp ao telefone de seu próprio perfil,
   incluindo o nome exibido do cliente e onde revisar a solicitação. Nunca envia
   conteúdo promocional, preço ou mensagem para o cliente neste passo.
5. Sem conexão/autorização ou após desativação, a solicitação continua visível
   no sistema sem afirmar falsamente que o aviso chegou ao WhatsApp.
6. O aviso não informa que o orçamento esteja pronto comercialmente: informa
   que **o pedido** está pronto para o dono preencher e revisar.

**Limites**: o classificador inicial é determinístico por expressões em português,
não um modelo avançado de intenções; poderá exigir ajuste para frases específicas.
Não substitui análise humana nem confirma pedido/venda. O envio externo real depende
de \`SOCIO_OUTBOUND_ENABLED=true\`, WA-AKG autorizado, telefone do proprietário
e seu consentimento explícito. Nenhum envio real foi realizado na auditoria.

### Banco e migração

- PostgreSQL Railway permanece produção e executa DDL aditivo no startup.
- Nova tabela \`quote_requests\` e 3 novas colunas em \`tenants\`.
- Plano de migração futura ao Supabase privado conta agora **38 tabelas**, sem migração
  de dados reais ou troca de \`DATABASE_URL\`. O esquema privado continua fechado aos
  papéis \`anon\` e \`authenticated\` e não contém contas reais.
- Testes verificam isolamento de solicitações/contas, idempotência e bloqueio de
  módulos em APIs. Nenhuma tabela antiga foi excluída.

### Testes e critérios de conclusão

Testes automatizados de UI com DOM simulado, verificações HTTP com PostgreSQL
efêmero, revisão de sintaxe JS, CI GitHub, auditoria de dependências e saúde
dos serviços Railway. O projeto contém testes que criam empresas, alternam
funcionalidades, verificam 403, renderizam catálogo com produto realista, navegam
para IA e renderizam orçamentos pendentes.

**Cobertura não alegada**: navegação gráfica manual em todos os dispositivos,
leitores de tela reais, teste com dezenas de milhares de produtos, fluxo de
envio WhatsApp real ou autorização do proprietário não foram executados. Esses
passos precisam do dispositivo ou titular da conta para homologação operacional.

### Links de inspeção

- Código e PR: repositório \`WmAgencia/S-cio\`
- Produção Railway: \`https://socio-app-production-762c.up.railway.app/\`
