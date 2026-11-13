import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outboundEnabled,canAutoReply,textPayload,outboundRecipient,mediaPayload,gatewaySignature,sendGatewayText,sendGatewayMessage,deliverToConversation} from '../socio-outbound.mjs';
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
 assert.equal(outboundRecipient('5515999999999@s.whatsapp.net'),true);
 assert.equal(outboundRecipient('123456789012345@g.us'),true);
 assert.equal(outboundRecipient('123456789012345-678901234567890@g.us'),true);
 assert.equal(outboundRecipient('status@broadcast'),false);
 assert.equal(outboundRecipient('123456789012345@newsletter'),false);
 assert.equal(outboundRecipient('123456789012345@lid'),false);
 assert.equal(outboundRecipient('not-a-jid'),false);
 assert.throws(()=>gatewaySignature({timestamp:'1',sessionId:'sessionName123',
 jid:'status@broadcast',text:'oi',key:env.WA_AKG_API_KEY}),/Destinatário/);
});
test('Owner channel media must be served by Sócio and stays inside caption limits',()=>{
 const mediaEnv={...env,SOCIO_PUBLIC_URL:'https://socio.example.com'};
 const image=mediaPayload({kind:'image',url:'https://socio.example.com/media/abc.jpg',caption:' Veja '},mediaEnv);
 assert.deepEqual(image,{kind:'image',url:'https://socio.example.com/media/abc.jpg',caption:'Veja'});
 assert.throws(()=>mediaPayload({kind:'audio',url:'https://socio.example.com/a.mp3'},mediaEnv),/Tipo de mídia/);
 assert.throws(()=>mediaPayload({kind:'image',url:'https://evil.example.com/x.jpg'},mediaEnv),/servida pelo próprio Sócio/);
 assert.throws(()=>mediaPayload({kind:'video',url:'https://socio.example.com:8443/x.mp4'},mediaEnv),/servida pelo próprio Sócio/);
 assert.throws(()=>mediaPayload({kind:'video',url:'https://user:pw@socio.example.com/x.mp4'},mediaEnv),/servida pelo próprio Sócio/);
 assert.throws(()=>mediaPayload({kind:'video',url:'https://socio.example.com/x.mp4#frag'},mediaEnv),/servida pelo próprio Sócio/);
 assert.throws(()=>mediaPayload({kind:'image',url:'relative/x.jpg'},mediaEnv),/Endereço de mídia/);
 assert.throws(()=>mediaPayload({kind:'image',url:'https://socio.example.com/x.jpg'},{...env,SOCIO_PUBLIC_URL:''}),/servida pelo próprio Sócio/);
 assert.throws(()=>mediaPayload({kind:'image',url:'https://socio.example.com/x.jpg',caption:'x'.repeat(1025)},mediaEnv),/Legenda/);
 assert.throws(()=>mediaPayload({kind:'image',url:'https://socio.example.com/x.jpg',caption:'a\u0001b'},mediaEnv),/Legenda/);
});
test('Gateway media send signs the canonical media payload and one group recipient',async()=>{
 const sessionId='socio_1234567890123456789012345678901234567890';
 const jid='123456789012345@g.us';
 const mediaEnv={...env,SOCIO_PUBLIC_URL:'https://socio.example.com'};
 const media=mediaPayload({kind:'video',url:'https://socio.example.com/media/v.mp4',caption:'Confira'},mediaEnv);
 const mocked=async(url,opts)=>{
  const body=JSON.parse(opts.body);
  assert.deepEqual(body,{message:{video:{url:'https://socio.example.com/media/v.mp4',caption:'Confira'}}});
  assert.match(url,/\/api\/messages\/.*\/send$/);
  assert.equal(opts.headers['x-socio-outbound-signature'],
   gatewaySignature({timestamp:opts.headers['x-socio-outbound-at'],sessionId,jid,media,key:env.WA_AKG_API_KEY}));
  return {ok:true,json:async()=>({status:true,data:{key:{id:'VID1',remoteJid:jid,fromMe:true}}})};
 };
 const result=await sendGatewayMessage({sessionId,jid,media,env:mediaEnv,fetchImpl:mocked});
 assert.equal(result.sent,true);
 assert.equal(result.providerId,'VID1');
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
  if(sql.startsWith('SELECT id,status,conversation_id,mode,body,reply_to_id FROM message_outbox'))return {
   rowCount:created&&args[1]===requestId?1:0,rows:created&&args[1]===requestId?[{id:requestId,status:'sent',conversation_id:conversationId,
    mode:'human',body:'Boa tarde!',reply_to_id:null}]:[]};
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
  'plainText.length <= 3000','x-socio-outbound-signature','groupRecipient','privateRecipient',
  'caption.length <= 1024','media.url.startsWith(publicOrigin'])assert.ok(patch.includes(part),part);
 assert.equal(patch.includes('@newsletter'),false,'newsletter recipients must not be allowed');
});
