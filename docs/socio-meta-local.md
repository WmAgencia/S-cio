# Meta Ads com navegador local

A tela principal usa um conector Windows 64 bits e `api-anything@0.4.0`. O servidor Sócio continua hospedado; o navegador de login e as chamadas à Meta executam no computador conectado. Não é necessário criar aplicativo Meta. Cada pessoa instala o conector no próprio computador.

1. Entre no Sócio, abra Meta Ads e baixe o conector Windows.
2. Extraia o ZIP e execute `instalar.cmd`. A instalação não requer administrador. Instala Node.js 24, dependências fixadas, protocolo `socio-meta:` e atalho para retomar a conexão.
3. Clique em **Conectar no meu navegador**, depois **Abrir conector instalado**, e aceite a abertura solicitada pelo navegador.
4. Entre pessoalmente na janela da Meta. Conclua CAPTCHA e 2FA quando solicitados; depois feche essa janela. Mantenha o conector aberto para executar comandos.
5. Nas próximas vezes, use **Iniciar Conector Socio** na área de trabalho. **Desconectar computador** revoga o token imediatamente no servidor; o próximo heartbeat/poll encerra o conector.

O instalador copia Node 24 já instalado ou baixa o ZIP oficial, conferindo SHA-256. Arquivos ficam em `%LOCALAPPDATA%/SocioMetaConnector`; o protocolo é registrado somente em HKCU. Atualmente não há instalador macOS/Linux nem suporte a celular. Não há certificado de assinatura de código próprio; confira a origem do download antes de executar.

## Sessão e autorização

O servidor fornece um código aleatório de uso único, válido por dez minutos, após autenticação, CSRF e permissão `marketing.manage`. O conector aceita somente a origem de produção fixada em `protocol.mjs`; localhost exige uma opção explícita de teste. Não aceita redirecionamentos HTTP. A conexão pertence à empresa e ao usuário autenticados; trocar de empresa não dá acesso à sessão de outro usuário.

O token do conector é armazenado como hash no PostgreSQL e cifrado localmente pela proteção do sistema operacional usada pelo API Anything. A inicialização falha se a cifra não estiver disponível. O código não envia senha, teclas nem cookies Meta ao servidor; envia estado de conexão, comandos e resultados das operações. Resultados comerciais continuam sendo dados sensíveis. O perfil Chromium local também exige proteção da conta Windows. Nenhuma receita ou captura é publicada no catálogo comunitário.

O relay verifica usuário ativo, empresa não pausada, módulo `meta_ads` e permissão a cada requisição. Trabalhos são entregues uma vez, com lease secreto, e nunca recolocados automaticamente na fila. Um resultado perdido pode exigir conferência manual na Meta. Execute usa idempotência, plano local descartável de cinco minutos e limite tier 1. Escritas continuam bloqueadas por `SOCIO_META_BROWSER_ALLOW_WRITES=false` no servidor.

## Rotas

- `GET /downloads/socio-meta-connector.zip`: instalador e fontes; nenhum segredo incluído.
- `/api/marketing/local/`: status, pairing, disconnect e jobs, autenticados pelo Sócio.
- `/api/meta-connector/`: pair com código único; heartbeat, poll e result com Bearer do dispositivo. Essas rotas não recebem a senha Meta.

As tabelas `meta_local_connections` e `meta_local_jobs` entram na migração normal do Sócio e na ferramenta de migração Supabase. `SOCIO_PUBLIC_URL` deve corresponder exatamente à origem em `protocol.mjs`; uma mudança de domínio exige atualizar e reinstalar o conector.

## Limites de validação

O login externo não elimina verificações da Meta. CAPTCHA e 2FA são concluídos pela pessoa, sem automação de resolução. A permissão de recursos oficiais reCAPTCHA no backend remoto legado também foi corrigida, com restrição de host e caminho.

Uma conexão não cria automaticamente operações de campanhas, conjuntos, anúncios, upload, pixels ou saldo. O catálogo começa vazio e precisa de aprendizado e validação autorizados com a conta real. O painel informa isso e nunca trata cookies presentes como prova de operação validada. Nenhuma conta Meta foi autenticada nos testes de desenvolvimento; não houve criação de anúncios, gastos nem pagamentos.
