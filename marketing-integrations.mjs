// Sócio: tenant-isolated Instagram lab, hosted Pipeboard (read-only) and Google Ads Scripts.
// Credentials remain AES-256-GCM encrypted, and never appear in logs or GET responses.
// The Instagram private API is not used for real account actions until a separate,
 // explicitly authorized test connection is provided.
import {randomUUID,randomBytes,createHmac,createCipheriv,createDecipheriv,timingSafeEqual,createHash} from 'node:crypto';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const validUUID=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const metaAccount=v=>typeof v==='string'&&/^act_\d{4,20}$/.test(v);
const googleAccount=v=>typeof v==='string'&&/^\d{10}$/.test(v);
const safeLabel=v=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=90;
const jsonFail=v=>typeof v==='string'?v.slice(0,180):'';
export const INSTAGRAM_LAB_IMAGE='ghcr.io/subzeroid/aiograpi-rest:6.0.0';
export const PIPEBOARD_HOSTED_URL='https://meta-ads.mcp.pipeboard.co/';
const networkHost=(env=process.env)=>{
 const url=String(env.SOCIO_INSTAGRAM_LAB_URL||'');
 if(!url)return null;
 const parsed=new URL(url);
 if(parsed.protocol!=='http:'||!parsed.hostname.endsWith('.railway.internal')||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')
  throw fail(503,'Configuração privada do laboratório Instagram inválida.');
 return parsed.href;
};
export function marketingSecretKey(env=process.env){
 const master=env.CHANNEL_ENCRYPTION_KEY;
 if(!master||master.length<32)throw fail(503,'Proteção de credenciais indisponível.');
 return createHmac('sha256',master).update('socio:marketing-connectors:aes-gcm:v1').digest();
}
export function sealMarketingSecret(value,env=process.env){
 if(typeof value!=='string'||value.length<32||value.length>18000)throw fail(422,'Credencial inválida.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',marketingSecretKey(env),iv);
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return ['v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('base64')].join('.');
}
export function openMarketingSecret(value,env=process.env){
 const parts=String(value||'').split('.');
 if(parts.length!==4||parts[0]!=='v1'||!/^[0-9a-f]{24}$/.test(parts[1])||!/^[0-9a-f]{32}$/.test(parts[2]))
  throw fail(503,'Credencial protegida inválida.');
 const dec=createDecipheriv('aes-256-gcm',marketingSecretKey(env),Buffer.from(parts[1],'hex'));
 dec.setAuthTag(Buffer.from(parts[2],'hex'));
 return Buffer.concat([dec.update(Buffer.from(parts[3],'base64')),dec.final()]).toString('utf8');
}
export async function instagramLabHealth({env=process.env,request=fetch}={}){
 const origin=networkHost(env);
 if(!origin)return {installed:false,reachable:false,accountConnected:false,mode:'isolated'};
 try{
  const res=await request(origin+'health',{signal:AbortSignal.timeout(3800)});
  return {installed:true,reachable:res.ok,accountConnected:false,mode:'isolated',version:'6.0.0'};
 }catch{return {installed:true,reachable:false,accountConnected:false,mode:'isolated'};}
}
export async function pipeboardReadAccountIds(token,{request=fetch}={}){
 if(typeof token!=='string'||token.length<32||token.length>18000)
  throw fail(422,'Token Pipeboard inválido.');
 const requestBody=JSON.stringify({
  jsonrpc:'2.0',id:1,method:'tools/call',
  params:{name:'mcp_meta_ads_get_ad_accounts',arguments:{user_id:'me',limit:200}}
 });
 let response;
 try{
  response=await request(PIPEBOARD_HOSTED_URL,{method:'POST',headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json',
   Accept:'application/json, text/event-stream'},
   body:requestBody,signal:AbortSignal.timeout(10000)
  });
 }catch{throw fail(503,'Pipeboard não respondeu à verificação de leitura.');}
 if(!response.ok)throw fail(503,'Pipeboard recusou a autorização; confirme o token e as contas permitidas.');
 const raw=await response.text();
 if(raw.length>180000)throw fail(503,'Resposta Pipeboard excedeu o limite.');
 const candidate=raw.includes('data:')?
  raw.split('\n').filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).filter(x=>x!=='[DONE]'):
  [raw];
 let payload=null;
 for(const line of candidate){
  try{const parsed=JSON.parse(line);if(parsed?.result)payload=parsed;}catch{}
 }
 if(!payload?.result||payload.result.isError===true)throw fail(503,'Pipeboard não confirmou a leitura das contas.');
 const serialized=JSON.stringify(payload.result);
 // Id extraction is conservative: no messages are shown to the browser.
 // A successful, explicitly account-scoped read is required before "verified".
 const ids=new Set((serialized.match(/act_\d{4,20}/g)||[]).slice(0,201));
 return ids;
}
export async function connectPipeboard(pool,a,{accountId,label,token},opts={}){
 if(!metaAccount(accountId)||!safeLabel(label)||typeof token!=='string'||token.length<32)
  throw fail(422,'Conta, identificação ou token Pipeboard inválidos.');
 // Verify the operator's account scope before accepting the token.
 const ids=await pipeboardReadAccountIds(token,opts);
 if(!ids.has(accountId))throw fail(403,'O token Pipeboard não possui acesso de leitura a esta conta.');
 const sealed=sealMarketingSecret(token,opts.env||process.env);
 const saved=await pool.query(
  "INSERT INTO marketing_connections(id,tenant_id,provider,account_id,label,secret_ciphertext,created_by,status,last_verified_at) "+
  "VALUES($1,$2,'pipeboard_meta',$3,$4,$5,$6,'verified',now()) "+
  "ON CONFLICT(tenant_id,provider,account_id) DO UPDATE SET "+
  "label=EXCLUDED.label,secret_ciphertext=EXCLUDED.secret_ciphertext,status='verified', "+
  "last_verified_at=now(),updated_at=now() RETURNING id,account_id,label,status,last_verified_at",
  [randomUUID(),a.active_tenant_id,accountId,label.trim(),sealed,a.user_id]);
 return saved.rows[0];
}
export async function registerGoogleAdsScript(pool,a,{accountId,label},env=process.env){
 if(!googleAccount(accountId)||!safeLabel(label))throw fail(422,'Número da conta Google Ads inválido (10 dígitos).');
 const publicUrl=String(env.SOCIO_PUBLIC_URL||'').replace(/\/$/,'');
 if(!/^https:\/\/[a-z0-9.-]+$/i.test(publicUrl))throw fail(503,'URL pública HTTPS não configurada.');
 const secret=randomBytes(42).toString('base64url');
 const secretCiphertext=sealMarketingSecret(secret,env);
 const result=await pool.query(
  "INSERT INTO marketing_connections(id,tenant_id,provider,account_id,label,secret_ciphertext,created_by,status) "+
  "VALUES($1,$2,'google_ads_scripts',$3,$4,$5,$6,'pending') "+
  "ON CONFLICT(tenant_id,provider,account_id) DO UPDATE SET "+
  "label=EXCLUDED.label,secret_ciphertext=EXCLUDED.secret_ciphertext,status='pending', "+
  "last_verified_at=NULL,updated_at=now() RETURNING id,account_id,label,status",
  [randomUUID(),a.active_tenant_id,accountId,label.trim(),secretCiphertext,a.user_id]);
 const connection=result.rows[0];
 // Return the newly rotated secret once; never expose it in a GET endpoint.

 return {...connection,secret,endpoint:publicUrl+'/webhooks/google-ads/'+connection.id};
}
export function verifyGoogleReport(raw,signature,connection,payload,now=Date.now(),env=process.env){
 if(!Buffer.isBuffer(raw)||raw.length>130000||!connection||connection.provider!=='google_ads_scripts'||connection.status==='disabled')
  throw fail(403,'Origem do relatório não autorizada.');
 const match=typeof signature==='string'&&/^sha256=([0-9a-f]{64})$/.exec(signature);
 if(!match)throw fail(403,'Assinatura do relatório ausente.');
 const token=openMarketingSecret(connection.secret_ciphertext,env);
 const actual=createHmac('sha256',token).update(raw).digest();
 if(!timingSafeEqual(actual,Buffer.from(match[1],'hex')))throw fail(403,'Assinatura incorreta.');
 if(payload?.version!==1||payload.accountId!==connection.account_id||!validUUID(payload.runId)||
    !Number.isInteger(payload.timestamp)||Math.abs(payload.timestamp-now)>10*60000||
    !Array.isArray(payload.rows)||payload.rows.length>100)
  throw fail(422,'Relatório inválido ou fora do período de aceitação.');
 for(const row of payload.rows){
  const d=Date.parse(String(row.date||'')+'T12:00:00Z');
  if(!/^\d{4}-\d\d-\d\d$/.test(String(row.date||''))||!Number.isFinite(d)||d>now+86400000||d<now-45*86400000||
   !/^\d{1,22}$/.test(String(row.campaignId||''))||
   typeof row.campaignName!=='string'||row.campaignName.length>160||
   ![row.impressions,row.clicks,row.costMicros].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=1e14)||
   typeof row.conversions!=='number'||!Number.isFinite(row.conversions)||row.conversions<0||row.conversions>1e10)
   throw fail(422,'Métricas Google Ads inválidas.');
 }
 return true;
}
export async function ingestGoogleReport(pool,connectionId,raw,signature,{now=Date.now(),env=process.env}={}){
 if(!validUUID(connectionId))throw fail(404,'Conector não encontrado.');
 let payload;
 try{payload=JSON.parse(raw.toString('utf8'));}catch{throw fail(400,'JSON inválido.');}
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const r=await c.query(
   "SELECT id,tenant_id,provider,account_id,status,secret_ciphertext "+
   "FROM marketing_connections WHERE id=$1 AND provider='google_ads_scripts' FOR UPDATE",
   [connectionId]);
  if(!r.rowCount)throw fail(404,'Conector não encontrado.');
  const connection=r.rows[0];
  verifyGoogleReport(raw,signature,connection,payload,now,env);
  const claimed=await c.query(
   "INSERT INTO marketing_report_receipts(id,tenant_id,connection_id,run_id) VALUES($1,$2,$3,$4) "+
   "ON CONFLICT(connection_id,run_id) DO NOTHING RETURNING id",
   [randomUUID(),connection.tenant_id,connection.id,payload.runId]);
  if(!claimed.rowCount){await c.query('COMMIT');return {ok:true,reused:true,stored:0};}
  for(const row of payload.rows){
   await c.query(
    "INSERT INTO marketing_daily_metrics(id,tenant_id,connection_id,date,campaign_id,campaign_name,impressions,clicks,cost_micros,conversions) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) "+
    "ON CONFLICT(connection_id,date,campaign_id) DO UPDATE SET "+
    "campaign_name=EXCLUDED.campaign_name,impressions=EXCLUDED.impressions, "+
    "clicks=EXCLUDED.clicks,cost_micros=EXCLUDED.cost_micros,conversions=EXCLUDED.conversions,updated_at=now()",
    [randomUUID(),connection.tenant_id,connection.id,row.date,row.campaignId,row.campaignName,
     row.impressions,row.clicks,row.costMicros,row.conversions]);
  }
  await c.query(
   "UPDATE marketing_connections SET status='verified',last_verified_at=now(),updated_at=now() WHERE id=$1",[connection.id]);
  await c.query('COMMIT');
  return {ok:true,reused:false,stored:payload.rows.length};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function disconnectMarketing(pool,a,connectionId){
 if(!validUUID(connectionId))throw fail(404,'Conector não encontrado.');
 const r=await pool.query(
  "UPDATE marketing_connections SET status='disabled',secret_ciphertext=NULL,updated_at=now() "+
  "WHERE id=$1 AND tenant_id=$2 AND status<>'disabled' RETURNING id,provider,account_id",
  [connectionId,a.active_tenant_id]);
 if(!r.rowCount)throw fail(404,'Conector não encontrado.');
 return {ok:true,connection:r.rows[0]};
}
export async function listMarketing(pool,a){
 const [links,metrics]=await Promise.all([
  pool.query("SELECT id,provider,account_id,label,status,last_verified_at,created_at "+
   "FROM marketing_connections WHERE tenant_id=$1 ORDER BY created_at DESC",[a.active_tenant_id]),
  pool.query("SELECT m.connection_id,m.date,m.campaign_name,m.impressions,m.clicks,m.cost_micros,m.conversions "+
   "FROM marketing_daily_metrics m JOIN marketing_connections c ON c.id=m.connection_id AND c.tenant_id=m.tenant_id "+
   "WHERE m.tenant_id=$1 ORDER BY date DESC,m.campaign_name LIMIT 120",[a.active_tenant_id])
 ]);
 return {connections:links.rows,reports:metrics.rows,
  providers:{instagram_lab:{type:'non_official',noAccountConnected:true},
   pipeboard_meta:{hosted:true,readOnly:true,requiresToken:true},
   google_ads_scripts:{readOnly:true,requiresScriptAuthorization:true}}};
}
export function googleScriptTemplate({endpoint,accountId,secret}){
 // Configuration is filled on the browser only with the one-time returned secret.
 if(!/^https:\/\//.test(endpoint)||!googleAccount(accountId)||typeof secret!=='string'||secret.length<32)
  throw fail(422,'Configuração do script inválida.');
 return [
  "// Sócio — Google Ads Scripts, leitura somente. Cole na conta autorizada.",
  "const SOCIO_ENDPOINT = "+JSON.stringify(endpoint)+";",
  "const SOCIO_ACCOUNT = "+JSON.stringify(accountId)+";",
  "const SOCIO_SECRET = "+JSON.stringify(secret)+";",
  "function main(){",
  "  const id = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');",
  "  if (id !== SOCIO_ACCOUNT) throw new Error('Conta Google Ads diferente da autorizada');",
  "  const query = 'SELECT segments.date,campaign.id,campaign.name,metrics.impressions,metrics.clicks,metrics.cost_micros,metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS';",
  "  const iter=AdsApp.search(query),rows=[];",
  "  while(iter.hasNext() && rows.length < 100){",
  "    const row=iter.next();",
  "    rows.push({date:row.segments.date,campaignId:String(row.campaign.id),campaignName:String(row.campaign.name).slice(0,160),",
  "      impressions:Number(row.metrics.impressions),clicks:Number(row.metrics.clicks),",
  "      costMicros:Number(row.metrics.costMicros),conversions:Number(row.metrics.conversions)});",
  "  }",
  "  const runId=Utilities.getUuid();",
  "  const payload=JSON.stringify({version:1,accountId:SOCIO_ACCOUNT,runId:runId,timestamp:Date.now(),rows:rows});",
  "  const sig=Utilities.computeHmacSha256Signature(payload,SOCIO_SECRET,Utilities.Charset.UTF_8);",
  "  const hex=sig.map(function(x){return ('0'+((x+256)%256).toString(16)).slice(-2);}).join('');",
  "  const response=UrlFetchApp.fetch(SOCIO_ENDPOINT,{method:'post',contentType:'application/json',",
  "    payload:payload,headers:{'X-Socio-Signature-256':'sha256='+hex},muteHttpExceptions:true});",
  "  if(response.getResponseCode()!==200)throw new Error('Falha no recebimento do Sócio: '+response.getResponseCode());",
  "  Logger.log('Relatório enviado: '+rows.length+' linhas.');",
  "}"
 ].join('\n');
}
