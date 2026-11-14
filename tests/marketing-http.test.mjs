import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createTestDatabase} from './helpers/test-database.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('marketing HTTP: Meta-only UI and OAuth; retired Google routes cannot reconnect or ingest',
 {skip:!process.env.DATABASE_URL,timeout:65000},async t=>{
 const {url,drop}=await createTestDatabase('socio_marketing_http_test_');
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
  await drop();
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
 const oauthMeta=await fetch(base+'/.well-known/oauth-client');
 assert.equal(oauthMeta.status,200);
 const metadata=await oauthMeta.json();
 assert.deepEqual(metadata.redirect_uris,['https://socio.example.test/api/marketing/oauth/callback']);
 const grantsReq=await fetch(base+'/api/marketing/oauth',{headers:{Cookie:cookie}});
 assert.equal(grantsReq.status,200);
 assert.deepEqual((await grantsReq.json()).grants,[]);
 const unauthorizedOauth=await fetch(base+'/api/marketing/oauth');
 assert.equal(unauthorizedOauth.status,401);
 const noCsrfOauth=await fetch(base+'/api/marketing/oauth/start',{method:'POST',headers:{
  Cookie:cookie,'content-type':'application/json'},body:JSON.stringify({provider:'meta'})});
 assert.equal(noCsrfOauth.status,403);
 const invalidOauth=await fetch(base+'/api/marketing/oauth/start',{method:'POST',headers:{
  Cookie:cookie,'content-type':'application/json','x-csrf-token':csrf},
  body:JSON.stringify({provider:'unknown'})});
 assert.equal(invalidOauth.status,422);
 const instagramStatus=await fetch(base+'/api/instagram/hosted/status',{headers:{Cookie:cookie}});
 assert.equal(instagramStatus.status,404);
 const refusedCallback=await fetch(base+'/api/marketing/oauth/callback?state='+('0'.repeat(64))+
  '&code=some-test-code-123',{redirect:'manual'});
 assert.equal(refusedCallback.status,303);
 assert.equal(refusedCallback.headers.get('location'),'/?marketing=failed');
 const overview=await fetch(base+'/api/marketing',{headers:{Cookie:cookie}});
 assert.equal(overview.status,200);
 const initial=await overview.json();
 assert.deepEqual(initial.connections,[]);
 assert.deepEqual(initial.reports,[]);
 assert.equal(initial.instagramLab,undefined);

 const js=await(await fetch(base+'/app.js')).text();
 assert(js.includes("item('meta','Meta Ads'"),'Meta Ads card must exist');
 assert(!js.includes("item('google'"),'Google Ads card must be absent');
 assert(js.includes("marketingProvider==='meta'"),'OAuth return must verify Meta only');
 const options={method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'};
 const googleStart=await fetch(base+'/api/marketing/oauth/start',{...options,
  body:JSON.stringify({provider:'google'})});
 assert.equal(googleStart.status,422,'Google OAuth must reject new authorizations');
 for(const path of [
  '/api/marketing/google/register',
  '/api/marketing/oauth/google/test',
  '/api/marketing/oauth/google/disconnect'
 ]){
  const response=await fetch(base+path,options);
  assert.equal(response.status,410,'Retired Google route should be closed: '+path);
 }
 const hook=await fetch(base+'/webhooks/google-ads/'+randomBytes(16).toString('hex').slice(0,8)+'-1111-4111-8111-111111111111',{
  method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
 });
 assert.equal(hook.status,410,'No Google Ads Scripts webhook ingestion allowed');
 const stillVisible=await(await fetch(base+'/api/marketing',{headers:{Cookie:cookie}})).json();
 assert.deepEqual(stillVisible.connections,[]);
 assert.deepEqual(stillVisible.reports,[]);
 assert(!JSON.stringify(stillVisible).includes('google_ads_scripts'));

});
