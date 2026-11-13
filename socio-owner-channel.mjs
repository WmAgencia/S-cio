// Owner channel: one WhatsApp group per company, named "Meu Sócio".
// The owner sends commands there; Sócio answers in the same group and only
// creates or activates campaigns after an explicit confirmation. Nothing here
// trusts a sender: the group is created by the connected number and bound to
// the tenant, and only messages from that group are read.
import {randomUUID,createHash} from 'node:crypto';
import {gatewayCreateGroup,loadGroupMessages,getSessionStatus} from './waakg-adapter.mjs';
import {sendGatewayMessage,mediaPayload} from './socio-outbound.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {prepareAdsPlan,executeAdsPlan,uploadAdVideo} from './meta-ads-tools.mjs';
import {downloadVerifiedWhatsAppVideo} from './socio-whatsapp-meta-video.mjs';
import {groqResponse,groqReady} from './groq-client.mjs';
import {runTrafficManager,approveTrafficDecisions} from './socio-traffic-manager.mjs';

export const OWNER_GROUP_SUBJECT='Meu Sócio';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const clean=(value,max=4000)=>{
 const text=typeof value==='string'?value:'';
 return text.replace(/[\u0000-\u0008\u000e-\u001f]/g,'').trim().slice(0,max);
};
const digits=value=>String(value||'').replace(/\D/g,'');
const MAX_REPLY=2800;
const CONFIRM=/^(sim|confirmo|confirmar|confirma|pode (criar|ativar|subir|mandar|executar)|manda ver|autorizo|ok)\b/i;
const CANCEL=/^(n[ãa]o|cancela|cancelar|para|pare)\b/i;
const ACTIVATE=/^(ativar|ativa|ligar|liga|colocar no ar|publicar|rodar)\b/i;
const CAMPAIGN=/an[uú]ncio|campanha|divulgar|promover|impulsionar|subir (esse|este|o) v[íi]deo/i;
const STATUS=/^(status|como (est[áa]|estamos)|resumo|relat[óo]rio)\b/i;
const HELP=/^(ajuda|comandos|o que voc[êe] (faz|pode)|oi|ol[áa])\b/i;
const TRAFFIC=/^(tr[áa]fego|otimizar|otimiza|campanhas|como est[ãa]o (as )?campanhas|an[áa]lise)\b/i;
const APPROVE=/^(aprovar|aprovo|pode aplicar|autorizo a mudan[çc]a)\b/i;

export const ownerDestination=group=>{
 const value=digits(group?.whatsapp_destination||group?.channel_phone);
 return /^55[1-9]\d{9,10}$/.test(value)?value:null;
};
export const missingOwnerSettings=group=>{
 const missing=[];
 if(!group?.ad_page_id)missing.push('Página do Facebook');
 if(!group?.ad_city_key||!group?.ad_city_name)missing.push('cidade da campanha');
 if(!group?.ad_daily_budget_cents)missing.push('orçamento diário');
 if(!ownerDestination(group))missing.push('WhatsApp de destino');
 return missing;
};

async function actorFor(pool,tenantId){
 const found=await pool.query(
  "SELECT u.id AS user_id,u.role,u.platform_owner,t.id AS active_tenant_id,"+
  "t.status AS tenant_status,t.features,t.name AS tenant_name "+
  "FROM tenants t JOIN users u ON u.tenant_id=t.id AND u.active=true "+
  "WHERE t.id=$1 ORDER BY (u.role='owner') DESC,u.created_at,u.id LIMIT 1",[tenantId]);
 if(!found.rowCount)throw fail(409,'A empresa não tem um usuário ativo.');
 return found.rows[0];
}

async function groupFor(pool,groupId){
 const found=await pool.query(
  "SELECT g.*,ch.phone AS channel_phone,l.session_id "+
  "FROM socio_owner_groups g "+
  "JOIN channels ch ON ch.id=g.channel_id AND ch.tenant_id=g.tenant_id "+
  "JOIN waakg_links l ON l.channel_id=g.channel_id AND l.tenant_id=g.tenant_id "+
  "WHERE g.id=$1 LIMIT 1",[groupId]);
 return found.rows[0]||null;
}

async function replyIn(group,text,{env=process.env,send=sendGatewayMessage}={}){
 const body=clean(text,MAX_REPLY);
 if(!body)return {sent:false};
 return send({sessionId:group.session_id,jid:group.group_jid,text:body,env});
}

// Product photos and other media the owner asked Sócio to forward.
export async function sendOwnerMedia(pool,tenantId,{kind,url,caption=''},{env=process.env,send=sendGatewayMessage}={}){
 const group=await activeGroupFor(pool,tenantId);
 if(!group)return {sent:false,reason:'no_group'};
 const media=mediaPayload({kind,url,caption},env);
 return send({sessionId:group.session_id,jid:group.group_jid,media,env});
}

