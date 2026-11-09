import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {
 MEMORY_RETENTION_DAYS,MEMORY_MAX_BATCHES,MEMORY_BATCH_LIMIT,
 memoryEnabled,sanitizeMemoryState,accumulateMemoryTopics,mergeConversationMemory,
 refreshConversationMemory,readConversationMemory,clearConversationMemory,
 purgeExpiredConversationMemories
} from '../socio-conversation-memory.mjs';
import {analyzeSocioContinuity} from '../socio-prospector-continuity.mjs';

const env={SOCIO_CONVERSATION_MEMORY_ENABLED:'true'};
const tid=()=>randomUUID();

test('memory is opt-in and performs no queries if disabled',async()=>{
 const pool={connect:()=>{throw Error('DB must remain untouched')}};
 assert.equal(memoryEnabled({}),false);
 assert.equal(memoryEnabled(env),true);
 assert.equal(await refreshConversationMemory(pool,{env:{},tenantId:tid(),conversationId:tid()}),null);
 assert.equal(MEMORY_RETENTION_DAYS,30);
 assert(MEMORY_BATCH_LIMIT*MEMORY_MAX_BATCHES<=1000);
});

test('memory accepts only known enum labels, counters and boolean flags',()=>{
 const state=sanitizeMemoryState({
  lastTopic:'phone 5515999999999',
  recentTopics:['payment','senha secreta','support','payment'],
  replyTopics:['price','R$ 550','human'],
  customerTurns:Infinity,hasAssistantReply:'yes',
  rawMessages:'11122233344',apiKey:'SECRET'
 });
 assert.equal(state.lastTopic,'general');
 assert.deepEqual(state.recentTopics,['payment','support']);
 assert.deepEqual(state.replyTopics,['price','human']);
 assert.equal(state.customerTurns,0);
 assert.equal(state.hasAssistantReply,false);
 const str=JSON.stringify(state);
 for(const secret of ['senha secreta','5515999999999','11122233344','SECRET','R$ 550'])assert(!str.includes(secret));
});

test('incremental topics use a bounded list and never store message bodies',()=>{
 let state=accumulateMemoryTopics({},[
  {direction:'inbound',body:'Qual o prazo de entrega?'},
  {direction:'note',body:'Segredo da equipe 12345678909'},
  {direction:'outbound',body:'Ainda não temos prazo confirmado.'},
  {direction:'inbound',body:'Quero saber do pagamento. email cliente@exemplo.com'},
  {direction:'inbound',body:'Não quero comprar agora'}
 ]);
 assert.equal(state.lastCustomerTopic,'payment');
 assert.equal(state.customerTurns,3);
 assert.equal(state.hasAssistantReply,true);
 assert(state.recentTopics.includes('delivery'));
 assert(state.recentTopics.includes('payment'));
 assert(!state.recentTopics.includes('sale'));
 const str=JSON.stringify(state);
 for(const secret of ['12345678909','cliente@exemplo.com','Segredo da equipe'])assert(!str.includes(secret));
 for(let i=0;i<150;i++)state=accumulateMemoryTopics(state,[{direction:'inbound',body:i%2?'Preciso de suporte':'Qual é o preço?'}]);
 assert(state.recentTopics.length<=12);
 assert.equal(state.customerTurns,153);
});

test('recalled hints are suggestions only; current context remains authoritative',()=>{
 const prior={recentTopics:['delivery','payment'],lastTopic:'payment',
  replyTopics:['quote'],hasAssistantReply:true,customerTurns:21};
 const recent=analyzeSocioContinuity([{direction:'inbound',body:'Preciso de suporte'}],'Agora é sobre suporte');
 const merged=mergeConversationMemory(prior,recent);
 assert.equal(merged.recalledMemory,true);
 assert.equal(merged.previousTopic,'support');
 assert(merged.recentTopics.includes('payment'));
 assert(merged.recentTopics.includes('support'));
 assert(merged.subjectsMentionedInPreviousReplies.includes('quote'));
 assert.equal(mergeConversationMemory(null,recent),recent);
});

test('invalid UUIDs fail before database access for inspect/clear',async()=>{
 const pool={query:async()=>{throw Error('should not query')},connect:()=>{throw Error('should not connect')}};
 await assert.rejects(readConversationMemory(pool,{tenantId:'invalid',conversationId:tid()}),{status:422});
 await assert.rejects(clearConversationMemory(pool,{tenantId:tid(),conversationId:'another-company'}),{status:422});
 await assert.rejects(refreshConversationMemory(pool,{tenantId:'invalid',conversationId:tid(),env}),{status:422});
});

