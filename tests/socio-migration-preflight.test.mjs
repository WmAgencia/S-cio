import test from 'node:test';
import assert from 'node:assert/strict';
import {TABLES,checkMigrationConfiguration,compareTableShape,fingerprintRow} from '../scripts/socio-supabase-migrate.mjs';
import {validateMasterConfig} from '../scripts/socio-provision-master.mjs';

test('Sócio migration covers all 38 production tables in dependency order',()=>{
 assert.equal(TABLES.length,38);
 assert.equal(new Set(TABLES).size,TABLES.length);
 for(const [parent,child] of [['tenants','users'],['tenants','products'],['channels','conversations'],
  ['conversations','messages'],['users','instagram_oauth_states'],['users','marketing_connections'],['users','marketing_oauth_attempts'],['users','marketing_oauth_grants'],['users','instagram_hosted_profiles'],['marketing_connections','marketing_report_receipts'],['marketing_connections','marketing_daily_metrics'],['channels','instagram_accounts'],['conversations','instagram_outbox'],['training_jobs','training_job_items'],
  ['training_jobs','training_versions'],['imports','training_job_items'],
  ['waakg_scans','waakg_scan_chats'],['products','product_variants'],['conversations','conversation_ui_state'],['messages','message_ui_state'],['messages','ai_reply_attempts'],['conversations','message_outbox'],['conversations','sales_quotes'],['sales_quotes','sales_orders'],['sales_orders','sales_payment_events'],['messages','quote_requests']]){
  assert.ok(TABLES.indexOf(parent)<TABLES.indexOf(child),parent+' must be inserted before '+child);
 }
});
test('migration preflight refuses same database, missing URL or non-Supabase destination',()=>{
 const source='postgresql://source:pw@railway.internal:5432/railway';
 const target='postgresql://backend:pw@db.example.supabase.co:5432/postgres?sslmode=require';
 assert.equal(checkMigrationConfiguration(source,target),true);
 assert.throws(()=>checkMigrationConfiguration(source,source),/different databases/);
 assert.throws(()=>checkMigrationConfiguration(
  'postgresql://admin:a@db.example.supabase.co:5432/postgres',
  'postgresql://other:b@db.other.supabase.co:5432/postgres'),/Source must not be a Supabase/);
 assert.throws(()=>checkMigrationConfiguration(
  'postgresql://admin:a@db.example.supabase.co:5432/postgres',
  'postgresql://other:b@db.example.supabase.co:5432/postgres'),/different databases/);

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

test('migration rejects missing columns and a different primary key before any data copy',()=>{
 const c=[{column_name:'id',data_type:'uuid',udt_name:'uuid',is_nullable:'NO'}];
 assert.deepEqual(compareTableShape('users',c,c,['id'],['id']),['id']);
 assert.throws(()=>compareTableShape('users',c,[{...c[0],is_nullable:'YES'}],['id'],['id']),/schema drift/);
 assert.throws(()=>compareTableShape('users',c,c,['id'],['tenant_id']),/Primary key/);
});
test('fingerprint is invariant to JSON property order but tracks content changes',()=>{
 const first={id:'1111',details:{z:10,a:5},date:new Date('2026-11-04T12:00:00Z')};
 const reordered={date:new Date('2026-11-04T12:00:00Z'),details:{a:5,z:10},id:'1111'};
 assert.equal(fingerprintRow(first),fingerprintRow(reordered));
 assert.notEqual(fingerprintRow(first),fingerprintRow({...first,details:{...first.details,z:11}}));
});
