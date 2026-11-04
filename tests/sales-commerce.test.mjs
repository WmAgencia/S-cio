import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {parseQuoteInput,verifyStripeSignature,stripeTestReady,createTestCheckout} from '../sales-commerce.mjs';
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
