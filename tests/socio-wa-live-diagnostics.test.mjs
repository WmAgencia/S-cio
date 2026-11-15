import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createTestDatabase} from './helpers/test-database.mjs';
import {auditLiveWhatsAppBindings,diagnoseTenantWhatsApp} from '../socio-wa-live-diagnostics.mjs';

const tenantA='11111111-1111-4111-8111-111111111111';
const tenantB='22222222-2222-4222-8222-222222222222';
const env={
 SOCIO_LIVE_SYNC_ENABLED:'true',SOCIO_OUTBOUND_ENABLED:'true',
 SOCIO_AUTOREPLY_ENABLED:'true',WA_AKG_API_KEY:'fake-test-wa-key',
 WA_AKG_BASE_URL:'http://localhost:9000',GROQ_API_KEY:'fake-test-groq-key-long-enough'
};

test('live binding checks only authorized channel numbers; no messages, writes, secrets or session ids',async()=>{
 const calls=[],sessions=[];
 const fakePool={query:async(sql,args)=>{
  calls.push({sql,args});
  assert.match(sql,/^SELECT /);
  if(sql.includes('FROM waakg_links l'))return {rows:[
   {phone:'5515999999999',status:'connected',session_id:'session-test-good'},
   {phone:'5515888888888',status:'connected',session_id:'session-test-other'},
   {phone:'5515777777777',status:'connected',session_id:'session-test-off'}
  ]};
  throw Error('Unexpected database query');
 }};
 const result=await auditLiveWhatsAppBindings(fakePool,{
  tenantId:tenantA,env,getStatus:async id=>{
   sessions.push(id);
   if(id==='session-test-good')return {connected:true,connectedNumber:'5515999999999'};
   if(id==='session-test-other')return {connected:true,connectedNumber:'5515999000000'};
   throw Error('mock network timeout');
  }
 });
 assert.deepEqual(result,{readOnly:true,checkedChannels:3,verified:1,disconnected:0,numberMismatch:1,unreachable:1});
 assert.equal(calls[0].args[0],tenantA);
 assert(sessions.length===3);
 const serialized=JSON.stringify(result);
 assert(!serialized.includes('5515')&&!serialized.includes('session-test'));
});
test('diagnostic reports actual safety gates; defaults to no send and no auto-reply',async()=>{
 const sqls=[];
 const pool={query:async(sql,args)=>{
  sqls.push({sql,args});
  assert.match(sql,/^SELECT /);
  assert.equal(args[0],tenantA);
  if(sql.includes('FROM waakg_links l'))return {rows:[]};
  if(sql.includes("m.direction='inbound'"))return {rows:[{n:0}]};
  if(sql.includes('COUNT(DISTINCT c.id)'))return {rows:[{n:0}]};
  if(sql.includes('FROM agents WHERE'))return {rows:[{enabled:false}]};
  if(sql.includes('FROM conversation_ui_state'))return {rows:[{n:0}]};
  throw Error('Unexpected query '+sql);
 }};
 const report=await diagnoseTenantWhatsApp(pool,{active_tenant_id:tenantA},{env:{
  ...env,SOCIO_OUTBOUND_ENABLED:'false',SOCIO_AUTOREPLY_ENABLED:'false',
  SOCIO_LIVE_SYNC_ENABLED:'false'
 }});
 assert.equal(report.noMessagesSent,true);
 assert.equal(report.noCampaignsChanged,true);
 assert.equal(report.readOnlyGatewayReady,false);
 assert.equal(report.liveReplyTestReady,false);
 assert.equal(report.flags.outboundEnabled,false);
 assert.equal(report.flags.autoReplyEnabled,false);
 assert.equal(report.flags.liveSyncEnabled,false);
 assert(report.blockers.length>=5);
 assert(sqls.length===5);
 await assert.rejects(diagnoseTenantWhatsApp(pool,{active_tenant_id:'not-a-tenant'}),/Empresa inválida/);
});

