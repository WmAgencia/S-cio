# Sócio — Backup complementar de imagens e gateway MySQL

## Objetivo

O backup PostgreSQL 18 do Sócio utiliza um bucket Railway independente (`socio-disaster-backups`). Duas rotinas complementares protegem conteúdos não abrangidos pelo PostgreSQL: as imagens S3 do catálogo e o banco MySQL do gateway WA-AKG.

## Imagens privadas

- Serviço dedicado `socio-media-backup`; comando `node backup-runner/media.mjs`.
- Lista os objetos existentes em `socio-product-media`, ignorando apenas sondas temporárias em `health/`.
- Exige chaves no formato `tenant-id/product-id/image-id.jpg` e tamanho máximo de 5 MiB; não copia objetos inesperados silenciosamente.
- Lê o arquivo privado, cifra com AES-256-GCM usando sal e IV aleatórios exclusivos para cada arquivo, e envia ao bucket independente sem publicar URLs.
- Faz download remoto do ciphertext, valida SHA-256, descifra localmente e compara SHA-256 do original.
- Grava um manifesto `media/manifests/...` **somente após verificar todos os arquivos**. Se a listagem estiver vazia, cria um manifesto com quantidade 0 (não afirma haver fotos).
- A rotina não apaga arquivos de origem nem altera registros SQL. Uma restauração de imagens exige ferramenta específica de validação de objetos e consistência do banco.

Variáveis Railway no serviço: `SOCIO_MEDIA_S3_*` referenciam `socio-app.SOCIO_S3_*`, e `SOCIO_BACKUP_S3_*` referenciam o bucket de backup. A chave de criptografia referencia `socio-backup.SOCIO_BACKUP_PASSPHRASE` sem duplicar seu valor.

## MySQL WA-AKG

- Serviço dedicado `socio-mysql-backup`; comando `node backup-runner/mysql.mjs`.
- Lê `socio-waakg.DATABASE_URL` via variável de referência; senha nunca aparece em argumentos ou logs.
- Usa cliente `mariadb-dump`, `--single-transaction` e `--quick` para cópia consistente das tabelas InnoDB; aplica gzip e AES-256-GCM em fluxo antes de escrever no disco temporário.
- Publica o arquivo cifrado em `mysql/YYYY-MM-DD/*.sql.gz.enc`, faz leitura de volta, confere SHA-256, autenticação GCM e descompressão gzip sem persistir SQL puro.
- Só publica o manifesto após verificação; qualquer falha retorna código diferente de zero. Essa validação **não equivale a restaurar em um MySQL isolado**.

## Operação e limites

- Cada serviço cron deve rodar e encerrar (não é aplicação HTTP). Ajustar agendamento apenas **após** uma primeira cópia comprovada no Railway.
- Rotinas de PostgreSQL, mídia e MySQL possuem buckets isolados das origens, mas ainda estão na **mesma conta/provedor Railway**; para independência de desastre da conta, configurar cópia fora do provedor e guardar chave de descriptografia em cofre externo.
- **Não há remoção automática** de snapshots antigos. É necessário definir retenção e orçamento de armazenamento após avaliar volume de dados.
- Recomenda-se habilitar também os backups nativos de volume/PITR do Railway e ensaiar recuperação de dados reais em instância isolada, com autorização e controles LGPD.
