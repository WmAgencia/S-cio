import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Client} from 'pg';

test('Flow HTTP requires login and CSRF, refuses unconfigured generation and hides foreign jobs',
 {skip:!process.env.DATABASE_URL,timeout:45000},async t=>{
 const name='socio_flow_http_test_'+randomBytes(5).toString('hex');
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
 const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const port=35000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATABASE_URL:url.href,PORT:String(port),NODE_ENV:'test',
  SETUP_TOKEN:'flow-fixture-setup-token-123456789012345',CHANNEL_ENCRYPTION_KEY:'flow-fixture-channel-encryption-123456789',
  SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',SOCIO_OUTBOUND_ENABLED:'false',
  SOCIO_INSTAGRAM_LAB_URL:'',WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',SOCIO_META_BROWSER_DIR:'data/test-flow-'+name},stdio:['ignore','ignore','pipe']});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(done=>{if(child.exitCode!==null)done();else{child.once('exit',done);setTimeout(done,2500).unref();}});
  await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});await admin.end();});
 let live=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/health')).ok){live=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(live,'server must boot');
 assert.equal((await fetch(base+'/api/flow/status')).status,401);
 const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupToken:'flow-fixture-setup-token-123456789012345',name:'Flow Owner',company:'Flow Test',email:'flow-owner@example.test',password:'StrongFixturePass12345!'})});
 assert.equal(setup.status,201);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'flow-owner@example.test',password:'StrongFixturePass12345!'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
 const headers={Cookie:cookie,'content-type':'application/json','idempotency-key':'flow-http-fixture'};
 const status=await fetch(base+'/api/flow/status',{headers});assert.equal(status.status,200);assert.equal((await status.json()).ready,false);
 assert.equal((await fetch(base+'/api/flow/images',{method:'POST',headers,body:JSON.stringify({prompt:'coffee'})})).status,403);
 const generation=await fetch(base+'/api/flow/images',{method:'POST',headers:{...headers,'x-csrf-token':csrf},body:JSON.stringify({prompt:'coffee'})});
 assert.equal(generation.status,503);
 assert.equal((await fetch(base+'/api/flow/images/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/content',{headers})).status,404);
});
