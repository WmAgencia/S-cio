// Direct Meta Marketing API. This module deliberately exposes no campaign mutations.
import {randomBytes,createHash,createHmac} from 'node:crypto';
import {sealMarketingSecret,openMarketingSecret,marketingSecretKey} from './marketing-integrations.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=v=>createHash('sha256').update(v).digest('hex');
function access(a,permission='marketing.read'){
 requirePermission(a,permission);assertApiFeature(a.features,'/api/marketing/official');
 if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}
export function officialConfig(env=process.env){
 const origin=new URL(env.SOCIO_PUBLIC_URL||'https://invalid.invalid');
 const appId=env.SOCIO_META_APP_ID||'2827016234367972';
 const version=env.SOCIO_META_GRAPH_VERSION;
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.hostname==='invalid.invalid'||!/^\d+$/.test(appId)||!/^v\d+\.0$/.test(version||'')||!env.SOCIO_META_APP_SECRET)
  throw fail(503,'Login oficial Meta ainda não configurado na hospedagem.');
 marketingSecretKey(env);
 return {origin:origin.origin,appId,version,secret:env.SOCIO_META_APP_SECRET,callback:origin.origin+'/api/marketing/official/callback'};
}
export async function officialGraph(path,token,{env=process.env,request=fetch,params={}}={}){
 const c=officialConfig(env);
 if(!/^\/(me|act_\d+)(\/(adaccounts|campaigns|insights|permissions))?$/.test(path))throw fail(422,'Consulta Meta inválida.');
 const url=new URL('https://graph.facebook.com/'+c.version+path);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
 url.searchParams.set('appsecret_proof',createHmac('sha256',c.secret).update(token).digest('hex'));
 let response,data;
 try{response=await request(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(12000)});data=await response.json();}
 catch{throw fail(503,'Meta indisponível. Tente novamente.');}
 if(!response.ok||data.error)throw fail(data.error?.code===190?401:503,'A Meta não autorizou a consulta. Reconecte sua conta e confira as permissões.');
 // Never forward provider paging URLs (which can embed access tokens).
 return data;
}
export async function startOfficial(pool,a,{env=process.env}={}){
 access(a,'marketing.manage');const c=officialConfig(env),state=randomBytes(32).toString('hex');
 await pool.query('DELETE FROM meta_official_states WHERE expires_at<now()');
 await pool.query("INSERT INTO meta_official_states(state_hash,tenant_id,user_id,session_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",[hash(state),a.active_tenant_id,a.user_id,a.token_hash]);
 const url=new URL('https://www.facebook.com/'+c.version+'/dialog/oauth');
 for(const [k,v] of Object.entries({client_id:c.appId,redirect_uri:c.callback,state,response_type:'code',scope:'ads_read,ads_management,business_management'}))url.searchParams.set(k,v);
 return {authorizationUrl:url.href};
}
export async function finishOfficial(pool,state,code,{env=process.env,request=fetch}={}){
 const c=officialConfig(env);
 if(!/^[a-f0-9]{64}$/.test(state||'')||typeof code!=='string'||!code||code.length>4096)throw fail(400,'Autorização inválida.');
 // Consume state atomically, and recheck the original session/role/tenant at callback.
 const result=await pool.query(`DELETE FROM meta_official_states o USING sessions s,users u,tenants t
 WHERE o.state_hash=$1 AND o.expires_at>now() AND s.token_hash=o.session_hash AND s.user_id=o.user_id
 AND s.active_tenant_id=o.tenant_id AND s.expires_at>now() AND u.id=o.user_id AND u.active=true
 AND (u.platform_owner=true OR u.tenant_id=o.tenant_id) AND t.id=o.tenant_id
 RETURNING o.tenant_id,o.user_id,u.role,u.platform_owner,t.features,t.status AS tenant_status`,[hash(state)]);
 const row=result.rows[0];if(!row)throw fail(400,'Autorização expirada. Conecte novamente.');
 access({...row,active_tenant_id:row.tenant_id},'marketing.manage');
 const exchange=async params=>{
  const response=await request('https://graph.facebook.com/'+c.version+'/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:c.appId,client_secret:c.secret}),redirect:'error',signal:AbortSignal.timeout(12000)});
  const data=await response.json();if(!response.ok||!data.access_token||data.error)throw fail(503,'A Meta não concluiu a autorização.');return data;
 };
 let token;
 try{const short=await exchange({redirect_uri:c.callback,code});token=await exchange({grant_type:'fb_exchange_token',fb_exchange_token:short.access_token});}
 catch{throw fail(503,'A Meta não concluiu a autorização. Tente conectar novamente.');}
 const me=await officialGraph('/me',token.access_token,{env,request,params:{fields:'id,name'}});
 const permissions=await officialGraph('/me/permissions',token.access_token,{env,request});
 const scopes=(permissions.data||[]).filter(x=>x.status==='granted').map(x=>x.permission);
 if(!/^\d+$/.test(me.id)||!scopes.includes('ads_read'))throw fail(403,'Acesso de leitura aos anúncios não autorizado.');
 const expires=Number(token.expires_in);
 if(!Number.isFinite(expires)||expires<=0)throw fail(503,'A Meta não informou a validade da autorização.');
 // Ciphertext binds both owner and tenant; moving it to another row is rejected on reads.
 const encrypted=sealMarketingSecret(JSON.stringify({tenant:row.tenant_id,user:row.user_id,token:token.access_token}),env);
 await pool.query(`INSERT INTO meta_official_grants(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at)
 VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second') ON CONFLICT(tenant_id,user_id)
 DO UPDATE SET meta_user_id=EXCLUDED.meta_user_id,token_encrypted=EXCLUDED.token_encrypted,scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,updated_at=now()`,[row.tenant_id,row.user_id,me.id,encrypted,scopes,expires]);
 return {ok:true};
}
export async function officialStatus(pool,a,{env=process.env}={}){
 access(a);let configured=true;try{officialConfig(env);}catch{configured=false;}
 const r=await pool.query('SELECT meta_user_id,scopes,expires_at FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2',[a.active_tenant_id,a.user_id]);
 const grant=r.rows[0];return {configured,appId:env.SOCIO_META_APP_ID||'2827016234367972',connected:configured&&Boolean(grant&&new Date(grant.expires_at)>new Date()),grant:grant||null,writesEnabled:false};
}
export async function officialAccounts(pool,a,{env=process.env,request=fetch}={}){
 access(a);const r=await pool.query('SELECT token_encrypted FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2 AND expires_at>now()',[a.active_tenant_id,a.user_id]);
 if(!r.rows[0])throw fail(401,'Conecte sua conta Meta.');
 const clear=JSON.parse(openMarketingSecret(r.rows[0].token_encrypted,env));
 if(clear.tenant!==a.active_tenant_id||clear.user!==a.user_id)throw fail(403,'Autorização de outra empresa.');
 const data=await officialGraph('/me/adaccounts',clear.token,{env,request,params:{fields:'id,name,account_status,currency,timezone_name',limit:100}});
 return {accounts:(data.data||[]).map(x=>({id:x.id,name:x.name,status:x.account_status,currency:x.currency,timezone:x.timezone_name})),hasMore:Boolean(data.paging?.next)};
}
export async function disconnectOfficial(pool,a){
 access(a,'marketing.manage');
 await pool.query('DELETE FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2',[a.active_tenant_id,a.user_id]);
 await pool.query('DELETE FROM meta_official_states WHERE tenant_id=$1 AND user_id=$2',[a.active_tenant_id,a.user_id]);
 return {ok:true};
}