test('PostgreSQL: live diagnostics never count sessions, messages or owners from another company',{
 skip:!process.env.DATABASE_URL,timeout:80000
},async t=>{
 const fixture=await createTestDatabase('socio_wa_live_');
 const pool=new Pool({connectionString:fixture.url.href,max:2});
 t.after(async()=>{await pool.end().catch(()=>{});await fixture.drop();});
 const tenant1=randomUUID(),tenant2=randomUUID(),channel1=randomUUID(),channel2=randomUUID();
 const conversation1=randomUUID(),conversation2=randomUUID();
 const phone1='5515888000011',phone2='5515888000022';
 for(const [tenant,name] of [[tenant1,'Empresa A'],[tenant2,'Empresa B']]){
  await pool.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,$2,$3,'active')",
   [tenant,name,'audit-live-'+tenant.slice(0,8)]);
 }
 for(const [tenant,channel,phone,session] of [
  [tenant1,channel1,'5515999000011','socio_test_live_001'],
  [tenant2,channel2,'5515999000022','socio_test_live_002']
 ]){
  await pool.query(
   "INSERT INTO channels(id,tenant_id,label,phone,provider,status) "+
   "VALUES($1,$2,'Conectado',$3,'waakg','connected')",[channel,tenant,phone]);
  await pool.query('INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES($1,$2,$3,$4)',
   [randomUUID(),tenant,channel,session]);
 }
 for(const [tenant,channel,conv,phone] of [
  [tenant1,channel1,conversation1,phone1],[tenant2,channel2,conversation2,phone2]
 ]){
  await pool.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role,phone) "+
   "VALUES($1,$2,$3,'Proprietário','fake','owner',$4)",[
   randomUUID(),tenant,'owner-'+tenant.slice(0,8)+'@example.test',phone]);
  await pool.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) "+
   "VALUES($1,$2,$3,$4)",[conv,tenant,channel,phone]);
  await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) "+
   "VALUES($1,$2,$3,'inbound','Mensagem interna de teste')",[randomUUID(),tenant,conv]);
 }
 await pool.query('INSERT INTO agents(tenant_id,enabled) VALUES($1,true),($2,false)',[tenant1,tenant2]);
 const calls=[];
 const getStatus=async session=>{
  calls.push(session);
  return {connected:true,connectedNumber:session==='socio_test_live_001'?'5515999000011':'5515999000022'};
 };
 const a=await diagnoseTenantWhatsApp(pool,{active_tenant_id:tenant1},{env,getStatus});
 assert.deepEqual({gateway:a.gateway.verified,inbound:a.inboundLast24h,
  internal:a.internalOwnerConversations,agent:a.flags.agentEnabled,read:a.readOnlyGatewayReady},
 {gateway:1,inbound:1,internal:1,agent:true,read:true});
 assert.deepEqual(calls,['socio_test_live_001']);
 const b=await diagnoseTenantWhatsApp(pool,{active_tenant_id:tenant2},{env,getStatus});
 assert.equal(b.gateway.verified,1);
 assert.equal(b.inboundLast24h,1);
 assert.equal(b.flags.agentEnabled,false);
 assert.equal(b.liveReplyTestReady,false);
 assert.deepEqual(calls,['socio_test_live_001','socio_test_live_002']);
 const wrong=await diagnoseTenantWhatsApp(pool,{active_tenant_id:tenant1},{env,getStatus:async()=>({
  connected:true,connectedNumber:'5515999000022'
 })});
 assert.equal(wrong.gateway.numberMismatch,1);
 assert.equal(wrong.gateway.verified,0);
 assert.equal(wrong.liveReplyTestReady,false);
});

test('owner-only diagnostics route and UI do not send or expose WhatsApp credentials',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const module=readFileSync(new URL('../socio-wa-live-diagnostics.mjs',import.meta.url),'utf8');
 const start=server.indexOf("pathname==='/api/waakg/diagnostics'");
 assert(start>=0);
 const route=server.slice(start,start+310);
 assert.match(route,/needRole\(a,\['owner','admin'\]\)/);
 assert.match(route,/assertApiFeature\(a\.features,'\/api\/inbox'\)/);
 assert.match(route,/diagnoseTenantWhatsApp\(pool,a\)/);
 assert.match(ui,/waLiveDiagnostics/);
 assert.match(ui,/Verificar integração agora/);
 assert.match(ui,/Nenhuma mensagem foi enviada/);
 assert.doesNotMatch(module,/sendGatewayMessage|deliverToConversation|gatewayControl|sendGatewayText/);
 assert.match(server,/\[socio wa live binding\]/);
});


test('WhatsApp page checks each live session and never calls a saved connected flag verified',()=>{
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(ui,/data-wa-badge/);
 assert.match(ui,/data-wa-live-count/);
 assert.match(ui,/data-wa-awaiting-count/);
 assert.match(ui,/status\.connected===true/);
 assert.match(ui,/badge\.textContent=online\?'Conectado agora':'Desconectado'/);
 assert.match(ui,/Clique em Reconectar e escaneie o QR Code/);
 assert.match(ui,/for\(const button of waButtons\)/);
 assert.match(ui,/await checkWaLive\(button\)/);
 assert.match(ui,/Nenhuma mensagem foi enviada/);
});
