import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {selectRecentOwnerMedia,downloadOwnerMedia,transcribeOwnerAudio,processOwnerSkillMedia}
 from '../socio-owner-skill-media.mjs';

const now=Date.parse('2026-11-06T21:00:00Z');
const pilotTenant='11111111-1111-4111-8111-111111111111';
const jid='5515991234567@s.whatsapp.net';
const media=(type='IMAGE',id='key-image-a',extra={})=>({
 remoteJid:jid,fromMe:false,keyId:id,type,timestamp:new Date(now-30000).toISOString(),...extra
});
const actorRow=()=>({
 conversation_id:randomUUID(),tenant_id:pilotTenant,channel_id:randomUUID(),customer_phone:'5515991234567',
 session_id:'socio_test_001',connected_phone:'5515888123456',user_id:randomUUID(),role:'owner',
 platform_owner:false,tenant_status:'active',features:{meta_ads:true,ai:true,whatsapp:true},tenant_name:'Loja Segura'
});
const env={SOCIO_OWNER_COMMANDS_ENABLED:'true',SOCIO_OWNER_MEDIA_ENABLED:'true',SOCIO_OWNER_AUDIO_ENABLED:'true',
 SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'gateway-key-for-tests-not-real',WA_AKG_BASE_URL:'https://wa.test',
 GROQ_API_KEY:'groq-key-for-tests-not-real-123456',
 CHANNEL_ENCRYPTION_KEY:'owner-media-bridge-unit-test-key-long-32-char',
 SOCIO_OWNER_MEDIA_TENANT_ID:pilotTenant};
