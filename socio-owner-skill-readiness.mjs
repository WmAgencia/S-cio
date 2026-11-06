// Read-only, tenant-scoped WA-AKG command readiness diagnostic.
// Does not start sessions, send messages, toggle workers, upload media or create ads.
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {getSessionStatus,validSessionId} from './waakg-adapter.mjs';

export async function ownerWhatsAppReadiness(pool,actor,{env=process.env,getStatus=getSessionStatus}={}){
 requirePermission(actor,'marketing.manage');
 assertApiFeature(actor.features,'/api/marketing/skills/chat');
 assertApiFeature(actor.features,'/api/agent');
 assertApiFeature(actor.features,'/api/inbox');
 if(actor.tenant_status==='paused')throw Object.assign(new Error('Empresa pausada.'),{status:403});
 const tenantId=actor.active_tenant_id;
 const [channels,owners]=await Promise.all([
  pool.query("SELECT ch.id,ch.status,ch.phone,l.session_id FROM channels ch "+
   "LEFT JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
   "WHERE ch.tenant_id=$1 AND ch.provider='waakg' ORDER BY ch.id LIMIT 20",[tenantId]),
  pool.query("SELECT COUNT(*)::int AS matches FROM ("+
   " SELECT c.id FROM conversations c JOIN channels ch ON ch.id=c.channel_id "+
   " AND ch.tenant_id=c.tenant_id AND ch.provider='waakg' "+
   " JOIN users u ON u.tenant_id=c.tenant_id AND u.active=true "+
   " AND u.role IN ('owner','admin') AND u.phone IS NOT NULL "+
   " AND regexp_replace(u.phone,'[^0-9]','','g')=c.customer_phone "+
   " WHERE c.tenant_id=$1 AND c.customer_phone ~ '^[0-9]{10,15}$' "+
   " GROUP BY c.id HAVING COUNT(u.id)=1"+
   ") verified",[tenantId])
 ]);
 const flags={
  commands:env.SOCIO_OWNER_COMMANDS_ENABLED==='true',
  media:env.SOCIO_OWNER_MEDIA_ENABLED==='true',
  audio:env.SOCIO_OWNER_AUDIO_ENABLED==='true',
  outbound:env.SOCIO_OUTBOUND_ENABLED==='true',
  pilotTenant:env.SOCIO_OWNER_MEDIA_TENANT_ID===tenantId,
  speechProviderConfigured:Boolean(env.GROQ_API_KEY&&env.GROQ_API_KEY.length>=20)
 };
 const selected=(channels.rows||[]).filter(ch=>ch.status==='connected'&&validSessionId(ch.session_id)).slice(0,10);
 let gatewayConnected=0,gatewayMismatch=0,gatewayUnreachable=0;
 for(const ch of selected){
  try{
   const live=await getStatus(ch.session_id,{env});
   if(live.connected&&live.connectedNumber&&live.connectedNumber===String(ch.phone||'').replace(/\D/g,''))gatewayConnected++;
   else gatewayMismatch++;
  }catch{gatewayUnreachable++;}
 }
 const matchedConversations=Number(owners.rows?.[0]?.matches||0);
 const blockers=[];
 if(!channels.rows?.length)blockers.push('Nenhum canal WA-AKG vinculado a esta empresa.');
 if(!selected.length)blockers.push('Nenhum canal WA-AKG está marcado como conectado e com sessão válida.');
 if(selected.length&&!gatewayConnected)blockers.push('O WA-AKG não confirmou uma sessão conectada ao número do canal.');
 if(!matchedConversations)blockers.push('Não há conversa privada de proprietário/admin com telefone único verificado no tenant.');
 if(!flags.outbound)blockers.push('O envio de respostas pelo gateway está desabilitado.');
 if(!flags.commands)blockers.push('O processamento de comandos do proprietário está desabilitado.');
 // Media and audio are optional, but must be enabled for full image/voice workflow.
 const textReady=blockers.length===0;
 const photoReady=textReady&&flags.media&&flags.pilotTenant;
 const audioReady=photoReady&&flags.audio&&flags.speechProviderConfigured;
 return {
  readOnly:true,tenantScoped:true,
  channels:(channels.rows||[]).length,connectedSessions:gatewayConnected,
  sessionProblems:gatewayMismatch+gatewayUnreachable,
  verifiedOwnerConversations:matchedConversations,
  textReady,photoReady,audioReady,
  settings:{commandsEnabled:flags.commands,mediaEnabled:flags.media,
   audioEnabled:flags.audio,outboundEnabled:flags.outbound,pilotTenantSelected:flags.pilotTenant,
   transcriptionConfigured:flags.speechProviderConfigured},
  blockers,
  nextStep:!gatewayConnected?'Conecte e valide um número pelo WA-AKG antes de habilitar os workers.':
   !matchedConversations?'Envie uma mensagem privada do telefone do proprietário cadastrado, para criar a conversa verificada.':
   !textReady?'Habilite apenas o piloto autorizado após testar o envio e a deduplicação.':
   !photoReady?'Teste fotos com tenant piloto e habilitação específica após aprovação.':
   !audioReady?'Teste áudio e autorize a transcrição por IA antes de habilitar.':
   'Pronto para homologação controlada de texto, foto e áudio; grupos ainda não estão suportados.',
  note:'Diagnóstico somente leitura. Grupos não são aceitos; aprovação de gastos por áudio não é aceita. Nenhuma sessão, mensagem, Pixel ou campanha foi alterada.'
 };
}