async function activeGroupFor(pool,tenantId){
 const found=await pool.query(
  "SELECT g.group_jid,g.subject,l.session_id FROM socio_owner_groups g "+
  "JOIN waakg_links l ON l.channel_id=g.channel_id AND l.tenant_id=g.tenant_id "+
  "WHERE g.tenant_id=$1 AND g.status='active' ORDER BY g.created_at LIMIT 1",[tenantId]);
 return found.rows[0]||null;
}

export async function notifyOwner(pool,tenantId,text,{env=process.env,send=sendGatewayMessage}={}){
 const group=await activeGroupFor(pool,tenantId);
 if(!group)return {sent:false,reason:'no_group'};
 return replyIn(group,text,{env,send});
}

// ---------------------------------------------------------------------------
// Dashboard surface
// ---------------------------------------------------------------------------

const channelSelect=
 "SELECT g.id,g.channel_id AS \"channelId\",g.subject,g.status,g.error_code AS \"errorCode\","+
 "g.ad_page_id AS \"pageId\",g.ad_city_key AS \"cityKey\",g.ad_city_name AS \"cityName\","+
 "g.ad_daily_budget_cents AS \"dailyBudgetCents\",g.ad_age_min AS \"ageMin\",g.ad_age_max AS \"ageMax\","+
 "g.ad_genders AS genders,g.whatsapp_destination AS \"destination\","+
 "g.last_video_id AS \"lastVideoId\",g.last_seen_at AS \"lastSeenAt\",g.created_at AS \"createdAt\","+
 "ch.phone AS \"channelPhone\" "+
 "FROM socio_owner_groups g JOIN channels ch ON ch.id=g.channel_id AND ch.tenant_id=g.tenant_id ";

export async function readOwnerChannel(pool,tenantId){
 const [group,commands]=await Promise.all([
  pool.query(channelSelect+'WHERE g.tenant_id=$1 ORDER BY g.created_at DESC LIMIT 1',[tenantId]),
  pool.query(
   'SELECT id,kind,state,error_code AS "errorCode",created_at AS "createdAt" FROM socio_owner_commands '+
   'WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20',[tenantId])
 ]);
 const row=group.rows[0]||null;
 if(!row)return {group:null,commands:commands.rows,missing:['WhatsApp conectado']};
 return {group:row,commands:commands.rows,
  missing:missingOwnerSettings({ad_page_id:row.pageId,ad_city_key:row.cityKey,
   ad_city_name:row.cityName,ad_daily_budget_cents:row.dailyBudgetCents,
   channel_phone:row.channelPhone,whatsapp_destination:row.destination})};
}

const SETTINGS_ERROR='Configuração do canal inválida.';
export async function updateOwnerChannelSettings(pool,actor,data){
 if(!['owner','admin'].includes(String(actor?.role))&&!actor?.platform_owner)
  throw fail(403,'Somente o dono da empresa pode configurar o canal.');
 const tenantId=actor.active_tenant_id;
 const current=await pool.query(channelSelect+'WHERE g.tenant_id=$1 ORDER BY g.created_at DESC LIMIT 1',[tenantId]);
 const node=current.rows[0];
 if(!node)throw fail(409,'Conecte um WhatsApp antes de configurar o canal.');
 const updates=[],values=[tenantId];
 const push=(column,value)=>{values.push(value);updates.push(column+'=$'+values.length);};
 const pageId=value=>value==null?'':String(value).trim();
 if('pageId' in data){
  const value=pageId(data.pageId);
  if(value&&!/^[0-9]{4,30}$/.test(value))throw fail(422,'Página do Facebook inválida.');
  push('ad_page_id',value||null);
 }
 if('cityKey' in data||'cityName' in data){
  const key=String(data.cityKey||'').trim(),name=clean(data.cityName,100);
  if(!key||!name||!/^[0-9]{4,30}$/.test(key))throw fail(422,'Escolha a cidade da campanha.');
  push('ad_city_key',key);push('ad_city_name',name);
 }
 if('dailyBudgetCents' in data){
  const value=Number(data.dailyBudgetCents);
  if(!Number.isInteger(value)||value<100||value>10000000)throw fail(422,'Orçamento diário inválido.');
  push('ad_daily_budget_cents',value);
 }
 const ageMin='ageMin' in data?Number(data.ageMin):Number(node.ageMin);
 const ageMax='ageMax' in data?Number(data.ageMax):Number(node.ageMax);
 if('ageMin' in data||'ageMax' in data){
  if(!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<18||ageMax>65||ageMin>ageMax)
   throw fail(422,'Faixa de idade inválida.');
  push('ad_age_min',ageMin);push('ad_age_max',ageMax);
 }
 if('genders' in data){
  const list=Array.isArray(data.genders)?[...new Set(data.genders.map(Number))]:null;
  if(!list||list.some(g=>![1,2].includes(g)))throw fail(422,SETTINGS_ERROR);
  push('ad_genders','{'+list.join(',')+'}');
 }
 if('destination' in data){
  const value=digits(data.destination);
  if(value&&!/^55[1-9]\d{9,10}$/.test(value))throw fail(422,'WhatsApp de destino inválido. Use DDI+DDD+número.');
  push('whatsapp_destination',value||null);
 }
 if(!updates.length)throw fail(422,'Nada para atualizar.');
 const saved=await pool.query(
  'UPDATE socio_owner_groups SET '+updates.join(',')+',updated_at=now() WHERE tenant_id=$1 RETURNING id',values);
 if(!saved.rowCount)throw fail(404,'Canal do dono não encontrado.');
 return readOwnerChannel(pool,tenantId);
}

