
import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptToken,decryptToken,validateMetaPhone,sendMetaText} from '../meta.mjs';
const key='d'.repeat(64);
const okBody=(v,status=200)=>({ok:status>=200&&status<300,status,json:async()=>v});
test('Meta access tokens use randomized AES-GCM and cannot decrypt with wrong key',()=>{
 const token='EAAX-Fake-Long-Meta-Token-1234567890000';
 const a=encryptToken(token,key),b=encryptToken(token,key);
 assert.notEqual(a,b);assert.equal(decryptToken(a,key),token);
 assert.throws(()=>decryptToken(a,'e'.repeat(64)));
 assert.throws(()=>encryptToken('short',key));
});
test('Meta channel verification checks actual phone ID and full number suffix',async()=>{
 const fake=async(url,opts)=>{
  assert.match(url,/graph.facebook.com/);
  assert.match(opts.headers.Authorization,/Bearer/);
  return okBody({id:'1234567890123',display_phone_number:'+55 15 99811-4257'});
 };
 const valid=await validateMetaPhone({phoneId:'1234567890123',displayPhone:'5515998114257',accessToken:'valid-access-token',fetcher:fake});
 assert.equal(valid.phoneId,'1234567890123');
 await assert.rejects(validateMetaPhone({phoneId:'1234567890123',displayPhone:'5515998110000',accessToken:'valid-access-token',fetcher:fake}),/não coincide/);
 await assert.rejects(validateMetaPhone({phoneId:'invalid',displayPhone:'55',accessToken:'x',fetcher:fake}),/inválido/);
});
test('official send API uses exact recipient and only confirms on provider message ID',async()=>{
 const fake=async(url,opts)=>{
  assert.match(url,/\/messages$/);
  const data=JSON.parse(opts.body);
  assert.equal(data.messaging_product,'whatsapp');
  assert.equal(data.to,'5515998114257');assert.equal(data.text.body,'Olá!');
  return okBody({messages:[{id:'wamid.abc123'}]});
 };
 assert.equal(await sendMetaText({phoneId:'1234567890123',to:'5515998114257',accessToken:'meta-access-token',text:'Olá!',fetcher:fake}),'wamid.abc123');
 await assert.rejects(sendMetaText({phoneId:'1234567890123',to:'5515998114257',accessToken:'token',text:'Olá!',fetcher:async()=>okBody({})}),/confirmação/);
});
