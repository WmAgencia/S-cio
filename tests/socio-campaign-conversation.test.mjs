import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretCampaignTurn,mergeCampaignInterpretation,validateCampaignInterpretation,
 explainCampaignStrategy,phraseCampaignQuestion} from '../socio-campaign-conversation.mjs';

const env={DEEPSEEK_API_KEY:'test-key-with-enough-characters-123'};

test('DeepSeek low interprets a natural campaign reply and code validates the fields',async()=>{
 let received;
 const result=await interpretCampaignTurn({message:'Na verdade é para Itu, uns doze reais por dia',
  previous:{category:'bolos',cityName:'Sorocaba'},asked:'city',env,
  respond:async options=>{received=options;return {provider:'deepseek',model:'deepseek-flash',reply:JSON.stringify({
   cityName:'Itu, SP',dailyBudgetCents:1200,acknowledgement:'Perfeito, ajustei a cidade e a verba.',
   answer:null,destination:'invalid',url:'javascript:alert(1)'
  })};}});
 assert.equal(received.task,'campaign_conversation');
 assert.equal(result.provider,'deepseek');
 assert.deepEqual(result.brief,{cityName:'Itu, SP',dailyBudgetCents:1200});
 const merged=mergeCampaignInterpretation({category:'bolos',cityName:'Sorocaba'},result.brief);
 assert.equal(merged.cityName,'Itu, SP');
 assert.equal(merged.dailyBudgetCents,1200);
});

test('campaign interpreter can answer a doubt without authorizing or mutating Meta',async()=>{
 const result=await interpretCampaignTurn({message:'Isso já começa gastando?',previous:{category:'bolos'},asked:'budget',env,
  respond:async()=>({provider:'deepseek',reply:JSON.stringify({answer:'Não. A campanha é preparada pausada e só pode ser ativada depois de uma autorização separada.'})})});
 assert.match(result.answer,/preparada pausada/);
 assert.deepEqual(result.brief,{});
});

test('a long natural website pitch becomes the actual campaign subject instead of a repeated question',async()=>{
 const result=await interpretCampaignTurn({
  message:'Quero fazer uma campanha para um site que vende uma API de Cloud Code, 11,3 vezes mais barata que a oficial da Anthropic.',
  previous:{},asked:null,env,respond:async()=>({provider:'deepseek',reply:JSON.stringify({
   productOrService:'API de Cloud Code',destination:'website',goal:'sales_site',
   comparativeClaim:'11,3 vezes mais barata que a oficial da Anthropic',
   acknowledgement:'Entendi que você vende uma API de Cloud Code pelo site.'
  })})});
 assert.equal(result.brief.category,'API de Cloud Code');
 assert.equal(result.brief.destination,'website');
 assert.equal(result.brief.claimNeedsProof,true);
 assert.match(result.brief.claimText,/11,3 vezes/);
});

test('next briefing question is conversational, singular and low-cost',async()=>{
 let received;
 const result=await phraseCampaignQuestion({message:'Quero divulgar minha API',
  brief:{category:'API de Cloud Code',destination:'website'},slot:'city',
  question:'Quer anunciar em todo o Brasil ou em uma cidade?',env,
  respond:async options=>{received=options;return {provider:'deepseek',reply:JSON.stringify({
   message:'Entendi, vamos divulgar sua API de Cloud Code. Você quer alcançar todo o Brasil ou uma região específica?'
  })};}});
 assert.equal(received.task,'campaign_conversation');
 assert.match(result.text,/API de Cloud Code/);
 assert.equal((result.text.match(/\?/g)||[]).length,1);
});

test('strategy is the only campaign conversation call marked high through task strategy',async()=>{
 let received;
 const result=await explainCampaignStrategy({brief:{category:'bolos',cityName:'Itu'},
  design:{objective:'OUTCOME_ENGAGEMENT',budgetMode:'adset'},env,
  respond:async options=>{received=options;return {provider:'deepseek',reply:'Vamos priorizar conversas com uma estrutura simples e controlada. Agora envie a mídia.'};}});
 assert.equal(received.task,'strategy');
 assert.match(result.text,/estrutura simples/);
});

test('model output cannot inject unsafe budget, destination or URL',()=>{
 const parsed=validateCampaignInterpretation({dailyBudgetCents:999999999,destination:'checkout',
  url:'file:///secret',category:'<script>produto</script>',genders:[2,9],answer:'Tudo certo.'});
 assert.equal(parsed.brief.dailyBudgetCents,undefined);
 assert.equal(parsed.brief.destination,undefined);
 assert.equal(parsed.brief.url,undefined);
 assert.deepEqual(parsed.brief.genders,[2]);
 assert(!parsed.brief.category.includes('<'));
});

test('orb keeps a collecting campaign run instead of restarting the briefing',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../public/socio-thalita-ui.js',import.meta.url),'utf8');
 assert.match(source,/\['collecting','ready','failed','executing'\]\.includes\(result\.status\)/);
});
