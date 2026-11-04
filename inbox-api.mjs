import {createHash} from 'node:crypto';
import {gatewayRead,getSessionStatus,listAvailableChats,privateJid} from './waakg-adapter.mjs';
import {outboundEnabled,canAutoReply,deliverToConversation} from './socio-outbound.mjs';
// Tenant-scoped inbox interaction endpoints. No WhatsApp transmission is performed
// here: the dedicated Sócio WA-AKG gateway is intentionally read-only.
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const reactions=new Set(['👍','❤️','😂','😮','😢','🙏','🔥','👏','✅']);
export const allowedInboxFilters=new Set(['all','unread','favorites','pinned','archived','human','ai_assist','resolved']);
export const inboxCapabilities=Object.freeze({
 whatsappSend:false,whatsappMedia:false,whatsappReactions:false,whatsappEdit:false,
 whatsappForward:false,whatsappDelete:false,whatsappReadReceipts:false,
 internalNotes:true,internalReactions:true,messageStar:true,search:true,
 quotedNotes:true,archive:true,pin:true,labels:true,assignment:true,
 aiAssistance:true,readOnlyGateway:true
});
export function validateUiPatch(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('PATCH_INVALID');
 const clean={};
 const toggles=['pinned','favorite','archived','muted','marked_unread'];
 for(const key of toggles)if(Object.hasOwn(data,key)){
  if(typeof data[key]!=='boolean')throw new Error('PATCH_INVALID');
  clean[key]=data[key];
 }
 if(Object.hasOwn(data,'read')){
  if(data.read!==true)throw new Error('PATCH_INVALID');
  clean.last_read_at=new Date();
  clean.marked_unread=false;
 }
 if(Object.hasOwn(data,'draft')){
  if(typeof data.draft!=='string'||data.draft.length>3000)throw new Error('PATCH_INVALID');
  clean.draft=data.draft;
 }
 if(Object.hasOwn(data,'handling_mode')){
  if(!['human','ai_assist'].includes(data.handling_mode))throw new Error('PATCH_INVALID');
  clean.handling_mode=data.handling_mode;
 }
 if(Object.hasOwn(data,'assigned_user_id')){
  if(data.assigned_user_id!==null&&!(typeof data.assigned_user_id==='string'&&uuid.test(data.assigned_user_id)))
   throw new Error('PATCH_INVALID');
  clean.assigned_user_id=data.assigned_user_id;
 }
 if(Object.hasOwn(data,'labels')){
  if(!Array.isArray(data.labels)||data.labels.length>6||
    data.labels.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>25))throw new Error('PATCH_INVALID');
  clean.labels=[...new Set(data.labels.map(tag=>tag.trim()))];
 }
 if(!Object.keys(clean).length)throw new Error('PATCH_INVALID');
 return clean;
}
export const inboxRuntimeCapabilities=()=>({...inboxCapabilities,whatsappSend:outboundEnabled(),aiAutoReply:canAutoReply(),readOnlyGateway:!outboundEnabled()});
export function validReaction(value){return value===null||reactions.has(value);}
const noteValid=text=>typeof text==='string'&&text.trim().length>0&&text.length<=3000;
const isUuid=value=>typeof value==='string'&&uuid.test(value);
const err=(status,message)=>Object.assign(new Error(message),{status});
const inboxSyncLast=new Map();
const safeTime=raw=>{
 const dt=new Date(typeof raw==='number'?(raw<1e12?raw*1000:raw):raw);
 const value=dt.getTime();
 return Number.isFinite(value)&&value>=946684800000&&value<=Date.now()+86400000?dt.toISOString():null;
};
export function normalizeInboxRemoteText(rows,jid){
 if(!privateJid(jid)||!Array.isArray(rows))return [];
 const seen=new Set(),out=[];
 for(const m of rows.slice(0,100)){
  if(m?.remoteJid!==jid||!['TEXT','CONVERSATION','EXTENDEDTEXT',''].includes(String(m?.type||'').toUpperCase()))continue;
  const body=typeof m?.content==='string'?m.content.trim():'';
  const when=safeTime(m?.timestamp),outgoing=m?.fromMe===true;
  if(!body||!when)continue;
  const token=String(m.keyId||m.id||'').slice(0,200);
  const identity=token||when+':'+(outgoing?'out':'in')+':'+body;
  if(seen.has(identity))continue;
  seen.add(identity);
  out.push({body:body.slice(0,4000),created_at:when,direction:outgoing?'outbound':'inbound',identity});
 }
 return out.sort((a,b)=>a.created_at.localeCompare(b.created_at));
}

