// Official Google Ads OAuth and safe account discovery. No campaign write methods.
import {createHash,randomBytes} from 'node:crypto';
import {sealMarketingSecret,openMarketingSecret,marketingSecretKey} from './marketing-integrations.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const sha=x=>createHash('sha256').update(x).digest('hex');
const validId=x=>/^\d{10}$/.test(String(x||''));
function access(a,perm='marketing.read'){
 requirePermission(a,perm);assertApiFeature(a.features,'/api/marketing/official');
 if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}
export function googleAdsConfig(env=process.env){
 let origin=null;
 try{const u=new URL(env.SOCIO_PUBLIC_URL);
  if(u.protocol==='https:'&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password)origin=u.origin;
 }catch{}
 const credentials=Boolean(
  /^[0-9a-z-]+\.apps\.googleusercontent\.com$/.test(env.SOCIO_GOOGLE_OAUTH_CLIENT_ID||'')&&
  typeof env.SOCIO_GOOGLE_OAUTH_CLIENT_SECRET==='string'&&env.SOCIO_GOOGLE_OAUTH_CLIENT_SECRET.length>=12&&
  typeof env.SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN==='string'&&env.SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN.length>=10);
 let encryption=false;try{marketingSecretKey(env);encryption=true;}catch{}
 const ready=env.SOCIO_GOOGLE_ADS_ENABLED==='true'&&credentials&&encryption&&Boolean(origin);
 return {ready,credentials,encryption,callback:origin?origin+'/api/google-ads/oauth/callback':null,
  blockers:[...(env.SOCIO_GOOGLE_ADS_ENABLED!=='true'?['Ativação Google Ads pendente.']:[]),
  ...(!credentials?['Credenciais OAuth e developer token ausentes.']:[]),
  ...(!encryption?['Proteção dos tokens não configurada.']:[]),
  ...(!origin?['URL HTTPS pública não configurada.']:[])],
  mode:'oauth_read_only'};
}
async function requestJson(url,{method='GET',body,headers={},request=fetch}={}){
 let response;try{response=await request(url,{method,headers,...(body?{body:new URLSearchParams(body)}:{}),
  redirect:'error',signal:AbortSignal.timeout(12000)});
 }catch{throw fail(503,'Google Ads indisponível.');}
 let data;try{data=await response.json()}catch{throw fail(503,'Resposta Google Ads inválida.');}
 if(!response.ok||data.error)throw fail(503,'Google recusou a consulta. Verifique OAuth e developer token.');
 return data;
}
function configured(env){const c=googleAdsConfig(env);if(!c.ready)throw fail(503,'Google Ads não configurado.');return c;}
export async function startGoogleAdsOAuth(pool,a,{env=process.env}={}){
 access(a,'marketing.manage');const c=configured(env);
 if(!/^[a-f0-9]{64}$/.test(String(a.token_hash||'')))throw fail(403,'Sessão sem autenticação válida.');
 const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
 const encrypted=sealMarketingSecret('google-ads-pkce:'+a.active_tenant_id+':'+verifier,env);
 await pool.query("INSERT INTO socio_google_ads_states(state_hash,tenant_id,user_id,session_hash,verifier_ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
  [sha(state),a.active_tenant_id,a.user_id,a.token_hash,encrypted]);
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({
  client_id:env.SOCIO_GOOGLE_OAUTH_CLIENT_ID,redirect_uri:c.callback,
  response_type:'code',scope:'https://www.googleapis.com/auth/adwords',
  access_type:'offline',prompt:'consent',state,
  code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))
  u.searchParams.set(k,v);
 return {authorizationUrl:u.toString(),service:'google_ads',readOnly:true};
}
export async function finishGoogleAdsOAuth(pool,state,code,{env=process.env,request=fetch}={}){
 const c=configured(env);
 if(!/^[0-9a-f]{64}$/.test(state||'')||typeof code!=='string'||code.length<8||code.length>4096)
  throw fail(400,'Autorização inválida.');
 const sql=[
  'DELETE FROM socio_google_ads_states st USING sessions ss,users u,tenants t',
  'WHERE st.state_hash=$1 AND st.expires_at>now()',
  'AND ss.token_hash=st.session_hash AND ss.user_id=st.user_id AND ss.active_tenant_id=st.tenant_id AND ss.expires_at>now()',
  'AND u.id=st.user_id AND u.active=true AND (u.tenant_id=st.tenant_id OR u.platform_owner=true)',
  "AND u.role IN ('owner','admin') AND t.id=st.tenant_id AND t.status<>'paused'",
  "AND COALESCE((t.features->>'meta_ads')::boolean,true)=true",
  'RETURNING st.tenant_id,st.user_id,st.verifier_ciphertext'
 ].join(' ');
 const row=(await pool.query(sql,[sha(state)])).rows?.[0];
 if(!row)throw fail(403,'Autorização expirada ou sessão sem permissão.');
 const clear=openMarketingSecret(row.verifier_ciphertext,env),prefix='google-ads-pkce:'+row.tenant_id+':';
 if(!clear.startsWith(prefix))throw fail(403,'Autorização pertence a outra empresa.');
 const token=await requestJson('https://oauth2.googleapis.com/token',{
  method:'POST',request,headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:{grant_type:'authorization_code',code,redirect_uri:c.callback,
   code_verifier:clear.slice(prefix.length),client_id:env.SOCIO_GOOGLE_OAUTH_CLIENT_ID,
   client_secret:env.SOCIO_GOOGLE_OAUTH_CLIENT_SECRET}});
 if(typeof token.refresh_token!=='string'||token.refresh_token.length<35)
  throw fail(503,'O Google não autorizou renovação. Tente conectar e consentir novamente.');
 const ciphertext=sealMarketingSecret(JSON.stringify({tenant:row.tenant_id,uid:row.user_id,refresh:token.refresh_token}),env);
 await pool.query("INSERT INTO socio_google_ads_grants(tenant_id,user_id,token_ciphertext) VALUES($1,$2,$3) "+
  "ON CONFLICT(tenant_id) DO UPDATE SET user_id=$2,token_ciphertext=$3,selected_customer_id=NULL,checked_at=NULL,checked_account_count=NULL,connected_at=now(),updated_at=now()",
  [row.tenant_id,row.user_id,ciphertext]);
 return {connected:true,readOnly:true};
}
export async function googleAdsStatus(pool,a,{env=process.env}={}){
 access(a);
 const c=googleAdsConfig(env);
 const rows=(await pool.query('SELECT selected_customer_id,connected_at,checked_at,checked_account_count FROM socio_google_ads_grants WHERE tenant_id=$1',[a.active_tenant_id])).rows||[];
 return {configured:c.ready,blockers:c.blockers,connected:!!rows[0],
  selectedCustomerId:rows[0]?.selected_customer_id||null,
  checkedAccountCount:rows[0]?.checked_account_count??null,checkedAt:rows[0]?.checked_at||null,
  readOnly:true,canCreateCampaigns:false,
  note:'Conectar Google Ads permite consultar contas; ainda não cria campanhas e não executa despesas.'};
}
async function readToken(pool,a,{env=process.env,request=fetch}={}){
 access(a);configured(env);
 const row=(await pool.query('SELECT token_ciphertext,selected_customer_id FROM socio_google_ads_grants WHERE tenant_id=$1',[a.active_tenant_id])).rows?.[0];
 if(!row)throw fail(409,'Conecte sua conta Google Ads.');
 let token;try{token=JSON.parse(openMarketingSecret(row.token_ciphertext,env))}catch{throw fail(503,'Credencial Google inválida. Reconecte.');}
 if(token.tenant!==a.active_tenant_id)throw fail(403,'Token de outra empresa.');
 const result=await requestJson('https://oauth2.googleapis.com/token',{method:'POST',request,
  headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:{grant_type:'refresh_token',refresh_token:token.refresh,
   client_id:env.SOCIO_GOOGLE_OAUTH_CLIENT_ID,client_secret:env.SOCIO_GOOGLE_OAUTH_CLIENT_SECRET}});
 if(typeof result.access_token!=='string'||result.access_token.length<20)
  throw fail(503,'O Google não renovou o acesso.');
 return {token:result.access_token,grant:row};
}
export async function listGoogleAdsAccounts(pool,a,{env=process.env,request=fetch}={}){
 const {token,grant}=await readToken(pool,a,{env,request});
 const data=await requestJson('https://googleads.googleapis.com/v26/customers:listAccessibleCustomers',{
  request,headers:{Authorization:'Bearer '+token,'developer-token':env.SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN}});
 if(!Array.isArray(data.resourceNames)||data.resourceNames.length>500)
  throw fail(503,'Google retornou lista de contas inválida.');
 const ids=data.resourceNames.map(v=>/^customers\/\d{10}$/.test(String(v))?v.slice(10):null);
 if(ids.some(v=>!v)||new Set(ids).size!==ids.length)throw fail(503,'Contas Google inconsistentes.');
 await pool.query('UPDATE socio_google_ads_grants SET checked_at=now(),checked_account_count=$2 WHERE tenant_id=$1',
  [a.active_tenant_id,ids.length]);
 return {accounts:ids.map(id=>({id})),selectedCustomerId:grant.selected_customer_id||null,readOnly:true,
  note:'A consulta mostra contas diretamente acessíveis; clientes de MCC podem exigir enumeração adicional autorizada.'};
}
export async function selectGoogleAdsAccount(pool,a,accountId,{env=process.env,request=fetch}={}){
 access(a,'marketing.manage');
 if(!validId(accountId))throw fail(422,'ID Google Ads inválido.');
 const list=await listGoogleAdsAccounts(pool,a,{env,request});
 if(!list.accounts.some(x=>x.id===accountId))throw fail(403,'Conta não confirmada nas permissões Google.');
 const r=await pool.query('UPDATE socio_google_ads_grants SET selected_customer_id=$2,updated_at=now() WHERE tenant_id=$1 RETURNING selected_customer_id',
  [a.active_tenant_id,accountId]);
 if(!r.rowCount)throw fail(409,'Integração alterada durante a seleção.');
 return {selectedCustomerId:accountId,readOnly:true};
}
export async function disconnectGoogleAds(pool,a){
 access(a,'marketing.manage');
 await pool.query('DELETE FROM socio_google_ads_grants WHERE tenant_id=$1',[a.active_tenant_id]);
 return {disconnected:true};
}
