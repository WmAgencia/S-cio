import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProductDraft,draftProductFromSpeech} from '../catalog-voice.mjs';
import {transcribeSocioTraining} from '../socio-training-interview.mjs';
const dictation=JSON.stringify({
 name:'iPhone 7 Plus',
 description:'iPhone 7 Plus com 4 GB de memória RAM e 32 GB de memória interna.',
 priceCents:129990,compareAtPriceCents:null,sku:null,stockQuantity:20,
 variants:[
  {name:'Cor · Rosa',priceCents:129990,stockQuantity:null},
  {name:'Cor · Azul',priceCents:129990,stockQuantity:null},
  {name:'Cor · Verde',priceCents:129990,stockQuantity:null},
  {name:'Cor · Amarelo',priceCents:129990,stockQuantity:null}
 ]
});
test('a spoken iPhone becomes a reviewable draft with its colours and stock',()=>{
 const draft=parseProductDraft(dictation);
 assert.equal(draft.product.name,'iPhone 7 Plus');
 assert.equal(draft.product.priceCents,129990);
 assert.equal(draft.product.stockQuantity,20);
 assert.match(draft.product.description,/4 GB de memória RAM/);
 assert.match(draft.product.description,/32 GB de memória interna/);
 assert.equal(draft.variants.length,4);
 assert.deepEqual(draft.variants.map(v=>v.name),['Cor · Rosa','Cor · Azul','Cor · Verde','Cor · Amarelo']);
 assert.ok(draft.variants.every(v=>v.priceCents===129990));
});
test('prices written in Brazilian format are converted to cents',()=>{
 const draft=parseProductDraft(JSON.stringify({name:'Bolsa',priceCents:'R$ 1.299,90',variants:[]}));
 assert.equal(draft.product.priceCents,129990);
 const whole=parseProductDraft(JSON.stringify({name:'Bolsa',priceCents:'299',variants:[]}));
 assert.equal(whole.product.priceCents,299);
 const none=parseProductDraft(JSON.stringify({name:'Bolsa',variants:[]}));
 assert.equal(none.product.priceCents,0);
 assert.equal(none.product.stockQuantity,null);
});
test('the draft is capped at 25 valid variations and invalid ones are dropped',()=>{
 const many=Array.from({length:30},(_,index)=>({name:'Tamanho · '+index,priceCents:5000}));
 const draft=parseProductDraft(JSON.stringify({name:'Camisa',priceCents:5000,variants:many}));
 assert.equal(draft.variants.length,25);
 const mixed=[{name:'Tamanho · P',priceCents:5000},{name:'',priceCents:5000},{name:'Tamanho · G',priceCents:5000}];
 const dropped=parseProductDraft(JSON.stringify({name:'Camisa',priceCents:5000,variants:mixed}));
 assert.equal(dropped.variants.length,2);
 assert.ok(dropped.variants.every(v=>v.name.trim().length>0));
});
test('a speech without a product name is refused before anything is saved',()=>{
 assert.throws(()=>parseProductDraft(JSON.stringify({description:'é um celular',priceCents:100})),/nome do produto/);
 assert.throws(()=>parseProductDraft('não consegui entender'),/interpretar/);
});
test('draftProductFromSpeech sends the transcript to the brain and passes the provider through',async()=>{
 let received;
 const draft=await draftProductFromSpeech('  celular iPhone 7 Plus rosa, azul, verde e amarelo, 20 no estoque  ',{
  respond:async options=>{
   received=options;
   return {ok:true,reply:dictation,provider:'deepseek'};
  }
 });
 assert.equal(received.effort,'low');
 assert.match(received.instructions,/JSON/);
 assert.match(received.input,/20 no estoque/);
 assert.equal(draft.provider,'deepseek');
 assert.equal(draft.transcript,'celular iPhone 7 Plus rosa, azul, verde e amarelo, 20 no estoque');
 assert.equal(draft.product.name,'iPhone 7 Plus');
});
test('an unavailable brain and an empty dictation fail with clear statuses',async()=>{
 await assert.rejects(draftProductFromSpeech('oi',{respond:async()=>({ok:true,reply:'{}'})}),/Fale ou escreva/);
 await assert.rejects(draftProductFromSpeech('x'.repeat(4001),{respond:async()=>({ok:true,reply:'{}'})}),/muito longa/);
 const error=await draftProductFromSpeech('um celular',{respond:async()=>({ok:false})}).catch(e=>e);
 assert.equal(error.status,503);
});
test('the product dictation prompt and character cap reach the transcription request',async()=>{
 let form;
 const result=await transcribeSocioTraining(Buffer.alloc(1500,100),'audio/webm',{
  env:{GROQ_API_KEY:'gsk_'+'x'.repeat(40)},
  prompt:'Ditado sobre um produto de loja: preço, cores, estoque.',
  maxChars:24,
  request:async(url,options)=>{
   assert.match(url,/api\.groq\.com/);
   form=options.body;
   return {ok:true,json:async()=>({text:'iPhone 7 Plus com 4 GB de memória RAM e 32 GB de memória interna.'})};
  }
 });
 assert.equal(form.get('prompt'),'Ditado sobre um produto de loja: preço, cores, estoque.');
 assert.equal(result.text.length,24);
 assert.equal(result.model,'whisper-large-v3-turbo');
 assert.equal(result.approved,false);
});
