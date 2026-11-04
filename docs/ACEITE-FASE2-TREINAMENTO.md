# Sócio — Homologação da Etapa 2: treinamento e Markdown

Data: 04/11/2026

## Escopo implantado na branch de homologação

- Um clique em **Treinar**, com verificação de cada sessão WhatsApp e isolamento de empresa.
- Progresso baseado em números de sessões, chats e tarefas efetivamente processadas, nunca contagem inventada.
- Até dez números conectados por execução; WA-AKG limita histórico recuperado, atualmente a até 50 conversas por número e 400 mensagens por conversa. O conhecimento sintetiza amostras de até 80 mensagens por conversa, devidamente sinalizadas.
- Uma execução automática considera somente as fontes relacionadas às conversas e números efetivamente lidos na execução. Conversas inalteradas reutilizam o último snapshot vinculado àquele contato; importações de outras fontes e execuções não são incluídas.
- Scans interrompidos geram status de falha, não um falso relatório com dados antigos.
- O job de análise e a atualização do treinamento são atômicos no banco.
- Groq recebe apenas indicadores agregados e orientações, **sem trechos literais e informações identificáveis dos clientes**. Quando indisponível ou produzir dados suspeitos, o sistema usa o resumo determinístico, identificando a origem no relatório.
- Cada Markdown é um **rascunho inativo**, pode ser revisto e baixado como `.md`, e só vira contexto do agente após aprovação humana.
- Histórico de versões com restauração de conhecimento antigo e atualização transacional do agente. Nenhum restauro envia mensagem por WhatsApp ou habilita resposta automática.
- Endpoints de revisão/aprovação/restauração são protegidos por autenticação, CSRF, perfil e `tenant_id`.

## Critérios de aceite

- [x] Teste unitário: análise agregada sem e-mail, telefone, nomes ou exemplos literais.
- [x] Teste unitário: Groq com saída contendo contatos inventados usa fallback seguro.
- [x] Teste unitário: origem exclusiva nos snapshots da execução corrente, inclusive conversas inalteradas.
- [x] Teste unitário: scan falhou → status de falha, sem considerar importações antigas.
- [x] Teste unitário: consistência transacional do job com o estado do treinamento.
- [x] Teste unitário: cálculo real de progresso, fontes, amostragem e cobertura.
- [x] Testes de integração com PostgreSQL real: revisão, aprovação, segunda versão, restauração e acesso cruzado negado.
- [x] Teste de integração com PostgreSQL real + WA-AKG simulado: leitura, reprocessamento de contato inalterado e geração de rascunho sem tocar no conhecimento ativo.
- [ ] **Homologação com um WhatsApp realmente conectado**, contendo conversas autorizadas, para conferir a cobertura e a pertinência do relatório.
- [ ] **Revisão humana do Markdown de uma empresa real** antes de qualquer ativação de conhecimento.
- [ ] **Teste da API Groq real**, com nova credencial privada após a rotação da chave exposta anteriormente.

## Não é a Etapa 3

Esta entrega não cria cobranças, pedidos de produtos ou campanhas. O WhatsApp, o Prospector e a produção atual permanecem inalterados até a conclusão das validações necessárias.

## Publicação

O código deve permanecer em PR **Draft** até validação de um WhatsApp real. CI verde comprova qualidade do código e do ambiente de teste, não a completude do histórico de um cliente.
