// Tenant-neutral consultative sales guidance.
// This module neither collects payment data nor sends, charges or calls tools.
// Its topic classification is a conversational hint, never evidence of a sale.
export const SALES_CONVERSATION_VERSION='socio-consultative-sales-v1';
const normalize=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim().slice(0,1500);
const patterns=[
 ['optout',/\b(?:pare|parar de (?:mandar|responder)|nao me (?:mande|envie|contate)|nao quero receber|descadastrar)\b/],
 ['human',/\b(?:quero (?:falar com|um) (?:humano|atendente|responsavel|pessoa)|me passa (?:um|para o) atendente|atendimento humano)\b/],
 ['complaint',/\b(?:reembolso|estorno|devolucao|reclamacao|defeito|veio errado|insatisfeito|problema com meu pedido)\b/],
 ['declined',/\b(?:nao (?:quero|vou|pretendo) (?:comprar|contratar|fechar)|desisti de (?:comprar|contratar)|nao tenho interesse)\b/],
 ['objection',/\b(?:muito caro|ta caro|esta caro|preco alto|valor alto|nao cabe no (?:meu )?orcamento|nao tenho dinheiro|pouco dinheiro|consigo mais barato|achei caro)\b/],
 ['comparison',/\b(?:concorrente|outra (?:empresa|loja)|comparado a|comparar|diferenca (?:entre|para)|por que (?:com )?voces)\b/],
 ['purchase',/\b(?:quero comprar|vou levar|quero fechar|vamos fechar|pode fechar|quero contratar|aceito (?:a proposta|esse orcamento)|como faco (?:para|pra) comprar)\b/],
 ['quote',/\b(?:orcamento|cotacao|preco sob medida|proposta comercial|valor personalizado)\b/],
 ['price',/\b(?:preco|quanto custa|quanto fica|qual o valor|quanto sai|quanto e|tabela de precos)\b/],
 ['delivery',/\b(?:prazo|frete|entrega|retirada|quando chega|demora|estoque|disponibilidade)\b/],
 ['payment',/\b(?:pix|parcelamento|parcela|boleto|cartao|pagar|pagamento|link de pagamento)\b/],
 ['proof',/\b(?:avaliacoes|depoimentos|portfolio|provas|referencias|exemplos|casos reais)\b/],
 ['explore',/\b(?:quero saber|me conte|me explica|como funciona|informacoes|me fala sobre)\b/]
];
const instructions=Object.freeze({
 optout:'Não ofereça produtos nem continue a venda. O servidor deve encerrar o atendimento automatizado quando o cliente solicitar parar.',
 human:'Não retenha o cliente em negociação. Reconheça o pedido de pessoa e encaminhe ao atendente; não prometa transferência já concluída.',
 complaint:'Priorize resolver o problema. Peça apenas identificação mínima do pedido no canal apropriado e oriente verificação humana; não tente vender outro produto nem prometa reembolso já aprovado.',
 declined:'Respeite a recusa. Não insista, não use pressão e não interprete isso como intenção de compra.',
 objection:'Reconheça a preocupação sem contrariar. Explique apenas o benefício comprovado e relevante, com base no treinamento aprovado. Pergunte uma vez qual condição ou necessidade a pessoa deseja esclarecer, sem desconto inventado ou pressão.',
 comparison:'Compare somente características comprovadas no manual aprovado/catálogo. Não afirme superioridade, avaliações ou resultados sem evidência; uma pergunta útil pode esclarecer o critério da pessoa.',
 purchase:'Demonstração de intenção NÃO é compra concluída. Confirme apenas qual item/variação/quantidade a pessoa quer, se ainda não constar do histórico. Oriente que um atendente confirmará estoque, valor e forma de fechar; não crie pedido, link ou cobrança nem diga que o pagamento ocorreu.',
 quote:'Colete no máximo uma informação essencial que falte (produto/serviço ou quantidade). A equipe humana deve revisar condições, preço variável e proposta; não afirme que ela foi enviada.',
 price:'Se houver preço exato do item no catálogo oficial atual, informe-o sem inventar taxas. Para serviços ou preços variáveis, explique que a equipe prepara o orçamento. Evite desviar da pergunta sobre valor.',
 delivery:'Consulte somente dados aprovados de prazo, frete, estoque e retirada; sem evidência, diga naturalmente que precisa confirmar com a equipe.',
 payment:'Explique apenas meios de pagamento da empresa documentados e aprovados. Não solicite números de cartão, CPF ou credenciais; não crie links e não marque pagamentos como concluídos.',
 proof:'Mostre apenas referências, avaliações e exemplos expressamente aprovados; não crie depoimentos, quantidades de clientes ou casos de sucesso fictícios.',
 explore:'Responda primeiro à pergunta. Relacione a informação com a necessidade expressa pelo cliente, usando apenas o que o manual aprovado efetivamente sustenta.',
 general:'Responda à intenção atual de forma simples. Não force venda nem faça pergunta de continuação sem necessidade.'
});
export function classifySalesMoment(message=''){
 const text=normalize(message);
 for(const [moment,pattern] of patterns)if(pattern.test(text))return moment;
 return 'general';
}
export function salesMomentGuidance(message='',continuity=null){
 const moment=classifySalesMoment(message);
 const previous=typeof continuity?.previousTopic==='string'?continuity.previousTopic:null;
 const contextual=moment==='general'&&continuity?.continuing&&
  ['price','payment','quote','sale','delivery','product'].includes(previous);
 const contextHint=contextual?
  'Esta resposta curta parece continuar o assunto anterior. Use o histórico recente para entender a referência, sem tratar sim/pode como aprovação de pedido ou pagamento.':'';
 return {
  moment,
  inferredOnly:true,
  requiresHumanOrStop:['optout','human','complaint'].includes(moment),
  guidance:instructions[moment],
  prompt:['ORIENTAÇÃO DE VENDA CONSULTIVA (rótulo heurístico, NÃO é dado confirmado da empresa):',
   'Momento da conversa: '+moment+'.',instructions[moment],contextHint,
   'Priorize utilidade e honestidade, uma pergunta relevante por vez, sem insistência.',
   'Nenhuma orientação aqui autoriza criação de pedido, pagamento, desconto, agendamento, envio de mensagem, campanha ou mudança de permissão.'
  ].filter(Boolean).join('\n')
 };
}
