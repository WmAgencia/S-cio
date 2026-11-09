# Sócio Inteligente — etapa 3: base de conhecimento rastreável

## Origem
Princípio adaptado do Prospector: somente conhecimento Markdown aprovado pode ser fonte factual. Foram auditados os arquivos de treinamento, aprovação e contexto da Francisca. O Sócio já contém versões de treinamento com estados draft, approved e archived.

## Implementado
- Segmentação Markdown por hierarquia de títulos, IDs de seções e localização da origem.
- Busca híbrida TEXTUAL em português brasileiro: termos exatos, palavras com flexão próxima, trigrama e grupos controlados de sinônimos. Não há embeddings nem busca vetorial.
- Resultados supported, insufficient ou no_approved_knowledge. Na ausência de evidência, o modelo é orientado a não inventar fatos da empresa.
- Recuperação canônica da versão aprovada na tabela training_versions, sempre filtrada pela empresa. Rascunhos e versões arquivadas não são considerados. Uma troca de versão aprovada passa a valer na próxima consulta.
- Prompt com marcadores K001, K002 etc., títulos das seções e versão da fonte; o conhecimento não dá permissão para executar ferramentas.
- Catálogo oficial continua sendo a única fonte de preço e estoque.
- Laboratório exibe os títulos das fontes e avisos de insuficiência sem expor o Markdown integral em metadados.
- Corrigida uma referência a variável ainda não inicializada no simulador.

## Ativação e compatibilidade
A variável SOCIO_APPROVED_KNOWLEDGE_V3=true habilita a recuperação no atendimento e no laboratório; por padrão ela permanece desligada. Sem fonte aprovada não há fallback para documentos em rascunho nem para um espelho potencialmente desatualizado. O restante do atendimento usa o catálogo oficial existente.

Nenhum envio WhatsApp, campanha, alteração financeira, migração ou deploy é ativado por esta etapa. Nenhuma nova tabela, API de embeddings ou dependência externa é necessária.

## Segurança e limites
A empresa é escolhida pelo escopo da sessão ou da própria conversa, nunca por um texto enviado pelo cliente. Dados em documentos são tratados como referências não confiáveis e não como comandos. As correspondências textuais não comprovam a verdade: supported significa TRECHO RELACIONADO e não uma checagem factual. Documentos devem ser revisados por operador autorizado. A orientação de incerteza reduz o risco de invenções, mas não garante ausência de alucinações.

## Critérios de homologação
- Rodar testes sintáticos e suíte completa com banco PostgreSQL.
- Conferir isolamento entre empresas e troca de versões aprovadas.
- Testar perguntas com evidência, sem evidência, com sinônimos e com documentos grandes.
- Revisar respostas e fontes manualmente antes da ativação em produção.
- Preservar flags de autoenvio, aprovação de ações e o histórico original.

## Próximas melhorias
Busca vetorial opcional com pgvector e embeddings, avaliação factual por afirmação, métricas de relevância, múltiplos documentos aprovados por empresa e auditoria completa de fontes. Esta entrega ainda não é RAG vetorial.
