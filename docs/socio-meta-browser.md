# Meta Ads no Sócio sem app Meta

> O fluxo principal foi substituído pelo [conector local Windows](socio-meta-local.md). Este documento descreve o backend remoto legado, ainda disponível para diagnóstico. Ele não é mais exibido na tela principal de Meta Ads.

A seção Meta Ads usa `api-anything@0.4.0` e Chromium remoto. Não exige App ID, App Secret, OAuth ou token da Marketing API. As integrações antigas ficam preservadas no backend, mas o fluxo principal da tela agora usa a sessão de navegador.

O usuário autenticado clica em **Conectar Facebook**, entra na página real da Meta exibida remotamente, conclui verificações e clica em **Concluí o login: salvar sessão**. A interface explica que teclas e cliques passam pelo servidor do Sócio. Não há armazenamento de senha nem registro do conteúdo digitado em logs/auditoria.

Cada perfil pertence à combinação de empresa ativa e usuário. O servidor deriva essa combinação da sessão Sócio, nunca de um tenant ou profile ID enviado pelo frontend. Os endpoints exigem `marketing.read` ou `marketing.manage`, módulo `meta_ads` habilitado, validação de empresa pausada e CSRF já existentes. Desconectar revoga o vínculo; uma nova conexão gera outro perfil.

## Execução

O serviço usa o segredo `CHANNEL_ENCRYPTION_KEY` já existente. Novas variáveis:

```text
SOCIO_META_BROWSER_ENABLED=true
SOCIO_META_BROWSER_DIR=/data/meta-browser
SOCIO_META_BROWSER_MAX_WORKERS=2
SOCIO_META_BROWSER_ALLOW_WRITES=false
```

Para Railway, use `RAILWAY_DOCKERFILE_PATH=meta-browser/Dockerfile` somente no serviço `socio-app`, e um volume novo em `/data/meta-browser`. O Dockerfile inclui Node 24, Chromium e bibliotecas necessárias. O entrypoint prepara a pasta de volume e executa o serviço como usuário `node`. O sandbox Chromium fica habilitado por padrão em Linux; se a infraestrutura não suporta namespaces de usuário, a configuração explícita `SOCIO_META_BROWSER_SANDBOX=false` executa o Chromium sob o isolamento do contêiner, sem o sandbox do Chromium.

O serviço usa um processo Node e `API_ANYTHING_HOME` por perfil ativo. Os processos filhos recebem somente variáveis necessárias ao sistema/navegador e sua chave derivada, sem DATABASE_URL, Groq, S3, credenciais master ou o segredo principal. A sessão api-anything é cifrada. O perfil Chromium é sensível e deve ficar em volume protegido. O serviço não usa nem modifica o navegador pessoal do operador e não publica cookies ou receitas no catálogo.

O limite inicial de dois processos protege os recursos do app. Se houver concorrência maior, dimensione CPU/RAM e separe o runtime em serviço dedicado antes de aumentar o limite. O volume exige uma única réplica do app; esta versão não distribui um mesmo perfil entre réplicas. Os perfis não são apagados automaticamente ao desconectar, para permitir política de retenção e diagnóstico; o operador deve controlar sua limpeza e backups.

## API autenticada

Prefixo `/api/marketing/browser/`:

- `GET status`: configuração, sessão presente e operações aprendidas.
- `POST open`, `GET screen`, `POST input`, `POST finish`, `POST close`: navegador remoto.
- `POST disconnect`: revogação da própria conexão.
- `POST plan`: `{operation,args}` para uma operação aprendida.
- `POST execute`: `{plan_id,allow_writes}`, com `Idempotency-Key`.

Os cookies Meta não são enviados ao frontend. As imagens são respostas privadas sem cache, não arquivos salvos pelo gateway. O controle da tela foi preparado para desktop; teclado virtual de celular e composição de texto ainda não estão validados.

Planos ficam em memória por cinco minutos e são de uso único. Alterações exigem a variável de escrita habilitada e revisão/decisão explícita do usuário. O ledger em PostgreSQL persiste antes de executar e separa perfis, empresas e usuários. Um resultado pendente ou incerto não é reenviado automaticamente. A execução atual usa replay HTTP (`maxTier=1`), sem cliques automáticos de fallback.

## Aprendizado e limites

A presença dos cookies de login não comprova acesso válido aos anúncios. Cada perfil começa sem operações. Campanhas, relatórios, mídia, pixels e recargas não são anunciados como disponíveis antes de captura e validação autenticadas.

Depois de salvar a sessão e fechar o navegador interativo, o operador pode selecionar o ID do perfil em `meta_browser_connections` e usar:

```sh
node scripts/socio-meta-browser-learn.mjs ID_DO_PERFIL capture https://adsmanager.facebook.com --write --outline
node scripts/socio-meta-browser-learn.mjs ID_DO_PERFIL inspect ID_DA_CAPTURA --outline
node scripts/socio-meta-browser-learn.mjs ID_DO_PERFIL add --help
```

Nome local do site: `adsmanager.facebook.com`. Para alterações, use `capture --write` e `add --write`; isso intercepta requisições durante aprendizado. Não compartilhe receitas entre clientes sem revisar ativos fixos, exemplos privados e referências de sessão. Não há distribuição automática de receitas nesta versão.

Recarga de saldo e uploads ainda precisam de validação específica. CAPTCHA, 2FA e verificações da Meta precisam ser concluídos pelo usuário. Mudanças do site, bloqueios e expiração de sessão podem impedir operações; o sistema não os contorna.

## Dados e testes

`meta_browser_connections` e `meta_browser_writes` entram no schema Railway e na lista do migrador de backups/Supabase. Um futuro corte para o schema privado Supabase precisa criar as mesmas tabelas e índices em `socio_app` antes de migrar. O volume dos perfis precisa de estratégia própria de backup; o dump PostgreSQL não contém cookies do Chromium.

Testes de unidade cobrem isolamento por empresa/usuário, rotação, validação de entrada e deduplicação. O teste HTTP usa PostgreSQL descartável para conferir autenticação, CSRF, papel e módulo desabilitado, sem criar anúncios nem enviar mensagens.
