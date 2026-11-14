import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deepseekResponse,deepseekReady,deepseekBaseUrl,deepseekModel,deepseekThinking}
 from '../deepseek-client.mjs';
import {brainResponse,brainReady,brainProvider,brainModel} from '../ai-brain.mjs';
import {composeAdCopy} from '../socio-ad-copywriter.mjs';
import {runTrafficManager,trafficDiagnosis,trafficQuestion,formatTrafficReport}
 from '../socio-traffic-manager.mjs';
const key='sk-'+'d'.repeat(40);
const deepEnv={DEEPSEEK_API_KEY:key};
const groqEnv={GROQ_API_KEY:'gsk_'+'a'.repeat(40)};
const bothEnv={...deepEnv,...groqEnv};
const ok=content=>({ok:true,status:200,json:async()=>({
 model:'deepseek-flash',choices:[{message:{content}}]})});
const groqOk=content=>({ok:true,status:200,json:async()=>({
 model:'qwen/qwen3.8-27b',choices:[{message:{content}}]})});
const capture=reply=>{
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url,body:JSON.parse(init.body),headers:init.headers});
  return reply(calls.length);};
 return {calls,fetchImpl};
};

test('the DeepSeek request carries the model, the thinking switch and no streaming',async()=>{
 const {calls,fetchImpl}=capture(()=>ok('leitura da conta'));
 const result=await deepseekResponse({instructions:'papel',input:'dados',env:deepEnv,fetchImpl,
  effort:'high',maxOutputTokens:600});
 assert.equal(result.provider,'deepseek');
 assert.equal(result.reply,'leitura da conta');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
 assert.equal(calls[0].body.model,'deepseek-flash');
 assert.equal(calls[0].body.stream,false);
 assert.deepEqual(calls[0].body.thinking,{type:'enabled'});
 assert.equal(calls[0].body.reasoning_effort,'high');
 assert.equal(calls[0].body.max_tokens,600);
 assert.equal(calls[0].body.messages[0].role,'system');
 assert.equal(calls[0].body.messages[1].content,'dados');
 assert.match(calls[0].headers.Authorization,/^Bearer sk-d/);
});
test('copy asks for speed: low effort, and off disables thinking entirely',async()=>{
 const {calls,fetchImpl}=capture(()=>ok('ok'));
 await deepseekResponse({instructions:'papel',input:'dados',env:deepEnv,fetchImpl,effort:'low'});
 assert.deepEqual(calls[0].body.thinking,{type:'enabled'});
 assert.equal(calls[0].body.reasoning_effort,'low');
 const {calls:off,fetchImpl:offFetch}=capture(()=>ok('ok'));
 await deepseekResponse({instructions:'papel',input:'dados',env:deepEnv,fetchImpl:offFetch,effort:'off'});
 assert.deepEqual(off[0].body.thinking,{type:'disabled'});
 assert.equal(off[0].body.reasoning_effort,undefined);
});
test('the brain is off without a key and its settings are validated, never guessed',()=>{
 assert.equal(deepseekReady({}),false);
 assert.equal(deepseekReady({DEEPSEEK_API_KEY:'curta'}),false);
 assert.equal(deepseekReady(deepEnv),true);
 assert.equal(deepseekBaseUrl({DEEPSEEK_BASE_URL:'http://inseguro.exemplo'}),'https://api.deepseek.com');
 assert.equal(deepseekBaseUrl({DEEPSEEK_BASE_URL:'https://api.deepseek.com//'}),'https://api.deepseek.com');
 assert.equal(deepseekModel({DEEPSEEK_MODEL:'modelo fora do padrao!'}),'deepseek-flash');
 assert.equal(deepseekModel({}),'deepseek-flash');
 assert.deepEqual(deepseekThinking('max'),{thinking:{type:'enabled'},reasoning_effort:'max'});
});
test('a rejected credential is a translated error, not a silent empty answer',async()=>{
 const fetchImpl=async()=>({ok:false,status:401,json:async()=>({})});
 await assert.rejects(deepseekResponse({instructions:'p',input:'d',env:deepEnv,fetchImpl}),
  {status:503,message:/Credencial DeepSeek rejeitada/});
 const limited=async()=>({ok:false,status:429,json:async()=>({})});
 await assert.rejects(deepseekResponse({instructions:'p',input:'d',env:deepEnv,fetchImpl:limited}),
  {status:503,message:/Limite de uso/});
});
test('the brain reports which provider actually answered',async()=>{
 assert.equal(brainProvider({}),null);
 assert.equal(brainProvider(groqEnv),'groq');
 assert.equal(brainProvider(deepEnv),'deepseek');
 assert.equal(brainReady({}),false);
 assert.equal(brainModel(deepEnv),'deepseek-flash');
 const {fetchImpl}=capture(()=>ok('resposta do cerebro'));
 const deep=await brainResponse({instructions:'p',input:'d',env:deepEnv,fetchImpl});
 assert.equal(deep.provider,'deepseek');
 assert.equal(deep.reply,'resposta do cerebro');
});
test('without the DeepSeek key nothing leaves for DeepSeek: Groq answers',async()=>{
 const {calls,fetchImpl}=capture(()=>groqOk('resposta do groq'));
 const result=await brainResponse({instructions:'p',input:'d',env:groqEnv,fetchImpl});
 assert.equal(result.provider,'groq');
 assert.equal(result.reply,'resposta do groq');
 assert(calls.every(c=>c.url.startsWith('https://api.groq.com')),'no DeepSeek call is made');
});
test('a DeepSeek failure falls back to Groq and says so, never pretending DeepSeek answered',async()=>{
 const urls=[];
 const fetchImpl=async url=>{
  urls.push(url);
  if(url.startsWith('https://api.deepseek.com'))return {ok:false,status:500,json:async()=>({})};
  return groqOk('resposta de seguranca');
 };
 const result=await brainResponse({instructions:'p',input:'d',env:bothEnv,fetchImpl});
 assert.equal(result.provider,'groq');
 assert.equal(result.reply,'resposta de seguranca');
 assert(urls.some(u=>u.startsWith('https://api.deepseek.com')));
 assert(urls.some(u=>u.startsWith('https://api.groq.com')));
});
const brief={category:'bolos caseiros',cityName:'Sorocaba, SP',destination:'whatsapp',dailyBudgetCents:600};
const variant=(over={})=>({headline:'Bolos caseiros em Sorocaba',
 description:'Encomendas pelo WhatsApp',
 message:'Bolos caseiros feitos em Sorocaba. Fale com a equipe pelo WhatsApp para encomendar.',
 welcomeMessage:'Oi! Aqui é a equipe. Como podemos ajudar com os bolos?',
 quickReply:'Quero encomendar um bolo.',
 why:'Apresenta o produto e o próximo passo.',
 ...over});
