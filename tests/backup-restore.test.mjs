import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
test('encrypted backup restores a tenant-isolated fixture into a disposable PostgreSQL database',
 {skip:!process.env.DATABASE_URL,timeout:120000},async t=>{
 const config=new URL(process.env.DATABASE_URL);
 const suffix=randomBytes(5).toString('hex');
 const sourceName='socio_backup_fixture_'+suffix;
 const targetName='socio_restore_test_'+suffix;
 const sourceUrl=new URL(config.href),targetUrl=new URL(config.href);
 sourceUrl.pathname='/'+sourceName;targetUrl.pathname='/'+targetName;
 const temp=await mkdtemp(join(tmpdir(),'socio-backup-'));
 const admin=new Client({connectionString:process.env.DATABASE_URL});
 await admin.connect();
 t.after(async()=>{
  await Promise.allSettled([
   admin.query('DROP DATABASE IF EXISTS '+sourceName+' WITH (FORCE)'),
   admin.query('DROP DATABASE IF EXISTS '+targetName+' WITH (FORCE)')
  ]);
  await admin.end();
  await rm(temp,{recursive:true,force:true});
 });
 await admin.query('CREATE DATABASE '+sourceName);
 await admin.query('CREATE DATABASE '+targetName);
 const fixture=new Client({connectionString:sourceUrl.href});
 await fixture.connect();
 try{
  await fixture.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const tenant1='11111111-1111-4111-8111-111111111111';
  const tenant2='22222222-2222-4222-8222-222222222222';
  const channel='33333333-3333-4333-8333-333333333333';
  const conversation='44444444-4444-4444-8444-444444444444';
  const message='55555555-5555-4555-8555-555555555555';
  for(const [tenant,slug] of [[tenant1,'a'],[tenant2,'b']])
   await fixture.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)',[tenant,'Empresa '+slug,slug]);
  await fixture.query("INSERT INTO channels(id,tenant_id,label,phone,provider) VALUES($1,$2,'Central','5515999999900','manual')",[channel,tenant1]);
  await fixture.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES($1,$2,$3,'5515990000123')",
   [conversation,tenant1,channel]);
  await fixture.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'inbound','Histórico simulado')",
   [message,tenant1,conversation]);
  await fixture.query("INSERT INTO products(id,tenant_id,name,price_cents) VALUES('66666666-6666-4666-8666-666666666666',$1,'Produto',1990)",[tenant2]);
  await assert.rejects(
   fixture.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES('77777777-7777-4777-8777-777777777777',$1,$2,'inbound','Cross tenant')",
    [tenant2,conversation]),
   e=>e.code==='23503','Database must reject cross-tenant messages');
 }finally{await fixture.end();}
 const baseEnv={...process.env,
  DATABASE_URL:sourceUrl.href,
  SOCIO_BACKUP_PASSPHRASE:'only-for-the-ephemeral-ci-fixture-2026',
  SOCIO_BACKUP_DIR:temp,
  SOCIO_BACKUP_CONFIRM:'YES_ENCRYPTED_BACKUP'
 };
 const script=fileURLToPath(new URL('../scripts/socio-encrypted-backup.mjs',import.meta.url));
 const run=(operation,env=baseEnv)=>exec(process.execPath,[script,operation],{env,timeout:45000,maxBuffer:30000});
 const saved=JSON.parse((await run('backup')).stdout);
 assert.equal(saved.ok,true);
 assert.equal(saved.encrypted,true);
 assert(saved.archive.endsWith('.enc'));
 const file=await readFile(saved.archive);
 assert(!file.includes(Buffer.from('Histórico simulado')),'Encrypted archive must not contain raw chat content');
 const good=JSON.parse((await run('verify',{...baseEnv,SOCIO_BACKUP_ARCHIVE:saved.archive})).stdout);
 assert.equal(good.integrityVerified,true);
 const rehearsal=JSON.parse((await run('rehearse',{
  ...baseEnv,SOCIO_BACKUP_ARCHIVE:saved.archive,
  SOCIO_RESTORE_TEST_DATABASE_URL:targetUrl.href,
  SOCIO_RESTORE_CONFIRM:'YES_DISPOSABLE_DATABASE'
 })).stdout);
 assert.equal(rehearsal.rehearsed,true);
 assert.equal(rehearsal.counts.tenants,2);
 assert.equal(rehearsal.counts.channels,1);
 assert.equal(rehearsal.counts.conversations,1);
 const restored=new Client({connectionString:targetUrl.href});
 await restored.connect();
 try{
  const m=await restored.query('SELECT tenant_id,body FROM messages');
  assert.equal(m.rowCount,1);
  assert.equal(m.rows[0].body,'Histórico simulado');
  const p=await restored.query('SELECT tenant_id,name FROM products');
  assert.equal(p.rowCount,1);
  assert.equal(p.rows[0].name,'Produto');
  await assert.rejects(
   restored.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES('88888888-8888-4888-8888-888888888888',$1,$2,'5515900000333')",
    ['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333']),
   e=>e.code==='23503','Tenant FK enforcement must survive restore');
 }finally{await restored.end();}
 await assert.rejects(run('rehearse',{
  ...baseEnv,SOCIO_BACKUP_ARCHIVE:saved.archive,
  SOCIO_RESTORE_TEST_DATABASE_URL:sourceUrl.href,
  SOCIO_RESTORE_CONFIRM:'YES_DISPOSABLE_DATABASE'
 }),/Command failed/,'Never restore to source database');
 await assert.rejects(run('verify',{
  ...baseEnv,SOCIO_BACKUP_ARCHIVE:saved.archive,
  SOCIO_BACKUP_PASSPHRASE:'incorrect-passphrase-also-long-enough'
 }),/Command failed/,'Wrong key must fail before restore');
});
