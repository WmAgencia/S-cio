# Sócio · Painel simplificado e fluxo master (04/11/2026)

## Navegação e telas

1. **Visão Geral**: indicadores reais e gráfico mantidos; mensagens recebidas **hoje** usa fuso horário de Brasília. O cartão WhatsApp exibe o nome e número de canais cadastrados como conectados, com botão **Conectar WhatsApp**; o QR só surge no popup quando o gateway fornece o código real.
2. **WhatsApp**: é a antiga aba Conversas, com a interface familiar de mensagens, filtros, gestos, atalhos, notas e botão **+ Conectar**, abrindo o mesmo popup. A aba separada *WhatsApps* deixa de aparecer no menu.
3. **Produtos e serviços**: listagem enxuta e botão **+ Novo produto**. Cadastro/edição por popup com nome, descrição, preço, desconto, SKU, disponibilidade/estoque, fotos (até 8) e variações. Os serviços de mídia e catálogos usam os endpoints originais, com isolamento por empresa.
4. **Inteligência Artificial**: mantém **Aprendizado e análises** e **Personalidade e testes**. No aprendizado há **Treinar**, progresso de 0 a 100% por etapas: leitura do histórico disponível nos números conectados e geração de Markdown em rascunho, que requer aprovação humana. A síntese via Grok só acontece se a credencial de xAI estiver configurada.
5. **Equipe**: não aparece para o painel master da Consecom; continua para os proprietários e administradores das empresas atendidas.
6. **Empresas**: master vê apenas a lista e o botão **+ Nova empresa**, que abre popup de cadastro. Preencher CNPJ e **Buscar CNPJ** consulta BrasilAPI no backend (rate-limit, validação, timeout), preenchendo razão social, nome fantasia, endereço, telefone e e-mail comerciais. Responsável, e-mail de login e senha são independentes.

## Provedor da IA

**Grok = xAI, não Groq, nem ChatGPT.** O aplicativo usa `XAI_API_KEY` e opcionalmente `XAI_MODEL` (padrão `grok-4.7`) exclusivamente no backend, via `POST https://api.x.ai/v1/responses`. Nenhuma chave é enviada ao navegador. Sem chave, testes de personalidade exibem indisponibilidade e treinamento gera Markdown analítico determinístico identificado como preliminar, sem falsamente atribuir seu conteúdo ao Grok.

## Histórico e privacidade

O gateway WA-AKG segue read-only; nada nesta entrega habilita resposta automática ou disparos. O início do treinamento exige número conectado e verificado. O job automático inicia scans por canal, aguarda conclusão e chama a análise dos históricos *disponíveis* com Markdown em status `draft`. As limitações existentes **continuam**: até 50 conversas por sessão, até 400 mensagens por conversa no scanner, sem mídias/grupos; a análise base utiliza até 200 conversas importadas. Não se pode afirmar cobertura integral do WhatsApp, taxa de vendas ou conversões confirmadas.

A consulta de CNPJ usa somente campos empresariais públicos. Não coleta quadro societário, CPF nem dados privados; só master pode consultar. A criação de tenant ainda exige confirmação do responsável. Dados de empresas permanecem separados no banco de produção do Sócio.

## Operação e deploy

O projeto é `WmAgencia/S-cio` no Railway `socio-consecom` e não toca no Prospector. As novas migrações são aditivas; a produção ainda usa seu PostgreSQL configurado em `DATABASE_URL`. Não confundir com um cutover para Supabase, que exigiria migração de dados validada e operação separada. 

Limitações e falhas de integração externa (WA-AKG, BrasilAPI, xAI) são apresentadas na UI sem inventar sucesso. Testes de regressão cobrem consulta protegida, pipeline e as rotas de conteúdo das janelas.
