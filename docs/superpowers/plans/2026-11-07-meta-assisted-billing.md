# Meta billing assistido e saldo — implementação
Objetivo aprovado: informar valor no Sócio, preparar a recarga Pix na Meta e identificar saldo para avisos de esgotamento. Mesmo login Sócio; OAuth não substitui a sessão separada de faturamento.

Arquitetura: API oficial preservada; navegador isolado existente opera o faturamento. Não há replay de POST financeiro privado, transferência nem pagamento automático. A pessoa revisa o total e avança na página oficial.

- [x] Parser BRL que exige URL/ID, nome confirmado, saldo único e validade de 15 minutos.
- [x] Saldo baixo até R$30 ou até 3 dias de gasto médio; crítico em zero ou até 1 dia. Ausência não vira zero.
- [x] Persistência da observação e alerta por tenant/usuário/conta, sem DOM bruto em banco.
- [x] Rotina de leitura a cada 5 minutos somente para contas previamente observadas. Se perder login, expira a leitura e pede conexão.
- [x] Formulário de valor e tela oficial para revisão de impostos e Pix. Não clicar automaticamente em Avançar/Pagar.
- [x] Leitura de código visível com CRC, moeda BRL e valor exato. Sem QR simulado ou confirmação falsa de pagamento.
- [x] API refresh/prepare/pix/status autenticada e conta resolvida no servidor.
- [ ] CI e testes de regressão.
- [ ] Homologação com sessão de faturamento conectada pelo proprietário no navegador isolado.
- [ ] Grupo WhatsApp e notificação externa: vincular destino por empresa e consentimento antes de enviar. Continua na issue #92, não incluído como envio ativo.

Limites: layout da Meta pode mudar. O fluxo então pede interação na tela oficial. Pix sem valor EMV verificável não será copiado pelo Sócio, mas o QR oficial continua disponível na tela da Meta. Impostos sempre determinados pelo provedor. Não armazenar cookies, senha, código Pix ou DOM bruto em auditoria. Dados financeiros em tabelas privadas por empresa. Observações stale não geram alerta de saldo atual.
