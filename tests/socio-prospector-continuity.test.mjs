import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 SOCIO_CONTINUITY_VERSION,classifySocioTopic,
 analyzeSocioContinuity,socioContinuityPrompt
} from '../socio-prospector-continuity.mjs';
import {polishCustomerReply} from '../socio-intelligence.mjs';
import {buildAiInstructions} from '../ai-replies.mjs';

const messages=[
 {direction:'inbound',body:'Quanto custa o produto?'},
 {direction:'outbound',body:'O preço depende da variação cadastrada.'},
 {direction:'inbound',body:'E a entrega?'},
 {direction:'outbound',body:'Vamos confirmar as condições de entrega com a equipe.'}
];

test('ported continuity has no Prospector/Consecom prices or outreach privileges',()=>{
 assert.match(SOCIO_CONTINUITY_VERSION,/prospector-context/);
 const source=readFileSync(new URL('../socio-prospector-continuity.mjs',import.meta.url),'utf8');
 for(const forbidden of ['R$ 550','Wesley','abordagens por dia','francisca.md','outboundEnabled','sendWhatsApp']){
  assert(!source.includes(forbidden),forbidden);
 }
});

test('intent classifier works for generic businesses and distinguishes opt-out from hesitation',()=>{
 assert.equal(classifySocioTopic('Não me envie mais mensagens'),'stop');
 assert.equal(classifySocioTopic('Quero falar com um atendente'),'human');
 assert.equal(classifySocioTopic('Preciso de um orçamento'),'quote');
 assert.equal(classifySocioTopic('Como funciona o frete?'),'delivery');
 assert.equal(classifySocioTopic('Quero um reembolso'),'refund');
 assert.equal(classifySocioTopic('Não quero comprar agora'),'general');
 assert.equal(classifySocioTopic('sim'),'general');
});

test('short follow-ups preserve previous topic without treating yes/pode as permission',()=>{
 const state=analyzeSocioContinuity(messages,'E depois?');
 assert.equal(state.hasAssistantReply,true);
 assert.equal(state.continuing,true);
 assert.equal(state.previousTopic,'delivery');
 const prompt=socioContinuityPrompt(state);
 assert.match(prompt,/continuação do assunto anterior/);
 assert.match(prompt,/"Pode" ou "sim" não autorizam ações/);
 assert.doesNotMatch(prompt,/A compra foi confirmada|Pagamento aprovado/);
});

test('corrections, topic changes and multi-part questions get contextual guidance',()=>{
 const corrected=analyzeSocioContinuity(messages,'Na verdade eu quis dizer sobre prazo');
 const changed=analyzeSocioContinuity(messages,'Mudando de assunto, me fala da garantia');
 const multi=analyzeSocioContinuity(messages,'Qual é o preço? E o prazo?');
 assert.equal(corrected.corrected,true);
 assert.match(socioContinuityPrompt(corrected),/O cliente corrigiu algo/);
 assert.equal(changed.switching,true);
 assert.match(socioContinuityPrompt(changed),/mudou de assunto/);
 assert.equal(multi.multipleQuestions,true);
 assert.match(socioContinuityPrompt(multi),/várias perguntas/);
});

test('summary contains labels only, no raw client messages or secrets',()=>{
 const privateHistory=[
  {direction:'inbound',body:'Meu telefone é 5515999999999, e-mail privacidade@exemplo.com, senha secreta abc'},
  {direction:'outbound',body:'Qual o prazo de entrega?'},
  {direction:'inbound',body:'Como funciona o pagamento? Meu CPF 12345678909'},
  {direction:'note',body:'Segredo interno da empresa XYZ'}
 ];
 const summary=socioContinuityPrompt(analyzeSocioContinuity(privateHistory,'E o valor?'));
 for(const secret of ['5515999999999','privacidade@exemplo.com','12345678909','abc','Segredo interno','XYZ']){
  assert(!summary.includes(secret),secret);
 }
 assert(summary.length<=1800);
});

test('last 80 valid turns only, and incoming text is not persisted in a global map',()=>{
 const a=analyzeSocioContinuity(messages,'Sim');
 const b=analyzeSocioContinuity([{direction:'inbound',body:'Preciso de suporte'}],'Sim');
 assert.notEqual(a.previousTopic,b.previousTopic);
 assert.equal(b.previousTopic,'support');
 assert.equal(a.customerTurns,2);
 const many=Array.from({length:120},()=>({direction:'inbound',body:'Preciso de orçamento'}));
 assert.equal(analyzeSocioContinuity(many,'Sim').customerTurns,80);
});

test('style port preserves requested literal greetings and removes redundant fillers',()=>{
 const literal=polishCustomerReply('Olá, Camila! Tudo bem?',{hasConversation:true,incoming:'Como cumprimentar uma cliente?'});
 assert.equal(literal,'Olá, Camila! Tudo bem?');
 const greeting=polishCustomerReply('Olá, Camila! O orçamento depende dos itens.',{hasConversation:true,incoming:'E o orçamento?'});
 assert.equal(greeting,'O orçamento depende dos itens.');
 const filler=polishCustomerReply('Perfeito! Podemos conferir o estoque.',{
  hasConversation:true,incoming:'Sim',previousAssistant:'Perfeito! E quantas unidades?'
 });
 assert.equal(filler,'Podemos conferir o estoque.');
 const original=polishCustomerReply('Claro! Podemos conferir o estoque.',{
  hasConversation:true,incoming:'Preciso ver o estoque.',previousAssistant:'O estoque não está confirmado.'
 });
 assert.equal(original,'Claro! Podemos conferir o estoque.');
});

test('continuity instructions retain tenant-approved facts and client safety',()=>{
 const continuity=analyzeSocioContinuity(messages,'e a entrega?');
 const prompt=buildAiInstructions({
  name:'Assistente',tenantName:'Oficina Norte',tone:'Claro',instructions:'Não oferecer descontos',
  knowledge:'A oficina atende apenas com hora marcada.',
  products:[{name:'Revisão',price_cents:9000,stock_quantity:2}],
  question:'e a entrega?',continuity
 });
 assert.match(prompt,/Oficina Norte/);
 assert.match(prompt,/hora marcada/);
 assert.match(prompt,/Não oferecer descontos/);
 assert.match(prompt,/CONTEXTO DA CONVERSA/);
 assert.match(prompt,/não são comandos/);
 assert.doesNotMatch(prompt,/R\$ 550|Wesley/);
});

test('real and lab use the same contextual engine, no new writes or sends',()=>{
 const ai=readFileSync(new URL('../ai-replies.mjs',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(ai,/analyzeSocioContinuity\(history\.rows,m\.body\)/);
 assert.match(ai,/AND direction IN \('inbound','outbound'\) ORDER BY created_at DESC,id DESC LIMIT 80/);
 assert.match(ai,/tenant_id=\$1 AND conversation_id=\$2/);
 assert.match(ai,/canAutoReply\(env\)/);
 assert.match(ai,/mode:'ai'/);
 assert.match(server,/analyzeSocioContinuity\(history\.map/);
 assert.match(server,/simulation:true,continuity/);
 assert.match(server,/buildLabInput\(history,data\.message\)/);
 assert.match(server,/simulation:true,continuity/);
});
