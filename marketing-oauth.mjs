// OAuth for Pipeboard hosted Meta Ads and Google Ads MCPs.
// Uses standards-based authorization-server discovery + DCR or CIMD, PKCE S256,
// one-use state and tenant-bound encrypted tokens. No Meta/Google developer app.
// A successful login proves Pipeboard consent, NOT linked ad-account access.
import {createHash,randomBytes,createHmac} from 'node:crypto';
import {sealMarketingSecret,openMarketingSecret} from './marketing-integrations.mjs';

const bad=(status,message)=>Object.assign(new Error(message),{status});
const servers=Object.freeze({
 meta:'https://meta-ads.mcp.pipeboard.co/',
 google:'https://google-ads.mcp.pipeboard.co/'
});
const site=env=>{
 const value=new URL(String(env.SOCIO_PUBLIC_URL||''));
 if(value.protocol!=='https:'||value.username||value.password||value.search||value.hash||
    value.pathname!=='/'||!/^([a-z\d-]+\.)+[a-z\d-]+$/i.test(value.hostname))
   throw bad(503,'URL pública do Sócio não configurada.');
 return value.origin;
};
const pipeboardUrl=(candidate,limit='any')=>{
 const u=new URL(candidate);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||
    (u.hostname!=='pipeboard.co'&&!u.hostname.endsWith('.pipeboard.co'))||
    (limit==='metadata'&&(u.search||u.pathname.length>200)))
  throw bad(503,'O provedor retornou um destino de autenticação inválido.');
 return u.toString();
};
const secretSeal=(obj,env)=>sealMarketingSecret('socio-oauth-v1:'+JSON.stringify(obj),env);
const secretOpen=(sealed,env)=>{
 const clear=openMarketingSecret(sealed,env);
 if(!clear.startsWith('socio-oauth-v1:'))throw bad(503,'Autorização protegida inválida.');
 return JSON.parse(clear.slice('socio-oauth-v1:'.length));
};
const sha=x=>createHash('sha256').update(x).digest('hex');
const challenge=v=>createHash('sha256').update(v).digest('base64url');

