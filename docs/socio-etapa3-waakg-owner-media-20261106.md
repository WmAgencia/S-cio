# Sócio — Etapa 3: comandos, fotos e áudios do proprietário pelo WA-AKG

## Entregas técnicas

1. **Texto:** o worker já existente `socio-owner-skill-inbox.mjs` atende apenas mensagens privadas, importadas pelo WA-AKG, de proprietário/admin ativo com telefone igual ao contato da conversa no próprio tenant. O prefixo obrigatório é `Sócio,`; comandos com prévia exigem `Sócio, pode criar` por texto.
2. **Foto:** o novo `socio-owner-skill-media.mjs` consulta mensagens recentes do WA-AKG em conversas de proprietário verificadas, baixa diretamente do endpoint autenticado de mídia já conhecido, checa tipo/MIME/assinatura/tamanho e só envia a foto para a Meta se houver uma campanha **daquele proprietário e tenant** aguardando imagem. A skill responde com a prévia normal: campanha permanece PAUSADA até confirmação textual.
3. **Áudio:** mensagem do proprietário pode ser enviada a Groq Whisper (`whisper-large-v3-turbo`, idioma pt) **somente quando o usuário/operador habilitou a transcrição** e a sessão/verificação do proprietário passaram. Áudio sem prefixo `Sócio,` não é comando. **Aprovação por áudio nunca dispara execução ou gasto**: pedir confirmação por texto.
4. **Deduplicação:** `socio_owner_media_receipts` registra `tenant_id`, canal e ID da mensagem. Um envio ambíguo não é automaticamente reenviado; se o upload externo ocorrer e depois a resposta falhar, não se repete a operação.
5. **Segurança:** sem grupos, contatos comuns, mídia arbitrária por URL, mensagens em massa, downloads com redirecionamento, arquivo maior que 3 MB (imagem) ou 10 MB (áudio), comandos de outros tenants, nem ativação de campanhas.

## Habilitação — DESLIGADO POR PADRÃO

Worker e importação:
- `SOCIO_OWNER_COMMANDS_ENABLED=true`: ponte privada de texto, somente após homologação real e saída WA-AKG autorizada.
- `SOCIO_OWNER_MEDIA_ENABLED=true`: leitura e processamento de mídia do owner; requer flag de comandos e `SOCIO_OUTBOUND_ENABLED=true`.
- `SOCIO_OWNER_AUDIO_ENABLED=true`: somente áudios recebidos pela ponte de mídia, requer `GROQ_API_KEY` válida e autorização de tratamento de voz.
- `SOCIO_OWNER_MEDIA_TENANT_ID=<UUID do tenant de teste>`: obrigatório na primeira homologação; impede varredura de mídias das outras empresas quando a ponte for ativada.

**Estas flags não são ligadas por esta PR.** O gateway WA-AKG é mantido. Como não havia sessões ativas no último diagnóstico, não há teste físico de mídia nem autorização para ativar este processamento para todos os tenants.

## Critérios para homologar e habilitar

1. Um número real de teste conectado ao gateway WA-AKG, conferido como `CONNECTED` e com o mesmo número do canal do Sócio.
2. Usuário owner/admin ativo no mesmo tenant, telefone individual verificado, consentimento explícito para transcrição por IA e aviso de uso da Groq.
3. Enviar `Sócio, quero anunciar roupas femininas em Sorocaba com R$ 6 por dia`; confirmar prévia, ausência de POST externo antes do aceite e `SOCIO_OUTBOUND_ENABLED` após teste de HMAC.
4. Enviar foto de produto: conferir MIME/limite, hash Meta, prévia vinculada ao mesmo `runId`, e nenhum vazamento de mídia entre empresas.
5. Enviar áudio contendo `Sócio, ...`: conferir transcrição, pergunta contextual e nenhuma execução financeira; tentativa de aprovação por áudio deve pedir confirmação textual.
6. Enviar `Sócio, pode criar` em texto: executar somente itens PAUSADOS e guardar IDs Meta reais. Não ativar campanha sem nova autorização.
7. Simular timeout WA-AKG, mensagens duplicadas, mensagens de não proprietários e outros tenants: nenhum reenvio nem mutação indevida.
8. Verificar monitoramento no Railway, privacidade, exclusão/retenção de dados e limites de solicitações antes de habilitar para clientes.

## Pendências fora deste release

- Comandos de **grupo** exigem identificar remetente individual de forma confiável, ACL específica por grupo e proteção contra mensagens de terceiros. Permanecem bloqueados.
- Áudio não possui interface de resposta por voz nem recursos full-duplex. O Sócio responde em **texto** via WA-AKG neste estágio.
- O gateway de mídia precisa de homologação real do formato de mensagens e do endpoint binário em fotos/áudios. Seus contratos foram deduzidos de vídeo existente e testados com mocks, portanto não chamar mídia de homologada até o teste físico.
- O Google Ads OAuth/API não foi integrado; não pode ser tratado como Meta Ads. Sites/pixels/CAPI continuam em etapa separada.
- A IA não deve inferir vendas ou resultados apenas de conversas de WhatsApp sem confirmação de pagamento.


## Complemento: diagnóstico no painel (Etapa 3)

Novo endpoint somente leitura `GET /api/marketing/skills/whatsapp-readiness`, protegido pela permissão `marketing.manage`, módulos habilitados e isolamento pelo tenant autenticado. O endpoint não divulga tokens, números ou IDs de sessão; resume:

- Quantidade de canais WA-AKG vinculados e sessões confirmadas pelo gateway;
- Se existe conversa privada de proprietário/admin com telefone único verificado;
- Se texto, mídia e áudio estão tecnicamente habilitados para o piloto;
- Quais dependências impedem iniciar uma homologação.

O painel de skills ganhou a ação **Verificar conexão WA-AKG**. Consultar o diagnóstico não habilita workers, não envia mensagens, não cria anúncios, não muda sessões e não informa que grupos estão suportados.

A consulta de comandos privados por texto passou a exigir unicidade do proprietário cadastrado, mesma proteção já exigida pela ponte de mídia. É uma etapa de segurança que antecede a ativação do piloto.

### Situação operacional desta verificação

Os logs recentes da produção indicam `reachable:true`, `authorized:true` e `sessions:0` para o gateway. Assim, comandos privados, fotos e áudios estão implementados em código, mas **não homologados fisicamente e não habilitados para clientes**. O próximo passo operacional é o proprietário conectar uma sessão de teste e conferir a identidade do número no Sócio, para validar o recebimento e a resposta reais.
