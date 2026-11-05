import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {Client,Pool} from 'pg';
import {hashPassword,verifyPassword} from '../lib.mjs';
import {assertApiFeature} from '../tenant-features.mjs';
import {encodeHistoryCursor,decodeHistoryCursor} from '../inbox-cursor.mjs';
import {handleInboxApi} from '../inbox-api.mjs';
import {processLiveInboxSync} from '../inbox-live-sync.mjs';
import {createQuote,issueQuote,approveQuote,publicQuote} from '../sales-commerce.mjs';
import {deliverToConversation,reconcileConfirmedOutbox} from '../socio-outbound.mjs';
import {processNextAiReply} from '../ai-replies.mjs';
import {processNextAnalysisJob,createTrainingAnalysis} from '../analysis-jobs.mjs';
import {scanQuoteRequests} from '../quote-requests.mjs';
import {scanSalesIntents} from '../sales-intents.mjs';
import {finishPipeboardOAuth} from '../marketing-oauth.mjs';

test('disabled WhatsApp blocks legacy and current conversation routes',()=>{
 for(const path of ['/api/conversations/123/history','/api/conversations/123/send',
  '/api/conversations/123/note','/api/conversations/123/ui','/api/conversations/123'])
  assert.throws(()=>assertApiFeature({whatsapp:false},path),{status:403});
});
test('disabled AI blocks simulation, Groq probes and every import route',()=>{
 for(const path of ['/api/simulate','/api/ops/groq/test','/api/imports','/api/imports/zip'])
  assert.throws(()=>assertApiFeature({ai:false},path),{status:403});
 assert.throws(()=>assertApiFeature({whatsapp:false},'/api/instagram/oauth/start'),{status:403});
});
test('history cursors retain microseconds, break timestamp ties and reject malformed input',()=>{
 const message={id:randomUUID(),cursor_created_at:'2026-11-04 12:00:00.123456+00'};
 assert.deepEqual(decodeHistoryCursor(encodeHistoryCursor(message)),{time:message.cursor_created_at,id:message.id});
 assert.deepEqual(decodeHistoryCursor('2026-11-04T12:00:00.000Z'),{time:'2026-11-04T12:00:00.000Z',id:null});
 for(const bad of ['junk','x'.repeat(241),'2026-02-31T12:00:00Z',Buffer.from('["now","bad"]').toString('base64url'),
  Buffer.from(JSON.stringify(['2026-02-31 12:00:00.123456+00',randomUUID()])).toString('base64url')])
  assert.throws(()=>decodeHistoryCursor(bad),{status:422});
});
test('invalid passwords are bounded and validation errors are actionable',async()=>{
 await assert.rejects(hashPassword('short'),{status:422});
 assert.equal(await verifyPassword('x'.repeat(10000),'scrypt:anything:aa'),false);
});

