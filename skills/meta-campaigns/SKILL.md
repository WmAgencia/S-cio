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

## Arquitetura da conta e da campanha

**Uma campanha = um objetivo de negócio.** Não misturar conversas de WhatsApp com tráfego para site na mesma campanha: o objetivo, o evento de otimização e a janela de atribuição são diferentes, e o algoritmo otimiza para o evento declarado.

Orçamento na campanha (CBO, `campaign_budget_optimization`) quando existe **um** objetivo e o dono quer que a Meta distribua o dinheiro entre conjuntos. Orçamento no conjunto quando cada conjunto testa uma hipótese isolada e precisa de verba controlada. Com menos de três conjuntos ativos, CBO raramente ajuda — a distribuição automática só tem o que distribuir.

Estrutura inicial recomendada por orçamento:
- até R$ 20/dia: 1 campanha, 1 conjunto, 3 a 5 anúncios com ângulos diferentes;
- R$ 20 a R$ 60/dia: 1 campanha, 2 conjuntos (amplo + remarketing), 3 anúncios cada;
- acima de R$ 60/dia: separar por objetivo/destino antes de multiplicar conjuntos.

Nunca dividir R$ 6/dia em três conjuntos: cada conjunto recebe ~R$ 2, fica em aprendizado eterno e nenhum acumula 50 resultados/semana.

## Públicos

- **Amplo (broad)** é o padrão para conversas no WhatsApp quando a criatividade tem apelo local claro: a Meta acha o comprador com sinal de conversa. Interesses só entram quando o dono declarou o público ou quando o produto é de nicho (ex.: noivos, gestantes, pet específico).
- **Remarketing** precisa de janela curta e platô: 7 a 14 dias para conversa, 14 a 30 para compra. Público de remarketing saturado encarece porque todos já viram o anúncio; excluir o público de remarketing do conjunto amplo evita canibalização de custo.
- **Exclusões** obrigatórias: compradores/clientes atuais fora do prospecting quando a Meta permitir a lista; público de remarketing fora do amplo quando o conjunto for de aquisição.
- **Sobreposição** acima de ~30% entre conjuntos faz eles competirem no mesmo leilão. Um conjunto amplo + um de remarketing não se sobrepõem por definição.
- Faixa etária e gênero só restringem quando o produto realmente tem essa restrição. Restringir "por precaução" encolhe entrega e não melhora qualidade.
- Não inventar interesse, comportamento ou segmentação por afinidade: só enviar públicos que a API da Meta confirmar que existem e que o dono autorizou.

## Arquitetura de criativos

O criativo é a maior alavanca depois do orçamento. Testar **ângulo** (dor, desejo, prova social, oferta), não variação de cor de botão.

- 3 a 5 anúncios por conjunto no início. Menos que isso não gera aprendizado; mais que isso fragmenta a amostra em orçamento pequeno.
- Cada anúncio deve ter um gancho nos primeiros 3 segundos que nomeie o problema ou o resultado, e um CTA que diga exatamente o próximo passo ("Chamar no WhatsApp", não "Saiba mais" quando o destino é conversa).
- Vídeo vertical 9:16 com som e legenda queimada; imagem só quando não há vídeo, com texto curto e foco no produto.
- Não pausar o anúncio vencedor por preferência estética: só pausar com evidência (custo acima do limite de corte após amostra suficiente).
- Renovar criativo quando a frequência sobe e o CTR cai de forma consistente por 3 dias seguidos, não por um dia ruim.
- Criativos com promessa de preço, desconto, urgência, resultado garantido ou comparação antes/depois exigem confirmação do dono e revisão de política da Meta antes de enviar.

## Fase de aprendizado

A Meta declara uma campanha/conjunto em aprendizado até acumular ~50 otimizações (eventos de resultado) em uma janela recente. Enquanto estiver em aprendizado:

- o custo oscila e ainda não representa performance estável;
- cada edição relevante (orçamento acima de ~20%, público, evento, criativo) reinicia o aprendizado;
- pausar o que está em aprendizado por ansiedade destrói o progresso;
- a resposta correta é manter o conjunto estável e dar tempo/verba para acumular eventos, ou consolidar conjuntos em vez de multiplicar.

Se o orçamento não sustenta 50 eventos/semana, aceitar que o aprendizado será longo e avaliar por tendência de custo por conversa em janelas de 7 dias, nunca por picos diários.

## Nomenclatura

Nomear por objetivo e hipótese, não por data solta: `[Objetivo] · [Produto] · [Público] · [Cidade] · [Hipótese]`. O nome precisa permitir que o dono reconheça a campanha no Gerenciador e que o relatório faça sentido sem abrir cada objeto. Nunca renomear campanhas existentes sem pedido explícito.
