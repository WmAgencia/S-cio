import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,Pool} from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startLocalPairing,claimLocalPairing,authorizeLocalConnector,localHeartbeat,pollLocalJob,finishLocalJob,localConnectionStatus,enqueueLocalJob,getLocalJob,disconnectLocalConnector} from '../meta-local.mjs';
test('real PostgreSQL local relay: one-time enrollment, user/tenant isolation, delivery once, revoke and no cookies',
 {skip:!process.env.DATABASE_URL,timeout:35000},async()=>{
 const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();const name='socio_local_connector_test_'+randomBytes(5).toString('hex');await admin.query('CREATE DATABASE '+name);
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;const pool=new Pool({connectionString:url.href});
 try{
  await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const tenant=randomUUID(),user=randomUUID(),other=randomUUID();
  await pool.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Test','local-relay-test','active')",[tenant]);
  for(const id of [user,other])await pool.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'Fixture','unused','owner')",[id,tenant,id+'@example.test']);
  const a={active_tenant_id:tenant,user_id:user,role:'owner'},b={...a,user_id:other};
  const pairing=await startLocalPairing(pool,a,{SOCIO_PUBLIC_URL:'https://socio-app-production-762c.up.railway.app'});
  const linked=await claimLocalPairing(pool,{code:pairing.pairCode,deviceLabel:'Fixture PC'});
  await assert.rejects(()=>claimLocalPairing(pool,{code:pairing.pairCode,deviceLabel:'Replay'}),{status:403});
  const device=await authorizeLocalConnector(pool,'Bearer '+linked.token);assert.equal(device.user_id,user);assert.equal((await localConnectionStatus(pool,a)).connectionId,linked.connectionId);
  assert.equal((await localConnectionStatus(pool,b)).paired,false);
  await localHeartbeat(pool,device,{sessionPresent:false,browserOpen:true});assert.equal((await localConnectionStatus(pool,a)).browserOpen,true);
  const login=await pollLocalJob(pool,device);assert.equal(login.job.kind,'login');assert.equal((await pollLocalJob(pool,device)).job,null);
  await finishLocalJob(pool,device,{jobId:login.job.id,lease:login.lease,result:{ok:false,sessionPresent:false}});
  await assert.rejects(()=>finishLocalJob(pool,device,{jobId:login.job.id,lease:login.lease,result:{ok:true}}),{status:409});
  const job=await enqueueLocalJob(pool,a,'status',{},'same-key-0001');assert.equal((await enqueueLocalJob(pool,a,'status',{},'same-key-0001')).jobId,job.jobId);
  await assert.rejects(()=>getLocalJob(pool,b,job.jobId),{status:404});
  await assert.rejects(()=>enqueueLocalJob(pool,a,'execute',{plan_id:'a'.repeat(48),allow_writes:true},'write-key-001',{}),{status:403});
  const leased=await pollLocalJob(pool,device);assert.equal(leased.job.id,job.jobId);assert.equal((await pollLocalJob(pool,device)).job,null);
  await pool.query("UPDATE meta_local_jobs SET claimed_at=now()-interval '21 minutes' WHERE id=$1",[job.jobId]);assert.equal((await getLocalJob(pool,a,job.jobId)).uncertain,true);
  await pool.query("UPDATE tenants SET features=jsonb_set(features,'{meta_ads}','false') WHERE id=$1",[tenant]);await assert.rejects(()=>authorizeLocalConnector(pool,'Bearer '+linked.token),{status:403});
  await pool.query("UPDATE tenants SET features=jsonb_set(features,'{meta_ads}','true') WHERE id=$1",[tenant]);
  await disconnectLocalConnector(pool,a);await assert.rejects(()=>authorizeLocalConnector(pool,'Bearer '+linked.token),{status:401});
  const raw=(await pool.query('SELECT token_hash,pair_hash FROM meta_local_connections WHERE id=$1',[linked.connectionId])).rows[0];assert.equal(raw.token_hash,null);assert.equal(raw.pair_hash,null);
 }finally{await pool.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await admin.end();}
});
