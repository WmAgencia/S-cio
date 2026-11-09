# Sócio — Etapa 0: auditoria e preparo de piloto WhatsApp
Data: 2026-11-09

## Evidência de produção
- Railway: 8 serviços saudáveis no ambiente production; serviço socio-app no branch main com healthcheck aprovado.
- WA-AKG: log de inicialização "Loaded 0 sessions"; no aplicativo, gateway acessível e autorizado, mas sessions = 0. Isso não homologa comandos privados nem fotos.
- Variáveis SOCIO_OWNER_COMMANDS_ENABLED, SOCIO_OWNER_MEDIA_ENABLED, SOCIO_OWNER_AUDIO_ENABLED e SOCIO_OWNER_MEDIA_TENANT_ID não foram encontradas configuradas na instância socio-app em produção. Nenhuma delas foi ativada nesta etapa.
- As flags de memória e recuperação da base de conhecimento aprovadas, habilitadas anteriormente, não ativam envio de WhatsApp.

## CI
- Os runs de merge #101–#103 na main retornaram failure, mas a lista de jobs continha somente backup-worker (sucesso). Não há logs de test nesses runs; a causa não foi determinada.
- Uma execução nova na branch a partir do mesmo commit final da main registrou dois jobs: test e backup-worker, ambos com sucesso. Isso exclui uma falha reproduzível do código como explicação suficiente.
- Nesta alteração, o job de aplicação foi renomeado validate-application, usa ubuntu-latest, timeout de 30 minutos e verifica sintaxe dos novos módulos.
- O aceite exige Node/PostgreSQL e backup-worker aprovados e ambos executados, também no merge final da main.

## Correção do diagnóstico do proprietário
Antes, o diagnóstico podia classificar um piloto como pronto quando a sessão conectada estivesse no canal A e a conversa do proprietário em um canal B sem sessão.

Agora o SQL traz também os IDs dos canais com conversa privada de proprietário/admin identificado com unicidade. O diagnóstico exige que o mesmo canal tenha sessão WA-AKG realmente conectada e telefone correspondente. Na ausência dessa correspondência, textReady, photoReady e audioReady permanecem false e o motivo aparece nos blockers.

Em operational-readiness, um canal que conste como desligado no cadastro não é verificado como conectado só porque mantém um ID de sessão antigo. O status remoto é consultado com a configuração do próprio ambiente.

## Sequência de homologação física da Etapa 1
1. Selecionar empresa piloto, telefone e proprietário/admin autorizado, cadastrar número e conectar sessão WA-AKG via QR.
2. Confirmar mesmo canal e mesmo número de telefone entre sessão remota e conversa privada.
3. Enviar e receber mensagens de teste; validar idempotência e falhas.
4. Só após isso ativar comandos privados para o piloto autorizado, sem alterar a automação de outras empresas.
5. Subir foto de produto com MIME/tamanho válidos, vincular a campanha aguardando imagem, conferir hash Meta e prévia PAUSADA.
6. Solicitar aprovação textual separada para criar a campanha PAUSADA; ativação e gasto dependem de autorização independente.
7. Testar outro usuário e outro tenant, duplicações, timeout, desconexão, foto errada e áudio sem consentimento. Nenhuma ação indevida pode ocorrer.

## Pendências posteriores
Criativos profissionais em múltiplos formatos, Meta Ads real, atendimento comercial supervisionado com qualidade avaliada, pedido e pagamento de produção confirmados, Pixel/CAPI onde aplicável, observabilidade e onboarding SaaS. Testes automatizados não comprovam funcionamento de terceiros reais.

Proibido ativar envio, importar contatos de terceiros ou operar mídia de outras empresas sem conexão e autorização verificadas.
