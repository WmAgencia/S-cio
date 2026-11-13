# Auditoria técnica — Sócio (12/11/2026)

Auditoria completa após o cutover do PostgreSQL Railway para o Supabase (`socio_app`).
Quatro frentes: arquitetura, segurança/isolamento, camada de dados, operação/testes/CI.
Todo achado abaixo foi verificado no código ou no banco — não é lista genérica.

## Estado atual verificado

| Item | Valor medido |
|---|---|
| Tabelas em `socio_app` | 75 |
| Índices declarados no `schema.sql` presentes | 78 de 78 (212 índices no total) |
| Constraints | 75 PK, 159 FK, 59 UNIQUE, 127 CHECK |
| Dados | 1 empresa, 1 usuário, 56 conversas, 234 mensagens |
| Testes | 118 arquivos; 88 leem o código-fonte com regex; 24 dependem de `DATABASE_URL` |
| Entrypoint | `server.mjs` — 2.295 linhas, `handle()` com ~1.871 linhas e 204 predicados de rota |

O banco está íntegro e o volume ainda é de piloto. Isso muda a prioridade: os problemas
de performance são baratos de prevenir agora e caros depois; os de operação e segurança
têm efeito imediato.

## P0 — risco imediato (fazer antes de qualquer nova feature)

### 1. Um erro de conexão ociosa derruba o processo
`server.mjs` registra apenas `SIGTERM`. Não existe `pool.on('error')`,
`uncaughtException` nem `unhandledRejection` em nenhum arquivo do projeto (verificado por busca).
O `pg` emite `error` no pool quando uma conexão ociosa morre — situação esperada com o
pooler do Supabase, que corta conexões paradas. Sem listener, o Node encerra o processo.
**Correção:** listener no pool que loga e descarta o client, mais handlers globais que
logam e encerram de forma controlada. ~10 linhas.

### 2. Saúde e boot não detectam schema quebrado
`/health` executa só `SELECT 1` (`server.mjs:166-170`). No caminho Supabase o boot valida
apenas os 75 nomes de tabela e uma coluna de `users` (`server.mjs:2060-2073`).
Uma migração esquecida produz um serviço "verde" que devolve 500 na funcionalidade afetada.
**Correção:** versionar o schema (`schema_migrations`) e fazer o readiness conferir a versão
e a presença de tabelas/colunas críticas.

### 3. Migrações não são aplicadas pelo deploy
`supabase/migrations/` tem 20 arquivos e nenhum é executado pelo CI nem pelo Railway.
Não há ledger nem ordem garantida. Hoje o banco está correto porque o `schema.sql` foi
aplicado manualmente no cutover; a próxima alteração de schema será manual e invisível.
**Correção:** tabela de controle + script idempotente de aplicação, rodando no deploy.

### 4. Troca de senha não revoga a sessão comprometida
`server.mjs:882` apaga as sessões com `token_hash <> $2`, preservando a sessão atual.
Se o cookie do usuário foi roubado, o atacante compartilha exatamente esse `token_hash`
e continua válido por até 7 dias — justamente quando a vítima troca a senha por suspeita de invasão.
**Correção:** apagar todas as sessões do usuário, emitir uma nova e devolver o novo CSRF.

### 5. Cookie sem `Secure` se `NODE_ENV` faltar
`server.mjs:118` só adiciona `; Secure` quando `NODE_ENV==='production'`.
Um deploy sem a variável aceita tráfego HTTP e expõe o token de sessão.
**Correção:** falhar no boot se `NODE_ENV` não for `production`, e emitir `Secure` sempre.

## P1 — dívida estrutural (encarece toda mudança)

### 6. Monolito de roteamento e autorização em três camadas
`handle()` concentra ~150 endpoints, arquivos estáticos, webhooks, OAuth e regra de negócio.
A autorização é feita por `needRole` (35 chamadas), por `requirePermission` (60 chamadas,
algumas dentro dos serviços) e por arrays de papel crus no inbox — três modelos conviventes,
sendo que 58 blocos de rota não chamam autorização no próprio roteador. Uma rota nova pode
entrar sem proteção sem que ninguém veja.
**Correção incremental (sem reescrever):** `lib.mjs` consolidado → exportar `createApp` e
extrair o middleware de autenticação → tabela de rotas `{method, path, feature, permission}`
→ um único wrapper de autorização → extrair domínios um PR por vez (produtos, treinamento,
admin, inbox).

### 7. Um pool para HTTP e 15 workers
`max: 10` (`server.mjs:87`) atende requisições e workers que consultam a cada 750 ms–60 s.
Sob carga, os workers podem ocupar todas as conexões e as requisições esperam 8 s até falhar.
**Correção:** pool pequeno e dedicado aos workers; unificar os 15 `setInterval` em `startWorkers()`.

### 8. Duplicações que vão divergir
- `inbox-live-sync.mjs:46-70` reimplementa o upsert de conversa e insert de mensagem de `inbox-api.mjs:106-140`.
- 24 módulos redefinem `fail`/`err`; 15 redefinem regex de UUID; `ads-media-oauth.mjs:7-12`
  reimplementa `hash`/`secureEqual` — comparação de tempo constante copiada é risco de correção.
- `tenant-features.mjs:36-43` mapeia URL→feature por regex, separado do roteador: adicionar rota exige editar dois lugares.

### 9. A suíte não testa o comportamento real
88 dos 118 arquivos fazem `assert.match` sobre o fonte — detectam edição, não defeito.
24 pulam silenciosamente sem `DATABASE_URL`. Não existe teste do caminho de produção
(`SOCIO_DB_SCHEMA=socio_app`) nem do boot contra schema privado.
**Correção:** falhar o CI quando houver skip inesperado; teste de boot com `socio_app`;
substituir regex por testes de comportamento nas rotas críticas (auth, isolamento, webhooks).

