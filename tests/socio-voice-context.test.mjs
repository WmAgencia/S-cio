import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSttPrompt,normalizeSpokenIntent} from '../socio-voice-context.mjs';
import {transcribeSocioTraining} from '../socio-training-interview.mjs';

test('o prompt de reconhecimento carrega o vocabulário da empresa',()=>{
 const prompt=buildSttPrompt({tenantName:'Consecom Brasil',products:['Site institucional','Gestão de anúncios'],
  campaigns:['TEL | VENDAS CBO | NOV26'],asked:'Qual o orçamento diário?'});
 assert.match(prompt,/Empresa: Consecom Brasil/);
 assert.match(prompt,/Site institucional/);
 assert.match(prompt,/TEL \| VENDAS CBO/);
 assert.match(prompt,/Qual o orçamento diário\?/);
 assert.ok(prompt.length<=600);
});

test('o prompt não corta palavra no meio',()=>{
 const prompt=buildSttPrompt({tenantName:'Empresa com um nome bem comprido de teste',
  products:Array.from({length:20},(_,i)=>'Produto número '+i+' com nome longo')});
 assert.ok(prompt.length<=600);
 assert.doesNotMatch(prompt,/\bProdut$/);
});

test('artefatos de fala viram o termo certo sem estragar palavras reais',()=>{
 assert.equal(normalizeSpokenIntent('quanto gastei no meta adis hoje'),'quanto gastei no Meta Ads hoje');
 assert.equal(normalizeSpokenIntent('abre o metaedge'),'abre o Meta Ads');
 assert.equal(normalizeSpokenIntent('manda no whats app'),'manda no WhatsApp');
 assert.equal(normalizeSpokenIntent('qual o cê pê cê'),'qual o CPC');
 assert.equal(normalizeSpokenIntent('a metade do orçamento'),'a metade do orçamento');
 assert.equal(normalizeSpokenIntent('campanha de bolos'),'campanha de bolos');
});

const audio=Buffer.alloc(1500,7);
const env={GROQ_API_KEY:'mock-key-'+('x'.repeat(24))};

test('quando o modelo rápido não entende, o preciso recebe o áudio',async()=>{
 const calls=[];
 const result=await transcribeSocioTraining(audio,'audio/webm',{
  env,prompt:'Empresa: Consecom. Campanhas: TEL | VENDAS.',
  request:async(url,opts)=>{
   const model=opts.body.get('model');calls.push(model);
   if(model==='whisper-large-v3-turbo')
    return {ok:true,json:async()=>({text:'ahn',segments:[{no_speech_prob:.95,avg_logprob:-1.6,compression_ratio:1.1}]})};
   return {ok:true,json:async()=>({text:'Pausa a campanha TEL VENDAS CBO.',segments:[{no_speech_prob:.03,avg_logprob:-.2,compression_ratio:1.1}]})};
  }});
 assert.deepEqual(calls,['whisper-large-v3-turbo','whisper-large-v3']);
 assert.equal(result.text,'Pausa a campanha TEL VENDAS CBO.');
 assert.equal(result.model,'whisper-large-v3');
 assert.equal(result.rewritten,true);
});

test('transcrição boa no primeiro modelo não paga a segunda chamada',async()=>{
 const calls=[];
 const result=await transcribeSocioTraining(audio,'audio/webm',{env,
  request:async(url,opts)=>{calls.push(opts.body.get('model'));
   return {ok:true,json:async()=>({text:'Quais campanhas estão ativas?',segments:[{no_speech_prob:.02,avg_logprob:-.2,compression_ratio:1.1}]})};}});
 assert.deepEqual(calls,['whisper-large-v3-turbo']);
 assert.equal(result.model,'whisper-large-v3-turbo');
 assert.equal(result.rewritten,undefined);
});

test('o prompt do vocabulário chega ao serviço de voz',async()=>{
 let sent=null;
 await transcribeSocioTraining(audio,'audio/webm',{env,
  prompt:'Empresa: Aquarela Studio. Produtos e serviços: site, landing page.',
  request:async(url,opts)=>{sent=opts.body.get('prompt');
   return {ok:true,json:async()=>({text:'Site em cinco dias',segments:[]})};}});
 assert.match(sent,/Aquarela Studio/);
 assert.match(sent,/landing page/);
});

test('resposta curta numérica continua válida e fala vazia é recusada',async()=>{
 const ok=await transcribeSocioTraining(audio,'audio/webm',{env,
  request:async()=>({ok:true,json:async()=>({text:'6',segments:[]})})});
 assert.equal(ok.text,'6');
 await assert.rejects(transcribeSocioTraining(audio,'audio/webm',{env,
  request:async()=>({ok:true,json:async()=>({text:'',segments:[]})})}),{status:422});
});
