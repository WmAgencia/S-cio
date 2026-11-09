# Sócio: vídeo enviado pelo WhatsApp → biblioteca Meta → anúncio pausado
Data: 2026-11-09

## Diagnóstico
Antes, Sócio enviava imagens para a Meta, mas não buscava MP4 enviado na conversa WA-AKG nem criava anúncio a partir de vídeo. Uma mídia adicionada à biblioteca não equivale a um anúncio no gerenciador.

## Fluxo implementado
1. Em Meta Ads > Importar vídeo que enviei pelo WhatsApp, escolher o canal da empresa e o número destinatário do vídeo enviado.
2. Localizar somente o último VIDEO enviado pela empresa (fromMe=true) ao JID exato do destinatário, conferindo sessão WA-AKG ativa e tenant.
3. Conferir a data/hora e autorizar o upload. Recuperar mídia via gateway privado e validar MP4, MIME e tamanho de até 64 MiB.
4. Enviar multipart à biblioteca de vídeos da conta Meta selecionada com grant ads_management do proprietário; gravar videoId. Processamento da Meta pode continuar.
5. Para criar de fato o anúncio: escolher Página autorizada, conjunto de anúncios existente, link HTTPS, título e texto. O sistema valida que o vídeo foi importado pelo mesmo tenant e conta e que a Meta informa status ready.
6. Preparar uma prévia e exigir nova confirmação para criar o criativo de vídeo e anúncio PAUSADO. Retornar creativeId e adId.

## Segurança
- A conversa do destinatário NÃO recebe papel de proprietário. A autoridade vem do usuário autenticado no Sócio e sua conta Meta autorizada.
- Os registros em socio_whatsapp_meta_video_imports são únicos por tenant, canal, conta e mensagem; POST incerto não é repetido automaticamente.
- O número do destinatário fica como hash SHA-256 na auditoria de mídia, sem concessão de permissões.
- O plano de anúncios é isolado por tenant, usuário e conta e exige confirmação novamente. Não ativa anúncios, gasta verba, envia WhatsApp ou altera orçamentos.
- socio_whatsapp_meta_video_pilot_jobs protege uma tentativa automática única solicitada explicitamente, com corte temporal e conta, origem e destino exatos. O registro é criado ANTES do efeito externo.

## Pilotagem limitada, caso seja autorizada
Variáveis requeridas: SOCIO_WA_VIDEO_PILOT_ONCE=true, SOCIO_WA_VIDEO_PILOT_ID=UUID único, SOCIO_WA_VIDEO_PILOT_SOURCE=55DDD..., SOCIO_WA_VIDEO_PILOT_DESTINATION=55DDD..., SOCIO_WA_VIDEO_PILOT_ACCOUNT=act_ID, SOCIO_WA_VIDEO_PILOT_CUTOFF=timestamp UTC posterior ao envio.
Somente um proprietário/admin com OAuth ads_management da conta selecionada e canal WA-AKG correspondente poderá disparar. O cutoff expira em 72 horas. A tentativa nunca é repetida após reinício.

## Critérios de homologação
- Suíte automatizada Node/PostgreSQL e backup-worker totalmente verdes.
- Consulta real ao WA-AKG deve identificar o vídeo exato e recuperar os bytes corretos; logs podem mostrar mídias antigas indisponíveis.
- Meta deve devolver videoId real, status ready após processamento, e posteriormente adId ao criar a campanha/anúncio pausado.
- Se faltar videoId ou adId, não comunicar sucesso.
