# Sócio — preparação da migração PostgreSQL Railway → Supabase

## Estado verificado em 03/11/2026

- Supabase **Consecom**: projeto `svbdigkomsbugiyufdtc`, ACTIVE_HEALTHY.
- Esquema **`socio_app`** criado no Supabase e 20 tabelas de `schema.sql` instaladas por migração.
- Esquema `socio_app` é privado, fora da Data API exposta; `anon` e `authenticated` não têm acesso ao esquema. Auditoria de segurança do projeto não retornou alertas.
- As 14 tabelas `public.socio_*` preparadas previamente **não** são a base operacional e permanecem intactas.
- **O PostgreSQL do Railway continua sendo a produção**. Nenhum dado da produção foi copiado; a base privada do Supabase estava vazia na verificação.
- O Sócio continua rodando no serviço `socio-app` do Railway. O gateway privado `socio-waakg`, o MySQL de sessões e as mídias S3 continuam separados do Prospector.
- O conector Supabase permite SQL administrativo, mas não fornece uma URL de banco autenticada para a aplicação; a criação de credenciais via conector foi bloqueada pelo controle de segurança. Não trocar `DATABASE_URL` antes de solucionar esse ponto.

## Como o migrador funciona

Arquivo: `scripts/socio-supabase-migrate.mjs`.

- Lê o PostgreSQL de origem usando `SOCIO_SOURCE_DATABASE_URL` (ou o `DATABASE_URL` atual) e o banco Supabase com `SOCIO_SUPABASE_DATABASE_URL`.
- O alvo deve ser uma conexão PostgreSQL do Supabase. Nunca colocar credenciais em GitHub, no frontend ou nos relatórios.
- Sem `--apply`, executa somente a validação de tabelas e de quantidade de registros, sem modificar dados.
- Com `--apply`, exige `SOCIO_MAINTENANCE_MODE=1` e a aplicação **efetivamente em manutenção, sem novas escritas**. Adquire bloqueios de escrita na origem ANTES do snapshot, copia as 20 tabelas em ordem de dependências, verifica contagens e só então confirma uma transação única no destino.
- Recusa alvo contendo linhas, esquema incompleto ou fonte com tabelas faltantes. Não apaga nem altera tabelas de origem. Não altera o `DATABASE_URL` da aplicação.
- Os bloqueios deixam de existir ao terminar a cópia. É indispensável manter a aplicação em manutenção até terminar a troca e confirmar que todas as rotas funcionam no novo banco. Não habilitar escritas entre o fim da cópia e o corte.

Comandos, somente no ambiente operacional autorizado e após configurar conexões privadas:

```bash
node scripts/socio-supabase-migrate.mjs
SOCIO_MAINTENANCE_MODE=1 node scripts/socio-supabase-migrate.mjs --apply
```

A cópia não cobre arquivos binários do bucket Railway. Referências em `product_media` continuam apontando ao bucket de origem até uma migração de objetos separada, com inventário, checksums e teste de leitura. O MySQL do WA-AKG não é PostgreSQL e não será automaticamente migrado para Supabase; o gateway seguirá hospedado como serviço independente.

## Conta master

Arquivo `scripts/socio-provision-master.mjs`. Após a cópia, confirma se já existe conta com o e-mail indicado. Se existir, atualiza as credenciais e ativa `role='owner'` e `platform_owner=true` na empresa vinculada. Se não existir, vincula à empresa master existente ou cria o espaço Consecom. O processo revoga sessões antigas **apenas** da conta afetada.

Requer `SOCIO_MASTER_EMAIL`, `SOCIO_MASTER_PHONE` e `SOCIO_MASTER_PASSWORD_HASH` (hash `scrypt` já calculado, **não** senha em texto puro) e `SOCIO_SUPABASE_DATABASE_URL`. A senha do administrador master fornecida pelo proprietário é uma exceção controlada no provisionamento: a política de senhas dos demais usuários não muda. Nenhum hash, telefone pessoal ou segredo é embutido no repositório.

## Condições necessárias para promover produção

1. Obter acesso autenticado ao Postgres Supabase para o backend Railway por uma integração de credenciais suportada e autorizada; testar SSL, hostname, IPv4/IPv6 e rede **sem expor segredos**.
2. Testar o migrador contra bancos descartáveis e realizar inventário da origem (linhas por tabela, versões de esquema, espaço, usuários, mídia e sessão).
3. Colocar o Sócio em manutenção, fazer cópia e validar dados e integridade referencial. Manter a base Railway intacta.
4. Provisionar/validar o administrador master no destino e confirmar os dois meios de login (e-mail e número).
5. Alterar apenas o `DATABASE_URL` do serviço `socio-app`, implantar, testar login, empresas e fluxos principais. Não alterar o Prospector.
6. Após a estabilidade, preparar a migração opcional de objetos S3 para Supabase Storage. Não apagar nenhum bucket ou banco antes de comparar inventários e testar recuperação.
7. Planejar rollback antes de permitir gravações no novo banco. Após abrir a produção no Supabase, reverter apenas o URL sem sincronizar as escritas novas **poderia perder dados**.

**Não considerar a migração concluída** apenas porque as tabelas foram criadas. O corte de produção continua bloqueado por falta de credenciais compatíveis com a conexão da aplicação.
