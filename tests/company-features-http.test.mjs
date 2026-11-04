import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
test('HTTP: master creates an agency tenant with selected modules, disabled routes refuse access, owner can use only enabled ones',
 {skip:!process.env.DATABASE_URL,timeout:65000},async t=>{
 const name='socio_feature_routes_'+randomBytes(5).toString('hex');
 const db=new URL(process.env.DATABASE_URL);db.pathname='/'+name;
 const admin=new Client({connectionString:process.env.DATABASE_URL});
 await admin.connect();await admin.query('CREATE DATABASE '+name);
 const port=37000+Math.floor(Math.random()*19000),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{env:{
  ...process.env,DATABASE_URL:db.href,PORT:String(port),NODE_ENV:'test',
  SETUP_TOKEN:'test-only-setup-token-length-over-32-2026',
  CHANNEL_ENCRYPTION_KEY:'unit-only-features-test-crypto-key-2026-test',
  SOCIO_PUBLIC_URL:'https://socio.example.test',
  SOCIO_OUTBOUND_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',
  SOCIO_LIVE_SYNC_ENABLED:'false',SOCIO_INSTAGRAM_ENABLED:'false',
  WA_AKG_BASE_URL:'',WA_AKG_API_KEY:''
 },stdio:['ignore','pipe','pipe']});
 let stderr='';
 child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-2000);});
 t.after(async()=>{
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)return resolve();
   child.once('exit',resolve);setTimeout(resolve,2200).unref();});
  await admin.query('DROP DATABASE IF EXISTS '+name).catch(()=>{});
  await admin.end();
 });
 let ready=false;
 for(let i=0;i<100;i++){
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  if(child.exitCode!==null)break;
  await pause(100);
 }
 assert(ready,'Server did not start: '+stderr);
 const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({setupToken:'test-only-setup-token-length-over-32-2026',
   name:'Admin Consecom',company:'Consecom Teste',email:'admin-features@sample.test',
   password:'StrongFixturePassword2026!'})});
 assert.equal(setup.status,201);
 const cookie=setup.headers.get('set-cookie').split(';')[0],csrf=(await setup.json()).csrf;
 const headers={Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
 const flags={whatsapp:true,catalog:true,sales:false,ai:false,metaAds:false};
 const create=await fetch(base+'/api/admin/tenants',{method:'POST',headers,body:JSON.stringify({
  company:'Oficina A',ownerName:'Responsável A',ownerEmail:'owner-feature-a@sample.test',
  ownerPassword:'AnotherStrongFixturePassword2026!',features:flags
 })});
 assert.equal(create.status,201);
 const tenant=(await create.json()).id;
 const list=await(await fetch(base+'/api/admin/tenants',{headers:{Cookie:cookie}})).json();
 assert.deepEqual(list.find(x=>x.id===tenant).features,flags);
 const switchRes=await fetch(base+'/api/admin/switch',{method:'POST',headers,
  body:JSON.stringify({tenantId:tenant})});
 assert.equal(switchRes.status,200);
 const me=await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();
 assert.deepEqual(me.tenant.features,flags);
 assert(me.user.permissions.includes('catalog.read'));
 assert(me.user.permissions.includes('inbox.read'));
 for(const forbidden of ['sales.read','marketing.read','training.manage'])
  assert(!me.user.permissions.includes(forbidden),forbidden+' cannot remain visible');
 for(const route of ['/api/sales','/api/quote-requests','/api/marketing','/api/agent','/api/training/auto']){
  const blocked=await fetch(base+route,{headers:{Cookie:cookie}});
  assert.equal(blocked.status,403,'Disabled tenant feature must block '+route);
 }
 assert.equal((await fetch(base+'/api/products',{headers:{Cookie:cookie}})).status,200);
 const invalid=await fetch(base+'/api/admin/tenants/'+tenant+'/features',{method:'PATCH',headers,
  body:JSON.stringify({features:{...flags,catalog:false,sales:true}})});
 assert.equal(invalid.status,422);
 const enabled={...flags,sales:true,ai:true,metaAds:true};
 const patch=await fetch(base+'/api/admin/tenants/'+tenant+'/features',{method:'PATCH',headers,
  body:JSON.stringify({features:enabled})});
 assert.equal(patch.status,200);
 const after=(await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json());
 assert(after.user.permissions.includes('sales.read'));
 assert(after.user.permissions.includes('marketing.read'));
 assert(after.user.permissions.includes('training.manage'));
 assert.equal((await fetch(base+'/api/sales',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(base+'/api/quote-requests',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(base+'/api/marketing',{headers:{Cookie:cookie}})).status,200);
 // Direct requests are denied without session regardless of feature flags.
 assert.equal((await fetch(base+'/api/admin/tenants/'+tenant+'/features',{method:'PATCH',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({features:flags})})).status,401);
});
