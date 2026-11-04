// Customer-initiated quote requests. No automatic quoting or customer outreach.
// Owner WhatsApp notices require explicit opt-in and the existing gateway's
// outbound safety switch. Unknown delivery is NEVER retried.
import {randomUUID} from 'node:crypto';
import {getSessionStatus} from './waakg-adapter.mjs';
import {sendGatewayText,outboundEnabled,deliverToConversation} from './socio-outbound.mjs';
import {parseTenantFeatures} from './tenant-features.mjs';
const bad=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab0-9a-f]{12}$/i;
const clean=x=>String(x||'').trim();
export function isQuoteRequest(text){
 const s=clean(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().slice(0,2000);
 if(!s||/\b(?:nao quero|nao preciso|dispenso|nao solicitei|cancele|ja tenho|ja recebi)\s+(?:(?:um|uma|o|esse|essa)\s+)?(?:orcamento|cotacao)\b/.test(s))return false;
 return /\b(?:orcamento|cotacao|quanto (?:custa|fica|sai)|(?:qual|quanto e)\s+(?:o\s+)?(?:preco|valor)|(?:me\s+)?(?:passa|mande|manda|envie|envia|prepara|prepare|faca|faz|quero|preciso)\s+(?:(?:um|uma|o|a|de)\s+)?(?:orcamento|cotacao|preco|valor)|(?:pode|poderia|consegue)\s+(?:me\s+)?(?:passar|enviar|fazer|preparar)\s+(?:um\s+|uma\s+)?(?:orcamento|cotacao))\b/.test(s);
}
export async function scanQuoteRequests(pool){
 const found=await pool.query(
  "SELECT m.id,m.tenant_id,m.conversation_id,m.body,c.customer_name,c.customer_phone "+
  "FROM messages m JOIN tenants t ON t.id=m.tenant_id "+
  "JOIN conversations c ON c.tenant_id=m.tenant_id AND c.id=m.conversation_id "+
  "WHERE m.direction='inbound' AND m.created_at > now()-interval '48 hours' "+
  "AND COALESCE((t.features->>'quotes')::boolean,true)=true "+
  "AND NOT EXISTS (SELECT 1 FROM quote_requests q WHERE q.tenant_id=m.tenant_id AND q.inbound_message_id=m.id) "+
  "AND m.body ~* '(orçamento|orcamento|cotação|cotacao|preço|preco|quanto custa|quanto fica|quanto sai|qual valor|qual o valor)' "+
  "ORDER BY m.created_at DESC LIMIT 40"
 );
 let created=0;
 for(const m of found.rows){
  if(!isQuoteRequest(m.body))continue;
  const r=await pool.query(
   "INSERT INTO quote_requests(id,tenant_id,conversation_id,inbound_message_id,customer_name,customer_phone,summary) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,inbound_message_id) DO NOTHING RETURNING id",
   [randomUUID(),m.tenant_id,m.conversation_id,m.id,clean(m.customer_name).slice(0,100),
    clean(m.customer_phone).slice(0,30),clean(m.body).slice(0,800)]
  );
  if(r.rowCount)created++;
 }
 return {created,scanned:found.rowCount};
}
export async function listQuoteRequests(pool,tenantId){
 const r=await pool.query(
  "SELECT id,conversation_id,customer_name,customer_phone,summary,status,alert_status,draft_text,draft_amount_cents,delivery_status,quote_sent_at,created_at "+
  "FROM quote_requests WHERE tenant_id=$1 ORDER BY "+
  "CASE WHEN status='pending' THEN 0 WHEN status='preparing' THEN 1 ELSE 2 END,created_at DESC LIMIT 120",
  [tenantId]);
 return r.rows;
}
export async function updateQuoteRequest(pool,tenantId,id,status){
 if(!uuid.test(String(id||''))||!['preparing','resolved','pending'].includes(status))throw bad(422,'Situação do pedido inválida.');
 const r=await pool.query(
  "UPDATE quote_requests SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 "+
  "RETURNING id,status,conversation_id",[tenantId,id,status]);
 if(!r.rowCount)throw bad(404,'Pedido de orçamento não encontrado nesta empresa.');
 return r.rows[0];
}
export async function setQuoteAlerts(pool,auth,enabled,env=process.env){
 if(typeof enabled!=='boolean')throw bad(422,'Configuração de notificação inválida.');
 if(auth.role!=='owner'&&!auth.platform_owner)throw bad(403,'Somente o proprietário pode ativar alertas no WhatsApp.');
 if(enabled){
  if(!outboundEnabled(env))throw bad(503,'Envio WhatsApp do Sócio ainda não está liberado neste ambiente.');
  const r=await pool.query(
   "SELECT phone FROM users WHERE tenant_id=$1 AND role='owner' AND active=true AND phone IS NOT NULL "+
   "ORDER BY created_at LIMIT 1",[auth.active_tenant_id]);
  if(!r.rowCount)throw bad(422,'Cadastre um celular de login do proprietário antes de habilitar alertas.');
  const available=await pool.query(
   "SELECT 1 FROM channels ch JOIN waakg_links w ON w.channel_id=ch.id AND w.tenant_id=ch.tenant_id "+
   "WHERE ch.tenant_id=$1 AND ch.provider='waakg' AND ch.status='connected' LIMIT 1",
   [auth.active_tenant_id]);
  if(!available.rowCount)throw bad(409,'Conecte um WhatsApp da empresa para ativar os alertas.');
 }
 await pool.query("UPDATE tenants SET quote_alert_whatsapp=$2,quote_alert_enabled_at=CASE WHEN $2=true THEN now() ELSE NULL END WHERE id=$1",
  [auth.active_tenant_id,enabled]);
 return {enabled};
}
export async function processNextOwnerQuoteAlert(pool,{
 env=process.env,getStatus=getSessionStatus,send=sendGatewayText
}={}){
 if(!outboundEnabled(env))return {processed:false,reason:'OUTBOUND_DISABLED'};
 const queued=await pool.query(
  "SELECT q.id,q.tenant_id,q.conversation_id,q.customer_name,q.customer_phone,q.summary,t.name AS company_name "+
  "FROM quote_requests q JOIN tenants t ON t.id=q.tenant_id "+
  "WHERE q.alert_status='pending' AND q.status IN ('pending','preparing') "+
  "AND t.quote_alert_whatsapp=true AND t.quote_alert_enabled_at IS NOT NULL "+
  "AND q.created_at>=t.quote_alert_enabled_at "+
  "AND COALESCE((t.features->>'quotes')::boolean,true)=true "+
  "ORDER BY q.created_at LIMIT 1"
 );
 if(!queued.rowCount)return {processed:false};
 const q=queued.rows[0];
 const owner=await pool.query(
  "SELECT phone FROM users WHERE tenant_id=$1 AND role='owner' AND active=true AND phone IS NOT NULL "+
  "ORDER BY created_at LIMIT 1",[q.tenant_id]);
 if(!owner.rowCount)return {processed:false,reason:'OWNER_PHONE_MISSING'};
 const ch=await pool.query(
  "SELECT w.session_id,ch.phone FROM waakg_links w JOIN channels ch ON ch.id=w.channel_id AND ch.tenant_id=w.tenant_id "+
  "WHERE ch.tenant_id=$1 AND ch.provider='waakg' AND ch.status='connected' "+
  "ORDER BY ch.created_at LIMIT 1",[q.tenant_id]);
 if(!ch.rowCount)return {processed:false,reason:'CHANNEL_DISCONNECTED'};
 const session=ch.rows[0],status=await getStatus(session.session_id).catch(()=>null);
 if(!status?.connected||status.connectedNumber!==clean(session.phone).replace(/\D/g,''))
  return {processed:false,reason:'SESSION_UNVERIFIED'};
 const claimed=await pool.query(
  "UPDATE quote_requests SET alert_status='processing',alert_last_attempt_at=now(),updated_at=now() "+
  "WHERE id=$1 AND tenant_id=$2 AND alert_status='pending' RETURNING id",
  [q.id,q.tenant_id]);
 if(!claimed.rowCount)return {processed:false,reason:'CLAIMED'};
 // The number belongs to the tenant owner, and they explicitly opted in.
 const jid=clean(owner.rows[0].phone)+'@s.whatsapp.net';
 const summary=clean(q.summary).replace(/[\r\n\t]/g,' ').slice(0,240);
 const customer=clean(q.customer_name||q.customer_phone||'Cliente').slice(0,90);
 const message='Sócio · Pedido de orçamento\n'+customer+' solicitou um orçamento na empresa '+clean(q.company_name).slice(0,80)+
  '.\nResumo: '+summary+'\nAbra Sócio → Vendas e orçamentos para preparar e revisar a proposta. Nenhum valor foi enviado automaticamente.';
 try{
  const result=await send({sessionId:session.session_id,jid,text:message,env});
  if(!result?.sent)throw bad(503,'Sem confirmação de envio.');
  await pool.query(
   "UPDATE quote_requests SET alert_status='sent',alert_sent_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [q.id,q.tenant_id]);
  return {processed:true,sent:true};
 }catch{
  await pool.query(
   "UPDATE quote_requests SET alert_status='unconfirmed',updated_at=now() WHERE id=$1 AND tenant_id=$2",
   [q.id,q.tenant_id]).catch(()=>{});
  return {processed:true,sent:false,unconfirmed:true};
 }
}

export async function saveQuoteDraft(pool,tenant,requestId,{text,amountCents}){
 if(!uuid.test(String(requestId||''))||typeof text!=='string'||!text.trim()||
   text.trim().length>2300||!Number.isInteger(amountCents)||amountCents<1||amountCents>=100000000)
  throw bad(422,'Informe a descrição do orçamento e um valor final válido.');
 const r=await pool.query(
  "UPDATE quote_requests SET draft_text=$3,draft_amount_cents=$4,status='preparing',updated_at=now() "+
  "WHERE tenant_id=$1 AND id=$2 AND status<>'resolved' AND delivery_status='not_sent' "+
  "RETURNING id,conversation_id,status,draft_text,draft_amount_cents,delivery_status",
  [tenant,requestId,text.trim(),amountCents]);
 if(!r.rowCount)throw bad(409,'Orçamento indisponível ou já enviado. Revise o histórico antes de continuar.');
 return r.rows[0];
}
export async function sendQuoteDraft(pool,tenant,requestId,userId,{env=process.env,deliver=deliverToConversation,getStatus=getSessionStatus}={}){
 if(!uuid.test(String(requestId||'')))throw bad(422,'Solicitação inválida.');
 if(!outboundEnabled(env))throw bad(503,'Envio WhatsApp indisponível. O orçamento permanece salvo no Sócio.');
 // Preflight predictable refusal before claiming the one-time delivery id.
 const preflight=await pool.query(
  "SELECT q.conversation_id,c.status,c.customer_phone,COALESCE(st.handling_mode,'human') AS handling_mode,"+
  "ch.provider,ch.status AS channel_status,ch.phone AS linked_phone,w.session_id "+
  "FROM quote_requests q JOIN conversations c ON c.tenant_id=q.tenant_id AND c.id=q.conversation_id "+
  "JOIN channels ch ON ch.tenant_id=c.tenant_id AND ch.id=c.channel_id "+
  "LEFT JOIN waakg_links w ON w.tenant_id=ch.tenant_id AND w.channel_id=ch.id "+
  "LEFT JOIN conversation_ui_state st ON st.tenant_id=c.tenant_id AND st.conversation_id=c.id "+
  "WHERE q.tenant_id=$1 AND q.id=$2",[tenant,requestId]);
 if(!preflight.rowCount)throw bad(404,'Orçamento não encontrado.');
 const connection=preflight.rows[0];
 if(connection.status==='resolved')throw bad(409,'Reabra a conversa antes de enviar.');
 if(connection.handling_mode!=='human')
  throw bad(409,'Assuma a conversa no WhatsApp antes de enviar o orçamento.');
 if(connection.provider!=='waakg'||connection.channel_status!=='connected'||!connection.session_id)
  throw bad(409,'Conecte um WhatsApp da empresa antes de enviar.');
 if(!/^\d{5,24}$/.test(String(connection.customer_phone||'')))
  throw bad(422,'Número do cliente inválido para envio.');
 const session=await getStatus(connection.session_id).catch(()=>null);
 if(!session?.connected||session.connectedNumber!==String(connection.linked_phone||'').replace(/\D/g,''))
  throw bad(409,'A conexão WhatsApp não está verificada. Atualize a sessão antes de enviar.');

 const r=await pool.query(
  "UPDATE quote_requests SET delivery_status='processing',updated_at=now() "+
  "WHERE tenant_id=$1 AND id=$2 AND delivery_status='not_sent' AND status='preparing' "+
  "AND draft_text IS NOT NULL AND draft_amount_cents>0 "+
  "RETURNING id,conversation_id,draft_text,draft_amount_cents,customer_name",
  [tenant,requestId]);
 if(!r.rowCount)throw bad(409,'Salve o orçamento antes de enviar. Solicitações já enviadas ou incertas não são reenviadas.');
 const q=r.rows[0];
 const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(q.draft_amount_cents)/100);
 const body='Orçamento solicitado'+(q.customer_name?' para '+String(q.customer_name).slice(0,100):'')+
  '\n\n'+String(q.draft_text).trim()+'\n\nValor total: '+money+
  '\n\nConfirme diretamente com nossa equipe as condições de pagamento e entrega.';
 try{
  const sent=await deliver(pool,{tenantId:tenant,conversationId:q.conversation_id,userId,mode:'human',
   text:body,clientRequestId:q.id,env});
  if(!sent?.sent)throw bad(503,'O WhatsApp não confirmou o envio.');
  await pool.query("UPDATE quote_requests SET delivery_status='sent',quote_sent_at=now(),status='resolved',updated_at=now() "+
   "WHERE tenant_id=$1 AND id=$2",[tenant,requestId]);
  return {id:q.id,deliveryStatus:'sent',conversationId:q.conversation_id};
 }catch(error){
  await pool.query("UPDATE quote_requests SET delivery_status='unconfirmed',updated_at=now() "+
   "WHERE tenant_id=$1 AND id=$2 AND delivery_status='processing'",[tenant,requestId]).catch(()=>{});
  throw bad(503,'Não foi possível confirmar o envio. Confira a conversa antes de qualquer nova tentativa. O orçamento foi preservado.');
 }
}
