import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {ownerWhatsAppReadiness} from '../socio-owner-skill-readiness.mjs';

test('PostgreSQL: verified owner must belong to the SAME live WA-AKG channel and tenant', {
 skip:!process.env.DATABASE_URL,timeout:110000
},async()=>{
 const schema='socio_wa_gate_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const a=randomUUID(),b=randomUUID(),u1=randomUUID(),u2=randomUUID();
  const live=randomUUID(),stale=randomUUID(),other=randomUUID();
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Empresa A',$2,'active'),($3,'Empresa B',$4,'active')",
   [a,'wa-gate-a-'+a.slice(0,6),b,'wa-gate-b-'+b.slice(0,6)]);
  await db.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role,phone) "+
   "VALUES($1,$2,$3,'Owner A','hash','owner','5515999000001'),"+
   "($4,$5,$6,'Owner B','hash','owner','5515999000002')",
   [u1,a,'owner-a-'+a.slice(0,8)+'@example.test',u2,b,'owner-b-'+b.slice(0,8)+'@example.test']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
   "($1,$2,'Ativo','5515888000001','waakg','connected'),"+
   "($3,$2,'Desligado','5515888000002','waakg','not_connected'),"+
   "($4,$5,'Outra empresa','5515888000003','waakg','connected')",
   [live,a,stale,other,b]);
  await db.query("INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES "+
   "($1,$2,$3,'socio_test_001'),($4,$2,$5,'socio_test_002'),"+
   "($6,$7,$8,'socio_test_003')",
   [randomUUID(),a,live,randomUUID(),stale,randomUUID(),b,other]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) "+
   "VALUES($1,$2,$3,'5515999000001'),($4,$5,$6,'5515999000002')",
   [randomUUID(),a,stale,randomUUID(),b,other]);
  const actor={active_tenant_id:a,user_id:u1,role:'owner',tenant_status:'active',
   features:{meta_ads:true,whatsapp:true,ai:true,quotes:true,catalog:true,team:true}};
  const env={SOCIO_OWNER_COMMANDS_ENABLED:'true',SOCIO_OWNER_MEDIA_ENABLED:'true',
   SOCIO_OWNER_AUDIO_ENABLED:'true',SOCIO_OUTBOUND_ENABLED:'true',
   SOCIO_OWNER_MEDIA_TENANT_ID:a,GROQ_API_KEY:'fake-for-test-01234567890123456789'};
  let verified=0;
  const getStatus=async(session)=>{
   assert.equal(session,'socio_test_001','Never probe sessions of other tenants or stale channels');
   verified++;return {connected:true,connectedNumber:'5515888000001'};
  };
  const blocked=await ownerWhatsAppReadiness(db,actor,{env,getStatus});
  assert.equal(blocked.verifiedOwnerConversations,1);
  assert.equal(blocked.connectedSessions,1);
  assert.equal(blocked.ownerOnConnectedSession,false);
  assert.equal(blocked.textReady,false);
  assert.equal(blocked.photoReady,false);
  assert.equal(verified,1);
  assert(!JSON.stringify(blocked).includes('5515999000002'));
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) "+
   "VALUES($1,$2,$3,'5515999000001')",[randomUUID(),a,live]);
  const ready=await ownerWhatsAppReadiness(db,actor,{env,getStatus});
  assert.equal(ready.verifiedOwnerConversations,2);
  assert.equal(ready.ownerOnConnectedSession,true);
  assert.equal(ready.textReady,true);
  assert.equal(ready.photoReady,true);
  assert.equal(ready.audioReady,true);
 }finally{
  await db.end().catch(()=>{});
  await root.query('DROP SCHEMA '+schema+' CASCADE').catch(()=>{});
  await root.end();
 }
});
