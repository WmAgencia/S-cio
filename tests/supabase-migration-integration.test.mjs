import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client} from 'pg';
import {TABLES,migrate} from '../scripts/socio-supabase-migrate.mjs';

test('all-table migration: read-only preflight, exact copies, fingerprints, and refusal of occupied targets',
 {skip:!process.env.DATABASE_URL,timeout:120000},async t=>{
 const sourceName='socio_migration_source_test_'+randomBytes(5).toString('hex');
 const targetName='socio_migration_target_test_'+randomBytes(5).toString('hex');
 const sourceUrl=new URL(process.env.DATABASE_URL),targetUrl=new URL(process.env.DATABASE_URL);
 sourceUrl.pathname='/'+sourceName;targetUrl.pathname='/'+targetName;
 const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 t.after(async()=>{
  for(const name of [sourceName,targetName])await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});
  await admin.end();
 });
 await admin.query('CREATE DATABASE '+sourceName);
 await admin.query('CREATE DATABASE '+targetName);
 await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;"+
  "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
 const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
 const source=new Client({connectionString:sourceUrl.href}),target=new Client({connectionString:targetUrl.href});
 await source.connect();await target.connect();
 try{
  await source.query(schema);
  await target.query('CREATE SCHEMA socio_app');
  await target.query('SET search_path TO socio_app,public');
  await target.query(schema);
  const companyA=randomUUID(),companyB=randomUUID(),user=randomUUID(),channel=randomUUID();
  const conversation=randomUUID(),message=randomUUID(),product=randomUUID();
  for(const [id,slug] of [[companyA,'alpha'],[companyB,'beta']])
   await source.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)',[id,'Empresa '+slug,slug]);
  await source.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role,platform_owner,active) "+
   "VALUES($1,$2,'owner@test.invalid','Gestor','scrypt:fixture','owner',true,true)",[user,companyA]);
  await source.query("INSERT INTO channels(id,tenant_id,label,phone,provider) VALUES($1,$2,'Canal teste','5515991112222','manual')",
   [channel,companyA]);
  await source.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone,customer_name) VALUES($1,$2,$3,'5515991113333','Cliente exemplo')",
   [conversation,companyA,channel]);
  await source.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'inbound','Texto fictício 100% de teste')",
   [message,companyA,conversation]);
  await source.query("INSERT INTO products(id,tenant_id,name,price_cents) VALUES($1,$2,'Produto teste',2999)",
   [product,companyA]);
  await source.query("INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,'test.fixture',$4)",
   [randomUUID(),companyA,user,JSON.stringify({status:'fixture',nested:{foo:1,bar:2}})]);
 }finally{await source.end();await target.end();}
 const log=[];
 const options={sourceUrl:sourceUrl.href,targetUrl:targetUrl.href,allowLocalTest:true,logger:x=>log.push(x)};
 const readOnly=await migrate(options);
 assert.equal(readOnly.applied,false);assert.equal(readOnly.schemasMatch,true);
 assert.equal(Object.keys(readOnly.counts).length,TABLES.length);
 assert.equal(readOnly.counts.tenants,2);
 assert.equal(readOnly.counts.products,1);
 assert.equal(Object.hasOwn(readOnly.counts,'sales_orders'),false);
 const snapshot=await migrate({...options,apply:true});
 assert.equal(snapshot.applied,true);assert.equal(snapshot.validated,true);
 assert(log.some(x=>x.includes('fingerprint')||x.includes('"phase":"verified"')));
 const validate=new Client({connectionString:targetUrl.href});await validate.connect();
 try{
  assert.equal(Number((await validate.query('SELECT count(*) AS n FROM socio_app.tenants')).rows[0].n),2);
  assert.equal((await validate.query('SELECT name FROM socio_app.products')).rows[0].name,'Produto teste');
  assert.equal((await validate.query('SELECT body FROM socio_app.messages')).rows[0].body,
   'Texto fictício 100% de teste');
  assert.equal((await validate.query('SELECT active FROM socio_app.users')).rows[0].active,true);
  assert.equal((await validate.query('SELECT metadata FROM socio_app.audit')).rows[0].metadata.nested.foo,1);
  const commerce=await validate.query("SELECT table_name FROM information_schema.tables WHERE table_schema='socio_app' AND table_name=ANY($1::text[])",
   [['sales_quotes','sales_orders','sales_payment_events','quote_requests','sale_intents']]);
  assert.equal(commerce.rowCount,0,'Removed commerce tables must not be migrated');
 }finally{await validate.end();}
 await assert.rejects(migrate(options),/Target not empty/,'Second copy must not overwrite already migrated records');
 // Recreate only the *disposable target* to simulate a downstream constraint
 // failure after prior tables have been inserted in the same transaction.
 const broken=new Client({connectionString:targetUrl.href});
 await broken.connect();
 try{
  await broken.query('DROP SCHEMA socio_app CASCADE');
  await broken.query('CREATE SCHEMA socio_app');
  await broken.query('SET search_path TO socio_app,public');
  await broken.query(schema);
  await broken.query('ALTER TABLE socio_app.products ADD CONSTRAINT test_block_product_value CHECK(price_cents<100)');
 }finally{await broken.end();}
 await assert.rejects(migrate({...options,apply:true}),/check constraint/);
 const checked=new Client({connectionString:targetUrl.href});
 await checked.connect();
 try{
  const tenants=await checked.query('SELECT count(*)::int AS n FROM socio_app.tenants');
  assert.equal(tenants.rows[0].n,0,'Migration failure must atomically roll back already copied tenants');
  const products=await checked.query('SELECT count(*)::int AS n FROM socio_app.products');
  assert.equal(products.rows[0].n,0,'Migration failure cannot expose partial records');
 }finally{await checked.end();}
 const stillSource=new Client({connectionString:sourceUrl.href});
 await stillSource.connect();
 try{
  const tenants=await stillSource.query('SELECT count(*)::int AS n FROM tenants');
  assert.equal(tenants.rows[0].n,2,'Failed migration must not mutate the source');
 }finally{await stillSource.end();}

});
