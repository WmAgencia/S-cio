import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readWhatsAppFunnel,formatWhatsAppFunnel} from '../whatsapp-funnel.mjs';
import {speakToSocioSkill} from '../socio-skill-router.mjs';

const tenant=randomUUID();
const actor={active_tenant_id:tenant,user_id:randomUUID(),role:'owner',tenant_status:'active',
 features:{meta_ads:true,whatsapp:true,ai:true,catalog:true,quotes:true,team:true}};
const sample={
 id:randomUUID(),label:'Loja feminina Sorocaba',account_id:'act_12345678',
 campaign_id:'22222222',adset_id:null,ad_id:'33333333',active:true,
 conversations:7,business_responded:5,customer_followed_up:3,
 avg_business_reply_seconds:185,quote_requests:2,purchase_intents:2,
 orders_created:1,sandbox_paid_orders:1,sandbox_revenue_cents:'3800'
};
test('stage5 returns tenant-only funnel, verified business reply and test-only paid amounts',async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});assert.deepEqual(args,[tenant]);assert.match(sql,/WITH attributed AS/);
  assert.match(sql,/first_inbound.direction='inbound'/);
  assert.match(sql,/reply.provider_id IS NOT NULL/);
  assert.match(sql,/follow_up.direction='inbound'/);
  assert.match(sql,/q.tenant_id=a.tenant_id/);
  assert.match(sql,/o.tenant_id=a.tenant_id/);
  assert.match(sql,/o.status='paid_test'/);
  assert.match(sql,/o.payment_provider='stripe_test'/);
  assert.match(sql,/o.paid_at>=a.attributed_at/);
  assert.match(sql,/WHERE a.tenant_id=\$1/);
  assert.match(sql,/WHERE l.tenant_id=\$1/);
  assert(!/\b(INSERT|UPDATE|DELETE|POST)\b/i.test(sql));
  return {rows:[sample]};
 }};
 const result=await readWhatsAppFunnel(pool,actor);
 assert.equal(calls.length,1);assert.equal(result.readOnly,true);
 assert.equal(result.confidence,'indicative');
 const row=result.items[0];
 assert.equal(row.conversations,7);assert.equal(row.businessResponded,5);
 assert.equal(row.customerFollowedUp,3);assert.equal(row.ordersCreated,1);
 assert.equal(row.sandboxPaidOrders,1);assert.equal(row.sandboxRevenueCents,'3800');
 assert.equal(row.livePaidOrders,null);assert.equal(row.liveRevenueCents,null);
 assert.deepEqual([row.campaignId,row.adId],['22222222','33333333']);
 const text=formatWhatsAppFunnel(result);
 assert.match(text,/7 conversas com código/);
 assert.match(text,/5 com resposta registrada/);
 assert.match(text,/Somente em sandbox/);
 assert.match(text,/Vendas reais e receita confirmada: indisponíveis/);
 assert.doesNotMatch(text,/R\$ 38,00 de faturamento real|7 vendas confirmadas/);
});
test('unlinked or missing data never becomes zero verified real revenue',async()=>{
 const pool={query:async()=>({rows:[]})};
 const result=await readWhatsAppFunnel(pool,actor);
 assert.equal(result.items.length,0);
 assert.match(formatWhatsAppFunnel(result),/não prova ausência de clientes/);
 assert.equal(result.partial,false);
 const synthetic={...result,partial:true,items:[{...sample,label:'Teste',conversations:1,businessResponded:0,
  customerFollowedUp:0,quoteRequests:0,purchaseIntents:0,ordersCreated:0,sandboxPaidOrders:0}]};
 assert.match(formatWhatsAppFunnel(synthetic),/Relatório parcial/);
});
test('read-only WhatsApp funnel requires a scoped tenant, permissions and both modules',async()=>{
 let calls=0;
 const pool={query:async()=>{calls++;throw Error('Unexpected query');}};
 await assert.rejects(readWhatsAppFunnel(pool,{...actor,role:'agent'}),{status:403});
 await assert.rejects(readWhatsAppFunnel(pool,{...actor,tenant_status:'paused'}),{status:403});
 await assert.rejects(readWhatsAppFunnel(pool,{...actor,features:{...actor.features,whatsapp:false}}),{status:403});
 await assert.rejects(readWhatsAppFunnel(pool,{...actor,features:{...actor.features,meta_ads:false}}),{status:403});
 assert.equal(calls,0);
});
test('owner can ask WhatsApp funnel conversationally with zero Meta writes',async()=>{
 let reads=0;
 const result=await speakToSocioSkill({query:async()=>{throw Error('No unnecessary DB call')}},actor,
  {message:'Quantas conversas chegaram e responderam no WhatsApp?'},{
  readWhatsAppFunnel:async(_p,a)=>{
   reads++;assert.equal(a.active_tenant_id,tenant);
   return {items:[{
    ...sample,label:'Sorocaba',conversations:1,businessResponded:1,customerFollowedUp:1,
    quoteRequests:0,purchaseIntents:0,ordersCreated:0,sandboxPaidOrders:0
   }],method:'message_code',confidence:'indicative',partial:false};
  },execute:async()=>{throw Error('Unexpected Meta write')},
  prepare:async()=>{throw Error('Unexpected campaign plan')}
 });
 assert.equal(result.status,'completed');assert.equal(result.readOnly,true);
 assert.equal(result.executed,false);assert.equal(reads,1);
 assert.equal(result.skillId,'whatsapp.sales');
 assert.match(result.message,/1 conversas com código/);
 assert.match(result.message,/Vendas reais e receita confirmada: indisponíveis/);
});
test('panel and HTTP API use a separate read-only funnel route',()=>{
 const api=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/attribution-ui.js',import.meta.url),'utf8');
 assert.match(api,/\/api\/marketing\/attribution\/funnel/);
 assert.match(api,/readWhatsAppFunnel\(pool,a\)/);
 assert.match(ui,/attribution\/funnel/);
 assert.match(ui,/Respondidas pela empresa/);
 assert.match(ui,/Somente em teste Stripe/);
});
