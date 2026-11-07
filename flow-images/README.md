# Google Flow — integração Sócio

Tela: Inteligência Artificial → Criar imagens. Apenas prompt, Nano Banana 2.1 fixo, x1. Sem vídeo ou escolha de modelo.

Publicação do módulo não significa geração autenticada validada. A tela consulta `/api/flow/status` e mantém o envio desabilitado sem a especificação instalada. Os endpoints usam sessão, CSRF, `training.manage` e a funcionalidade `ai`. A conta Google é compartilhada, mas cada job tem proprietário em `flow_image_jobs`; consultas e downloads exigem o tenant da sessão. A chave interna do serviço nunca chega ao frontend.

O worker Node é isolado do processo principal e dos perfis Meta, sem credenciais de Postgres, Meta, Stripe ou WA-AKG no ambiente. Escuta somente loopback e recebe uma chave efêmera por processo. Usa o pacote `api-anything` já existente no projeto. Persistência no volume atual em `<SOCIO_META_BROWSER_DIR>/flow-owner`: `jobs.sqlite`, `flow-binding.json` e a pasta `api-anything`. Não comitar esses arquivos. Apenas uma réplica/worker deve possuir essa pasta.

O código de fila, download e adaptação vem do serviço Flow Images preparado nesta conversa. Imagens são verificadas e salvas antes do sucesso; o endpoint protegido `/api/flow/images/{id}/content` devolve bytes PNG/JPEG/WebP. Não há imagem fictícia ou reenvio automático após envio incerto.

## Ativação ainda pendente

No servidor que possui este volume e o Chromium, autenticar a conta Google proprietária no perfil dedicado do api-anything, capturar e validar uma operação `flow.google.com/generateImage`, classificada como escrita e com somente `prompt` parametrizado. Modelo Nano Banana 2.1, x1 e a receita de resultado precisam ser verificados na captura real. A operação deve devolver exatamente uma imagem em `url` ou `b64_json`; aceite ou ID de operação não equivalem a imagem. Se houver job assíncrono no Google, sua consulta terá de ser mapeada antes de ativar a receita.

O arquivo de aprovação `flow-binding.json` contém `site: flow.google.com`, `op: generateImage`, `model: Nano Banana 2.1`, `outputs: 1` e `specSha256` calculado com SHA-256 de `JSON.stringify(loadSite('flow.google.com').site)`. Deve ser criado somente após uma geração real confirmada. A autenticação deve usar a mesma chave de criptografia derivada em `runtime.mjs` e o mesmo `API_ANYTHING_HOME` do worker. Não colocar tokens/cookies na especificação nem no código. Mudanças na especificação invalidam o hash e bloqueiam novos envios.

Depois da captura, conferir status, criar uma imagem pelo Sócio, verificar conteúdo baixável e comparar o resultado ao prompt. Um status ready significa apenas especificação aprovada instalada, não consulta da cota ou validação da sessão em tempo real.

Testes: `npm test`; `tests/flow-images.test.mjs` cobre escopo de tenant, rejeição de modelo extra, reescrita de URLs e boot real do worker recusando pedidos antes da captura. Os testes não geram imagens no Google.

Conexão do administrador: Inteligência Artificial → Criar imagens → Conectar minha conta Google. As rotas /api/flow/browser/* exigem platform_owner, sessão e CSRF; responsáveis de empresas clientes não podem ver a tela nem enviar teclas. Chromium usa contexto efêmero, com estado Google salvo somente por saveSession criptografado, sem perfil em texto simples. Conectar a conta não valida a geração.
