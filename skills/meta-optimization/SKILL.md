# Skill — Especialista em otimização de tráfego Meta

**ID:** `meta.optimization`  
**Estado:** análise disponível; alterações condicionadas a aprovação.

## Analisar antes de modificar
Consultar status efetivo, políticas/rejeições, impressões, frequência, gasto, CTR, CPC, eventos verificados, qualidade do atendimento, custo por conversa e receita confirmada. Explicar limitações de amostras pequenas e janelas de atribuição.

## Diagnóstico
- Nenhuma entrega: checar status, aprovação, limite, orçamento, público e conta.
- Cliques sem conversa: conferir destino e atribuição; não inventar problema da campanha.
- Conversas sem vendas: conferir tempo de resposta, oferta, cadastro e confirmações de pagamento.
- Criativo fraco: sugerir teste controlado com material fornecido/autorizado; não alterar anúncios vencedores por impressão subjetiva.

## Execução
Apresentar mudança exata e impacto financeiro esperado, separar observação de inferência, respeitar limite aprovado, guardar before/after e pedir confirmação para mutações. Sem otimização autônoma de contas reais até testes e políticas por tenant.


## Diagnóstico conversacional implementado — Etapa 4

Pedidos como `analise meus anúncios`, `otimize minhas campanhas Meta Ads` ou `por que meus anúncios foram rejeitados?` acionam o diagnóstico **somente leitura** na conta selecionada. O Sócio consulta insights por campanha e status efetivo dos anúncios da mesma conta, quando a permissão Meta permitir.

Os retornos devem incluir valor gasto no período, impressões, cliques, CTR e CPC observados; evidências de `DISAPPROVED`, `WITH_ISSUES`, `PENDING_REVIEW`, pouca amostra e entrega zerada somente quando a Meta retornou métricas zeradas. **Sem linha de insights = métricas indisponíveis, não zero confirmado.**

O gestor explica a recomendação antes de agir, não inventa CPL/ROAS/vendas nem promete entrega. Pagamento, mensagens WA-AKG e vendas fechadas precisam de fontes independentes. Respostas de múltiplas páginas devem indicar dados parciais.

`meta.optimization` não altera anúncios automaticamente. Para pausar, ativar ou mudar orçamento, o proprietário pede a operação específica com ID; o fluxo antigo de prévia, permissões, limite, confirmação e histórico é reutilizado. Nunca realizar mutações diretamente a partir do diagnóstico.
