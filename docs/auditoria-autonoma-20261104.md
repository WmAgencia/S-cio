# Auditoria técnica do Sócio — 04/11/2026

Referência inicial: `904aef60abb40ca1cac928867d7b110e49359a53`, repositório `WmAgencia/S-cio`.
Trabalho local em `E:\auditoria-socio\repo`. Banco PostgreSQL 16.15 descartável, vinculado exclusivamente a `127.0.0.1:55432`.

## Escopo e evidências

- Revisão de autenticação, autorização, isolamento entre empresas, módulos, histórico, sincronização, IA, propostas, pedidos, pagamento de teste, migração e backups.
- Verificação de sintaxe dos 78 arquivos JavaScript existentes e adicionados.
- Execução da suíte com PostgreSQL real, serviços externos simulados e bancos descartáveis.
- Navegador Edge real via Playwright: login e navegação em Visão geral, Relatórios, WhatsApp, Meta Ads, Produtos, Vendas, Orçamentos, IA, Equipe e Empresas. Nenhuma exceção de JavaScript ou resposta HTTP 5xx nesses fluxos.
- Verificação visual em 1440×1000 e 390×844. Histórico móvel sem transbordamento horizontal: largura do documento de 390 px.
- `npm audit --omit=dev`: nenhuma vulnerabilidade conhecida nas dependências resolvidas nesta data.
- Busca de padrões de credenciais no conteúdo atual versionado: as ocorrências identificadas eram exemplos e fixtures. Isso não equivale a uma auditoria de segredos de todo o histórico Git.
- Consulta somente de leitura ao `/health` público: aplicação e banco responderam saudáveis antes da publicação das mudanças.

## Problemas corrigidos

| Prioridade | Achado confirmado | Correção |
| --- | --- | --- |
| Alta | Desabilitar WhatsApp não protegia `/api/conversations/...`, incluindo históricos e operações antigas. | Aplicação da mesma restrição de módulo às rotas de conversas. Testes de API e de função de autorização. |
| Alta | O estado `paused` de uma empresa não bloqueava as operações normais nem a seleção de tarefas automáticas. | Bloqueio de API, propostas públicas e seleção de sincronização, análise, IA e alertas. Consulta da própria sessão, saída e administração master permanecem acessíveis. |
| Alta | Duas propostas diferentes podiam aprovar a última unidade. | Aprovação considera reservas de pedidos pendentes não vencidos, sob bloqueios transacionais dos produtos, em ordem estável. Reserva termina com o vencimento da proposta; pagamento de teste libera a reserva sem consumir estoque real. |
| Alta | A migração copiava 38 tabelas e omitia `sale_intents`, perdendo as oportunidades de venda no cutover. | Manifesto ampliado para as 39 tabelas; teste compara automaticamente o manifesto ao schema e verifica cópia dos registros. Migração privada aditiva prepara tabela e campos de propostas ausentes. |
| Média | Sincronização automática ignorava permanentemente os canais posteriores aos 50 primeiros. | Rodízio por cursor composto de criação e ID, sem teto fixo de canais. Teste com 52 canais. |
| Média | Histórico podia omitir mensagens com a mesma data na divisão de páginas e perder precisão abaixo de milissegundos. | Cursor opaco com timestamp PostgreSQL completo e ID. Mantida compatibilidade com o cursor antigo por data. Teste de mensagens com datas iguais e microssegundos. |
| Média | Envio confirmado pelo gateway podia aparecer como incerto após falha de gravação do histórico. | Recibo confirmado durável e recuperação idempotente do histórico. A recuperação não envia mensagens ao gateway. Teste injeta falha após confirmação, repete a solicitação e verifica um único envio. |
| Média | Entrega automática não verificava os módulos e a pausa da empresa no caminho de envio. | Consulta de autorização também no serviço de entrega; IA exige o módulo habilitado. Preferências de conversa recusam ativação de IA quando desabilitada. |
| Baixa | Senha inválida na criação podia resultar em erro interno; verificação aceitava entradas excessivamente grandes. | Erro de validação 422 e limite de entrada de senha antes do scrypt. |
| Baixa | Mapas de limitação de requisições cresciam sem limite. | Limite de entradas e descarte de janelas antigas. |
| Manutenção | Instalação de dependências não era reproduzível e branches `codex/**` não disparavam validação por push. | Lockfile versionado, CI com `npm ci` e cobertura dessas branches. |
| Testes | Teste de backup utilizava caminho incompatível com Windows; E2E usava a base informada diretamente e herdava a chave Groq da máquina. | Conversão com `fileURLToPath`, banco E2E descartável, token de instalação de fixture e chamadas de IA/envios externos desabilitadas nesse teste. |

