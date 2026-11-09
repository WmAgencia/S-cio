// Owner-authenticated, read-mostly WhatsApp -> Meta video library import.
// The recipient is a DESTINATION, never an owner/admin and receives no privileges.
// This creates a media asset only, never a campaign, ad or spend.
import {createHash,randomUUID} from 'node:crypto';
import {gatewayBase,gatewayRead,getSessionStatus} from './waakg-adapter.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {uploadAdVideo,checkMetaVideoFile} from './meta-ads-tools.mjs';

const fail=(status,msg)=>Object.assign(new Error(msg),{status});
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const msgId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{4,180}$/.test(s);
const maxAgeMs=30*86400000;
const maxVideoBytes=64*1024*1024;

export function brazilWhatsappDestination(raw){
 const digits=String(raw||'').replace(/\D/g,'');
 const normalized=(digits.length===10||digits.length===11)?'55'+digits:digits;
 if(!/^55[1-9]\d[2-9]\d{7,8}$/.test(normalized))
  throw fail(422,'Informe um número de WhatsApp brasileiro válido com DDD.');
 return normalized;
}
function permission(actor){
 requirePermission(actor,'marketing.manage');
 assertApiFeature(actor.features,'/api/marketing/tools');
 if(!actor.platform_owner&&!['owner','admin'].includes(actor.role))
  throw fail(403,'Somente o proprietário ou administrador pode importar vídeos do WhatsApp.');
 if(actor.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}
export async function listTenantVideoChannels(pool,a){
 permission(a);
 const found=await pool.query(
  "SELECT ch.id,ch.label,ch.phone FROM channels ch "+
  "JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
  "WHERE ch.tenant_id=$1 AND ch.provider='waakg' AND ch.status='connected' "+
  "ORDER BY ch.created_at DESC LIMIT 20",[a.active_tenant_id]);
 return {channels:found.rows.map(ch=>({id:String(ch.id),label:String(ch.label||'WhatsApp').slice(0,80),
  phone:String(ch.phone||'').replace(/\D/g,'')}))};
}
export async function verifiedSourceSession(pool,a,channelId,{getStatus=getSessionStatus,env=process.env}={}){
 permission(a);
 if(!uuid(channelId))throw fail(422,'Selecione um canal WhatsApp válido.');
 const result=await pool.query(
  "SELECT ch.id AS channel_id,ch.phone AS connected_phone,l.session_id "+
  "FROM channels ch JOIN waakg_links l ON l.channel_id=ch.id AND l.tenant_id=ch.tenant_id "+
  "WHERE ch.tenant_id=$1 AND ch.id=$2 AND ch.provider='waakg' AND ch.status='connected' "+
  "LIMIT 1",[a.active_tenant_id,channelId]);
 if(!result.rowCount)throw fail(409,'Canal WhatsApp não está conectado à empresa.');
 const source=result.rows[0];
 let status;
 try{status=await getStatus(source.session_id,{env});}
 catch{throw fail(503,'Não consegui verificar o WhatsApp conectado. Nenhum arquivo foi enviado.');}
 if(status?.connected!==true||
  String(status.connectedNumber||'').replace(/\D/g,'')!==
  String(source.connected_phone||'').replace(/\D/g,''))
  throw fail(409,'A sessão WA-AKG não confirma o mesmo número do canal conectado.');
 return source;
}
function timeMs(raw){
 const n=typeof raw==='number'?(raw<1e12?raw*1000:raw):new Date(raw).getTime();
 return Number.isFinite(n)?n:null;
}
export function latestOutgoingVideo(messages,jid,{now=Date.now()}={}){
 if(!Array.isArray(messages)||!/^\d{12,15}@s\.whatsapp\.net$/.test(String(jid)))
  return null;
 const valid=messages.filter(m=>{
  const when=timeMs(m?.timestamp),id=String(m?.keyId||m?.id||'');
  return m?.fromMe===true && m?.remoteJid===jid &&
   /^(VIDEO|videoMessage)$/i.test(String(m?.type||''))&&msgId(id)&&
   when!==null&&when<=now+10000&&when>=now-maxAgeMs;
 }).sort((a,b)=>timeMs(b.timestamp)-timeMs(a.timestamp));
 const item=valid[0];
 return item?{messageId:String(item.keyId||item.id),
  sentAt:new Date(timeMs(item.timestamp)).toISOString(),kind:'video',fromMe:true}:null;
}
// Incoming videos are allowed ONLY from a uniquely registered owner/admin
// of the same tenant. A message from an arbitrary WhatsApp contact can never
// acquire administrative control or authorize a Meta upload.
export function latestIncomingVideo(messages,jid,{now=Date.now()}={}){
 if(!Array.isArray(messages)||!/^\d{12,15}@s\.whatsapp\.net$/.test(String(jid)))return null;
 const matches=messages.filter(m=>{
  const when=timeMs(m?.timestamp),id=String(m?.keyId||m?.id||'');
  return m?.fromMe===false&&m?.remoteJid===jid&&
   /^(VIDEO|videoMessage)$/i.test(String(m?.type||''))&&msgId(id)&&
   when!==null&&when<=now+10000&&when>=now-maxAgeMs;
 }).sort((a,b)=>timeMs(b.timestamp)-timeMs(a.timestamp));
 const item=matches[0];
 return item?{messageId:String(item.keyId||item.id),
  sentAt:new Date(timeMs(item.timestamp)).toISOString(),kind:'video',fromMe:false}:null;
}
async function verifyIncomingOwner(pool,a,phone){
 const result=await pool.query(
  "SELECT id FROM users WHERE tenant_id=$1 AND active=true "+
  "AND role IN ('owner','admin') AND phone IS NOT NULL "+
  "AND regexp_replace(phone,'[^0-9]','','g')=$2 LIMIT 2",
  [a.active_tenant_id,phone]);
 if(result.rows.length!==1)
  throw fail(403,'Este remetente não está identificado como proprietário/admin único da empresa no Sócio.');
 return result.rows[0].id;
}
export function recentAdInstruction(messages,jid,direction,video,{now=Date.now()}={}){
 if(!video||!Array.isArray(messages))return null;
 const ref=timeMs(video.sentAt),inbound=direction==='incoming';
 const rows=messages.filter(m=>{
  const when=timeMs(m?.timestamp);
  return m?.remoteJid===jid&&m.fromMe===!inbound&&
   when!==null&&Math.abs(when-ref)<=10*60000&&when<=now+10000&&
   typeof m.content==='string'&&m.content.trim().length>=10&&
   /^(TEXT|conversation|extendedTextMessage)$/i.test(String(m.type||'TEXT'));
 }).sort((a,b)=>timeMs(b.timestamp)-timeMs(a.timestamp));
 const latest=rows.find(m=>/an[uú]ncio|campanha|divulgar|promover/i.test(m.content));
 return latest?latest.content.replace(/[<>\r\n\t]/g,' ').replace(/\s+/g,' ').trim().slice(0,500):null;
}
export async function findLastOutgoingVideo(pool,a,{channelId,recipientPhone,direction='outgoing'}={},{
 env=process.env,getStatus=getSessionStatus,read=gatewayRead,now=Date.now()
}={}){
 const recipient=brazilWhatsappDestination(recipientPhone);
 if(!['outgoing','incoming'].includes(direction))throw fail(422,'Direção do vídeo inválida.');
 if(direction==='incoming')await verifyIncomingOwner(pool,a,recipient);
 const source=await verifiedSourceSession(pool,a,channelId,{getStatus,env});
 const jid=recipient+'@s.whatsapp.net';
 let response;
 try{
  // Use the known-good WA-AKG conversation history route. Filtering by
  // fromMe/type is done locally, so unsupported gateway query params cannot
  // prevent reading the owner's video. We NEVER return other chats' messages.
  const params=new URLSearchParams({jid,limit:'100',page:'1'});
  response=await read('/api/messages/'+encodeURIComponent(source.session_id)+'/search?'+params,
   {env,timeoutMs:16000});
  if(!Array.isArray(response?.data))throw fail(503,'Formato inesperado do histórico WA-AKG.');
 }catch(error){
  throw Object.assign(fail(503,'Não consegui consultar o histórico de vídeos deste WhatsApp.'),
   {phase:'gateway_history',originalCode:Number(error?.status||503)});
 }
 const video=direction==='incoming'?latestIncomingVideo(response.data,jid,{now}):
  latestOutgoingVideo(response.data,jid,{now});
 const instruction=video?recentAdInstruction(response.data,jid,direction,video,{now}):null;
 return {channelId:String(source.channel_id),recipientPhone:recipient,direction,
  instruction,video,found:Boolean(video),message:video?
   'Último vídeo enviado encontrado. Confirme o envio para a biblioteca da Meta Ads; nenhum anúncio será criado.':
   'Nenhum vídeo enviado para esse contato foi encontrado no histórico sincronizado dos últimos 30 dias.'};
}
export async function downloadVerifiedWhatsAppVideo({sessionId,messageId,env=process.env,
 fetchImpl=fetch}={}){
 if(!/^[A-Za-z0-9_-]{6,64}$/.test(String(sessionId))||!msgId(messageId))
  throw fail(422,'Origem do vídeo inválida.');
 const base=gatewayBase(env),url=base+'/api/messages/'+encodeURIComponent(sessionId)+
  '/download/'+encodeURIComponent(messageId)+'/media';
 const get=async target=>fetchImpl(target,{
  method:'GET',headers:{'x-api-key':env.WA_AKG_API_KEY},
  redirect:'manual',signal:AbortSignal.timeout(70000)
 });
 let response;
 try{
  response=await get(url);
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location'),next=new URL(location||'',base);
   // WA-AKG may return /api/media/... instead of bytes. Never follow
   // external redirects or pass the private API key to an arbitrary origin.
   if(next.origin!==new URL(base).origin||!/^\/api\/media\/[A-Za-z0-9_.-]+$/.test(next.pathname)||
    next.username||next.password||next.search||next.hash)
    throw fail(503,'Redirecionamento inseguro do gateway. Nenhum vídeo foi exportado.');
   response=await get(next.href);
  }
 }catch(e){if(e.status)throw e;throw fail(503,'O gateway não conseguiu recuperar o vídeo.');}
 if(!response?.ok||!response.body)throw fail(503,'O arquivo do vídeo não está disponível no WhatsApp.');
 const len=Number(response.headers.get('content-length')||0);
 if(len>maxVideoBytes||len<0||!Number.isSafeInteger(len))
  throw fail(413,'O vídeo excede o limite de 64 MB.');
 const parts=[];let size=0;
 try{
  for await(const piece of response.body){
   const b=Buffer.from(piece);size+=b.length;
   if(size>maxVideoBytes)throw fail(413,'O vídeo excede o limite de 64 MB.');
   parts.push(b);
  }
 }catch(e){if(e.status)throw e;throw fail(503,'Download do vídeo incompleto.');}
 const bytes=Buffer.concat(parts,size);
 const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
 return checkMetaVideoFile(bytes,mime);
}
export async function importLastOutgoingVideo(pool,a,{
 channelId,recipientPhone,direction='outgoing',messageId,confirmed
}={},{
 env=process.env,getStatus=getSessionStatus,read=gatewayRead,
 download=downloadVerifiedWhatsAppVideo,upload=uploadAdVideo,
 resolve=resolveSelectedOfficialAccount,now=Date.now()
}={}){
 permission(a);
 if(confirmed!==true||!msgId(messageId))
  throw fail(422,'Selecione o vídeo encontrado e confirme o upload.');
 const preview=await findLastOutgoingVideo(pool,a,{channelId,recipientPhone,direction},
  {env,getStatus,read,now});
 if(!preview.video||preview.video.messageId!==messageId)
  throw fail(409,'O último vídeo mudou ou não está disponível. Atualize a busca antes de enviar.');
 const account=await resolve(pool,a,{env});
 if(!/^act_\d{4,30}$/.test(String(account?.id||'')))
  throw fail(409,'Selecione uma conta de anúncios Meta válida.');
 const source=await verifiedSourceSession(pool,a,channelId,{getStatus,env});
 const claimId=randomUUID();
 const destHash=createHash('sha256').update(preview.recipientPhone).digest('hex');
 const claim=await pool.query(
  "INSERT INTO socio_whatsapp_meta_video_imports "+
  "(id,tenant_id,channel_id,user_id,account_id,provider_message_id,recipient_hash,status) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,'uploading') "+
  "ON CONFLICT (tenant_id,channel_id,account_id,provider_message_id) DO NOTHING RETURNING id",
  [claimId,a.active_tenant_id,channelId,a.user_id,account.id,messageId,destHash]);
 if(!claim.rowCount){
  const old=await pool.query(
   "SELECT status,meta_video_id FROM socio_whatsapp_meta_video_imports "+
   "WHERE tenant_id=$1 AND channel_id=$2 AND account_id=$3 AND provider_message_id=$4",
   [a.active_tenant_id,channelId,account.id,messageId]);
  return {status:old.rows[0]?.status||'unknown',videoId:old.rows[0]?.meta_video_id||null,
   accountId:account.id,replayed:true,
   message:'Esse vídeo já teve uma tentativa de upload. Não vou reenviar automaticamente.'};
 }
 let phase='media_download';
 try{
  const video=await download({sessionId:source.session_id,messageId,env});
  phase='meta_video_upload';
  const outcome=await upload(pool,a,video,{
   env,title:'Sócio WhatsApp · '+preview.video.sentAt.slice(0,16).replace('T',' '),
  });
  if(String(outcome.accountId)!==String(account.id)||!/^\d{4,30}$/.test(String(outcome.videoId||'')))
   throw Object.assign(fail(503,'A confirmação da Meta não corresponde à conta selecionada.'),
    {uncertain:true});
  await pool.query("UPDATE socio_whatsapp_meta_video_imports SET status='uploaded',"+
   "meta_video_id=$2,updated_at=now() WHERE id=$1 AND tenant_id=$3",
   [claimId,outcome.videoId,a.active_tenant_id]);
  return {status:'uploaded',videoId:outcome.videoId,accountId:account.id,
   processing:true,uploadedBytes:video.bytes.length,
   message:'Vídeo enviado à biblioteca de vídeos da Meta. Processamento pode estar pendente. Nenhuma campanha ou anúncio foi criado.'};
 }catch(error){
  if(!error.phase)error.phase=phase;
  await pool.query("UPDATE socio_whatsapp_meta_video_imports "+
   "SET status=$2,updated_at=now() WHERE id=$1 AND tenant_id=$3",
   [claimId,error?.uncertain?'uncertain':'failed',a.active_tenant_id]).catch(()=>{});
  if(error?.uncertain)throw Object.assign(fail(503,
   'Não foi possível confirmar o resultado na Meta. Confira a biblioteca antes de qualquer nova tentativa.'),{uncertain:true});
  throw error;
 }
}
