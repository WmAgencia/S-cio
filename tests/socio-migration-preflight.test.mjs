import test from 'node:test';
import assert from 'node:assert/strict';
import {TABLES,checkMigrationConfiguration} from '../scripts/socio-supabase-migrate.mjs';
import {validateMasterConfig} from '../scripts/socio-provision-master.mjs';

test('Sócio migration covers all 20 production tables in dependency order',()=>{
 assert.equal(TABLES.length,20);
 assert.equal(new Set(TABLES).size,TABLES.length);
 for(const [parent,child] of [['tenants','users'],['tenants','products'],['channels','conversations'],
  ['conversations','messages'],['training_jobs','training_job_items'],
  ['training_jobs','training_versions'],['imports','training_job_items'],
  ['waakg_scans','waakg_scan_chats'],['products','product_variants']]){
  assert.ok(TABLES.indexOf(parent)<TABLES.indexOf(child),parent+' must be inserted before '+child);
 }
});
test('migration preflight refuses same database, missing URL or non-Supabase destination',()=>{
 const source='postgresql://source:pw@railway.internal:5432/railway';
 const target='postgresql://backend:pw@db.example.supabase.co:5432/postgres?sslmode=require';
 assert.equal(checkMigrationConfiguration(source,target),true);
 assert.throws(()=>checkMigrationConfiguration(source,source),/different databases/);
 assert.throws(()=>checkMigrationConfiguration(source,''),/required/);
 assert.throws(()=>checkMigrationConfiguration(source,'postgresql://a:pw@evil.example:5432/db'),/Supabase/);
 assert.throws(()=>checkMigrationConfiguration('https://bad.example',target),/Postgres/);
});
test('master account is validated without accepting or storing plaintext passwords',()=>{
 const hashed='scrypt:'+'a'.repeat(32)+':'+'b'.repeat(128);
 assert.deepEqual(validateMasterConfig(' MASTER@example.com ','(15) 98181-7336',hashed),
  {email:'master@example.com',phone:'5515981817336'});
 assert.throws(()=>validateMasterConfig('master@example.com','15981817336','plain password'),/invalid/);
 assert.throws(()=>validateMasterConfig('invalid','15981817336',hashed),/invalid/);
 assert.throws(()=>validateMasterConfig('master@example.com','551',hashed),/invalid/);
});
