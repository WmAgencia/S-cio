// Verified owner WhatsApp command bridge for the existing WA-AKG private inbox.
// Never accepts group JIDs, external webhooks, customer instructions or anonymous calls.
// Disabled by default, because real WA-AKG outbound / phone identity must be validated.
import {randomUUID} from 'node:crypto';
import {outboundEnabled,deliverToConversation} from './socio-outbound.mjs';
import {speakToAdSkill} from './socio-ad-skills.mjs';

const prefix=/^\s*s[oó]cio(?:[,:\s]+|$)/i;
export const isOwnerSkillCommand=text=>typeof text==='string'&&text.length<=1400&&prefix.test(text);
export const stripOwnerPrefix=text=>String(text||'').replace(prefix,'').trim();
export async function processOwnerSkillInbox(pool,{
 env=process.env,deliver=deliverToConversation,speak=speakToAdSkill,
 enabled=outboundEnabled(env)
}={}){
 if(env.SOCIO_OWNER_COMMANDS_ENABLED!=='true')return {processed:false,reason:'OWNER_COMMANDS_DISABLED'};
 if(!enabled)return {processed:false,reason:'OUTBOUND_NOT_READY'};
 // WA-AKG importer only allows @s.whatsapp.net individual messages.
 // Sender's normalized number must match a CURRENT owner/admin in the SAME tenant.
 // Prefix is required on EVERY request, including "Sócio, pode criar".
 const found=await pool.query(
  "SELECT m.id AS inbound_id,m.tenant_id,m.conversation_id,m.body,"+
  "u.id AS user_id,u.role,u.platform_owner,u.name AS owner_name,"+
  "t.status AS tenant_status,t.features,t.name AS tenant_name "+
  "FROM messages m "+
  "JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id "+
  "JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=m.tenant_id "+
  "AND ch.provider='waakg' AND ch.status='connected' "+
  "JOIN users u ON u.tenant_id=m.tenant_id AND u.active=true "+
  "AND u.role IN ('owner','admin') AND u.phone IS NOT NULL "+
  "AND regexp_replace(u.phone,'[^0-9]','','g')=c.customer_phone "+
  "JOIN tenants t ON t.id=m.tenant_id AND t.status<>'paused' "+
  "WHERE m.direction='inbound' AND m.provider_id LIKE 'waakg:%' "+
  "AND m.created_at>now()-interval '3 minutes' "+
  "AND m.body ~* '^[[:space:]]*s[oó]cio([[:space:],:]|$)' "+
  "AND COALESCE((t.features->>'whatsapp')::boolean,true)=true "+
  "AND COALESCE((t.features->>'meta_ads')::boolean,true)=true "+
  "AND COALESCE((t.features->>'ai')::boolean,true)=true "+
  "AND NOT EXISTS(SELECT 1 FROM socio_owner_skill_receipts r "+
  "WHERE r.tenant_id=m.tenant_id AND r.inbound_message_id=m.id) "+
  "ORDER BY m.created_at,m.id LIMIT 1");
 const row=found.rows[0];
 if(!row)return {processed:false,reason:'NO_AUTHORIZED_OWNER_COMMAND'};
 if(!isOwnerSkillCommand(row.body))return {processed:false,reason:'UNRECOGNIZED_PREFIX'};
 const command=stripOwnerPrefix(row.body);
 const receiptId=randomUUID();
 const inserted=await pool.query(
  "INSERT INTO socio_owner_skill_receipts(id,tenant_id,user_id,conversation_id,inbound_message_id,status) "+
  "VALUES($1,$2,$3,$4,$5,'processing') "+
  "ON CONFLICT(tenant_id,inbound_message_id) DO NOTHING RETURNING id",
  [receiptId,row.tenant_id,row.user_id,row.conversation_id,row.inbound_id]);
 if(!inserted.rowCount)return {processed:false,reason:'ALREADY_CLAIMED'};
 const a={active_tenant_id:row.tenant_id,user_id:row.user_id,role:row.role,
  platform_owner:row.platform_owner,tenant_status:row.tenant_status,
  features:row.features,tenant_name:row.tenant_name};
 let answer;
 try{
  const startOver=/^(nova?\s+campanha|novo\s+pedido|recome[çc]ar)\b/i.test(command);
  const active=startOver?{rows:[]} : await pool.query(
   "SELECT id FROM socio_skill_runs "+
   "WHERE tenant_id=$1 AND user_id=$2 AND origin_conversation_id=$3 "+
   "AND status IN ('collecting','ready') AND expires_at>now() "+
   "ORDER BY updated_at DESC LIMIT 1",
   [row.tenant_id,row.user_id,row.conversation_id]);
  answer=await speak(pool,a,{message:command,runId:active.rows[0]?.id||null},{
   originConversationId:row.conversation_id
  });
 }catch(error){
  answer={status:'failed',runId:null,message:'Não consegui preparar esse pedido: '+
   String(error?.message||'verifique a conexão Meta').slice(0,300)};
 }
 // Mark completion before attempting the WhatsApp send. Never replay an ambiguous send.
 await pool.query(
  "UPDATE socio_owner_skill_receipts SET status='response_ready',run_id=$2,response_text=$3,updated_at=now() "+
  "WHERE id=$1 AND tenant_id=$4",
  [receiptId,answer.runId||null,String(answer.message||'Pedido recebido.').slice(0,1900),row.tenant_id]);
 try{
  const result=await deliver(pool,{
   tenantId:row.tenant_id,conversationId:row.conversation_id,
   userId:row.user_id,mode:'human',text:String(answer.message||'Pedido recebido.').slice(0,1900),
   clientRequestId:receiptId,env
  });
  if(!result.sent)throw Error('WA-AKG did not confirm delivery');
  await pool.query(
   "UPDATE socio_owner_skill_receipts SET status='replied',updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [receiptId,row.tenant_id]);
  return {processed:true,replySent:true,status:answer.status};
 }catch{
  await pool.query(
   "UPDATE socio_owner_skill_receipts SET status='uncertain',updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [receiptId,row.tenant_id]);
  return {processed:true,replySent:false,reason:'DELIVERY_UNCONFIRMED',
   status:answer.status};
 }
}
