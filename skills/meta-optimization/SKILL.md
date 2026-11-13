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

## Escada de funil e economia da conta

O diagnóstico agora percorre as etapas na ordem em que o dinheiro se perde. Só a **primeira etapa abaixo do parâmetro** é apontada como culpada — as seguintes não são julgadas, porque a queda anterior já explica o resultado.

| Etapa | Parâmetro de referência | Queda significa |
| --- | --- | --- |
| Entrega | ≥ 300 impressões no período | amostra insuficiente: não julgar criativo |
| Gancho (3s) | ≥ 25% das impressões iniciam o vídeo | troque a abertura, não a oferta |
| Retenção | ≥ 15% dos que iniciaram chegam ao ThruPlay | encurte ou mostre o produto antes |
| Clique no link | ≥ 1% das impressões | oferta ou clareza do anúncio |
| Resultado | evento de conversa, lead ou compra retornado pela Meta | destino, atendimento ou atribuição |
| Custo por venda | abaixo do limite econômico da conta | cada venda dá prejuízo |

Regras de leitura:
- Métrica ausente é **indisponível**, nunca uma falha. Vídeo sem `video_play_actions` não é "gancho ruim".
- Amostra abaixo de 300 impressões é **limitada**: nenhuma etapa é acusada e nenhuma pausa é recomendada.
- Clique não comprova conversa, lead ou venda. Sem evento de resultado, a escada para em "Resultado" e diz isso.
- Os parâmetros acima são referências de mercado, não garantias da Meta.

### Economia da conta

Com o valor médio de venda (`ticketCents`) e a margem (`marginPercent`) informados pelo proprietário:

- `lucro bruto por venda` = valor da venda × margem
- `custo máximo por venda` = lucro bruto (gastar mais que isso perde dinheiro em toda venda)
- `ROAS de equilíbrio` = 1 ÷ margem
- `alvo` = 80% do custo máximo, salvo alvo informado
- `limite de corte` = alvo × 1,3 (regra prática: 30% acima do alvo)

Sem ticket e margem, **não existe limite econômico** e o Sócio não inventa um. Ele diz que cliques não comprovam vendas e pede os dois números. Nenhuma mutação é autorizada por esta análise.

## Ritmo de acompanhamento

Revisar a conta a cada 6 horas, mas **decidir em janelas de 7 dias**. Dentro do dia, só se age em três casos: entrega zerada, rejeição/política e gasto fora de controle. Fora disso, oscilação diária é ruído.

Antes de qualquer recomendação, verificar:
1. a janela de atribuição configurada e se ela mudou;
2. se a campanha saiu da fase de aprendizado;
3. se houve edição recente que reiniciou o aprendizado;
4. se a amostra do anúncio é suficiente para a afirmação que se pretende fazer.

## Aprendizado e edição

- Uma decisão de orçamento acima de ~20% reinicia o aprendizado. Preferir degraus de 15 a 20% a cada 3 dias quando o objetivo é escalar.
- Mudar público, evento de otimização ou criativo principal também reinicia. Não fazer duas mudanças estruturais ao mesmo tempo: sem uma variável por vez, nada é atribuível.
- Pausar um conjunto em aprendizado por um dia ruim é o erro mais caro. Só pausar com causa objetiva (rejeição, entrega zerada, gasto sem resultado após amostra suficiente).

## Escala e retorno marginal

Orçamento não é linear: dobrar a verba raramente dobra o resultado. O custo por conversa tende a subir em cada degrau porque a Meta passa a buscar públicos menos propensos.

- Escalar em degraus de 15 a 20% com 48 a 72 horas de observação entre eles.
- Se o custo por conversa subir além do limite de corte (alvo × 1,3), recuar o degrau e não continuar subindo.
- Se o custo se mantiver próximo ao alvo após o degrau, repetir.
- Quando o mesmo conjunto já responde por boa parte do volume, testar **duplicar pausado** em vez de empurrar mais verba no mesmo conjunto saturado — mas nunca com orçamento que exija cortar outro conjunto vencedor sem avisar o dono.
- Criar campanha nova só quando existe hipótese nova (público, oferta, criativo ou destino). Recriar a mesma campanha com nome diferente é desperdício de aprendizado.

## Fadiga de criativo

Sinais combinados, nunca um isolado: frequência subindo por vários dias, CTR caindo, custo por conversa subindo, alcance estagnado com impressões crescendo. Ação: novo ângulo criativo no mesmo conjunto; se não resolver em 3 a 5 dias, substituir o anúncio.

## Post-mortem

Quando um teste termina (venceu, perdeu ou foi encerrado), registrar em uma frase: hipótese, resultado, custo por resultado, decisão tomada e o que se aprendeu. O aprendizado vale para a próxima campanha e evita repetir o mesmo teste.

## Honestidade estatística

- Comparar sempre períodos equivalentes (7 dias com 7 dias, mesmo dia da semana).
- Não comparar um dia de pico com a média; não somar janelas sobrepostas de atribuição.
- Não afirmar "melhorou 40%" sem dizer em relação a qual base e com qual amostra.
- Se a Meta reportar conversas e o WhatsApp não confirmar vendas, dizer exatamente isso: conversa ≠ venda.
- Nunca atribuir ao criativo o que pode ser sazonalidade, mudança de orçamento ou alteração de público — se duas variáveis mudaram juntas, não há conclusão.
