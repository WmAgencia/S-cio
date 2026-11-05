// Sócio Ads Media Bridge: private, tenant-scoped video storage and signed Meta fetch URLs.
// Extends the official Meta Ads MCP; NEVER handles Meta access tokens or publishes ads.
import {randomUUID,randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {gatewayBase,gatewayRead,validSessionId,privateJid} from './waakg-adapter.mjs';
const err=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeMessage=/^[A-Za-z0-9_-]{4,180}$/;
export const MAX_AD_VIDEO_BYTES=90*1024*1024;
export const PUBLIC_LINK_TTL=20*60;
export const UPLOAD_LINK_TTL=15*60;
const safeFile=name=>typeof name==='string'&&name.length<150&&/^[^/\\\r\n\x00-\x1f]+\.(mp4|mov)$/i.test(name);
const validTenant=id=>typeof id==='string'&&uuid.test(id);
const sha=value=>createHash('sha256').update(value).digest('hex');
const stripPhone=v=>String(v||'').replace(/\D/g,'');
const ext=name=>name.toLowerCase().endsWith('.mov')?'video/quicktime':'video/mp4';
function sign(tenantId,mediaId,purpose,expiry,env=process.env){
 const secret=env.CHANNEL_ENCRYPTION_KEY;
 if(!secret||secret.length<32)throw err(503,'Chave de proteção de mídia indisponível.');
 return createHmac('sha256',secret).update(['socio-ads-media-v1',tenantId,mediaId,purpose,expiry].join(':')).digest('base64url');
}
function verify(ticket,tenantId,mediaId,purpose,expiry,env=process.env){
 if(!/^\d{10,11}$/.test(String(expiry))||Number(expiry)<Math.floor(Date.now()/1000)||
   Number(expiry)>Math.floor(Date.now()/1000)+PUBLIC_LINK_TTL+60||
   typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ticket))return false;
 const expected=sign(tenantId,mediaId,purpose,expiry,env);
 return timingSafeEqual(Buffer.from(ticket),Buffer.from(expected));
}
function publicOrigin(env=process.env){
 let u;try{u=new URL(env.SOCIO_PUBLIC_URL||'');}catch{throw err(503,'URL HTTPS pública do Sócio não configurada.');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!u.hostname.includes('.'))
  throw err(503,'URL pública inválida.');
 return u.origin;
}
let s3Instance;
async function store(env=process.env){
 if(!env.SOCIO_S3_ENDPOINT||!env.SOCIO_S3_BUCKET||!env.SOCIO_S3_ACCESS_KEY||
 !env.SOCIO_S3_SECRET_KEY||!env.SOCIO_S3_REGION)throw err(503,'Armazenamento privado de mídia indisponível.');
 if(!s3Instance){
  const sdk=await import('@aws-sdk/client-s3');
  s3Instance={client:new sdk.S3Client({endpoint:env.SOCIO_S3_ENDPOINT,region:env.SOCIO_S3_REGION,
   credentials:{accessKeyId:env.SOCIO_S3_ACCESS_KEY,secretAccessKey:env.SOCIO_S3_SECRET_KEY},
   forcePathStyle:false,maxAttempts:2}),sdk};
 }
 return s3Instance;
}
export async function reserveAdVideo(pool,a,filename,source='chat'){
 if(!validTenant(a?.active_tenant_id)||!safeFile(filename)||!['chat','whatsapp','mcp'].includes(source))
  throw err(422,'Use um vídeo MP4 ou MOV com nome válido.');
 const id=randomUUID(),key='ads-private/'+a.active_tenant_id+'/'+id+'/source'+(filename.toLowerCase().endsWith('.mov')?'.mov':'.mp4');
 const r=await pool.query(
  "INSERT INTO ads_media(id,tenant_id,created_by,filename,source,object_key,content_type,status) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,'reserved') RETURNING id,filename,source,status,created_at",
  [id,a.active_tenant_id,a.user_id,filename,source,key,ext(filename)]);
 return r.rows[0];
}
export async function listAdVideos(pool,tenantId,limit=35){
 if(!validTenant(tenantId))throw err(403,'Empresa inválida.');
 const r=await pool.query("SELECT id,filename,source,status,bytes,content_type,created_at,updated_at "+
  "FROM ads_media WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2",[tenantId,Math.min(50,Math.max(1,Number(limit)||35))]);
 return r.rows;
}
export async function findVideo(pool,tenantId,id){
 if(!validTenant(tenantId)||!uuid.test(id))throw err(422,'Identificador de vídeo inválido.');
 const r=await pool.query("SELECT id,tenant_id,filename,source,status,object_key,content_type,bytes,sha256,created_at "+
  "FROM ads_media WHERE tenant_id=$1 AND id=$2",[tenantId,id]);
 if(!r.rowCount)throw err(404,'Vídeo não encontrado para esta empresa.');
 return r.rows[0];
}
function validMp4Header(header){
 return header.length>=12&&header.toString('ascii',4,8)==='ftyp'&&header.readUInt32BE(0)>=8;
}
async function spoolVideo(source){
 const file=path.join(tmpdir(),'socio-ads-'+randomUUID()+'.upload');
 const handle=await open(file,'wx',0o600);
 let size=0,head=Buffer.alloc(0);
 const hash=createHash('sha256');
 try{
  for await(const piece of source){
   const chunk=Buffer.isBuffer(piece)?piece:Buffer.from(piece);
   size+=chunk.length;
   if(size>MAX_AD_VIDEO_BYTES)throw err(413,'Vídeo maior que 90 MB.');
   if(head.length<12)head=Buffer.concat([head,chunk.subarray(0,12-head.length)]);
   hash.update(chunk);
   await handle.write(chunk);
  }
 }catch(e){await handle.close();await unlink(file).catch(()=>{});throw e;}
 await handle.close();
 if(size<512||!validMp4Header(head)){await unlink(file).catch(()=>{});throw err(422,'Arquivo MP4/MOV inválido ou sem assinatura ftyp.');}
 return {file,size,digest:hash.digest('hex')};
}
export async function storeAdVideo(pool,tenantId,mediaId,readable,{env=process.env,declaredBytes}={}){
 const row=await findVideo(pool,tenantId,mediaId);
 if(row.status!=='reserved')throw err(409,'Envio indisponível: mídia já utilizada ou em processamento.');
 if(declaredBytes&&(!Number.isSafeInteger(declaredBytes)||declaredBytes>MAX_AD_VIDEO_BYTES))
  throw err(413,'Arquivo maior que o limite de 90 MB.');
 const lock=await pool.query("UPDATE ads_media SET status='uploading',updated_at=now() "+
  "WHERE tenant_id=$1 AND id=$2 AND status='reserved' RETURNING id",[tenantId,mediaId]);
 if(!lock.rowCount)throw err(409,'Esta mídia já está sendo enviada.');
 let tmp=null;
 try{
  tmp=await spoolVideo(readable);
  if(declaredBytes&&tmp.size!==declaredBytes)throw err(422,'Tamanho do vídeo não corresponde ao envio.');
  if(env.NODE_ENV==='test'&&env.SOCIO_STORAGE_DRIVER==='memory'){
   const {readFile}=await import('node:fs/promises');memoryAssets.set(row.object_key,await readFile(tmp.file));
  }else{
   const {client,sdk}=await store(env);
   await client.send(new sdk.PutObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:row.object_key,
    Body:createReadStream(tmp.file),ContentLength:tmp.size,ContentType:row.content_type,
    CacheControl:'private,no-store',Metadata:{sha256:tmp.digest}}));
  }
  await pool.query("UPDATE ads_media SET status='ready',bytes=$3,sha256=$4,updated_at=now() "+
   "WHERE tenant_id=$1 AND id=$2 AND status='uploading'",[tenantId,mediaId,tmp.size,tmp.digest]);
  return {id:mediaId,status:'ready',bytes:tmp.size,sha256:tmp.digest};
 }catch(e){
  await pool.query("UPDATE ads_media SET status='failed',updated_at=now() "+
   "WHERE tenant_id=$1 AND id=$2 AND status='uploading'",[tenantId,mediaId]).catch(()=>{});
  throw e;
 }finally{if(tmp)await unlink(tmp.file).catch(()=>{});}
}
const memoryAssets=new Map();
export async function adVideoExportUrl(pool,tenantId,id,env=process.env){
 const row=await findVideo(pool,tenantId,id);
 if(row.status!=='ready')throw err(409,'Vídeo não está pronto.');
 const expiry=Math.floor(Date.now()/1000)+PUBLIC_LINK_TTL;
 const token=sign(tenantId,id,'meta-fetch',expiry,env);
 return {id,url:publicOrigin(env)+'/media/ads/'+id+'?expires='+expiry+'&signature='+token,
  expiresAt:new Date(expiry*1000).toISOString(),mimeType:row.content_type,bytes:row.bytes,
  instructions:'Envie esta URL para a ferramenta oficial ads_creative_upload_media com upload_source=URL e media_type=VIDEO. A publicação permanece independente e requer autorização.'};
}
export async function adVideoUploadLink(pool,a,filename,env=process.env){
 const asset=await reserveAdVideo(pool,a,filename,'mcp');
 const expiry=Math.floor(Date.now()/1000)+UPLOAD_LINK_TTL;
 const token=sign(a.active_tenant_id,asset.id,'upload',expiry,env);
 return {id:asset.id,uploadPage:publicOrigin(env)+'/ads-upload/'+asset.id+'?expires='+expiry+'&signature='+token,
  expiresAt:new Date(expiry*1000).toISOString(),maxBytes:MAX_AD_VIDEO_BYTES,
  instructions:'Abra o link, selecione o vídeo e envie; depois consulte ads_media_status até estar ready.'};
}
export async function resolveSignedAsset(pool,id,expiry,signature,purpose,env=process.env){
 if(!uuid.test(String(id)))throw err(404,'Vídeo não encontrado.');
 const r=await pool.query("SELECT id,tenant_id,object_key,status,bytes,content_type FROM ads_media WHERE id=$1",[id]);
 if(!r.rowCount||!verify(signature,r.rows[0].tenant_id,id,purpose,expiry,env))
  throw err(403,'Link inválido ou expirado.');
 return r.rows[0];
}
export async function serveSignedVideo(pool,id,expiry,signature,req,res,env=process.env){
 const row=await resolveSignedAsset(pool,id,expiry,signature,'meta-fetch',env);
 if(row.status!=='ready')throw err(404,'Mídia ainda não disponível.');
 if(!['GET','HEAD'].includes(req.method))throw err(405,'Método não permitido.');
 const size=Number(row.bytes);let start=0,end=size-1,partial=false;
 const requestRange=req.headers.range;
 if(requestRange){
  const match=/^bytes=(\d*)-(\d*)$/.exec(requestRange);
  if(!match||(!match[1]&&!match[2]))throw err(416,'Intervalo inválido.');
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)throw err(416,'Intervalo inválido.');start=Math.max(0,size-suffix);}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)throw err(416,'Intervalo fora do arquivo.');
  end=Math.min(end,size-1);partial=true;
 }
 const headers={'Content-Type':row.content_type,'Content-Length':String(end-start+1),
  'Cache-Control':'private,no-store','Accept-Ranges':'bytes','X-Robots-Tag':'noindex,nofollow',
  'Content-Disposition':'inline; filename="anuncio.mp4"','X-Content-Type-Options':'nosniff'};
 if(partial)headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
 if(req.method==='HEAD'){res.writeHead(partial?206:200,headers);return res.end();}
 if(env.NODE_ENV==='test'&&env.SOCIO_STORAGE_DRIVER==='memory'){
  const bytes=memoryAssets.get(row.object_key);if(!bytes)throw err(404,'Mídia não encontrada.');
  res.writeHead(partial?206:200,headers);return res.end(bytes.subarray(start,end+1));
 }
 const {client,sdk}=await store(env);
 const result=await client.send(new sdk.GetObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:row.object_key,
  ...(partial?{Range:'bytes='+start+'-'+end}:{})}));
 res.writeHead(partial?206:200,headers);
 await new Promise((resolve,reject)=>{
  result.Body.on('error',reject);res.on('error',reject);result.Body.on('end',resolve);
  result.Body.pipe(res);
 });
}
export async function importWhatsAppAdVideo(pool,a,{channelId,jid,messageId,filename},opts={}){
 if(!uuid.test(String(channelId))||!privateJid(jid)||!safeMessage.test(String(messageId))||!safeFile(filename))
  throw err(422,'Selecione uma mensagem de vídeo individual válida.');
 const ownerPhone=stripPhone(a.phone);
 if(ownerPhone.length<10||ownerPhone!==jid.split('@')[0])
  throw err(403,'Somente mensagens enviadas pelo telefone cadastrado do gestor podem se tornar anúncios.');
 const linked=await pool.query("SELECT l.session_id FROM waakg_links l JOIN channels c "+
  "ON c.id=l.channel_id AND c.tenant_id=l.tenant_id "+
  "WHERE l.tenant_id=$1 AND l.channel_id=$2 AND c.status='connected' AND c.provider='waakg'",
  [a.active_tenant_id,channelId]);
 if(!linked.rowCount||!validSessionId(linked.rows[0].session_id))throw err(404,'Canal WhatsApp não encontrado.');
 const session=linked.rows[0].session_id;
 const params=new URLSearchParams({jid,limit:'100',page:'1'});
 const history=(await gatewayRead('/api/messages/'+encodeURIComponent(session)+'/search?'+params,{...opts})).data;
 const selected=Array.isArray(history)&&history.find(m=>String(m.keyId||m.id)===messageId&&
   m.remoteJid===jid&&m.fromMe!==true&&/video/i.test(String(m.type||'')));
 if(!selected)throw err(403,'Vídeo não encontrado no histórico autorizado deste contato.');
 const base=gatewayBase(opts.env||process.env);
 const url=base+'/api/messages/'+encodeURIComponent(session)+'/download/'+encodeURIComponent(messageId)+'/media';
 const download=await (opts.fetchImpl||fetch)(url,{headers:{'x-api-key':(opts.env||process.env).WA_AKG_API_KEY},
  redirect:'manual',signal:AbortSignal.timeout(30000)});
 if(!download.ok||!download.body)throw err(503,'Não foi possível baixar a mídia da mensagem.');
 if(download.headers.get('content-type')?.includes('application/json'))throw err(503,'O gateway não retornou vídeo binário.');
 const size=Number(download.headers.get('content-length')||0);
 if(size>MAX_AD_VIDEO_BYTES)throw err(413,'Vídeo do WhatsApp excedeu 90 MB.');
 const asset=await reserveAdVideo(pool,a,filename,'whatsapp');
 const result=await storeAdVideo(pool,a.active_tenant_id,asset.id,Readable.fromWeb(download.body),
  {declaredBytes:size||undefined,env:opts.env||process.env});
 return {id:asset.id,status:result.status,bytes:result.bytes,source:'whatsapp'};
}
export function digestToken(token){return sha(String(token));}
export async function createMediaMcpToken(pool,a){
 const token='socioads_'+randomBytes(36).toString('base64url');
 const expiresAt=new Date(Date.now()+30*86400000);
 await pool.query("UPDATE ads_media_mcp_tokens SET revoked_at=now() "+
  "WHERE tenant_id=$1 AND created_by=$2 AND revoked_at IS NULL",[a.active_tenant_id,a.user_id]);
 await pool.query("INSERT INTO ads_media_mcp_tokens(id,tenant_id,created_by,token_hash,expires_at) "+
  "VALUES($1,$2,$3,$4,$5)",[randomUUID(),a.active_tenant_id,a.user_id,digestToken(token),expiresAt]);
 return {token,expiresAt:expiresAt.toISOString(),endpoint:publicOrigin()+'/mcp/ads-media'};
}
export async function revokeMediaMcpTokens(pool,a){
 await pool.query("UPDATE ads_media_mcp_tokens SET revoked_at=now() "+
  "WHERE tenant_id=$1 AND created_by=$2 AND revoked_at IS NULL",[a.active_tenant_id,a.user_id]);
 return {revoked:true};
}
export async function authenticateMediaMcp(pool,rawToken){
 if(typeof rawToken!=='string'||!/^socioads_[A-Za-z0-9_-]{48}$/.test(rawToken))throw err(401,'Token MCP ausente ou inválido.');
 const result=await pool.query(
  "SELECT t.tenant_id AS active_tenant_id,u.id AS user_id,u.role,u.phone,u.platform_owner,u.active "+
  "FROM ads_media_mcp_tokens tok JOIN tenants t ON t.id=tok.tenant_id "+
  "JOIN users u ON u.id=tok.created_by AND (u.tenant_id=t.id OR u.platform_owner=true) "+
  "WHERE tok.token_hash=$1 AND tok.revoked_at IS NULL AND tok.expires_at>now() "+
  "AND u.active=true AND t.status<>'paused' AND COALESCE((t.features->>'meta_ads')::boolean,true)=true",
  [digestToken(rawToken)]);
 const row=result.rows[0];
 if(!row||!['owner','admin'].includes(row.role)&&row.platform_owner!==true)
  throw err(401,'Token MCP não autorizado.');
 return row;
}
