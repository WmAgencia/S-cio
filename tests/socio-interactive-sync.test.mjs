import test from 'node:test';
import assert from 'node:assert/strict';
import {pollRecentInteractiveChoices} from '../inbox-interactive-sync.mjs';

test('Priority scan imports a selected WhatsApp button as inbound TEXT and deduplicates it',async()=>{
 const tenant='11111111-1111-4111-8111-111111111111';
 const conversation='22222222-2222-4222-8222-222222222222';
 const jid='5515999999999@s.whatsapp.net';
 let recorded=[],readCalls=0,commits=0;
 const row={tenant_id:tenant,conversation_id:conversation,session_id:'sessionA',
  channel_id:'33333333-3333-4333-8333-333333333333',
  customer_phone:'5515999999999',linked_phone:'5515888888888'};
 const client={query:async(sql,args=[])=>{
  if(sql==='BEGIN')return {rowCount:0,rows:[]};
  if(sql==='COMMIT'){commits++;return {rowCount:0,rows:[]};}
  if(sql.startsWith('INSERT INTO messages')){
   assert.equal(args[1],tenant);
   assert.equal(args[2],conversation);
   assert.equal(args[3],'inbound');
   assert.equal(args[4],'🔘 [Interactive Response] Ver produtos');
   recorded.push(args[5]);
   return {rowCount:recorded.length===1?1:0,rows:recorded.length===1?[{id:args[0]}]:[]};
  }
  if(sql.startsWith('UPDATE conversations'))return {rowCount:1,rows:[]};
  throw Error('Unexpected SQL '+sql);
 },release(){}};
 const pool={connect:async()=>client,query:async(sql)=>{
  assert(sql.includes("o.kind IN ('buttons','product')"));
  assert(sql.includes("ch.provider='waakg'"));
  return {rowCount:1,rows:[row]};
 }};
 const options={getStatus:async()=>({connected:true,connectedNumber:'5515888888888'}),
  read:async(path)=>{
   readCalls++;
   assert(path.includes(encodeURIComponent(jid)));
   return {data:[{remoteJid:jid,keyId:'button-click-1',type:'TEXT',fromMe:false,
    content:'🔘 [Interactive Response] Ver produtos',
    timestamp:new Date(Date.now()-2000).toISOString()}]};
  }};
 const result=await pollRecentInteractiveChoices(pool,options);
 assert.equal(result.imported,1);
 assert.equal(result.checked,1);
 assert.equal(commits,1);
 assert.equal(readCalls,1);
 assert.match(recorded[0],/^waakg:[a-f0-9]{64}$/);
});
test('Priority scan fails closed when a session is disconnected or phone mismatches',async()=>{
 const pool={query:async()=>({rowCount:1,rows:[{
  tenant_id:'11111111-1111-4111-8111-111111111111',
  conversation_id:'22222222-2222-4222-8222-222222222222',
  session_id:'sessionA',customer_phone:'5515999999999',linked_phone:'5515888888888'
 }]})};
 const result=await pollRecentInteractiveChoices(pool,{getStatus:async()=>({
  connected:true,connectedNumber:'5515777777777'
 }),read:async()=>{throw Error('Must not read wrong connected number');}});
 assert.equal(result.checked,0);
 assert.equal(result.imported,0);
});