export async function retryOwnerGroup(pool,tenantId,{env=process.env,create=gatewayCreateGroup,
 status=getSessionStatus,send=sendGatewayMessage}={}){
 if(await activeGroupFor(pool,tenantId))return {created:false,reason:'already_active'};
 const found=await pool.query(
  "SELECT ch.id AS channel_id,ch.tenant_id,ch.phone,ch.label,l.session_id "+
  "FROM channels ch JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
  "WHERE ch.tenant_id=$1 AND ch.provider='waakg' AND ch.status='connected' "+
  "ORDER BY ch.created_at DESC LIMIT 1",[tenantId]);
 if(!found.rowCount)throw fail(409,'Conecte um WhatsApp antes de criar o grupo.');
 try{
  return await provisionOne(pool,found.rows[0],{env,create,status,send});
 }catch(error){
  const code=String(error?.status||error?.code||'PROVISION_FAILED').slice(0,40);
  await saveGroup(pool,{tenantId,channelId:found.rows[0].channel_id,
   status:'failed',errorCode:code}).catch(()=>{});
  throw error;
 }
}

// 24/7 autopilot: same decisions the owner would trigger with TRAFEGO, sent
// to the group when something was applied or needs approval.
export async function runOwnerTrafficAutopilot(pool,tenantId,{env=process.env,
 traffic=runTrafficManager,notify=notifyOwner}={}){
 const actor=await actorFor(pool,tenantId);
 const result=await traffic(pool,actor,{env});
 if(result.executed?.length||result.pending?.length)await notify(pool,tenantId,result.report,{env});
 return result;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

async function participantsFor(pool,tenantId,excludePhone){
 const found=await pool.query(
  'SELECT phone FROM users WHERE tenant_id=$1 AND active=true AND phone IS NOT NULL ORDER BY created_at',
  [tenantId]);
 const seen=new Set();
 for(const row of found.rows){
  const phone=digits(row.phone);
  if(!/^\d{10,15}$/.test(phone)||phone===excludePhone||seen.has(phone))continue;
  seen.add(phone);
 }
 return [...seen].map(phone=>phone+'@s.whatsapp.net');
}

async function saveGroup(pool,{tenantId,channelId,groupJid=null,subject,status,errorCode=null}){
 await pool.query(
  "INSERT INTO socio_owner_groups(id,tenant_id,channel_id,group_jid,subject,status,error_code) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7) "+
  "ON CONFLICT (tenant_id,channel_id) DO UPDATE SET group_jid=EXCLUDED.group_jid,"+
  "subject=EXCLUDED.subject,status=EXCLUDED.status,error_code=EXCLUDED.error_code,updated_at=now()",
  [randomUUID(),tenantId,channelId,groupJid,
   clean(subject,100)||OWNER_GROUP_SUBJECT,status,errorCode]);
}

export async function provisionOwnerGroups(pool,{env=process.env,create=gatewayCreateGroup,
 status=getSessionStatus,send=sendGatewayMessage,limit=3}={}){
 const candidates=await pool.query(
  "SELECT ch.id AS channel_id,ch.tenant_id,ch.phone,ch.label,l.session_id "+
  "FROM channels ch JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
  "WHERE ch.provider='waakg' AND ch.status='connected' "+
  "AND NOT EXISTS(SELECT 1 FROM socio_owner_groups g WHERE g.tenant_id=ch.tenant_id "+
  "AND g.channel_id=ch.id AND g.status='active') "+
  "AND NOT EXISTS(SELECT 1 FROM socio_owner_groups g WHERE g.tenant_id=ch.tenant_id "+
  "AND g.channel_id=ch.id AND g.updated_at>now()-interval '5 minutes') "+
  "ORDER BY ch.created_at LIMIT $1",[limit]);
 const results=[];
 for(const channel of candidates.rows){
  try{
   results.push(await provisionOne(pool,channel,{env,create,status,send}));
  }catch(error){
   const code=String(error?.status||error?.code||'PROVISION_FAILED').slice(0,40);
   await saveGroup(pool,{tenantId:channel.tenant_id,channelId:channel.channel_id,
    status:'failed',errorCode:code}).catch(()=>{});
   results.push({channelId:channel.channel_id,created:false,error:code});
  }
 }
 return {checked:candidates.rowCount,groups:results};
}

async function provisionOne(pool,channel,{env,create,status,send}){
 const remote=await status(channel.session_id,{env});
 if(!remote?.connected||digits(remote.connectedNumber)!==digits(channel.phone))
  throw fail(409,'WhatsApp desconectado ou número divergente.');
 const participants=await participantsFor(pool,channel.tenant_id,digits(channel.phone));
 if(!participants.length){
  await saveGroup(pool,{tenantId:channel.tenant_id,channelId:channel.channel_id,
   status:'waiting_owner_phone',errorCode:'OWNER_PHONE_REQUIRED'});
  return {channelId:channel.channel_id,created:false,reason:'owner_phone_required'};
 }
 const created=await create(channel.session_id,OWNER_GROUP_SUBJECT,participants,{env});
 await saveGroup(pool,{tenantId:channel.tenant_id,channelId:channel.channel_id,
  groupJid:created.jid,subject:created.subject||OWNER_GROUP_SUBJECT,status:'active'});
 const group={group_jid:created.jid,session_id:channel.session_id};
 await replyIn(group,[
  'Olá! Eu sou o Sócio. Este grupo é o nosso canal de comando.',
  '',
  '1) Envie o vídeo que quer anunciar.',
  '2) Eu monto a campanha e mando o resumo aqui.',
  '3) Você responde CONFIRMA para eu criar (o anúncio fica pausado).',
  '4) Diga ATIVAR quando quiser começar a veicular.',
  '',
  'Digite AJUDA para ver todos os comandos.'
 ].join('\n'),{env,send}).catch(()=>{});
 return {channelId:channel.channel_id,created:true,groupJid:created.jid};
}

// ---------------------------------------------------------------------------
// Reading the group
// ---------------------------------------------------------------------------

function messageKind(message){
 const type=String(message?.type||'').toLowerCase();
 if(/sticker|audio|ptt|document|reaction|protocol|poll|contact|location/.test(type))return 'other';
 if(/video/.test(type))return 'video';
 if(/image|photo/.test(type))return 'image';
 return clean(message?.content,4000)?'text':'other';
}
const looksLikeCaption=value=>{
 const text=clean(value,1024);
 return Boolean(text)&&!/^[a-z0-9_.\-/\\]+\.(mp4|jpe?g|png|webp|gif)$/i.test(text);
};

export async function pollOwnerGroups(pool,{env=process.env,read=loadGroupMessages,limit=20}={}){
 const groups=await pool.query(
  "SELECT g.id,g.tenant_id,g.group_jid,l.session_id "+
  "FROM socio_owner_groups g "+
  "JOIN channels ch ON ch.id=g.channel_id AND ch.tenant_id=g.tenant_id "+
  "JOIN waakg_links l ON l.channel_id=g.channel_id AND l.tenant_id=g.tenant_id "+
  "WHERE g.status='active' AND ch.provider='waakg' AND ch.status='connected' "+
  "ORDER BY g.last_seen_at NULLS FIRST LIMIT $1",[limit]);
 let stored=0;
 for(const group of groups.rows){
  let messages;
  try{messages=await read(group.session_id,group.group_jid,{env,limit:100});}
  catch{continue;}
  for(const message of messages){
   if(message?.fromMe===true)continue;
   const providerMessageId=clean(message?.keyId,180);
   if(providerMessageId.length<4)continue;
   const kind=messageKind(message);
   if(kind==='other')continue;
   const body=kind==='text'?clean(message.content,4000)
    :looksLikeCaption(message.content)?clean(message.content,1024):null;
   const inserted=await pool.query(
    "INSERT INTO socio_owner_commands(id,tenant_id,group_id,provider_message_id,sender_jid,kind,body,media_message_id) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,provider_message_id) DO NOTHING",
    [randomUUID(),group.tenant_id,group.id,providerMessageId,
     clean(message.participant||message.senderJid||'',80)||null,kind,body,
     kind==='video'||kind==='image'?providerMessageId:null]);
   stored+=inserted.rowCount;
  }
  await pool.query('UPDATE socio_owner_groups SET last_seen_at=now(),updated_at=now() WHERE id=$1',[group.id]);
 }
 return {groups:groups.rowCount,stored};
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

const done=(pool,command,extra={})=>pool.query(
 "UPDATE socio_owner_commands SET state='done',reply=$2,context=context||$3::jsonb,error_code=NULL,updated_at=now() WHERE id=$1",
 [command.id,clean(extra.reply,MAX_REPLY)||null,JSON.stringify(extra.context||{})]);
const waitForConfirmation=(pool,command,context,reply)=>pool.query(
 "UPDATE socio_owner_commands SET state='awaiting_confirmation',reply=$2,context=context||$3::jsonb,updated_at=now() WHERE id=$1",
 [command.id,clean(reply,MAX_REPLY),JSON.stringify(context)]);
const resetForSettings=(pool,command,reply)=>pool.query(
 "UPDATE socio_owner_commands SET state='awaiting_settings',reply=$2,updated_at=now() WHERE id=$1",
 [command.id,clean(reply,MAX_REPLY)]);
const retryLater=(pool,command,seconds)=>pool.query(
 "UPDATE socio_owner_commands SET state='preparing',next_attempt_at=now()+($2||' seconds')::interval,updated_at=now() WHERE id=$1",
 [command.id,String(seconds)]);
const failCommand=(pool,command,reply,code)=>pool.query(
 "UPDATE socio_owner_commands SET state='failed',reply=$2,error_code=$3,updated_at=now() WHERE id=$1",
 [command.id,clean(reply,MAX_REPLY)||null,clean(code,40)||'FAILED']);

export async function processOwnerCommands(pool,{env=process.env,send=sendGatewayMessage,
 prepare=prepareAdsPlan,execute=executeAdsPlan,upload=uploadAdVideo,
 download=downloadVerifiedWhatsAppVideo,resolve=resolveSelectedOfficialAccount,
 copy=draftAdCopy,traffic=runTrafficManager,approveTraffic=approveTrafficDecisions}={}){
 await pool.query(
  "UPDATE socio_owner_commands SET state='received',updated_at=now() "+
  "WHERE state='working' AND updated_at<now()-interval '5 minutes' AND attempts<3");
 await pool.query(
  "UPDATE socio_owner_commands SET state='failed',error_code='STALLED',updated_at=now() "+
  "WHERE state='working' AND updated_at<now()-interval '5 minutes' AND attempts>=3");
 const claimed=await pool.query(
  "UPDATE socio_owner_commands SET state='working',attempts=attempts+1,updated_at=now() "+
  "WHERE id=(SELECT id FROM socio_owner_commands "+
  "WHERE state IN ('received','preparing') AND next_attempt_at<=now() "+
  "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *");
 if(!claimed.rowCount)return {processed:false};
 const command=claimed.rows[0];
 const group=await groupFor(pool,command.group_id);
 if(!group||group.status!=='active'){
  await failCommand(pool,command,null,'GROUP_UNAVAILABLE');
  return {processed:false};
 }
 try{
  const handled=await handleCommand(pool,group,command,{env,send,prepare,execute,upload,download,resolve,copy,traffic,approveTraffic});
  return {processed:true,kind:command.kind,handled};
 }catch(error){
  const code=String(error?.status||error?.code||'ERROR').slice(0,40);
  const message=String(error?.message||'Não consegui concluir esta operação.');
  const retryable=/vídeo está pronto|terminou de processar|confirmar se o vídeo/i.test(message)&&command.attempts<20;
  if(retryable){
   await retryLater(pool,command,20);
   return {processed:true,retry:true};
  }
  await failCommand(pool,command,'Não consegui concluir: '+message,code);
  await replyIn(group,'Não consegui concluir: '+message,{env,send}).catch(()=>{});
  return {processed:true,failed:true};
 }
}

async function handleCommand(pool,group,command,deps){
 if(command.kind==='image'){
  await done(pool,command);
  await replyIn(group,'Por enquanto eu crio campanhas com vídeo. Envie o vídeo que você quer anunciar.',deps);
  return 'image';
 }
 if(command.kind!=='text'){
  await handleVideo(pool,group,command,deps);
  return 'video';
 }
 const text=clean(command.body,4000);
 if(CONFIRM.test(text))return confirmPending(pool,group,command,deps);
 if(CANCEL.test(text))return cancelPending(pool,group,command,deps);
 if(ACTIVATE.test(text))return activateCampaign(pool,group,command,deps);
 if(STATUS.test(text))return statusReply(pool,group,command,deps);
 if(APPROVE.test(text))return approveCommand(pool,group,command,deps);
 if(TRAFFIC.test(text))return trafficCommand(pool,group,command,deps);
 if(CAMPAIGN.test(text))return campaignIntent(pool,group,command,deps);
 await done(pool,command);
 await replyIn(group,helpText(group),deps);
 return 'help';
}

function helpText(group){
 const missing=missingOwnerSettings(group);
 return [
  'Eu cuido do seu tráfego. Comandos:',
  '',
  '• Envie um vídeo — eu monto a campanha e peço sua confirmação.',
  '• CONFIRMA — cria a campanha que está esperando.',
  '• ATIVAR — liga a última campanha criada.',
  '• TRÁFEGO — analisa as campanhas e otimiza dentro do limite automático.',
  '• APROVAR — aplica as mudanças que estão esperando a sua autorização.',
  '• CANCELAR — descarta a campanha antes de criar.',
  '• STATUS — mostra o que está pendente.',
  '• AJUDA — esta lista.',
  missing.length?'\nAntes de criar campanhas, configure no Sócio: '+missing.join(', ')+'.':''
 ].filter(Boolean).join('\n');
}

async function statusReply(pool,group,command,deps){
 const pending=await pool.query(
  "SELECT state,kind,created_at FROM socio_owner_commands WHERE tenant_id=$1 AND group_id=$2 "+
  "AND state IN ('preparing','awaiting_confirmation','awaiting_settings') ORDER BY created_at DESC LIMIT 3",
  [group.tenant_id,group.id]);
 const missing=missingOwnerSettings(group);
 const lines=['Status do Sócio:'];
 lines.push('• Configuração: '+(missing.length?'faltam '+missing.join(', '):'completa'));
 lines.push('• Grupo: '+(group.status==='active'?'conectado':'aguardando conexão'));
 for(const row of pending.rows){
  lines.push('• '+({preparing:'preparando campanha',awaiting_confirmation:'campanha esperando CONFIRMA',
   awaiting_settings:'vídeo guardado, faltando configuração'}[row.state]||row.state));
 }
 const approvals=await pool.query(
  "SELECT count(*)::int AS n FROM socio_traffic_decisions WHERE tenant_id=$1 AND status='awaiting_approval'",
  [group.tenant_id]);
 if(approvals.rows[0]?.n)lines.push('• '+approvals.rows[0].n+' mudança(s) de tráfego esperando APROVAR');
 if(!pending.rowCount)lines.push('• Nada pendente agora.');
 await done(pool,command);
 await replyIn(group,lines.join('\n'),deps);
 return 'status';
}

async function trafficCommand(pool,group,command,deps){
 const actor=await actorFor(pool,group.tenant_id);
 const run=deps.traffic||runTrafficManager;
 const result=await run(pool,actor,{env:deps.env});
 await done(pool,command,{context:{traffic:true,executed:result.executed?.length||0,
  pending:result.pending?.length||0}});
 await replyIn(group,result.report,deps);
 return 'traffic';
}

async function approveCommand(pool,group,command,deps){
 const actor=await actorFor(pool,group.tenant_id);
 const approve=deps.approveTraffic||approveTrafficDecisions;
 const result=await approve(pool,actor,{env:deps.env});
 await done(pool,command,{context:{approved:result.applied?.length||0,failed:result.failed?.length||0}});
 await replyIn(group,result.report,deps);
 return 'approve';
}

async function cancelPending(pool,group,command,deps){
 const pending=await pool.query(
  "SELECT id FROM socio_owner_commands WHERE tenant_id=$1 AND group_id=$2 "+
  "AND state IN ('preparing','awaiting_confirmation') ORDER BY created_at DESC LIMIT 1",
  [group.tenant_id,group.id]);
 if(pending.rowCount)
  await pool.query("UPDATE socio_owner_commands SET state='cancelled',updated_at=now() WHERE id=$1",[pending.rows[0].id]);
 await done(pool,command);
 await replyIn(group,pending.rowCount?'Campanha cancelada. Nada foi criado na Meta.':'Não havia campanha pendente.',deps);
 return 'cancel';
}

// ---------------------------------------------------------------------------
// Video -> Meta library
// ---------------------------------------------------------------------------

async function handleVideo(pool,group,command,deps){
 const missing=missingOwnerSettings(group);
 if(missing.length){
  await pool.query('UPDATE socio_owner_groups SET last_video_message_id=$2,updated_at=now() WHERE id=$1',
   [group.id,command.media_message_id]);
  await resetForSettings(pool,command,[
   'Recebi seu vídeo e guardei. Para eu montar a campanha, falta configurar: '+missing.join(', ')+'.',
   'Você configura em Sócio › Canal do dono. Depois é só dizer "criar campanha com o vídeo que enviei".'
  ].join('\n'));
  await replyIn(group,[
   'Recebi seu vídeo e guardei.',
   'Antes de criar a campanha, preciso que você configure no Sócio: '+missing.join(', ')+'.',
   'Depois é só dizer: criar campanha com o vídeo que enviei.'
  ].join('\n'),deps);
  return 'needs_settings';
 }
 if(!command.media_message_id)throw fail(422,'Não consegui identificar o vídeo no grupo.');
 const actor=await actorFor(pool,group.tenant_id);
 const account=await deps.resolve(pool,actor,{env:deps.env});
 if(!/^act_\d{4,30}$/.test(String(account?.id||'')))
  throw fail(409,'Selecione a conta de anúncios Meta no Sócio antes de criar campanhas.');
 const hash=createHash('sha256').update(group.group_jid).digest('hex');
 const claimId=randomUUID();
 const claim=await pool.query(
  "INSERT INTO socio_whatsapp_meta_video_imports "+
  "(id,tenant_id,channel_id,user_id,account_id,provider_message_id,recipient_hash,status) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,'uploading') "+
  "ON CONFLICT (tenant_id,channel_id,account_id,provider_message_id) DO NOTHING RETURNING id",
  [claimId,group.tenant_id,group.channel_id,actor.user_id,account.id,command.media_message_id,hash]);
 if(!claim.rowCount){
  const prior=await pool.query(
   "SELECT status,meta_video_id FROM socio_whatsapp_meta_video_imports "+
   "WHERE tenant_id=$1 AND channel_id=$2 AND account_id=$3 AND provider_message_id=$4",
   [group.tenant_id,group.channel_id,account.id,command.media_message_id]);
  const videoId=prior.rows[0]?.meta_video_id||null;
  if(videoId){
   await prepareOrRetry(pool,group,command,{videoId},deps);
   return 'video_reused';
  }
  throw fail(409,'Este vídeo já teve uma tentativa de envio sem confirmação. Confira a biblioteca da Meta.');
 }
 let phase='media_download';
 try{
  const video=await deps.download({sessionId:group.session_id,messageId:command.media_message_id,env:deps.env});
  phase='meta_video_upload';
  const outcome=await deps.upload(pool,actor,video,{env:deps.env,
   title:'Sócio · '+clean(group.subject,60)});
  if(String(outcome.accountId)!==String(account.id)||!/^\d{4,30}$/.test(String(outcome.videoId||'')))
   throw Object.assign(fail(503,'A Meta não confirmou o vídeo na conta selecionada.'),{uncertain:true});
  await pool.query("UPDATE socio_whatsapp_meta_video_imports SET status='uploaded',meta_video_id=$2,updated_at=now() "+
   "WHERE id=$1 AND tenant_id=$3",[claimId,outcome.videoId,group.tenant_id]);
  await pool.query('UPDATE socio_owner_groups SET last_video_id=$2,updated_at=now() WHERE id=$1',
   [group.id,outcome.videoId]);
  await replyIn(group,'Vídeo recebido e enviado para a biblioteca da Meta. Montando a campanha...',deps);
  await prepareOrRetry(pool,group,command,{videoId:outcome.videoId},deps);
  return 'video_uploaded';
 }catch(error){
  await pool.query("UPDATE socio_whatsapp_meta_video_imports SET status=$2,updated_at=now() "+
   "WHERE id=$1 AND tenant_id=$3",
   [claimId,error?.uncertain?'uncertain':'failed',group.tenant_id]).catch(()=>{});
  if(error?.uncertain)throw Object.assign(fail(503,'A Meta não confirmou o upload. Não vou reenviar automaticamente.'),{uncertain:true});
  throw error;
 }
}

async function prepareOrRetry(pool,group,command,context,deps){
 const videoId=context.videoId;
 if(!videoId)throw fail(409,'O vídeo não está pronto na biblioteca da Meta.');
 await retryLater(pool,command,1);
 await prepareProposal(pool,group,{...command,context:{...(command.context||{}),...context}},deps);
}

// ---------------------------------------------------------------------------
// Campaign proposal
// ---------------------------------------------------------------------------

export async function draftAdCopy(pool,{tenantId,tenantName,env=process.env,fetchImpl=fetch}={}){
 const products=await pool.query(
  'SELECT name,description,price_cents FROM products WHERE tenant_id=$1 AND active=true ORDER BY created_at LIMIT 5',
  [tenantId]);
 const first=products.rows[0];
 const price=first?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
  .format(first.price_cents/100):null;
 const fallback={
  headline:clean(first?.name||tenantName,60)||'Fale com a gente',
  message:first
   ?`${tenantName}: ${first.name}${price?' por '+price:''}.\n\n${cleanString(first.description,300)||'Atendimento rápido pelo WhatsApp.'}\n\nToque em "Enviar mensagem" e fale com a gente agora.`
   :`${tenantName} atende pelo WhatsApp.\n\nToque em "Enviar mensagem" e fale com a gente agora.`,
  provider:'template'
 };
 if(!groqReady(env))return fallback;
 try{
  const result=await groqResponse({env,fetchImpl,maxOutputTokens:420,purpose:'planning',
   instructions:[
    'Você escreve anúncios para Meta Ads em português brasileiro.',
    'Responda APENAS um objeto JSON com as chaves "headline" e "message".',
    '"headline" até 40 caracteres, sem emoji, sem CAIXA ALTA, sem exclamações.',
    '"message" até 300 caracteres, tom profissional e direto, uma chamada para ação.',
    'Use somente os dados fornecidos. Nunca invente preço, prazo, desconto, garantia ou resultado.',
    'Não prometa resultados, não use superlativos e não cite números que não estejam no texto.'
   ].join('\n'),
   input:JSON.stringify({empresa:tenantName,produtos:products.rows.slice(0,3)})});
  const parsed=JSON.parse((result.reply.match(/\{[\s\S]*\}/)||[''])[0]);
  const headline=cleanString(parsed?.headline,120),message=cleanString(parsed?.message,2200);
  if(!headline||!message||headline.length<3||message.length<10)return fallback;
  return {headline,message,provider:'groq'};
 }catch{return fallback;}
}
function cleanString(value,max){
 return clean(typeof value==='string'?value:'',max).replace(/\s+/g,' ').slice(0,max);
}

async function prepareProposal(pool,group,command,deps){
 const videoId=command.context?.videoId||group.last_video_id;
 if(!videoId)throw fail(409,'O vídeo não está pronto na biblioteca da Meta.');
 const actor=await actorFor(pool,group.tenant_id);
 const destination=ownerDestination(group);
 const copy=await deps.copy(pool,{tenantId:group.tenant_id,tenantName:actor.tenant_name,env:deps.env});
 const budget=Number(group.ad_daily_budget_cents);
 const input={
  name:(cleanString(actor.tenant_name,60)||'Campanha')+' · '+new Date().toISOString().slice(0,10),
  whatsappPhone:destination,pageId:group.ad_page_id,
  cityKey:group.ad_city_key,cityName:group.ad_city_name,
  dailyBudgetCents:budget,videoId,
  headline:copy.headline,message:copy.message,
  ageMin:Number(group.ad_age_min)||18,ageMax:Number(group.ad_age_max)||65,
  genders:Array.isArray(group.ad_genders)?group.ad_genders:[]
 };
 const plan=await deps.prepare(pool,actor,'create_whatsapp',input,{env:deps.env});
 await waitForConfirmation(pool,command,{planId:plan.id,action:'create',videoId},
  'Campanha pronta para criar: '+plan.summary?.name);
 await replyIn(group,[
  'Campanha montada. Vou criar tudo PAUSADO na conta '+plan.summary?.account?.name+':',
  '',
  '• Título: '+input.headline,
  '• Texto: '+input.message,
  '• Cidade: '+group.ad_city_name,
  '• Orçamento: '+formatMoney(budget)+' por dia',
  '• Destino: WhatsApp '+destination,
  '',
  'Responda CONFIRMA para eu criar. Nada é veiculado até você dizer ATIVAR.'
 ].join('\n'),deps);
 return plan;
}

const formatMoney=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);

async function campaignIntent(pool,group,command,deps){
 const videoId=group.last_video_id;
 if(!videoId){
  await done(pool,command);
  await replyIn(group,'Ainda não tenho um vídeo seu na biblioteca da Meta. Envie o vídeo aqui no grupo.',deps);
  return 'no_video';
 }
 await prepareOrRetry(pool,group,command,{videoId},deps);
 return 'campaign';
}

// ---------------------------------------------------------------------------
// Confirmation and activation
// ---------------------------------------------------------------------------

async function confirmPending(pool,group,command,deps){
 const pending=await pool.query(
  "SELECT * FROM socio_owner_commands WHERE tenant_id=$1 AND group_id=$2 AND state='awaiting_confirmation' "+
  "AND updated_at>now()-interval '20 minutes' ORDER BY created_at DESC LIMIT 1",
  [group.tenant_id,group.id]);
 if(!pending.rowCount){
  await done(pool,command);
  await replyIn(group,'Não tenho nenhuma campanha esperando confirmação agora.',deps);
  return 'nothing_pending';
 }
 const target=pending.rows[0];
 const planId=target.context?.planId;
 if(!planId)throw fail(409,'A prévia desta campanha se perdeu. Peça novamente.');
 const actor=await actorFor(pool,group.tenant_id);
 const result=await deps.execute(pool,actor,planId,true,{env:deps.env});
 await done(pool,command,{context:{confirmedPlan:planId}});
 if(result?.status!=='succeeded'){
  const reason=clean(result?.error,300)||'A Meta não confirmou a operação.';
  await failCommand(pool,target,'Não consegui criar: '+reason,'META_'+String(result?.status||'failed').toUpperCase());
  await replyIn(group,'Não consegui criar a campanha: '+reason+
   (result?.status==='uncertain'?'\nConfira o Gerenciador de Anúncios antes de pedir de novo.':''),deps);
  return 'failed';
 }
 const created=result.result||{};
 if(target.context?.action==='activate'){
  await done(pool,target,{context:{campaignId:target.context.campaignId,activated:true}});
  await replyIn(group,'Campanha '+target.context.campaignId+' ATIVADA. Ela começa a veicular conforme o orçamento diário.',deps);
  return 'activated';
 }
 await done(pool,target,{context:{campaignId:created.campaignId||null,adsetId:created.adsetId||null,
  adId:created.adId||null,executed:true}});
 await replyIn(group,[
  'Campanha criada e PAUSADA na Meta.',
  created.campaignId?'• Campanha: '+created.campaignId:'',
  created.adsetId?'• Conjunto: '+created.adsetId:'',
  created.adId?'• Anúncio: '+created.adId:'',
  '',
  'Quando quiser começar a veicular, responda ATIVAR.'
 ].filter(Boolean).join('\n'),deps);
 return 'created';
}

async function activateCampaign(pool,group,command,deps){
 const last=await pool.query(
  "SELECT context FROM socio_owner_commands WHERE tenant_id=$1 AND group_id=$2 "+
  "AND state='done' AND context->>'campaignId' IS NOT NULL ORDER BY created_at DESC LIMIT 1",
  [group.tenant_id,group.id]);
 const campaignId=last.rows[0]?.context?.campaignId;
 if(!campaignId){
  await done(pool,command);
  await replyIn(group,'Ainda não criei nenhuma campanha para ativar.',deps);
  return 'no_campaign';
 }
 const actor=await actorFor(pool,group.tenant_id);
 const plan=await deps.prepare(pool,actor,'status',{entity:'campaign',id:campaignId,status:'ACTIVE'},{env:deps.env});
 await waitForConfirmation(pool,command,{planId:plan.id,action:'activate',campaignId},
  'Ativar campanha '+campaignId);
 await replyIn(group,[
  'Vou ATIVAR a campanha '+campaignId+'.',
  'Isso começa a gastar o orçamento diário configurado.',
  'Responda CONFIRMA para ativar.'
 ].join('\n'),deps);
 return 'activation_prepared';
}

export const __test={messageKind,looksLikeCaption,helpText,formatMoney};
