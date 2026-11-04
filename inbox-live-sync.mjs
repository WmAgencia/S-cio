// Incremental inbox sync for verified connected, tenant-bound WhatsApp sessions.
// Does not prospect, send, or create contacts outside WhatsApp's existing chats.
import {createHash,randomUUID} from 'node:crypto';
import {gatewayRead,getSessionStatus,listAvailableChats,privateJid} from './waakg-adapter.mjs';
import {normalizeInboxRemoteText} from './inbox-api.mjs';
let channelCursor=0;
const chatCursor=new Map();
export async function processLiveInboxSync(pool,{
 getStatus=getSessionStatus,listChats=listAvailableChats,read=gatewayRead,maxChats=3
}={}){
 const channels=await pool.query(
  "SELECT l.session_id,l.channel_id,l.tenant_id,ch.phone FROM waakg_links l "+
  "JOIN channels ch ON ch.id=l.channel_id AND ch.tenant_id=l.tenant_id "+
  "WHERE ch.provider='waakg' AND ch.status='connected' "+
  "ORDER BY l.created_at LIMIT 50");
 if(!channels.rowCount)return {processed:false,reason:'NO_CHANNELS'};
 const c=channels.rows[channelCursor++%channels.rows.length];
 let online;
 try{online=await getStatus(c.session_id);}
 catch{return {processed:false,reason:'GATEWAY_UNAVAILABLE'};}
 if(!online.connected||online.connectedNumber!==String(c.phone||'').replace(/\D/g,''))
  return {processed:false,reason:'NOT_CONNECTED'};
 let list;
 try{list=await listChats(c.session_id);}
 catch{return {processed:false,reason:'CHAT_LIST_UNAVAILABLE'};}
 if(!list?.jids?.length)return {processed:false,reason:'NO_CHATS'};
 const index=chatCursor.get(c.channel_id)||0;
 const segment=list.jids.slice(index,index+Math.max(1,Math.min(5,maxChats)));
 chatCursor.set(c.channel_id,index+segment.length>=list.jids.length?0:index+segment.length);
 let scanned=0,imported=0;
 for(const jid of segment){
  if(!privateJid(jid)||!jid.endsWith('@s.whatsapp.net'))continue;
  const phone=jid.split('@')[0];
  let data;
  try{
   const params=new URLSearchParams({jid,limit:'100',page:'1'});
   data=(await read('/api/messages/'+encodeURIComponent(c.session_id)+'/search?'+params)).data;
   if(!Array.isArray(data))continue;
  }catch{continue;}
  const messages=normalizeInboxRemoteText(data,jid),name=String(list.names?.[jid]||'').slice(0,100);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const conv=await client.query(
    "INSERT INTO conversations(id,tenant_id,channel_id,customer_phone,customer_name) "+
    "VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,channel_id,customer_phone) "+
    "DO UPDATE SET customer_name=CASE WHEN conversations.customer_name='' THEN EXCLUDED.customer_name ELSE conversations.customer_name END RETURNING id",
    [randomUUID(),c.tenant_id,c.channel_id,phone,name]);
   const conversationId=conv.rows[0].id;
   for(const m of messages){
    const stable=createHash('sha256').update(c.session_id+':'+jid+':'+m.identity).digest('hex');
    const result=await client.query(
     "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) "+
     "VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,provider_id) DO NOTHING RETURNING id",
     [randomUUID(),c.tenant_id,conversationId,m.direction,m.body,'waakg:'+stable,m.created_at]);
    imported+=result.rowCount;
   }
   if(messages.length)await client.query(
    "UPDATE conversations SET last_message_at=GREATEST(last_message_at, "+
    "(SELECT MAX(created_at) FROM messages WHERE tenant_id=$1 AND conversation_id=$2)) "+
    "WHERE tenant_id=$1 AND id=$2",[c.tenant_id,conversationId]);
   await client.query('COMMIT');scanned++;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }
 return {processed:true,scanned,imported,partial:!!list.partial};
}
