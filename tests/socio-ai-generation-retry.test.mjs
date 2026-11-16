import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {processNextAiReply} from '../ai-replies.mjs';

const env={
 SOCIO_OUTBOUND_ENABLED:'true',SOCIO_AUTOREPLY_ENABLED:'true',
 GROQ_API_KEY:'unit-test-groq-key-12345678901',
 WA_AKG_API_KEY:'unit-test-gateway-key-12345678901',WA_AKG_BASE_URL:'http://private'
};
const tenantId='11111111-1111-4111-8111-111111111111';
const conversationId='22222222-2222-4222-8222-222222222222';
const inboundId='33333333-3333-4333-8333-333333333333';
const attemptId='44444444-4444-4444-8444-444444444444';

function fixture({retrying=false}={}){
 const queries=[],updates=[];
 const db={query:async(sql,args=[])=>{
  queries.push({sql,args});
  if(sql.includes('FROM messages m JOIN conversation_ui_state'))return {rowCount:1,rows:[{
   inbound_id:inboundId,body:'Qual é o horário de atendimento?',
   tenant_id:tenantId,conversation_id:conversationId,tenant_name:'Loja',
   agent_name:'Sócio',tone:'Natural',instructions:'Não inventar horários',knowledge_md:''
  }]};
  if(sql.startsWith('INSERT INTO ai_reply_attempts'))
   return {rowCount:1,rows:[{id:attemptId,reason:retrying?'RETRYING_GENERATION_2':null}]};
  if(sql.includes('SELECT direction,body FROM messages'))return {rows:[{direction:'inbound',body:'Qual é o horário de atendimento?'}]};
  if(sql.includes('FROM products WHERE'))return {rows:[]};
  if(sql.startsWith('UPDATE ai_reply_attempts')){updates.push({sql,args});return {rowCount:1,rows:[]};}
  throw Error('Unexpected SQL: '+sql);
 }};
 return {db,queries,updates};
}

test('AI retries a proven generation failure after a bounded cooldown, never an unknown send',async()=>{
 const {db,queries,updates}=fixture();
 let sends=0;
 const r=await processNextAiReply(db,{env,respond:async()=>{throw Error('AI unavailable');},
  deliver:async()=>{sends++;return {sent:true};}});
 assert.equal(r.retryScheduled,true);
 assert.equal(sends,0);
 assert.equal(updates.at(-1).args[2],'RETRYABLE_GENERATION_1');
 const select=queries.find(x=>x.sql.includes('FROM messages m JOIN conversation_ui_state')).sql;
 const claim=queries.find(x=>x.sql.startsWith('INSERT INTO ai_reply_attempts')).sql;
 assert.match(select,/finished_at<now\(\)-interval '5 minutes'/);
 assert.match(claim,/reason='RETRYABLE_GENERATION_1'/);
 assert.match(claim,/DO UPDATE SET status='generating'/);
});

test('AI allows no third generation retry',async()=>{
 const {db,updates}=fixture({retrying:true});
 const r=await processNextAiReply(db,{env,respond:async()=>{throw Error('Still unavailable');},
  deliver:async()=>{throw Error('Must never send');}});
 assert.equal(r.retryScheduled,false);
 assert.equal(updates.at(-1).args[2],'GENERATION_FAILED_FINAL');
});

test('AI does not retry once WhatsApp send has been attempted',async()=>{
 const {db,updates}=fixture();
 let sends=0;
 const r=await processNextAiReply(db,{env,respond:async()=>({reply:'Nossa equipe vai confirmar o horário.'}),
  deliver:async()=>{sends++;throw Error('Uncertain delivery');}});
 assert.equal(sends,1);
 assert.equal(r.retryScheduled,false);
 assert.equal(updates.at(-1).args[2],'SEND_UNCONFIRMED');
});

test('a campaign-only agent never answers an organic conversation',async()=>{
 const source=await readFile(new URL('../ai-replies.mjs',import.meta.url),'utf8');
 assert.match(source,/ag\.campaign_leads_only IS NOT TRUE OR EXISTS\(/);
 assert.match(source,/FROM wa_ctwa_attributions w WHERE w\.tenant_id=m\.tenant_id/);
 const webhook=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(webhook,/ag\.campaign_leads_only=true/);
 assert.match(webhook,/WHERE conversation_ui_state\.handling_mode='human'/);
 assert.match(await readFile(new URL('../schema.sql',import.meta.url),'utf8'),
  /ADD COLUMN IF NOT EXISTS campaign_leads_only boolean NOT NULL DEFAULT false/);
});