function poolFor(row,{pending=true,claimed=true}={}){
 const calls=[];return {calls,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT c.id AS conversation_id')){
   assert.match(sql,/u\.role IN \('owner','admin'\)/);
   assert.match(sql,/regexp_replace\(u\.phone/);
   assert.match(sql,/verified_owner\.tenant_id=c\.tenant_id/);
   assert.match(sql,/count\(\*\) FROM users verified_owner/);
   assert.match(sql,/ch\.provider='waakg'/);
   assert.match(sql,/ch\.status='connected'/);
   assert.match(sql,/c\.tenant_id=\$1/);
   assert.equal(args[0],pilotTenant);
   return {rowCount:1,rows:[row]};
  }
  if(sql.startsWith('SELECT id,brief FROM socio_skill_runs'))return pending?{
   rowCount:1,rows:[{id:'8c6249cc-7e81-4920-8924-4723401ec9b9',brief:{category:'moda feminina'}}]
  }:{rowCount:0,rows:[]};
  if(sql.startsWith('SELECT provider_message_id FROM socio_owner_media_receipts'))
   return {rowCount:1,rows:[]};
  if(sql.startsWith('INSERT INTO socio_owner_media_receipts'))
   return {rowCount:claimed?1:0,rows:claimed?[{id:args[0]}]:[]};
  if(sql.startsWith('UPDATE socio_owner_media_receipts'))return{rowCount:1,rows:[]};
  throw Error('Unexpected SQL '+sql.slice(0,100));
 }};
}
test('media selection rejects outgoing, stale, spoofed, group, duplicate and unverified types',()=>{
 const junk=[media('IMAGE','sent',{fromMe:true}),media('IMAGE','old',{timestamp:new Date(now-400000).toISOString()}),
  media('IMAGE','other',{remoteJid:'5511111111111@s.whatsapp.net'}),
  media('IMAGE','dup'),media('VIDEO','video'),media('AUDIO','voice')];
 const seen=new Set(['dup']);
 assert.equal(selectRecentOwnerMedia(junk,jid,{now,seen,audioEnabled:false}),null);
 const audio=selectRecentOwnerMedia(junk,jid,{now,seen,audioEnabled:true});
 assert.equal(audio.kind,'audio');assert.equal(audio.id,'voice');
 assert.equal(selectRecentOwnerMedia([media()], '123456789@g.us',{now}),null);
 const good=selectRecentOwnerMedia([media()],jid,{now});
 assert.equal(good.id,'key-image-a');assert.equal(good.kind,'image');
});
test('binary downloads require signed-in private gateway, strict MIME, valid signature and size',async()=>{
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(100)]);
 const good=await downloadOwnerMedia({sessionId:'sociosession1',messageId:'abcd1234',kind:'image',env,
  fetchImpl:async(url,opts)=>{
   assert.match(url,/\/download\/abcd1234\/media$/);
   assert.equal(opts.redirect,'manual');
   assert.equal(opts.headers['x-api-key'],env.WA_AKG_API_KEY);
   return new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}});
  }});
 assert.equal(good.bytes.length,png.length);
 await assert.rejects(downloadOwnerMedia({sessionId:'sociosession1',messageId:'abcd1234',kind:'image',env,
  fetchImpl:async()=>new Response(Buffer.from('not a png'),{headers:{'content-type':'image/png'}})}),{status:422});
 await assert.rejects(downloadOwnerMedia({sessionId:'sociosession1',messageId:'abcd1234',kind:'image',env,
  fetchImpl:async()=>new Response('not media',{headers:{'content-type':'application/json'}})}),{status:422});
 await assert.rejects(downloadOwnerMedia({sessionId:'sociosession1',messageId:'abcd1234',kind:'image',env,
  fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}})}),{status:503});
 await assert.rejects(downloadOwnerMedia({sessionId:'../../attack',messageId:'abc',kind:'image',env}),{status:422});
});
test('Groq Whisper transcribes only when opted in and never receives authorization in metadata',async()=>{
 const audio=Buffer.concat([Buffer.from('OggS'),Buffer.alloc(100)]);
 await assert.rejects(transcribeOwnerAudio({bytes:audio,mime:'audio/ogg',
  env:{...env,SOCIO_OWNER_AUDIO_ENABLED:'false'}}),{status:503});
 const answer=await transcribeOwnerAudio({bytes:audio,mime:'audio/ogg',env,fetchImpl:async(url,opts)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(opts.method,'POST');assert.match(opts.headers.Authorization,/^Bearer /);
  assert.equal(opts.body.get('model'),'whisper-large-v3-turbo');
  assert.equal(opts.body.get('language'),'pt');
  return Response.json({text:'Sócio, faça uma campanha para a loja'});
 }});
 assert.equal(answer,'Sócio, faça uma campanha para a loja');
});
test('worker is OFF unless both owner commands and owner media are opted-in',async()=>{
 let queries=0;const pool={query:async()=>{queries++;throw Error('No query allowed')}};
 for(const changes of [{SOCIO_OWNER_MEDIA_ENABLED:'false'},{SOCIO_OWNER_COMMANDS_ENABLED:'false'}]){
  const result=await processOwnerSkillMedia(pool,{env:{...env,...changes},now});
  assert.equal(result.reason,'OWNER_MEDIA_DISABLED');
 }
 assert.equal(queries,0);
});
test('media worker cannot scan all tenant inboxes when tenant opt-in is missing',async()=>{
 let calls=0;
 const res=await processOwnerSkillMedia({query:async()=>{calls++;throw Error('Forbidden database read')}},{
  env:{...env,SOCIO_OWNER_MEDIA_TENANT_ID:''},now});
 assert.equal(res.reason,'OWNER_MEDIA_TENANT_NOT_ALLOWED');
 assert.equal(calls,0);
});
test('verified owner photo joins a collecting campaign, never publishes an ad or sends twice',async()=>{
 const row=actorRow(),pool=poolFor(row),invoked=[];
 const result=await processOwnerSkillMedia(pool,{env,now,
  getStatus:async()=>({connected:true,connectedNumber:'5515888123456'}),
  read:async(path)=>{assert.match(path,/\/search\?/);return {data:[media()]};},
  download:async()=>({bytes:Buffer.from('picture'),mime:'image/jpeg'}),
  upload:async(_pool,a,payload)=>{invoked.push('upload');assert.equal(a.active_tenant_id,row.tenant_id);
   assert.equal(payload,Buffer.from('picture').toString('base64'));return {hash:'image-test-hash'};},
  speak:async(_pool,a,cmd,opts)=>{invoked.push('speak');assert.equal(cmd.runId,'8c6249cc-7e81-4920-8924-4723401ec9b9');
   assert.equal(cmd.imageHash,'image-test-hash');assert.equal(cmd.message,'');
   assert.equal(opts.originConversationId,row.conversation_id);
   return{status:'ready',runId:cmd.runId,message:'Campanha pronta, aguardando pode criar'};},
  deliver:async(_pool,payload)=>{invoked.push('deliver');assert.equal(payload.tenantId,row.tenant_id);
   assert.equal(payload.userId,row.user_id);assert.match(payload.text,/aguardando/);return {sent:true};}
 });
 assert.equal(result.processed,true);assert.equal(result.kind,'image');assert.equal(result.replySent,true);
 assert.deepEqual(invoked,['upload','speak','deliver']);
 assert(pool.calls.some(c=>c.sql.includes("ON CONFLICT(tenant_id,channel_id,provider_message_id) DO NOTHING")));
 assert.equal(pool.calls.find(c=>c.sql.startsWith('INSERT INTO socio_owner_media_receipts')).args[5],'key-image-a');
});
test('voice requests can be transcribed into plans but spoken approval never executes',async()=>{
 const row=actorRow();
 async function run(transcript){
  const pool=poolFor(row,{pending:false}),invoked=[];
  const result=await processOwnerSkillMedia(pool,{env,now,
   getStatus:async()=>({connected:true,connectedNumber:'5515888123456'}),
   read:async()=>({data:[media('AUDIO','recording001')]}),
   download:async()=>({bytes:Buffer.from('audio'),mime:'audio/ogg'}),
   transcribe:async()=>transcript,
   speak:async(_pool,a,data,opts)=>{invoked.push('speak');assert.equal(opts.originConversationId,row.conversation_id);
    assert.equal(data.message,'quero anunciar roupas femininas em Sorocaba');assert.equal(data.runId,null);
    return {status:'collecting',runId:randomUUID(),message:'Me envie uma foto'};},
   deliver:async()=>{invoked.push('deliver');return{sent:true};}
  });return {result,invoked,pool};
 }
 const started=await run('Sócio, quero anunciar roupas femininas em Sorocaba');
 assert.equal(started.result.processed,true);
 assert.deepEqual(started.invoked,['speak','deliver']);
 const refused=await run('Sócio, pode criar');
 assert.deepEqual(refused.invoked,['deliver']);
 const confirms=await run('Sócio, confirma');
 assert.deepEqual(confirms.invoked,['deliver']);
 assert.equal(refused.result.processed,true);
});
test('media workers refuse disconnected or mismatched gateway sessions and never download',async()=>{
 const row=actorRow(),pool=poolFor(row);let read=0;
 const result=await processOwnerSkillMedia(pool,{env,now,
  getStatus:async()=>({connected:true,connectedNumber:'5511111111111'}),
  read:async()=>{read++;return{data:[media()]};}});
 assert.equal(result.reason,'SESSION_NOT_VERIFIED');assert.equal(read,0);
});
test('gateway ambiguity after a processed image is never retried',async()=>{
 const row=actorRow(),pool=poolFor(row);let uploads=0;
 const result=await processOwnerSkillMedia(pool,{env,now,
  getStatus:async()=>({connected:true,connectedNumber:'5515888123456'}),
  read:async()=>({data:[media()]}),download:async()=>({bytes:Buffer.from('abc'),mime:'image/jpeg'}),
  upload:async()=>{uploads++;return{hash:'hash-of-image'};},
  speak:async()=>({status:'ready',message:'Aguardando aprovação',runId:randomUUID()}),
  deliver:async()=>{throw Error('gateway timeout')}
 });
 assert.equal(result.reason,'DELIVERY_UNCONFIRMED');assert.equal(uploads,1);
 assert(pool.calls.some(x=>x.sql.includes("status='uncertain'")));
});
test('server worker fails closed and keeps WA-AKG as the unchanged provider',()=>{
 const s=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(s,/SOCIO_OWNER_MEDIA_ENABLED!=='true'/);
 assert.match(s,/SOCIO_OWNER_COMMANDS_ENABLED!=='true'/);
 assert.match(s,/processOwnerSkillMedia\(pool\)/);
 const source=readFileSync(new URL('../socio-owner-skill-media.mjs',import.meta.url),'utf8');
 assert.match(source,/mode:'human'/);
 assert.match(source,/SOCIO_OWNER_AUDIO_ENABLED/);
 assert.doesNotMatch(source,/whatsapp.*cloud.*api/i);
});
