# Sócio — Fase 5: Supabase e confiabilidade (04/11/2026)

## Situação validada

- Produção: aplicação, canais, histórico e login continuam usando PostgreSQL do Railway (schema `public`).
- Supabase Consecom: projeto `svbdigkomsbugiyufdtc`, banco PostgreSQL 17.11, em operação.
- Supabase privado: schema `socio_app` atualizado para **28 tabelas** (25 operacionais antigas + `sales_quotes`, `sales_orders`, `sales_payment_events`). `users.active` e índices/constraints da fase 4 já estão presentes.
- **Nenhuma** dessas 28 tabelas contém registros operacionais. Não houve transferência de clientes, mensagens, senhas ou registros comerciais.
- As 14 tabelas `public.socio_*` são um modelo separado com RLS e estão vazias. O Sócio em Railway **não usa** esse modelo nem Supabase Auth; a troca exige as tabelas privadas de mesmo formato, com senhas scrypt e sessões preservadas.
- `anon` e `authenticated` não possuem USAGE sobre `socio_app`. O advisor de segurança Supabase retornou zero alertas.
- Adicionados 17 índices para chaves estrangeiras da base privada vazia. Sem alertas remanescentes de FKs sem índice. Índices ainda não utilizados (banco vazio) e um índice duplicado foram mantidos para análise posterior, evitando alterações destrutivas precipitadas.
- O erro de segurança da biblioteca `sharp` (libvips/libheif/librsvg) foi resolvido ao fixar `sharp` na versão `0.35.5`, validada com testes de imagens e `npm audit --omit=dev --audit-level=high`.

## Entregas de confiabilidade

1. **Barreira de manutenção:** `SOCIO_MAINTENANCE_MODE=1` faz a aplicação responder HTTP 503 e `Retry-After: 120` a todo POST/PUT/PATCH/DELETE, inclusive login, WhatsApp, Stripe e aprovação pública de pedidos; workers de sincronização, IA, importações e análise permanecem pausados. Consultas de leitura e healthcheck continuam disponíveis. Isso é uma proteção de migração, **não** é congelamento instantâneo de transações que já estejam em execução.
2. **Inicialização Supabase segura:** se `SOCIO_DB_SCHEMA=socio_app`, o backend exige as 28 tabelas e a coluna `users.active` e não executa automaticamente migrações de DDL remoto. Conexão com Supabase usando outro schema é recusada.
3. **Migrador atualizado:** `scripts/socio-supabase-migrate.mjs` conhece as 28 tabelas, verifica paridade de colunas/tipos/nulidade e chaves primárias, recusa destino com registros, recusa schema privado exposto, copia com origem bloqueada contra escritas e valida **quantidade e impressão digital por conteúdo** de cada tabela.
4. **Cópia atômica:** a transação no Supabase é confirmada somente quando todas as 28 tabelas foram copiadas e conferidas. Falha ou divergência provoca rollback da cópia, sem modificar a origem. O script nunca troca `DATABASE_URL` nem apaga o banco original.
5. **Diagnóstico autenticado:** `GET /api/ops/migration-readiness`, disponível para proprietários/admins, informa banco e schema ativos, modo de manutenção, condições de preparação e bloqueios. Não expõe credenciais nem aciona uma transferência.
6. **Testes reais automatizados:** dois PostgreSQL descartáveis, source/target, com exemplos falsos de duas empresas, login, canal, conversa, mensagem, produto, proposta, pedido, evento de pagamento e auditoria. Preflight read-only, cópia íntegra, recusa de destino ocupado, erro intencional em constraint e rollback da transação. Um terceiro banco descartável valida manutenção HTTP para login, webhooks, checkout e API.
7. **CI bloqueadora:** `npm test`, syntax check e `npm audit --omit=dev --audit-level=high`.

## Procedimento operacional futuro para corte de banco (não executar sem validação real)

