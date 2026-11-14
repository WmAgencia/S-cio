import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Client} from 'pg';
import {createMetaBrowser} from '../meta-browser.mjs';
import {createTestDatabase} from './helpers/test-database.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('browser HTTP and PostgreSQL: auth, role, feature, CSRF and durable scope without Meta app',
 {skip:!process.env.DATABASE_URL,timeout:65000},async t=>{
 const {url,drop}=await createTestDatabase('socio_meta_browser_test_');
 const port=35000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
 const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATABASE_URL:url.href,PORT:String(port),NODE_ENV:'test',
  SETUP_TOKEN:'meta-browser-test-setup-token-2026-0000',CHANNEL_ENCRYPTION_KEY:'meta-browser-test-key-2026-000000000000',
  SOCIO_META_BROWSER_ENABLED:'true',SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',SOCIO_OUTBOUND_ENABLED:'false',
  META_APP_ID:'',META_APP_SECRET:'',META_ACCESS_TOKEN:'',WA_AKG_BASE_URL:'',WA_AKG_API_KEY:''},stdio:['ignore','pipe','pipe']});
 const db=new Client({connectionString:url.href});
 t.after(async()=>{app.kill();await new Promise(done=>{if(app.exitCode!==null)done();else{app.once('exit',done);setTimeout(done,2000).unref();}});await db.end().catch(()=>{});await drop();});
 let live=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){live=true;break;}}catch{}if(app.exitCode!==null)break;await sleep(120);}
 assert(live,'HTTP app did not boot');await db.connect();
 const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupToken:'meta-browser-test-setup-token-2026-0000',name:'Test Owner',company:'Remote Browser Test',email:'browser-owner@example.test',password:'SecureBrowserTest12345!'})});assert.equal(setup.status,201);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'browser-owner@example.test',password:'SecureBrowserTest12345!'})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf,headers={Cookie:cookie,'X-CSRF-Token':csrf,'content-type':'application/json'};
 assert.equal((await fetch(base+'/api/marketing/browser/status')).status,401);
 const status=await(await fetch(base+'/api/marketing/browser/status',{headers})).json();assert.equal(status.requiresMetaApp,false);assert.equal(status.configured,true);assert.deepEqual(status.operations,[]);
 assert.equal((await fetch(base+'/api/marketing/browser/open',{method:'POST',headers:{Cookie:cookie}})).status,403);
 const a=(await db.query('SELECT id AS user_id,tenant_id AS active_tenant_id,role FROM users WHERE email=$1',['browser-owner@example.test'])).rows[0];
 const calls=[],runtime={async call(id,method){calls.push({id,method});return {ok:true};},async stop(){},async close(){}};
 const service=createMetaBrowser({env:{CHANNEL_ENCRYPTION_KEY:'unit-real-postgres-key-2026-00000000',SOCIO_META_BROWSER_ALLOW_WRITES:'true'},runtime});
 await service.action(db,a,'open');const first=calls[0].id;await service.action(db,a,'open');assert.equal(calls[1].id,first);
 const plan={plan_id:'ac'.repeat(24),allow_writes:true};await service.action(db,a,'execute',plan,'real-db-test-001');await service.action(db,a,'execute',plan,'real-db-test-001');assert.equal(calls.filter(x=>x.method==='execute').length,1);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM meta_browser_writes')).rows[0].n),1);
 await service.action(db,a,'disconnect');await service.action(db,a,'open');assert.notEqual(calls.at(-1).id,first);
 await db.query("UPDATE users SET role='agent',platform_owner=false WHERE id=$1",[a.user_id]);
 assert.equal((await fetch(base+'/api/marketing/browser/status',{headers})).status,403);assert.equal((await fetch(base+'/api/marketing/browser/open',{method:'POST',headers,body:'{}'})).status,403);
 await db.query("UPDATE users SET role='owner' WHERE id=$1",[a.user_id]);await db.query("UPDATE tenants SET features=jsonb_set(features,'{meta_ads}','false') WHERE id=$1",[a.active_tenant_id]);
 assert.equal((await fetch(base+'/api/marketing/browser/status',{headers})).status,403);
 assert((await(await fetch(base+'/')).text()).includes('/meta-browser-ui.js'));assert.equal((await fetch(base+'/meta-browser-ui.js')).status,200);
});
