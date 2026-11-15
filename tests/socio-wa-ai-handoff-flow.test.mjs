import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createTestDatabase} from './helpers/test-database.mjs';
import {processLiveInboxSync} from '../inbox-live-sync.mjs';
import {processNextAiReply} from '../ai-replies.mjs';
import {deliverToConversation} from '../socio-outbound.mjs';

const env={
 SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',
 GROQ_API_KEY:'fake-for-disposable-ci-only-not-real',
 WA_AKG_API_KEY:'fake-disposable-gateway-key',
 WA_AKG_BASE_URL:'http://localhost:12345',
 CHANNEL_ENCRYPTION_KEY:'fake-encryption-key-long-enough-for-test-only-2026',
 SOCIO_CONVERSATION_MEMORY_ENABLED:'false',
 SOCIO_KNOWLEDGE_V3_ENABLED:'false'
};
const session='socio_test_session_0001';
const ownerPhone='5515999000001',clientPhone='5515888000001';
const jid=clientPhone+'@s.whatsapp.net';
const connected=async(id)=>{
 assert.equal(id,session);
 return {connected:true,connectedNumber:ownerPhone};
};
const oldDate=(seconds)=>new Date(Date.now()-seconds*1000).toISOString();
const inbound=(key,body,seconds)=>({
 remoteJid:jid,fromMe:false,keyId:key,content:body,type:'TEXT',
 timestamp:oldDate(seconds)
});
const count=async(pool,tenant,conversation)=>(
 await pool.query('SELECT direction,count(*)::int AS n FROM messages WHERE tenant_id=$1 AND conversation_id=$2 GROUP BY direction',
 [tenant,conversation])).rows.reduce((a,x)=>(a[x.direction]=x.n,a),{});
const replyState=async(pool,tenant,conversation)=>(
 await pool.query('SELECT status,reason FROM ai_reply_attempts WHERE tenant_id=$1 AND conversation_id=$2',
 [tenant,conversation])).rows;

