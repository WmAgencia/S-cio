import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {maintenanceEnabled,writesBlocked,workersBlocked} from '../migration-guard.mjs';
import {createTestDatabase} from './helpers/test-database.mjs';

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
 const {url:sourceUrl,drop}=await createTestDatabase('socio_maintenance_test_');
 const port=39000+Math.floor(Math.random()*8000);
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,
  DATABASE_URL:sourceUrl.href,PORT:String(port),SOCIO_MAINTENANCE_MODE:'1',
  WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>{errors+=chunk.toString();errors=errors.slice(-800)});
 t.after(async()=>{
  child.kill('SIGTERM');
  await new Promise(done=>{if(child.exitCode!==null)done();else{child.once('exit',done);setTimeout(done,2000).unref();}});
  await drop();
 });
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
  ['PATCH','/api/products/00000000-0000-0000-0000-000000000000'],
  ['DELETE','/api/products/00000000-0000-0000-0000-000000000000'],
  ['PUT','/api/agent']
 ]){
  const res=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(res.status,503,method+' '+path);
  assert.equal(res.headers.get('retry-after'),'120');
 }
});
