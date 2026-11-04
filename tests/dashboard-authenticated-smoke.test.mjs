import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('authenticated Sócio boot renders lavender dashboard and never stays blank',async()=>{
 const nodes=new Map();
 const make=(key)=>{
  if(!nodes.has(key)){
   const hidden=new Set(['authScreen','appShell'].includes(key)?['hidden']:[]);
   nodes.set(key,{
    textContent:'',innerHTML:'',value:'',style:{},dataset:{},
    classList:{
     contains:c=>hidden.has(c),
     add:c=>hidden.add(c),
     remove:c=>hidden.delete(c),
     toggle:(c,force)=>{if(force===undefined?!hidden.has(c):force)hidden.add(c);else hidden.delete(c)}
    },
    addEventListener(){},setAttribute(){},focus(){},scrollIntoView(){},
    querySelector(){return make(key+':child')},querySelectorAll(){return []}
   });
  }
  return nodes.get(key);
 };
 const names=['overview','inbox','channels','products','training','team','admin'];
 const nav=names.map(name=>({ ...make('nav:'+name), dataset:{view:name}, querySelector:()=>make('symbol:'+name) }));
 const doc={
  querySelector:sel=>make(sel.replace(/^#/,'id:')),
  querySelectorAll:sel=>sel.includes('.nav-item')?nav:[],
  addEventListener(){}
 };
 const resources={
  '/api/bootstrap':{initialized:true},
  '/api/me':{user:{name:'Conta master',role:'owner',platformOwner:true},
   tenant:{name:'Consecom Brasil'},csrf:'csrf-abc'},
  '/api/dashboard':{openConversations:2,channels:1,products:4,imports:5,inboundMessages:9},
  '/api/agent':{instructions:'Atenda com respeito.',enabled:false},
  '/api/dashboard/activity?range=6m':{range:'6m',granularity:'month',points:[
    {date:'2026-08-01',inbound:2,outbound:1},
    {date:'2026-09-01',inbound:3,outbound:2}
  ]},
  '/api/inbox':[{customer_name:'Cliente de teste',customer_phone:'5515999999999',
    channel_label:'Atendimento',last_message_at:'2026-11-03T11:00:00Z',status:'open'}]
 };
 const context={document:doc,Date,URL,Intl,FormData,console,setTimeout,clearTimeout,
  fetch:async path=>({ok:!!resources[path],status:resources[path]?200:404,
   json:async()=>resources[path]||{error:'Not found'}})
 };
 assert.doesNotThrow(()=>vm.runInNewContext(code,context,{timeout:3000}));
 await new Promise(resolve=>setTimeout(resolve,60));
 const dashboard=make('id:view');
 assert.equal(make('id:appShell').classList.contains('hidden'),false);
 assert.equal(make('id:authScreen').classList.contains('hidden'),true);
 assert.match(dashboard.innerHTML,/class="lucid-dashboard"/);
 assert.match(dashboard.innerHTML,/Conectar via QR Code/);
 assert.match(dashboard.innerHTML,/Cliente de teste/);
 assert.match(dashboard.innerHTML,/Mensagens recebidas/);
 assert.doesNotMatch(dashboard.innerHTML,/Não foi possível carregar|class="loading"/);
});
