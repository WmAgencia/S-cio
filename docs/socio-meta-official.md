# Sócio Ads — integração oficial em homologação

App informado pelo proprietário: `2827016234367972`.

## Entregue nesta branch

- Login direto Facebook/Meta com state aleatório de uso único, hash no banco, expiração de dez minutos e vínculo à sessão, usuário e empresa.
- Callback confere novamente sessão ativa, vínculo da empresa, papel e módulo habilitado.
- Troca de código e extensão de token no backend; tokens cifrados e vinculados a usuário/empresa, sem retorno ao navegador.
- Status, listagem das primeiras 100 contas autorizadas e desconexão local. Resposta de contas não devolve URLs de paginação que possam conter tokens.
- Interface com botão Conectar com Facebook e consulta de contas; isolamento das integrações anteriores e WA-AKG preservado.
- Nenhuma operação de escrita de campanha, cobrança ou disparo WhatsApp.

## Configuração necessária antes de publicar

1. No serviço `socio-app`, definir `SOCIO_META_APP_ID=2827016234367972`, `SOCIO_META_APP_SECRET` como segredo privado e `SOCIO_META_GRAPH_VERSION` com a versão suportada pelo app. Manter `CHANNEL_ENCRYPTION_KEY` e `SOCIO_PUBLIC_URL` existentes.
2. Configurar no produto de login do app o redirect URI exato: `{SOCIO_PUBLIC_URL}/api/marketing/official/callback`. Validar se o caso de uso exige Facebook Login for Business/configuration ID e adaptar antes da homologação externa.
3. Validar schema PostgreSQL aditivo e ciclo completo em ambiente isolado, com duas empresas e usuários distintos. Executar o callback real, negar permissões, repetir o código/state, encerrar a sessão antes do callback, desabilitar usuário/empresa e conferir revogação/expiração.
4. Vincular o portfólio empresarial correto no Meta Developers. Não inventar CNPJ, razão social ou comprovantes. Cumprir as exigências indicadas no painel para análise de permissões/acesso de clientes.
5. Preparar e publicar política de privacidade, termos aplicáveis e processo de exclusão com dados legais reais da Consecom e do produto. A desconexão implementada remove a credencial do Sócio; não é uma API de exclusão completa de conta nem revogação global no Facebook. Implementar callback assinado de desautorização/exclusão e processo de retenção antes de liberação comercial.
6. Gravar demonstração verdadeira do fluxo e completar a submissão da Meta. Não declarar acesso avançado aprovado apenas porque permissões estão disponíveis para teste.

## Situação verificada em 06/11/2026

O repositório principal ainda usava conector local. A hospedagem contém `SOCIO_PUBLIC_URL` e `CHANNEL_ENCRYPTION_KEY`, mas não contém `SOCIO_META_APP_ID`, `SOCIO_META_APP_SECRET` ou `SOCIO_META_GRAPH_VERSION`. Valores privados não foram expostos.

O navegador conectado expirou por timeout. O navegador de nuvem abriu o endereço do app e recebeu a tela de login da Meta, sem sessão autenticada. Não foi possível conferir ou alterar o painel interno do app.

Testes locais: sete testes de segurança do módulo oficial e oito testes relacionados a migração/permissões (15 no total), todos aprovados. Teste real de OAuth, PostgreSQL integrado e navegador autenticado ainda pendentes. Não houve deploy desta branch.

## Próximos recursos além da conexão

A atribuição de leads pelo WA-AKG, comandos de grupos, relatórios programados e executor autônomo de campanhas não fazem parte desta primeira integração. A origem de lead só poderá ser marcada como confirmada quando existir identificador verificável; mensagem com código/UTM sozinha não prova causalidade de venda. Conferir payloads reais do gateway antes de definir garantias.

## Complemento para homologação

Implementadas páginas públicas `/privacidade.html`, `/exclusao-dados.html` e `/termos.html` (condições específicas do teste), com estilo responsivo. Retornos assinados: `/api/marketing/official/deauthorize` e `/api/marketing/official/data-deletion`; recebem `signed_request` em formulário e validam HMAC-SHA256, usuário e data antes de remover credenciais. O status público contém somente confirmação e escopo, sem identificadores de usuário ou empresa. Revogações invalidam autorizações iniciadas anteriormente, com trava transacional por conta/ator. Desconexão local remove apenas o vínculo daquele usuário/empresa; solicitação assinada da Meta remove todos os vínculos daquela conta Meta.

A interface passa a mostrar a conexão oficial mesmo enquanto aguarda configuração, com mensagem explícita e sem encaminhar ao instalador local. A versão Graph aceita `SOCIO_META_GRAPH_VERSION` ou a variável já existente `META_GRAPH_VERSION`.

Validação adicional: cenário completo executado em PostgreSQL embarcado (PGlite): duas empresas, troca de código, replay rejeitado, isolamento, empresa pausada, criptografia persistida, remoção assinada, repetição idempotente e reconexão nova. O mesmo cenário foi incluído na CI com PostgreSQL real via `DATABASE_URL`. Esse teste não substitui a autorização no Meta nem a homologação visual autenticada.
