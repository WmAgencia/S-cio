# Painel Sócio — referência Ethereal

Pedido: reproduzir a composição da imagem enviada pelo usuário, substituindo os dados bancários pelas funções do Sócio. Referência original: https://dribbble.com/shots/23618103-Ethereal-Finance-Managment-Software.

## Implementação

- Nova camada `public/socio-reference.css`, carregada por último e liberada na rota pública de arquivos estáticos. Preserva as camadas existentes usadas por outras telas.
- Moldura arredondada sobre fundo lavanda discreto, canvas preto/azul, navegação superior compacta, cartão de faturamento ciano/lima com facetas diagonais.
- Proporções de desktop: faturamento à esquerda, leads e campanha empilhados ao centro, pilha de recomendações na coluna direita acima das conversas. Gráfico e despesas dividem a largura restante na linha inferior.
- Coluna direita com superfície contínua. Barras lilás com cantos arredondados, rosca em amarelo/rosa, sem controles mensais no gráfico de seis meses.
- Layout se reorganiza em telas menores sem recortar os filtros nem as ações. Movimento reduzido respeita a preferência do sistema.

## Comportamento

- Faturamento, quantidade de vendas, leads e classificação da campanha compartilham o período escolhido. Despesas preservam seu filtro independente.
- Conversas mostram WhatsApp com IA, em ordem da última mensagem. Abrir recebe o ID exato da conversa.
- Conversão contabiliza eventos Purchase recebidos da Meta sem somar aliases duplicados.
- Responder uma recomendação retira o cartão da pilha; recomendações já respondidas não reaparecem ao terminar a fila. Uma resposta atrasada não reabre o painel após navegação.
- Três testes comportamentais novos executam a renderização e os callbacks reais do módulo.

## Validação visual e funcional

Capturas de navegador em 1440, 1100 e 390 pixels usam o HTML, CSS e renderização reais com dados de demonstração. Nenhum dado demonstrativo foi incorporado ao produto. Os testes não enviam mensagens nem executam mudanças publicitárias reais.

Artefatos locais em `E:\auditoria-socio`:

- `reference-final-1440.png`, `reference-final-1100.png`, `reference-final-390.png`.
- `reference-browser.log`: geometria dos cartões e ausência de overflow horizontal.
- `reference-controls.log`: nove verificações no navegador, incluindo filtros personalizados, independência dos períodos, rejeição com avanço da pilha e abertura da conversa correta.
- `reference-suite-final.log`: resultado da suíte completa.
- `reference-preview.cjs` e `reference-controls.cjs`: reprodução das capturas e interações.

As capturas demonstram a adaptação funcional da referência. Textos, dados e ações são os solicitados para o Sócio; não se trata de igualdade de pixels com o dashboard bancário original. A autenticação real dos provedores e campanhas reais não é comprovada por estes testes simulados.

As alterações são locais. O checkout já continha mudanças extensas de outra sessão; elas foram preservadas e não foram publicadas em conjunto por esta tarefa.

Processo: revisão visual e funcional por dois agentes, com orientação das skills `using-superpowers`, `brainstorming` e `verification-before-completion`, obtidas do repositório oficial obra/superpowers. O usuário já havia dispensado perguntas e autorizado a execução autônoma.

## Complemento — contraste e centralização

Após o retorno do usuário, foram corrigidos:

- Navegação superior sem cortes: todos os destinos cabem ou se reorganizam; seletor Produção/Master mantém os dois botões completos, inclusive no celular.
- Textos do status das recomendações maiores, centralizados e com cores legíveis. Cartões atrás não expõem ações/status sobrepostos. Fundo do cartão frontal mais escuro para dar contraste ao texto branco.
- Miniatura ausente identificada por ícone e texto “Sem prévia”, sem inventar uma imagem de campanha.
- Avisos inferiores centralizados e legíveis; controles, legendas e mensagens com tipografia maior.
- Títulos sobre o canvas escuro claros, com títulos escuros preservados nos formulários/tabelas brancos e no ambiente Master. Inclui os cabeçalhos específicos de treinamento e o estado vazio do WhatsApp.

Validação final: 11 páginas (catálogo, conta, equipe, IA, WhatsApp, Meta Ads, conexões, conversa com IA, dashboard Master, empresas e planos Master), cada uma em 1440, 1100 e 390 pixels. Nas 33 renderizações não houve erro JavaScript, overflow horizontal nem item visível da navegação parcialmente cortado. Foram medidos 261 exemplos de títulos, rótulos e descrições; todos alcançaram contraste mínimo de 4,5:1. Isso verifica os elementos e estados capturados, não equivale a uma certificação completa de acessibilidade.

O painel com dados demonstrativos foi revisto nas mesmas três larguras, com nove verificações de interação aprovadas. Suíte: 737 testes contabilizados, 703 aprovados, zero falhas e 34 pulados por pré-requisitos de ambiente. `git diff --check` sem erros. A alteração continua local, sem publicação.

Evidências locais: `all-pages-final1440.json`, `all-pages-final1100.json`, `all-pages-final390.json`, capturas `all-pages-<página>-final<largura>.png`, `contrast-suite.log`, `contrast-controls.log`, `contrast-dashboard.log` e `reference-contrast-final-1440.png`, em `E:\auditoria-socio`.
