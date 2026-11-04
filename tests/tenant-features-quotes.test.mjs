import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client,Pool} from 'pg';
import {DEFAULT_TENANT_FEATURES,RECOMMENDED_NEW_FEATURES,normalizeTenantFeatures,tenantFeatureEnabled,
 effectiveTenantPermissions,featureForPath,assertTenantFeature} from '../tenant-features.mjs';
import {isQuoteIntent,processQuoteInterest,listQuoteRequests,configureQuoteAlerts,
 updateQuoteRequest,processOwnerQuoteAlert} from '../quote-requests.mjs';

test('company modules are explicit, constrained and enforced on both permissions and backend paths',()=>{
 assert.equal(Object.keys(DEFAULT_TENANT_FEATURES).length,5);
 assert.equal(RECOMMENDED_NEW_FEATURES.sales,false);
 assert.deepEqual(normalizeTenantFeatures(undefined),DEFAULT_TENANT_FEATURES);
 assert.deepEqual(normalizeTenantFeatures(RECOMMENDED_NEW_FEATURES),RECOMMENDED_NEW_FEATURES);
 for(const invalid of [{sales:true,whatsapp:false,catalog:true,ai:true,metaAds:false},
  {sales:true,whatsapp:true,catalog:false,ai:true,metaAds:false},
  {sales:true,whatsapp:true,catalog:true,ai:true,metaAds:true,security:false},[],{}]){
  assert.throws(()=>normalizeTenantFeatures(invalid),/funcionalidades|precisam/);
 }
 assert.throws(()=>normalizeTenantFeatures(undefined,{fallback:null}),/Selecione/);
 const restricted={whatsapp:false,catalog:true,sales:false,ai:true,metaAds:false};
 assert.equal(tenantFeatureEnabled(restricted,'whatsapp'),false);
 assert.equal(tenantFeatureEnabled(undefined,'metaAds'),true,'existing tenants unchanged');
 assert.deepEqual(effectiveTenantPermissions(['inbox.read','catalog.read','sales.read','marketing.read','training.manage','audit.read'],restricted),
  ['catalog.read','training.manage','audit.read']);
 assert.equal(featureForPath('/api/marketing/oauth/start'),'metaAds');
 assert.equal(featureForPath('/api/quote-requests'),'sales');
 assert.equal(featureForPath('/api/products/123/media'),'catalog');
 assert.equal(featureForPath('/api/training/auto'),'ai');
 assert.equal(featureForPath('/api/waakg/channels'),'whatsapp');
 assert.equal(featureForPath('/api/admin/tenants'),null);
 assert.throws(()=>assertTenantFeature(restricted,'sales'),e=>e.status===403);
});
test('request detection is conservative, Portuguese-aware and does not invent a price',()=>{
 for(const input of ['Pode fazer um orçamento?', 'preciso de cotação', 'quanto custa o serviço?',
  'Qual seria o valor?', 'Me passa o preço','pode orçar a troca de pneus?']){
  assert.equal(isQuoteIntent(input),true,input);
 }
 for(const input of ['Olá!', 'Não quero orçamento.', 'Sem necessidade de orçamento.',
  'quero cancelar o atendimento','Faça um pix agora','quero comprar sem cotação']){
  assert.equal(isQuoteIntent(input),false,input);
 }
});
test('disposable Postgres: owner opt-in, AI-only quote requests, tenant isolation, no client proposal and one WhatsApp alert',
 {skip:!process.env.DATABASE_URL,timeout:85000},async t=>{
 const name='socio_quote_audit_'+randomBytes(5).toString('hex');
 const base=new URL(process.env.DATABASE_URL),target=new URL(base);
 target.pathname='/'+name;
 const admin=new Client({connectionString:base.href});await admin.connect();
 await admin.query('CREATE DATABASE '+name);
 const pool=new Pool({connectionString:target.href});
 t.after(async()=>{await pool.end().catch(()=>{});await admin.query('DROP DATABASE IF EXISTS '+name).catch(()=>{});await admin.end()});
 await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 const tenant=randomUUID(),otherTenant=randomUUID(),owner=randomUUID(),otherOwner=randomUUID(),
  channel=randomUUID(),conversation=randomUUID(),inbound=randomUUID(),otherChannel=randomUUID();
 const auth={active_tenant_id:tenant,tenant_id:tenant,user_id:owner,role:'owner'};
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Oficina A','oficina-a'),($2,'Oficina B','oficina-b')",[tenant,otherTenant]);
 await pool.query("INSERT INTO users(id,tenant_id,name,email,phone,password_hash,role) VALUES "+
  "($1,$2,'Dono A','owner-quote-a@sample.test','5515888888888','fixture','owner'),"+
  "($3,$4,'Dono B','owner-quote-b@sample.test','5515777777777','fixture','owner')",
  [owner,tenant,otherOwner,otherTenant]);
 await pool.query("INSERT INTO agents(tenant_id,enabled) VALUES($1,true),($2,true)",[tenant,otherTenant]);
 await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
  "($1,$2,'Equipe A','5515999999999','waakg','connected'),"+
  "($3,$4,'Equipe B','5515666666666','waakg','connected')",
  [channel,tenant,otherChannel,otherTenant]);
 await pool.query("INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES($1,$2,$3,'socioFixture123')",[randomUUID(),tenant,channel]);
 await pool.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) "+
  "VALUES($1,$2,$3,'Cliente interesse','5515111111111')",[conversation,tenant,channel]);
 await pool.query("INSERT INTO conversation_ui_state(tenant_id,conversation_id,handling_mode,ai_activated_at) "+
  "VALUES($1,$2,'ai_assist',now()-interval '1 hour')",[tenant,conversation]);
 const env={SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'sample-fixture-only-key',
  WA_AKG_BASE_URL:'https://gateway.example.test'};
 await assert.rejects(configureQuoteAlerts(pool,{...auth,role:'admin'},true,{env}),e=>e.status===403);
 const choice=await configureQuoteAlerts(pool,auth,true,{env});
 assert.equal(choice.enabled,true);
 await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) "+
  "VALUES($1,$2,$3,'inbound','Poderiam fazer um orçamento para trocar os pneus?')",
  [inbound,tenant,conversation]);
 const created=await processQuoteInterest(pool);
 assert.equal(created.processed,true);
 assert.equal(created.alertPending,true);
 assert.equal((await processQuoteInterest(pool)).processed,false,'Idempotent inbound request');
 const own=await listQuoteRequests(pool,tenant),foreign=await listQuoteRequests(pool,otherTenant);
 assert.equal(own.pendingCount,1);
 assert.equal(own.requests.length,1);
 assert.equal(own.requests[0].alert_status,'pending');
 assert.equal(foreign.requests.length,0);
 assert(!JSON.stringify(own.alerts).includes('5515888888888'),'Owner number is masked');
 let sends=0,toJid='';
 const delivered=await processOwnerQuoteAlert(pool,{env,
  getStatus:async id=>{assert.equal(id,'socioFixture123');return {connected:true,connectedNumber:'5515999999999'};},
  send:async data=>{sends++;toJid=data.jid;assert(data.text.includes('Pedido de orçamento'));
   assert(!data.text.includes('5515111111111'));return {sent:true,providerId:'fixture-owner-message'};}
 });
 assert.equal(delivered.status,'sent');
 assert.equal(sends,1);
 assert.equal(toJid,'5515888888888@s.whatsapp.net');
 assert.equal((await processOwnerQuoteAlert(pool,{env})).processed,false);
 await assert.rejects(updateQuoteRequest(pool,{active_tenant_id:otherTenant},created.requestId,'done'),e=>e.status===404);
 const updated=await updateQuoteRequest(pool,auth,created.requestId,'preparing');
 assert.equal(updated.status,'preparing');
 await updateQuoteRequest(pool,auth,created.requestId,'done');
 assert.equal((await listQuoteRequests(pool,tenant)).requests[0].status,'done');
 await pool.query("UPDATE tenants SET features=$2::jsonb WHERE id=$1",[tenant,JSON.stringify({...DEFAULT_TENANT_FEATURES,sales:false})]);
 await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) "+
  "VALUES($1,$2,$3,'inbound','Queria outro orçamento agora')",[randomUUID(),tenant,conversation]);
 assert.equal((await processQuoteInterest(pool)).processed,false,'Disabled Sales prevents new AI requests');
 await configureQuoteAlerts(pool,auth,false,{env});
 assert.equal((await listQuoteRequests(pool,tenant)).alerts.enabled,false);
});
