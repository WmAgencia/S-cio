// WA-AKG read-only adapter for Sócio: no send, no auth token in browser.
// A gateway session is accessible ONLY through the tenant-bound server record.
// The upstream chat listing is limited to 50 and is NOT a complete backup.
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
import {parseWhatsAppExport,buildTrainingMarkdown} from './lib.mjs';

const error=(status,message)=>Object.assign(new Error(message),{status});
export const MAX_CHATS_PER_SCAN=50;
export const MAX_MESSAGES_PER_CHAT=400;
export const MAX_HISTORY_PAGES=4;
const pathPart=x=>encodeURIComponent(String(x));
export function gatewayConfigured(env=process.env){
 return Boolean(env.WA_AKG_BASE_URL&&env.WA_AKG_API_KEY&&env.CHANNEL_ENCRYPTION_KEY?.length>=32);
}
export function gatewayBase(env=process.env){
 if(!gatewayConfigured(env))throw error(503,'WA-AKG ainda não configurado. A Consecom precisa vincular um gateway independente.');
 let url;
 try{url=new URL(env.WA_AKG_BASE_URL);}catch{throw error(503,'Endereço WA-AKG inválido.');}
 if(url.username||url.password||url.search||url.hash||(!['https:','http:'].includes(url.protocol)))throw error(503,'Endereço WA-AKG inválido.');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname)&&!url.hostname.endsWith('.railway.internal'))throw error(503,'Gateway deve usar HTTPS ou rede privada Railway.');
 return url.toString().replace(/\/+$/,'');
}
export async function gatewayRead(path,{env=process.env,fetchImpl=fetch,timeoutMs=12000}={}){
 const base=gatewayBase(env);
 if(!path.startsWith('/api/')||path.includes('..')||path.includes('#'))throw error(400,'Rota do gateway inválida.');
 const url=base+path;
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),Math.min(timeoutMs,16000));
 try{
  const response=await fetchImpl(url,{method:'GET',headers:{'x-api-key':env.WA_AKG_API_KEY,'Accept':'application/json'},signal:ctrl.signal});
  if(!response.ok)throw error(response.status===404?404:503,'WA-AKG indisponível ou acesso não autorizado à sessão.');
  const raw=await response.text();
  if(raw.length>4500000)throw error(503,'Gateway retornou dados grandes demais.');
  const payload=JSON.parse(raw);
  if(payload?.status===false)throw error(503,'Gateway recusou a leitura de histórico.');
  return payload;
 }catch(e){
  if(e.status)throw e;
  throw error(503,'Não foi possível consultar o gateway WA-AKG.');
 }finally{clearTimeout(timer);}
}
export const validSessionId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{6,64}$/.test(x);
export function privateJid(jid){
 return typeof jid==='string'&&/^[0-9]{5,24}@(s\.whatsapp\.net|lid)$/.test(jid);
}
export function selectPrivateChats(data){
 if(!Array.isArray(data))throw error(503,'Gateway retornou lista de conversas inválida.');
 return [...new Set(data.slice(0,MAX_CHATS_PER_SCAN).map(x=>x?.jid).filter(privateJid))];
}
export function keyFrom(env=process.env){
 if(!env.CHANNEL_ENCRYPTION_KEY||env.CHANNEL_ENCRYPTION_KEY.length<32)throw error(503,'Chave de proteção de sessões ausente.');
 return createHash('sha256').update(env.CHANNEL_ENCRYPTION_KEY).digest();
}
export function encryptJid(jid,tenantId,channelId,env=process.env){
 if(!privateJid(jid))throw error(422,'Conversa não é um contato individual do WhatsApp.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFrom(env),iv);
 cipher.setAAD(Buffer.from(tenantId+':'+channelId));
 const result=Buffer.concat([cipher.update(jid,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),result]).toString('base64url');
}
export function decryptJid(ciphertext,tenantId,channelId,env=process.env){
 try{
  const data=Buffer.from(ciphertext,'base64url');
  if(data.length<30)throw new Error('short');
  const decipher=createDecipheriv('aes-256-gcm',keyFrom(env),data.subarray(0,12));
  decipher.setAAD(Buffer.from(tenantId+':'+channelId));
  decipher.setAuthTag(data.subarray(12,28));
  const jid=Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
  if(!privateJid(jid))throw new Error('invalid');
  return jid;
 }catch{throw error(422,'Identificador da conversa corrompido ou associado a outra empresa.');}
}
export const jidHash=(jid,tenantId,env=process.env)=>createHmac('sha256',keyFrom(env)).update(tenantId+':'+jid).digest('hex');
function ptTimestamp(raw){
 const v=raw instanceof Date?raw:new Date(typeof raw==='number'&&raw<1e12?raw*1000:raw);
 if(!Number.isFinite(v.getTime()))return null;
 const p=n=>String(n).padStart(2,'0');
 return p(v.getUTCDate())+'/'+p(v.getUTCMonth()+1)+'/'+v.getUTCFullYear()+', '+p(v.getUTCHours())+':'+p(v.getUTCMinutes());
}
export function normalizeHistoryMessages(messages,jid){
 if(!privateJid(jid)||!Array.isArray(messages))return [];
 return messages.filter(m=>(m.remoteJid===jid)&&typeof m.content==='string'&&m.content.trim()
   &&!/(audio|image|video|sticker|document|contact|location|reaction|protocol|poll)/i.test(String(m.type||'')))
  .slice(0,MAX_MESSAGES_PER_CHAT).map(m=>{
   const date=ptTimestamp(m.timestamp);
   if(!date)return null;
   const speaker=m.fromMe===true?'Atendente':'Cliente';
   const text=m.content.replace(/[\r\n\t]/g,' ').replace(/\s+/g,' ').trim().slice(0,600);
   return date+' - '+speaker+': '+text;
  }).filter(Boolean);
}
export async function getSessionStatus(sessionId,opts={}){
 if(!validSessionId(sessionId))throw error(422,'Identificador da sessão inválido.');
 const payload=await gatewayRead('/api/sessions/'+pathPart(sessionId),opts);
 if(payload.data?.sessionId!==sessionId)throw error(503,'Gateway retornou outra sessão.');
 return {connected:String(payload.data.status).toUpperCase()==='CONNECTED',status:String(payload.data.status||'UNKNOWN').slice(0,40)};
}
export async function listAvailableChats(sessionId,opts={}){
 if(!validSessionId(sessionId))throw error(422,'Sessão inválida.');
 const data=(await gatewayRead('/api/chat/'+pathPart(sessionId),opts)).data;
 const list=selectPrivateChats(data);
 return {jids:list,partial:!Array.isArray(data)?true:data.length>=MAX_CHATS_PER_SCAN,
  discoveredChats:Array.isArray(data)?data.length:0};
}
export async function loadChatSample(sessionId,jid,{env=process.env,fetchImpl=fetch,maxPages=MAX_HISTORY_PAGES}={}){
 if(!validSessionId(sessionId)||!privateJid(jid))throw error(422,'Sessão ou conversa inválida.');
 const all=[];
 let total=0,readPages=0,partial=false;
 for(let page=1;page<=Math.min(maxPages,MAX_HISTORY_PAGES);page++){
  const query=new URLSearchParams({jid,limit:'100',page:String(page)});
  const result=await gatewayRead('/api/messages/'+pathPart(sessionId)+'/search?'+query.toString(),{env,fetchImpl});
  const rows=result.data;
  if(!Array.isArray(rows))throw error(503,'Histórico de mensagens em formato desconhecido.');
  all.push(...rows);
  readPages++;
  total=Number(result.pagination?.total||all.length);
  if(rows.length<100||all.length>=total)break;
  if(page===MAX_HISTORY_PAGES)partial=true;
 }
 if(total>all.length)partial=true;
 // Gateway returns newest first. Sort to rebuild chronological messages.
 all.sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
 const input=normalizeHistoryMessages(all,jid).join('\n');
 const parsed=parseWhatsAppExport(input);
 const markdown=buildTrainingMarkdown(parsed,'conversa-do-gateway');
 const evidence=createHmac('sha256',keyFrom(env));
 for(const m of all)evidence.update(JSON.stringify([m.keyId,m.timestamp,m.content,m.fromMe]));
 return {markdown,messageCount:parsed.messageCount,partial,pages:readPages,
  fingerprint:evidence.digest('hex')};
}
