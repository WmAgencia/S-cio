import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateInteractivePayload,jpegBytes,interactiveSignature,sendGatewayInteractive,
 productCaption,productQuickReplies} from '../socio-interactive.mjs';
import {buildQuickReplyMessage,sendQuickReplies,loadCatalogCard,sendCatalogCard,
 suggestedCatalogProduct} from '../socio-rich-outbound.mjs';
const env={SOCIO_OUTBOUND_ENABLED:'true',
 WA_AKG_API_KEY:'example-gateway-signing-key-not-a-secret-2026',
 WA_AKG_BASE_URL:'http://127.0.0.1:3000',CHANNEL_ENCRYPTION_KEY:'test-channel-key-must-be-at-least-32-bytes'};
const tenantId='11111111-1111-4111-8111-111111111111';
const conversationId='22222222-2222-4222-8222-222222222222';
const productId='33333333-3333-4333-8333-333333333333';
const mediaId='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const bytes=Buffer.concat([Buffer.from('ffd8','hex'),Buffer.alloc(40,1),Buffer.from('ffd9','hex')]);

test('Native Flow allows quick replies, rejects extra buttons/duplicate IDs/external types',()=>{
 const m=buildQuickReplyMessage({message:'Posso ajudar?',choices:['Ver preços','Falar com atendente']});
 assert.equal(m.type,'buttons');
 assert.equal(m.buttons.length,2);
 assert.equal(m.buttons[1].type,'quick_reply');
 assert.equal(new Set(m.buttons.map(b=>b.id)).size,2);
 assert.throws(()=>buildQuickReplyMessage({message:'Olá',choices:['Igual','Igual']}),/duplicados/);
 assert.throws(()=>buildQuickReplyMessage({message:'Olá',choices:['1','2','3','4']}),/1 a 3/);
 assert.throws(()=>validateInteractivePayload({...m,buttons:[{type:'cta_url',displayText:'Site',url:'https://example.org'}]}),/Apenas respostas rápidas/);
 assert.throws(()=>validateInteractivePayload({...m,imageBase64:bytes.toString('base64')}),/fotos somente/);
});
test('Private JPEG card carries catalog price, description, variations, and quick replies',()=>{
 assert.equal(jpegBytes(bytes),true);
 assert.equal(jpegBytes(Buffer.alloc(20)),false);
 const body=productCaption({name:'Sérum Exemplo',description:'Tratamento pós-depilação',
  price_cents:4590,stock_quantity:12,active:true,variants:[{name:'30 ml',active:true,stock_quantity:5}]});
 assert.match(body,/Sérum Exemplo/);
 assert.match(body,/R\$\s?45,90/);
 assert.match(body,/30 ml/);
 assert.equal(productQuickReplies(productId).length,3);
 assert.throws(()=>productCaption({name:'Sérum',price_cents:1000,stock_quantity:0,active:true}),/indisponível/);
 const p=validateInteractivePayload({type:'product',title:'Sérum',
  body,footer:'Produto cadastrado',buttons:productQuickReplies(productId),imageBase64:bytes.toString('base64')});
 assert.equal(p.type,'product');
 assert.deepEqual(Buffer.from(p.imageBase64,'base64'),bytes);
});
test('Interactive gateway request is HMAC signed and requires remote WhatsApp confirmation',async()=>{
 const sessionId='socio_1234567890123456789012345678901234567890',
  jid='5515999999999@s.whatsapp.net';
 const payload=buildQuickReplyMessage({message:'Qual opção?',choices:['Ver produto']});
 let n=0;
 const send=async(url,opts)=>{
  n++;
  assert.match(url,/\/interactive$/);
  assert.equal(url.includes('5515999999999%40s.whatsapp.net'),true);
  const json=JSON.parse(opts.body);
  assert.deepEqual(json,payload);
  const expected=interactiveSignature({timestamp:opts.headers['x-socio-outbound-at'],
   sessionId,jid,payload,key:env.WA_AKG_API_KEY});
  assert.equal(opts.headers['x-socio-outbound-signature'],expected);
  return {ok:true,json:async()=>({status:true,
   data:{key:{id:'INTERACTIVE001',fromMe:true,remoteJid:jid}}})};
 };
 const ack=await sendGatewayInteractive({sessionId,jid,payload,env,fetchImpl:send});
 assert.equal(ack.sent,true);assert.equal(n,1);
 await assert.rejects(sendGatewayInteractive({sessionId,jid,payload,env,
  fetchImpl:async()=>({ok:true,json:async()=>({status:true,
   data:{key:{id:'bad',remoteJid:'5522999999999@s.whatsapp.net',fromMe:true}}})})}),/destinatário/);
 await assert.rejects(sendGatewayInteractive({sessionId,jid,payload,env:{}}),/Envio não habilitado/);
});
test('Product photo is sourced only from the owning tenant and existing catalog media',async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});
  assert.equal(args[0],tenantId);
  assert.equal(args[1],productId);
  if(sql.includes('FROM products WHERE'))return {rowCount:1,rows:[{
   id:productId,name:'Creme Solar',description:'Proteção diária',price_cents:9900,
   active:true,stock_quantity:15
  }]};
  if(sql.includes('FROM product_media'))return {rowCount:1,rows:[{
   id:mediaId,object_key:tenantId+'/'+productId+'/image.jpg',content_type:'image/jpeg'
  }]};
  if(sql.includes('FROM product_variants'))return {rowCount:1,rows:[{name:'100 ml',active:true,stock_quantity:12}]};
  throw Error('SQL not expected: '+sql);
 }};
 let storedKey;
 const card=await loadCatalogCard(pool,tenantId,productId,{readImage:async(key)=>{
  storedKey=key;return bytes;
 }});
 assert(storedKey.startsWith(tenantId+'/'+productId));
 assert.equal(card.productId,productId);assert.equal(card.mediaId,mediaId);
 assert.deepEqual(Buffer.from(card.payload.imageBase64,'base64'),bytes);
 assert.equal(card.payload.buttons[0].displayText,'Tenho interesse');
 assert(calls.every(c=>c.args[0]===tenantId));
 let delivered,seenPayload;
 const result=await sendCatalogCard(pool,{tenantId,conversationId,clientRequestId:requestId,
  productId,readImage:async()=>bytes,deliver:async(_db,props)=>{
   delivered=props;await props.send({sessionId:'sessionA',jid:'5515999999999@s.whatsapp.net'});
   return {sent:true,id:'outbox'};
  },send:async({payload})=>{
   seenPayload=payload;return {sent:true,providerId:'key123'};
  }});
 assert.equal(result.sent,true);
 assert.equal(delivered.kind,'product');
 assert.equal(delivered.sourceProductId,productId);
 assert.equal(delivered.sourceMediaId,mediaId);
 assert.match(delivered.payloadFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(seenPayload.type,'product');
 const foreign={query:async()=>({rowCount:0,rows:[]})};
 await assert.rejects(loadCatalogCard(foreign,tenantId,productId,{readImage:async()=>bytes}),
  /não encontrado nesta empresa/);
});
test('Deterministic product selection never guesses across multiple similar products',()=>{
 const p=[{id:productId,name:'Sérum Telocapil',active:true,stock_quantity:7},
  {id:'66666666-6666-4666-8666-666666666666',name:'Creme Facial',active:true,stock_quantity:9}];
 assert.equal(suggestedCatalogProduct('Me envia a foto do Sérum Telocapil, por favor',p),productId);
 assert.equal(suggestedCatalogProduct('Olá, tenho uma dúvida',p),null);
 assert.equal(suggestedCatalogProduct('Quero ver preço',p),null);
 assert.equal(suggestedCatalogProduct('Mostra o Sérum Telocapil e o Creme Facial',p),null);
});
test('Manual buttons use one tenant-bound request and preserve idempotency fingerprint',async()=>{
 let payload;
 const result=await sendQuickReplies(null,{tenantId,conversationId,clientRequestId:requestId,
  message:'Escolha sua opção',choices:['Ver produto','Atendimento'],
  deliver:async(_pool,props)=>{payload=props;return {sent:true,id:'ok'};}});
 assert.equal(result.sent,true);
 assert.equal(payload.kind,'buttons');
 assert.equal(payload.mode,'human');
 assert.match(payload.payloadFingerprint,/^[0-9a-f]{64}$/);
});
test('Gateway private patch HMACs product and button messages; no broadcast or general media',()=>{
 const patch=readFileSync(new URL('../waakg-socio/patch_interactive.py',import.meta.url),'utf8');
 const docker=readFileSync(new URL('../waakg-socio/Dockerfile',import.meta.url),'utf8');
 assert.match(patch,/socioOutboundContext\.run\(true/);
 assert.match(patch,/x-socio-outbound-signature/);
 assert.match(patch,/timingSafeEqual/);
 assert.match(patch,/quick_reply/);
 assert.ok(patch.includes('whatsapp.net'));

 assert.match(docker,/patch_interactive\.py/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const inbox=readFileSync(new URL('../inbox-api.mjs',import.meta.url),'utf8');
 assert.match(server,/send-interactive\|send-product/);
 assert.match(inbox,/route==='send-product'/);
 assert.match(inbox,/route==='send-interactive'/);
});
