# Sócio — Etapa 4: equipes, isolamento e recuperação (04/11/2026)

## O que foi implementado

- Permissões server-side por empresa e papel:
  - **Proprietário:** acesso ao catálogo, treinamento, canais e vendas; pode cadastrar administradores e atendentes, alterar os papéis dos não-proprietários, desativar/reativar usuários e ver auditoria.
  - **Administrador:** pode configurar catálogo, treinamento, canais e vendas, consultar equipe e auditoria e cadastrar apenas atendentes. **Não pode** criar administradores, promover ou desativar colegas.
  - **Atendente:** atendimento e leitura de catálogo. Não acessa treinamento, importações, relatórios de vendas, auditoria ou a lista completa da equipe. Pode alterar o próprio celular/senha.
  - **Consecom (master):** alternância entre empresas explicitamente autorizada e auditada, sem reutilizar sessões WhatsApp de outro projeto.
- GET /api/me entrega matriz de capacidades para ajustar a interface; o servidor não depende do menu para bloquear ações.
- PATCH /api/team/:id (proprietário): ativar, desativar e trocar entre atendente/administrador. Não altera proprietário, operador master, usuário de outra empresa nem o próprio perfil. Operação transacional com auditoria. Desativação encerra as sessões e impede novo login.
- POST /api/me/password: exige senha atual, nova senha 12–128 caracteres, revoga outras sessões e audita a troca sem registrar segredos.
- GET /api/ops/audit restrito ao dono/administrador: até 100 eventos por consulta, limitado ao tenant_id; identificação do operador master não expõe identidade de usuário de outra empresa.
- GET /api/ops/tenant-integrity restrito ao dono/administrador: contagem de possíveis divergências em relacionamentos de conversas, mensagens, variações, mídia, orçamentos, pedidos e sessões.
- Banco: índice para usuários e auditoria; dois novos FKs compostos (tenant_id, channel_id) e (tenant_id, conversation_id) que impedem **novas** associações cruzadas. NOT VALID evita interromper a inicialização por dados antigos. Dados preexistentes **ainda exigem reconciliação e validação formal**.

## Proteções e testes

A CI executa npm test com PostgreSQL 16 descartável e testes negativos de:
- Colaborador tentando alterar outro tenant, consultar vendas/treinamento/auditoria ou promover sua própria permissão.
- Administrador tentando criar outro administrador.
- Desativação/revogação de sessão, reativação, troca de senha e invalidação de sessões antigas.
- FKs compostas impedindo dados cruzados mesmo através de SQL direto.
- Escopo do log de auditoria entre duas empresas.
- Snapshot criptografado, restauração em outro banco, conferência de registros e bloqueio de chave incorreta.

**Resultado de CI não substitui auditoria de produção, ataque externo ou teste de recuperação da infraestrutura real.** O diagnóstico exibido na UI é um pré-check sem listar dados pessoais.

## Backup e recuperação — instruções operacionais

O script scripts/socio-encrypted-backup.mjs é manual e usa pg_dump/pg_restore compatíveis com PostgreSQL 16, AES-256-GCM, autenticação do arquivo e SHA-256. O arquivo original do dump não é persistido em texto puro.

Para backup, configure DATABASE_URL, SOCIO_BACKUP_PASSPHRASE (pelo menos 32 caracteres, guardada fora do repositório), um diretório seguro absoluto SOCIO_BACKUP_DIR e confirmação SOCIO_BACKUP_CONFIRM=YES_ENCRYPTED_BACKUP. Execute:

    node scripts/socio-encrypted-backup.mjs backup

O processo retorna o caminho absoluto do .enc e cria o manifesto .enc.json. Para verificar a integridade, configure SOCIO_BACKUP_ARCHIVE com o caminho do arquivo e execute:

    node scripts/socio-encrypted-backup.mjs verify

Restauração somente em base PostgreSQL **descartável e vazia**, com nome iniciado por socio_restore_test_. Defina SOCIO_RESTORE_TEST_DATABASE_URL, SOCIO_RESTORE_CONFIRM=YES_DISPOSABLE_DATABASE, chave de backup e caminho do arquivo:

    node scripts/socio-encrypted-backup.mjs rehearse

O script rejeita a restauração para a mesma base de origem e valida a autenticação do arquivo antes de executar pg_restore. Não há função para restaurar sobre a base de produção.

**Importante:** o backup cobre **apenas PostgreSQL**. Fotos do catálogo no S3 privado e as sessões/históricos mantidos pelo gateway WA-AKG/MySQL precisam de inventário, retenção e backups próprios. O sistema **não ativou** backup diário em produção nem provou restauração de dados reais. Antes de garantir recuperação em SaaS, configurar armazenamento externo criptografado, retenção/expiração, monitoramento de falhas, cópias de mídia/gateway e testar o plano completo com dados autorizados em ambiente isolado.

## Validação retroativa das novas chaves estrangeiras

Os índices/FKs compostos já bloqueiam novos registros cruzados. Para registros preexistentes, usar GET /api/ops/tenant-integrity por empresa e conciliar qualquer divergência. Após backup íntegro e análise de locks, o operador poderá executar em janela de manutenção os comandos ALTER TABLE ... VALIDATE CONSTRAINT separadamente para socio_conversation_tenant_channel e socio_message_tenant_conversation. **Não executar automaticamente durante o deploy de produção.**

## Próximas pendências externas

- Validar usuários e empresas reais no painel, incluindo acessos de atendentes e reativação.
- Escolher e configurar destino seguro para backups recorrentes e fotos; definir retenção e política LGPD.
- Testar restauração com cópia autorizada de produção em infraestrutura isolada e comparar dados por empresa.
- A migração futura para Supabase continua separada; o PostgreSQL do Railway permanece a fonte de produção.
