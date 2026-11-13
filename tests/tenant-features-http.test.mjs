import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {createServer} from 'node:net';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const getFreePort=()=>new Promise((resolve,reject)=>{
 const server=createServer();server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>resolve(address.port));});
});

test('HTTP tenant bundles: master creates company with optional modules, switch blocks API, editing restores access',
 {skip:!process.env.DATABASE_URL,timeout:90000},async t=>{
 const name='socio_features_http_'+randomBytes(5).toString('hex'),target=new URL(process.env.DATABASE_URL);
 target.pathname='/'+name;
 const admin=new Client({connectionString:process.env.DATABASE_URL});
 await admin.connect();await admin.query('CREATE DATABASE '+name);
 const port=await getFreePort();
 const app=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATABASE_URL:target.href,
  PORT:String(port),NODE_ENV:'test',SETUP_TOKEN:'fixture-token-setup-for-company-features-2026',
  CHANNEL_ENCRYPTION_KEY:'test-tenant-features-secret-long-enough-12345',
  SOCIO_PUBLIC_URL:'https://socio.example.test',WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',
  SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_OUTBOUND_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',
  GROQ_API_KEY:''},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{
  app.kill('SIGTERM');
  await new Promise(resolve=>{
   if(app.exitCode!==null)return resolve();
   app.once('exit',resolve);setTimeout(resolve,2200).unref();
  });
  await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});
  await admin.end().catch(()=>{});
 });
 const base='http://127.0.0.1:'+port;let ready=false,stderr='';
 app.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-500)});
 for(let i=0;i<120;i++){
  try{const r=await fetch(base+'/health');if(r.ok){ready=true;break;}}catch{}
  if(app.exitCode!==null)break;
  await sleep(80);
 }
 assert(ready,'App did not start: '+stderr);
 const startup=await fetch(base+'/api/setup',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({setupToken:'fixture-token-setup-for-company-features-2026',
   name:'Conta Master',company:'Consecom Teste',email:'master-features@example.test',
   password:'LongStrongPassword123!'})});
 assert.equal(startup.status,201);
 const session=startup.headers.get('set-cookie').split(';')[0],csrf=(await startup.json()).csrf;
 const request=(path,method='GET',payload)=>fetch(base+path,{method,headers:{
  Cookie:session,'Content-Type':'application/json','X-CSRF-Token':csrf
 },...(payload===undefined?{}:{body:JSON.stringify(payload)})});
 const opts={whatsapp:true,catalog:false,meta_ads:false,ai:false,team:false};
 const added=await request('/api/admin/tenants','POST',{
  company:'Cliente Sem Catálogo',ownerName:'Dona do Cliente',ownerEmail:'owner-features@example.test',
  ownerPassword:'LongStrongPassword123!',plan:'essencial',features:opts
 });
 assert.equal(added.status,201,await added.text().catch(()=>'?'));
 const companies=await(await request('/api/admin/tenants')).json();
 const company=companies.find(x=>x.name==='Cliente Sem Catálogo');
 assert(company);
 assert.deepEqual(company.features,opts);
 const switched=await request('/api/admin/switch','POST',{tenantId:company.id});
 assert.equal(switched.status,200);
 const me=await(await request('/api/me')).json();
 assert.deepEqual(me.tenant.features,opts);
 assert(!me.user.permissions.includes('catalog.read'));
 assert(!me.user.permissions.includes('marketing.read'));
 assert(me.user.permissions.includes('billing.manage'),'Billing is not module-scoped');
 assert(me.user.permissions.includes('platform.manage'),'Platform master controls remain available');
 for(const url of ['/api/products','/api/marketing/oauth','/api/agent']){
  const res=await request(url);
  assert.equal(res.status,403,'Disabled module accessible at '+url);
 }
 const removed=await request('/api/sales/quote-requests');
 assert.equal(removed.status,404,'Commerce routes are removed');
 const updated=await request('/api/admin/tenants/'+company.id+'/features','PUT',{
  features:{...opts,catalog:true}});
 assert.equal(updated.status,200);
 assert.equal((await(await request('/api/me')).json()).tenant.features.catalog,true);
 assert.equal((await request('/api/products')).status,200);
 const tenant=await(await request('/api/admin/tenants')).json();
 assert(tenant.find(x=>x.id===company.id).features.catalog);
});
