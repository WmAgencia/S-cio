// Disposable database for HTTP tests. Runtime lives in the private socio_app
// schema, so a fresh database needs the schema, the full DDL and a baselined
// ledger before the server accepts it as ready.
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client} from 'pg';
import {applyPendingMigrations} from '../../schema-migrations.mjs';
export async function createTestDatabase(prefix='socio_test_',{schema='socio_app'}={}){
 const name=prefix+randomBytes(5).toString('hex');
 // A saturated pooler can leave a connect() waiting forever, which hangs the whole
 // test file and (with node's default per-file timeout of 0) the entire suite.
 const limits={connectionTimeoutMillis:15000,query_timeout:60000};
 const admin=new Client({connectionString:process.env.DATABASE_URL,...limits});
 await admin.connect();
 await admin.query('CREATE DATABASE '+name);
 const url=new URL(process.env.DATABASE_URL);
 url.pathname='/'+name;
 const db=new Client({connectionString:url.href,connectionTimeoutMillis:15000});
 await db.connect();
 try{
  if(schema==='public'){
   await db.query(await readFile(new URL('../../schema.sql',import.meta.url),'utf8'));
  }else{
   await db.query('CREATE SCHEMA IF NOT EXISTS socio_app');
   await db.query('SET search_path TO socio_app,pg_catalog');
   await db.query(await readFile(new URL('../../schema.sql',import.meta.url),'utf8'));
   await applyPendingMigrations(db,{schema:'socio_app',baseline:true});
   // Every consumer of this URL (server, fixture clients) expects unqualified SQL
   // to resolve inside socio_app, exactly as the runtime pool does.
   url.searchParams.set('options','-c search_path=socio_app,pg_catalog');
  }
 }catch(error){
  await db.end().catch(()=>{});
  await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});
  await admin.end().catch(()=>{});
  throw error;
 }
 await db.end();
 let dropped=false;
 return {name,url,async drop(){
  if(dropped)return;
  dropped=true;
  await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});
  await admin.end().catch(()=>{});
 }};
}
