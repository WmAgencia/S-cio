import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {Client} from 'pg';
import {createTestDatabase} from './helpers/test-database.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{
 const socket=createServer();
 socket.once('error',reject);
 socket.listen(0,'127.0.0.1',()=>{
  const port=socket.address().port;
  socket.close(()=>resolve(port));
 });
});
const features={whatsapp:true,catalog:true,meta_ads:true,ai:true,team:true};
const key='fixture-only-setup-token-for-isolation-testing-2026';
const password='OnlyForIntegrationTests_2026!';

test('Two real HTTP tenants isolate WhatsApp, products/media, training, Meta decisions, reports and Master switches',
 {skip:!process.env.DATABASE_URL,timeout:135000},async t=>{
 const fixture=await createTestDatabase('socio_iso_http_');
 const port=await freePort();
 const db=new Client({connectionString:fixture.url.href,connectionTimeoutMillis:15000});
 let app,stderr='';
 t.after(async()=>{
  if(app){
   app.kill('SIGTERM');
   await new Promise(resolve=>{
    if(app.exitCode!==null||app.signalCode!==null)return resolve();
    app.once('exit',resolve);
    setTimeout(resolve,4000).unref();
   });
  }
  await db.end().catch(()=>{});
  await fixture.drop();
 });
 await db.connect();
 app=spawn(process.execPath,['server.mjs'],{
  env:{...process.env,DATABASE_URL:fixture.url.href,PORT:String(port),
   NODE_ENV:'test',SOCIO_DB_SCHEMA:'socio_app',SETUP_TOKEN:key,
   CHANNEL_ENCRYPTION_KEY:'only-a-test-channel-encryption-key-2026-123',
   SOCIO_PUBLIC_URL:'https://socio.test.invalid',
   SOCIO_OUTBOUND_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',
   SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_OWNER_CHANNEL_ENABLED:'false',
   SOCIO_TRAFFIC_AUTOPILOT_ENABLED:'false',
   WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',GROQ_API_KEY:'',DEEPSEEK_API_KEY:''
  },stdio:['ignore','pipe','pipe']
 });
 app.stderr.on('data',buffer=>{stderr=(stderr+buffer.toString()).slice(-1200);});
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<220;i++){
  try{
   const res=await fetch(base+'/health');
   if(res.ok){ready=true;break;}
  }catch{}
  if(app.exitCode!==null||app.signalCode!==null)break;
  await sleep(100);
 }
 assert(ready,'Disposable app failed to start: '+stderr);
 const raw=async(path,method='GET',payload,auth)=>{
  const res=await fetch(base+path,{
   method,headers:{'Content-Type':'application/json',
    ...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf,...(auth.expectedTenant?{'X-Socio-Tenant':auth.expectedTenant}:{})}:{})},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  const body=await res.json().catch(()=>null);
  return {status:res.status,body,headers:res.headers};
 };
 const masterSetup=await raw('/api/setup','POST',{
  setupToken:key,name:'Audit Master',company:'Audit Master Company',
  email:'master-iso-audit@example.test',password
 });
 assert.equal(masterSetup.status,201,JSON.stringify(masterSetup.body));
 const master={cookie:masterSetup.headers.get('set-cookie')?.split(';')[0],
  csrf:masterSetup.body.csrf};
 assert(master.cookie&&master.csrf);
 const create=async(letter)=>{
  const r=await raw('/api/admin/tenants','POST',{
   company:'Empresa Isolada '+letter,ownerName:'Dono '+letter,
   ownerEmail:'owner-'+letter.toLowerCase()+'-iso-audit@example.test',
   ownerPassword:password,plan:'essencial',features
  },master);
  assert.equal(r.status,201,JSON.stringify(r.body));
  return r.body.id;
 };
 const ta=await create('A'),tb=await create('B');
 assert(ta&&tb&&ta!==tb);
 const login=async(letter)=>{
  const r=await raw('/api/login','POST',{
   identifier:'owner-'+letter.toLowerCase()+'-iso-audit@example.test',password
  });
  assert.equal(r.status,200,JSON.stringify(r.body));
  return {cookie:r.headers.get('set-cookie')?.split(';')[0],csrf:r.body.csrf};
 };
 const ownerA=await login('A'),ownerB=await login('B');
 const identifiers={
  a:{channel:randomUUID(),conversation:randomUUID(),message:randomUUID(),
   product:randomUUID(),job:randomUUID(),version:randomUUID(),decision:randomUUID(),media:randomUUID()},
  b:{channel:randomUUID(),conversation:randomUUID(),message:randomUUID(),
   product:randomUUID(),job:randomUUID(),version:randomUUID(),decision:randomUUID(),media:randomUUID()}
 };
 for(const [tenant,letter,ids] of [[ta,'A',identifiers.a],[tb,'B',identifiers.b]]){
  await db.query(
   "INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,$3,$4,'manual','connected')",
   [ids.channel,tenant,'Canal '+letter,'55159999'+(letter==='A'?'1111':'2222')]);
  await db.query(
   "INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) VALUES($1,$2,$3,$4,$5)",
   [ids.conversation,tenant,ids.channel,'Cliente '+letter,'55158888'+(letter==='A'?'1111':'2222')]
  );
  await db.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'inbound',$4)",
   [ids.message,tenant,ids.conversation,'Mensagem secreta '+letter]);
  await db.query(
   "INSERT INTO products(id,tenant_id,name,price_cents) VALUES($1,$2,$3,1990)",
   [ids.product,tenant,'Produto '+letter]);
  await db.query(
   "INSERT INTO product_media(id,tenant_id,product_id,object_key,content_type,bytes) VALUES($1,$2,$3,$4,'image/jpeg',1200)",
   [ids.media,tenant,ids.product,tenant+'/'+ids.product+'/'+ids.media+'.jpg']);
  await db.query(
   "INSERT INTO training_jobs(id,tenant_id,status) VALUES($1,$2,'completed')",
   [ids.job,tenant]);
  await db.query(
   "INSERT INTO training_versions(id,tenant_id,job_id,version,status,knowledge_md) VALUES($1,$2,$3,1,'approved',$4)",
   [ids.version,tenant,ids.job,'Conhecimento privado da empresa '+letter]);
  await db.query(
   "INSERT INTO socio_traffic_decisions(id,tenant_id,account_id,action,entity,entity_id,reason,explanation,status) "+
   "VALUES($1,$2,$3,'hold','campaign',$4,$5,$6,'awaiting_approval')",
   [ids.decision,tenant,'act_'+(letter==='A'?'11111':'22222'),
    letter==='A'?'11111':'22222','motivo '+letter,'Plano privado '+letter]);
  await db.query('UPDATE agents SET instructions=$2 WHERE tenant_id=$1',
   [tenant,'Manual exclusivo da Empresa '+letter]);
 }
 const assertTenant=async(auth,tenant,letter,self,other)=>{
  const me=await raw('/api/me','GET',undefined,auth);
  assert.equal(me.status,200);
  assert.equal(me.body.tenant.id,tenant);
  assert.equal(me.body.user.platformOwner||false,auth===master);
  const [inbox,legacy,products,agent,training,traffic,pending,reports,dashboard]=await Promise.all([
   raw('/api/inbox/v2','GET',undefined,auth),
   raw('/api/inbox','GET',undefined,auth),
   raw('/api/products','GET',undefined,auth),
   raw('/api/agent','GET',undefined,auth),
   raw('/api/training/versions','GET',undefined,auth),
   raw('/api/marketing/traffic','GET',undefined,auth),
   raw('/api/marketing/traffic/pending','GET',undefined,auth),
   raw('/api/reports','GET',undefined,auth),
   raw('/api/dashboard','GET',undefined,auth)
  ]);
  for(const [name,result] of Object.entries({inbox,legacy,products,agent,training,traffic,pending,reports,dashboard}))
   assert.equal(result.status,200,name+' '+letter+': '+JSON.stringify(result.body));
  assert.deepEqual(inbox.body.conversations.map(x=>x.id),[self.conversation]);
  assert.deepEqual(legacy.body.map(x=>x.id),[self.conversation]);
  assert.deepEqual(products.body.map(x=>x.id),[self.product]);
  assert.equal(agent.body.instructions,'Manual exclusivo da Empresa '+letter);
  assert.deepEqual(training.body.map(x=>x.id),[self.version]);
  assert.deepEqual(traffic.body.items.map(x=>x.id),[self.decision]);
  assert.deepEqual(pending.body.items.map(x=>x.id),[self.decision]);
  assert.equal(reports.body.totals.inbound_messages,1);
  assert.equal(dashboard.body.products,1);
  assert.equal(dashboard.body.openConversations,1);
  assert.equal(dashboard.body.inboundMessages,1);
  const foreignHistory=await raw('/api/conversations/'+other.conversation+'/history','GET',undefined,auth);
  assert.equal(foreignHistory.status,404,'Foreign chat history must be unreadable');
  const foreignMessages=await raw('/api/conversations/'+other.conversation+'/messages','GET',undefined,auth);
  assert.equal(foreignMessages.status,404,'Foreign legacy history must be unreadable');
  const foreignMedia=await raw('/api/products/'+other.product+'/media/'+other.media+'/file','GET',undefined,auth);
  assert.equal(foreignMedia.status,404,'Foreign product media must be unreadable without touching S3');
  const foreignWrite=await raw('/api/conversations/'+other.conversation+'/notes','POST',
   {body:'Unlawful cross-tenant write'},auth);
  assert.equal(foreignWrite.status,404,'Foreign notes must not be written');
  const foreignPatch=await raw('/api/conversations/'+other.conversation,'PATCH',
   {status:'resolved'},auth);
  assert.equal(foreignPatch.status,404,'Foreign conversation must not be updated');
 };
 await assertTenant(ownerA,ta,'A',identifiers.a,identifiers.b);
 await assertTenant(ownerB,tb,'B',identifiers.b,identifiers.a);
 // Ordinary owners must not obtain platform administrative privileges.
 assert.equal((await raw('/api/admin/tenants','GET',undefined,ownerA)).status,403);
 assert.equal((await raw('/api/admin/switch','POST',{tenantId:tb},ownerA)).status,403);
 // Master may switch views, but every read MUST use the newly selected tenant.
 assert.equal((await raw('/api/admin/switch','POST',{tenantId:ta},master)).status,200);
 await assertTenant(master,ta,'A',identifiers.a,identifiers.b);
 assert.equal((await raw('/api/admin/switch','POST',{tenantId:tb},master)).status,200);
 await assertTenant(master,tb,'B',identifiers.b,identifiers.a);
 // A second browser tab still showing A must not read or write B accidentally.
 const staleMaster={...master,expectedTenant:ta};
 assert.equal((await raw('/api/products','GET',undefined,staleMaster)).status,409);
 assert.equal((await raw('/api/conversations/'+identifiers.b.conversation,'PATCH',{status:'resolved'},staleMaster)).status,409);
 assert.equal((await raw('/api/admin/switch','POST',{tenantId:ta},staleMaster)).status,409);
 assert.equal((await raw('/api/me','GET',undefined,staleMaster)).body.tenant.id,tb);
 assert.equal((await raw('/api/products','GET',undefined,{...master,expectedTenant:tb})).status,200);
 // Neither switch changes the ordinary owner's session.
 assert.equal((await raw('/api/me','GET',undefined,ownerA)).body.tenant.id,ta);
 assert.equal((await raw('/api/me','GET',undefined,ownerB)).body.tenant.id,tb);
 const checked=await db.query(
  "SELECT tenant_id,count(*) FILTER(WHERE direction='note')::int AS notes,"+
  "count(*) FILTER(WHERE direction='inbound')::int AS inbound "+
  "FROM messages WHERE tenant_id IN($1,$2) GROUP BY tenant_id ORDER BY tenant_id",
  [ta,tb]);
 assert.equal(checked.rowCount,2);
 for(const x of checked.rows){assert.equal(x.notes,0);assert.equal(x.inbound,1);}
});
