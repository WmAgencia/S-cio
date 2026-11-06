# Sócio — Etapa 1: consolidação e estabilidade (06/11/2026)

## Ponto de partida confirmado

- `main` antes desta entrega: `9fc0e6647502a7e05ddca4932be0fbdc05f9f134`.
- Railway `socio-app`: versão acima publicada com status `SUCCESS`; oito serviços do projeto apresentam último deploy `SUCCESS` no momento da verificação.
- CI principal anterior: `194` testes passaram; nenhum teste falhou.
- Banco PostgreSQL iniciado por `schema.sql`, preservando tenant, roles, índices e constraints existentes.
- WA-AKG segue como gateway de WhatsApp. NÃO trocar pela WhatsApp Cloud API oficial.
- A Marketing API oficial já existe para Meta Ads. Os comandos proprietários WA-AKG e os workers de relatórios e atribuição permanecem opt-in.

## Integração feita na etapa 1

- Portado com segurança da PR #46 o **manual comercial global sem informações de clientes**, acrescentando-o ao prompt de atendimento e respectivos testes.
- A metodologia global é orientação, jamais autorização para transações, mensagens não solicitadas, promoções ou uso de informações de outra empresa.
- Não foi reutilizado nenhum banco, token, sessão WhatsApp, preço, contato ou segredo do Prospector.
- Validações de integração, segurança do isolamento por empresa, permissões, e módulos centrais continuam protegidas pela suíte de testes.

## Triagem das PRs anteriores — nenhum merge cego

| PR | Estado em relação à main atual | Encaminhamento |
| --- | --- | --- |
| #24 Botões WA-AKG/fotos | Conflito (`dirty`), exige validação física do gateway e aprovação de quick-reply | Reservar para etapa 3; não ativar ou copiar patch do gateway sem teste |
| #25 Treinamento verificável | Conflito (`dirty`) com novas rotas/UX | Portar seletivamente na etapa 6, com controle de versões e privacidade |
| #39 UI, módulos, orçamentos | Conflito (`dirty`); muitos componentes já existem na `main` sob implementação posterior | Comparar funcionalidades e portar diferenças legítimas sem sobrescrever app.js/server/schema |
| #46 Guia comercial Prospector | Mergeable, PR antiga; portados os quatro elementos de código e testes relevantes em branch recente, sem trazer alterações obsoletas | Revisar esta PR de consolidação e fechar a antiga só após validação |
| #50 Entrevista guiada, provas sociais, regras comerciais | Conflito (`dirty`), grande mudança sobre versões antigas do backend e do painel | Revisar por módulos na etapa 6; não mesclar 28 arquivos em produção sem rebase/teste |

## Restrições preservadas

1. Nenhuma alteração automática em campanhas ativas ou orçamento de contas Meta.
2. Criação de campanhas pela skill exige consentimento e cria itens PAUSADOS.
3. Apenas owner/admin autorizados da própria empresa podem solicitar ações de marketing; token oficial fica no servidor.
4. Só comandos privados de número de proprietário autenticado passam pelo bridge WA-AKG **se explicitamente habilitado**. Grupos, voz e fotos de WhatsApp ainda não foram homologados.
5. A criação de um Pixel não instala CAPI nem eventos no site; compras só são confirmadas por webhook de pagamento válido.
6. O guia global não substitui catálogo/Markdown da empresa nem autoriza saída automática.

## Critérios de aceitação desta etapa (código)

- CI completo aprovado (Node + PostgreSQL + testes browser existentes + worker de backup).
- Nenhuma regressão nos contratos de tenant, autenticação, módulos e workers opt-in.
- Deploy concluído no Railway com `SUCCESS` e log de servidor iniciado, sem alterar o WA-AKG.
- Auditoria de PRs documentada com destino seguro para funcionalidades ainda não homologadas.

## Limitação conhecida para go-live comercial

Este checklist não certifica um fluxo de WhatsApp, cobrança ou Meta real. Para homologação ponta a ponta serão necessários número/sessão WA-AKG real, conta Meta autenticada, duas empresas de teste e interação pelo navegador mobile/desktop. Essas validações fazem parte das próximas etapas e não devem ser declaradas concluídas antes de ocorrerem.
