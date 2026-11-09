import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {runVideoPilotOnce} from '../socio-whatsapp-meta-video-pilot.mjs';

test('PostgreSQL: one-off pilot binds real tenant owner, live channel, selected Meta grant and never duplicates', {
 skip:!process.env.DATABASE_URL,timeout:100000
},async()=>{
 const schema='socio_video_pilot_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{
  await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const a=randomUUID(),b=randomUUID(),u=randomUUID(),u2=randomUUID(),ch=randomUUID(),ch2=randomUUID(),op=randomUUID();
  const email=id=>id.slice(0,8)+'@example.test';
  await pool.query("INSERT INTO tenants(id,name,slug,status) VALUES "+
   "($1,'Empresa Um',$2,'active'),($3,'Empresa Dois',$4,'active')",
   [a,'video-one-'+a.slice(0,8),b,'video-two-'+b.slice(0,8)]);
  await pool.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role,active) "+
   "VALUES($1,$2,$3,'Owner','hash','owner',true),"+
   "($4,$5,$6,'Outra empresa','hash','owner',true)",
   [u,a,email(u),u2,b,email(u2)]);
  await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) "+
   "VALUES($1,$2,'Ativo','5515981732994','waakg','connected'),"+
   "($3,$4,'Outro','5515981732994','waakg','connected')",[ch,a,ch2,b]);
  await pool.query("INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) "+
   "VALUES($1,$2,$3,'video_test_session_1'),($4,$5,$6,'video_test_session_2')",
   [randomUUID(),a,ch,randomUUID(),b,ch2]);
  await pool.query("INSERT INTO meta_official_grants"+
   "(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at) "+
   "VALUES($1,$2,'meta-user-test','not-a-real-token',ARRAY['ads_read','ads_management'],now()+interval '2 days')",
   [a,u]);
  await pool.query("INSERT INTO meta_official_account_selections "+
   "(tenant_id,user_id,account_id,account_name,currency) "+
   "VALUES($1,$2,'act_1347914770832022','Consecom','BRL')",[a,u]);
  const env={SOCIO_WA_VIDEO_PILOT_ONCE:'true',SOCIO_WA_VIDEO_PILOT_ID:op,
   SOCIO_WA_VIDEO_PILOT_SOURCE:'5515981732994',
   SOCIO_WA_VIDEO_PILOT_DESTINATION:'15981817336',
   SOCIO_WA_VIDEO_PILOT_ACCOUNT:'act_1347914770832022',
   SOCIO_WA_VIDEO_PILOT_CUTOFF:'2026-11-09T19:40:30Z'};
  const now=Date.parse('2026-11-09T20:10:00Z');
  let found=0,imports=0;
  const opts={env,now,find:async(_db,actor,input)=>{
   found++;assert.equal(actor.active_tenant_id,a);
   assert.equal(actor.user_id,u);assert.equal(input.channelId,ch);
   return {video:{messageId:'3EB048D82AE3F9417E9BB4'}};
  },importVideo:async(_db,actor,input)=>{
   imports++;assert.equal(actor.active_tenant_id,a);
   assert.equal(input.recipientPhone,'5515981817336');
   assert.equal(input.confirmed,true);
   return {status:'uploaded',videoId:'1824013938791734',accountId:env.SOCIO_WA_VIDEO_PILOT_ACCOUNT};
  }};
  const first=await runVideoPilotOnce(pool,opts);
  assert.equal(first.reason,'PILOT_UPLOADED');
  assert.equal(found,1);assert.equal(imports,1);
  const second=await runVideoPilotOnce(pool,opts);
  assert.equal(second.reason,'PILOT_ALREADY_ATTEMPTED');
  assert.equal(found,1);assert.equal(imports,1);
  const state=await pool.query("SELECT tenant_id,channel_id,status,meta_video_id FROM socio_whatsapp_meta_video_pilot_jobs WHERE id=$1",[op]);
  assert.equal(state.rows[0].tenant_id,a);
  assert.equal(state.rows[0].channel_id,ch);
  assert.equal(state.rows[0].status,'uploaded');
  assert.equal(state.rows[0].meta_video_id,'1824013938791734');
  const audit=await pool.query("SELECT actor_id,metadata FROM audit WHERE tenant_id=$1 AND action='marketing.official.video.pilot'",[a]);
  assert.equal(audit.rowCount,1);
  assert.equal(audit.rows[0].actor_id,u);
  assert.equal(audit.rows[0].metadata.operationId,op);
  assert(!JSON.stringify(audit.rows[0].metadata).includes('15981817336'));
 }finally{
  await pool.end().catch(()=>{});
  await root.query('DROP SCHEMA '+schema+' CASCADE').catch(()=>{});
  await root.end();
 }
});