test('WA-AKG mocked read -> tenant-owned inbox -> AI transient failure -> one confirmed send -> human handoff', {
 skip:!process.env.DATABASE_URL,timeout:120000
},async t=>{
 const fixture=await createTestDatabase('socio_wa_ai_flow_');
 const pool=new Pool({connectionString:fixture.url.href,max:3,connectionTimeoutMillis:12000});
 t.after(async()=>{await pool.end().catch(()=>{});await fixture.drop();});
 const tenant=randomUUID(),channel=randomUUID(),user=randomUUID(),conversation=null;
 await pool.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Empresa de Teste',$2,'active')",
 [tenant,'wa-flow-'+tenant.slice(0,8)]);
 await pool.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'Teste','fake','owner')",
 [user,tenant,'owner-wa-flow-'+tenant.slice(0,8)+'@example.test']);
 await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'Canal',$3,'waakg','connected')",
 [channel,tenant,ownerPhone]);
 await pool.query("INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES($1,$2,$3,$4)",
 [randomUUID(),tenant,channel,session]);
 await pool.query("INSERT INTO agents(tenant_id,enabled) VALUES($1,true)",[tenant]);
 const gatewayReads=[],gatewaySends=[];
 let messages=[inbound('incoming-1','Olá, qual é o horário?',180)];
 const sync=async()=>processLiveInboxSync(pool,{
  getStatus:connected,
  listChats:async(id)=>{assert.equal(id,session);return {jids:[jid],names:{[jid]:'Cliente fictício'},partial:false};},
  read:async(path)=>{
   gatewayReads.push(path);
   assert(path.includes('/api/messages/'+session+'/search?'));
   assert(path.includes(encodeURIComponent(jid)));
   return {status:true,data:messages};
  }
 });
 const imported=await sync();
 assert.equal(imported.processed,true);
 assert.equal(imported.imported,1);
 assert(gatewayReads.every(x=>x.startsWith('/api/messages/')));
 const found=await pool.query('SELECT id FROM conversations WHERE tenant_id=$1 AND channel_id=$2',[tenant,channel]);
 assert.equal(found.rowCount,1);const chat=found.rows[0].id;
 assert.deepEqual(await count(pool,tenant,chat),{inbound:1});
 // Agent must be explicitly handed the existing conversation; imported history is not permission.
 assert.equal((await processNextAiReply(pool,{env,respond:async()=>{throw Error('AI started without handoff');}})).processed,false);
 await pool.query(
 "INSERT INTO conversation_ui_state(tenant_id,conversation_id,handling_mode,ai_activated_at) "+
 "VALUES($1,$2,'ai_assist',now()-interval '10 minutes')",
 [tenant,chat]);
 let responseAttempts=0,providerCalls=0;
 const respond=async()=>{
  responseAttempts++;
  if(responseAttempts===1)throw Error('temporary simulated model outage');
  return {reply:'Nossa equipe confirma o horário de atendimento.'};
 };
 const deliver=async(db,args)=>deliverToConversation(db,{
  ...args,getStatus:connected,send:async({jid:destination,sessionId,text})=>{
   assert.equal(destination,jid);assert.equal(sessionId,session);
   assert(text&&typeof text==='string');
   providerCalls++;gatewaySends.push({destination,text});
   return {sent:true,providerId:'remote-message-1'};
  }
 });
 const failed=await processNextAiReply(pool,{env,respond,deliver});
 assert.equal(failed.failed,true,'unexpected AI result: '+JSON.stringify(failed));
 assert.equal(failed.retryScheduled,true);
 assert.deepEqual(await count(pool,tenant,chat),{inbound:1});
 assert.equal(providerCalls,0);
 assert.deepEqual(await replyState(pool,tenant,chat),[{status:'failed',reason:'RETRYABLE_GENERATION_1'}]);
 // Retry should not happen until a real cooldown; move fixture timestamp, never alter server time.
 assert.equal((await processNextAiReply(pool,{env,respond,deliver})).processed,false);
 await pool.query("UPDATE ai_reply_attempts SET finished_at=now()-interval '6 minutes' WHERE tenant_id=$1 AND conversation_id=$2",
 [tenant,chat]);
 const delivered=await processNextAiReply(pool,{env,respond,deliver});
 assert.equal(delivered.sent,true);assert.equal(responseAttempts,2);
 assert.equal(providerCalls,1);
 assert.deepEqual(await count(pool,tenant,chat),{inbound:1,outbound:1});
 assert.deepEqual(await replyState(pool,tenant,chat),[{status:'sent',reason:null}]);
 const duplicate=await sync();assert.equal(duplicate.imported,0);
 const again=await processNextAiReply(pool,{env,respond,deliver});
 assert.equal(again.processed,false);
 assert.equal(providerCalls,1);
 // New inbound arrives AFTER the confirmed AI answer, asking explicitly for a person.
 await pool.query("UPDATE messages SET created_at=now()-interval '75 seconds' WHERE tenant_id=$1 AND conversation_id=$2 AND direction='outbound'",
 [tenant,chat]);
 messages=[...messages,inbound('incoming-2','Quero falar com um atendente humano',25)];
 const second=await sync();assert.equal(second.imported,1);
 const handoff=await processNextAiReply(pool,{env,respond,deliver});
 assert.equal(handoff.handedOff,true);assert.equal(handoff.noMessageSent,true);
 const state=await pool.query('SELECT handling_mode,ai_activated_at FROM conversation_ui_state WHERE tenant_id=$1 AND conversation_id=$2',[tenant,chat]);
 assert.equal(state.rows[0].handling_mode,'human');assert.equal(state.rows[0].ai_activated_at,null);
 assert.equal(providerCalls,1,'Handoff must not send automatic messages');
 assert.deepEqual(await count(pool,tenant,chat),{inbound:2,outbound:1});
 assert.equal((await processNextAiReply(pool,{env,respond,deliver})).processed,false);
 assert.equal(providerCalls,1);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM message_outbox WHERE tenant_id=$1 AND conversation_id=$2",
 [tenant,chat])).rows[0].n,1);
 const sessionCheck=await pool.query("SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND conversation_id=$2 AND direction='outbound'",
 [tenant,chat]);assert.equal(sessionCheck.rows[0].n,1);
});
