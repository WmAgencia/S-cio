# Ampliação da integração Meta Ads — 07/11/2026

## Objetivo e decisões
Ampliar a API oficial existente do Sócio sem recriar uma sidebar de ferramentas avançadas. Usar os mesmos grants cifrados, conta selecionada e separação de empresas. Não criar cobrança, alterar crédito empresarial ou fazer POST real em testes.

## Alternativas de saldo e Pix pesquisadas
1. API pública oficial: consulta campos financeiros autorizados. Não foi encontrada operação pública documentada para emissão de Pix de recarga nesta integração. Um link para faturamento não equivale a Pix gerado.
2. Fluxo autenticado no faturamento Meta: a conta Consecom ofereceu Pix em Adicionar fundos durante a verificação anterior. Pode ser operado em sessão assistida, sujeito a autenticação, seleção de valor e confirmação. Não é um endpoint de SaaS independente.
3. Recursos ExtendedCredit/atribuição de crédito: existem objetos no SDK oficial; isso não prova elegibilidade da empresa nem emissão Pix para conta pré-paga. Não ativados e não apresentados como solução comprovada.
4. Provedor/parceiro: exigir prova de operação com o ID da conta beneficiária, contrato, documentação de reconciliação e suporte. Não foi validado parceiro que entregue esse fluxo.
5. Descrição funding_source_details.display_string: há relatos de saldo nesse texto. Formato não é contrato numérico estável. Não promover texto parseado a saldo financeiro confirmado; investigar em conta autorizada e exibir origem/confiabilidade, caso utilizado futuramente.
6. Stripe/Pix próprio da Consecom: recebimento não recarrega automaticamente a Meta; não pode ser anunciado como pagamento direto à plataforma.

A ausência de um endpoint encontrado não prova impossibilidade absoluta em programas privados. Nenhum desses caminhos foi declarado Pix pronto.

## Entrega deste pacote
O catálogo de leituras avançadas cresce de 8 para 16 operações:
| Identificador novo | Conteúdo | Fonte Graph da conta |
|---|---|---|
| activity | histórico de alterações | activities |
| labels | etiquetas | adlabels |
| rules | regras automáticas existentes | adrules_library |
| delivery | estados efetivos e problemas | ads |
| budget_report | orçamento diário/total e verba da campanha | campaigns |
| video_report | reproduções e quartis de vídeo | insights, nível anúncio |
| conversion_report | ações, valores e ROAS atribuídos | insights |
| creative_report | desempenho por anúncio | insights, nível anúncio |

GET /api/marketing/advanced/:identificador; catálogo GET /api/marketing/advanced/catalog.
As novas leituras aceitam cursor after validado. Não seguem URLs paging.next retornadas pelo provedor. Relatórios paginados resumem apenas a página consultada; não equivalem ao total de toda a conta.
Os nomes e problemas retornados dependem das permissões concedidas pela Meta. Erro não é convertido em lista vazia. Orçamento restante de campanha não é saldo da carteira.
Comandos de consulta em português reutilizam o executor de leitura. Não criam/desativam regras, etiquetas ou contas.

## Próximos grupos (ainda não implementados neste pacote)
- Escritas supervisionadas: duplicação pausada, agendamentos, públicos, regras e criativos de vídeo.
- Relatórios: exportação CSV, comparação entre períodos e consultas assíncronas para grandes contas.
- Financeiro: monitoramento/alertas da issue #92, validação de saldo por conta, reconciliação verificável e estudo de sessão assistida de recarga.

## Validação
Testes de integração com Meta simulada: isolamento da conta, escopos, apenas GET, paginação, rejeição de cursor malicioso, resposta inválida e intenção da IA.
CI completa obrigatória antes de merge/deploy. Leituras reais de cada ferramenta nova ainda precisam de homologação; não confundir testes simulados com autorização real da Meta.

## Referências primárias
- https://github.com/meta/facebook-php-business-sdk/blob/main/src/FacebookAds/Object/AdAccount.php
- https://github.com/meta/facebook-php-business-sdk/blob/main/src/FacebookAds/Object/ExtendedCredit.php
- https://github.com/meta/facebook-python-business-sdk