export async function handleInboxApi({pathname,method,req,res,a,query,body,json,id,audit,pool}){
 const tenant=a.active_tenant_id;
 if(pathname==='/api/inbox/capabilities'&&method==='GET')return json(res,200,inboxRuntimeCapabilities());

 if(pathname==='/api/inbox/sync'&&method==='POST'){
  if(!['owner','admin'].includes(a.role)&&!a.platform_owner)
   throw err(403,'Somente proprietários e administradores podem sincronizar o WhatsApp.');
  const {data}=await body(req);
  if(!isUuid(data.channelId)||!Number.isInteger(data.offset||0)||
     (data.offset||0)<0||(data.offset||0)>50)
   throw err(422,'Canal ou posição de sincronização inválidos.');
  const offset=data.offset||0;
  const rateKey=tenant+':'+data.channelId+':'+offset,prev=inboxSyncLast.get(rateKey)||0;
  if(Date.now()-prev<2400)throw err(429,'Sincronização já solicitada. Tente novamente.');
  inboxSyncLast.set(rateKey,Date.now());
  const c=await query(`SELECT l.session_id,ch.id,ch.phone FROM waakg_links l
   JOIN channels ch ON ch.tenant_id=l.tenant_id AND ch.id=l.channel_id
   WHERE l.tenant_id=$1 AND l.channel_id=$2 AND ch.provider='waakg'`,[tenant,data.channelId]);
  if(!c.rowCount)throw err(404,'Canal WhatsApp não encontrado nesta empresa.');
  const {session_id:sessionId,phone, id:channelId}=c.rows[0];
  const status=await getSessionStatus(sessionId);
  if(!status.connected||status.connectedNumber!==String(phone).replace(/\D/g,''))
   throw err(409,'WhatsApp não está conectado ou número não foi confirmado.');
  const list=await listAvailableChats(sessionId);
  const jids=list.jids.slice(offset,offset+5);
  let chatsImported=0,messagesImported=0;
  for(const jid of jids){
   if(!privateJid(jid)||!jid.endsWith('@s.whatsapp.net'))continue;
   const customerPhone=jid.split('@')[0],params=new URLSearchParams({jid,limit:'100',page:'1'});
   const remote=await gatewayRead('/api/messages/'+encodeURIComponent(sessionId)+'/search?'+params.toString());
   if(!Array.isArray(remote.data))throw err(503,'Gateway retornou mensagens inválidas.');
   const normalized=normalizeInboxRemoteText(remote.data,jid);
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const contactName=String(list.names?.[jid]||'').slice(0,100);
    const chat=await client.query(`INSERT INTO conversations(id,tenant_id,channel_id,customer_phone,customer_name)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,channel_id,customer_phone)
     DO UPDATE SET customer_name=CASE WHEN conversations.customer_name='' THEN EXCLUDED.customer_name ELSE conversations.customer_name END
     RETURNING id`,
     [id(),tenant,channelId,customerPhone,contactName]);
    const conversationId=chat.rows[0].id;
    for(const m of normalized){
     // Provider identifiers never include the raw phone/JID or message content.
     const stable=createHash('sha256').update(sessionId+':'+jid+':'+m.identity).digest('hex');
     const providerId='waakg:'+stable;
     const inserted=await client.query(`INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,provider_id) DO NOTHING RETURNING id`,
      [id(),tenant,conversationId,m.direction,m.body,providerId,m.created_at]);
     messagesImported+=inserted.rowCount;
    }
    if(normalized.length){
     await client.query(`UPDATE conversations SET last_message_at=GREATEST(
       last_message_at,(SELECT MAX(created_at) FROM messages WHERE tenant_id=$1 AND conversation_id=$2))
       WHERE tenant_id=$1 AND id=$2`,[tenant,conversationId]);
    }
    await client.query('COMMIT');chatsImported++;
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client.release();}
  }
  const hasMore=offset+5<list.jids.length,nextOffset=hasMore?offset+5:null;
  await audit(a,'inbox.manual_history_sync',{channelId,chatsImported,messagesImported,
   partialCoverage:list.partial||hasMore});
  return json(res,200,{ok:true,chatsImported,messagesImported,hasMore,nextOffset,
   partialCoverage:list.partial,readOnly:true,mediaImported:false});
 }
 if(pathname==='/api/inbox/v2'&&method==='GET'){
  const url=new URL(req.url,'http://localhost');
  const search=(url.searchParams.get('search')||'').trim();
  const filter=url.searchParams.get('filter')||'all';
  if(search.length>90||!allowedInboxFilters.has(filter))throw err(422,'Pesquisa ou filtro inválido.');
  const result=await query(`
    SELECT c.id,c.customer_name,c.customer_phone,c.status,c.last_message_at,
     ch.label AS channel_label,ch.provider AS channel_provider,
     COALESCE(st.pinned,false) AS pinned,COALESCE(st.favorite,false) AS favorite,
     COALESCE(st.archived,false) AS archived,COALESCE(st.muted,false) AS muted,
     COALESCE(st.marked_unread,false) AS marked_unread,
     COALESCE(st.draft,'') AS draft,COALESCE(st.labels,ARRAY[]::text[]) AS labels,
     COALESCE(st.handling_mode,'human') AS handling_mode,st.assigned_user_id,
     (COALESCE(st.marked_unread,false) OR (st.last_read_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM messages mi WHERE mi.tenant_id=$1 AND mi.conversation_id=c.id
       AND mi.direction='inbound' AND mi.created_at>st.last_read_at
     ))) AS unread,
     COALESCE((
      SELECT m.body FROM messages m WHERE m.tenant_id=$1 AND m.conversation_id=c.id
       ORDER BY m.created_at DESC,m.id DESC LIMIT 1
     ),'') AS last_message
    FROM conversations c
    JOIN channels ch ON ch.tenant_id=$1 AND ch.id=c.channel_id
    LEFT JOIN conversation_ui_state st ON st.tenant_id=$1 AND st.conversation_id=c.id
    WHERE c.tenant_id=$1
    AND ($2::text='' OR c.customer_name ILIKE '%'||$2||'%' OR c.customer_phone ILIKE '%'||$2||'%'
      OR EXISTS(SELECT 1 FROM messages sm WHERE sm.tenant_id=$1 AND sm.conversation_id=c.id
        AND sm.body ILIKE '%'||$2||'%'))
    AND ($3='archived' OR COALESCE(st.archived,false)=false)
    AND ($3<>'archived' OR COALESCE(st.archived,false)=true)
    AND ($3<>'unread' OR COALESCE(st.marked_unread,false) OR
      (st.last_read_at IS NOT NULL AND EXISTS(
       SELECT 1 FROM messages um WHERE um.tenant_id=$1 AND um.conversation_id=c.id
        AND um.direction='inbound' AND um.created_at>st.last_read_at
      )))
    AND ($3<>'favorites' OR COALESCE(st.favorite,false))
    AND ($3<>'pinned' OR COALESCE(st.pinned,false))
    AND ($3<>'human' OR COALESCE(st.handling_mode,'human')='human')
    AND ($3<>'ai_assist' OR COALESCE(st.handling_mode,'human')='ai_assist')
    AND ($3<>'resolved' OR c.status='resolved')
    ORDER BY COALESCE(st.pinned,false) DESC,c.last_message_at DESC,c.id
    LIMIT 150`,[tenant,search,filter]);
  return json(res,200,{conversations:result.rows,capabilities:inboxRuntimeCapabilities(),limitedTo:150});
 }
 const match=pathname.match(/^\/api\/conversations\/([a-f\d-]{36})\/(ui|history|notes|send|forward-internal|messages\/([a-f\d-]{36})\/ui)$/i);
 if(!match)return false;
 const conversationId=match[1],route=match[2],messageId=match[3];
 if(!isUuid(conversationId)||messageId&&!isUuid(messageId))throw err(404,'Conversa não encontrada.');
 const exists=await query('SELECT id,customer_name,customer_phone,status,channel_id FROM conversations WHERE tenant_id=$1 AND id=$2',[tenant,conversationId]);
 if(!exists.rowCount)throw err(404,'Conversa não encontrada.');
 const conversation=exists.rows[0];
 if(method==='GET'&&route==='history'){
  const url=new URL(req.url,'http://localhost');
  const cursor=url.searchParams.get('before');
  const limitNumber=Number(url.searchParams.get('limit')||80);
  if(!Number.isInteger(limitNumber)||limitNumber<1||limitNumber>120)throw err(422,'Limite inválido.');
  if(cursor&&(cursor.length>35||!Number.isFinite(Date.parse(cursor))))throw err(422,'Cursor inválido.');
  const items=await query(`SELECT m.id,m.direction,m.body,m.created_at,m.reply_to_id,m.provider_id,
   COALESCE(flag.starred,false) AS starred,flag.reaction
   FROM messages m LEFT JOIN message_ui_state flag ON
    flag.tenant_id=m.tenant_id AND flag.message_id=m.id AND flag.user_id=$3
   WHERE m.tenant_id=$1 AND m.conversation_id=$2
     AND ($4::timestamptz IS NULL OR m.created_at<$4)
   ORDER BY m.created_at DESC,m.id DESC LIMIT $5`,
   [tenant,conversationId,a.user_id,cursor?new Date(cursor).toISOString():null,limitNumber+1]);
  const more=items.rows.length>limitNumber;
  const selected=items.rows.slice(0,limitNumber).reverse();
  const pref=await query(`SELECT pinned,favorite,archived,muted,marked_unread,draft,labels,assigned_user_id,handling_mode
    FROM conversation_ui_state WHERE tenant_id=$1 AND conversation_id=$2`,[tenant,conversationId]);
  return json(res,200,{conversation,preferences:pref.rows[0]||{},
   messages:selected,hasMore:more,
   nextCursor:more&&selected.length?selected[0].created_at:null,capabilities:inboxRuntimeCapabilities()});
 }
 if(method==='PATCH'&&route==='ui'){
  const {data}=await body(req);
  let clean;try{clean=validateUiPatch(data);}catch{throw err(422,'Configuração de conversa inválida.');}
  if(Object.hasOwn(clean,'handling_mode'))clean.ai_activated_at=clean.handling_mode==='ai_assist'?new Date():null;
  if(Object.hasOwn(clean,'assigned_user_id')){
   if(!['owner','admin'].includes(a.role)&&!a.platform_owner)throw err(403,'Sem permissão para atribuir conversas.');
   if(clean.assigned_user_id!==null){
    const user=await query('SELECT id FROM users WHERE id=$1 AND tenant_id=$2',[clean.assigned_user_id,tenant]);
    if(!user.rowCount)throw err(422,'Colaborador não pertence à empresa.');
   }
  }
  await query('INSERT INTO conversation_ui_state(tenant_id,conversation_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[tenant,conversationId]);
  const params=[tenant,conversationId],fields=[];
  for(const [key,value] of Object.entries(clean)){params.push(value);fields.push(key+'=$'+params.length);}
  const updated=await query(`UPDATE conversation_ui_state SET ${fields.join(',')},updated_at=now()
   WHERE tenant_id=$1 AND conversation_id=$2 RETURNING *`,params);
  if(['handling_mode','assigned_user_id','labels'].some(key=>Object.hasOwn(clean,key)))
   await audit(a,'inbox.conversation_preferences',{conversationId,fields:Object.keys(clean).filter(x=>x!=='draft')});
  return json(res,200,{ok:true,preferences:updated.rows[0]});
 }
 if(method==='POST'&&route==='send'){
  if(!outboundEnabled())throw err(503,'Envio de mensagens indisponível até a validação do WhatsApp.');
  const {data}=await body(req);
  if(typeof data?.text!=='string'||typeof data?.clientRequestId!=='string')
   throw err(422,'Mensagem ou identificador ausente.');
  const sent=await deliverToConversation(pool,{
   tenantId:tenant,conversationId,userId:a.user_id,mode:'human',
   text:data.text,clientRequestId:data.clientRequestId,replyToId:data.replyToMessageId||null
  });
  if(sent.sent&&!sent.reused)await audit(a,'inbox.whatsapp.text_sent',{conversationId,outboxId:sent.id});
  return json(res,sent.sent?201:202,{...sent,channel:'whatsapp'});
 }
 if(method==='POST'&&route==='notes'){
  const {data}=await body(req);
  if(!noteValid(data.text))throw err(422,'Nota interna inválida.');
  const replyId=data.replyToMessageId||null;
  if(replyId){
   if(!isUuid(replyId))throw err(422,'Mensagem original inválida.');
   const parent=await query('SELECT id FROM messages WHERE id=$1 AND tenant_id=$2 AND conversation_id=$3',[replyId,tenant,conversationId]);
   if(!parent.rowCount)throw err(422,'A mensagem citada não pertence a esta conversa.');
  }
  const note=await query(`INSERT INTO messages(id,tenant_id,conversation_id,direction,body,reply_to_id)
   VALUES($1,$2,$3,'note',$4,$5) RETURNING id,direction,body,created_at,reply_to_id`,
   [id(),tenant,conversationId,data.text.trim(),replyId]);
  await audit(a,'inbox.note_created',{conversationId,messageId:note.rows[0].id,quoted:!!replyId});
  return json(res,201,{ok:true,message:note.rows[0],whatsappSent:false});
 }
 if(method==='POST'&&route==='forward-internal'){
  const {data}=await body(req);
  if(!isUuid(data.messageId)||!isUuid(data.targetConversationId)||data.targetConversationId===conversationId)
   throw err(422,'Seleção de encaminhamento inválida.');
  const record=await query('SELECT body FROM messages WHERE tenant_id=$1 AND conversation_id=$2 AND id=$3',[tenant,conversationId,data.messageId]);
  const target=await query('SELECT id FROM conversations WHERE tenant_id=$1 AND id=$2',[tenant,data.targetConversationId]);
  if(!record.rowCount||!target.rowCount)throw err(404,'Mensagem ou conversa não encontrada.');
  const text='[Encaminhada como nota interna]\n'+record.rows[0].body.slice(0,2550);
  await query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'note',$4)",
   [id(),tenant,data.targetConversationId,text]);
  await audit(a,'inbox.note_forwarded',{fromConversationId:conversationId,toConversationId:data.targetConversationId});
  return json(res,201,{ok:true,whatsappSent:false});
 }
 if(method==='PATCH'&&messageId&&route.endsWith('/ui')){
  const existsMessage=await query('SELECT id FROM messages WHERE tenant_id=$1 AND conversation_id=$2 AND id=$3',[tenant,conversationId,messageId]);
  if(!existsMessage.rowCount)throw err(404,'Mensagem não encontrada.');
  const {data}=await body(req);
  const fields=[],params=[tenant,messageId,a.user_id];
  if(Object.hasOwn(data,'starred')){
   if(typeof data.starred!=='boolean')throw err(422,'Favorito inválido.');
   params.push(data.starred);fields.push('starred=$'+params.length);
  }
  if(Object.hasOwn(data,'reaction')){
   if(!validReaction(data.reaction))throw err(422,'Reação inválida.');
   params.push(data.reaction);fields.push('reaction=$'+params.length);
  }
  if(!fields.length)throw err(422,'Ação inválida.');
  await query('INSERT INTO message_ui_state(tenant_id,message_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,messageId,a.user_id]);
  const updated=await query(`UPDATE message_ui_state SET ${fields.join(',')},updated_at=now() WHERE tenant_id=$1 AND message_id=$2 AND user_id=$3 RETURNING *`,params);
  return json(res,200,{ok:true,internalOnly:true,flags:updated.rows[0]});
 }
 throw err(405,'Método não permitido.');
}
