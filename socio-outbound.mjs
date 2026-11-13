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
const privateJidRe=/^\d{5,24}@s\.whatsapp\.net$/;
const groupJidRe=/^\d{5,24}(-\d{5,24})?@g\.us$/;
// Sócio sends to one known contact or one owner group. Nothing else.
export const outboundRecipient=jid=>typeof jid==='string'&&(privateJidRe.test(jid)||groupJidRe.test(jid));
// Media must be served by Sócio: the gateway never fetches an arbitrary host.
export function mediaPayload({kind,url,caption=''},env=process.env){
 if(!['image','video'].includes(kind))throw bad(422,'Tipo de mídia inválido.');
 const origin=String(env.SOCIO_PUBLIC_URL||'').replace(/\/+$/,'');
 let parsed;
 try{parsed=new URL(url);}catch{throw bad(422,'Endereço de mídia inválido.');}
 if(!origin||parsed.origin!==origin||parsed.username||parsed.password||parsed.hash||
    url.length>1800||!['https:','http:'].includes(parsed.protocol))
  throw bad(422,'A mídia precisa ser servida pelo próprio Sócio.');
 const text=typeof caption==='string'?caption.trim():'';
 if(text.length>1024||/[\u0000-\u0008\u000e-\u001f]/.test(text))
  throw bad(422,'Legenda da mídia inválida.');
 return {kind,url:parsed.href,caption:text};
}
export function gatewaySignature({timestamp,sessionId,jid,text,media,key}){
 if(!validSessionId(sessionId)||!outboundRecipient(jid))
  throw bad(422,'Destinatário inválido.');
 const canonical=media?media.kind+':'+media.url+':'+media.caption:'text:'+text;
 return createHmac('sha256',key).update([timestamp,sessionId,jid,canonical].join('\n')).digest('hex');
}
export async function sendGatewayMessage({sessionId,jid,text,media,env=process.env,fetchImpl=fetch}){
 if(!outboundEnabled(env))throw bad(503,'Envio de mensagens ainda não habilitado neste ambiente.');
 const message=media
  ?{[media.kind]:{url:media.url,...(media.caption?{caption:media.caption}:{})}}
  :{text:textPayload(text)};
 const timestamp=String(Date.now());
 const signature=gatewaySignature({timestamp,sessionId,jid,text:message.text,media,key:env.WA_AKG_API_KEY});
 const url=gatewayBase(env)+'/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send';
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),25000);
 try{
  const response=await fetchImpl(url,{method:'POST',signal:ctrl.signal,
   headers:{'x-api-key':env.WA_AKG_API_KEY,'x-socio-outbound-at':timestamp,
    'x-socio-outbound-signature':signature,'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify({message})});
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
export const sendGatewayText=({sessionId,jid,text,env=process.env,fetchImpl=fetch})=>
 sendGatewayMessage({sessionId,jid,text,env,fetchImpl});

// WhatsApp quick-reply buttons. The gateway builds a native flow message; the
// same three answers must also be delivered as numbered text, because native
// buttons are not guaranteed on every client or device.
export function interactivePayload({title='',body,footer='',buttons=[]}={}){
 const cleanText=(value,max)=>String(value||'').replace(/[\u0000-\u0008\u000e-\u001f]/g,'').trim().slice(0,max);
 const text=cleanText(body,1024);
 if(!text)throw bad(422,'O texto do lembrete está vazio.');
 const list=(Array.isArray(buttons)?buttons:[]).slice(0,3).map(button=>({
  type:'quick_reply',
  displayText:cleanText(button?.text,20),
  id:cleanText(button?.id,120)
 }));
 if(!list.length)throw bad(422,'O lembrete precisa de pelo menos uma opção.');
 if(list.some(button=>!button.displayText||!/^[A-Za-z0-9:_.-]{4,120}$/.test(button.id)))
  throw bad(422,'Opção de resposta inválida.');
 return {title:cleanText(title,60),body:text,footer:cleanText(footer,60),buttons:list};
}
export async function sendGatewayInteractive({sessionId,jid,title,body,footer,buttons,env=process.env,fetchImpl=fetch}){
 if(!outboundEnabled(env))throw bad(503,'Envio de mensagens ainda não habilitado neste ambiente.');
 if(!validSessionId(sessionId)||!outboundRecipient(jid))throw bad(422,'Destinatário inválido.');
 const payload=interactivePayload({title,body,footer,buttons});
 const url=gatewayBase(env)+'/api/messages/'+encodeURIComponent(sessionId)+'/'+
  encodeURIComponent(jid)+'/interactive';
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),25000);
 try{
  const response=await fetchImpl(url,{method:'POST',signal:ctrl.signal,
   headers:{'x-api-key':env.WA_AKG_API_KEY,'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify(payload)});
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
 const loadConversation=()=>pool.query(
  "SELECT c.id,c.customer_phone,c.status,l.session_id,ch.phone AS linked_phone,"+
  "COALESCE(st.handling_mode,'human') AS handling_mode,ag.enabled AS agent_enabled "+
  "FROM conversations c JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=c.tenant_id "+
  "JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
  "LEFT JOIN conversation_ui_state st ON st.tenant_id=c.tenant_id AND st.conversation_id=c.id "+
  "LEFT JOIN agents ag ON ag.tenant_id=c.tenant_id "+
  "JOIN tenants t ON t.id=c.tenant_id "+
  "WHERE c.tenant_id=$1 AND c.id=$2 AND ch.provider='waakg' AND ch.status='connected' AND t.status<>'paused' "+
  "AND COALESCE((t.features->>'whatsapp')::boolean,true)=true "+
  "AND ($3::text<>'ai' OR COALESCE((t.features->>'ai')::boolean,true)=true)",[tenantId,conversationId,mode]);
 const receipt=prior=>{
  if(prior.conversation_id!==conversationId||prior.mode!==mode||prior.body!==body||
     (prior.reply_to_id||null)!==(replyToId||null))throw bad(409,'Identificador de envio já foi usado para outra mensagem.');
  return {id:prior.id,status:prior.status,sent:prior.status==='sent',reused:true};
 };
 const prior=await pool.query(
  'SELECT id,status,conversation_id,mode,body,reply_to_id FROM message_outbox WHERE tenant_id=$1 AND client_request_id=$2',
  [tenantId,clientRequestId]);
 // A confirmed retry remains a receipt even after the conversation changes mode.
 if(prior.rowCount)return receipt(prior.rows[0]);
 const record=await loadConversation();
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
 const fresh=await loadConversation(),latest=fresh.rows[0];
 if(!latest||latest.status==='resolved'||latest.session_id!==c.session_id||
    latest.customer_phone!==c.customer_phone||latest.linked_phone!==c.linked_phone||
    latest.handling_mode!==(mode==='ai'?'ai_assist':'human')||mode==='ai'&&!latest.agent_enabled)
  throw bad(409,'O atendimento mudou durante a preparação. Confira a conversa antes de enviar.');
 if(userId){
  const actor=await pool.query('SELECT id FROM users WHERE id=$1 AND active=true AND (tenant_id=$2 OR platform_owner=true)',[userId,tenantId]);
  if(!actor.rowCount)throw bad(403,'O usuário não está mais autorizado a enviar mensagens.');
 }
 if(mode==='ai'){
  const current=await pool.query("SELECT m.id FROM messages m WHERE m.tenant_id=$1 AND m.conversation_id=$2 AND m.direction='inbound' "+
   "AND NOT EXISTS(SELECT 1 FROM messages sent WHERE sent.tenant_id=$1 AND sent.conversation_id=$2 AND sent.direction='outbound' AND sent.created_at>=m.created_at) "+
   "ORDER BY m.created_at DESC,m.id DESC LIMIT 1",[tenantId,conversationId]);
  if(!replyToId||current.rows[0]?.id!==replyToId)throw bad(409,'A conversa foi atualizada. A resposta anterior foi cancelada.');
 }
 const created=await pool.query(
  "INSERT INTO message_outbox(id,tenant_id,conversation_id,user_id,client_request_id,mode,body,reply_to_id,status) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') ON CONFLICT(tenant_id,client_request_id) DO NOTHING RETURNING id",
  [randomUUID(),tenantId,conversationId,userId,clientRequestId,mode,body,replyToId]);
 if(!created.rowCount){
  const existing=await pool.query(
   'SELECT id,status,conversation_id,mode,body,reply_to_id FROM message_outbox WHERE tenant_id=$1 AND client_request_id=$2',
   [tenantId,clientRequestId]);
  if(!existing.rowCount)throw bad(409,'Solicitação já está registrada.');
  return receipt(existing.rows[0]);
 }
 const outboxId=created.rows[0].id;
 const claimed=await pool.query(
  "UPDATE message_outbox SET status='processing',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='pending' RETURNING id",
  [outboxId,tenantId]);
 if(!claimed.rowCount)throw bad(409,'Mensagem já está em processamento.');
 let confirmedProviderId=null;
 try{
  const delivery=await send({sessionId:c.session_id,jid,text:body,env});
  if(!delivery.sent||!delivery.providerId)throw bad(503,'O gateway não confirmou o envio.');
  const providerId='waakg:'+createHash('sha256').update(c.session_id+':'+jid+':'+delivery.providerId).digest('hex');
  confirmedProviderId=providerId;
  await pool.query("UPDATE message_outbox SET status='sent',provider_id=$3,error_code='HISTORY_PENDING',updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [outboxId,tenantId,providerId]);
  await pool.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,reply_to_id) "+
   "VALUES($1,$2,$3,'outbound',$4,$5,$6) ON CONFLICT(tenant_id,provider_id) DO NOTHING",
   [randomUUID(),tenantId,conversationId,body,providerId,replyToId]);
  await pool.query('UPDATE conversations SET last_message_at=now() WHERE id=$1 AND tenant_id=$2',[conversationId,tenantId]);
  await pool.query('UPDATE message_outbox SET error_code=NULL WHERE id=$1 AND tenant_id=$2',[outboxId,tenantId]);
  return {id:outboxId,sent:true,status:'sent',whatsappSent:true};
 }catch{
  if(confirmedProviderId){
   // Persist a confirmed receipt independently of history projection. Recovery
   // below repairs history without ever contacting the gateway or sending again.
   const saved=await pool.query("UPDATE message_outbox SET status='sent',provider_id=$3,error_code='HISTORY_PENDING',updated_at=now() WHERE id=$1 AND tenant_id=$2",
    [outboxId,tenantId,confirmedProviderId]).then(()=>true).catch(()=>false);
   if(saved)return {id:outboxId,sent:true,status:'sent',whatsappSent:true,historyPending:true};
  }
  await pool.query("UPDATE message_outbox SET status='uncertain',error_code='SEND_UNCONFIRMED',updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [outboxId,tenantId]).catch(()=>{});
  throw bad(503,'Envio sem confirmação. Confira o WhatsApp antes de tentar novamente.');
 }
}

export async function reconcileConfirmedOutbox(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const rows=await client.query("SELECT o.* FROM message_outbox o WHERE o.status='sent' AND o.provider_id IS NOT NULL "+
   "AND (o.error_code='HISTORY_PENDING' OR NOT EXISTS(SELECT 1 FROM messages m WHERE m.tenant_id=o.tenant_id AND m.provider_id=o.provider_id)) "+
   "ORDER BY o.updated_at,o.id LIMIT 30 FOR UPDATE OF o SKIP LOCKED");
  for(const o of rows.rows){
   await client.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,reply_to_id,created_at) "+
    "VALUES($1,$2,$3,'outbound',$4,$5,$6,$7) ON CONFLICT(tenant_id,provider_id) DO NOTHING",
    [randomUUID(),o.tenant_id,o.conversation_id,o.body,o.provider_id,o.reply_to_id,o.created_at]);
   await client.query('UPDATE conversations SET last_message_at=GREATEST(last_message_at,$3) WHERE tenant_id=$1 AND id=$2',
    [o.tenant_id,o.conversation_id,o.created_at]);
   await client.query('UPDATE message_outbox SET error_code=NULL WHERE id=$1',[o.id]);
  }
  await client.query('COMMIT');return {reconciled:rows.rowCount};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
