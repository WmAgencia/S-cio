import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getOperationalReadiness} from '../operational-readiness.mjs';
import {processNextAiReply} from '../ai-replies.mjs';
const tenant='11111111-1111-4111-8111-111111111111';
const chat='22222222-2222-4222-8222-222222222222';

test('Operational readiness reports verified WhatsApp vs merely configured Groq',async()=>{
 const calls=[],pool={query:async(sql,params)=>{
  calls.push({sql,params});
  assert.equal(params[0],tenant,'Every readiness query must be tenant-scoped');
  if(sql.includes('FROM channels ch'))return {rowCount:2,rows:[
   {id:'c1',label:'Atendimento',phone:'5515999999999',session_id:'sessionA',status:'connected'},
   {id:'c2',label:'Vendas',phone:'5515888888888',session_id:null,status:'not_connected'}
  ]};
  if(sql.includes('FROM agents'))return {rowCount:1,rows:[{enabled:true}]};
  if(sql.includes('FROM training_versions'))return {rowCount:1,rows:[{status:'approved',version:2}]};
  if(sql.includes('FROM products'))return {rowCount:1,rows:[{n:3}]};
  throw Error('Unrecognized SQL '+sql);
 }};
 const env={GROQ_API_KEY:'unit-test-token-not-a-real-secret-12345',
  GROQ_MODEL:'openai/gpt-oss-120b',WA_AKG_API_KEY:'gateway-unit-test-token-1234',
  WA_AKG_BASE_URL:'http://private',SOCIO_OUTBOUND_ENABLED:'true',
  SOCIO_AUTOREPLY_ENABLED:'true',SOCIO_LIVE_SYNC_ENABLED:'true'};
 let checks=0;
 const report=await getOperationalReadiness(pool,tenant,{env,getStatus:async()=>{
  checks++;return {connected:true,connectedNumber:'5515999999999'};
 }});
 assert.equal(checks,1);
 assert.equal(report.numbers.registered,2);
 assert.equal(report.numbers.verified,1);
 assert.equal(report.groq.configured,true);
 assert.equal(report.groq.tested,false,'Key presence never certifies an API response');
 assert.equal(report.agent.approvedVersion,2);
 assert.equal(report.catalog.activeProducts,3);
 assert.equal(report.checks.find(c=>c.id==='whatsapp').status,'verified');
 assert(calls.every(c=>c.params[0]===tenant));
 assert(!JSON.stringify(report).includes(env.GROQ_API_KEY));
});
test('Readiness is honest when no WhatsApp is linked and no Groq key exists',async()=>{
 const pool={query:async(sql)=>{
  if(sql.includes('FROM channels ch'))return {rowCount:0,rows:[]};
  if(sql.includes('FROM agents'))return {rowCount:1,rows:[{enabled:false}]};
  if(sql.includes('FROM training_versions'))return {rowCount:0,rows:[]};
  if(sql.includes('FROM products'))return {rowCount:1,rows:[{n:0}]};
  throw Error('Unexpected query '+sql);
 }};
 const result=await getOperationalReadiness(pool,tenant,{env:{},getStatus:async()=>{
  throw Error('Must not check nonexistent WhatsApps');
 }});
 assert.equal(result.numbers.verified,0);
 assert.equal(result.groq.configured,false);
 assert.equal(result.flags.aiAutomationConfigured,false);
 assert.equal(result.flags.incrementalSyncConfigured,true,'Live sync is enabled unless explicitly disabled, matching the worker');
 assert(result.checks.every(x=>x.status==='action_required'));
});
test('Groq automatic replies never include staff-only notes in selected history',async()=>{
 const queries=[],sent=[];
 const env={SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',
  GROQ_API_KEY:'unit-test-groq-key-12345678901',
  WA_AKG_API_KEY:'unit-test-gateway-key-12345678901',WA_AKG_BASE_URL:'http://private'};
 const pool={query:async(sql,args=[])=>{
  queries.push(sql);
  if(sql.includes('FROM messages m JOIN conversation_ui_state'))return {rowCount:1,rows:[{
   inbound_id:'33333333-3333-4333-8333-333333333333',
   body:'Olá, qual é o preço?',tenant_id:tenant,conversation_id:chat,
   tenant_name:'Loja',agent_name:'Sócio',tone:'Acolhedor',
   instructions:'Preços somente no catálogo',knowledge_md:''
  }]};
  if(sql.startsWith('INSERT INTO ai_reply_attempts'))return {rowCount:1,rows:[{id:'record'}]};
  if(sql.includes('SELECT direction,body FROM messages'))return {rowCount:2,rows:[
   {direction:'inbound',body:'Qual é o preço?'},{direction:'outbound',body:'Como posso ajudar?'}
  ]};
  if(sql.includes('FROM products WHERE'))return {rowCount:1,rows:[]};
  if(sql.startsWith('UPDATE ai_reply_attempts'))return {rowCount:1,rows:[]};
  throw Error('Unexpected query '+sql);
 }};
 const result=await processNextAiReply(pool,{env,respond:async({input})=>{
  assert(!input.includes('Nota interna:'));
  return {reply:'O valor está disponível em nosso catálogo.'};
 },deliver:async(_db,payload)=>{
  sent.push(payload);return {sent:true};
 }});
 assert.equal(result.sent,true);
 assert.equal(sent.length,1);
 assert(queries.some(q=>q.includes("AND direction IN ('inbound','outbound')")),
  'Staff notes must be filtered in SQL before being passed to Groq');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(ui,/Verificar operação/);
 assert.match(ui,/Testar conexão Groq/);
});
