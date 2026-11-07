import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {billingConfiguration,readSubscriptionStatus,createSubscriptionCheckout,verifyStripeBillingSignature,processSubscriptionWebhook,createBillingPortal} from '../socio-subscriptions.mjs';

const tenant=randomUUID(),uid=randomUUID();
const actor={active_tenant_id:tenant,user_id:uid,role:'owner',tenant_status:'trial'};
const conf={SOCIO_BILLING_ENABLED:'true',SOCIO_STRIPE_SECRET_KEY:'sk_test_notarealtestsecret',
 SOCIO_STRIPE_BILLING_WEBHOOK_SECRET:'whsec_notarealsecret',
 SOCIO_PUBLIC_URL:'https://socio-app-production-762c.up.railway.app',
 SOCIO_STRIPE_PRICE_ESSENCIAL:'price_abcdef12345678'};
test('Stripe billing disabled by default; no price or key is invented',()=>{
 const d=billingConfiguration({});
 assert.equal(d.enabled,false);assert.equal(d.mode,'unconfigured');
 assert.equal(d.plans.essencial,false);
 const x=billingConfiguration({...conf,SOCIO_BILLING_ENABLED:'false'});
 assert.equal(x.enabled,false);
 assert.equal(billingConfiguration(conf).enabled,true);
 const code=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 assert.match(code,/CREATE TABLE IF NOT EXISTS socio_billing_accounts/);
 assert.match(code,/CREATE TABLE IF NOT EXISTS socio_billing_webhook_events/);
 assert.doesNotMatch(code,/CREATE TRIGGER.*subscription_status.*tenants/i);
});
test('read-only subscription state does not call Stripe or confuse trial with payment',async()=>{
 const db={query:async(sql,params)=>{
  assert.equal(params[0],tenant);
  if(sql.includes('FROM tenants'))return {rows:[{id:tenant,plan:'essencial',status:'trial',created_at:'2026-11-01T20:00:00Z'}]};
  return {rows:[]};
 }};
 const result=await readSubscriptionStatus(db,actor,{env:conf,now:new Date('2026-11-06T20:00:00Z')});
 assert.equal(result.trial.daysRemaining,2);
 assert.equal(result.subscription.status,'not_started');
 assert.equal(result.subscription.paidInvoices,0);
 assert.equal(result.checkout.available,true);
 assert.match(result.note,/conta ativa não prova/i);
});
test('authenticated checkout creates Stripe session only after explicit call; respects remaining trial',async()=>{
 const queries=[];
 const pool={query:async(sql,args)=>{
  queries.push(sql);
  if(sql.includes('FROM tenants'))return {rows:[{id:tenant,name:'Empresa Teste',plan:'essencial',status:'trial',created_at:'2026-11-01T20:00:00Z'}]};
  if(sql.includes('FROM socio_billing_accounts'))return {rows:[]};
  if(sql.includes('FROM users'))return {rows:[{email:'test@example.com'}]};
  if(sql.startsWith('INSERT INTO socio_billing_accounts'))return {rowCount:1,rows:[{tenant_id:tenant}]};
  throw Error('unexpected SQL');
 }};
 let calls=0;
 const checkout=await createSubscriptionCheckout(pool,actor,{env:conf,now:new Date('2026-11-06T20:00:00Z'),
  fetcher:async(url,req)=>{
   calls++;assert.match(url,/checkout\/sessions$/);
   assert.match(req.headers.Authorization,/Bearer sk_test_/);
   assert.equal(req.body.get('mode'),'subscription');
   assert.equal(req.body.get('line_items[0][price]'),'price_abcdef12345678');
   assert.equal(req.body.get('subscription_data[metadata][tenant_id]'),tenant);
   assert.equal(req.body.get('subscription_data[trial_end]'),String(Date.parse('2026-11-08T20:00:00Z')/1000));
   return {ok:true,json:async()=>({id:'cs_test_abcdefgh123',url:'https://checkout.stripe.com/c/pay/example'})};
  }});
 assert.equal(calls,1);assert.equal(checkout.environment,'test');assert.equal(checkout.plan,'essencial');
 assert.equal(checkout.trialDaysRemaining,2);
 assert(queries.some(q=>q.startsWith('INSERT INTO socio_billing_accounts')));
 assert(!queries.some(q=>/^UPDATE tenants/i.test(q)));
 await assert.rejects(createSubscriptionCheckout(pool,{...actor,role:'agent'},{env:conf}),{status:403});
 await assert.rejects(createSubscriptionCheckout(pool,actor,{env:{...conf,SOCIO_BILLING_ENABLED:'false'}}),{status:503});
});
test('existing subscriptions cannot be replaced by an accidental second checkout',async()=>{
 const pool={query:async(sql)=>{
  if(sql.includes('FROM tenants'))return {rows:[{id:tenant,plan:'essencial',created_at:'2026-11-01'}]};
  if(sql.includes('FROM socio_billing_accounts'))return {rows:[{subscription_status:'active',stripe_customer_id:'cus_abcdefgh123'}]};
  return {rows:[{email:'test@example.com'}]};
 }};
 await assert.rejects(createSubscriptionCheckout(pool,actor,{env:conf,fetcher:async()=>{throw Error('no billing call allowed')}}),{status:409});
});
test('signature authenticates raw body, checks timestamp, detects tamper and wrong secret',()=>{
 const ts=1800000000,raw=Buffer.from(JSON.stringify({id:'evt_abcdef12345678',type:'invoice.paid',livemode:false,data:{object:{}}}));
 const h=createHmac('sha256',conf.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET).update(ts+'.').update(raw).digest('hex');
 const header='t='+ts+',v1='+h;
 assert.equal(verifyStripeBillingSignature(raw,header,conf.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET,{now:ts*1000}).type,'invoice.paid');
 assert.throws(()=>verifyStripeBillingSignature(Buffer.from('{}'),header,conf.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET,{now:ts*1000}),{status:400});
 assert.throws(()=>verifyStripeBillingSignature(raw,header,conf.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET,{now:ts*1000+301000}),{status:400});
 assert.throws(()=>verifyStripeBillingSignature(raw,header,'whsec_wrongsecret',{now:ts*1000}),{status:400});
});
test('verified checkout event requires server-issued session and does not activate the tenant',async()=>{
 const ts=1800000000,event={
  id:'evt_abcdef12345678',created:ts,type:'checkout.session.completed',livemode:false,
  data:{object:{id:'cs_test_abcdefgh123',client_reference_id:tenant,
   customer:'cus_abcdefgh123',subscription:'sub_abcdefgh123'}}};
 const raw=Buffer.from(JSON.stringify(event));
 const sig='t='+ts+',v1='+createHmac('sha256',conf.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET).update(ts+'.').update(raw).digest('hex');
 let accepted=false,rolled=false;
 const db={connect:async()=>({query:async(sql,args=[])=>{
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){if(sql==='ROLLBACK')rolled=true;return {rowCount:0};}
  if(sql.startsWith('INSERT INTO socio_billing_webhook_events'))return {rowCount:1};
  if(sql.startsWith('SELECT stripe_customer_id'))return {rows:[{stripe_checkout_session_id:'cs_test_abcdefgh123',
   stripe_customer_id:null,stripe_subscription_id:null,stripe_mode:'test',last_subscription_event_created:0}]};
  if(sql.startsWith('INSERT INTO socio_billing_accounts')){accepted=true;return {rowCount:1};}
  if(sql.startsWith('UPDATE socio_billing_webhook_events'))return {rowCount:1};
  throw Error('unexpected write '+sql);
 },release(){}})};
 const result=await processSubscriptionWebhook(db,raw,sig,{env:conf,now:ts*1000});
 assert.equal(result.updated,true);assert.equal(accepted,true);assert.equal(rolled,false);
 const tampered=Buffer.from(JSON.stringify({...event,data:{object:{...event.data.object,id:'cs_test_WRONG98765'}}}));
 const sig2='t='+ts+',v1='+createHmac('sha256',conf.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET).update(ts+'.').update(tampered).digest('hex');
 await assert.rejects(processSubscriptionWebhook(db,tampered,sig2,{env:conf,now:ts*1000}),{status:409});
 assert.equal(rolled,true);
});
test('portal refuses to open without verified Stripe customer; no implicit subscription',async()=>{
 await assert.rejects(createBillingPortal({query:async()=>({rows:[]})},actor,{env:conf}),{status:409});
 const app=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(app,/\/webhooks\/stripe-saas/);
 assert.match(app,/processSubscriptionWebhook\(pool,raw,req\.headers\['stripe-signature'\]\)/);
 assert.match(app,/\/api\/billing\/checkout/);
 assert.match(app,/\/api\/billing\/portal/);
});
