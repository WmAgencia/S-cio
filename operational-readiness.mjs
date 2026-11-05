// Sócio — tenant-scoped operational readiness.
// Distinguish configured, verified and tested: never claim live WhatsApp
// delivery, payment, voice or Groq responses without actual evidence.
import {getSessionStatus} from './waakg-adapter.mjs';
import {groqReady,groqModel} from './groq-client.mjs';
import {outboundEnabled,canAutoReply} from './socio-outbound.mjs';

export async function getOperationalReadiness(pool,tenantId,{
 getStatus=getSessionStatus,env=process.env
}={}){
 const [channels,agent,versions,products] = await Promise.all([
  pool.query("SELECT ch.id,ch.label,ch.phone,ch.status,l.session_id FROM channels ch "+
   "LEFT JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
   "WHERE ch.tenant_id=$1 AND ch.provider='waakg' ORDER BY ch.created_at DESC LIMIT 30",[tenantId]),
  pool.query("SELECT enabled FROM agents WHERE tenant_id=$1",[tenantId]),
  pool.query("SELECT status,version FROM training_versions WHERE tenant_id=$1 "+
   "AND status='approved' ORDER BY version DESC LIMIT 1",[tenantId]),
  pool.query("SELECT COUNT(*)::int AS n FROM products WHERE tenant_id=$1 AND active=true",[tenantId])
 ]);
 const linked=channels.rows.filter(c=>Boolean(c.session_id));
 let confirmed=0,unreachable=0;
 const checked=[];
 for(const c of linked.slice(0,10)){
  try{
   const remote=await getStatus(c.session_id,{timeoutMs:4500});
   const match=remote.connected&&remote.connectedNumber===
    String(c.phone||'').replace(/\D/g,'');
   if(match)confirmed++;
   checked.push({channelId:c.id,label:c.label,
    verified:!!match,status:match?'connected':'not_connected'});
  }catch{
   unreachable++;
   checked.push({channelId:c.id,label:c.label,
    verified:false,status:'gateway_unavailable'});
  }
 }
 const aiPrepared=agent.rows[0]?.enabled===true;
 const knowledgeApproved=versions.rowCount>0;
 const groqConfigured=groqReady(env);
 const outgoingConfigured=outboundEnabled(env);
 const autoConfigured=canAutoReply(env);
 const items=[
  {id:'whatsapp',label:'WhatsApp conectado',status:confirmed?'verified':'action_required',
   detail:confirmed?confirmed+' número(s) confirmado(s) pelo gateway':
    linked.length?unreachable?'Gateway não respondeu à verificação':'Conexão pendente ou divergente':'Nenhum número vinculado'},
  {id:'groq',label:'Groq configurado',status:groqConfigured?'configured':'action_required',
   detail:groqConfigured?'Chave presente; faça uma chamada real no teste':'Configure GROQ_API_KEY no Railway',
   model:groqModel(env)},
  {id:'agent',label:'Agente preparado',status:aiPrepared?'configured':'action_required',
   detail:aiPrepared?'Agente habilitado para as conversas autorizadas':'Habilite o agente em Personalidade e testes'},
  {id:'knowledge',label:'Conhecimento aprovado',status:knowledgeApproved?'verified':'action_required',
   detail:knowledgeApproved?'Markdown aprovado, versão '+versions.rows[0].version:'Treine e aprove o Markdown'},
  {id:'catalog',label:'Catálogo disponível',status:products.rows[0]?.n>0?'configured':'action_required',
   detail:products.rows[0]?.n>0?products.rows[0].n+' produto(s) ativo(s)':'Cadastre produtos e serviços'},
  {id:'outbound',label:'Envio humano habilitado',status:outgoingConfigured?'configured':'action_required',
   detail:outgoingConfigured?'Configurado, mas ainda requer teste com celular':'Envio controlado desabilitado'},
  {id:'automatic',label:'Atendimento automático',status:autoConfigured&&aiPrepared&&confirmed?'configured':'action_required',
   detail:autoConfigured?'Depende do modo IA em cada conversa e de uma mensagem nova':'Faltam condições da automação Groq'}
 ];
 return {checkedAt:new Date().toISOString(),tenantId,
  numbers:{registered:channels.rowCount,linked:linked.length,verified:confirmed,
   checked:checked.length,unreachable,partial:linked.length>10},
  groq:{configured:groqConfigured,model:groqModel(env),tested:false},
  agent:{enabled:aiPrepared,knowledgeApproved,approvedVersion:versions.rows[0]?.version||null},
  catalog:{activeProducts:products.rows[0]?.n||0},
  flags:{humanSendConfigured:outgoingConfigured,aiAutomationConfigured:autoConfigured,
   incrementalSyncConfigured:env.SOCIO_LIVE_SYNC_ENABLED!=='false'},
  checks:items};
}
