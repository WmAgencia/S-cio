import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {Client} from 'pg';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('HTTP Instagram: one-use OAuth launch, signed webhook, role/CSRF and opt-in only',
 {skip:!process.env.DATABASE_URL,timeout:65000},async t=>{
 const dbName='socio_instagram_http_test_'+randomBytes(5).toString('hex');
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+dbName;
 const admin=new Client({connectionString:process.env.DATABASE_URL});
 await admin.connect();
 await admin.query('CREATE DATABASE '+dbName);
 t.after(async()=>{
  await admin.query('DROP DATABASE IF EXISTS '+dbName+' WITH (FORCE)').catch(()=>{});
  await admin.end();
 });
 const port=32000+Math.floor(Math.random()*18000),setupToken='fixture-setup-token-unique-2026-very-long';
 const secret='fixture-instagram-app-secret-no-production';
 const instance=spawn(process.execPath,['server.mjs'],{
  env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:url.href,
   WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',
   SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',SOCIO_OUTBOUND_ENABLED:'false',
   SETUP_TOKEN:setupToken,INSTAGRAM_APP_ID:'1234567890',
   SOCIO_INSTAGRAM_ENABLED:'true',INSTAGRAM_APP_SECRET:secret,INSTAGRAM_WEBHOOK_VERIFY_TOKEN:'instagram-fixture-verify',
   SOCIO_PUBLIC_URL:'https://socio.example.test',
   CHANNEL_ENCRYPTION_KEY:'integration-test-channel-encryption-key-2026'},
  stdio:['ignore','pipe','pipe']
 });
 let logs='';instance.stderr.on('data',x=>{logs+=x.toString();logs=logs.slice(-300)});
 t.after(()=>instance.kill('SIGTERM'));
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  if(instance.exitCode!==null)break;
  await sleep(140);
 }
 assert(ready,'server did not become ready: '+logs);
 const home=await (await fetch(base+'/')).text();
 assert(!home.includes('data-view="instagram"'));
 const client=await (await fetch(base+'/app.js')).text();
 assert(!client.includes('Conectar Instagram'));
 const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({setupToken,name:'Gestor Instagram',company:'Empresa Instagram',
   email:'ig-owner@test.example',password:'StrongPassword!2026Unique'})});
 assert.equal(setup.status,201,await setup.text().catch(()=>'?'));
 const cookie=setup.headers.get('set-cookie').split(';')[0];
 // Once consumed above, body cannot be re-read; get CSRF from login.
 const logged=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:'ig-owner@test.example',password:'StrongPassword!2026Unique'})});
 assert.equal(logged.status,200);
 const authCookie=logged.headers.get('set-cookie').split(';')[0];
 const csrf=(await logged.json()).csrf;
 const configReq=await fetch(base+'/api/instagram/config',{headers:{Cookie:authCookie}});
 assert.equal(configReq.status,200);
 const config=await configReq.json();
 assert.equal(config.configured,true);
 assert(!JSON.stringify(config).includes(secret));
 assert(config.permissionsRequired.includes('instagram_business_manage_messages'));
 const accounts=await fetch(base+'/api/instagram/accounts',{headers:{Cookie:authCookie}});
 assert.equal(accounts.status,200);
 assert.deepEqual(await accounts.json(),[]);
 const withoutCsrf=await fetch(base+'/api/instagram/connect',{
  method:'POST',headers:{Cookie:authCookie,'content-type':'application/json'},body:'{}'});
 assert.equal(withoutCsrf.status,403);
 const start=await fetch(base+'/api/instagram/connect',{
  method:'POST',headers:{Cookie:authCookie,'x-csrf-token':csrf,'content-type':'application/json'},body:'{}'});
 assert.equal(start.status,200);
 const launch=await start.json();
 const callback=new URL(launch.authorizationUrl);
 assert.equal(callback.hostname,'www.instagram.com');
 assert.equal(callback.searchParams.get('redirect_uri'),config.redirectUri);
 assert.equal(callback.searchParams.get('scope'),
  'instagram_business_basic,instagram_business_manage_messages');
 assert(!launch.authorizationUrl.includes(secret));
 const verify=await fetch(base+'/webhooks/instagram?hub.mode=subscribe&hub.verify_token=instagram-fixture-verify&hub.challenge=1234567');
 assert.equal(verify.status,200);
 assert.equal(await verify.text(),'1234567');
 const rejected=await fetch(base+'/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=999');
 assert.equal(rejected.status,403);
 const raw=JSON.stringify({object:'instagram',entry:[{id:'1234567890',
  messaging:[{sender:{id:'11111111'},recipient:{id:'1234567890'},timestamp:Date.now(),
   message:{mid:'fixture-mid-1',text:'Oi'}}]}]});
 assert.equal((await fetch(base+'/webhooks/instagram',{method:'POST',headers:{
  'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)},body:raw})).status,403);
 const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 const accepted=await fetch(base+'/webhooks/instagram',{method:'POST',
  headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw});
 assert.equal(accepted.status,200);
 assert.deepEqual(await accepted.json(),{ok:true,received:1,imported:0,ignored:1},
  'No Instagram account must mean no tenant message import');
 const inbox=await fetch(base+'/api/inbox/v2?filter=instagram',{headers:{Cookie:authCookie}});
 assert.equal(inbox.status,200);
 assert.equal((await inbox.json()).conversations.length,0);
 const invalidState=await fetch(base+'/api/instagram/oauth/callback?code=fixture-example-code&state='+('0'.repeat(64)),
  {redirect:'manual'});
 assert.equal(invalidState.status,303);
 assert.equal(invalidState.headers.get('location'),'/?instagram=failed');
 const stillEmpty=await fetch(base+'/api/instagram/accounts',{headers:{Cookie:authCookie}});
 assert.deepEqual(await stillEmpty.json(),[]);
 assert(cookie.includes('socio_session='));
});
