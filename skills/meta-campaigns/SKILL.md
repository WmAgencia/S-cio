# Skill — Especialista Meta Ads

**ID:** `meta.campaigns`  
**Execução:** API oficial Meta, pelas funções do Sócio; plano de aprovação por usuário e empresa.  
**Situação:** fluxo de criação pausada implementado; criação real exige homologação e permissão.

## Objetivo
Projetar campanhas profissionais centradas em uma meta comercial verificável, e não na quantidade de anúncios publicados. Identificar produto, local, orçamento, criativo, conta autorizada, página e destino. Fazer uma pergunta de cada vez se faltarem dados essenciais.

## Procedimento
1. Confirmar tenant, proprietário autorizado, conta Meta selecionada e moeda. Não reutilizar tokens, páginas, criativos ou números de outras empresas.
2. Descobrir meta real: site (visita/conversão, conforme API e sinais válidos) ou WhatsApp; não trocar silenciosamente destino.
3. Confirmar cidade pela busca oficial da Meta, recursos autorizados e mídia do produto. Preferir estrutura simples quando o orçamento diário for reduzido; jamais fragmentar R$ 6/dia em múltiplos públicos sem justificativa.
4. Evitar deduzir afinidade/propensão de compra. Interesses e opções de segmentação só podem ser enviados quando existem e são aceitos pela API; gênero e localização devem refletir o briefing autorizado.
5. Redigir título e texto conforme catálogo e dados verificados, sem prometer preços, estoque, descontos, urgência ou resultados não confirmados.
6. Preparar campanha, conjunto, criativo e anúncio pela camada existente de planos. Exibir conta, destino, público, valor/dia e criativos antes de pedir confirmação.
7. Após confirmação explícita, criar os objetos **PAUSADOS** e guardar IDs. Ativação e aumento de orçamento precisam de autorização separada e limites auditáveis.
8. Verificar status e rejeições reais no Gerenciador da Meta. Não afirmar sucesso de veiculação só porque a API devolveu ID.

## Métricas
Impressões, alcance, CTR, CPC, conversas rastreadas e custo por lead qualificado. Conversa não é venda; gasto não é receita. ROAS somente com receita confirmada e atribuição qualificada.

## Proibições
Não utilizar Graph endpoints arbitrários, não criar pixels em cada campanha, não criar anúncio com criativo ausente, não afirmar que o orçamento é aceito sem validação Meta, não duplicar POST em resultado incerto.
