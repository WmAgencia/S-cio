// Sócio OAuth 2.1 provider for ChatGPT's custom MCP connection.
// Dynamic client registration is restricted to ChatGPT's official callback URLs.
// Access and refresh credentials are hashed at rest, scoped to the authorized tenant.
import {randomUUID,randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {loginIdentifier,verifyPassword} from './lib.mjs';

const scopes=['ads_media:read','ads_media:write','offline_access'];
const safeState=/^[\x20-\x7e]{1,2048}$/;
const challengeRx=/^[A-Za-z0-9_-]{43}$/;
const verifierRx=/^[A-Za-z0-9._~-]{43,128}$/;
const error=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=prefix=>prefix+randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&
 timingSafeEqual(Buffer.from(a),Buffer.from(b));
const origin=env=>{
 const url=new URL(env.SOCIO_PUBLIC_URL||'');
 if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw error(503,'OAuth HTTPS origin unavailable');
 return url.origin;
};
export function resourceUrl(env=process.env){return origin(env)+'/mcp/ads-media';}
const metaUrl=env=>origin(env)+'/.well-known/oauth-protected-resource';
function send(res,status,payload,extra={}){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra});
 res.end(JSON.stringify(payload));
}
function html(res,status,markup){
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'none'; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'});
 res.end(markup);
}
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function callbackAllowed(uri){
 try{
  const url=new URL(uri);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname!=='chatgpt.com'||url.port)return false;
  return url.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[A-Za-z0-9_-]{8,120}$/.test(url.pathname);
 }catch{return false;}
}
async function readJson(req,max=12000){
 const chunks=[];let total=0;
 for await(const ch of req){total+=ch.length;if(total>max)throw error(413,'registration too large');chunks.push(ch);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error(400,'invalid JSON');}
}
async function readForm(req,max=10000){
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(String(req.headers['content-type']||'')))
  throw error(415,'form-urlencoded required');
 let total=0;const chunks=[];
 for await(const ch of req){total+=ch.length;if(total>max)throw error(413,'form too large');chunks.push(ch);}
 const values=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
 if([...values.keys()].length>25)throw error(400,'invalid form');
 return Object.fromEntries(values);
}
function requestFields(query,env){
 const v=Object.fromEntries(['client_id','redirect_uri','code_challenge','code_challenge_method','scope','state','resource','response_type'].map(k=>[k,String(query[k]??'')]));
 if(!v.client_id||v.client_id.length>200||!callbackAllowed(v.redirect_uri)||
  !challengeRx.test(v.code_challenge)||v.code_challenge_method!=='S256'||v.response_type!=='code'||
  !safeState.test(v.state)||v.resource!==resourceUrl(env))throw error(400,'Invalid OAuth authorization request');
 const requested=v.scope?v.scope.split(/\s+/):scopes;
 if(requested.length>3||!requested.length||requested.some(s=>!scopes.includes(s))||
  new Set(requested).size!==requested.length)throw error(400,'Invalid OAuth scopes');
 v.scope=requested.join(' ');
 return v;
}
async function registered(pool,client,redirect){
 const query=await pool.query('SELECT client_id,redirect_uris FROM ads_oauth_clients WHERE client_id=$1',[client]);
 const row=query.rows[0];
 const uris=Array.isArray(row?.redirect_uris)?row.redirect_uris:row?.redirect_uris?JSON.parse(row.redirect_uris):[];
 if(!row||!uris.includes(redirect)||!callbackAllowed(redirect))throw error(400,'Unregistered OAuth redirect');
 return row;
}
function requestSignature(v,time,nonce,env){
 const secret=env.CHANNEL_ENCRYPTION_KEY;
 if(typeof secret!=='string'||secret.length<32)throw error(503,'OAuth signing secret unavailable');
 return createHmac('sha256',secret).update(JSON.stringify([v.client_id,v.redirect_uri,v.code_challenge,v.code_challenge_method,
  v.scope,v.state,v.resource,v.response_type,String(time),String(nonce)])).digest('hex');
}
function userCanAuthorize(a){
 return !!a&&a.tenant_status!=='paused'&&(a.platform_owner===true||['owner','admin'].includes(a.role))&&
  a.features?.meta_ads!==false;
}
function returnToClient(redirect,fields){
 const url=new URL(redirect);
 for(const [k,v] of Object.entries(fields))url.searchParams.set(k,String(v));
 return url.toString();
}
function pageHtml(v,time,nonce,sig,knownAccount,env,wrong=false){
 const hidden={...v,time,nonce,sig};
 const fields=Object.entries(hidden).map(([k,val])=>'<input type="hidden" name="'+escape(k)+'" value="'+escape(val)+'">').join('');
 const name=knownAccount?'<strong>Conta Sócio autenticada</strong><p>A extensão terá acesso somente à biblioteca da empresa autorizada.</p>':
  '<label for="identity">E-mail ou celular do Sócio</label><input id="identity" name="identity" required autocomplete="username" maxlength="255">'+
  '<label for="password">Senha do Sócio</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128">';
 const warning=wrong?'<p role="alert" class="warn">Não foi possível autenticar ou autorizar esta conta.</p>':'';
 return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta name="robots" content="noindex,nofollow,noarchive"><title>Autorizar Sócio Media MCP</title><style>'+
  '*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f6f2f5;color:#382335;font:14px/1.55 system-ui,sans-serif;padding:20px}'+
  'main{width:min(470px,100%);background:#fff;border:1px solid #e9dde5;border-radius:18px;padding:32px;box-shadow:0 25px 60px #30203515}'+
  'h1{font:400 30px/1.2 Georgia,serif;letter-spacing:-.03em;color:#743d59;margin:0 0 12px}'+
  'p{font-size:13px;color:#716472}label{display:block;font-weight:700;margin:15px 0 6px}input{width:100%;padding:12px;border:1px solid #ded3dc;border-radius:9px}'+
  'button{margin-top:17px;width:100%;padding:14px;border-radius:9px;border:0;background:#783d5a;color:#fff;font-weight:750;cursor:pointer}'+
  'small{display:block;margin-top:16px;color:#837885}.warn{color:#a03c59;background:#fff2f6;padding:11px;border-radius:7px}'+
  '</style></head><body><main><h1>Conectar vídeos ao ChatGPT</h1>'+
  '<p>O ChatGPT poderá listar, importar e preparar vídeos de anúncios desta empresa. Esta integração <strong>não publica campanhas</strong> nem acessa senhas ou tokens da Meta.</p>'+
  warning+'<form method="POST" action="/oauth/authorize">'+fields+name+
  '<button type="submit" name="decision" value="approve">Autorizar conexão</button></form>'+
  '<small>Somente contas autorizadas do Sócio. Acesso revogável e tokens com expiração.</small></main></body></html>';
}
async function userByLogin(pool,identity,password){
 const id=loginIdentifier(identity);
 if(!id||typeof password!=='string'||password.length>128)return null;
 const result=await pool.query(id.type==='email'?
  "SELECT u.id AS user_id,u.tenant_id AS active_tenant_id,u.role,u.platform_owner,u.phone,t.status AS tenant_status,t.features,u.password_hash "+
  "FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=$1 AND u.active=true":
  "SELECT u.id AS user_id,u.tenant_id AS active_tenant_id,u.role,u.platform_owner,u.phone,t.status AS tenant_status,t.features,u.password_hash "+
  "FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.phone=$1 AND u.active=true",[id.value]);
 const a=result.rows[0];
 if(!a||!(await verifyPassword(password,a.password_hash)))return null;
 return a;
}
function respondRedirect(res,redirect){
 res.writeHead(303,{Location:redirect,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 res.end();
}
async function authorize(pool,req,res,ctx,env){
 const method=req.method;
 const values=method==='GET'?Object.fromEntries(new URL(req.url,'http://local').searchParams):await readForm(req);
 const v=requestFields(values,env);
 await registered(pool,v.client_id,v.redirect_uri);
 if(method==='GET'){
  const ts=Math.floor(Date.now()/1000),nonce=randomBytes(16).toString('hex');
  let logged=null;try{logged=await ctx.sessionFor(req);}catch{}
  return html(res,200,pageHtml(v,ts,nonce,requestSignature(v,ts,nonce,env),userCanAuthorize(logged),env));
 }
 const age=Math.floor(Date.now()/1000)-Number(values.time);
 const expected=requestSignature(v,values.time,values.nonce,env);
 if(!Number.isFinite(age)||age<0||age>600||!equal(expected,String(values.sig||''))||
  !/^[0-9a-f]{32}$/.test(values.nonce||''))throw error(403,'OAuth authorization request expired');
 const requestOrigin=String(req.headers.origin||'');
 if(requestOrigin&&requestOrigin!==origin(env)||req.headers['sec-fetch-site']==='cross-site')
  throw error(403,'OAuth request origin invalid');
 if(values.decision==='deny')return respondRedirect(res,returnToClient(v.redirect_uri,{error:'access_denied',state:v.state,iss:origin(env)}));
 if(values.decision!=='approve')throw error(400,'Unknown authorization decision');
 let a=await ctx.sessionFor(req);
 if(!userCanAuthorize(a)){
  const ip=String(req.socket?.remoteAddress||'unknown');
  if(!ctx.limiter(ctx.authAttempts,'oauth-login:'+ip,600000,12))throw error(429,'Too many login attempts');
  a=await userByLogin(pool,values.identity,values.password);
 }
 if(!userCanAuthorize(a))return html(res,401,pageHtml(v,values.time,values.nonce,values.sig,false,env,true));
 const code=token('socio_code_');
 await pool.query("INSERT INTO ads_oauth_codes(id,code_hash,client_id,redirect_uri,code_challenge,resource,scope,user_id,tenant_id,expires_at) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '5 minutes')",
  [randomUUID(),hash(code),v.client_id,v.redirect_uri,v.code_challenge,v.resource,v.scope,a.user_id,a.active_tenant_id]);
 return respondRedirect(res,returnToClient(v.redirect_uri,{code,state:v.state,iss:origin(env)}));
}
async function issue(pool,claim){
 const access=token('socio_oauth_'),refresh=token('socio_refresh_');
 await pool.query("INSERT INTO ads_oauth_tokens(id,access_hash,refresh_hash,client_id,user_id,tenant_id,resource,scope,access_expires_at,refresh_expires_at) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '1 hour',now()+interval '30 days')",
  [randomUUID(),hash(access),hash(refresh),claim.client_id,claim.user_id,claim.tenant_id,claim.resource,claim.scope]);
 return {access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:claim.scope};
}
async function tokenExchange(pool,req,res,env){
 const v=await readForm(req);
 if(typeof v.client_id!=='string'||!v.client_id||v.client_id.length>200||
  v.resource!==resourceUrl(env))return send(res,400,{error:'invalid_request'});
 if(v.grant_type==='authorization_code'){
  if(!/^socio_code_[A-Za-z0-9_-]{43}$/.test(v.code||'')||!callbackAllowed(v.redirect_uri)||
   !verifierRx.test(v.code_verifier||''))return send(res,400,{error:'invalid_grant'});
  await registered(pool,v.client_id,v.redirect_uri);
  const code=await pool.query("UPDATE ads_oauth_codes SET used_at=now() "+
   "WHERE code_hash=$1 AND client_id=$2 AND redirect_uri=$3 AND resource=$4 "+
   "AND used_at IS NULL AND expires_at>now() RETURNING client_id,user_id,tenant_id,scope,resource,code_challenge",
   [hash(v.code),v.client_id,v.redirect_uri,v.resource]);
  const row=code.rows[0];
  const calc=createHash('sha256').update(v.code_verifier).digest('base64url');
  if(!row||!equal(calc,row.code_challenge))return send(res,400,{error:'invalid_grant'});
  return send(res,200,await issue(pool,row));
 }
 if(v.grant_type==='refresh_token'){
  if(!/^socio_refresh_[A-Za-z0-9_-]{43}$/.test(v.refresh_token||''))
   return send(res,400,{error:'invalid_grant'});
  const rec=await pool.query("UPDATE ads_oauth_tokens SET revoked_at=now() "+
   "WHERE refresh_hash=$1 AND client_id=$2 AND resource=$3 AND revoked_at IS NULL AND refresh_expires_at>now() "+
   "RETURNING client_id,user_id,tenant_id,resource,scope",
   [hash(v.refresh_token),v.client_id,v.resource]);
  if(!rec.rows[0])return send(res,400,{error:'invalid_grant'});
  return send(res,200,await issue(pool,rec.rows[0]));
 }
 return send(res,400,{error:'unsupported_grant_type'});
}
async function register(pool,req,res){
 const input=await readJson(req);
 const redirects=input?.redirect_uris;
 if(!Array.isArray(redirects)||redirects.length<1||redirects.length>3||redirects.some(u=>!callbackAllowed(u))||
  input.token_endpoint_auth_method&&input.token_endpoint_auth_method!=='none')
  return send(res,400,{error:'invalid_client_metadata'});
 const clientId='socio_client_'+randomBytes(24).toString('base64url');
 await pool.query("INSERT INTO ads_oauth_clients(client_id,redirect_uris,client_name) VALUES($1,$2::jsonb,$3)",
  [clientId,JSON.stringify(redirects),String(input.client_name||'ChatGPT').slice(0,120)]);
 return send(res,201,{client_id:clientId,redirect_uris:redirects,client_name:'Sócio Meta Ads Media Bridge',
  token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],
  response_types:['code']});
}
export async function authenticateMediaOAuth(pool,raw,env=process.env){
 if(typeof raw!=='string'||!/^socio_oauth_[A-Za-z0-9_-]{43}$/.test(raw))return null;
 const result=await pool.query(
  "SELECT tok.scope,t.id AS active_tenant_id,u.id AS user_id,u.role,u.phone,u.platform_owner "+
  "FROM ads_oauth_tokens tok JOIN tenants t ON t.id=tok.tenant_id "+
  "JOIN users u ON u.id=tok.user_id AND (u.tenant_id=t.id OR u.platform_owner=true) "+
  "WHERE tok.access_hash=$1 AND tok.resource=$2 AND tok.revoked_at IS NULL AND tok.access_expires_at>now() "+
  "AND u.active=true AND t.status<>'paused' AND COALESCE((t.features->>'meta_ads')::boolean,true)=true",
  [hash(raw),resourceUrl(env)]);
 const actor=result.rows[0];
 if(!actor||!(actor.platform_owner===true||['owner','admin'].includes(actor.role)))return null;
 return {...actor,oauthScopes:actor.scope.split(' ')};
}
export async function handleMediaOAuth(pool,req,res,ctx,env=process.env){
 const url=new URL(req.url||'/','http://local'),pathname=url.pathname,method=req.method;
 if(method==='GET'&&(pathname==='/.well-known/oauth-protected-resource'||
  pathname==='/.well-known/oauth-protected-resource/mcp/ads-media')){
  return send(res,200,{resource:resourceUrl(env),authorization_servers:[origin(env)],
   scopes_supported:scopes});
 }
 if(method==='GET'&&pathname==='/.well-known/oauth-authorization-server'){
  const o=origin(env);
  return send(res,200,{issuer:o,authorization_endpoint:o+'/oauth/authorize',token_endpoint:o+'/oauth/token',
   registration_endpoint:o+'/oauth/register',response_types_supported:['code'],
   grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],
   code_challenge_methods_supported:['S256'],scopes_supported:scopes,
   authorization_response_iss_parameter_supported:true});
 }
 if(pathname==='/oauth/register'&&method==='POST')return register(pool,req,res);
 if(pathname==='/oauth/authorize'&&['GET','POST'].includes(method))return authorize(pool,req,res,ctx,env);
 if(pathname==='/oauth/token'&&method==='POST')return tokenExchange(pool,req,res,env);
 return send(res,405,{error:'method_not_allowed'});
}
export function mediaAuthChallenge(env=process.env){
 return 'Bearer resource_metadata="'+metaUrl(env)+'", scope="ads_media:read ads_media:write"';
}
