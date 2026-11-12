// Instagram professional inbox, isolated per Sócio company.
// Instagram Login only. Never initiates unsolicited DMs or enables automation.
import {createHmac,createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
const err=(status,message)=>Object.assign(new Error(message),{status});
const igId=x=>typeof x==='string'&&/^\d{1,30}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
export const instagramReady=(env=process.env)=>Boolean(
 env.INSTAGRAM_APP_ID&&env.INSTAGRAM_APP_SECRET&&env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN&&
 env.CHANNEL_ENCRYPTION_KEY&&env.CHANNEL_ENCRYPTION_KEY.length>=32&&
 /^https:\/\//.test(env.SOCIO_PUBLIC_URL||''));
// One central kill switch for every external message, WhatsApp or Instagram.
export const instagramOutboundEnabled=(env=process.env)=>env.SOCIO_OUTBOUND_ENABLED==='true';
function webOrigin(env){
 const url=new URL(env.SOCIO_PUBLIC_URL);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=="/")
  throw err(503,'URL pública para Instagram inválida.');
 return url.origin;
}
function version(env){
 const v=env.INSTAGRAM_GRAPH_VERSION||'v26.0';
 if(!/^v\d{1,2}\.0$/.test(v))throw err(503,'Versão da API Instagram inválida.');
 return v;
}
export function instagramAuthorizeUrl(state,env=process.env){
 if(!instagramReady(env)||!/^[a-f0-9]{64}$/.test(state))throw err(503,'Instagram ainda não configurado.');
 const qs=new URLSearchParams({client_id:env.INSTAGRAM_APP_ID,
  redirect_uri:webOrigin(env)+'/api/instagram/oauth/callback',
  scope:'instagram_business_basic,instagram_business_manage_messages',response_type:'code',state});
 return 'https://www.instagram.com/oauth/authorize?'+qs;
}
function encryptionKey(env){
 if(!env.CHANNEL_ENCRYPTION_KEY||env.CHANNEL_ENCRYPTION_KEY.length<32)
  throw err(503,'Chave de criptografia de canais ausente.');
 return createHmac('sha256',env.CHANNEL_ENCRYPTION_KEY).update('socio:instagram-token:v1').digest();
}
export function encryptInstagramToken(token,env=process.env){
 if(typeof token!=='string'||token.length<10||token.length>12000)throw err(422,'Token inválido.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(env),iv);
 const content=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return ['v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),content.toString('base64')].join('.');
}
export function decryptInstagramToken(sealed,env=process.env){
 const parts=String(sealed||'').split('.');
 if(parts.length!==4||parts[0]!=='v1'||!/^[0-9a-f]{24}$/.test(parts[1])||
    !/^[0-9a-f]{32}$/.test(parts[2]))throw err(503,'Token armazenado inválido.');
 const dec=createDecipheriv('aes-256-gcm',encryptionKey(env),Buffer.from(parts[1],'hex'));
 dec.setAuthTag(Buffer.from(parts[2],'hex'));
 return Buffer.concat([dec.update(Buffer.from(parts[3],'base64')),dec.final()]).toString('utf8');
}
export function verifyInstagramSignature(raw,signature,env=process.env){
 if(!env.INSTAGRAM_APP_SECRET||!Buffer.isBuffer(raw))return false;
 const match=typeof signature==='string'&&/^sha256=([0-9a-f]{64})$/.exec(signature);
 if(!match)return false;
 return timingSafeEqual(Buffer.from(match[1],'hex'),
  createHmac('sha256',env.INSTAGRAM_APP_SECRET).update(raw).digest());
}
export function parseInstagramWebhook(payload,now=Date.now()){
 if(payload?.object!=='instagram'||!Array.isArray(payload.entry))return [];
 const results=[],seen=new Set();
 for(const entry of payload.entry.slice(0,25)){
  if(!Array.isArray(entry.messaging))continue;
  for(const event of entry.messaging.slice(0,50)){
   const sender=String(event?.sender?.id||''),recipient=String(event?.recipient?.id||''),
    mid=event?.message?.mid,value=event?.message?.text;
   if(!igId(sender)||!igId(recipient)||sender===recipient||
    !mid||typeof mid!=='string'||mid.length>255||typeof value!=='string'||
    !value.trim()||value.length>4000||event?.message?.is_echo===true||
    event?.message?.is_deleted===true)continue;
   if(igId(String(entry.id||''))&&String(entry.id)!==recipient)continue;
   const time=Number(event.timestamp);
   if(!Number.isFinite(time)||time<now-7*86400000||time>now+60000)continue;
   const unique=recipient+':'+mid;
   if(seen.has(unique))continue;seen.add(unique);
   results.push({accountId:recipient,senderId:sender,messageId:mid,text:value.trim(),
    when:new Date(time).toISOString()});
   if(results.length>=50)return results;
  }
 }
 return results;
}
export async function ingestInstagramWebhook(pool,raw,signature,{env=process.env,now=Date.now()}={}){
 if(!verifyInstagramSignature(raw,signature,env))throw err(403,'Assinatura Instagram inválida.');
 let data;
 try{data=JSON.parse(raw.toString('utf8'));}catch{throw err(400,'Webhook inválido.');}
 const events=parseInstagramWebhook(data,now);let imported=0,ignored=0;
 for(const e of events){
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const account=await c.query(
    "SELECT a.tenant_id,a.channel_id FROM instagram_accounts a "+
    "JOIN channels ch ON ch.tenant_id=a.tenant_id AND ch.id=a.channel_id "+
    "WHERE a.ig_user_id=$1 AND a.status='connected' AND ch.status='connected'",
    [e.accountId]);
   if(!account.rowCount){ignored++;await c.query('ROLLBACK');continue;}
   const {tenant_id:tenant,channel_id:channel}=account.rows[0];
   const conv=await c.query(
    "INSERT INTO conversations(id,tenant_id,channel_id,customer_phone,customer_name,last_message_at) "+
    "VALUES($1,$2,$3,$4,'Instagram',$5) "+
    "ON CONFLICT(tenant_id,channel_id,customer_phone) DO UPDATE SET "+
    "last_message_at=GREATEST(conversations.last_message_at,EXCLUDED.last_message_at) RETURNING id",
    [randomUUID(),tenant,channel,'ig:'+e.senderId,e.when]);
   const saved=await c.query(
    "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) "+
    "VALUES($1,$2,$3,'inbound',$4,$5,$6) "+
    "ON CONFLICT(tenant_id,provider_id) DO NOTHING RETURNING id",
    [randomUUID(),tenant,conv.rows[0].id,e.text,'instagram:'+e.messageId,e.when]);
   if(saved.rowCount)imported++;
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 return {ok:true,received:events.length,imported,ignored};
}
export async function beginInstagramOAuth(pool,tenant,user,env=process.env){
 if(!instagramReady(env))throw err(503,'Instagram não configurado no painel Meta Developers.');
 const state=randomBytes(32).toString('hex');
 await pool.query("INSERT INTO instagram_oauth_states(state_hash,tenant_id,user_id,expires_at) "+
  "VALUES($1,$2,$3,now()+interval '10 minutes')",
  [createHash('sha256').update(state).digest('hex'),tenant,user]);
 return {authorizationUrl:instagramAuthorizeUrl(state,env)};
}
async function providerJson(response){
 if(!response.ok)throw err(503,'A Meta recusou esta operação. Verifique a autorização.');
 const data=await response.json().catch(()=>null);
 if(!data||typeof data!=='object'||Array.isArray(data))throw err(503,'Resposta da Meta inválida.');
 return data;
}
async function exchangeInstagramCode(code,env,request){
 const body=new URLSearchParams({client_id:env.INSTAGRAM_APP_ID,
  client_secret:env.INSTAGRAM_APP_SECRET,grant_type:'authorization_code',
  redirect_uri:webOrigin(env)+'/api/instagram/oauth/callback',code});
 const short=await providerJson(await request('https://api.instagram.com/oauth/access_token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,
  signal:AbortSignal.timeout(12000)}));
 if(typeof short.access_token!=='string'||!igId(String(short.user_id||'')))
  throw err(503,'Instagram não confirmou uma conta autorizada.');
 const url=new URL('https://graph.instagram.com/access_token');
 url.search=new URLSearchParams({grant_type:'ig_exchange_token',
  client_secret:env.INSTAGRAM_APP_SECRET,access_token:short.access_token}).toString();
 const long=await providerJson(await request(url,{signal:AbortSignal.timeout(12000)}));
 if(typeof long.access_token!=='string'||!Number.isInteger(long.expires_in)||long.expires_in<3600)
  throw err(503,'Não foi possível prolongar a autorização do Instagram.');
 const profile=await providerJson(await request(
  'https://graph.instagram.com/'+version(env)+'/me?fields=id,username,account_type',
  {headers:{Authorization:'Bearer '+long.access_token},signal:AbortSignal.timeout(12000)}));
 const accountId=String(profile.id||short.user_id),username=String(profile.username||'');
 if(!igId(accountId)||accountId!==String(short.user_id)||!/^[a-zA-Z0-9._]{1,30}$/.test(username)||
    !['BUSINESS','MEDIA_CREATOR','CREATOR'].includes(profile.account_type))
  throw err(403,'É necessária uma conta profissional do Instagram.');
 return {accountId,username,token:long.access_token,expiresAt:new Date(Date.now()+long.expires_in*1000)};
}
export async function completeInstagramOAuth(pool,state,code,{env=process.env,request=fetch}={}){
 if(!instagramReady(env)||!/^[a-f0-9]{64}$/.test(String(state||''))||
    typeof code!=='string'||code.length<8||code.length>2000)
  throw err(400,'Autorização Instagram inválida.');
 const used=await pool.query(
  "UPDATE instagram_oauth_states SET consumed_at=now() "+
  "WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING tenant_id,user_id",
  [createHash('sha256').update(state).digest('hex')]);
 if(!used.rowCount)throw err(403,'Autorização expirada ou já utilizada.');
 const {tenant_id:tenant,user_id:user}=used.rows[0];
 const authorized=await pool.query(
  "SELECT id FROM users WHERE id=$1 AND tenant_id=$2 AND active=true AND role IN ('owner','admin') "+
  "AND EXISTS(SELECT 1 FROM tenants WHERE id=$2 AND status<>'paused' AND COALESCE((features->>'whatsapp')::boolean,true)=true)",
  [user,tenant]);
 if(!authorized.rowCount)throw err(403,'Acesso de administração revogado durante autorização.');
 const account=await exchangeInstagramCode(code,env,request);
 const ciphertext=encryptInstagramToken(account.token,env),c=await pool.connect();
 try{
  await c.query('BEGIN');
  const prior=await c.query(
   'SELECT tenant_id,channel_id FROM instagram_accounts WHERE ig_user_id=$1 FOR UPDATE',[account.accountId]);
  if(prior.rowCount&&prior.rows[0].tenant_id!==tenant)
   throw err(409,'Esta conta Instagram já pertence a outra empresa.');
  const channel=prior.rowCount?prior.rows[0].channel_id:randomUUID();
  if(!prior.rowCount){
   await c.query(
    "INSERT INTO channels(id,tenant_id,label,phone,provider,status) "+
    "VALUES($1,$2,$3,$4,'instagram','connected')",
    [channel,tenant,'Instagram @'+account.username,'ig:'+account.accountId]);
  }else{
   await c.query("UPDATE channels SET label=$3,status='connected' WHERE tenant_id=$1 AND id=$2",
    [tenant,channel,'Instagram @'+account.username]);
  }
  const result=await c.query(
   "INSERT INTO instagram_accounts(tenant_id,channel_id,ig_user_id,username,token_ciphertext,token_expires_at,status) "+
   "VALUES($1,$2,$3,$4,$5,$6,'connected') "+
   "ON CONFLICT(ig_user_id) DO UPDATE SET username=EXCLUDED.username, "+
   "token_ciphertext=EXCLUDED.token_ciphertext,token_expires_at=EXCLUDED.token_expires_at, "+
   "status='connected',updated_at=now() "+
   "WHERE instagram_accounts.tenant_id=EXCLUDED.tenant_id RETURNING channel_id",
   [tenant,channel,account.accountId,account.username,ciphertext,account.expiresAt]);
  if(!result.rowCount)throw err(409,'Esta conta Instagram já pertence a outra empresa.');
  await c.query(
   "INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,'instagram.connected',$4)",
   [randomUUID(),tenant,user,JSON.stringify({channelId:channel})]);
  await c.query('COMMIT');
  return {channelId:channel,username:account.username};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function revokeInstagramAccount(pool,tenant,user,channel){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const r=await c.query(
   "UPDATE instagram_accounts SET status='revoked',token_ciphertext=NULL,token_expires_at=NULL,updated_at=now() "+
   "WHERE tenant_id=$1 AND channel_id=$2 AND status='connected' RETURNING channel_id",
   [tenant,channel]);
  if(!r.rowCount)throw err(404,'Conta Instagram não encontrada ou desconectada.');
  await c.query("UPDATE channels SET status='disconnected' WHERE tenant_id=$1 AND id=$2",[tenant,channel]);
  await c.query(
   "INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,'instagram.revoked',$4)",
   [randomUUID(),tenant,user,JSON.stringify({channelId:channel})]);
  await c.query('COMMIT');
  return {ok:true,revoked:true};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function sendInstagramReply(pool,{
 tenantId,conversationId,userId,text,clientRequestId,request=fetch,env=process.env
}){
 if(!instagramReady(env))throw err(503,'Instagram não configurado.');
 if(!instagramOutboundEnabled(env))throw err(503,'Envio externo desabilitado neste ambiente.');
 if(!uuid(conversationId)||!uuid(clientRequestId)||typeof text!=='string'||!text.trim()||
    text.length>1000)throw err(422,'Mensagem ou identificador inválido; limite de 1.000 caracteres.');
 const content=text.trim(),textHash=createHash('sha256').update(content).digest('hex');
 const account=await pool.query(
  "SELECT c.customer_phone,c.channel_id,i.ig_user_id,i.token_ciphertext,i.token_expires_at "+
  "FROM conversations c JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=c.tenant_id "+
  " AND ch.provider='instagram' AND ch.status='connected' "+
  "JOIN instagram_accounts i ON i.tenant_id=c.tenant_id AND i.channel_id=c.channel_id AND i.status='connected' "+
  "LEFT JOIN conversation_ui_state st ON st.tenant_id=c.tenant_id AND st.conversation_id=c.id "+
  "WHERE c.tenant_id=$1 AND c.id=$2 AND COALESCE(st.handling_mode,'human')='human' "+
  "AND EXISTS(SELECT 1 FROM messages m WHERE m.tenant_id=c.tenant_id AND m.conversation_id=c.id "+
  " AND m.direction='inbound' AND m.created_at>=now()-interval '23 hours')",
  [tenantId,conversationId]);
 if(!account.rowCount)throw err(403,'Resposta permitida somente após mensagem recente e com atendimento humano.');
 const chat=account.rows[0],recipient=String(chat.customer_phone||'').replace(/^ig:/,'');
 if(!igId(recipient)||!chat.token_ciphertext||
    (chat.token_expires_at&&new Date(chat.token_expires_at).getTime()<Date.now()+60000))
  throw err(503,'Instagram desconectado ou autorização expirada.');
 const reserved=await pool.query(
  "INSERT INTO instagram_outbox(id,tenant_id,conversation_id,user_id,client_request_id,text_sha256,status) "+
  "VALUES($1,$2,$3,$4,$5,$6,'processing') "+
  "ON CONFLICT(tenant_id,client_request_id) DO NOTHING RETURNING id",
  [randomUUID(),tenantId,conversationId,userId,clientRequestId,textHash]);
 if(!reserved.rowCount){
  const older=await pool.query(
   'SELECT id,conversation_id,text_sha256,status FROM instagram_outbox WHERE tenant_id=$1 AND client_request_id=$2',
   [tenantId,clientRequestId]);
  if(!older.rowCount||older.rows[0].conversation_id!==conversationId||older.rows[0].text_sha256!==textHash)
   throw err(409,'Identificador de envio já utilizado.');
  return {id:older.rows[0].id,sent:older.rows[0].status==='sent',
   reused:true,status:older.rows[0].status,channel:'instagram'};
 }
 const outboxId=reserved.rows[0].id,token=decryptInstagramToken(chat.token_ciphertext,env);
 let answer;
 try{
  const response=await request(
   'https://graph.instagram.com/'+version(env)+'/'+chat.ig_user_id+'/messages',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({recipient:{id:recipient},message:{text:content}}),
   signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
   await pool.query("UPDATE instagram_outbox SET status='failed',updated_at=now() WHERE id=$1",[outboxId]);
   throw err(503,'O Instagram rejeitou o envio. Verifique a autorização.');
  }
  answer=await response.json();
 }catch(e){
  if(e.status===503)throw e;
  await pool.query("UPDATE instagram_outbox SET status='uncertain',updated_at=now() WHERE id=$1",[outboxId]);
  return {id:outboxId,sent:false,reused:false,status:'uncertain',channel:'instagram'};
 }
 const providerId=String(answer?.message_id||'');
 if(!providerId||providerId.length>255){
  await pool.query("UPDATE instagram_outbox SET status='uncertain',updated_at=now() WHERE id=$1",[outboxId]);
  return {id:outboxId,sent:false,reused:false,status:'uncertain',channel:'instagram'};
 }
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id) "+
   "VALUES($1,$2,$3,'outbound',$4,$5) ON CONFLICT(tenant_id,provider_id) DO NOTHING",
   [randomUUID(),tenantId,conversationId,content,'instagram:'+providerId]);
  await c.query("UPDATE instagram_outbox SET status='sent',provider_message_id=$2,updated_at=now() WHERE id=$1",
   [outboxId,providerId]);
  await c.query("UPDATE conversations SET last_message_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,conversationId]);
  await c.query("INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,'instagram.message_sent',$4)",
   [randomUUID(),tenantId,userId,JSON.stringify({conversationId,outboxId})]);
  await c.query('COMMIT');
  return {id:outboxId,sent:true,reused:false,status:'sent',channel:'instagram'};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
