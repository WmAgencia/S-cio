import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {checkMetaVideoFile,postMetaAdVideo} from '../meta-ads-tools.mjs';
import {brazilWhatsappDestination,latestOutgoingVideo,listTenantVideoChannels,
 verifiedSourceSession,findLastOutgoingVideo,downloadVerifiedWhatsAppVideo,
 importLastOutgoingVideo} from '../socio-whatsapp-meta-video.mjs';

const tenant=randomUUID(),user=randomUUID(),channel=randomUUID();
const account='act_1347914770832022',recipient='5515981817336',phone='5515981732994',session='socio_test_a17';
const now=Date.parse('2026-11-09T19:40:00Z');
const stamp=new Date(now-30000).toISOString();
const env={WA_AKG_BASE_URL:'https://wa.example.test',WA_AKG_API_KEY:'private-placeholder',
 CHANNEL_ENCRYPTION_KEY:'a-secure-placeholder-phrase-of-at-least-32-chars',
 SOCIO_PUBLIC_URL:'https://socio.example.test',SOCIO_META_GRAPH_VERSION:'v26.0',
 SOCIO_META_APP_ID:'123456789012345',SOCIO_META_APP_SECRET:'test-secret-value'};
const a={active_tenant_id:tenant,user_id:user,role:'owner',platform_owner:false,
 tenant_status:'active',features:{whatsapp:true,meta_ads:true,ai:true}};
const mp4=Buffer.concat([Buffer.from('000000186674797069736f6d00000200','hex'),Buffer.alloc(200)]);
const row={channel_id:channel,connected_phone:phone,session_id:session};
const message=(changes={})=>({remoteJid:recipient+'@s.whatsapp.net',fromMe:true,
 type:'VIDEO',keyId:'3EB048D82AE3F9417E9BB4',timestamp:stamp,...changes});
const live=async(id,opts)=>{assert.equal(id,session);assert.equal(opts.env,env);
 return {connected:true,connectedNumber:phone}};
