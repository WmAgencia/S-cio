# Sócio — Fase 1, homologação obrigatória (WhatsApp + Groq + atendimento)

**Status:** branch de homologação, não liberada a clientes. A PR #24 não deve ser mesclada apenas por passar na CI.

## Experiência construída

- Painel WhatsApp: somente os filtros Todas / IA respondendo / Humano respondendo.
- Humano pode enviar texto, mensagens com 1–3 botões Native Flow e produto cadastrado.
- Mensagem de produto inclui **foto JPEG real do S3 privado da própria empresa**, nome, preço, descrição, variações disponíveis e botões Tenho interesse, Ver opções, Falar com atendente.
- O envio é sempre para a conversa existente e número confirmados no tenant. Dados de imagem não ficam em URLs públicas arbitrárias.
- A IA Groq só seleciona um produto quando o pedido é explícito e o nome é inequívoco. Se faltar foto, produto estiver indisponível ou houver ambiguidade, não envia produto errado.
- Se o cliente pedir menu expressamente, a IA pode apresentar botões. Selecionar um botão vira mensagem recebida; pedido de atendente transfere para Humano.
- Sincronização prioritária de conversas com botões recentes: a cada 3,5 s, limitada a poucas conversas; respostas com debounce de 3 s.
- Registros de envio persistem ID de solicitação, tipo e fingerprint. Não se repetem automaticamente envios de resultado incerto.

**Limitação honesta:** é um cartão interativo WhatsApp com foto e respostas rápidas, **não** um item de um catálogo comercial oficial da Meta (que exigiria catálogo associado).

## Verificações de desenvolvimento

- [x] Unidade: HMAC, validação de botões, JPEG, seleção de produto, tenant, idempotência.
- [x] Integração simulada: retorno do gateway, cliente clicando opção, pedido de humano.
- [x] CI de código: testes, banco de teste, syntax checks.
- [x] Build do gateway WA-AKG com patch de interação assinado (validado em PR).
- [ ] QR Code validado com WhatsApp real de teste.
- [ ] Envio real humano → contato controlado com recibo.
- [ ] Foto + descrição + preço renderizados no Android e/ou iOS.
- [ ] Clique em botão recebido, deduplicado e respondido na sequência pelo Groq.
- [ ] Modo humano/IA alternado durante conversa real sem respostas simultâneas.
- [ ] Envio do produto correto a partir de um pedido vindo de anúncio.
- [ ] Simulador Groq com chave privada rotacionada validado contra a API de produção.
- [ ] Reconexão após reiniciar o WA-AKG; mídia e histórico preservados.
- [ ] Verificação de vulnerabilidades críticas do WA-AKG e decisão de atualização/pin seguro.
- [ ] Teste mobile e acessibilidade com teclado/voz.
- [ ] Registro da aprovação e rollback antes de subir a produção.

## Roteiro do teste real (sem enviar para clientes)

1. Conectar **um número WhatsApp controlado** pelo QR no Sócio, registrar nome/número retornado e reiniciar o gateway em teste.
2. Usar **outro telefone também controlado** como destinatário. Enviar mensagem de entrada e conferir tenant/histórico.
3. Em Humano, enviar mensagem de texto e botões. Escolher opções em outro celular, conferir mensagem normalizada e atendimento.
4. Selecionar produto cadastrado com foto. Conferir visual no celular, foto do arquivo correto, estoque/preço e resposta ao clique.
5. Entregar para IA. Pedir foto citando inequivocamente um produto ativo; conferir se a foto certa e o botão chegam ao mesmo contato.
6. Pedir humano e "parar". Conferir mudança de modo, ausência de respostas da IA e histórico completo.
7. Testar duas empresas com catálogos e WhatsApps separados, incluindo tentativas de acessar mídia de outra empresa.
8. Testar timeout e duplo clique em Enviar: uma solicitação não pode gerar duas mensagens.
9. Conferir logs de segurança sem segredos e obter aprovação da operação.

**Regra de publicação:** PR permanece aberta até os testes com o telefone real e a verificação de segurança. Não apresentar entrega final como testada enquanto WA-AKG tiver zero sessões.
