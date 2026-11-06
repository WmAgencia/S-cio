import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialInterview,interviewView,advanceInterview,compileInterviewMarkdown,validateSocialProof,validateClosingSettings} from '../socio-onboarding.mjs';
import {buildAiInstructions} from '../ai-replies.mjs';
import {normalizePdf} from '../media-storage.mjs';

test('interview visits each service and only prepares a reviewable Markdown draft',()=>{
 let s=initialInterview(),count=0;
 while(interviewView(s).phase==='answering'){
  const {step}=interviewView(s);
  const reply={company:'Oficina Teste',audience:'Donos de automóveis',services:'Troca de óleo, Revisão de freios',
   serviceDetails:'Inclui inspeção e mão de obra',servicePrices:'Orçamento após avaliação',
   closing:'Transferir ao atendente',interactionMode:'2'}[step]||'Informação informada pelo proprietário';
  s=advanceInterview(s,reply);count++;assert.ok(count<40);
 }
 assert.equal(s.phase,'review');
 assert.equal(s.answers.services.length,2);
 assert.equal(s.answers.services[0].details,'Inclui inspeção e mão de obra');
 assert.equal(s.answers.services[1].price,'Orçamento após avaliação');
 const md=compileInterviewMarkdown(s,[{kind:'case',title:'Atendimento documentado',description:'Caso verificado',url:'https://example.com/case',approved:true},
  {kind:'testimonial',title:'Depoimento não aprovado',description:'Não usar',url:'https://example.com/no',approved:false}]);
 assert.match(md,/Oficina Teste/);
 assert.match(md,/Atendimento documentado/);
 assert.doesNotMatch(md,/Depoimento não aprovado/);
 assert.match(md,/Rascunho preparado/);
});
test('training asks one optional channel preference, persists selection and never assumes group buttons',()=>{
 const run=choice=>{
  let state=initialInterview();
  let guard=0;
  while(interviewView(state).phase==='answering'){
   const {step}=interviewView(state);
   const data={company:'Empresa Teste',services:'Buffet infantil',interactionMode:choice};
   state=advanceInterview(state,data[step]||'A confirmar');
   if(++guard>50)throw new Error('Interview loop');
  }
  return state;
 };
 const buttons=run('1');
 assert.equal(buttons.answers.interactionMode,'interactive');
 const md=compileInterviewMarkdown(buttons);
 assert.match(md,/Preferir botões e listas em conversas individuais/);
 assert.match(md,/usar mensagens de texto quando não houver suporte/);
 const text=run('apenas mensagens');
 assert.equal(text.answers.interactionMode,'text');
 assert.match(compileInterviewMarkdown(text),/não enviar botões ou listas interativas/);
 let state=initialInterview();state.index=15;
 assert.throws(()=>advanceInterview(state,'invento outra modalidade'),/Escolha 1/);
});
test('incomplete or invalid training cannot be silently activated',()=>{
 assert.throws(()=>compileInterviewMarkdown(initialInterview()));
 assert.throws(()=>advanceInterview(initialInterview(),''));
});
test('evidence URL must use HTTPS; private media without URL is allowed for guarded upload',()=>{
 const sample={kind:'case',title:'Projeto completo',description:'Projeto real',url:'https://example.com/item'};
 assert.equal(validateSocialProof(sample).url,'https://example.com/item');
 assert.equal(validateSocialProof({...sample,url:''}).url,'');
 assert.throws(()=>validateSocialProof({...sample,url:'http://example.com'}));
 assert.throws(()=>validateSocialProof({...sample,url:'https://username:password@example.com'}));
 assert.throws(()=>validateSocialProof({...sample,title:'x'}));
});
test('closing policies validate terms and do not assign permissions',()=>{
 assert.deepEqual(validateClosingSettings({mode:'handoff',methods:['pix'],depositPercent:40}),{mode:'handoff',methods:[],depositPercent:0});
 assert.deepEqual(validateClosingSettings({mode:'proposal',methods:['pix','pix','card'],depositPercent:50}),
  {mode:'proposal',methods:['pix','card'],depositPercent:50});
 assert.throws(()=>validateClosingSettings({mode:'proposal',methods:[],depositPercent:50}));
 assert.throws(()=>validateClosingSettings({mode:'proposal',methods:['pix'],depositPercent:101}));
});
test('private PDF checks header, ending marker and bytes',()=>{
 const valid=Buffer.from('%PDF-1.4\n'+'.'.repeat(100)+'\n%%EOF');
 assert.ok(normalizePdf(valid.toString('base64')).equals(valid));
 assert.throws(()=>normalizePdf(Buffer.from('not a pdf').toString('base64')));
});
test('sales prompt takes only tenant supplied values and does not include PIX secrets',()=>{
 const guide=buildAiInstructions({tenantName:'Oficina Teste',name:'Sócio',tone:'Curto',instructions:'Não conceder descontos',
  knowledge:'Atendemos Sorocaba',products:[{name:'Óleo',price_cents:8900,stock_quantity:5}],
  proofs:'Case: troca documentada',closing:{mode:'proposal',methods:['pix'],depositPercent:50,pixConfigured:true}});
 assert.match(guide,/Oficina Teste/);
 assert.match(guide,/Óleo — R\$ 89,00/);
 assert.match(guide,/Case: troca documentada/);
 assert.match(guide,/NÃO cobrar, enviar PIX/);
 assert.doesNotMatch(guide,/54144045854/);
});
test('guided training is wired to independent tenant-scoped API and UI',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/training-extras.js',import.meta.url),'utf8');
 const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 assert.match(server,/\/api\/training\/interview\/draft/);
 assert.match(server,/\/api\/training\/proofs/);
 assert.match(server,/\/api\/trial/);
 assert.match(app,/trainInterviewAnswer/);
 assert.match(app,/trainClosingForm/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS socio_interviews/);
 assert.match(schema,/trial_ends_at/);
});
