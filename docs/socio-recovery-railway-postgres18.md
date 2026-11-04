# Sócio — Recuperação via backup criptografado PostgreSQL 18

**Escopo:** o `socio-app` segue atendendo no Railway, sem downtime e sem mudança de `DATABASE_URL`. Este serviço separado gera snapshots lógicos PostgreSQL 18 em um bucket privado Railway independente do bucket de imagens.

## Como funciona

1. Um container com **pg_dump e pg_restore 18** usa a mesma URL PostgreSQL que o app por variável de referência Railway.
2. `pg_dump -Fc` transmite os dados à cifra **AES-256-GCM** em tempo real; nenhum dump puro é salvo em disco.
3. O ciphertext é colocado em um arquivo temporário com permissões restritas. Backups grandes são enviados por multipart S3 (partes de 6 MiB), nunca carregando toda a base em RAM.
4. Após o upload, o processo lê o objeto remoto novamente, verifica SHA-256, autenticação AES-GCM e consegue listar o arquivo usando `pg_restore --list` sem escrever dados em outro banco.
5. O manifesto (arquivo `.enc.json`) é publicado **somente após** a validação remota. Ele contém data, tamanho, hash e metadados criptográficos, não usuários, senhas, conversas ou textos.
6. O processo sai; falhas retornam exit code não zero e são visíveis nos logs da implantação do cron.
7. É um backup **de PostgreSQL somente**. O MySQL das sessões WA-AKG e as imagens do catálogo exigem cópias adicionais. Não usar este arquivo como promessa de recuperação integral do SaaS.

## Configuração isolada no Railway

Serviço separado: `socio-backup`, Dockerfile `backup-runner/Dockerfile`, comando `node backup-runner/run.mjs`, cron diário após validar a primeira cópia.

Variáveis do serviço, **não** do frontend e **não** no GitHub:

- `SOCIO_BACKUP_SOURCE_DATABASE_URL`: referência para `socio-app.DATABASE_URL`.
- `SOCIO_BACKUP_PASSPHRASE`: segredo aleatório exclusivo com pelo menos 40 caracteres; **guardar cópia em gerenciador de senhas offline/externo**. Sem esse segredo, os backups não podem ser restaurados.
- `SOCIO_BACKUP_S3_ENDPOINT`, `SOCIO_BACKUP_S3_BUCKET`, `SOCIO_BACKUP_S3_REGION`, `SOCIO_BACKUP_S3_ACCESS_KEY` e `SOCIO_BACKUP_S3_SECRET_KEY`: referências para o bucket `socio-disaster-backups`.
- `SOCIO_BACKUP_MAX_PLAINTEXT_BYTES`: limite opcional de tamanho (padrão 1 GiB). Excede o limite = falha visível, sem substituir backups anteriores.

## Teste de restauração isolado

Ferramenta `backup-runner/restore.mjs`: aceita `SOCIO_RESTORE_ARCHIVE_KEY`, `SOCIO_RESTORE_TEST_DATABASE_URL` e `SOCIO_RESTORE_CONFIRM=YES_DISPOSABLE_DATABASE`. O nome do banco deve começar por `socio_restore_test_`, o destino precisa estar **vazio** e não pode ser o banco de origem ou Supabase. O programa confere autenticação e hash **antes** de abrir a conexão de escrita, depois usa `pg_restore --single-transaction --exit-on-error` para reduzir restaurações parciais.

Exemplo, a executar em ambiente controlado, nunca sobre o PostgreSQL operacional:

```bash
SOCIO_RESTORE_ARCHIVE_KEY='postgres/AAAA-MM-DD/socio-....dump.enc' \
SOCIO_RESTORE_TEST_DATABASE_URL='postgresql://.../socio_restore_test_xxxxx' \
SOCIO_RESTORE_CONFIRM=YES_DISPOSABLE_DATABASE \
node backup-runner/restore.mjs
```

A compatibilidade do Docker com PostgreSQL 18 e a sintaxe das ferramentas são testadas na CI; **a restauração integral de dados de produção permanece pendente até a confirmação de uma base de testes autorizada**.

## Medidas adicionais obrigatórias

- Habilitar snapshots de volume/PITR nativos no Railway conforme o plano permite (configuração do Dashboard/CLI), com janela de retenção.
- Criar backup do **MySQL WA-AKG** e replicação de **imagens privadas S3** para outro destino, com teste de leitura.
- Definir retenção de snapshots criptografados, monitoramento de falhas do cron e confirmação de segredo offline.
- Depois, negociar um corte Supabase apenas quando existir uma conexão PostgreSQL autenticada e backup real recuperável. Nunca expor `socio_app` a papéis `anon`/`authenticated`.
