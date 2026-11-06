// Owner-only WA-AKG media bridge. Never accepts media from customers/groups, never
// authorizes spend from speech, and never uses a cross-tenant conversation or token.
// Deliberately OFF until a connected, verified WA-AKG session is tested in production.
import {randomUUID} from 'node:crypto';
import {gatewayRead,gatewayBase,getSessionStatus,privateJid} from './waakg-adapter.mjs';
import {outboundEnabled,deliverToConversation} from './socio-outbound.mjs';
import {uploadAdImage} from './meta-ads-tools.mjs';
import {speakToSocioSkill} from './socio-skill-router.mjs';
import {isOwnerSkillCommand,stripOwnerPrefix} from './socio-owner-skill-inbox.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const idPattern=/^[A-Za-z0-9_-]{4,180}$/;
const kinds=Object.freeze({image:3*1024*1024,audio:10*1024*1024});
const mediaType=type=>{
 const value=String(type||'').toLowerCase();
 if(/image|photo/.test(value))return 'image';
 if(/audio|ptt|voice/.test(value))return 'audio';
 return null;
};
const timestamp=raw=>{
 const value=typeof raw==='number'?(raw<1e12?raw*1000:raw):raw;
 const n=new Date(value).getTime();
 return Number.isFinite(n)?n:null;
};
export function selectRecentOwnerMedia(rows,jid,{now=Date.now(),seen=new Set(),audioEnabled=false}={}){
 if(!privateJid(jid)||!jid.endsWith('@s.whatsapp.net')||!Array.isArray(rows))return null;
 const matches=rows.filter(m=>{
  const kind=mediaType(m?.type),when=timestamp(m?.timestamp),id=String(m?.keyId||m?.id||'');
  return m?.remoteJid===jid&&m.fromMe===false&&kind&&
   (kind!=='audio'||audioEnabled)&&idPattern.test(id)&&!seen.has(id)&&
   when!==null&&when<=now+10000&&when>=now-180000;
 });
 matches.sort((a,b)=>timestamp(a.timestamp)-timestamp(b.timestamp));
 const m=matches[0];
 return m?{id:String(m.keyId||m.id),kind:mediaType(m.type),timestamp:timestamp(m.timestamp)}:null;
}
function sniffImage(bytes,mime){
 if(bytes.length<32||bytes.length>kinds.image)return false;
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 return mime==='image/jpeg'&&jpeg||mime==='image/png'&&png||mime==='image/webp'&&webp;
}
function sniffAudio(bytes,mime){
 if(bytes.length<80||bytes.length>kinds.audio)return false;
 const ogg=bytes.toString('ascii',0,4)==='OggS';
 const riff=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE';
 const mp3=bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&0xe0)===0xe0;
 const mp4=bytes.toString('ascii',4,8)==='ftyp';
 const webm=bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));
 return mime==='audio/ogg'&&ogg||mime==='audio/mpeg'&&mp3||
  (mime==='audio/wav'||mime==='audio/x-wav')&&riff||
  (mime==='audio/mp4'||mime==='audio/m4a')&&mp4||mime==='audio/webm'&&webm;
}
export async function downloadOwnerMedia({sessionId,messageId,kind,env=process.env,
 fetchImpl=fetch}={}){
 if(!/^[A-Za-z0-9_-]{6,64}$/.test(String(sessionId))||!idPattern.test(String(messageId))||
  !Object.hasOwn(kinds,kind))throw fail(422,'Identificador de mídia inválido.');
 const endpoint=gatewayBase(env)+'/api/messages/'+encodeURIComponent(sessionId)+
  '/download/'+encodeURIComponent(messageId)+'/media';
 const response=await fetchImpl(endpoint,{headers:{'x-api-key':env.WA_AKG_API_KEY},
  redirect:'manual',signal:AbortSignal.timeout(18000)});
 if(!response.ok||!response.body||response.status>=300||response.status<200)
  throw fail(503,'Gateway não confirmou a mídia do proprietário.');
 const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 const allowed=kind==='image'?['image/jpeg','image/png','image/webp']:
  ['audio/ogg','audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/m4a','audio/webm'];
 if(!allowed.includes(mime))throw fail(422,'Tipo de mídia não autorizado.');
 const length=Number(response.headers.get('content-length')||0);
 if(length&&(!Number.isSafeInteger(length)||length>kinds[kind]))throw fail(413,'Mídia maior que o limite.');
 const parts=[];let total=0;
 try{
  for await(const piece of response.body){
   const buf=Buffer.isBuffer(piece)?piece:Buffer.from(piece);total+=buf.length;
   if(total>kinds[kind])throw fail(413,'Mídia maior que o limite.');
   parts.push(buf);
  }
 }catch(e){if(e.status)throw e;throw fail(503,'Download de mídia incompleto.');}
 const bytes=Buffer.concat(parts,total);
 if(kind==='image'&&!sniffImage(bytes,mime)||kind==='audio'&&!sniffAudio(bytes,mime))
  throw fail(422,'Assinatura binária de mídia inválida.');
 return {bytes,mime};
}
export async function transcribeOwnerAudio({bytes,mime,env=process.env,fetchImpl=fetch}={}){
 if(env.SOCIO_OWNER_AUDIO_ENABLED!=='true')throw fail(503,'Comando por áudio não habilitado.');
 if(!env.GROQ_API_KEY||env.GROQ_API_KEY.length<20)throw fail(503,'Transcrição não configurada.');
 if(!Buffer.isBuffer(bytes)||!sniffAudio(bytes,mime))throw fail(422,'Áudio inválido.');
 const extension={'audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav',
  'audio/mp4':'mp4','audio/m4a':'m4a','audio/webm':'webm'}[mime];
 const form=new FormData();
 form.set('model','whisper-large-v3-turbo');form.set('language','pt');
 form.set('file',new Blob([bytes],{type:mime}),'socio-owner.'+extension);
 let response;
 try{response=await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions',{
   method:'POST',headers:{Authorization:'Bearer '+env.GROQ_API_KEY},body:form,
   signal:AbortSignal.timeout(25000)});
 }catch{throw fail(503,'Serviço de transcrição indisponível.');}
 if(!response.ok)throw fail(503,'O áudio não pôde ser transcrito com segurança.');
 const result=await response.json();
 if(typeof result.text!=='string'||!result.text.trim()||result.text.length>1400)
  throw fail(422,'Não consegui reconhecer um comando curto. Envie em texto.');
 return result.text.trim();
}
let cursor=0;
export async function processOwnerSkillMedia(pool,{
 env=process.env,getStatus=getSessionStatus,read=gatewayRead,
 download=downloadOwnerMedia,transcribe=transcribeOwnerAudio,upload=uploadAdImage,
 speak=speakToSocioSkill,deliver=deliverToConversation,now=Date.now()
}={}){
 if(env.SOCIO_OWNER_COMMANDS_ENABLED!=='true'||env.SOCIO_OWNER_MEDIA_ENABLED!=='true')
  return {processed:false,reason:'OWNER_MEDIA_DISABLED'};
 if(!outboundEnabled(env))return {processed:false,reason:'OUTBOUND_NOT_READY'};
 const targetTenant=String(env.SOCIO_OWNER_MEDIA_TENANT_ID||'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetTenant))
  return {processed:false,reason:'OWNER_MEDIA_TENANT_NOT_ALLOWED'};

 const found=await pool.query(
  "SELECT c.id AS conversation_id,c.tenant_id,c.channel_id,c.customer_phone,"+
  "l.session_id,ch.phone AS connected_phone,u.id AS user_id,u.role,u.platform_owner,"+
  "t.status AS tenant_status,t.features,t.name AS tenant_name "+
  "FROM conversations c JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=c.tenant_id "+
  "JOIN waakg_links l ON l.channel_id=c.channel_id AND l.tenant_id=c.tenant_id "+
  "JOIN users u ON u.tenant_id=c.tenant_id AND u.active=true AND "+
  "u.role IN ('owner','admin') AND u.phone IS NOT NULL "+
  "AND regexp_replace(u.phone,'[^0-9]','','g')=c.customer_phone "+
  "AND (SELECT count(*) FROM users verified_owner WHERE verified_owner.tenant_id=c.tenant_id "+
  "AND verified_owner.active=true AND verified_owner.role IN ('owner','admin') "+
  "AND regexp_replace(verified_owner.phone,'[^0-9]','','g')=c.customer_phone)=1 "+

  "JOIN tenants t ON t.id=c.tenant_id AND t.status<>'paused' "+
  "WHERE ch.provider='waakg' AND ch.status='connected' "+
  "AND c.tenant_id=$1 "+
  "AND c.customer_phone ~ '^[0-9]{10,15}$' "+
  "AND COALESCE((t.features->>'whatsapp')::boolean,true)=true "+
  "AND COALESCE((t.features->>'meta_ads')::boolean,true)=true "+
  "AND COALESCE((t.features->>'ai')::boolean,true)=true "+
  "ORDER BY c.last_message_at DESC,c.id LIMIT 1 OFFSET $2",[targetTenant,cursor]);
 if(!found.rowCount){
  cursor=0;return {processed:false,reason:'NO_VERIFIED_OWNER_CHAT'};
 }
 cursor=(cursor+1)%25;
 const owner=found.rows[0],jid=owner.customer_phone+'@s.whatsapp.net';
 const current=await getStatus(owner.session_id);
 if(!current.connected||current.connectedNumber!==String(owner.connected_phone).replace(/\D/g,''))
  return {processed:false,reason:'SESSION_NOT_VERIFIED'};
 const active=await pool.query(
  "SELECT id,brief,updated_at FROM socio_skill_runs WHERE tenant_id=$1 AND user_id=$2 "+
  "AND origin_conversation_id=$3 AND skill='ads.campaign.launch' "+
  "AND status='collecting' AND expires_at>now() ORDER BY updated_at DESC LIMIT 1",
  [owner.tenant_id,owner.user_id,owner.conversation_id]);
 let messages;
 try{
  const search='/api/messages/'+encodeURIComponent(owner.session_id)+'/search?'+
   new URLSearchParams({jid,limit:'100',page:'1'}).toString();
  messages=(await read(search,{env})).data;
 }catch{return {processed:false,reason:'MEDIA_HISTORY_UNAVAILABLE'};}
 const existing=await pool.query(
  "SELECT provider_message_id FROM socio_owner_media_receipts WHERE tenant_id=$1 AND channel_id=$2 "+
  "AND created_at>now()-interval '1 day' LIMIT 200",
  [owner.tenant_id,owner.channel_id]);
 const seen=new Set(existing.rows.map(x=>x.provider_message_id));
 // Only consume images while the owner is actively waiting for an ad creative.
 const runUpdatedAt=active.rowCount?timestamp(active.rows[0].updated_at):null;
 const allowImage=active.rowCount===1&&!active.rows[0].brief?.imageHash&&runUpdatedAt!==null;
 const filtered=(Array.isArray(messages)?messages:[]).filter(m=>{
  const type=mediaType(m?.type);
  return type==='audio'||type==='image'&&allowImage&&timestamp(m.timestamp)!==null&&
   timestamp(m.timestamp)>=runUpdatedAt-10000;
 });
 const selected=selectRecentOwnerMedia(filtered,jid,{now,seen,
  audioEnabled:env.SOCIO_OWNER_AUDIO_ENABLED==='true'});
 if(!selected)return {processed:false,reason:'NO_VALID_MEDIA'};
 const receiptId=randomUUID();
 const claimed=await pool.query(
  "INSERT INTO socio_owner_media_receipts(id,tenant_id,channel_id,conversation_id,user_id,"+
  "provider_message_id,media_kind,status) VALUES($1,$2,$3,$4,$5,$6,$7,'processing') "+
  "ON CONFLICT(tenant_id,channel_id,provider_message_id) DO NOTHING RETURNING id",
  [receiptId,owner.tenant_id,owner.channel_id,owner.conversation_id,owner.user_id,
   selected.id,selected.kind]);
 if(!claimed.rowCount)return {processed:false,reason:'MEDIA_ALREADY_CLAIMED'};
 const a={active_tenant_id:owner.tenant_id,user_id:owner.user_id,role:owner.role,
  platform_owner:owner.platform_owner,tenant_status:owner.tenant_status,
  features:owner.features,tenant_name:owner.tenant_name};
 let answer={status:'action_required',runId:null,message:'Mídia recebida, mas não foi possível processar o pedido.'};
 try{
  const binary=await download({sessionId:owner.session_id,messageId:selected.id,kind:selected.kind,env});
  if(selected.kind==='image'){
   if(!allowImage)throw fail(409,'Não há campanha aguardando imagem.');
   const image=await upload(pool,a,binary.bytes.toString('base64'));
   if(!image?.hash)throw fail(503,'A Meta não confirmou a imagem.');
   answer=await speak(pool,a,{message:'',runId:active.rows[0].id,imageHash:image.hash},{
    originConversationId:owner.conversation_id
   });
  }else{
   const transcript=await transcribe({bytes:binary.bytes,mime:binary.mime,env});
   if(!isOwnerSkillCommand(transcript))
    answer={status:'action_required',runId:null,
     message:'Áudio transcrito, mas não reconheci o comando “Sócio, ...”. Reenvie com esse início.'};
   else{
    const spoken=stripOwnerPrefix(transcript);
    // Spoken approvals are not considered reliable for changing an ad account.
    if(/^(pode criar|pode executar|pode fazer|confirmo|confirma|autorizo|aprovo|sim)/i.test(spoken.trim()))
     answer={status:'action_required',runId:null,
      message:'Entendi sua autorização por áudio. Por segurança, responda em TEXTO: Sócio, pode criar. Nenhuma campanha foi executada.'};
    else answer=await speak(pool,a,{message:spoken,runId:active.rows[0]?.id||null},{
     originConversationId:owner.conversation_id
    });
   }
  }
 }catch(error){
  answer={status:'failed',runId:null,
   message:'Não consegui processar essa mídia: '+String(error?.message||'confira o arquivo').slice(0,180)};
 }
 await pool.query(
  "UPDATE socio_owner_media_receipts SET status='response_ready',response_text=$2,run_id=$3,updated_at=now() "+
  "WHERE id=$1 AND tenant_id=$4",
  [receiptId,String(answer.message||'Mídia recebida.').slice(0,1900),answer.runId||null,owner.tenant_id]);
 try{
  const delivered=await deliver(pool,{tenantId:owner.tenant_id,conversationId:owner.conversation_id,
   userId:owner.user_id,mode:'human',text:String(answer.message||'Mídia recebida.').slice(0,1900),
   clientRequestId:receiptId,env});
  if(!delivered.sent)throw Error('Envio não confirmado');
  await pool.query("UPDATE socio_owner_media_receipts SET status='replied',updated_at=now() "+
   "WHERE id=$1 AND tenant_id=$2",[receiptId,owner.tenant_id]);
  return {processed:true,replySent:true,status:answer.status,kind:selected.kind};
 }catch{
  await pool.query("UPDATE socio_owner_media_receipts SET status='uncertain',updated_at=now() "+
   "WHERE id=$1 AND tenant_id=$2",[receiptId,owner.tenant_id]);
  return {processed:true,replySent:false,status:answer.status,reason:'DELIVERY_UNCONFIRMED'};
 }
}
