import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {latestIncomingVideo,recentAdInstruction,findLastOutgoingVideo,importLastOutgoingVideo} from '../socio-whatsapp-meta-video.mjs';
const tid=randomUUID(),uid=randomUUID(),channelId=randomUUID(),source='5515981732994',phone='5515981817336';
const jid=phone+'@s.whatsapp.net',sessionId='socio_private_test_001';
const now=Date.parse('2026-11-09T20:45:00Z');
const videoTime=new Date(now-30000).toISOString();
const video={remoteJid:jid,fromMe:false,type:'VIDEO',keyId:'AA112233BB445566',timestamp:videoTime};
const command={remoteJid:jid,fromMe:false,type:'TEXT',content:'Crie um anúncio para WhatsApp, em Sorocaba, gastando 6 reais por dia, com esse vídeo',timestamp:new Date(now-20000).toISOString()};
const actor={active_tenant_id:tid,user_id:uid,role:'owner',platform_owner:false,tenant_status:'active',
 features:{meta_ads:true,whatsapp:true,ai:true}};
const env={WA_AKG_BASE_URL:'https://wa.test',WA_AKG_API_KEY:'test'};
const status=async()=>({connected:true,connectedNumber:source});
function db({ownerCount=1}={}){
 const calls=[];
 return {calls,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT id FROM users WHERE tenant_id=')){
   assert.deepEqual(args,[tid,phone]);
   assert.match(sql,/role IN \('owner','admin'\)/);
   return {rows:Array.from({length:ownerCount},()=>({id:uid}))};
  }
  if(sql.startsWith('SELECT ch.id AS channel_id')){
   assert.equal(args[0],tid);assert.equal(args[1],channelId);
   return {rowCount:1,rows:[{channel_id:channelId,connected_phone:source,session_id:sessionId}]};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,90));
 }};
}
const search=async(path)=>{
 const url=new URL(path,'https://wa.test');
 assert.equal(url.searchParams.get('jid'),jid);
 assert.equal(url.searchParams.get('type'),null);
 assert.equal(url.searchParams.get('fromMe'),null);
 return {data:[video,{...video,fromMe:true,keyId:'FAKEVIDEO'},command,
  {...command,content:'promoção de outra conta',
   remoteJid:'5515999999999@s.whatsapp.net'}]};
};
test('incoming selection rejects outgoing and unrelated chats, and finds exact recent owner video',()=>{
 assert.equal(latestIncomingVideo([video,{...video,fromMe:true}],jid,{now}).messageId,video.keyId);
 assert.equal(latestIncomingVideo([{...video,fromMe:true}],jid,{now}),null);
 assert.equal(latestIncomingVideo([{...video,remoteJid:'5515999999999@s.whatsapp.net'}],jid,{now}),null);
 assert.equal(latestIncomingVideo([{...video,timestamp:new Date(now-31*86400000).toISOString()}],jid,{now}),null);
 assert.equal(latestIncomingVideo([{...video,remoteJid:'12345678@g.us'}],jid,{now}),null);
});
test('extract campaign instruction from same owner chat and within 10 min of selected video',()=>{
 const chosen=latestIncomingVideo([video],jid,{now});
 assert.equal(recentAdInstruction([command,video],jid,'incoming',chosen,{now}),command.content);
 assert.equal(recentAdInstruction([{...command,remoteJid:'5515999999999@s.whatsapp.net'}],
  jid,'incoming',chosen,{now}),null);
 assert.equal(recentAdInstruction([{...command,fromMe:true}],jid,'incoming',chosen,{now}),null);
 assert.equal(recentAdInstruction([{...command,timestamp:new Date(now-900000).toISOString()}],
  jid,'incoming',chosen,{now}),null);
});
test('incoming preview requires unique current owner and same verified WA-AKG channel before even reading history',async()=>{
 const pool=db();
 const found=await findLastOutgoingVideo(pool,actor,{channelId,recipientPhone:'15981817336',direction:'incoming'},
  {env,getStatus:status,read:search,now});
 assert.equal(found.video.messageId,video.keyId);
 assert.equal(found.video.fromMe,false);
 assert.equal(found.instruction,command.content);
 assert.equal(found.direction,'incoming');
 assert.equal(found.recipientPhone,phone);
 assert.equal(pool.calls.length,2);
 for(const count of [0,2]){
  let reads=0;
  await assert.rejects(findLastOutgoingVideo(db({ownerCount:count}),actor,
   {channelId,recipientPhone:phone,direction:'incoming'},
   {env,getStatus:status,read:async()=>{reads++}}),{status:403});
  assert.equal(reads,0);
 }
});
test('a viewer, unknown direction or mismatched session never accesses owner video',async()=>{
 await assert.rejects(findLastOutgoingVideo(db(),{...actor,role:'viewer'},
  {channelId,recipientPhone:phone,direction:'incoming'},
  {env,getStatus:status,read:search}),{status:403});
 await assert.rejects(findLastOutgoingVideo(db(),actor,
  {channelId,recipientPhone:phone,direction:'other'},
  {env,getStatus:status,read:search}),{status:422});
 let scans=0;
 await assert.rejects(findLastOutgoingVideo(db(),actor,
  {channelId,recipientPhone:phone,direction:'incoming'},
  {env,getStatus:async()=>({connected:true,connectedNumber:'5515999999999'}),
   read:async()=>{scans++}}),{status:409});
 assert.equal(scans,0);
});
test('incoming import refuses mismatched messageId before download or Meta POST',async()=>{
 const pool=db();let download=0,upload=0;
 await assert.rejects(importLastOutgoingVideo(pool,actor,{channelId,recipientPhone:phone,direction:'incoming',
  messageId:'different-video',confirmed:true},{env,getStatus:status,read:search,now,
  download:async()=>{download++},upload:async()=>{upload++}}),{status:409});
 assert.equal(download,0);assert.equal(upload,0);
 assert.equal(pool.calls.filter(x=>x.sql.startsWith('INSERT')).length,0);
});
test('app UI and API offer received-owner direction but never self-assign owner',()=>{
 const ui=readFileSync(new URL('../public/socio-ad-skills-ui.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const tool=readFileSync(new URL('../socio-whatsapp-meta-video.mjs',import.meta.url),'utf8');
 assert.match(ui,/Vídeo recebido de proprietário autorizado/);
 assert.match(ui,/Preparar campanha de WhatsApp com este vídeo/);
 assert.match(ui,/selectedInstruction/);
 assert.match(ui,/linkedVideoId/);
 assert.match(server,/videoId:data.videoId/);
 assert.match(server,/direction:data.direction/);
 assert.match(server,/direction:qs.get\('direction'\)/);
 assert.doesNotMatch(tool,/UPDATE users SET role/);
});
