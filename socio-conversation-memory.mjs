// Sócio Inteligente: compact, tenant-scoped, durable conversation hints.
// Inspired by Prospector's francisca-conversation-memory.mjs, but the Sócio
// stores only enum topic labels and counters (never excerpts, PII or secrets).
// No customer-facing sends, permissions or factual confirmations are inferred.
import {classifySocioTopic} from './socio-prospector-continuity.mjs';

const ZERO_UUID='00000000-0000-0000-0000-000000000000';
const DAY_MS=86400000;
export const MEMORY_RETENTION_DAYS=30;
export const MEMORY_BATCH_LIMIT=200;
export const MEMORY_MAX_BATCHES=4;
export const SOCIO_MEMORY_VERSION='socio-tenant-topic-memory-v1';
const TOPICS=new Set(['stop','human','complaint','refund','payment','delivery',
 'quote','price','product','scheduling','support','proof','contract','sale','explanation']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const tag=x=>TOPICS.has(x)?x:'general';
const clipCount=x=>Number.isSafeInteger(x)&&x>=0?Math.min(x,999999):0;
const list=x=>Array.isArray(x)?[...new Set(x.filter(t=>TOPICS.has(t)))].slice(-12):[];

export function memoryEnabled(env=process.env){
 return env.SOCIO_CONVERSATION_MEMORY_ENABLED==='true';
}
export function sanitizeMemoryState(value){
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 return {
  version:SOCIO_MEMORY_VERSION,
  lastTopic:tag(v.lastTopic),
  lastCustomerTopic:tag(v.lastCustomerTopic),
  recentTopics:list(v.recentTopics),
  replyTopics:list(v.replyTopics),
  customerTurns:clipCount(v.customerTurns),
  hasAssistantReply:v.hasAssistantReply===true
 };
}
const addTopic=(topics,topic)=>{
 if(topic==='general')return topics;
 return [...topics.filter(x=>x!==topic),topic].slice(-12);
};
export function accumulateMemoryTopics(previous={},messages=[]){
 const state=sanitizeMemoryState(previous);
 for(const row of Array.isArray(messages)?messages:[]){
  if(!row||!['inbound','outbound'].includes(row.direction))continue;
  const topic=classifySocioTopic(row.body);
  if(topic!=='general'){
   state.lastTopic=topic;
   state.recentTopics=addTopic(state.recentTopics,topic);
  }
  if(row.direction==='inbound'){
   state.customerTurns=Math.min(999999,state.customerTurns+1);
   if(topic!=='general')state.lastCustomerTopic=topic;
  }else{
   state.hasAssistantReply=true;
   state.replyTopics=addTopic(state.replyTopics,topic);
  }
 }
 return state;
}
export function mergeConversationMemory(saved,recent){
 if(!saved)return recent;
 const memory=sanitizeMemoryState(saved),r=recent||{};
 // Current conversation and actual user message always win. Historical
 // labels are only context hints, never proof of price, consent or a sale.
 return {
  ...r,
  hasAssistantReply:r.hasAssistantReply===true||memory.hasAssistantReply,
  previousTopic:r.previousTopic&&r.previousTopic!=='general'?r.previousTopic:memory.lastTopic,
  recentTopics:[...new Set([...memory.recentTopics,...(r.recentTopics||[])])].slice(-12),
  subjectsMentionedInPreviousReplies:[
   ...new Set([...memory.replyTopics,...(r.subjectsMentionedInPreviousReplies||[])])
  ].slice(-12),
  recalledMemory:true
 };
}
function checkIdentity(tenantId,conversationId){
 if(!uuid.test(String(tenantId))||!uuid.test(String(conversationId)))
  throw fail(422,'Identificador da conversa inválido.');
}
const iso=x=>new Date(x).toISOString();
const emptyState=()=>sanitizeMemoryState({});
const firstCursor=(now)=>new Date(now.getTime()-MEMORY_RETENTION_DAYS*DAY_MS);
async function tx(pool,task){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const result=await task(client);
  await client.query('COMMIT');
  return result;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
async function lockConversation(client,tenantId,conversationId){
 const conversation=await client.query(
  'SELECT id FROM conversations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
  [tenantId,conversationId]);
 if(!conversation.rowCount)throw fail(404,'Conversa não encontrada.');
}

// Only one transaction per tenant+conversation can advance the cursor;
// row locks plus (created_at,id) prevent duplicate consumption by replicas.
// Initial import scans at most the last 30 days; each call uses <=800 rows.
export async function refreshConversationMemory(pool,{tenantId,conversationId,env=process.env,now=new Date()}={}){
 if(!memoryEnabled(env))return null;
 checkIdentity(tenantId,conversationId);
 const clock=new Date(now);
 if(Number.isNaN(clock.getTime()))throw fail(422,'Data inválida.');
 return tx(pool,async client=>{
  await lockConversation(client,tenantId,conversationId);
  await client.query(
   "INSERT INTO socio_conversation_memory(tenant_id,conversation_id,state,seen_created_at,seen_message_id) "+
   "VALUES($1,$2,'{}'::jsonb,$3,$4) ON CONFLICT(tenant_id,conversation_id) DO NOTHING",
   [tenantId,conversationId,iso(firstCursor(clock)),ZERO_UUID]);
  const locked=await client.query(
   'SELECT state,seen_created_at,seen_message_id,expires_at FROM socio_conversation_memory '+
   'WHERE tenant_id=$1 AND conversation_id=$2 FOR UPDATE',[tenantId,conversationId]);
  const row=locked.rows[0];
  const expired=new Date(row.expires_at).getTime()<=clock.getTime();
  let state=expired?emptyState():sanitizeMemoryState(row.state);
  let seenAt=expired?new Date(row.expires_at):new Date(row.seen_created_at||firstCursor(clock));
  let seenId=expired?ZERO_UUID:row.seen_message_id||ZERO_UUID;
  let processed=0;
  for(let batch=0;batch<MEMORY_MAX_BATCHES;batch++){
   const messages=await client.query(
    'SELECT id,created_at,direction,body FROM messages '+
    "WHERE tenant_id=$1 AND conversation_id=$2 AND direction IN ('inbound','outbound') "+
    'AND (created_at,id)>($3::timestamptz,$4::uuid) '+
    'ORDER BY created_at ASC,id ASC LIMIT $5',
    [tenantId,conversationId,iso(seenAt),seenId,MEMORY_BATCH_LIMIT]);
   if(!messages.rowCount)break;
   state=accumulateMemoryTopics(state,messages.rows);
   const last=messages.rows.at(-1);
   seenAt=new Date(last.created_at);
   seenId=last.id;
   processed+=messages.rowCount;
   if(messages.rowCount<MEMORY_BATCH_LIMIT)break;
  }
  if(processed||expired){
   await client.query(
    'UPDATE socio_conversation_memory SET state=$3::jsonb,seen_created_at=$4,seen_message_id=$5,'+
    "updated_at=now(),expires_at=now()+interval '30 days' "+
    'WHERE tenant_id=$1 AND conversation_id=$2',
    [tenantId,conversationId,JSON.stringify(state),iso(seenAt),seenId]);
  }
  return {state,processed,retentionDays:MEMORY_RETENTION_DAYS};
 });
}
export async function readConversationMemory(pool,{tenantId,conversationId}={}){
 checkIdentity(tenantId,conversationId);
 const c=await pool.query('SELECT id FROM conversations WHERE tenant_id=$1 AND id=$2',
  [tenantId,conversationId]);
 if(!c.rowCount)throw fail(404,'Conversa não encontrada.');
 const r=await pool.query(
  'SELECT state,updated_at,expires_at FROM socio_conversation_memory '+
  'WHERE tenant_id=$1 AND conversation_id=$2 AND expires_at>now()',
  [tenantId,conversationId]);
 return {
  enabled:memoryEnabled(),exists:Boolean(r.rowCount),
  state:r.rowCount?sanitizeMemoryState(r.rows[0].state):emptyState(),
  updatedAt:r.rows[0]?.updated_at||null,
  expiresAt:r.rows[0]?.expires_at||null
 };
}
// "Clear" never removes the original WhatsApp history; it resets derived
// labels and advances the high-water mark so old messages are not re-learned.
export async function clearConversationMemory(pool,{tenantId,conversationId}={}){
 checkIdentity(tenantId,conversationId);
 return tx(pool,async client=>{
  await lockConversation(client,tenantId,conversationId);
  const last=await client.query('SELECT id,created_at FROM messages '+
   "WHERE tenant_id=$1 AND conversation_id=$2 AND direction IN ('inbound','outbound') "+
   'ORDER BY created_at DESC,id DESC LIMIT 1',[tenantId,conversationId]);
  const seenAt=last.rows[0]?.created_at||new Date();
  const seenId=last.rows[0]?.id||ZERO_UUID;
  await client.query(
   'INSERT INTO socio_conversation_memory(tenant_id,conversation_id,state,seen_created_at,seen_message_id,updated_at,expires_at) '+
   "VALUES($1,$2,'{}'::jsonb,$3,$4,now(),now()+interval '30 days') "+
   "ON CONFLICT(tenant_id,conversation_id) DO UPDATE SET state='{}'::jsonb,"+
   "seen_created_at=EXCLUDED.seen_created_at,seen_message_id=EXCLUDED.seen_message_id,"+
   'updated_at=now(),expires_at=EXCLUDED.expires_at',
   [tenantId,conversationId,iso(seenAt),seenId]);
  return {cleared:true,originalHistoryPreserved:true};
 });
}
// Physical removal of expired topic summaries. Called periodically even when
// auto replies are disabled; on reactivation only <=30-day history is scanned.
export async function purgeExpiredConversationMemories(pool){
 const result=await pool.query('DELETE FROM socio_conversation_memory WHERE expires_at<now()');
 return {purged:result.rowCount};
}