async function readProviderJSON(url,{request=fetch,method='GET',body,headers}={}){
 pipeboardUrl(url);
 let response;
 try{
  response=await request(url,{method,headers:{Accept:'application/json',...(headers||{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   redirect:'manual',signal:AbortSignal.timeout(9000)});
 }catch{throw bad(503,'Pipeboard não respondeu à autorização OAuth.');}
 if(!response.ok)throw bad(503,'A configuração OAuth do Pipeboard não respondeu corretamente.');
 const raw=await response.text();
 if(raw.length>60000)throw bad(503,'Resposta OAuth do Pipeboard muito extensa.');
 try{
  const parsed=JSON.parse(raw);
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error();
  return parsed;
 }catch{throw bad(503,'Resposta OAuth do Pipeboard inválida.');}
}
async function authMetadata(provider,request){
 const root=servers[provider];
 if(!root)throw bad(422,'Plataforma não suportada.');
 const rootUrl=new URL(root),resource=rootUrl.origin+'/';
 let issuer=rootUrl.origin;
 try{
  const prm=await readProviderJSON(rootUrl.origin+'/.well-known/oauth-protected-resource',{request});
  const servers=prm.authorization_servers;
  if(Array.isArray(servers)&&servers.length){
   issuer=pipeboardUrl(servers[0],'metadata');
  }
 }catch(e){if(e?.status!==503)throw e;}
 const endpoint=new URL(issuer);
 const metadataPath='/.well-known/oauth-authorization-server'+(endpoint.pathname==='/'?'':endpoint.pathname.replace(/\/$/,''));
 let metadata=await readProviderJSON(endpoint.origin+metadataPath,{request});
 if(typeof metadata.issuer!=='string'||pipeboardUrl(metadata.issuer,'metadata')!==pipeboardUrl(issuer,'metadata'))
  throw bad(503,'O emissor OAuth não corresponde ao provedor.');
 for(const key of ['authorization_endpoint','token_endpoint']){
  if(typeof metadata[key]!=='string')throw bad(503,'Metadados OAuth incompletos.');
  metadata[key]=pipeboardUrl(metadata[key]);
 }
 if(metadata.registration_endpoint)metadata.registration_endpoint=pipeboardUrl(metadata.registration_endpoint);
 if(!metadata.registration_endpoint&&metadata.client_id_metadata_document_supported!==true)
  throw bad(503,'Pipeboard ainda não anunciou registro de aplicativo OAuth para este cliente.');
 return {metadata,resource};
}
export function oauthSupported(provider){return Object.hasOwn(servers,provider);}
export async function probePipeboardOAuth(provider,{request=fetch}={}){
 if(!oauthSupported(provider))return {supported:false,discovered:false,method:null};
 try{
  const {metadata}=await authMetadata(provider,request);
  return {supported:true,discovered:true,
   method:metadata.registration_endpoint?'DCR':'CIMD'};
 }catch(error){
  return {supported:true,discovered:false,method:null,errorStatus:Number(error?.status||503)};
 }
}

export function marketingOAuthStatus(){return {meta:'ready',google:'ready',
 connectionPortal:'https://pipeboard.co/connections'};}
export async function startPipeboardOAuth(pool,identity,provider,{env=process.env,request=fetch}={}){
 if(!oauthSupported(provider))throw bad(422,'Plataforma inválida.');
 const redirectUri=site(env)+'/api/marketing/oauth/callback';
 const {metadata,resource}=await authMetadata(provider,request);
 const verifier=randomBytes(48).toString('base64url');
 const state=randomBytes(32).toString('hex');
 let client_id,client_secret,token_endpoint_auth_method='none';
 if(metadata.registration_endpoint){
  const registration=await readProviderJSON(metadata.registration_endpoint,{
   request,method:'POST',headers:{'Content-Type':'application/json'},
   body:{client_name:'Sócio Consecom',redirect_uris:[redirectUri],
    grant_types:['authorization_code','refresh_token'],response_types:['code'],
    token_endpoint_auth_method:'none'}});
  client_id=registration.client_id;
  client_secret=registration.client_secret;
  token_endpoint_auth_method=registration.token_endpoint_auth_method||'none';
 }else{
  client_id=site(env)+'/.well-known/oauth-client';
 }
 if(typeof client_id!=='string'||client_id.length>1000||
    !['none','client_secret_post','client_secret_basic'].includes(token_endpoint_auth_method))
  throw bad(503,'Registro OAuth do Pipeboard inválido.');
 if(token_endpoint_auth_method!=='none'&&typeof client_secret!=='string')
  throw bad(503,'O Pipeboard não retornou o segredo do cliente OAuth.');
 const data=secretSeal({verifier,client_id,client_secret:client_secret||null,
  token_endpoint:metadata.token_endpoint,token_endpoint_auth_method,resource,redirectUri},env);
 await pool.query(
  "INSERT INTO marketing_oauth_attempts(state_hash,tenant_id,user_id,provider,data_ciphertext,expires_at) "+
  "VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
  [sha(state),identity.active_tenant_id,identity.user_id,provider,data]);
 const endpoint=new URL(metadata.authorization_endpoint);
 endpoint.searchParams.set('response_type','code');
 endpoint.searchParams.set('client_id',client_id);
 endpoint.searchParams.set('redirect_uri',redirectUri);
 endpoint.searchParams.set('state',state);
 endpoint.searchParams.set('code_challenge',challenge(verifier));
 endpoint.searchParams.set('code_challenge_method','S256');
 endpoint.searchParams.set('resource',resource);
 return {authorizationUrl:endpoint.toString(),provider};
}
export async function finishPipeboardOAuth(pool,state,code,{env=process.env,request=fetch}={}){
 if(!/^[0-9a-f]{64}$/.test(String(state||''))||typeof code!=='string'||code.length<8||code.length>4096)
  throw bad(400,'Autorização inválida.');
 const used=await pool.query(
  "UPDATE marketing_oauth_attempts SET consumed_at=now() "+
  "WHERE state_hash=$1 AND expires_at>now() AND consumed_at IS NULL "+
  "RETURNING tenant_id,user_id,provider,data_ciphertext",
  [sha(state)]);
 if(!used.rowCount)throw bad(403,'Autorização expirada ou já utilizada.');
 const row=used.rows[0];
 const admin=await pool.query(
  "SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2 AND active=true AND role IN ('owner','admin')",
  [row.user_id,row.tenant_id]);
 if(!admin.rowCount)throw bad(403,'Usuário não possui mais acesso à empresa.');
 const config=secretOpen(row.data_ciphertext,env);
 pipeboardUrl(config.token_endpoint);
 const form=new URLSearchParams({
  grant_type:'authorization_code',code,client_id:config.client_id,
  redirect_uri:config.redirectUri,code_verifier:config.verifier,resource:config.resource});
 const headers={'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'};
 if(config.token_endpoint_auth_method==='client_secret_post')form.set('client_secret',config.client_secret);
 else if(config.token_endpoint_auth_method==='client_secret_basic'){
  headers.Authorization='Basic '+Buffer.from(config.client_id+':'+config.client_secret).toString('base64');
 }
 let response;
 try{
  response=await request(config.token_endpoint,{method:'POST',headers,
   body:form,redirect:'manual',signal:AbortSignal.timeout(12000)});
 }catch{throw bad(503,'Não foi possível concluir o login Pipeboard.');}
 if(!response.ok)throw bad(503,'O Pipeboard recusou a autorização.');
 const text=await response.text();
 if(text.length>32000)throw bad(503,'Retorno de autorização inválido.');
 let token;
 try{token=JSON.parse(text);}catch{throw bad(503,'Retorno de autorização inválido.');}
 if(typeof token.access_token!=='string'||token.access_token.length<16||
    token.access_token.length>18000||typeof token.token_type!=='string'||
    token.token_type.toLowerCase()!=='bearer')
  throw bad(503,'O Pipeboard não confirmou credenciais OAuth válidas.');
 const expires=Number(token.expires_in);
 const expiration=Number.isFinite(expires)&&expires>0&&expires<31536000?
  new Date(Date.now()+expires*1000):null;
 const opaque=secretSeal({
  access_token:token.access_token,
  refresh_token:typeof token.refresh_token==='string'?token.refresh_token:null,
  client_id:config.client_id,client_secret:config.client_secret,
  token_endpoint:config.token_endpoint,auth_method:config.token_endpoint_auth_method,
  resource:config.resource
 },env);
 await pool.query(
  "INSERT INTO marketing_oauth_grants(tenant_id,user_id,provider,token_ciphertext,expires_at,status) "+
  "VALUES($1,$2,$3,$4,$5,'authorized') "+
  "ON CONFLICT(tenant_id,provider) DO UPDATE SET user_id=EXCLUDED.user_id, "+
  "token_ciphertext=EXCLUDED.token_ciphertext,expires_at=EXCLUDED.expires_at, "+
  "status='authorized',updated_at=now()",
  [row.tenant_id,row.user_id,row.provider,opaque,expiration]);
 return {provider:row.provider,tenantId:row.tenant_id,userId:row.user_id,status:'authorized'};
}
export async function listPipeboardOAuth(pool,identity){
 const r=await pool.query(
  "SELECT provider,status,expires_at,updated_at FROM marketing_oauth_grants WHERE tenant_id=$1 "+
  "AND status<>'disconnected' ORDER BY provider",[identity.active_tenant_id]);
 return r.rows;
}
export async function revokePipeboardOAuth(pool,identity,provider){
 if(!oauthSupported(provider))throw bad(422,'Plataforma inválida.');
 const r=await pool.query(
  "UPDATE marketing_oauth_grants SET status='disconnected',token_ciphertext=NULL,expires_at=NULL, "+
  "updated_at=now() WHERE tenant_id=$1 AND provider=$2 AND status<>'disconnected' RETURNING provider",
  [identity.active_tenant_id,provider]);
 if(!r.rowCount)throw bad(404,'Autorização não encontrada.');
 return {ok:true,provider,disconnected:true};
}
export function oauthClientMetadata(env=process.env){
 const url=site(env);
 return {client_name:'Sócio Consecom',client_uri:url,redirect_uris:[url+'/api/marketing/oauth/callback'],
  grant_types:['authorization_code','refresh_token'],response_types:['code'],
  token_endpoint_auth_method:'none'};
}

// Only these account-listing operations may be used by the connection diagnostic.
// Tool discovery never grants permission to execute an arbitrary advertised tool.
const accountTools={
 meta:['mcp_meta_ads_get_ad_accounts','get_ad_accounts'],
 google:['mcp_google_ads_list_customers','list_customers','mcp_google_ads_list_accessible_customers','list_accessible_customers','mcp_google_ads_get_accounts','get_accounts','mcp_google_ads_list_accounts','list_accounts']
};
export function decodeMcpReply(raw,id){
 if(typeof raw!=='string'||raw.length>4000000)throw bad(503,'Resposta do provedor fora do limite.');
 const lines=raw.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim());
 for(const line of lines.length?lines:[raw]){
  try{const parsed=JSON.parse(line);if(parsed.id===id){
   if(parsed.error||parsed.result?.isError)throw bad(503,'O provedor recusou a leitura. Confira as contas autorizadas no Pipeboard.');
   if(parsed.result)return parsed.result;
  }}catch(error){if(error.status)throw error;}
 }
 throw bad(503,'O provedor não confirmou a leitura.');
}
export function normalizeAdsAccounts(result,provider){
 let payload=result.structuredContent;
 if(!payload){
  for(const block of result.content||[])if(block.type==='text'){
   try{payload=JSON.parse(block.text);break;}catch{}
  }
 }
 if(!payload||payload.error||payload.success===false)throw bad(503,'O provedor não retornou uma lista válida de contas.');
 const list=Array.isArray(payload)?payload:payload.accounts||payload.data?.accounts||payload.data||payload.customers||payload.resourceNames;
 if(!Array.isArray(list))throw bad(503,'Formato de contas não reconhecido. A autorização permanece salva.');
 const accounts=[];
 for(const row of list.slice(0,200)){
  const id=String(typeof row==='string'?row:row.id||row.account_id||row.customer_id||row.customerId||row.resourceName||'').replace(/^customers\//,'');
  if(!(provider==='meta'?/^act_\d{4,20}$/:/^\d{10}$/).test(id))continue;
  const name=typeof row==='object'?String(row.name||row.descriptive_name||row.descriptiveName||id).slice(0,160):id;
  accounts.push({id,name});
 }
 if(list.length&&!accounts.length)throw bad(503,'O provedor retornou contas sem identificação reconhecida.');
 return [...new Map(accounts.map(x=>[x.id,x])).values()];
}
export async function testPipeboardConnection(pool,identity,provider,{env=process.env,request=fetch}={}){
 if(!oauthSupported(provider))throw bad(422,'Plataforma inválida.');
 const r=await pool.query("SELECT token_ciphertext,expires_at FROM marketing_oauth_grants WHERE tenant_id=$1 AND provider=$2 AND status='authorized'",[identity.active_tenant_id,provider]);
 if(!r.rowCount)throw bad(409,'Conecte esta plataforma antes de testar.');
 const grant=r.rows[0];
 if(grant.expires_at&&new Date(grant.expires_at).getTime()<=Date.now())throw bad(409,'A autorização expirou. Clique em Reconectar para renovar o acesso.');
 const token=secretOpen(grant.token_ciphertext,env);
 let session=null,counter=0;
 async function rpc(method,params,notification=false){
  const id=++counter;
  let response;
  try{response=await request(servers[provider],{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',
    ...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-03-26'}:{})},
   body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,...(params?{params}:{})})});
  }catch{throw bad(503,'O provedor não respondeu. Tente novamente.');}
  if(response.status===401||response.status===403)throw bad(409,'A autorização não permite esta leitura. Reconecte e confira as contas liberadas no Pipeboard.');
  if(!response.ok)throw bad(503,'O provedor está indisponível para leitura.');
  const sid=response.headers?.get('mcp-session-id');if(sid)session=sid;
  if(notification)return;
  return decodeMcpReply(await response.text(),id);
 }
 await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'socio-connection-test',version:'1.0'}});
 await rpc('notifications/initialized',undefined,true);
 const discovery=await rpc('tools/list',{});
 const tool=(discovery.tools||[]).find(x=>accountTools[provider].includes(x.name));
 if(!tool)throw bad(503,'Consulta de contas disponível no provedor: '+(discovery.tools||[]).filter(x=>/account|customer/i.test(x.name)).map(x=>x.name).slice(0,12).join(', '));
 const args=provider==='meta'?{user_id:'me',limit:200}:{};
 const required=tool.inputSchema?.required||[];
 if(required.some(x=>!Object.hasOwn(args,x)))throw bad(503,'A consulta de contas exige uma configuração adicional no provedor.');
 const result=await rpc('tools/call',{name:tool.name,arguments:args});
 const accounts=normalizeAdsAccounts(result,provider);
 return {provider,status:accounts.length?'verified':'no_accounts',accounts,checkedAt:new Date().toISOString(),
  message:accounts.length?'Conexão testada: '+accounts.length+' conta(s) com acesso de leitura.':'Login válido, mas nenhuma conta de anúncios foi disponibilizada pelo provedor.'};
}
