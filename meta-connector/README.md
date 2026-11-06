# Conector Sócio Meta Ads para Windows 64 bits

Extraia o ZIP e abra `instalar.cmd`. O instalador atua somente no seu usuário, baixa Node.js 24 do site oficial e verifica o SHA-256, instala as dependências fixadas e registra o protocolo `socio-meta:`. Não precisa executar como administrador. É necessário Chrome ou Edge instalado.

Depois da instalação, volte ao Sócio, abra Meta Ads e clique em **Conectar no meu navegador**. Confirme a abertura do conector pelo navegador. Uma janela separada de Chrome/Edge, com perfil exclusivo do conector, abrirá a página real da Meta no seu computador.

Conclua pessoalmente o login e todas as verificações. Depois feche a janela da Meta aberta pelo conector. Mantenha a janela do conector aberta enquanto usar as operações pelo Sócio. Para reabrir depois, use **Iniciar Conector Socio** na área de trabalho.

Email, senha, teclas e cookies da Meta não são enviados ao servidor do Sócio. Os cookies ficam no perfil local e no armazenamento cifrado do api-anything. O servidor recebe estado da conexão e resultados das operações autorizadas, que podem incluir dados das suas campanhas. O operador deste computador controla seu perfil de navegador e precisa proteger os arquivos locais.

A instalação não publica uma extensão na loja nem cria aplicativo Meta. Não contorna CAPTCHA ou 2FA. Um navegador local ainda pode receber verificações da Meta. Não foi realizado login real durante os testes automáticos.

Cada conexão começa sem operações aprendidas. O administrador precisa capturar e validar cada operação com autorização para usar a conta. Campanhas, uploads, pixels e pagamentos não são declarados disponíveis apenas porque o login foi concluído.

Para revogar o acesso do conector ao Sócio, clique em **Desconectar computador** na seção Meta Ads. Isso não encerra todas as sessões da sua conta Facebook. Feche a janela do conector para encerrar o processo local.

Os arquivos ficam em `%LOCALAPPDATA%\SocioMetaConnector`. O token do conector é cifrado pelo armazenamento de chaves do sistema operacional. Ele não concede acesso às outras empresas ou usuários do Sócio. Nunca envie esse token, cookies ou senhas pelo chat.