test('API, worker and inbox expose tenant-controlled memory without bypassing existing sends',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ai=readFileSync(new URL('../ai-replies.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 const migration=readFileSync(new URL('../supabase/migrations/20261109_socio_conversation_memory.sql',import.meta.url),'utf8');
 assert.match(server,/pathname\.match\(\/\^\\\/api\\\/conversations/);
 assert.match(server,/requirePermission\(a,'training\.manage'\)/);
 assert.match(server,/clearConversationMemory\(pool/);
 assert.match(server,/purgeExpiredConversationMemories\(pool\)/);
 assert.match(ai,/memoryEnabled\(env\)/);
 assert.match(ai,/refreshConversationMemory\(pool,\{tenantId:m\.tenant_id,conversationId:m\.conversation_id,env\}\)/);
 assert.match(ai,/mergeConversationMemory/);
 assert.match(ai,/canAutoReply\(env\)/);
 assert.match(ai,/deliverToConversation/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS socio_conversation_memory/);
 assert.match(schema,/FOREIGN KEY \(tenant_id,conversation_id\)/);
 assert.match(migration,/REVOKE ALL ON socio_app\.socio_conversation_memory FROM anon,authenticated/);
 assert.match(ui,/data-chat-action="memory-clear"/);
 assert.match(ui,/data-chat-action="memory-status"/);
 assert.match(ui,/window\.confirm/);
 assert.match(app,/canManageMemory:state\.me\.user\.platformOwner/);
});

test('PostgreSQL: memory survives fresh connection, isolates tenants, clears without re-learning old messages',{
 skip:!process.env.DATABASE_URL,timeout:110000
},async()=>{
 const schemaName='socio_memory_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schemaName);
 const db=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schemaName+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const a=tid(),b=tid(),chA=tid(),chB=tid(),cA=tid(),cB=tid();
  await db.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3),($4,$5,$6)',
   [a,'Loja A','memory-a-'+a.slice(0,6),b,'Loja B','memory-b-'+b.slice(0,6)]);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
   "($1,$2,'WA-A','5515990000001','waakg','connected'),($3,$4,'WA-B','5515990000002','waakg','connected')",
   [chA,a,chB,b]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES "+
   "($1,$2,$3,'5515980000001'),($4,$5,$6,'5515980000002')",
   [cA,a,chA,cB,b,chB]);
  const insert=async(tenant,conv,direction,body,minutesAgo)=>
   db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) "+
    "VALUES($1,$2,$3,$4,$5,now() - ($6::int * interval '1 minute'))",
    [tid(),tenant,conv,direction,body,minutesAgo]);
  await insert(a,cA,'inbound','Como funciona a entrega? Meu telefone é 5515999999999',40);
  await insert(a,cA,'outbound','O prazo precisa ser confirmado.',35);
  await insert(a,cA,'inbound','E o pagamento?',30);
  await insert(a,cA,'note','Nota secreta de funcionários',28);
  await insert(b,cB,'inbound','Preciso de um reembolso.',25);

  const [first,second]=await Promise.all([
   refreshConversationMemory(db,{tenantId:a,conversationId:cA,env}),
   refreshConversationMemory(db,{tenantId:a,conversationId:cA,env})
  ]);
  assert.equal(first.processed+second.processed,3,'Two replicas must not double-count same messages');
  let status=await readConversationMemory(db,{tenantId:a,conversationId:cA});
  assert.equal(status.exists,true);
  assert.equal(status.state.customerTurns,2);
  assert(status.state.recentTopics.includes('delivery'));
  assert(status.state.recentTopics.includes('payment'));
  assert.doesNotMatch(JSON.stringify(status.state),/5515999999999|Nota secreta/);
  await assert.rejects(readConversationMemory(db,{tenantId:b,conversationId:cA}),{status:404});
  await assert.rejects(clearConversationMemory(db,{tenantId:b,conversationId:cA}),{status:404});
  const third=await refreshConversationMemory(db,{tenantId:b,conversationId:cB,env});
  assert(third.state.recentTopics.includes('refund'));
  assert(!third.state.recentTopics.includes('payment'));

  const reset=await clearConversationMemory(db,{tenantId:a,conversationId:cA});
  assert.equal(reset.cleared,true);
  assert.equal(reset.originalHistoryPreserved,true);
  const afterReset=await refreshConversationMemory(db,{tenantId:a,conversationId:cA,env});
  assert.equal(afterReset.processed,0);
  assert.deepEqual(afterReset.state.recentTopics,[]);
  await insert(a,cA,'inbound','Preciso de suporte.',0);
  const afterNew=await refreshConversationMemory(db,{tenantId:a,conversationId:cA,env});
  assert.equal(afterNew.processed,1);
  assert.deepEqual(afterNew.state.recentTopics,['support']);
  const intact=await db.query('SELECT COUNT(*)::int AS n FROM messages WHERE tenant_id=$1 AND conversation_id=$2',[a,cA]);
  assert.equal(intact.rows[0].n,5,'Clearing derived memory must not delete WhatsApp messages');

  await db.query("UPDATE socio_conversation_memory SET expires_at=now()-interval '1 second' WHERE tenant_id=$1",[a]);
  const purged=await purgeExpiredConversationMemories(db);
  assert.equal(purged.purged,1);
  const missing=await readConversationMemory(db,{tenantId:a,conversationId:cA});
  assert.equal(missing.exists,false);
  const other=await readConversationMemory(db,{tenantId:b,conversationId:cB});
  assert.equal(other.exists,true);
 }finally{
  await db.end().catch(()=>{});
  await root.query('DROP SCHEMA '+schemaName+' CASCADE').catch(()=>{});
  await root.end();
 }
});
