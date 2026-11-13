import test from 'node:test';
import assert from 'node:assert/strict';
import {composeAdCopy} from '../socio-ad-copywriter.mjs';

const env={GROQ_API_KEY:'gsk_'+'a'.repeat(40)};
const brief={category:'bolos caseiros',cityName:'Sorocaba, SP',destination:'whatsapp',dailyBudgetCents:600};

const variant=(over={})=>({headline:'Bolos caseiros em Sorocaba',
 description:'Encomendas pelo WhatsApp',
 message:'Bolos caseiros feitos em Sorocaba. Fale com a equipe pelo WhatsApp para encomendar.',
 welcomeMessage:'Oi! Aqui é a equipe. Como podemos ajudar com os bolos?',
 quickReply:'Quero encomendar um bolo.',
 why:'Apresenta o produto e o próximo passo.',
 ...over});
const reply=variants=>JSON.stringify({variants});
const fakeFetch=body=>async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:body}}]})});

test('without a model key the deterministic drafts stay, marked as template copy',async()=>{
 const result=await composeAdCopy({brief,tenantName:'Doceria Aurora',env:{}});
 assert.equal(result.copyProvider,'template');
 assert.equal(result.variants.length,3);
 assert(result.variants.every(v=>v.headline&&v.description&&v.message));
 assert(result.variants.every(v=>v.welcomeMessage&&v.quickReply));
});

test('model copy replaces the drafts only after passing the claim and grounding checks',async()=>{
 const result=await composeAdCopy({brief,tenantName:'Doceria Aurora',env,
  fetchImpl:fakeFetch(reply([variant(),variant({headline:'Encomende seu bolo em Sorocaba'}),
   variant({headline:'Doceria Aurora | bolos caseiros'})]))});
 assert.equal(result.copyProvider,'groq');
 assert.equal(result.variants[0].headline,'Bolos caseiros em Sorocaba');
 assert.equal(result.variants[0].description,'Encomendas pelo WhatsApp');
 assert.match(result.variants[0].message,/WhatsApp/);
 assert(result.variants.every(v=>v.welcomeMessage&&v.quickReply));
 assert.equal(result.reviewRequired,false);
 assert.equal(result.executionAllowed,true);
});

test('a promise or an invented price never reaches the plan, the template does',async()=>{
 for(const bad of [{message:'Bolos garantidos em Sorocaba. Fale com a equipe pelo WhatsApp.'},
  {message:'Bolos caseiros em Sorocaba por R$ 29,90. Fale com a equipe pelo WhatsApp.'},
  {message:'Bolos caseiros em Sorocaba. Fale com a equipe pelo WhatsApp.',welcomeMessage:'Oi! Somos os melhores do mundo.'},
  {headline:'Doces em geral',message:'Fale com a equipe pelo WhatsApp.'}]){
  const result=await composeAdCopy({brief,tenantName:'Doceria Aurora',env,
   fetchImpl:fakeFetch(reply([variant(bad),variant(bad),variant(bad)]))});
  assert.equal(result.copyProvider,'template_fallback',JSON.stringify(bad));
  assert.equal(result.variants[0].headline,'Bolos caseiros em Sorocaba, SP','the deterministic floor is used');
  assert.doesNotMatch(JSON.stringify(result.variants),/garantidos|R\$ 29,90|melhores do mundo/i);
 }
});

test('an unsafe brief is never sent to the model',async()=>{
 let called=false;
 const result=await composeAdCopy({brief:{...brief,category:'bolos 100% garantidos'},tenantName:'Doceria Aurora',env,
  fetchImpl:async()=>{called=true;throw new Error('should not be called');}});
 assert.equal(called,false);
 assert.equal(result.reviewRequired,true);
 assert.equal(result.copyProvider,'template');
});

test('a broken answer or an unavailable provider falls back without failing the campaign',async()=>{
 const broken=await composeAdCopy({brief,tenantName:'Doceria Aurora',env,fetchImpl:fakeFetch('não é json')});
 assert.equal(broken.copyProvider,'template_fallback');
 assert.equal(broken.variants.length,3);
 const down=await composeAdCopy({brief,tenantName:'Doceria Aurora',env,
  fetchImpl:async()=>({ok:false,status:500,json:async()=>({})})});
 assert.equal(down.copyProvider,'template_fallback');
 assert.equal(down.executionAllowed,true);
});
