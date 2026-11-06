# Sócio — Pixel e rastreamento completo (etapa de criação)

## Entrega efetiva nesta etapa

**Meta Ads:** consulta de Pixels já existia; agora o proprietário autorizado pode solicitar um Pixel novo pelo painel ou comando em português (`Crie um Pixel chamado Loja X`). O Sócio usa o aplicativo OAuth oficial e a conta de anúncios selecionada, exige `ads_management`, consulta os Pixels disponíveis na conta, grava uma prévia de 15 minutos e só faz o POST na Meta após confirmação explícita. O POST usa `/{act_account_id}/adspixels` e retorna o ID do novo Pixel. Nenhum Pix de recarga, gasto em anúncios, integração financeira, envio WhatsApp ou evento de conversão é produzido por criar o Pixel.

**Proteções:** conta + tenant + usuário vinculados; proíbe criação se a Meta já retorna Pixel na conta ou paginação adicional; revalida antes do POST; trata resultado incerto sem reenvio automático; audita usando a ferramenta `/api/marketing/tools/execute`. Permissões de acesso dependem do aplicativo Meta Developers e do negócio autorizado. Algumas contas têm limites de quantidade de Pixels.

**WA-AKG:** segue intocado como canal de WhatsApp, sem uso de WhatsApp Cloud API oficial.

## Rastreio ponta a ponta: etapas independentes

| Camada | Eventos ou sinal | Requisito para afirmar que funciona |
| --- | --- | --- |
| Meta Pixel no navegador | `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Lead` | Instalação no domínio próprio, após consentimento; evento aparece no Events Manager |
| Meta Conversions API (server) | Mesmos eventos e `Purchase`, com `event_name`, `event_time`, `event_id` e `action_source` | Credencial CAPI autorizada do dataset, endpoint protegido, teste de evento confirmado na Meta |
| Deduplicação | `eventID` browser = `event_id` servidor na mesma conversão + nome de evento | Eventos duplicados não aumentam conversões após validação no Events Manager |
| Pagamento real | `Purchase` somente após webhook autenticado de pedido liquidado | Fonte de pagamento (Stripe ou outro) verificada, moeda/valor/order ID corretos |
| Anúncios para WhatsApp | Origem da campanha, adset, anúncio, referência quando fornecida pelo WA-AKG | Payload real validado; no MVP código em mensagem é **indício**, não Meta click |
| Relatórios | Investimento, visitantes, leads, oportunidades, vendas confirmadas | Coleta consistente, período, fuso, consentimento e separação de métricas |

### Princípios

- Nunca gerar `Purchase` a partir de clique, mensagem, orçamento ou intenção. Confirmar via webhook de pagamento.
- Nunca criar um Pixel duplicado automaticamente. Se a conta já tem Pixel, utilizar o existente quando autorizado.
- Não injetar pixel em site sem controle de consentimento. Para CAPI, usar dados mínimos permitidos e consentidos, com retenção e isolamento por tenant (LGPD).
- Site e checkout de cada cliente exigem integração própria. Criar um Pixel no Meta Ads **não instala o rastreamento automaticamente**.
- Um evento rastreável no website não equivale à conversão atribuída pela Meta.
- Os testes unitários exercitam uma API Meta **simulada**. A homologação real depende de uma conta de testes com permissão `ads_management` e da confirmação no Events Manager.

## Próximo teste real

1. Entrar no Sócio e selecionar a conta Meta autorizada da própria empresa.
2. Abrir `Meta Ads > Criar ou configurar Pixel da Meta`; consultar Pixels existentes.
3. Se **não** houver Pixel e a Meta permitir, preparar um nome, revisar a conta e confirmar a criação.
4. Verificar o ID retornado no Events Manager.
5. Instalar e testar cada evento no site sob controle do cliente. Depois fazer integração CAPI e webhook de pagamento, sem trafegar dados de clientes entre empresas.
