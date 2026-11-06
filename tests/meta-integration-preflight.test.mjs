import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {metaConnectionPreflight} from '../meta-integration-preflight.mjs';

const actor={active_tenant_id:'11111111-1111-4111-8111-111111111111',
 user_id:'22222222-2222-4222-8222-222222222222',role:'owner',
 features:{meta_ads:true,whatsapp:true,catalog:true,quotes:true,ai:true,team:true},
 tenant_status:'active'};
const full={configured:true,connected:true,
 grant:{scopes:['ads_read','ads_management']},
 selectedAccount:{account_id:'act_123456789',account_name:'Empresa de teste',currency:'BRL'}};

test('official app preflight requires the tenant and Meta permission before reading',async()=>{
 const missing=await metaConnectionPreflight(null,actor,{
  statusFn:async()=>({...full,connected:false}),
  readFn:async()=>{throw new Error('Must not call Graph without valid grant');}});
 assert.equal(missing.status,'needs_connection');
 assert.equal(missing.checks.length,0);
 await assert.rejects(metaConnectionPreflight(null,{...actor,role:'agent'},{
  statusFn:async()=>full}),e=>e.status===403);
 await assert.rejects(metaConnectionPreflight(null,{...actor,features:{...actor.features,meta_ads:false}},{
  statusFn:async()=>full}),e=>e.status===403);
});

test('healthy preflight verifies app account reads, not ChatGPT connector',async()=>{
 let queried=[];
 const health=await metaConnectionPreflight(null,actor,{statusFn:async()=>full,
  readFn:async(_pool,a,kind,input)=>{
   queried.push({tenant:a.active_tenant_id,kind,period:input.period});
   return {items:[{id:'123456',name:'Campanha de teste',effective_status:'ACTIVE'}],hasMore:false};
  }});
 assert.equal(health.status,'read_ready');
 assert.equal(health.accountId,'act_123456789');
 assert.equal(health.hasAdsManagement,true);
 assert.equal(queried.length,6);
 assert(queried.every(x=>x.tenant===actor.active_tenant_id&&x.period==='last_7d'));
 assert(health.checks.every(x=>x.ok));
 assert(!JSON.stringify(health).includes('access_token'));
});
test('preflight shows partial failure without inventing success or mutating ads',async()=>{
 const status=await metaConnectionPreflight(null,actor,{statusFn:async()=>full,
  readFn:async(_pool,a,kind)=>kind==='ads'?Promise.reject(new Error('Token de permissão insuficiente'))
   :{items:[],hasMore:false}});
 assert.equal(status.status,'partial');
 assert.equal(status.checks.find(x=>x.kind==='ads').ok,false);
 assert.match(status.reason,/falharam/i);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/meta-official-ui.js',import.meta.url),'utf8');
 assert.match(server,/\/api\/marketing\/official\/preflight/);
 assert.match(ui,/Testar conexão oficial/);
});
