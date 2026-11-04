import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {parseQuoteInput,verifyStripeSignature,stripeTestReady,createTestCheckout,processStripeTestEvent} from '../sales-commerce.mjs';
const conversationId='11111111-1111-4111-8111-111111111111';
const productId='22222222-2222-4222-8222-222222222222';
test('quote input rejects arbitrary IDs, quantities and duplicate products',()=>{
 const x=parseQuoteInput({conversationId,items:[{productId,quantity:2,unitPriceCents:1}]});
 assert.deepEqual(x.items,[{productId,variantId:null,quantity:2}]);
 assert.throws(()=>parseQuoteInput({conversationId:'bad',items:[]}),/Selecione/);
 assert.throws(()=>parseQuoteInput({conversationId,items:[{productId,quantity:0}]}),/inválidos/);
 assert.throws(()=>parseQuoteInput({conversationId,items:[{productId,quantity:1},{productId,quantity:2}]}),/Não repita/);
 assert.throws(()=>parseQuoteInput({conversationId,items:Array.from({length:16},()=>({productId,quantity:1}))}),/15 itens/);
});
test('test-only payment requires three sandbox constraints',()=>{
 assert.equal(stripeTestReady({STRIPE_SECRET_KEY:'sk_live_abc',STRIPE_WEBHOOK_SECRET:'whsec_test',SOCIO_PUBLIC_URL:'https://example.com'}),false);
 assert.equal(stripeTestReady({STRIPE_SECRET_KEY:'sk_test_abc',STRIPE_WEBHOOK_SECRET:'whsec_test',SOCIO_PUBLIC_URL:'http://localhost'}),false);
 assert.equal(stripeTestReady({STRIPE_SECRET_KEY:'sk_test_abc',STRIPE_WEBHOOK_SECRET:'whsec_test',SOCIO_PUBLIC_URL:'https://example.com'}),true);
});
test('Stripe webhook requires HMAC, fresh timestamp, valid hex and no replay window',()=>{
 const body=Buffer.from('{"id":"evt_test_1"}'),ts=Math.floor(Date.now()/1000),secret='whsec_testing';
 const signature=createHmac('sha256',secret).update(String(ts)+'.').update(body).digest('hex');
 assert.equal(verifyStripeSignature(body,'t='+ts+',v1='+signature,secret),true);
 assert.equal(verifyStripeSignature(body,'t='+ts+',v1='+signature,'whsec_wrong'),false);
 assert.equal(verifyStripeSignature(Buffer.from('changed'),'t='+ts+',v1='+signature,secret),false);
 assert.equal(verifyStripeSignature(body,'t='+ts+',v1='+signature,secret,(ts+400)*1000),false);
 assert.equal(verifyStripeSignature(body,'t='+ts+',v1=nope',secret),false);
});
test('missing test Stripe credentials make checkout fail before calling any provider',async()=>{
 await assert.rejects(createTestCheckout({},'ab'.repeat(32),{env:{},fetchImpl:()=>{throw Error('must not call')}}),/não configurado/);
});

test('Stripe session is built exclusively with immutable approved order snapshots',async()=>{
 const token='cd'.repeat(32),orderId='33333333-3333-4333-8333-333333333333',tenant='44444444-4444-4444-8444-444444444444';
 const calls=[],env={STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',SOCIO_PUBLIC_URL:'https://socio.example.test'};
 const client={
  async query(sql,params){
   calls.push(sql);
   if(sql.includes('SELECT * FROM sales_orders'))return {rows:[{
    id:orderId,tenant_id:tenant,status:'pending_payment',payment_url:null,payment_session_id:null,
    items:[{name:'Produto de teste',quantity:2,unitPriceCents:1900,variantName:'M'}]
   }],rowCount:1};
   return {rows:[],rowCount:1};
  },
  release(){}
 };
 const pool={
  async query(sql){
   if(sql.includes('FROM sales_quotes q JOIN tenants'))return {rowCount:1,rows:[{status:'accepted',order_id:orderId}]};
   throw Error('unexpected SQL '+sql);
  },
  async connect(){return client}
 };
 let outbound=0;
 const res=await createTestCheckout(pool,token,{env,fetchImpl:async(url,options)=>{
  outbound++;
  assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(options.headers.Authorization,'Bearer sk_test_fixture');
  assert.equal(options.headers['Idempotency-Key'],'socio-test-'+orderId);
  const form=new URLSearchParams(options.body);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'),'1900');
  assert.equal(form.get('line_items[0][quantity]'),'2');
  assert.equal(form.get('metadata[tenant_id]'),tenant);
  assert.equal(form.get('success_url'),'https://socio.example.test/quote.html#'+token);
  return {ok:true,json:async()=>({id:'cs_test_valid',url:'https://checkout.stripe.com/test-checkout'})};
 }});
 assert.equal(outbound,1);
 assert.equal(res.testMode,true);
 assert(calls.some(x=>x.includes('UPDATE sales_orders')));
 assert(calls.includes('COMMIT'));
});
test('webhook test mode validates amount, order linkage and deduplicates events',async()=>{
 const env={STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',SOCIO_PUBLIC_URL:'https://socio.example.test'};
 const id='33333333-3333-4333-8333-333333333333',tenant='44444444-4444-4444-8444-444444444444';
 let inserted=0,paid=0;
 const pool={async connect(){return {
  async query(sql){
   if(sql.includes('SELECT id,tenant_id,amount_cents,status'))return {rowCount:1,rows:[{id,amount_cents:3800,status:'pending_payment',payment_provider:'stripe_test'}]};
   if(sql.includes('SELECT event_id'))return {rowCount:inserted,rows:inserted?[{event_id:'evt_valid'}]:[]};
   if(sql.includes('INSERT INTO sales_payment_events'))inserted++;
   if(sql.includes("UPDATE sales_orders SET status='paid_test'"))paid++;
   return {rowCount:1,rows:[]};
  },release(){}
 }}};
 const event={id:'evt_valid',livemode:false,type:'checkout.session.completed',data:{object:{
  id:'cs_test_valid',payment_status:'paid',mode:'payment',currency:'brl',amount_total:3800,
  metadata:{order_id:id,tenant_id:tenant}}}};
 const body=Buffer.from(JSON.stringify(event));
 const ts=String(Math.floor(Date.now()/1000));
 const sig='t='+ts+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(ts+'.').update(body).digest('hex');
 const first=await processStripeTestEvent(pool,body,sig,{env});
 assert.equal(first.testMode,true);
 const again=await processStripeTestEvent(pool,body,sig,{env});
 assert.equal(again.duplicate,true);
 assert.equal(inserted,1);assert.equal(paid,1);
 const live=Buffer.from(JSON.stringify({...event,livemode:true}));
 const liveSig='t='+ts+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(ts+'.').update(live).digest('hex');
 await assert.rejects(processStripeTestEvent(pool,live,liveSig,{env}),/reais não são aceitos/);
});