## Validação das mudanças

Comandos usados, com `DATABASE_URL` apontando ao PostgreSQL local de teste:

```text
node --test --test-concurrency=1 tests/*.test.mjs
npm audit --omit=dev
git diff --check
```

O teste de regressões acrescentado verifica autorização, precisão e paginação, aprovação concorrente, expiração de reservas, recuperação sem reenvio, canais além do limite original e bloqueio de empresas pausadas.

Resultado da suíte completa: **117 testes aprovados, zero falhas, zero ignorados**. O alinhamento adicional da migração tem validação específica de criação idempotente e preservação das oportunidades de venda.

As primeiras execuções identificaram problemas do ambiente e dos próprios testes: concorrência excessiva esgotou a memória do Windows; um caminho de arquivo era incompatível com Windows; o E2E herdava configuração de IA externa. As validações finais usam execução sequencial e fixture isolada. O PostgreSQL descartável foi ajustado para baixo consumo de memória e sem fsync; essa configuração serve somente ao ensaio local e não foi aplicada à produção.

## Melhorias recomendadas para a próxima etapa

1. **Sincronização orientada a eventos e com filas:** o rodízio remove a exclusão de canais, mas o intervalo aumenta com a quantidade de canais. O gateway ainda limita a enumeração de conversas a 50 e a sincronização incremental lê somente uma página de 100 mensagens. É necessário paginar o provedor ou usar eventos antes de prometer cobertura completa.
2. **Métricas operacionais:** expor idade da última sincronização por canal, fila pendente, erro mais recente e atraso da resposta, com alertas por falhas persistentes.
3. **Pagamentos reais e ciclo de estoque:** o sistema continua limitado a Stripe de teste. Antes de habilitar cobrança real, implementar cancelamento de pedido, liberação explícita de reserva, baixa definitiva, estorno e conciliação financeira. O catálogo mostra estoque cadastrado; a disponibilidade reservada é conferida na aprovação.
4. **Limitação distribuída de login:** o limite atual usa o endereço do socket e memória do processo. Atrás de proxy, usuários podem compartilhar esse endereço; réplicas não compartilham contadores. Usar identidade normalizada e armazenamento compartilhado, com política explícita de proxy confiável.
5. **Separação de rotas e tarefas:** reduzir o tamanho do `server.mjs`, separar workers e adicionar monitoramento de falhas recorrentes. Parte dos testes existentes verifica texto de código; ampliar testes comportamentais de navegador para substituir gradualmente essas verificações.
6. **Retenção e privacidade:** formalizar retenção de mensagens, exportação e exclusão por empresa, rotatividade de chaves e exercícios periódicos de restauração. Os filtros de anonimização existentes não constituem garantia de remoção de todos os dados pessoais de texto livre.
7. **Migração:** manter o novo teste de cobertura do manifesto e comparar também com o catálogo real antes de qualquer cutover. O alinhamento privado adicionado deve ser aplicado no staging antes de copiar dados; não foi executado em bancos de produção.

## Limites e implantação

As verificações externas de WhatsApp, Instagram, Meta Ads e Stripe usaram simulações e fixtures. Não foi realizada compra real, teste de entrega em números de clientes ou autenticação no painel de produção. O estado real de tokens, acessos dos provedores, métricas de infraestrutura e restauração do backup de produção precisa de validação operacional própria.

O runtime público não exige nova tabela nem alteração destrutiva de dados. Foi acrescentado um script aditivo para preparar no schema privado a tabela de oportunidades e os campos de propostas já existentes no runtime público. A publicação deve ocorrer pelo fluxo do GitHub, depois da validação de CI. O resultado final e o link da alteração são informados no chat.
