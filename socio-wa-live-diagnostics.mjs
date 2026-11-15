// Authorized, read-only live WhatsApp diagnosis. Never send, initiate sessions,
// change ownership, import contacts or return the provider session identifier.
import {getSessionStatus,validSessionId} from './waakg-adapter.mjs';
import {outboundEnabled,canAutoReply} from './socio-outbound.mjs';
import {groqReady} from './groq-client.mjs';

export async function auditLiveWhatsAppBindings(pool,{
 tenantId=null,env=process.env,getStatus=getSessionStatus,limit=10
}={}){
 const bounded=Math.max(1,Math.min(10,Number(limit)||10));
 const result=await pool.query(
  "SELECT ch.phone,ch.status,l.session_id FROM waakg_links l "+
  "JOIN channels ch ON ch.id=l.channel_id AND ch.tenant_id=l.tenant_id "+
  "WHERE ch.provider='waakg' AND ch.status='connected' "+
  "AND ($1::uuid IS NULL OR l.tenant_id=$1::uuid) "+
  "ORDER BY l.created_at DESC LIMIT $2",
  [tenantId,bounded]);
 const summary={readOnly:true,checkedChannels:result.rows.length,verified:0,
  disconnected:0,numberMismatch:0,unreachable:0};
 for(const channel of result.rows){
  if(!validSessionId(channel.session_id)){summary.unreachable++;continue;}
  try{
   const remote=await getStatus(channel.session_id,{env});
   if(!remote.connected){summary.disconnected++;continue;}
   const stored=String(channel.phone||'').replace(/\D/g,'');
   if(!/^\d{10,15}$/.test(stored)||remote.connectedNumber!==stored){
    summary.numberMismatch++;continue;
   }
   summary.verified++;
  }catch{summary.unreachable++;}
 }
 return summary;
}

export async function diagnoseTenantWhatsApp(pool,actor,{
 env=process.env,getStatus=getSessionStatus
}={}){
 const tenantId=actor?.active_tenant_id;
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(tenantId||'')))
  throw Object.assign(new Error('Empresa inválida.'),{status:403});
 const [gateway,recent,internal,agent,assigned]=await Promise.all([
  auditLiveWhatsAppBindings(pool,{tenantId,env,getStatus}),
  pool.query(
   "SELECT COUNT(*)::int AS n FROM messages m "+
   "JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id "+
   "JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=c.tenant_id "+
   "WHERE m.tenant_id=$1 AND ch.provider='waakg' AND m.direction='inbound' "+
   "AND m.created_at>=now()-interval '24 hours'",[tenantId]),
  pool.query(
   "SELECT COUNT(DISTINCT c.id)::int AS n FROM conversations c "+
   "JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=c.tenant_id "+
   "JOIN users u ON u.tenant_id=c.tenant_id AND u.active=true "+
   "AND u.role IN ('owner','admin') AND u.phone IS NOT NULL "+
   "AND regexp_replace(u.phone,'[^0-9]','','g')=c.customer_phone "+
   "WHERE c.tenant_id=$1 AND ch.provider='waakg'",[tenantId]),
  pool.query('SELECT enabled FROM agents WHERE tenant_id=$1',[tenantId]),
  pool.query("SELECT COUNT(*)::int AS n FROM conversation_ui_state "+
   "WHERE tenant_id=$1 AND handling_mode='ai_assist'",[tenantId])
 ]);
 const ingestion=Number(recent.rows?.[0]?.n||0);
 const ownerChats=Number(internal.rows?.[0]?.n||0);
 const agentEnabled=agent.rows?.[0]?.enabled===true;
 const flags={
  liveSyncEnabled:env.SOCIO_LIVE_SYNC_ENABLED!=='false',
  outboundEnabled:outboundEnabled(env),
  autoReplyEnabled:canAutoReply(env)&&groqReady(env),
  agentEnabled
 };
 const blockers=[];
 if(!gateway.verified)blockers.push('Nenhum número vinculado à empresa foi confirmado como conectado pelo gateway.');
 if(!flags.liveSyncEnabled)blockers.push('A importação automática do WhatsApp está desativada.');
 if(!ingestion)blockers.push('Nenhuma mensagem recebida foi registrada nas últimas 24 horas; isso não comprova falha.');
 if(!ownerChats)blockers.push('Não há conversa com telefone de proprietário/admin cadastrado para um teste interno.');
 if(!flags.agentEnabled)blockers.push('A IA desta empresa está desabilitada ou não foi configurada.');
 if(!flags.outboundEnabled)blockers.push('O envio de mensagens pelo Sócio está desabilitado.');
 if(!flags.autoReplyEnabled)blockers.push('As respostas automáticas não estão habilitadas no servidor.');
 return {
  readOnly:true,checkedAt:new Date().toISOString(),gateway,
  inboundLast24h:ingestion,internalOwnerConversations:ownerChats,
  aiAssignedConversations:Number(assigned.rows?.[0]?.n||0),
  flags,blockers,
  readOnlyGatewayReady:gateway.verified>0&&flags.liveSyncEnabled,
  liveReplyTestReady:gateway.verified>0&&flags.outboundEnabled&&flags.autoReplyEnabled&&
   flags.agentEnabled&&ownerChats>0,
  noMessagesSent:true,noCampaignsChanged:true,
  note:'Esta verificação não acessa o texto das conversas e não envia WhatsApp. A existência de conversa de proprietário não autoriza envio sem conferência do destino de teste.'
 };
}