test('audit regressions against isolated PostgreSQL',
 {skip:!process.env.DATABASE_URL,timeout:90000},async t=>{
 const name='socio_audit_'+randomUUID().replaceAll('-','');
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
 const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 await admin.query('CREATE DATABASE '+name);
 const pool=new Pool({connectionString:url.href});let app;
 t.after(async()=>{
  if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{
   const timer=setTimeout(()=>app.kill('SIGKILL'),2000);
   app.once('exit',()=>{clearTimeout(timer);resolve();});
   app.kill('SIGTERM');
  });
  await pool.end();
  // A forced drop could terminate an idle socket while pg was still completing
  // its close, producing a race-dependent uncaught error in parallel CI runs.
  // Close the app and pool first, then let PostgreSQL verify there are no users.
  try{
   for(let attempt=0;;attempt++){
    try{await admin.query('DROP DATABASE '+name);break;}
    catch(error){if(error.code!=='55006'||attempt>=10)throw error;await new Promise(r=>setTimeout(r,50));}
   }
  }finally{await admin.end();}
 });
 await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 const tenant=randomUUID(),user=randomUUID(),channel=randomUUID(),conversation=randomUUID(),product=randomUUID();
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Audit fixture','audit')",[tenant]);
 await pool.query("INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES($1,$2,'Audit','audit@example.test',$3,'owner')",
  [user,tenant,await hashPassword('AuditPassword123!')]);
 await pool.query("INSERT INTO agents(tenant_id,enabled) VALUES($1,true)",[tenant]);
 await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'Audit','5515999999999','waakg','connected')",[channel,tenant]);
 await pool.query("INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES(gen_random_uuid(),$1,$2,'auditSession001')",[tenant,channel]);
 await pool.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES($1,$2,$3,'5515888888888')",[conversation,tenant,channel]);
 await pool.query("INSERT INTO products(id,tenant_id,name,price_cents,stock_quantity) VALUES($1,$2,'Last unit',1000,1)",[product,tenant]);
 const auth={active_tenant_id:tenant,user_id:user,role:'owner',features:{}};
 const inbox=async(path,method='GET',data={})=>{
  let response;
  await handleInboxApi({pathname:path.split('?')[0],method,req:{url:path},res:{},a:auth,
   query:(...args)=>pool.query(...args),pool,body:async()=>({data}),id:randomUUID,
   audit:async()=>{},json:(_res,status,result)=>{response={status,result};return true;}});
  return response;
 };
 await t.test('history returns every equal-time and microsecond message exactly once',async()=>{
  for(let i=0;i<7;i++)await pool.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES($1,$2,$3,'inbound',$4,$5)",
   [randomUUID(),tenant,conversation,'Message '+i,'2026-11-04 12:00:00.'+(i<5?'123456':'123455')+'+00']);
  const seen=[];let before='';
  for(let page=0;page<5;page++){
   const {result}=await inbox('/api/conversations/'+conversation+'/history?limit=2'+(before?'&before='+before:''));
   seen.push(...result.messages.map(x=>x.id));
   if(!result.hasMore)break;before=result.nextCursor;
  }
  assert.equal(seen.length,7);assert.equal(new Set(seen).size,7);
 });
 await t.test('disabled AI cannot be enabled through conversation preferences',async()=>{
  auth.features={ai:false};
  await assert.rejects(inbox('/api/conversations/'+conversation+'/ui','PATCH',{handling_mode:'ai_assist'}),{status:403});
  auth.features={};
 });
 await t.test('never-read conversations with incoming messages are unread until explicitly read',async()=>{
  assert.equal((await inbox('/api/inbox/v2?filter=unread')).result.conversations.find(c=>c.id===conversation).unread,true);
  await inbox('/api/conversations/'+conversation+'/ui','PATCH',{read:true});
  assert(!(await inbox('/api/inbox/v2?filter=unread')).result.conversations.some(c=>c.id===conversation));
 });
 await t.test('triage rotates past rejected batches instead of starving older requests',async()=>{
  for(let i=0;i<65;i++)await pool.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES($1,$2,$3,'inbound',$4,now()-($5::int*interval '1 second'))",
   [randomUUID(),tenant,conversation,'Não quero comprar e não quero orçamento',i]);
  const quoteMsg=randomUUID(),saleMsg=randomUUID();
  await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES($1,$2,$3,'inbound','Quanto é o valor?',now()-interval '120 seconds'),($4,$2,$3,'inbound','Quero comprar 1 unidade do Last unit',now()-interval '121 seconds')",[quoteMsg,tenant,conversation,saleMsg]);
  for(let i=0;i<3;i++){await scanQuoteRequests(pool);await scanSalesIntents(pool);}
  assert.equal((await pool.query('SELECT id FROM quote_requests WHERE inbound_message_id=$1',[quoteMsg])).rowCount,1);
  assert.equal((await pool.query('SELECT id FROM sale_intents WHERE inbound_message_id=$1',[saleMsg])).rowCount,1);
 });
 await t.test('a disabled marketing module invalidates a pending OAuth callback before provider access',async()=>{
  const state='ab'.repeat(32),stateHash=createHash('sha256').update(state).digest('hex');
  await pool.query("INSERT INTO marketing_oauth_attempts(state_hash,tenant_id,user_id,provider,data_ciphertext,expires_at) VALUES($1,$2,$3,'meta','not-decrypted',now()+interval '10 minutes')",[stateHash,tenant,user]);
  await pool.query("UPDATE tenants SET features=features||'{\"meta_ads\":false}'::jsonb WHERE id=$1",[tenant]);
  await assert.rejects(finishPipeboardOAuth(pool,state,'fixture-valid-code',{env:{},request:()=>{throw Error('Must not access provider');}}),{status:403});
  await pool.query("UPDATE tenants SET features=features||'{\"meta_ads\":true}'::jsonb WHERE id=$1",[tenant]);
 });
 await t.test('concurrent approvals reserve the last unit and expired reservations release it',async()=>{
  const tokens=[];
  for(let i=0;i<3;i++){
   const q=await createQuote(pool,tenant,user,{conversationId:conversation,items:[{productId:product,quantity:1}]});
   tokens.push({id:q.id,token:(await issueQuote(pool,tenant,q.id)).path.split('#')[1]});
  }
  const results=await Promise.allSettled(tokens.slice(0,2).map(q=>approveQuote(pool,q.token,'Buyer',true)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
  assert.equal((await pool.query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,1,
   'Sandbox orders reserve availability without consuming real inventory');
  await pool.query("UPDATE sales_quotes SET expires_at=now()-interval '1 second' WHERE status='accepted'");
  await approveQuote(pool,tokens[2].token,'Another buyer',true);
  await pool.query("UPDATE tenants SET status='paused' WHERE id=$1",[tenant]);
  await assert.rejects(publicQuote(pool,tokens[2].token),{status:404});
  await pool.query("UPDATE tenants SET status='active' WHERE id=$1",[tenant]);
 });
 await t.test('confirmed sends survive history failures and reconcile without resending',async()=>{
  let sends=0,failHistory=true;
  const wrapped={query:async(sql,args)=>{
   if(failHistory&&sql.startsWith('INSERT INTO messages')){failHistory=false;throw Error('fixture projection failure');}
   return pool.query(sql,args);
  }};
  const options={tenantId:tenant,conversationId:conversation,clientRequestId:randomUUID(),text:'Confirmed delivery',
   env:{SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'fixture',WA_AKG_BASE_URL:'http://localhost'},
   getStatus:async()=>({connected:true,connectedNumber:'5515999999999'}),
   send:async()=>{sends++;return {sent:true,providerId:'audit-confirmed-message'};}};
  const result=await deliverToConversation(wrapped,options);
  assert.equal(result.sent,true);assert.equal(result.historyPending,true);
  assert.equal((await deliverToConversation(wrapped,options)).sent,true);
  assert.equal((await reconcileConfirmedOutbox(pool)).reconciled,1);
  assert.equal((await reconcileConfirmedOutbox(pool)).reconciled,0);
  assert.equal(sends,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE body='Confirmed delivery'")).rows[0].n,1);
  await pool.query("UPDATE conversations SET status='resolved' WHERE id=$1",[conversation]);
  await pool.query("UPDATE channels SET status='not_connected' WHERE id=$1",[channel]);
  assert.equal((await deliverToConversation(wrapped,options)).sent,true,'A confirmed receipt remains valid after handoff/disconnection');
  assert.equal(sends,1);
  await pool.query("UPDATE conversations SET status='open' WHERE id=$1",[conversation]);
  await pool.query("UPDATE channels SET status='connected' WHERE id=$1",[channel]);
 });
 await t.test('AI send cancels if a human takes over while gateway status is pending',async()=>{
  await inbox('/api/conversations/'+conversation+'/ui','PATCH',{handling_mode:'ai_assist'});
  const inbound=(await pool.query("SELECT id FROM messages WHERE conversation_id=$1 AND direction='inbound' ORDER BY created_at DESC,id DESC LIMIT 1",[conversation])).rows[0].id;
  let sends=0;
  await assert.rejects(deliverToConversation(pool,{tenantId:tenant,conversationId:conversation,
   clientRequestId:randomUUID(),mode:'ai',replyToId:inbound,text:'Stale AI reply',
   env:{SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',WA_AKG_API_KEY:'fixture',WA_AKG_BASE_URL:'http://localhost',GROQ_API_KEY:'fixture-long-groq-key-12345'},
   getStatus:async()=>{
    await inbox('/api/conversations/'+conversation+'/ui','PATCH',{handling_mode:'human'});
    return {connected:true,connectedNumber:'5515999999999'};
   },send:async()=>{sends++;return {sent:true,providerId:'must-not-send'};}}),{status:409});
  assert.equal(sends,0);
 });
 await t.test('AI send cancels when a newer inbound message arrives during preparation',async()=>{
  await inbox('/api/conversations/'+conversation+'/ui','PATCH',{handling_mode:'ai_assist'});
  const inbound=(await pool.query("SELECT id FROM messages WHERE conversation_id=$1 AND direction='inbound' ORDER BY created_at DESC,id DESC LIMIT 1",[conversation])).rows[0].id;
  await assert.rejects(deliverToConversation(pool,{tenantId:tenant,conversationId:conversation,
   clientRequestId:randomUUID(),mode:'ai',replyToId:inbound,text:'Obsolete answer',
   env:{SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',WA_AKG_API_KEY:'fixture',WA_AKG_BASE_URL:'http://localhost',GROQ_API_KEY:'fixture-long-groq-key-12345'},
   getStatus:async()=>{
    await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'inbound','Newer question')",[randomUUID(),tenant,conversation]);
    return {connected:true,connectedNumber:'5515999999999'};
   },send:async()=>{throw Error('Must not send');}}),{status:409});
  await inbox('/api/conversations/'+conversation+'/ui','PATCH',{handling_mode:'human'});
 });
 await t.test('historical sync uses the message date and skips media-only contacts',async()=>{
  const when=new Date(Date.now()-7*86400000).toISOString(),phone='5515777777777',jid=phone+'@s.whatsapp.net';
  const result=await processLiveInboxSync(pool,{
   getStatus:async()=>({connected:true,connectedNumber:'5515999999999'}),
   listChats:async()=>({jids:[jid,'5515666666666@s.whatsapp.net'],partial:false}),
   read:async url=>({data:[{remoteJid:new URL('http://fixture'+url).searchParams.get('jid'),keyId:randomUUID(),
    content:'Fixture text',timestamp:when,fromMe:false,type:url.includes(phone)?'TEXT':'IMAGE'}]})});
  assert.equal(result.scanned,1);
  const history=await pool.query('SELECT last_message_at FROM conversations WHERE tenant_id=$1 AND customer_phone=$2',[tenant,phone]);
  assert.equal(history.rows[0].last_message_at.toISOString(),when);
  assert.equal((await pool.query("SELECT id FROM conversations WHERE tenant_id=$1 AND customer_phone='5515666666666'",[tenant])).rowCount,0);
 });
 await t.test('live sync visits channels beyond the original 50-channel ceiling',async()=>{
  for(let i=0;i<51;i++){
   const ch=randomUUID();
   await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'Fixture',$3,'waakg','connected')",[ch,tenant,'5515'+String(100000000+i)]);
   await pool.query('INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES(gen_random_uuid(),$1,$2,$3)',[tenant,ch,'fixtureSession'+i]);
  }
  const visited=new Set();
  for(let i=0;i<52;i++)await processLiveInboxSync(pool,{
   getStatus:async session=>{visited.add(session);return {connected:false};}});
  assert.equal(visited.size,52);
 });
 await t.test('a caller rollback removes analysis jobs and items together',async()=>{
  const importId=randomUUID();
  await pool.query("INSERT INTO imports(id,tenant_id,filename,sample_md) VALUES($1,$2,'fixture.txt','- Pessoa 1: Fonte de teste')",[importId,tenant]);
  const client=await pool.connect();let job;
  try{
   await client.query('BEGIN');job=await createTrainingAnalysis(pool,tenant,{client});
   assert.equal((await client.query('SELECT id FROM training_jobs WHERE id=$1',[job.id])).rowCount,1);
   await client.query('ROLLBACK');
   assert.equal((await client.query('SELECT id FROM training_jobs WHERE id=$1',[job.id])).rowCount,0);
   assert.equal((await client.query('SELECT job_id FROM training_job_items WHERE job_id=$1',[job.id])).rowCount,0);
  }finally{client.release();}
 });
 await t.test('paused tenants cannot run analysis or automatic replies',async()=>{
  await pool.query("UPDATE tenants SET status='paused' WHERE id=$1",[tenant]);
  await pool.query("INSERT INTO training_jobs(id,tenant_id) VALUES($1,$2)",[randomUUID(),tenant]);
  assert.equal((await processNextAnalysisJob(pool)).processed,false);
  const result=await processNextAiReply(pool,{env:{SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',
   WA_AKG_API_KEY:'fixture',WA_AKG_BASE_URL:'http://localhost',GROQ_API_KEY:'fixture-groq-key-long-enough'},
   respond:async()=>{throw Error('Must not call AI');}});
  assert.equal(result.processed,false);
  await pool.query("UPDATE tenants SET status='active' WHERE id=$1",[tenant]);
 });
 await t.test('HTTP sessions enforce company pause and disabled modules',async()=>{
  const port=51000+Math.floor(Math.random()*8000);const base='http://127.0.0.1:'+port;
  app=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATABASE_URL:url.href,PORT:String(port),NODE_ENV:'test',
   WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',GROQ_API_KEY:'',SOCIO_LIVE_SYNC_ENABLED:'false',
   SOCIO_OUTBOUND_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',SOCIO_INSTAGRAM_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  let errors='';app.stderr.on('data',data=>{errors+=data;});app.stdout.resume();
  let ready=false;
  for(let i=0;i<100;i++){
   try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
   if(app.exitCode!==null)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,errors);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'audit@example.test',password:'AuditPassword123!'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
  const request=path=>fetch(base+path,{headers:{Cookie:cookie,'X-CSRF-Token':csrf}});
  const auditIds=[];
  for(let i=0;i<5;i++){
   const eventId=randomUUID();auditIds.push(eventId);
   await pool.query("INSERT INTO audit(id,tenant_id,actor_id,action,created_at) VALUES($1,$2,$3,'audit.fixture','2026-11-04 12:00:00.123456+00')",[eventId,tenant,user]);
  }
  const seenEvents=[];let auditCursor='';
  for(let page=0;page<20;page++){
   const batch=await(await request('/api/ops/audit?limit=2'+(auditCursor?'&before='+auditCursor:''))).json();
   seenEvents.push(...batch.events.map(event=>event.id));
   if(!batch.hasMore)break;auditCursor=batch.nextCursor;
  }
  for(const eventId of auditIds)assert.equal(seenEvents.filter(id=>id===eventId).length,1);
  const night=randomUUID();
  await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES($1,$2,$3,'inbound','Midnight fixture',((date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo')-interval '1 day'+interval '23 hours 30 minutes') AT TIME ZONE 'America/Sao_Paulo'))",[night,tenant,conversation]);
  const activity=await(await request('/api/dashboard/activity?range=7d')).json();
  assert.equal((await request('/api/dashboard/activity?range=constructor')).status,400);
  const byDate=await pool.query("SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date,count(*) FILTER(WHERE direction='inbound')::int AS inbound,count(*) FILTER(WHERE direction='outbound')::int AS outbound FROM messages WHERE tenant_id=$1 GROUP BY 1",[tenant]);
  for(const point of activity.points){
   const expected=byDate.rows.find(r=>r.date===point.date)||{inbound:0,outbound:0};
   assert.equal(point.inbound,expected.inbound);assert.equal(point.outbound,expected.outbound);
  }
  for(const payload of [null,[],42,'string']){
   const invalid=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   assert.equal(invalid.status,400);
  }
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:'socio_session=%invalid'}})).status,401);
  for(let i=0;i<16;i++)await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'unknown@example.test',password:'incorrect-password'})});
  const validAgain=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'audit@example.test',password:'AuditPassword123!'})});
  assert.equal(validAgain.status,200,'A different account behind the same proxy must remain able to log in');
  await pool.query("INSERT INTO conversation_ui_state(tenant_id,conversation_id,handling_mode,ai_activated_at) VALUES($1,$2,'ai_assist',now()) ON CONFLICT(tenant_id,conversation_id) DO UPDATE SET handling_mode='ai_assist',ai_activated_at=now()",[tenant,conversation]);
  const resolved=await fetch(base+'/api/conversations/'+conversation,{method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({status:'resolved'})});
  assert.equal(resolved.status,200);
  const mode=await pool.query('SELECT handling_mode,ai_activated_at FROM conversation_ui_state WHERE tenant_id=$1 AND conversation_id=$2',[tenant,conversation]);
  assert.equal(mode.rows[0].handling_mode,'human');assert.equal(mode.rows[0].ai_activated_at,null);
  await pool.query("UPDATE tenants SET features=features||'{\"whatsapp\":false,\"ai\":false}'::jsonb WHERE id=$1",[tenant]);
  for(const path of ['/api/simulate','/api/ops/groq/test','/api/imports/zip']){
   const blocked=await fetch(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'});
   assert.equal(blocked.status,403);
  }
  assert.equal((await(await request('/api/dashboard')).json()).inboundMessages,0);
  assert((await(await request('/api/dashboard/activity?range=7d')).json()).points.every(p=>p.inbound===0&&p.outbound===0));
  assert.equal((await request('/api/conversations/'+conversation+'/history')).status,403);
  assert.equal((await request('/api/conversations/'+conversation+'/messages')).status,403);
  await pool.query("UPDATE tenants SET status='paused' WHERE id=$1",[tenant]);
  assert.equal((await request('/api/products')).status,403);
  assert.equal((await request('/api/me')).status,200);
 });
});
