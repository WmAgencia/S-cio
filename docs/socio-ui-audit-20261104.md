# Auditoria de interface, módulos por empresa e pedidos de orçamento — Sócio

Data: 04/11/2026. Projeto: `WmAgencia/S-cio`. Produção no Railway PostgreSQL.

## Escopo e metodologia

Auditoria do código de HTML, CSS, JavaScript e rotas, inspeção de formulários,
permissões de acesso, estados vazios e com dados, simulação de navegação e testes
PostgreSQL descartáveis de fluxos completos. Cenários cobrem login, cadastro
de empresa, switching multiempresa, catálogo com produtos, variações, fotos e
sem estoque, orçamentos, aviso ao proprietário, Meta Ads, WhatsApp e IA.

**Limitação:** os testes simulados de UI NÃO substituem screenshots reais
de navegador autenticado com cada tamanho de tela/dispositivo. Sem contas
reais consentidas, não é possível validar entregas de WhatsApp e autorização
real do Meta Ads em produção. Não reivindicar que todo botão foi clicado em
um navegador real; regressões de layout visual ainda requerem homologação.

## Alterações implementadas

| Área | Falha / lacuna | Correção |
|---|---|---|
| Login | Sem estado de carregamento; envio repetido; senha sempre escondida | Botão de mostrar/ocultar senha, alerta de Caps Lock, estado busy e teclado, foco visível |
| Cadastro de empresa | Todas as empresas recebiam as mesmas funcionalidades | Checklist de 6 módulos na criação; dependências de orçamento explicitadas |
| Edição de empresa | Funcionalidades não podiam ser alteradas após cadastro | Ação "Funcionalidades" na lista master, janela modal com foco/ESC/Tab e salvamento |
| Permissões | Esconder menu não era suficiente para limitar plano | Lista de permissões efetivas em `/api/me` e bloqueio de rotas no servidor |
| Catálogo | Estados com foto, sem foto, em estoque e sem estoque pouco cobertos em testes | Simulação automatizada de catálogo preenchido, sanitização de nomes, foco e organização no mobile |
| Orçamentos | Pedidos de clientes recebidos por WhatsApp não apareciam numa fila de revisão | `quote_requests` idempotentes por mensagem, cartões de pedidos e ações "Preparar" / "Resolvido" |
| IA comercial | Prompt não especificava limites de criação de orçamento | Instruções claras para encaminhar ao humano, sem inventar valores ou afirmar envios não confirmados |
| Dono no WhatsApp | Sem mecanismo de aviso autorizado | Opção explícita do proprietário, exige celular e canal conectado, gateway com envio liberado; status não-confirmado não é reenviado |
| Trabalhos em segundo plano | Worker de WhatsApp/IA ignorava desativação de módulo | Filtro por tenant para sincronização, escaneamento, treinamento e IA |
| Meta Ads | Funcionalidade pode não fazer sentido para parte dos clientes | Meta Ads disponível apenas nos tenants que o master habilitar; OAuth continua separado por empresa |

## Configuração por cliente

Chaves de funcionalidade:

- `whatsapp`: caixa de entrada e canais WA-AKG
- `catalog`: produtos, variantes, imagens e estoque
- `quotes`: orçamentos, pedidos e fila de solicitações (depende de WhatsApp e catálogo)
- `meta_ads`: painel de conexão e leitura via Pipeboard
- `ai`: agente e treinamento (desabilita workers)
- `team`: equipe e gestão de permissões

O proprietário master seleciona os módulos ao criar uma empresa e pode mudar
depois. Empresas anteriores preservam todas as funcionalidades, sem exclusão
de dados. Um módulo desabilitado permanece como registro no banco, mas sua API
é recusada. Alterações são auditadas.

## Pedido de orçamento: fluxo verificado

1. Cliente envia uma mensagem pedindo orçamento ao número WhatsApp da empresa.
2. O worker analisa apenas mensagens recebidas recentes e cria uma solicitação
   única por mensagem, isolada por empresa. Ignora recusas e mensagens sem intenção.
3. A área **Vendas e orçamentos** mostra pedidos pendentes, cliente,
   resumo da solicitação e botão **Preparar orçamento**.
4. O operador seleciona produtos e quantidades do catálogo, valida estoque e
   prepara um rascunho. A IA não define preços nem dispara links.
5. Após revisão humana, o operador emite um link de aprovação que pode ser
   compartilhado com o cliente em canal autorizado.
6. Opcionalmente, se o **proprietário** tiver optado por alertas e o ambiente
   tiver gateway de saída autorizado, o Sócio envia uma única notificação ao
   celular cadastrado do proprietário, pelo WhatsApp conectado da empresa.
7. Respostas de envio ambíguas viram `unconfirmed` e nunca são reenviadas
   automaticamente, reduzindo o risco de mensagem duplicada.

**Importantíssimo:** o registro de solicitações no painel funciona
independentemente da integração de saída. Os alertas não estão ativados por
padrão e não são prometidos até uma conexão real autorizada. Nenhum orçamento,
preço ou pagamento é enviado ou cobrado automaticamente.

## Salvaguardas

- CSRF e sessão para alterações do master e da empresa.
- `tenant_id` e FKs compostas para pedidos e mensagens.
- Idempotência de solicitação pelo ID de mensagem recebida.
- A seleção de funcionalidades não depende apenas de CSS; a API faz o bloqueio.
- Guardrails mantêm atendimento por IA apenas em conversas explicitamente
  entregues ao agente; saídas de WhatsApp dependem do controle global de envio.
- O registro de alertas só considera solicitações criadas após o opt-in;
  solicitações antigas não são disparadas ao aderir.
- A única plataforma de anúncios permanece **Meta Ads**.
- Histórico de orçamentos ou produtos não é apagado ao desativar módulos.

## Homologação pendente e infraestrutura

- **Navegador real**: conferir desktop 1440/1280, tablets e smartphones
  390/360 px com contas autorizadas e produtos reais (a suíte atual simula DOM).
- **WhatsApp real**: testar uma solicitação autorizada por proprietário com
  celular conhecido e WA-AKG em ambiente de homologação; não foi enviada
  nenhuma mensagem de produção durante a auditoria.
- **Meta Ads real**: confirmar leitura de conta somente após consentimento
  Pipeboard pelo titular.
- **Supabase de preparação**: existe uma tabela `socio_app.quote_requests`
  com formato divergente do novo modelo no PostgreSQL Railway; embora o
  schema seja privado e sem tenants, NÃO executar migração de produção
  para ele antes de conciliar diferenças. O Sócio continua em produção no
  PostgreSQL Railway.

## Critério de publicação

GitHub Actions deve validar sintaxe, testes de contrato, HTTP, banco
descartável, proteção de plataforma e auditoria npm; o deploy Railway deve
ficar em **SUCCESS**, com os serviços e workers saudáveis. Não declarar
homologação visual real ou envio de WhatsApp se não tiver ocorrido.
