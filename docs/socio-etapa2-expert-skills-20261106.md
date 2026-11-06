# Sócio — Etapa 2: núcleo de especialistas e skills

## Entrega desta versão

O sistema continua com **um único canal de solicitação** (`POST /api/marketing/skills/chat`) e as ferramentas reais já autorizadas. Foi acrescentado um registro de especialistas com seis guias `skills/*/SKILL.md`, versionados no repositório:

1. `meta.campaigns`: criação supervisionada de campanhas Meta via OAuth oficial, conta selecionada e objetos PAUSADOS.
2. `google.ads`: estratégia documentada **sem execução**, porque Google Ads OAuth/API ainda não está conectado.
3. `tracking.conversions`: planejamento Pixel/CAPI e atribuição, sem alegar instalação automática.
4. `meta.optimization`: diagnóstico e boas práticas, sem alterações não autorizadas.
5. `whatsapp.sales`: atribuição indicativa e funil, via WA-AKG; sem Pixel dentro de conversas.
6. `marketing.reports`: medidas de desempenho, distinguindo Meta, WhatsApp e pagamento confirmado.

`GET /api/marketing/skills/catalog` lista tanto os recursos anteriores quanto o novo registro de especialidades (com status real). `GET /api/marketing/skills/guidance?id=meta.campaigns` retorna somente arquivos allowlist para usuários autenticados com acesso a marketing. A implementação de estratégias executáveis **continua em código**, não em texto Markdown.

## Decisão segura por plataforma

- Pedidos explícitos por Google Ads, AdWords, rede de pesquisa ou Google tag **não** são reinterpretados como comandos Meta Ads.
- Pedidos das duas plataformas juntos são bloqueados antes de criar qualquer operação; a integração Google é relatada como pendente.
- Pedidos sobre origem, respostas e vendas via WhatsApp não inventam resultados. O Sócio distingue sinal indicativo de compra comprovada.
- Pedidos de CAPI, eventos e Pixel no WhatsApp recebem explicação técnica correta; nenhuma instalação é simulada.
- Solicitações válidas somente de Meta Ads continuam nas skills existentes, protegidas por RBAC, tenant, conta selecionada, planos revisáveis, orçamento e idempotência.

## Melhorias no painel

- Exibe as especialidades conhecidas e indica que Google Ads ainda depende de integração.
- Não declara “campanha criada” para uma simples consulta.
- Se o cliente pede Google Ads com foto, **não** envia essa foto para a biblioteca Meta por engano.
- Ações de veiculação ou gasto continuam exigindo a confirmação existente. O WA-AKG não é substituído.

## Critérios de aceite — Etapa 2, parte núcleo

- Seis arquivos `SKILL.md` específicos e carregáveis no servidor exclusivamente por IDs allowlist.
- Solicitações Google Ads e Google+Meta não podem chegar ao executor Meta, comprovadas por testes com pool falso que falha caso seja usado.
- Pedidos de rastreamento e WhatsApp não geram compras, pixels ou resultados inventados.
- Suite Node/PostgreSQL, teste de UI automatizado, worker de backup e verificação de dependências em verde.
- Publicação Railway com status SUCCESS e inicialização sem regressão.

## Limites e validação adicional (próximas etapas do plano)

Esta entrega não cria OAuth/API Google Ads, não adiciona CAPI a sites, não homologa envio de fotos/áudios em WhatsApp e não otimiza contas sem autorização. A análise de campanhas Meta ainda precisa de conta real, evidência de entrega e testes de resultado. Para o padrão “gestor de tráfego profissional”, faltam integração Google oficial, rastreamento completo por domínio/checkout, motor de otimização com supervisão e testes reais de WA-AKG.
