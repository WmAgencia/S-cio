# Sócio — Conexão simplificada de contas

Atualização: 04/11/2026.

## Objetivo da experiência

O proprietário de uma empresa deve entrar em **Anúncios e métricas** e ver apenas
**Conectar Meta Ads** e **Conectar Google Ads**, sem tokens, IDs de cliente,
scripts nem necessidade de criar aplicativo em Meta Developers ou projeto Google Cloud.

A interface inicia o OAuth hospedado do Pipeboard com PKCE e redireciona o usuário
para o login seguro do parceiro. No retorno, o Sócio salva apenas o consentimento
da empresa e marca **"Login Pipeboard autorizado"**.

**Não mostrar "Conta de anúncios conectada" antes de verificar o acesso
efetivo àquela conta.** Uma autorização do login do parceiro não garante que
o usuário selecionou ou possui acesso a uma conta específica.

### Meta Ads e Google Ads — login hospedado Pipeboard

- MCP Meta Ads: https://meta-ads.mcp.pipeboard.co/
- MCP Google Ads: https://google-ads.mcp.pipeboard.co/
- Portal de conexão da conta: https://pipeboard.co/connections
- Documento Pipeboard: https://pipeboard.co/guides/ads-mcp

O backend implementa descoberta OAuth via metadados de recurso e de autorização,
registro dinâmico de cliente quando anunciado e, como alternativa, o padrão
**Client ID Metadata Document**. Cria estado aleatório de uso único e expiração
de 10 minutos e usa PKCE SHA-256. Credenciais concedidas pelo OAuth são
cifradas com AES-256-GCM em `marketing_oauth_grants`, com uma chave derivada
da `CHANNEL_ENCRYPTION_KEY` existente.

Endpoints:
- `GET /.well-known/oauth-client`: metadados do Sócio, sem credenciais.
- `POST /api/marketing/oauth/start`: inicia consentimento (owner/admin + CSRF).
- `GET /api/marketing/oauth/callback`: troca code por token após validar state.
- `GET /api/marketing/oauth`: estados de autorização, sem tokens.
- `POST /api/marketing/oauth/:provider/disconnect`: revoga **a cópia local**.
 
**Rejeição segura:** metadados e URLs fora dos domínios autorizados `pipeboard.co`
não são aceitos. Isso pode impedir a conexão caso o provedor altere a
infraestrutura de login; é preferível falhar à possibilidade de SSRF ou vazamento
de token.

Uma conexão OAuth concluída não habilita criação, edição, pausa ou orçamento
de campanhas. O recurso ainda exige verificação da conta de anúncios, consentimento
e autorização para ações específicas. A revogação local não cancela a
autorização existente no portal do Pipeboard, que também deve ser gerenciada
pelo titular em https://pipeboard.co/connections.

**Validação:** testes com provedor simulado e PostgreSQL descartável.
Login **real no Pipeboard ainda depende de uma conta que conceda consentimento**
e da disponibilidade dos endpoints OAuth do parceiro.

### Instagram — login hospedado (alternativa segura à API privada)

`aiograpi-rest` continua instalado na rede privada do Railway exclusivamente
como **laboratório**, sem nenhuma sessão real do Instagram. Ele não fornece OAuth
oficial, portanto **não pode reproduzir sozinho o login de um clique**.

Para ter a experiência de um clique e não pedir senhas no Sócio, foi adicionado
o conector opcional **Ayrshare Business**, que utiliza um parceiro com login social
hospedado e autorização da conta profissional.

Documentação:
- https://app.ayrshare.com/docs/multiple-users/api-integration-business
- https://app.ayrshare.com/docs/apis/profiles/generate-jwt

O Sócio cria um perfil isolado por empresa, armazena a chave de perfil
**cifrada**, gera URL SSO curta mostrando apenas Instagram, e verifica
`activeSocialAccounts` no provedor antes de exibir **"Instagram conectado"**.
Desconectar solicita revogação efetiva no provedor.

O conector fica **desabilitado** até a Consecom possuir contrato de plano
Business/Enterprise e cadastrar as seguintes variáveis em Railway (segredos
somente no serviço `socio-app`):

- `AYRSHARE_API_KEY` — chave oficial de conta principal.
- `AYRSHARE_SSO_DOMAIN` — domínio SSO atribuído no onboarding.
- `AYRSHARE_PRIVATE_KEY` — chave privada RSA do pacote de integração,
  preservando as quebras de linha.
- `SOCIO_PUBLIC_URL` — endereço HTTPS existente da aplicação.
- `CHANNEL_ENCRYPTION_KEY` — já configurada no Sócio.

O parceiro pode ter custos por quantidade de perfis e permissões de mensagens.
**Não ative automaticamente** sem aceitar os custos e avaliar os termos de uso.

### Proteções multiempresa

- Nenhum token ou senha do usuário é exibido no frontend depois da autorização.
- Cada grant e cada perfil social pertence a um tenant do banco.
- Login depende de owner/admin; callback de OAuth não confia em email, ID
  ou conta informada pelo navegador.
- State de OAuth é consumido somente uma vez.
- No Supabase o banco ainda é **ambiente privado de preparação**, não a produção.
- Testes com serviço OAuth / Instagram simulados não substituem um teste real
  com duas contas consentidas.
- O mecanismo antigo de token Pipeboard e script Google Ads continua disponível
  no backend para compatibilidade, mas foi retirado dos formulários principais.

## Próxima homologação de contas

1. Meta Ads: entrar via "Conectar Meta Ads", selecionar contas no Pipeboard,
   confirmar se o retorno OAuth permite leitura da conta desejada.
2. Google Ads: repetir pela autorização Google hospedada no Pipeboard; não
   é mais necessário copiar código de Scripts no fluxo principal.
3. Instagram: ativar somente se a agência optar pelo plano do parceiro;
   usar uma conta de testes e verificar autorização e revogação.
4. Com contas diferentes de duas empresas, confirmar que não há acesso
   cruzado e que desconectar bloqueia novas leituras.

Nenhuma credencial de cliente foi adicionada a arquivos ou enviada para
um serviço não autorizado durante esta implementação.
