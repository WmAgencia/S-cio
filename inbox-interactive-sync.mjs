// Fast, bounded polling of conversations with recently sent Native Flow cards.
// Only existing, verified tenant-owned sessions and private contacts are checked.
// Runs alongside the slower full inbox sync so a clicked button is noticed sooner.
import {createHash,randomUUID} from 'node:crypto';
import {gatewayRead,privateJid,getSessionStatus} from './waakg-adapter.mjs';
import {normalizeInboxRemoteText} from './inbox-api.mjs';

export async function pollRecentInteractiveChoices(pool,{
 read=gatewayRead,getStatus=getSessionStatus,limit=4
}={}){
 const n=Math.max(1,Math.min(6,limit));
 const result=await pool.query(
  "SELECT DISTINCT ON (o.tenant_id,o.conversation_id) "+
  "o.tenant_id,o.conversation_id,l.session_id,c.channel_id,c.customer_phone,ch.phone AS linked_phone "+
  "FROM message_outbox o "+
  "JOIN conversations c ON c.tenant_id=o.tenant_id AND c.id=o.conversation_id "+
  "JOIN channels ch ON ch.tenant_id=c.tenant_id AND ch.id=c.channel_id "+
  "JOIN waakg_links l ON l.tenant_id=c.tenant_id AND l.channel_id=c.channel_id "+
  "WHERE o.kind IN ('buttons','product') AND o.status='sent' "+
  "AND o.created_at>=now()-interval '8 minutes' AND ch.provider='waakg' "+
  "AND ch.status='connected' "+
  "ORDER BY o.tenant_id,o.conversation_id,o.created_at DESC LIMIT "+n);
 if(!result.rowCount)return {checked:0,imported:0};
 let checked=0,imported=0;
 const sessionChecked=new Map();
 for(const c of result.rows){
  const jid=c.customer_phone+'@s.whatsapp.net';
  if(!privateJid(jid)||!jid.endsWith('@s.whatsapp.net'))continue;
  let verified=sessionChecked.get(c.session_id);
  if(verified===undefined){
   try{
    const status=await getStatus(c.session_id);
    verified=status.connected&&status.connectedNumber===String(c.linked_phone||'').replace(/\D/g,'');
   }catch{verified=false;}
   sessionChecked.set(c.session_id,verified);
  }
  if(!verified)continue;
  let raw;
  try{
   raw=(await read('/api/messages/'+encodeURIComponent(c.session_id)+'/search?'+
    new URLSearchParams({jid,limit:'50',page:'1'}))).data;
  }catch{continue;}
  const messages=normalizeInboxRemoteText(raw,jid);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   for(const m of messages){
    const key='waakg:'+createHash('sha256').update(c.session_id+':'+jid+':'+m.identity).digest('hex');
    const inserted=await client.query(
     "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) "+
     "VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,provider_id) DO NOTHING RETURNING id",
     [randomUUID(),c.tenant_id,c.conversation_id,m.direction,m.body,key,m.created_at]);
    imported+=inserted.rowCount;
   }
   if(messages.length)await client.query(
    "UPDATE conversations SET last_message_at=GREATEST(last_message_at,"+
    "(SELECT MAX(created_at) FROM messages WHERE tenant_id=$1 AND conversation_id=$2)) "+
    "WHERE tenant_id=$1 AND id=$2",[c.tenant_id,c.conversation_id]);
   await client.query('COMMIT');checked++;
  }catch{await client.query('ROLLBACK').catch(()=>{});}
  finally{client.release();}
 }
 return {checked,imported};
}
