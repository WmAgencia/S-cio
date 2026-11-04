import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outboundEnabled,canAutoReply,textPayload,gatewaySignature,sendGatewayText,deliverToConversation} from '../socio-outbound.mjs';
import {buildAiInstructions,processNextAiReply} from '../ai-replies.mjs';
const env={WA_AKG_API_KEY:'gateway-unit-test-key-very-long-not-real',
 WA_AKG_BASE_URL:'http://127.0.0.1:39000',CHANNEL_ENCRYPTION_KEY:'0123456789abcdef0123456789abcdef',
 SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',GROQ_API_KEY:'groq-fake-test-only-key-12345678'};
const tenantId='11111111-1111-4111-8111-111111111111';
const conversationId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
test('Outbound and Groq auto replies require explicit feature switches',()=>{
 assert.equal(outboundEnabled({...env,SOCIO_OUTBOUND_ENABLED:'false'}),false);
 assert.equal(canAutoReply({...env,SOCIO_AUTOREPLY_ENABLED:'false'}),false);
 assert.equal(canAutoReply({...env,GROQ_API_KEY:''}),false);
 assert.equal(canAutoReply(env),true);
 assert.throws(()=>textPayload(' '),/3000/);
 assert.throws(()=>textPayload('x'.repeat(3001)),/3000/);
 assert.equal(textPayload(' Oi  '),'Oi');
 assert.throws(()=>gatewaySignature({timestamp:'1',sessionId:'sessionName123',
 jid:'12345@g.us',text:'oi',key:env.WA_AKG_API_KEY}),/Destinatário/);
});
test('Gateway send signs one private recipient and verifies provider success',async()=>{
 const sessionId='socio_1234567890123456789012345678901234567890';
 const jid='5515999999999@s.whatsapp.net';
 const mocked=async(url,opts)=>{
  const body=JSON.parse(opts.body);
  assert.deepEqual(body,{message:{text:'Olá'}});
  assert.match(url,/\/api\/messages\/.*\/send$/);
  assert.equal(opts.headers['x-socio-outbound-signature'],
   gatewaySignature({timestamp:opts.headers['x-socio-outbound-at'],sessionId,jid,text:'Olá',key:env.WA_AKG_API_KEY}));
  return {ok:true,json:async()=>({status:true,data:{key:{id:'ABC123',remoteJid:jid,fromMe:true}}})};
 };
 const result=await sendGatewayText({sessionId,jid,text:'Olá',env,fetchImpl:mocked});
 assert.equal(result.sent,true);
 assert.equal(result.providerId,'ABC123');
 await assert.rejects(sendGatewayText({sessionId,jid,text:'Olá',env,fetchImpl:async()=>({
  ok:true,json:async()=>({status:true,data:{key:{id:'different',remoteJid:'5515111111111@s.whatsapp.net',fromMe:true}}})
 })}),/destinatário/);
});
test('Manual outbound persists idempotency before sending, rejects mode AI under human control',async()=>{
 let count=0,created=false;
 const pool={query:async(sql,args=[])=>{
  if(sql.includes('FROM conversations c JOIN channels ch'))return {rowCount:1,rows:[{
   id:conversationId,customer_phone:'5515888888888',status:'human',session_id:'session987',
   linked_phone:'5515999999999',handling_mode:'human',agent_enabled:true
  }]};
  if(sql.startsWith('INSERT INTO message_outbox')){
   if(created)return {rowCount:0,rows:[]};
   created=true;return {rowCount:1,rows:[{id:requestId}]};
  }
  if(sql.startsWith('SELECT id,status,conversation_id,mode,body,reply_to_id,kind,payload_fingerprint,product_id,media_id FROM message_outbox'))return {
   rowCount:1,rows:[{id:requestId,status:'sent',conversation_id:conversationId,
    mode:'human',body:'Boa tarde!',reply_to_id:null,kind:'text',payload_fingerprint:null,product_id:null,media_id:null}]};
  if(sql.includes("status='processing'"))return {rowCount:1,rows:[{id:requestId}]};
  return {rowCount:1,rows:[]};
 }};
 const getStatus=async()=>({connected:true,connectedNumber:'5515999999999'});
 const send=async()=>{count++;return {sent:true,providerId:'remote001'};};
 const data={tenantId,conversationId,mode:'human',text:'Boa tarde!',clientRequestId:requestId,env,getStatus,send};
 const first=await deliverToConversation(pool,data);
 assert.equal(first.whatsappSent,true);
 const second=await deliverToConversation(pool,data);
 assert.equal(second.reused,true);
 assert.equal(count,1);
 await assert.rejects(deliverToConversation(pool,{...data,text:'Outro conteúdo'}),
  /Identificador de envio já foi usado/,'Same request ID cannot represent a different body');
 await assert.rejects(deliverToConversation(pool,{...data,mode:'ai',
  clientRequestId:'44444444-4444-4444-8444-444444444444'}),/IA não foi autorizada/);
});
test('Automatic reply worker is off until opted in, gateway patch remains fail-closed',async()=>{
 const result=await processNextAiReply({query:async()=>{throw Error('Database should not be queried');}},
  {env:{...env,SOCIO_AUTOREPLY_ENABLED:'false'}});
 assert.equal(result.processed,false);
 assert.match(buildAiInstructions({tenantName:'Loja',products:[{name:'Serviço',price_cents:55000,stock_quantity:3}]}),/550,00/);
 const patch=readFileSync(new URL('../waakg-socio/patch_readonly.py',import.meta.url),'utf8');
 for(const part of ['socioOutboundContext','timingSafeEqual','SOCIO_GATEWAY_READ_ONLY',
  'message.text.length <= 3000','x-socio-outbound-signature'])assert.ok(patch.includes(part));
});
