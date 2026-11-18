import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConversationTrainingMarkdown} from '../socio-training-import.mjs';
import {inspectTrainingSource,compileTrainingKnowledge} from '../analysis-jobs.mjs';

const conversation=(id,customer_name,messages)=>({id,customer_name,customer_phone:'5511999999999',messages});

test('lado de cada mensagem vem da direção, não do texto',()=>{
 const {markdown}=buildConversationTrainingMarkdown({conversations:[conversation('a','Ana',[
  {direction:'inbound',body:'Bom dia, quanto custa o site?'},
  {direction:'outbound',body:'Bom dia! O site fica em R$ 350 e entrego em 7 dias.'}
 ])]});
 assert.match(markdown,/- CLIENTE: Bom dia, quanto custa o site\?/);
 assert.match(markdown,/- EMPRESA: Bom dia! O site fica em R\$ 350/);
});

test('mensagem recebida que cita a empresa é tratada como lado da empresa',()=>{
 const {markdown}=buildConversationTrainingMarkdown({
  businessNames:['Consecom'],conversations:[conversation('b','Loja',[
   {direction:'inbound',body:'Aqui é a Consecom, tudo bem?'},
   {direction:'inbound',body:'Quer que eu te mande a proposta?'}
  ])]});
 assert.match(markdown,/- EMPRESA: Aqui é a Consecom/);
 assert.match(markdown,/- CLIENTE: Quer que eu te mande a proposta\?/);
});

test('telefone, e-mail, link e documento não entram na amostra',()=>{
 const {markdown}=buildConversationTrainingMarkdown({
  businessPhone:'5515981732994',
  conversations:[conversation('c','Ana',[
   {direction:'inbound',body:'Meu zap 11 98888-7777 e email ana@loja.com.br, veja https://loja.com.br/x'},
   {direction:'outbound',body:'Pode mandar no 5515981732994 também.'}
  ])]});
 assert.doesNotMatch(markdown,/98888/);
 assert.doesNotMatch(markdown,/ana@loja/);
 assert.doesNotMatch(markdown,/https?:/);
 assert.match(markdown,/\[telefone\]/);
 assert.match(markdown,/\[link\]/);
});

test('conversa com uma mensagem só não vira amostra',()=>{
 const {markdown,conversationCount}=buildConversationTrainingMarkdown({conversations:[
  conversation('d','Vazio',[{direction:'outbound',body:'Olá, bom dia!'}])
 ]});
 assert.doesNotMatch(markdown,/Conversa 1/);
 assert.equal(conversationCount,0);
});

test('a análise entende as linhas rotuladas que o Sócio importa',()=>{
 const sample=[ '# Conversas reais do WhatsApp','',
  '- CLIENTE: oi, vocês criam site pra oficina?',
  '- EMPRESA: Meu nome é Wesley, sou dono da agência Consecom. Eu tô entrando em contato porque queria fazer uma proposta pra vocês.',
  '- CLIENTE: E quanto seria esse custo?',
  '- EMPRESA: A proposta especial fica em R$ 350 para esse site de portfólio. Antes de começar, a gente alinha direitinho o escopo.'
 ].join('\n');
 const findings=inspectTrainingSource(sample);
 assert.equal(findings.messageCount,4);
 assert.ok(findings.patterns.priceQuestions>=1,'a empresa fala de custo/proposta');
 assert.ok(findings.patterns.productQuestions>=1,'a empresa fala de site/portfólio');
 assert.ok(findings.patterns.closingLanguage>=1,'a empresa fala de proposta/escopo');
 assert.ok(findings.examples.length>=1,'a fala da empresa precisa virar exemplo');
 assert.ok(findings.examples.every(x=>!/vocês criam site|quanto seria/.test(x)),'fala do cliente não vira exemplo');
 const compiled=compileTrainingKnowledge([findings]);
 assert.equal(compiled.report.salesValidated,false);
});

test('o formato antigo "Pessoa N" continua aceito',()=>{
 const findings=inspectTrainingSource('- Pessoa 1: Qual o preço?\n- Pessoa 2: O valor fica em R$ 200.');
 assert.equal(findings.messageCount,2);
});
