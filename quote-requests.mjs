// Supervised quotation interest detection. No inferred prices, no unsupervised offers,
// no messages to a customer. Owner notification is separately opt-in and one-attempt.
import {randomUUID} from 'node:crypto';
import {getSessionStatus} from './waakg-adapter.mjs';
import {outboundEnabled,sendGatewayText} from './socio-outbound.mjs';
const bad=(status,message)=>Object.assign(new Error(message),{status});
const uuid=x=>typeof x==='string'&&/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(x);
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function isQuoteIntent(input){
 const text=normalize(input).slice(0,1500);
 if(!text)return false;
 if(/\b(nao\s+(?:quero|preciso|tenho interesse em)|sem\s+necessidade de)\s+(?:um\s+)?(?:orcamento|cotacao|proposta)\b/.test(text))return false;
 return /\b(orcamento|orcamentos|cotacao|cotar|pode orcar|fazer uma proposta comercial|quanto custa|quanto ficaria|qual (?:e |seria )?o valor|preciso de (?:um )?preco|queria (?:saber|ver) o preco|me passa (?:o )?(?:preco|valor)|quanto sai)\b/.test(text);
}
const safeExcerpt=s=>String(s||'').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,700);
export async function processQuoteInterest(pool){
 // Only recent incoming messages from conversations currently handed to an enabled AI,
 // and only when company Sales + AI are explicitly enabled.
 const found=await pool.query(
  "SELECT m.id,m.tenant_id,m.conversation_id,m.body,t.quote_alerts_enabled "+
  "FROM messages m JOIN tenants t ON t.id=m.tenant_id "+
  "JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id "+
  "JOIN conversation_ui_state st ON st.tenant_id=m.tenant_id AND st.conversation_id=m.conversation_id "+
  "JOIN agents ag ON ag.tenant_id=m.tenant_id AND ag.enabled=true "+
  "WHERE m.direction='inbound' AND m.created_at>now()-interval '48 hours' "+
  "AND st.handling_mode='ai_assist' AND st.ai_activated_at IS NOT NULL AND m.created_at>=st.ai_activated_at "+
  "AND c.status<>'resolved' AND t.features->>'sales'='true' AND t.features->>'ai'='true' "+
  "AND lower(m.body) ~ '(or[çc]amento|cota|or[çc]ar|quanto|valor|pre[çc]o|proposta)' "+
  "AND NOT EXISTS(SELECT 1 FROM quote_requests q WHERE q.tenant_id=m.tenant_id AND q.inbound_message_id=m.id) "+
  "ORDER BY m.created_at DESC LIMIT 80");
 for(const m of found.rows){
  if(!isQuoteIntent(m.body))continue;
  const excerpt=safeExcerpt(m.body);
  if(!excerpt)continue;
  const created=await pool.query(
   "INSERT INTO quote_requests(id,tenant_id,conversation_id,inbound_message_id,request_excerpt,alert_status) "+
   "VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,inbound_message_id) DO NOTHING RETURNING id",
   [randomUUID(),m.tenant_id,m.conversation_id,m.id,excerpt,m.quote_alerts_enabled?'pending':'disabled']);
  if(created.rowCount)return {processed:true,requestId:created.rows[0].id,alertPending:!!m.quote_alerts_enabled};
 }
 return {processed:false};
}
export async function listQuoteRequests(pool,tenantId){
 const [requests,settings]=await Promise.all([
  pool.query("SELECT q.id,q.conversation_id,q.request_excerpt,q.status,q.alert_status,q.created_at,"+
   "c.customer_name,c.customer_phone FROM quote_requests q "+
   "JOIN conversations c ON c.id=q.conversation_id AND c.tenant_id=q.tenant_id "+
   "WHERE q.tenant_id=$1 ORDER BY q.created_at DESC LIMIT 120",[tenantId]),
  pool.query("SELECT t.quote_alerts_enabled,u.id AS owner_id,u.phone AS owner_phone "+
   "FROM tenants t LEFT JOIN users u ON u.id=t.quote_alert_owner_id AND u.tenant_id=t.id "+
   "WHERE t.id=$1",[tenantId])
 ]);
 const config=settings.rows[0]||{};
 const masked=config.owner_phone?String(config.owner_phone).replace(/.(?=.{4})/g,'•'):null;
 return {requests:requests.rows,
  pendingCount:requests.rows.filter(x=>x.status==='pending').length,
  alerts:{enabled:!!config.quote_alerts_enabled,ownerPhoneMasked:masked}};
}
export async function configureQuoteAlerts(pool,identity,enabled,{env=process.env}={}){
 if(typeof enabled!=='boolean')throw bad(422,'Escolha ativar ou desativar os avisos.');
 // Consent can only be granted by the holder of that company's owner login.
 if(identity.role!=='owner'||identity.tenant_id!==identity.active_tenant_id)
  throw bad(403,'Somente o proprietário da empresa pode ativar alertas no próprio WhatsApp.');
 const owner=await pool.query("SELECT phone,active FROM users WHERE id=$1 AND tenant_id=$2 AND role='owner'",
  [identity.user_id,identity.active_tenant_id]);
 if(!owner.rowCount||!owner.rows[0].active)throw bad(403,'Proprietário não autorizado.');
 if(enabled&&(!/^\d{12,13}$/.test(String(owner.rows[0].phone||''))||!String(owner.rows[0].phone).startsWith('55')))
  throw bad(422,'Cadastre seu celular com DDD no perfil antes de habilitar os avisos.');
 if(enabled&&!outboundEnabled(env))
  throw bad(503,'O envio WhatsApp está desativado neste ambiente. Avisos internos continuam disponíveis no Sócio.');
 await pool.query("UPDATE tenants SET quote_alerts_enabled=$2,quote_alert_owner_id=$3 "+
  "WHERE id=$1",[identity.active_tenant_id,enabled,enabled?identity.user_id:null]);
 return {enabled,ownerPhoneMasked:enabled?String(owner.rows[0].phone).replace(/.(?=.{4})/g,'•'):null};
}
export async function updateQuoteRequest(pool,identity,id,status){
 if(!uuid(id)||!['preparing','done','dismissed'].includes(status))throw bad(422,'Estado do pedido de orçamento inválido.');
 const result=await pool.query(
  "UPDATE quote_requests SET status=$3,updated_at=now() "+
  "WHERE tenant_id=$1 AND id=$2 AND status IN ('pending','preparing') RETURNING id,status,conversation_id",
  [identity.active_tenant_id,id,status]);
 if(!result.rowCount)throw bad(404,'Solicitação não encontrada ou já concluída.');
 return result.rows[0];
}
export async function processOwnerQuoteAlert(pool,{env=process.env,getStatus=getSessionStatus,send=sendGatewayText}={}){
 if(!outboundEnabled(env))return {processed:false,reason:'OUTBOUND_DISABLED'};
 const rows=await pool.query(
  "SELECT q.id,q.tenant_id,q.request_excerpt,c.customer_name,t.quote_alerts_enabled,"+
  "u.phone AS owner_phone,l.session_id,ch.phone AS linked_phone "+
  "FROM quote_requests q JOIN tenants t ON t.id=q.tenant_id "+
  "JOIN conversations c ON c.id=q.conversation_id AND c.tenant_id=q.tenant_id "+
  "LEFT JOIN users u ON u.id=t.quote_alert_owner_id AND u.tenant_id=t.id AND u.role='owner' AND u.active=true "+
  "LEFT JOIN LATERAL (SELECT wl.session_id,channels.phone "+
  "FROM waakg_links wl JOIN channels ON channels.tenant_id=wl.tenant_id AND channels.id=wl.channel_id "+
  "WHERE wl.tenant_id=t.id AND channels.provider='waakg' AND channels.status='connected' "+
  "ORDER BY wl.created_at ASC LIMIT 1) l ON true "+
  "LEFT JOIN channels ch ON false "+
  "WHERE q.alert_status='pending' AND q.created_at>now()-interval '2 days' "+
  "ORDER BY q.created_at ASC LIMIT 1");
 if(!rows.rowCount)return {processed:false};
 const q=rows.rows[0];
 const claimed=await pool.query(
  "UPDATE quote_requests SET alert_status='sending',alert_attempted_at=now(),updated_at=now() "+
  "WHERE id=$1 AND tenant_id=$2 AND alert_status='pending' RETURNING id",[q.id,q.tenant_id]);
 if(!claimed.rowCount)return {processed:false,reason:'ALREADY_CLAIMED'};
 let status='unavailable';
 try{
  const owner=String(q.owner_phone||'');
  if(q.quote_alerts_enabled&&/^55\d{10,11}$/.test(owner)&&q.session_id&&q.linked_phone){
   const remote=await getStatus(q.session_id);
   if(remote.connected&&remote.connectedNumber===String(q.linked_phone).replace(/\D/g,'')){
    const customer=String(q.customer_name||'Cliente').replace(/[\r\n<>]/g,' ').slice(0,75);
    const text='Sócio — Pedido de orçamento\nCliente: '+customer+
     '\nO pedido está em Vendas e orçamentos, pronto para você revisar e preencher.'+
     '\nNenhum orçamento foi enviado automaticamente ao cliente.';
    // A message is attempted only once. Never retry uncertain WhatsApp sends.
    status='uncertain';
    const confirmed=await send({sessionId:q.session_id,jid:owner+'@s.whatsapp.net',text,env});
    if(confirmed?.sent&&confirmed.providerId)status='sent';
   }
  }
 }catch{status='uncertain';}
 await pool.query("UPDATE quote_requests SET alert_status=$3,updated_at=now(),"+
  "alerted_at=CASE WHEN $3='sent' THEN now() ELSE alerted_at END "+
  "WHERE id=$1 AND tenant_id=$2",[q.id,q.tenant_id,status]);
 return {processed:true,status};
}
