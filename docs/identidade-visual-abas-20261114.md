# Identidade visual das abas do Sócio

O painel aprovado serve como referência para todas as demais abas. A adaptação mantém a navegação e as operações existentes, com foco em materiais, hierarquia, legibilidade e consistência.

## Direção aplicada

- Fundo azul-marinho e superfícies de carvão, cantos arredondados, bordas discretas e detalhes em lavanda.
- Ações principais em gradiente menta/lima com texto escuro; ações secundárias com fundo violeta escuro e texto claro.
- Campos escuros, rótulos claros, estados de foco visíveis e filtros em cápsulas. Estados positivos, pendentes e de erro mantêm cores distintas.
- Mesma tipografia e espaçamento para títulos, descrições, formulários, tabelas, estados vazios e janelas de edição.
- Visibilidade funcional preservada: uma camada específica garante que `[hidden]` e `.hidden` não sejam sobrescritos por estilos de botões. Controles de conexão aparecem somente quando o fluxo correspondente os habilita.
- Quando o provedor não fornece miniatura, o aviso e o botão de vídeo ficam separados, sem textos sobrepostos.

## Áreas abrangidas

- WhatsApp: lista e filtros, conversa aberta, mensagens recebidas/enviadas, notas internas, compositor e detalhes.
- Catálogo: produtos cadastrados, formulário de novo produto, edição, variações, fotos, entrada por voz e associação de campanha.
- Meta Ads: métricas, campanhas, conjuntos de anúncios, criativos, filtros, tabelas e ações já existentes.
- Conexões: cartões de provedores e superfícies de conexão; imagens de QR preservam a área branca necessária à leitura.
- Inteligência artificial: treinamento guiado, importação, personalidade e simulador, criação de imagens.
- Conversa com IA: canvas do orbe, transcrição, compositor e painel de execução.
- Equipe e conta: tabela, convite, permissões, dados de acesso e senha.
- Master: dashboard, empresas, planos, métricas e janelas de cadastro/configuração.
- Busca por comandos, modais compartilhados e materiais do painel da assistente.

## Implementação e limites

As regras estão na seção “Full workspace identity” de `public/socio-reference.css`. As regras de componentes operacionais excluem a visão geral aprovada. As rotas, permissões, APIs e manipuladores de eventos existentes foram preservados. Os testes visuais usam o HTML e os scripts reais com respostas de API simuladas, sem chamadas de escrita a provedores externos.

O checkout já continha trabalho de outra sessão. Nenhuma alteração existente foi descartada; esta etapa continua local e não publica essas mudanças em conjunto.

## Evidências

Em `E:\auditoria-socio`:

- `ethereal-pages-review.cjs`: navegação real e abertura de subtelas com dados demonstrativos.
- `ethereal-contrast-check.cjs`: leitura das amostras de contraste e falhas de layout.
- `ethereal-pages-suite.log`: suíte automatizada, 737 testes contabilizados, 703 aprovados, zero falhas e 34 pulados por pré-requisitos do ambiente.
- Capturas e resultados JSON com prefixo `ethereal-verified-` registram a validação final em desktop, notebook e celular.

Resultado final: **22 telas/estados × 3 larguras (1440, 1100 e 390px), 66 renderizações**. As **3.757 amostras de texto** passaram nas verificações de contraste (4,5:1 para texto normal e 3:1 para texto grande). Não houve erro JavaScript, overflow horizontal, item visível da navegação cortado ou controle com `[hidden]` aparecendo.

As interações reais no navegador incluíram abertura de produto novo/edição, convite de equipe, três abas da IA, voltar à lista e abrir conversa no celular, campanha → conjunto → anúncio, abertura da edição de orçamento, busca por comandos e cadastro de empresa Master. Não foram confirmadas mudanças publicitárias nem enviados cadastros ou mensagens a serviços reais.

Os nove controles do painel aprovado foram testados novamente após as alterações, incluindo filtros independentes e personalizados, recomendações e abertura da conversa correta; todos passaram. A checagem final direcionada executou 14 testes sem falhas nem testes pulados. `git diff --check` também passou.

As medições verificam os elementos e estados capturados; não constituem certificação completa de acessibilidade nem comprovação de integração real com provedores.