## P2 — correção e desempenho (barato agora, caro depois)

10. **Índices ausentes nos caminhos quentes** (verificado no banco): falta
    `messages(tenant_id, direction, created_at DESC)` — usado por contagem de dashboard e
    varreduras de 48 h; falta trigram em `messages.body` para a busca do inbox; falta índice
    parcial em `conversation_ui_state(handling_mode='ai_assist')`; o reconciliador do outbox
    ordena por `updated_at` sem índice; `sessions` não tem índice em `expires_at`.
11. **Transações faltando:** projeção outbox→messages faz 4 escritas independentes
    (`socio-outbound.mjs:122-129`); o mesmo padrão em `inbox-api.mjs:239-243` e
    `meta-billing-observations.mjs:29-36`.
12. **Retenção inexistente:** `sessions`, `audit`, `messages`, `message_outbox`,
    `ai_reply_attempts` e estados OAuth crescem sem limite. Só `rate_limits` é limpo.
13. **N+1:** o scanner de intenção de venda recarrega o catálogo por mensagem candidata
    (`sales-intents.mjs:35-40`), a cada 15 s.
14. **Defeitos de schema:** `marketing_oauth_grants` tem PK `(tenant_id, provider)` com
    `user_id` fora da chave — o grant do segundo usuário sobrescreve o primeiro;
    `meta_billing_alerts` tem PK que sobrescreve histórico em vez de acumular; `audit.tenant_id`
    e `conversations.channel_id` sem `ON DELETE`, impedindo exclusão de empresa/canal com histórico.
15. **Backup/restauração assume `public`:** `backup-runner/restore.mjs:71-91` e
    `scripts/socio-encrypted-backup.mjs:120-128` contam tabelas em `public` — o ensaio de
    restauração no Supabase falharia ou contaria zero. Um backup que nunca foi ensaiado
    contra o destino atual não é backup.
16. **LLM dentro de transação:** `analysis-jobs.mjs:61-91` mantém conexão aberta durante a
    chamada ao Groq, com pool de 10. Chamada lenta segura uma conexão inteira.

## P3 — limpeza

- README desatualizado: ainda descreve produção no Railway, `socio_app` com "28 tabelas" e
  nenhum dado real migrado. Hoje são 75 tabelas e a produção inteira roda no Supabase.
  A seção de deploy também precisa refletir o cutover.
- Não há Dockerfile na raiz (só em `backup-runner/`, `meta-browser/`, `waakg-socio/`);
  o serviço web é construído pelo Nixpacks, ao contrário do que a documentação sugere.
- `SIGTERM` sem timeout de saída forçada (`server.mjs:2293`).
- Logs sem estrutura, request id ou tenant; erros de worker registram só `error.code`
  (53 chamadas de `console.*`). Nenhum segredo é logado — verificado.
- Exports mortos: `lib.mjs:82 moneyBRL`, `tenant-features.mjs:4 FEATURE_LABELS`,
  `marketing-oauth.mjs:78,89`, `socio-creative-studio.mjs:4`, `socio-sales-conversation.mjs:4`,
  `socio-sales-guide.mjs:5`, `socio-thalita-dialogue-style.mjs:4`.

## Controles corretos — não regredir

Segurança: nenhum achado crítico ou alto. Verificados e corretos: isolamento por `tenant_id`
derivado sempre da sessão (nunca do corpo/query); scrypt com verificação em tempo constante;
tokens de sessão com SHA-256 e CSPRNG; CSRF por mesma origem + token por sessão; todas as
consultas parametrizadas, identificadores dinâmicos só de allowlist; webhooks Meta, Instagram,
Stripe, tracking e Google Ads com HMAC e janela de tempo; OAuth state de uso único;
mídia com URL assinada por tenant, S3 privado e reencode com Sharp; egress restrito a hosts fixos.

Dados: as 49 chamadas `pool.connect()` liberam no `finally`; transações corretas em cadastro,
troca de senha, equipe, treinamento, vendas e webhooks de assinatura.

Migração: o `scripts/socio-supabase-migrate.mjs` é a peça mais sólida do repositório —
preflight de colunas e PKs, destino vazio obrigatório, impressão digital por linha e rollback atômico.

## Observação estrutural sobre RLS

O RLS está habilitado em todas as tabelas, mas a aplicação conecta como dona do schema,
o que ignora as políticas. O isolamento hoje é 100% da camada de aplicação. Está correto,
mas é garantido por revisão, não por mecanismo. Caminho recomendado: conectar com papel
não-dono e políticas por `tenant_id`, ou ao menos um teste de CI que sinalize consulta a
tabela multiempresa sem filtro `tenant_id`.

## Ordem recomendada

1. **P0 inteiro em um único PR** — são cinco correções pequenas, de baixo risco, com teste.
2. Ledger de migração + verificação de schema no health (parte do P0).
3. Consolidar `lib.mjs` e extrair o middleware de autenticação; a partir daí cada rota
   extraída vira testável.
4. Pool separado para workers e `startWorkers()`.
5. Corrigir índices, transações e retenção — antes de o volume crescer.
6. Backend de backup/restore apontando para `socio_app`, com ensaio real.
7. Tabela de rotas e wrapper único de autorização, domínio por domínio.

O que **não** fazer: reescrever o `server.mjs` de uma vez. A ordem acima mantém o sistema
funcionando a cada passo.
