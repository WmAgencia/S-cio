import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCommercialReply,conversationHints} from '../socio-ai-safety.mjs';
import {rankAvailableGroqModels,groqAvailableModels} from '../socio-model-catalog.mjs';
import {transcribeTrainingAudio} from '../socio-training-speech.mjs';
import {ownerSummary,ownerReadOnlyAnswer} from '../socio-owner-assistant.mjs';

test('review blocks unverified prices, payment claims, Pix requests and false identity',()=>{
 const products=[{name:'Caneca',price_cents:6900,stock_quantity:10}];
 assert.equal(reviewCommercialReply('A caneca custa R$ 69,00.',{products}).approved,true);
 for(const sample of ['O preço é R$ 79,00.','O pagamento já foi confirmado.',
 'Envie o comprovante para o PIX.','Sou uma pessoa real, pode confiar.']){
  assert.equal(reviewCommercialReply(sample,{products}).approved,false,sample);
 }
 assert.match(conversationHints('Sim',[]),/continuidade/);
});
test('model routing ranks active models only and never selects arbitrary IDs',()=>{
 const ids=['openai/gpt-oss-120b','openai/gpt-oss-20b'];
 assert.deepEqual(rankAvailableGroqModels({preferred:'not-present',task:'quick',available:ids}),
  ['openai/gpt-oss-20b','openai/gpt-oss-120b']);
 assert.deepEqual(rankAvailableGroqModels({preferred:'unknown',available:[]}),[]);
});
test('model catalogue checks provider and returns configured candidates without sending messages',async()=>{
 const env={GROQ_API_KEY:'fake-test-token-1234567890123456789'};
 const response=await groqAvailableModels({env,force:true,fetchImpl:async(url,options)=>{
  assert.match(url,/\/models$/);assert.equal(options.method,undefined);
  return {ok:true,json:async()=>({data:[{id:'openai/gpt-oss-120b'},{id:'whisper-large-v3-turbo'}]})};
 }});
 assert.deepEqual(response.ids,['openai/gpt-oss-120b']);
});
test('training audio is transcribed but never automatically approved',async()=>{
 const bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(200,5)]);
 const env={GROQ_API_KEY:'fake-test-token-1234567890123456789'};
 const result=await transcribeTrainingAudio({audioBase64:bytes.toString('base64'),mime:'audio/webm',env,
  fetchImpl:async(url,opts)=>{
   assert.match(url,/audio\/transcriptions$/);
   assert.equal(opts.body.get('model'),'whisper-large-v3-turbo');
   assert.equal(opts.body.get('language'),'pt');
   return {ok:true,json:async()=>({text:'Nós oferecemos manutenção de carros.'})};
  }});
 assert.equal(result.editable,true);
 assert.match(result.text,/manutenção de carros/);
 await assert.rejects(transcribeTrainingAudio({audioBase64:Buffer.alloc(110).toString('base64'),mime:'audio/webm',env}),
  /Formato de gravação/);
});
test('owner companion operates within one tenant and does not invent paid sales',async()=>{
 const q=[],tenantId='11111111-1111-4111-8111-111111111111';
 const db={query:async(sql,args)=>{q.push({sql,args});return {rows:[{n:4}]};}};
 const stats=await ownerSummary(db,tenantId);
 assert.equal(stats.quotes,4);
 assert(q.every(x=>x.args.length===1&&x.args[0]===tenantId));
 assert.match(ownerReadOnlyAnswer('Quantas vendas tivemos?',stats),/Não são vendas pagas confirmadas/);
});
