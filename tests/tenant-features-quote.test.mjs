import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client,Pool} from 'pg';
import {
 DEFAULT_FEATURES,FEATURE_KEYS,validateTenantFeatures,parseTenantFeatures,
 filterPermissions,requiredFeatureForApi,assertApiFeature
} from '../tenant-features.mjs';
import {
 isQuoteRequest,scanQuoteRequests,listQuoteRequests,updateQuoteRequest,
 setQuoteAlerts,processNextOwnerQuoteAlert
} from '../quote-requests.mjs';
import {buildAiInstructions} from '../ai-replies.mjs';

const all={...DEFAULT_FEATURES};
test('every module is independently selectable and disabled modules block API requests',()=>{
 assert.equal(FEATURE_KEYS.length,6);
 const flags={...all,quotes:false,meta_ads:false};
 assert.deepEqual(validateTenantFeatures(flags),flags);
 assert.deepEqual(parseTenantFeatures(null),all);
 assert.deepEqual(parseTenantFeatures({quotes:false}).quotes,false);
 for(const path of ['/api/sales','/api/sales/quotes','/api/marketing/oauth/start']){
  assert.throws(()=>assertApiFeature(flags,path),e=>e.status===403);
 }
 assert.equal(requiredFeatureForApi('/api/products/1/media'),'catalog');
 assert.equal(requiredFeatureForApi('/api/inbox'),'whatsapp');
 assert.equal(requiredFeatureForApi('/api/admin/tenants'),null);
 assert.doesNotThrow(()=>assertApiFeature(flags,'/api/products'));
 assert.deepEqual(filterPermissions(['sales.read','catalog.read','marketing.manage','team.manage','platform.manage'],flags),
  ['catalog.read','team.manage','platform.manage']);
 assert.throws(()=>validateTenantFeatures({...all,quotes:true,catalog:false}),e=>e.status===422);
 assert.throws(()=>validateTenantFeatures({...all,quotes:true,whatsapp:false}),e=>e.status===422);
 assert.throws(()=>validateTenantFeatures({...all,quotes:'false'}),e=>e.status===422);
 assert.throws(()=>validateTenantFeatures({...all,unknown:true}),e=>e.status===422);
});
test('quote requests: true requests vs ambiguous/negative messages',()=>{
 for(const s of ['Quero um orçamento','Pode fazer um orçamento?', 'Qual o valor da troca de óleo?',
 'Quanto custa?', 'Me passa a cotação', 'Gostaria de uma cotação', 'Quanto fica a instalação?'])
  assert.equal(isQuoteRequest(s),true,s);
 for(const s of ['Bom dia','Não quero orçamento','Já tenho o orçamento pronto',
 'O valor das nossas amizades é importante','Cancele o orçamento','Tenho uma dúvida'])
  assert.equal(isQuoteRequest(s),false,s);
 const prompt=buildAiInstructions({name:'Sócio',tenantName:'Empresa A',tone:'Curto',
  instructions:'Atenda com respeito',knowledge:'',products:[]});
 assert.match(prompt,/não cria|não cria,|não cria, emite/i);
 assert.match(prompt,/não diga que um aviso no WhatsApp foi enviado/i);
});
test('PostgreSQL: multi-tenant feature configs, quote intake and owner opt-in are isolated',
 {skip:!process.env.DATABASE_URL,timeout:80000},async t=>{
 const name='socio_ui_features_test_'+randomUUID().replace(/-/g,'').slice(0,10);
 const base=new URL(process.env.DATABASE_URL),u=new URL(base);u.pathname='/'+name;
 const admin=new Client({connectionString:base.href});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const pool=new Pool({connectionString:u.href});
 t.after(async()=>{
  await pool.end().catch(()=>{});
  await admin.query('DROP DATABASE IF EXISTS '+name).catch(()=>{});
  await admin.end().catch(()=>{});
 });
 await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 const a=randomUUID(),b=randomUUID(),ua=randomUUID(),ub=randomUUID(),
  chA=randomUUID(),chB=randomUUID(),convA=randomUUID(),convB=randomUUID(),
  msgA=randomUUID(),msgB=randomUUID();
 const flags={...all,quotes:false,meta_ads:false};
 await pool.query('INSERT INTO tenants(id,name,slug,features) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
  [a,'Empresa A','qa-features-a',JSON.stringify(all),b,'Empresa B','qa-features-b',JSON.stringify(flags)]);
 await pool.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role,phone) VALUES"+
  "($1,$2,'feature-owner-a@example.test','Dona A','test','owner','5515999911111'),"+
  "($3,$4,'feature-owner-b@example.test','Dona B','test','owner','5515999922222')",
  [ua,a,ub,b]);
 await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES"+
  "($1,$2,'Empresa A','5515888811111','waakg','connected'),"+
  "($3,$4,'Empresa B','5515888822222','waakg','connected')",
  [chA,a,chB,b]);
 await pool.query("INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES($1,$2,$3,'socioFeatureAlpha')",
  [randomUUID(),a,chA]);
 await pool.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) VALUES"+
  "($1,$2,$3,'Cliente Alice','5515999933333'),($4,$5,$6,'Cliente B','5515999944444')",
  [convA,a,chA,convB,b,chB]);
 await pool.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES"+
  "($1,$2,$3,'inbound','Quero um orçamento da instalação'),"+
  "($4,$5,$6,'inbound','Qual o valor do serviço?')",
  [msgA,a,convA,msgB,b,convB]);
 const intake=await scanQuoteRequests(pool);
 assert.equal(intake.created,1,'No quote request should be recorded for disabled tenant');
 const again=await scanQuoteRequests(pool);assert.equal(again.created,0,'No duplicates');
 const entries=await listQuoteRequests(pool,a);assert.equal(entries.length,1);
 assert.equal(entries[0].customer_name,'Cliente Alice');
 assert.equal((await listQuoteRequests(pool,b)).length,0);
 await assert.rejects(updateQuoteRequest(pool,b,entries[0].id,'resolved'),e=>e.status===404);
 await assert.rejects(setQuoteAlerts(pool,{role:'admin',active_tenant_id:a},true),e=>e.status===403);
 const enabled=await setQuoteAlerts(pool,{role:'owner',active_tenant_id:a},true,{SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'fixture-key',WA_AKG_BASE_URL:'http://localhost'});
 assert.equal(enabled.enabled,true);
 // Simulate the lead arriving AFTER the owner enabled alerts.
 await pool.query("UPDATE quote_requests SET created_at=now()+interval '1 second' WHERE tenant_id=$1",[a]);
 let sent=0;
 const first=await processNextOwnerQuoteAlert(pool,{
  env:{SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'fixture-key',WA_AKG_BASE_URL:'http://localhost'},
  getStatus:async()=>({connected:true,connectedNumber:'5515888811111'}),
  send:async args=>{
   sent++;
   assert.equal(args.jid,'5515999911111@s.whatsapp.net');
   assert.match(args.text,/Cliente Alice/);assert.match(args.text,/revisar a proposta/i);
   return {sent:true,providerId:'fixture-id'};
  }
 });
 assert.equal(first.sent,true);assert.equal(sent,1);
 await processNextOwnerQuoteAlert(pool,{env:{SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'fixture-key',WA_AKG_BASE_URL:'http://localhost'},
  getStatus:async()=>({connected:true,connectedNumber:'5515888811111'}),
  send:async()=>{sent++;return {sent:true,providerId:'bad-double-send'}}});
 assert.equal(sent,1,'Alert must not be sent twice');
 assert.equal((await listQuoteRequests(pool,a))[0].alert_status,'sent');
 assert.equal((await updateQuoteRequest(pool,a,entries[0].id,'resolved')).status,'resolved');
 await setQuoteAlerts(pool,{role:'owner',active_tenant_id:a},false);
 const status=await pool.query('SELECT features,quote_alert_whatsapp FROM tenants WHERE id=$1',[a]);
 assert.equal(status.rows[0].quote_alert_whatsapp,false);
 assert.equal(status.rows[0].features.quotes,true);
});
test('delivery uncertainty leaves an immutable non-retry status',async()=>{
 const reqId=randomUUID(),tenant=randomUUID(),conv=randomUUID();
 let alerted=0;
 const pool={query:async(sql)=>{
  if(sql.startsWith('SELECT q.id'))return {rowCount:1,rows:[{
   id:reqId,tenant_id:tenant,conversation_id:conv,customer_name:'Cliente',summary:'Orçamento?',company_name:'Teste'}]};
  if(sql.startsWith('SELECT phone'))return {rowCount:1,rows:[{phone:'5515999911111'}]};
  if(sql.startsWith('SELECT w.session_id'))return {rowCount:1,rows:[{session_id:'socioFeatureAlpha',phone:'5515888811111'}]};
  if(sql.includes("alert_status='processing'"))return {rowCount:1,rows:[{id:reqId}]};
  if(sql.includes("alert_status='unconfirmed'"))return {rowCount:1,rows:[]};
  throw Error('Unexpected SQL');
 }};
 const out=await processNextOwnerQuoteAlert(pool,{
  env:{SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'fixture',WA_AKG_BASE_URL:'http://localhost'},
  getStatus:async()=>({connected:true,connectedNumber:'5515888811111'}),
  send:async()=>{alerted++;throw Error('ambiguous provider response');}
 });
 assert.equal(out.unconfirmed,true);assert.equal(alerted,1);
});
