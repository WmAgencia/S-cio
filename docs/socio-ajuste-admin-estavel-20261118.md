# Sócio — ajuste de administração estável

Data: 18/11/2026

## Problema

O serviço roda a partir de `WmAgencia/S-cio` no Railway. Por enquanto o push
para `main` não dispara deploy sozinho, então uma correção publicada pode ficar
parada no GitHub sem ninguém perceber.

Enquanto o token do Railway está ligado à conta `espacolagoesmeraldasite`, que
não é a dona do repositório, existe duas saídas:

1. **Vincular o repositório com a conta dona** (recomendado): no painel do
   Railway, em `socio-app` → Settings → Source, desconectar e reconectar com a
   conta `WmAgencia` que tem escrita no repositório. A partir daí todo push em
   `main` que passa na CI ("Validar Sócio") publica sozinho.
2. **Deploy manual**: `railway redeploy --service socio-app --commit <sha> -y`
   depois de cada push. Funciona, mas depende de alguém rodar o comando.

## O que nunca deve ser feito

- Dar deploy sem CI verde: a CI roda os 788 testes e o `npm audit`.
- Publicar código que não está em `main` no GitHub: o Railway busca o commit
  pelo hash no repositório.
- Usar a conta `espacolagoesmeraldasite` para enviar código. Ela tem apenas
  leitura no repositório do Sócio.
