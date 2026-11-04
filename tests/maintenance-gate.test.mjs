import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Client} from 'pg';
import {maintenanceEnabled,writesBlocked,workersBlocked} from '../migration-guard.mjs';

test('maintenance barrier blocks writes, keeps reads and pauses workers',()=>{
 const yes={SOCIO_MAINTENANCE_MODE:'1'},no={SOCIO_MAINTENANCE_MODE:'0'};
 assert.equal(maintenanceEnabled(yes),true);
 assert.equal(maintenanceEnabled(no),false);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(writesBlocked(method,yes),true);
 for(const method of ['GET','HEAD','OPTIONS'])assert.equal(writesBlocked(method,yes),false);
 assert.equal(writesBlocked('POST',no),false);
 assert.equal(workersBlocked(yes),true);
 assert.equal(workersBlocked(no),false);
});
test('maintenance server returns 503 for all mutation routes, including webhooks and unauthenticated buyer acceptance',
 {skip:!process.env.DATABASE_URL,timeout:45000},async t=>{
 const database='socio_maintenance_test_'+randomBytes(5).toString('hex'),sourceUrl=new URL(process.env.DATABASE_URL);
 sourceUrl.pathname='/'+database;
 const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 await admin.query('CREATE DATABASE '+database);
 t.after(async()=>{
  await admin.query('DROP DATABASE IF EXISTS '+database+' WITH (FORCE)').catch(()=>{});
  await admin.end();
 });
 const port=39000+Math.floor(Math.random()*8000);
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,
  DATABASE_URL:sourceUrl.href,PORT:String(port),SOCIO_MAINTENANCE_MODE:'1',
  WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>{errors+=chunk.toString();errors=errors.slice(-800)});
 t.after(()=>child.kill('SIGTERM'));
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  if(child.exitCode!==null)break;
  await new Promise(resolve=>setTimeout(resolve,120));
 }
 assert(ready,'Maintenance server failed health check: '+errors);
 const health=await (await fetch(base+'/health')).json();
 assert.equal(health.readOnly,true);
 const bootstrap=await fetch(base+'/api/bootstrap');
 assert.equal(bootstrap.status,200);
 const index=await fetch(base+'/');
 assert.equal(index.status,200);
 for(const [method,path] of [
  ['POST','/api/setup'],['POST','/api/login'],['POST','/webhooks/whatsapp'],
  ['POST','/webhooks/stripe-test'],
  ['POST','/api/public/quotes/'+('a'.repeat(64))+'/accept'],
  ['POST','/api/public/quotes/'+('a'.repeat(64))+'/checkout'],
  ['PATCH','/api/products/00000000-0000-0000-0000-000000000000'],
  ['DELETE','/api/products/00000000-0000-0000-0000-000000000000'],
  ['PUT','/api/agent']
 ]){
  const res=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(res.status,503,method+' '+path);
  assert.equal(res.headers.get('retry-after'),'120');
 }
});