**Antes de copiar:**
- Fazer backup criptografado do PostgreSQL Railway usando a ferramenta da fase 4 e restaurar cópia autorizada em ambiente isolado; comparar contagens, amostras e vínculos.
- Inventariar e proteger mídias S3, sessões/históricos WA-AKG/MySQL, configurações e segredos. O migrador move apenas dados do PostgreSQL.
- Obter via painel do Supabase uma URL PostgreSQL autenticada e testar DNS, SSL e conectividade do Railway com o Supabase. O conector de SQL administrativo **não é** uma URL de aplicação. Não publicar senhas no GitHub ou conversas.
- Configurar `SOCIO_SOURCE_DATABASE_URL` e `SOCIO_SUPABASE_DATABASE_URL` somente no ambiente seguro do operador, nunca em `public/app.js`.
- Ativar manutenção no `socio-app` pelo Railway, aguardar o deploy e a drenagem das requisições existentes, verificar `GET /health` com `readOnly=true`. A configuração do gateway externo e dos recebimentos deve ser analisada para mensagens que chegarem durante a pausa.
- Executar `node scripts/socio-supabase-migrate.mjs` para verificar as 28 tabelas, estrutura e destino vazio. Rejeitar qualquer divergência, sem contornar validações.

**Cópia com quatro confirmações operacionais verificadas:**

    SOCIO_MAINTENANCE_MODE=1
    SOCIO_VERIFIED_BACKUP=YES
    SOCIO_TARGET_EMPTY_CONFIRMED=YES
    SOCIO_WRITE_FREEZE_CONFIRMED=YES
    node scripts/socio-supabase-migrate.mjs --apply

Os comandos representam variáveis de ambiente do mesmo processo, não instruções para colocar segredos em texto no repositório. O modo de manutenção precisa estar realmente ativo na aplicação, além do indicador no migrador.

**Depois da cópia:**
- Permanecer em manutenção. Validar contagens e IDs por tenant, vínculos referenciados, hashes de linhas, login antigo preservado, sessões, catálogo, treinamento e pedidos.
- Trocar `DATABASE_URL` **somente do serviço `socio-app`** para Supabase e definir `SOCIO_DB_SCHEMA=socio_app`; não alterar o Prospector, nem MySQL e WA-AKG.
- Validar health, painel/rotas GET e operação da imagem S3 apontando ainda para o bucket Railway. Confirmar autenticação por e-mail e celular apenas após reabilitar login.
- Apenas com aprovação de operação segura, desativar manutenção, confirmar escrita e entrega de mensagens de testes próprios.

**Rollback seguro:** antes de permitir escritas no destino, retornar `DATABASE_URL`/schema e manter manutenção enquanto verifica a origem. Depois que registros forem escritos no Supabase, a volta imediata à origem **pode perder essas alterações**. Nesse caso, manter manutenção, realizar reconciliação reversa verificada e só então redirecionar. Nunca apagar o banco Railway até testar backups, retenção, reconciliação e recuperação da operação completa.

## Restrições pendentes — impedem a migração real neste momento

- Não existe nos conectores uma senha PostgreSQL Supabase comprovada e autorizada para uso pela aplicação. Não foram trocadas credenciais Railway nem `DATABASE_URL`.
- Não houve backup e restauração verificados de **dados reais** da produção, inclusive S3 e WA-AKG/MySQL.
- Uma restauração de fixture não comprova compatibilidade do cliente Node com a rede/SSL real do Supabase, nem a consistência de volumes de dados reais.
- Precisam de validação operacional os fluxos de WhatsApp em telefone controlado, ações de venda, política de retenção e monitoramento pós-cutover.
- A migração para Supabase Auth e o modelo `public.socio_*` constitui projeto distinto e **não foi iniciada**. Manter o serviço de autenticação atual até existir procedimento sem perda de usuários.

**Conclusão:** fase de preparação de schema, endurecimento, teste de cópia e proteção da produção executada. O corte de banco e o backup real permanecem bloqueados até as condições acima estarem comprovadas.
