import test from 'node:test';
import assert from 'node:assert/strict';
import {
 gatewayConfigured,gatewayBase,privateJid,selectPrivateChats,
 encryptJid,decryptJid,jidHash,normalizeHistoryMessages,
 getSessionStatus,listAvailableChats,loadChatSample
} from '../waakg-adapter.mjs';
const env={WA_AKG_BASE_URL:'http://localhost:4444',WA_AKG_API_KEY:'test-access-only',
 CHANNEL_ENCRYPTION_KEY:'0123456789abcdef0123456789abcdef0123456789abcdef'};
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const channel='33333333-3333-4333-8333-333333333333',jid='5515999999999@s.whatsapp.net';
const fakeResponse=data=>({ok:true,text:async()=>JSON.stringify(data)});
test('gateway config never accepts public HTTP, hidden authentication or missing secret',()=>{
 assert(gatewayConfigured(env));assert.equal(gatewayBase(env),'http://localhost:4444');
 assert(!gatewayConfigured({...env,WA_AKG_API_KEY:''}));
 assert.throws(()=>gatewayBase({...env,WA_AKG_BASE_URL:'http://example.org'}),/HTTPS/);
 assert.throws(()=>gatewayBase({...env,WA_AKG_BASE_URL:'https://x:y@example.org'}),/inválido/);
});
test('tenant encrypted JIDs cannot be decrypted or associated across companies',()=>{
 assert(privateJid(jid));
 assert(!privateJid('5515999999999@g.us'));
 const cipher=encryptJid(jid,tenant,channel,env);
 assert(!cipher.includes('55159999'));
 assert.equal(decryptJid(cipher,tenant,channel,env),jid);
 assert.throws(()=>decryptJid(cipher,other,channel,env),/outra empresa/);
 assert.notEqual(jidHash(jid,tenant,env),jidHash(jid,other,env));
});
test('chat selection excludes groups and status; limits WA-AKG legacy listing',()=>{
 const chats=[{jid:'12345@g.us'},{jid:'status@broadcast'},{jid},{jid},...Array.from({length:85},(_,i)=>({jid:String(600000+i)+'@lid'}))];
 const filtered=selectPrivateChats(chats);
 assert.equal(filtered[0],jid);
 assert(filtered.length<=50);
 assert(!filtered.includes('12345@g.us'));
});
test('a gateway session must be the exact requested session with a verified phone',async()=>{
 const ok=await getSessionStatus('socioSession123',{env,fetchImpl:async()=>fakeResponse({status:true,data:{sessionId:'socioSession123',status:'CONNECTED',me:{id:'5515999999999:1@s.whatsapp.net'}}})});
 assert.equal(ok.connected,true);
 assert.equal(ok.connectedNumber,'5515999999999');
 await assert.rejects(getSessionStatus('socioSession123',{env,fetchImpl:async()=>fakeResponse({status:true,data:{sessionId:'another-session',status:'CONNECTED'}})}),/outra sessão/);
});
test('history import processes text only, excludes media and never sends requests',async()=>{
 const called=[];
 const fetchImpl=async(url,opts)=>{
  called.push({url,method:opts.method,key:opts.headers['x-api-key']});
  if(url.includes('/api/chat/'))return fakeResponse({status:true,data:[{jid},{jid:'12345@g.us'}]});
  return fakeResponse({status:true,data:[
   {remoteJid:jid,fromMe:false,keyId:'a',timestamp:'2026-11-03T12:00:00Z',type:'TEXT',content:'Bom dia, qual o valor?'},
   {remoteJid:jid,fromMe:true,keyId:'b',timestamp:'2026-11-03T12:01:00Z',type:'TEXT',content:'Boa tarde, o valor é 39 reais.'},
   {remoteJid:jid,fromMe:false,keyId:'c',timestamp:'2026-11-03T12:02:00Z',type:'TEXT',content:'Pode fechar o pedido?'},
   {remoteJid:jid,fromMe:true,keyId:'d',timestamp:'2026-11-03T12:03:00Z',type:'IMAGE',content:'image bytes not for training'},
   {remoteJid:'555555@g.us',fromMe:true,keyId:'e',timestamp:'2026-11-03T12:03:00Z',type:'TEXT',content:'another group'}],
   pagination:{total:5,page:1,limit:100}});
 };
 const chats=await listAvailableChats('socioSession123',{env,fetchImpl});
 assert.deepEqual(chats.jids,[jid]);
 const sample=await loadChatSample('socioSession123',jid,{env,fetchImpl});
 assert(sample.messageCount>=3);
 assert(!sample.markdown.includes('image bytes'));
 assert(!sample.markdown.includes(jid));
 assert.equal(sample.fingerprint.length,64);
 assert(called.every(x=>x.method==='GET'&&x.key==='test-access-only'));
});
test('unauthorized or broken gateway responses fail closed',async()=>{
 const bad=async()=>({ok:false,status:401,text:async()=>''});
 await assert.rejects(getSessionStatus('socioSession123',{env,fetchImpl:bad}),/indisponível/);
 assert.deepEqual(normalizeHistoryMessages([{remoteJid:jid,content:'foto privada',type:'IMAGE',timestamp:'2026-11-03',fromMe:false}],jid),[]);
});
