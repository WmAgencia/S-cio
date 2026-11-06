# Ferramentas oficiais de anúncios

Esta etapa adiciona ferramentas vinculadas à conta explicitamente selecionada da empresa. Não depende do conector local e mantém WA-AKG independente.

- Consultas: campanhas, conjuntos, anúncios, imagens, páginas autorizadas para promoção, métricas de sete dias e dados financeiros (gasto acumulado, limite, moeda).
- Imagens: JPG/PNG/WebP até 3 MB; normalização no servidor, envio para a biblioteca da conta Meta e retorno do hash.
- Criação guiada: tráfego para site com página, imagem, texto, título, cidade brasileira e orçamento diário. Cria campanha, conjunto, criativo e anúncio; campanha/conjunto/anúncio são PAUSED. Não atende ainda campanhas de WhatsApp, vendas/conversões, vídeos ou categorias especiais.
- Gestão: preparar e confirmar pausa/ativação, alteração de nome e orçamento diário de conjuntos. Meta pode rejeitar configurações incompatíveis com CBO, categorias e restrições da conta. Ativação e orçamento podem gerar gastos e têm prévia explícita.
- Cobrança: consulta dados disponíveis e abre a área da Meta para adicionar saldo/pagar. Não há débito, armazenamento de cartão nem recarga automática implementados. Gasto acumulado/limite não são saldo pré-pago.

## Proteções

O backend resolve a conta selecionada e revalida a autorização vigente a cada ferramenta. Escritas exigem marketing.manage, ads_management e confirmação de uma prévia salva por usuário/empresa/conta, válida por 15 minutos. O cliente não envia tokens ou nomes de campos arbitrários da Graph API.

Os IDs editados são consultados na Meta para conferir account_id. Página e imagem precisam existir na conta autorizada; a cidade escolhida é conferida por pesquisa de geolocalização. Nenhum campo de cartão ou recarga é enviado pelo executor.

Cada prévia só é executada uma vez com claim atômico. Resultados e IDs parciais são persistidos entre as etapas. Timeout de POST é marcado como uncertain e não é repetido automaticamente. Falha parcial não apaga itens nem declara rollback; o usuário confere os IDs no histórico antes de uma nova operação.

## Validação

Testes com PostgreSQL embarcado cobrem isolamento, permissões, conta estrangeira, ausência de POST ao preparar prévia, confirmação obrigatória, quatro passos pausados, orçamento/geolocalização, alteração de nome, replay idempotente, expiração, POST incerto sem repetição e upload normalizado com retorno de hash. As respostas de campanhas/escritas da Meta nesses testes são simuladas. A CI executa o mesmo cenário em PostgreSQL real.

Não confundir essas verificações com publicação de anúncio real. Validação de produção nesta etapa deve usar consultas e prévias na conta Consecom 262874072312506, escolhida pelo proprietário. Nenhum anúncio deve ser ativado nem orçamento real alterado durante essa homologação.