function db({already=false}={}){
 const calls=[];let status='uploading';
 return {calls,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT ch.id,ch.label,ch.phone'))return {rowCount:1,rows:[{id:channel,label:'Teste',phone}]};
  if(sql.startsWith('SELECT ch.id AS channel_id')){
   assert.equal(args[0],tenant);assert.equal(args[1],channel);
   return {rowCount:1,rows:[row]};
  }
  if(sql.startsWith('INSERT INTO socio_whatsapp_meta_video_imports')){
   assert.equal(args[1],tenant);
   assert.equal(args[2],channel);
   assert.equal(args[3],user);
   assert.equal(args[4],account);
   assert.equal(args[5],message().keyId);
   assert.match(args[6],/^[a-f0-9]{64}$/);
   return {rowCount:already?0:1,rows:already?[]:[{id:args[0]}]};
  }
  if(sql.startsWith('SELECT status,meta_video_id FROM socio_whatsapp_meta_video_imports'))
   return {rowCount:1,rows:[{status:'uploaded',meta_video_id:'1616096903323428'}]};
  if(sql.startsWith('UPDATE socio_whatsapp_meta_video_imports')){
   status=sql.includes("status='uploaded'")?'uploaded':args[1];return {rowCount:1};
  }
  throw Error('Unexpected SQL '+sql.slice(0,100));
 },getStatus:()=>status};
}
test('Brazilian destination is a chat filter, never an owner role',()=>{
 assert.equal(brazilWhatsappDestination('15 98181-7336'),recipient);
 assert.equal(brazilWhatsappDestination('+55 15 98181-7336'),recipient);
 assert.throws(()=>brazilWhatsappDestination('15336'),{status:422});
 assert.throws(()=>brazilWhatsappDestination('447700900123'),{status:422});
});
test('Video selection finds the newest OUTGOING video only in exact private chat',()=>{
 const rows=[message({keyId:'old001',timestamp:new Date(now-100000).toISOString()}),
  message({keyId:'new002'}),message({keyId:'incoming',fromMe:false}),
  message({keyId:'otherchat',remoteJid:'5515999999999@s.whatsapp.net'}),
  message({keyId:'group',remoteJid:'123@g.us'}),
  message({keyId:'photo',type:'IMAGE'}),
  message({keyId:'stale',timestamp:new Date(now-40*86400000).toISOString()}),
  message({keyId:'future',timestamp:new Date(now+900000).toISOString()})];
 assert.equal(latestOutgoingVideo(rows,recipient+'@s.whatsapp.net',{now}).messageId,'new002');
 assert.equal(latestOutgoingVideo([message({fromMe:false})],recipient+'@s.whatsapp.net',{now}),null);
 assert.equal(latestOutgoingVideo(rows,recipient+'@g.us',{now}),null);
 assert.equal(latestOutgoingVideo('not list',recipient+'@s.whatsapp.net',{now}),null);
});
test('Listing channels and checking current gateway are tenant-bound and owner-only',async()=>{
 const db1=db();
 const channels=await listTenantVideoChannels(db1,a);
 assert.equal(channels.channels.length,1);
 assert.equal(channels.channels[0].id,channel);
 const s=await verifiedSourceSession(db1,a,channel,{env,getStatus:live});
 assert.equal(s.session_id,session);
 assert(db1.calls.every(x=>x.args[0]===tenant));
 await assert.rejects(verifiedSourceSession(db1,{...a,role:'viewer'},channel,{env,getStatus:live}),{status:403});
 await assert.rejects(verifiedSourceSession(db1,a,channel,{env,getStatus:async()=>({connected:true,connectedNumber:'5515999999999'})}),{status:409});
 const missing={query:async()=>({rowCount:0,rows:[]})};
 await assert.rejects(verifiedSourceSession(missing,a,channel,{env,getStatus:live}),{status:409});
});
test('Video preview asks gateway for only outbound VIDEO to the provided recipient',async()=>{
 const r=await findLastOutgoingVideo(db(),a,{channelId:channel,recipientPhone:'15 98181-7336'},
  {env,getStatus:live,now,read:async(path,options)=>{
   const url=new URL(path,'https://wa.example.test');
   assert.match(path,/\/api\/messages\/socio_test_a17\/search/);
   assert.equal(url.searchParams.get('jid'),recipient+'@s.whatsapp.net');
   assert.equal(url.searchParams.get('type'),null);
   assert.equal(url.searchParams.get('fromMe'),null);
   assert.equal(url.searchParams.get('limit'),'100');
   assert.equal(options.env,env);
   return {data:[message(),message({fromMe:false,keyId:'not-owned'})]};
  }});
 assert.equal(r.video.messageId,message().keyId);
 assert.equal(r.video.fromMe,true);
 assert.equal(r.recipientPhone,recipient);
});
test('Video download stays on trusted WA-AKG and validates MP4 signature, content and size',async()=>{
 const read=async(_url,opts)=>{
  assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers['x-api-key'],env.WA_AKG_API_KEY);
  return new Response(mp4,{headers:{'content-type':'video/mp4','content-length':String(mp4.length)}});
 };
 const got=await downloadVerifiedWhatsAppVideo({sessionId:session,
  messageId:message().keyId,env,fetchImpl:read});
 assert.deepEqual(got.bytes,mp4);
 assert.equal(got.mime,'video/mp4');
 const result=await downloadVerifiedWhatsAppVideo({sessionId:session,
  messageId:message().keyId,env,fetchImpl:async(url,opts)=>{
   if(url.endsWith('/media')&&url.includes('/download/'))
    return new Response(null,{status:302,headers:{location:'/api/media/abc.mp4'}});
   assert.equal(url,'https://wa.example.test/api/media/abc.mp4');
   assert.equal(opts.headers['x-api-key'],env.WA_AKG_API_KEY);
   return read(url,opts);
  }});
 assert.deepEqual(result.bytes,mp4);
 await assert.rejects(downloadVerifiedWhatsAppVideo({sessionId:session,messageId:message().keyId,env,
  fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.test/asset.mp4'}})}),{status:503});
 await assert.rejects(downloadVerifiedWhatsAppVideo({sessionId:session,messageId:message().keyId,env,
  fetchImpl:async()=>new Response(Buffer.alloc(100),{headers:{'content-type':'video/mp4'}})}),{status:422});
 await assert.rejects(downloadVerifiedWhatsAppVideo({sessionId:session,messageId:message().keyId,env,
  fetchImpl:async()=>new Response(mp4,{headers:{'content-type':'video/mp4','content-length':String(65*1024*1024)}})}),{status:413});
});
test('Meta ad video upload is library-only multipart and uses authenticated selected ad account',async()=>{
 assert.equal(checkMetaVideoFile(mp4,'video/mp4').mime,'video/mp4');
 assert.throws(()=>checkMetaVideoFile(Buffer.alloc(50),'video/mp4'),{status:422});
 assert.throws(()=>checkMetaVideoFile(mp4,'text/html'),{status:422});
 let posted=0;
 const ok=await postMetaAdVideo({accountId:account,token:'test-token',env,
  video:{bytes:mp4,mime:'video/mp4'},title:'Video de teste',
  request:async(url,opts)=>{
   posted++;
   assert.equal(url.pathname,'/v26.0/'+account+'/advideos');
   assert.equal(opts.method,'POST');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.headers.Authorization,'Bearer test-token');
   assert.equal(opts.body.get('title'),'Video de teste');
   assert.equal(opts.body.get('source').type,'video/mp4');
   assert.equal(opts.body.get('source').size,mp4.length);
   assert(opts.body.get('appsecret_proof'));
   return Response.json({id:'1824013938791734'});
  }});
 assert.equal(posted,1);
 assert.equal(ok.videoId,'1824013938791734');
 assert.equal(ok.processing,true);
 assert.equal(ok.accountId,account);
 await assert.rejects(postMetaAdVideo({accountId:account,token:'test-token',env,
  video:{bytes:mp4,mime:'video/mp4'},
  request:async()=>{throw Error('Network timeout')}}),{uncertain:true});
 await assert.rejects(postMetaAdVideo({accountId:account,token:'test-token',env,
  video:{bytes:mp4,mime:'video/mp4'},
  request:async()=>Response.json({error:{message:'Invalid'}},{status:400})}),{status:422});
});
test('Import uploads exactly one verified video and stores Meta video ID, not an ad',async()=>{
 let uploads=0;
 const mock=db();
 const input={channelId:channel,recipientPhone:'15981817336',messageId:message().keyId,confirmed:true};
 const result=await importLastOutgoingVideo(mock,a,input,{
  env,now,getStatus:live,
  read:async()=>({data:[message()]}),
  resolve:async()=>({id:account}),
  download:async(info)=>{
   assert.equal(info.sessionId,session);assert.equal(info.messageId,message().keyId);
   return {bytes:mp4,mime:'video/mp4'};
  },
  upload:async(_pool,actor,video,opts)=>{
   uploads++;assert.equal(actor.active_tenant_id,tenant);
   assert.deepEqual(video.bytes,mp4);assert.equal(opts.env,env);
   return {accountId:account,videoId:'1824013938791734'};
  }
 });
 assert.equal(result.status,'uploaded');assert.equal(result.videoId,'1824013938791734');
 assert.equal(result.uploadedBytes,mp4.length);
 assert.equal(mock.getStatus(),'uploaded');
 assert.equal(uploads,1);
 assert(mock.calls.some(x=>/ON CONFLICT \(tenant_id,channel_id,account_id,provider_message_id\) DO NOTHING/.test(x.sql)));
 assert(!mock.calls.some(x=>/campaigns|adsets|\/ads(?:\/|$)/i.test(x.sql)));
});
test('Duplicate WhatsApp video import does NOT perform another Meta POST',async()=>{
 const mock=db({already:true}),data={channelId:channel,recipientPhone:recipient,
  messageId:message().keyId,confirmed:true};
 let downloads=0,uploads=0;
 const r=await importLastOutgoingVideo(mock,a,data,{
  env,now,getStatus:live,read:async()=>({data:[message()]}),
  resolve:async()=>({id:account}),download:async()=>{downloads++},
  upload:async()=>{uploads++}
 });
 assert.equal(r.replayed,true);assert.equal(r.videoId,'1616096903323428');
 assert.equal(downloads,0);assert.equal(uploads,0);
});
test('No claim, no confirmation, altered selection or no owner means no Meta upload',async()=>{
 const data={channelId:channel,recipientPhone:recipient,
  messageId:message().keyId,confirmed:true};
 let uploadCalls=0,claims=0;
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT ch.id AS channel_id'))return {rowCount:1,rows:[row]};
  if(sql.startsWith('INSERT'))claims++;
  return {rowCount:0,rows:[]};
 }};
 const opts={env,now,getStatus:live,read:async()=>({data:[message({fromMe:false})]}),
  resolve:async()=>({id:account}),upload:async()=>{uploadCalls++}};
 await assert.rejects(importLastOutgoingVideo(pool,a,data,opts),{status:409});
 await assert.rejects(importLastOutgoingVideo(pool,a,{...data,confirmed:false},opts),{status:422});
 await assert.rejects(importLastOutgoingVideo(pool,{...a,role:'viewer'},data,opts),{status:403});
 assert.equal(uploadCalls,0);assert.equal(claims,0);
});
test('Meta ambiguous upload is recorded uncertain and never repeated',async()=>{
 const mock=db(),data={channelId:channel,recipientPhone:recipient,
  messageId:message().keyId,confirmed:true};
 let uploads=0;
 await assert.rejects(importLastOutgoingVideo(mock,a,data,{
  env,now,getStatus:live,read:async()=>({data:[message()]}),
  resolve:async()=>({id:account}),download:async()=>({bytes:mp4,mime:'video/mp4'}),
  upload:async()=>{uploads++;throw Object.assign(Error('no reply'),{uncertain:true});}
 }),{status:503});
 assert.equal(mock.getStatus(),'uncertain');assert.equal(uploads,1);
});
test('UI exposes explicit preview/confirm and does not give owner role to destination',()=>{
 const ui=readFileSync(new URL('../public/socio-ad-skills-ui.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const source=readFileSync(new URL('../socio-whatsapp-meta-video.mjs',import.meta.url),'utf8');
 assert.match(ui,/whatsapp-video\/channels/);
 assert.match(ui,/whatsapp-video\/last/);
 assert.match(ui,/whatsapp-video\/import/);
 assert.match(ui,/selectedVideo=null/);
 assert.match(ui,/videoConfirm\.disabled=true/);
 assert.match(server,/marketing\.official\.video\.imported/);
 assert.doesNotMatch(source,/UPDATE users SET role/);
 assert.doesNotMatch(source,/campaigns\/|adsets\/|\/adcreatives/);
});