test('the campaign brain writes the three ad variants and the copy says where they came from',async()=>{
 const reply=JSON.stringify({variants:[variant(),
  variant({headline:'Encomende seu bolo em Sorocaba'}),
  variant({headline:'Doceria Aurora | bolos caseiros'})]});
 const {calls,fetchImpl}=capture(()=>ok(reply));
 const result=await composeAdCopy({brief,tenantName:'Doceria Aurora',env:deepEnv,fetchImpl});
 assert.equal(result.copyProvider,'deepseek');
 assert.equal(result.variants.length,3);
 assert.equal(result.variants[0].headline,'Bolos caseiros em Sorocaba');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
 assert.equal(calls[0].body.reasoning_effort,'low','copy does not pay for deep thinking');
});
test('a DeepSeek outage still delivers the three variants through Groq',async()=>{
 const reply=JSON.stringify({variants:[variant(),
  variant({headline:'Encomende seu bolo em Sorocaba'}),
  variant({headline:'Doceria Aurora | bolos caseiros'})]});
 const fetchImpl=async url=>url.startsWith('https://api.deepseek.com')
  ?{ok:false,status:503,json:async()=>({})}:groqOk(reply);
 const result=await composeAdCopy({brief,tenantName:'Doceria Aurora',env:bothEnv,fetchImpl});
 assert.equal(result.copyProvider,'groq');
 assert.equal(result.variants.length,3);
});
test('the owner question keeps the exact amounts and no model can change it',()=>{
 const question=trafficQuestion({action:'scale',entityName:'Conjunto A',campaignName:'Campanha X',
  currentBudgetCents:600,targetBudgetCents:1000});
 assert.match(question,/R\$\s6,00/);
 assert.match(question,/R\$\s10,00/);
 assert.match(question,/Posso aumentar/);
 // Guard: the rules that choose and describe money never call the brain.
 const source=readFileSync(new URL('../socio-traffic-manager.mjs',import.meta.url),'utf8');
 const decide=source.slice(source.indexOf('export function decideTrafficActions'),
  source.indexOf('export function formatTrafficReport'));
 assert.doesNotMatch(decide,/brainResponse|trafficDiagnosis/);
 const ask=source.slice(source.indexOf('export function trafficQuestion'),
  source.indexOf('async function recordDecision'));
 assert.doesNotMatch(ask,/brainResponse|trafficDiagnosis|deepseek/i);
});
test('a missing or failed diagnosis leaves the report exactly as it was',async()=>{
 const decision={actions:[],notes:['Amostra insuficiente para decidir.'],summary:{}};
 const withoutBrain=await trafficDiagnosis(decision,{env:{}});
 assert.equal(withoutBrain,null,'no key, no call, no text');
 const failing=await trafficDiagnosis(decision,{env:deepEnv,
  fetchImpl:async()=>{throw new Error('sem rede');}});
 assert.equal(failing,null,'a failed reading never becomes report text');
 const report=formatTrafficReport({...decision,executed:[],pending:[],skipped:[],limits:{}});
 assert.equal(report,formatTrafficReport({...decision,executed:[],pending:[],skipped:[],limits:{},
  diagnosis:null}));
 assert.doesNotMatch(report,/leitura/i);
});
test('a real reading is returned with its provider and appears in the report',async()=>{
 const decision={actions:[],notes:['Amostra insuficiente.'],summary:{impressions:0}};
 const {fetchImpl}=capture(()=>ok('A conta ainda tem pouca entrega. Priorize deixar a campanha ativa.'));
 const diagnosis=await trafficDiagnosis(decision,{env:deepEnv,fetchImpl});
 assert.equal(diagnosis.provider,'deepseek');
 assert.match(diagnosis.text,/pouca entrega/);
 const report=formatTrafficReport({...decision,executed:[],pending:[],skipped:[],limits:{},diagnosis});
 assert.match(report,/pouca entrega/);
});
test('the manager carries the diagnosis on the run path and skips it on a preview',async()=>{
 const tenantId='11111111-1111-4111-8111-111111111111';
 const actor={role:'owner',platform_owner:false,active_tenant_id:tenantId};
 const pool={calls:[],query:async function(sql,args=[]){
  this.calls.push({sql,args});return {rowCount:0,rows:[]};}};
 const read=async(pool,a,kind)=>kind==='adsets'
  ?{items:[{id:'2001',campaign_id:'1001',adset_id:'2001',name:'Conjunto 2001',
   effective_status:'ACTIVE',status:'ACTIVE',daily_budget:'5000'}]}:{items:[]};
 const insights=async(pool,a,kind)=>kind==='insights'
  ?{items:[{campaign_id:'1001',impressions:'1000',clicks:'20',spend:'40'}]}:{items:[]};
 const diagnose=async()=>({text:'Leitura do cerebro para o dono.',provider:'deepseek',model:'deepseek-flash'});
 const preview=await runTrafficManager(pool,actor,{env:{},apply:false,read:async(p,a,k)=>
  k==='insights'?insights(p,a,k):read(p,a,k),resolve:async()=>({id:'1234567890'}),diagnose});
 assert.equal(preview.diagnosis,null,'preview answers without waiting for the brain');
 assert.doesNotMatch(preview.report,/Leitura do cerebro/);
 const run=await runTrafficManager(pool,actor,{env:{},read:async(p,a,k)=>
  k==='insights'?insights(p,a,k):read(p,a,k),resolve:async()=>({id:'1234567890'}),
  prepare:async()=>({id:'22222222-2222-4222-8222-222222222222'}),
  execute:async()=>({status:'succeeded',result:{}}),diagnose});
 assert.equal(run.diagnosis.provider,'deepseek');
 assert.match(run.report,/Leitura do cerebro/);
});
