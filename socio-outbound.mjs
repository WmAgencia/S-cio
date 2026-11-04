// Only sends to existing, tenant-owned connected WA-AKG conversations.
// Every request is idempotent. An ambiguous gateway response is NEVER retried.
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {getSessionStatus,gatewayBase,validSessionId} from './waakg-adapter.mjs';
const bad=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const outboundEnabled=(env=process.env)=>env.SOCIO_OUTBOUND_ENABLED==='true'&&Boolean(env.WA_AKG_API_KEY&&env.WA_AKG_BASE_URL);
export const canAutoReply=(env=process.env)=>outboundEnabled(env)&&env.SOCIO_AUTOREPLY_ENABLED==='true'&&Boolean(env.GROQ_API_KEY);
export function textPayload(text){
 if(typeof text!=='string'||!text.trim()||text.length>3000||/[\u0000-\u0008\u000e-\u001f]/.test(text))
  throw bad(422,'Digite uma mensagem de até 3000 caracteres.');
 return text.trim();
}
export function gatewaySignature({timestamp,sessionId,jid,text,key}){
 if(!validSessionId(sessionId)||!/^\d{5,24}@s\.whatsapp\.net$/.test(jid))
  throw bad(422,'Destinatário inválido.');
 return createHmac('sha256',key).update([timestamp,sessionId,jid,text].join('\n')).digest('hex');
}
export async function sendGatewayText({sessionId,jid,text,env=process.env,fetchImpl=fetch}){
 if(!outboundEnabled(env))throw bad(503,'Envio de mensagens ainda não habilitado neste ambiente.');
 const body=textPayload(text),timestamp=String(Date.now());
 const signature=gatewaySignature({timestamp,sessionId,jid,text:body,key:env.WA_AKG_API_KEY});
 const url=gatewayBase(env)+'/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send';
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
 try{
  const response=await fetchImpl(url,{method:'POST',signal:ctrl.signal,
   headers:{'x-api-key':env.WA_AKG_API_KEY,'x-socio-outbound-at':timestamp,
    'x-socio-outbound-signature':signature,'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify({message:{text:body}})});
  if(!response.ok)throw bad(503,'O WhatsApp não confirmou o envio.');
  const result=await response.json(),key=result?.data?.key;
  if(result?.status!==true||typeof key?.id!=='string'||!key.id||key.fromMe!==true||
     (key.remoteJid&&key.remoteJid!==jid))
   throw bad(503,'Gateway não confirmou o identificador e o destinatário.');
  return {sent:true,providerId:key.id.slice(0,160)};
 }catch(error){
  if(error.status)throw error;
  throw bad(503,'Não foi possível confirmar o envio com o gateway.');
 }finally{clearTimeout(timer);}
}
export async function deliverToConversation(pool,{tenantId,conversationId,userId=null,mode='human',
 text,clientRequestId,replyToId=null,env=process.env,getStatus=getSessionStatus,send=sendGatewayText}){
 if(!outboundEnabled(env))throw bad(503,'Envio indisponível até a validação de um WhatsApp conectado.');
 if(!uuid.test(conversationId)||!uuid.test(clientRequestId)||!['human','ai'].includes(mode)||
    (replyToId!==null&&!uuid.test(replyToId)))throw bad(422,'Identificador inválido.');
 const body=textPayload(text);
 const record=await pool.query(
  "SELECT c.id,c.customer_phone,c.status,l.session_id,ch.phone AS linked_phone,"+
  "COALESCE(st.handling_mode,'human') AS handling_mode,ag.enabled AS agent_enabled "+
  "FROM conversations c JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=c.tenant_id "+
  "JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
  "LEFT JOIN conversation_ui_state st ON st.tenant_id=c.tenant_id AND st.conversation_id=c.id "+
  "LEFT JOIN agents ag ON ag.tenant_id=c.tenant_id "+
  "WHERE c.tenant_id=$1 AND c.id=$2 AND ch.provider='waakg'",[tenantId,conversationId]);
 if(!record.rowCount)throw bad(404,'Conversa WhatsApp não encontrada nesta empresa.');
 const c=record.rows[0];
 if(c.status==='resolved')throw bad(409,'Reabra a conversa antes de responder.');
 if(mode==='human'&&c.handling_mode!=='human')throw bad(409,'Assuma a conversa antes de responder.');
 if(mode==='ai'&&(c.handling_mode!=='ai_assist'||!c.agent_enabled||!canAutoReply(env)))
  throw bad(409,'A IA não foi autorizada para esta conversa.');
 if(replyToId){
  const parent=await pool.query('SELECT id FROM messages WHERE tenant_id=$1 AND conversation_id=$2 AND id=$3',
   [tenantId,conversationId,replyToId]);
  if(!parent.rowCount)throw bad(422,'Mensagem citada não pertence à conversa.');
 }
 const jid=String(c.customer_phone||'')+'@s.whatsapp.net';
 if(!/^\d{5,24}@s\.whatsapp\.net$/.test(jid))throw bad(422,'Número WhatsApp não confirmado.');
 const remote=await getStatus(c.session_id);
 if(!remote.connected||remote.connectedNumber!==String(c.linked_phone||'').replace(/\D/g,''))
  throw bad(409,'Sessão WhatsApp desconectada ou número divergente.');
 const created=await pool.query(
  "INSERT INTO message_outbox(id,tenant_id,conversation_id,user_id,client_request_id,mode,body,reply_to_id,status) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') ON CONFLICT(tenant_id,client_request_id) DO NOTHING RETURNING id",
  [randomUUID(),tenantId,conversationId,userId,clientRequestId,mode,body,replyToId]);
 if(!created.rowCount){
  const existing=await pool.query(
   'SELECT id,status,conversation_id,mode,body,reply_to_id FROM message_outbox WHERE tenant_id=$1 AND client_request_id=$2',
   [tenantId,clientRequestId]);
  if(!existing.rowCount)throw bad(409,'Solicitação já está registrada.');
  const prior=existing.rows[0];
  // A request ID is tied to the original tenant, conversation and exact payload.
  // Reusing it for a different customer must NEVER be treated as a successful send.
  if(prior.conversation_id!==conversationId||prior.mode!==mode||
     prior.body!==body||(prior.reply_to_id||null)!==(replyToId||null))
   throw bad(409,'Identificador de envio já foi usado para outra mensagem.');
  return {id:prior.id,status:prior.status,
   sent:prior.status==='sent',reused:true};
 }
 const outboxId=created.rows[0].id;
 const claimed=await pool.query(
  "UPDATE message_outbox SET status='processing',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='pending' RETURNING id",
  [outboxId,tenantId]);
 if(!claimed.rowCount)throw bad(409,'Mensagem já está em processamento.');
 try{
  const delivery=await send({sessionId:c.session_id,jid,text:body,env});
  if(!delivery.sent||!delivery.providerId)throw bad(503,'O gateway não confirmou o envio.');
  const providerId='waakg:'+createHash('sha256').update(c.session_id+':'+jid+':'+delivery.providerId).digest('hex');
  await pool.query("UPDATE message_outbox SET status='sent',provider_id=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [outboxId,tenantId,providerId]);
  await pool.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,reply_to_id) "+
   "VALUES($1,$2,$3,'outbound',$4,$5,$6) ON CONFLICT(tenant_id,provider_id) DO NOTHING",
   [randomUUID(),tenantId,conversationId,body,providerId,replyToId]);
  await pool.query('UPDATE conversations SET last_message_at=now() WHERE id=$1 AND tenant_id=$2',[conversationId,tenantId]);
  return {id:outboxId,sent:true,status:'sent',whatsappSent:true};
 }catch{
  await pool.query("UPDATE message_outbox SET status='uncertain',error_code='SEND_UNCONFIRMED',updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [outboxId,tenantId]).catch(()=>{});
  throw bad(503,'Envio sem confirmação. Confira o WhatsApp antes de tentar novamente.');
 }
}
