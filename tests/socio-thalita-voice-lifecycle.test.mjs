import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {
 isMetaAdsIntent,isMetaOverviewIntent,metaPeriodForQuery,formatFriendlyMetaReport
} from '../socio-thalita-meta-summary.mjs';
import {askThalita} from '../socio-thalita-assistant.mjs';

const actor={
 active_tenant_id:'11111111-1111-4111-8111-111111111111',
 user_id:'22222222-2222-4222-8222-222222222222',
 role:'owner',token_hash:'test-session',
 features:{ai:true,meta_ads:true,whatsapp:true,quotes:true,catalog:true}
};
test('MetaEdge and natural Meta Ads speech variants route to ad platform',()=>{
 for(const text of ['Me faça um resumo das minhas campanhas do MetaEdge',
  'Campanhas da Meta', 'Resumo do Meta Ads', 'Meta EDS: como estão os anúncios?'])
  assert.equal(isMetaAdsIntent(text),true,text);
 assert.equal(isMetaAdsIntent('Resumo de mensagens recebidas hoje'),false);
 assert.equal(isMetaOverviewIntent('Resumo das minhas campanhas'),true);
 assert.equal(metaPeriodForQuery('Como está o MetaEdge hoje?'),'today');
 assert.equal(metaPeriodForQuery('Resumo do Meta Ads'),'last_30d');
});
test('campaign summary includes paused history and meaningful recommendation without WhatsApp statistics',async()=>{
 const pool={query(){throw Error('Business metrics must not be queried for Meta intent');}};
 const result=await askThalita(pool,actor,{message:'Me faça um resumo das minhas campanhas do MetaEdge'},{
  metrics:async()=>{throw Error('Do not read WhatsApp');},
  monitor:async()=>{throw Error('Do not read WhatsApp');},
  metaCampaigns:async(p,a,kind)=>{
   assert.equal(a.active_tenant_id,actor.active_tenant_id);
   assert.equal(kind,'campaigns');
   return {items:[{id:'1000',name:'Campanha ativa',status:'ACTIVE',effective_status:'ACTIVE'},
     {id:'2000',name:'Campanha anterior',status:'PAUSED',effective_status:'PAUSED'}],hasMore:false};
  },
  metaAdvanced:async(p,a,kind,options)=>{
   assert.equal(a.active_tenant_id,actor.active_tenant_id);
   assert.equal(kind,'reports');
   assert.deepEqual(options,{period:'last_30d',level:'campaign'});
   return {items:[{campaign_id:'1000',campaign_name:'Campanha ativa',clicks:'120',
    impressions:'2500',spend:'42.50'},{campaign_id:'2000',campaign_name:'Campanha anterior',
    clicks:'30',impressions:'700',spend:'13.20'}],
    summary:{currency:'BRL'},hasMore:false};
  }
 });
 assert.equal(result.status,'completed');
 assert.equal(result.readOnly,true);
 assert.equal(result.data.listedCampaigns,2);
 assert.equal(result.data.activeCampaigns,1);
 assert.equal(result.data.clicks,150);
 assert.match(result.message,/Campanha ativa/);
 assert.match(result.message,/Sugestão:/);
 assert.doesNotMatch(result.message,/0 oportunidades|Stripe em teste|WA-AKG/);
 assert.ok(result.speechText.length<=650);
});
test('no recent Meta metrics never implies campaigns are missing or WhatsApp counts are zero',()=>{
 const data=formatFriendlyMetaReport({
  campaigns:{items:[{id:'4444',status:'ACTIVE'}],hasMore:false},
  report:{items:[],summary:{currency:'BRL'},hasMore:false},
  period:'today'
 });
 assert.equal(data.data.listedCampaigns,1);
 assert.match(data.message,/não retornou métricas hoje/);
 assert.match(data.message,/Sugestão:/);
 assert.doesNotMatch(data.message,/0 campanhas|0 oportunidades|Nenhuma sessão WA-AKG/);
});
test('noise-gated VAD stops all input tracks and removes document listeners',async()=>{
 const script=readFileSync(new URL('../public/socio-francisca-live.mjs',import.meta.url),'utf8')
  .replace('export function createSocioVoiceSession','function createSocioVoiceSession')+
  '\nglobalThis.createSocioVoiceSession=createSocioVoiceSession;';
 let callback=null,now=0,amplitude=.002,trackStops=0,recorderStarts=0,requestCount=0,contextCloses=0;
 const callbacks=new Map(),pageCallbacks=new Map();
 const stream={getTracks(){return [{enabled:true,stop(){trackStops++;}}];}};
 class FakeRecorder{
  static isTypeSupported(){return true;}
  constructor(){this.state='inactive';this.onstop=null;}
  start(){this.state='recording';recorderStarts++;}
  stop(){if(this.state==='inactive')return;this.state='inactive';
   this.ondataavailable?.({data:new Blob([new Uint8Array(400)])});
   Promise.resolve().then(()=>this.onstop?.());}
 }
 class FakeAudioContext{
  state='running';
  async resume(){}
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:2048,smoothingTimeConstant:.28,
   getFloatTimeDomainData(a){a.fill(amplitude);}};}
  async close(){contextCloses++;}
 }
 const document={hidden:false,
  addEventListener(name,fn){callbacks.set(name,fn);},
  removeEventListener(name){callbacks.delete(name);}};
 const window={MediaRecorder:FakeRecorder,AudioContext:FakeAudioContext,
  addEventListener(name,fn){pageCallbacks.set(name,fn);},
  removeEventListener(name){pageCallbacks.delete(name);}};
 const sandbox={window,document,navigator:{mediaDevices:{getUserMedia:async()=>stream}},
  globalThis:{},setInterval:fn=>(callback=fn,1),clearInterval:()=>{callback=null;},
  Date:{now:()=>now},Math,Float32Array,Uint8Array,Blob,AbortController,URL};
 vm.runInNewContext(script,sandbox);
 const turns=[];
 const session=sandbox.globalThis.createSocioVoiceSession({
  onTurn:async(blob,opts)=>{turns.push({blob,signal:opts.signal});}
 });
 await session.start();
 for(let i=0;i<70;i++){amplitude=i%15===0?.03:.002;now+=85;callback?.();}
 assert.equal(recorderStarts,0,'ambient clicks must not start recording');
 assert.equal(turns.length,0);
 // Genuine speech: sustained energy, followed by enough silence.
 for(let i=0;i<20;i++){amplitude=.10;now+=85;callback?.();}
 assert(recorderStarts>0);
 for(let i=0;i<30;i++){amplitude=.002;now+=85;callback?.();}
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(turns.length,1);
 // A quiet voice has a low average but a real peak: it must still open a turn.
 const startsBeforeQuiet=recorderStarts;
 for(let i=0;i<20;i++){amplitude=.06;now+=85;callback?.();}
 assert(recorderStarts>startsBeforeQuiet,'soft speech must be heard');
 for(let i=0;i<30;i++){amplitude=.002;now+=85;callback?.();}
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(turns.length,2);
 session.stop();
 assert.equal(session.active,false);
 assert.equal(trackStops,1,'recording track must physically stop');
 assert.equal(callback,null,'polling timer must stop');
 assert.equal(callbacks.size,0,'visibility listener must be removed');
 assert.equal(pageCallbacks.size,0,'pagehide listener must be removed');
 assert(contextCloses>=1);
 const count=turns.length;
 for(let i=0;i<30;i++){amplitude=.11;now+=85;callback?.();}
 assert.equal(turns.length,count,'no more STT after stop');
});
test('talking over the assistant interrupts it even with natural gaps between syllables',async()=>{
 const script=readFileSync(new URL('../public/socio-francisca-live.mjs',import.meta.url),'utf8')
  .replace('export function createSocioVoiceSession','function createSocioVoiceSession')+
  '\nglobalThis.createSocioVoiceSession=createSocioVoiceSession;';
 let callback=null,now=0,amplitude=.002,interrupts=0,speaking=true;
 const callbacks=new Map();
 const stream={getTracks(){return [{enabled:true,stop(){}}];}};
 class FakeRecorder{
  static isTypeSupported(){return true;}
  constructor(){this.state='inactive';this.onstop=null;}
  start(){this.state='recording';}
  stop(){if(this.state==='inactive')return;this.state='inactive';Promise.resolve().then(()=>this.onstop?.());}
 }
 class FakeAudioContext{
  state='running';
  async resume(){}
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:2048,smoothingTimeConstant:.28,
   getFloatTimeDomainData(a){a.fill(amplitude);}};}
  async close(){}
 }
 const document={hidden:false,addEventListener(){},removeEventListener(){}};
 const window={MediaRecorder:FakeRecorder,AudioContext:FakeAudioContext,
  addEventListener(){},removeEventListener(){}};
 const sandbox={window,document,navigator:{mediaDevices:{getUserMedia:async()=>stream}},
  globalThis:{},setInterval:fn=>(callback=fn,1),clearInterval:()=>{callback=null;},
  Date:{now:()=>now},Math,Float32Array,Uint8Array,Blob,AbortController,URL};
 vm.runInNewContext(script,sandbox);
 const session=sandbox.globalThis.createSocioVoiceSession({
  onTurn:async()=>{throw Error('an interrupted candidate must not become a turn');},
  canInterrupt:()=>speaking,
  onInterrupt:()=>{interrupts++;speaking=false;}
 });
 await session.start();
 // Room noise while the assistant speaks must not interrupt it.
 for(let i=0;i<12;i++){amplitude=.008;now+=85;callback?.();}
 assert.equal(interrupts,0,'room noise must not stop the assistant');
 // The owner speaks: two voiced frames, a natural 170 ms gap, then more voice.
 for(const a of [.07,.07,.002,.002,.07,.07]){amplitude=a;now+=85;callback?.();}
 assert.equal(interrupts,1,'a short syllable gap must not cancel the interruption');
 session.stop();
});
test('the owner keeps being heard while a turn is in flight: words are queued, never dropped',async()=>{
 const script=readFileSync(new URL('../public/socio-francisca-live.mjs',import.meta.url),'utf8')
  .replace('export function createSocioVoiceSession','function createSocioVoiceSession')+
  '\nglobalThis.createSocioVoiceSession=createSocioVoiceSession;';
 let callback=null,now=0,amplitude=.002;
 const stream={getTracks(){return [{enabled:true,stop(){}}];}};
 class FakeRecorder{
  static isTypeSupported(){return true;}
  constructor(){this.state='inactive';this.onstop=null;}
  start(){this.state='recording';}
  stop(){if(this.state==='inactive')return;this.state='inactive';
   this.ondataavailable?.({data:new Blob([new Uint8Array(400)])});
   Promise.resolve().then(()=>this.onstop?.());}
 }
 class FakeAudioContext{
  state='running';
  async resume(){}
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:2048,smoothingTimeConstant:.28,
   getFloatTimeDomainData(a){a.fill(amplitude);}};}
  async close(){}
 }
 const document={hidden:false,addEventListener(){},removeEventListener(){}};
 const window={MediaRecorder:FakeRecorder,AudioContext:FakeAudioContext,
  addEventListener(){},removeEventListener(){}};
 const sandbox={window,document,navigator:{mediaDevices:{getUserMedia:async()=>stream}},
  globalThis:{},setInterval:fn=>(callback=fn,1),clearInterval:()=>{callback=null;},
  Date:{now:()=>now},Math,Float32Array,Uint8Array,Blob,AbortController,URL};
 vm.runInNewContext(script,sandbox);
 const started=[],pending=[];
 const session=sandbox.globalThis.createSocioVoiceSession({
  onTurn:()=>{started.push(started.length+1);return new Promise(resolve=>pending.push(resolve));}
 });
 await session.start();
 for(const a of [.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10]){amplitude=a;now+=85;callback?.();}
 for(let i=0;i<30;i++){amplitude=.002;now+=85;callback?.();}
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started.length,1,'the first turn reached the server');
 assert.equal(session.processing,true);
 // The owner keeps talking while that turn is still running.
 for(let i=0;i<20;i++){amplitude=.10;now+=85;callback?.();}
 for(let i=0;i<30;i++){amplitude=.002;now+=85;callback?.();}
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(session.processing,true,'the second turn waits its turn instead of being thrown away');
 assert.equal(started.length,1,'turns run one at a time');
 pending.shift()();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started.length,2,'the words spoken during the first turn are still handled');
 pending.shift()();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(session.processing,false);
 session.stop();
});
test('front-end revokes pending STT and response after the audio session is ended',()=>{
 const ui=readFileSync(new URL('../public/socio-thalita-ui.js',import.meta.url),'utf8');
 assert.match(ui,/voiceEpoch\+\+;cancelPendingAnswer\(\)/);
 assert.match(ui,/activeQueryAbort\.abort\(\)/);
 assert.match(ui,/responseDisplayTimer=setTimeout\(show,1800\)/);
 assert.match(ui,/transcriptionAbort\.abort\(\)/);
 assert.match(ui,/session=null;voiceRequested=false/);
 assert.match(ui,/body:blob,signal:controller\.signal/);
 assert.match(ui,/if\(!isActive\(\)\)return/);
 assert.match(ui,/meaningfulVoiceText/);
 assert.match(ui,/onPlaybackStart:show/);
 assert.doesNotThrow(()=>new vm.Script(ui));
});
