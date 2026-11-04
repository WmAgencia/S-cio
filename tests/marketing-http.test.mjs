import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {Client} from 'pg';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('marketing HTTP: owner/CSRF, signed Google Ads Scripts, replay and disconnect',
 {skip:!process.env.DATABASE_URL,timeout:65000},async t=>{
 const name='socio_marketing_http_test_'+randomBytes(5).toString('hex');
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
 const admin=new Client({connectionString:process.env.DATABASE_URL});
 await admin.connect();await admin.query('CREATE DATABASE '+name);
 const port=35000+Math.floor(Math.random()*18000);
 const app=spawn(process.execPath,['server.mjs'],{
  env:{...process.env,DATABASE_URL:url.href,PORT:String(port),NODE_ENV:'test',
   SETUP_TOKEN:'secure-fixture-setup-token-for-marketing-2026',
   CHANNEL_ENCRYPTION_KEY:'fixture-marketing-cryptographic-key-2026-12',
   SOCIO_PUBLIC_URL:'https://socio.example.test',SOCIO_INSTAGRAM_LAB_URL:'',
   SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',
   SOCIO_OUTBOUND_ENABLED:'false',WA_AKG_BASE_URL:'',WA_AKG_API_KEY:''},
  stdio:['ignore','pipe','pipe']
 });
 t.after(async()=>{
  app.kill('SIGTERM');
  await new Promise(done=>{if(app.exitCode!==null)done();else{
   app.once('exit',done);setTimeout(done,2000).unref();}});
  await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});
  await admin.end();
 });
 const base='http://127.0.0.1:'+port;
 let live=false,stderr='';
 app.stderr.on('data',x=>{stderr+=x.toString().slice(-300);stderr=stderr.slice(-400);});
 for(let i=0;i<100;i++){
  try{if((await fetch(base+'/health')).ok){live=true;break;}}catch{}
  if(app.exitCode!==null)break;
  await sleep(120);
 }
 assert(live,'HTTP app did not boot: '+stderr);
 const index=await(await fetch(base+'/')).text();
 assert(index.includes('data-view="marketing"'));
 const setup=await fetch(base+'/api/setup',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({
   setupToken:'secure-fixture-setup-token-for-marketing-2026',
   name:'Conta teste',company:'Marketing Test Tenant',email:'marketing-owner@example.test',
   password:'VeryLongSecure12345!'})});
 assert.equal(setup.status,201,await setup.text().catch(()=>'?'));
 const login=await fetch(base+'/api/login',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email:'marketing-owner@example.test',password:'VeryLongSecure12345!'})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
 assert.equal((await fetch(base+'/api/marketing')).status,401);
 const overview=await fetch(base+'/api/marketing',{headers:{Cookie:cookie}});
 assert.equal(overview.status,200);
 const initial=await overview.json();
 assert.deepEqual(initial.connections,[]);
 assert.deepEqual(initial.reports,[]);
 assert.equal(initial.instagramLab.accountConnected,false);
 const withoutCsrf=await fetch(base+'/api/marketing/google/register',{
  method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({accountId:'1234567890',label:'Google Teste'})});
 assert.equal(withoutCsrf.status,403);
 const create=await fetch(base+'/api/marketing/google/register',{
  method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
  body:JSON.stringify({accountId:'1234567890',label:'Google Teste'})});
 assert.equal(create.status,201,await create.text().catch(()=>'?'));
 const created=await create.json();
 assert.equal(created.accountId,'1234567890');
 assert.equal(created.status,'pending');
 assert(created.script.includes('UrlFetchApp.fetch'));
 const extract=created.script.match(/const SOCIO_SECRET = ("[^"]+");/);
 assert(extract,'Google Script must include one-time secret');
 const secret=JSON.parse(extract[1]);
 const row={date:new Date().toISOString().slice(0,10),campaignId:'333444555',
  campaignName:'Somente teste',impressions:12,clicks:2,costMicros:5500000,conversions:0};
 const raw=JSON.stringify({version:1,accountId:'1234567890',runId:randomUUID(),
  timestamp:Date.now(),rows:[row]});
 const uri=base+'/webhooks/google-ads/'+created.id;
 const wrong=await fetch(uri,{method:'POST',headers:{'Content-Type':'application/json',
  'X-Socio-Signature-256':'sha256='+'a'.repeat(64)},body:raw});
 assert.equal(wrong.status,403);
 const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 const send=await fetch(uri,{method:'POST',headers:{'Content-Type':'application/json',
  'X-Socio-Signature-256':signature},body:raw});
 assert.equal(send.status,200,await send.text().catch(()=>'?'));
 assert.deepEqual(await send.json(),{ok:true,reused:false,stored:1});
 const again=await fetch(uri,{method:'POST',headers:{'Content-Type':'application/json',
  'X-Socio-Signature-256':signature},body:raw});
 assert.deepEqual(await again.json(),{ok:true,reused:true,stored:0});
 const listed=await(await fetch(base+'/api/marketing',{headers:{Cookie:cookie}})).json();
 assert.equal(listed.reports.length,1);
 assert.equal(listed.reports[0].campaign_name,'Somente teste');
 assert(!JSON.stringify(listed).includes(secret));
 const disconnect=await fetch(base+'/api/marketing/connections/'+created.id+'/disconnect',{
  method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'});
 assert.equal(disconnect.status,200);
 assert.equal((await(await fetch(uri,{method:'POST',headers:{
  'Content-Type':'application/json','X-Socio-Signature-256':signature},body:raw})).status),403);
 const after=await(await fetch(base+'/api/marketing',{headers:{Cookie:cookie}})).json();
 assert.equal(after.reports.length,1,'Past verified metrics must not vanish on disconnect');
});
