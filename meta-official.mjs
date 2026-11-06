// Direct Meta Marketing API. This module deliberately exposes no campaign mutations.
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
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
 const version=env.SOCIO_META_GRAPH_VERSION||env.META_GRAPH_VERSION;
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
 if(!response.ok||data.error)throw fail(data.error?.code===190?409:503,'A Meta não autorizou a consulta. Reconecte sua conta e confira as permissões.');
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
 RETURNING o.tenant_id,o.user_id,o.created_at,u.role,u.platform_owner,t.features,t.status AS tenant_status`,[hash(state)]);
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
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const userHash=hash(c.appId+':'+me.id),actorHash=hash('actor:'+row.tenant_id+':'+row.user_id);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actorHash]);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userHash]);
 const revoked=await client.query('SELECT revoked_at FROM meta_official_revocations WHERE meta_user_hash=ANY($1) ORDER BY revoked_at DESC LIMIT 1',[[userHash,actorHash]]);
 if(revoked.rows[0]&&new Date(revoked.rows[0].revoked_at)>=new Date(row.created_at))throw fail(403,'Esta autorização foi revogada. Conecte novamente.');
 await client.query(`INSERT INTO meta_official_grants(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at)
 VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second') ON CONFLICT(tenant_id,user_id)
 DO UPDATE SET meta_user_id=EXCLUDED.meta_user_id,token_encrypted=EXCLUDED.token_encrypted,scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,updated_at=now()`,[row.tenant_id,row.user_id,me.id,encrypted,scopes,expires]);
 await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 return {ok:true};
}
export async function officialStatus(pool,a,{env=process.env}={}){
 access(a);let configured=true;try{officialConfig(env);}catch{configured=false;}
 const r=await pool.query('SELECT meta_user_id,scopes,expires_at FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2',[a.active_tenant_id,a.user_id]);
 const selected=await pool.query('SELECT account_id,account_name,currency,updated_at FROM meta_official_account_selections WHERE tenant_id=$1',[a.active_tenant_id]);
 const grant=r.rows[0];return {configured,appId:env.SOCIO_META_APP_ID||'2827016234367972',connected:configured&&Boolean(grant&&new Date(grant.expires_at)>new Date()),grant:grant||null,selectedAccount:selected.rows[0]||null,writesEnabled:true};
}
export async function officialAccounts(pool,a,{env=process.env,request=fetch}={}){
 access(a);const r=await pool.query('SELECT token_encrypted FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2 AND expires_at>now()',[a.active_tenant_id,a.user_id]);
 if(!r.rows[0])throw fail(409,'Conecte sua conta Meta.');
 const clear=JSON.parse(openMarketingSecret(r.rows[0].token_encrypted,env));
 if(clear.tenant!==a.active_tenant_id||clear.user!==a.user_id)throw fail(403,'Autorização de outra empresa.');
 const data=await officialGraph('/me/adaccounts',clear.token,{env,request,params:{fields:'id,name,account_status,currency,timezone_name',limit:100}});
 return {accounts:(data.data||[]).map(x=>({id:x.id,name:x.name,status:x.account_status,currency:x.currency,timezone:x.timezone_name})),hasMore:Boolean(data.paging?.next)};
}
export async function disconnectOfficial(pool,a){
 access(a,'marketing.manage');
 const client=await pool.connect(),actorHash=hash('actor:'+a.active_tenant_id+':'+a.user_id);
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actorHash]);
  await client.query('INSERT INTO meta_official_revocations(meta_user_hash,revoked_at) VALUES($1,now()) ON CONFLICT(meta_user_hash) DO UPDATE SET revoked_at=now()',[actorHash]);
  await client.query('DELETE FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2',[a.active_tenant_id,a.user_id]);
  await client.query('DELETE FROM meta_official_states WHERE tenant_id=$1 AND user_id=$2',[a.active_tenant_id,a.user_id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 return {ok:true};
}

// Meta signs server callbacks. Neither cookies nor a user-supplied user ID authorizes erasure.
export function verifyMetaSignedRequest(value,{env=process.env,now=Date.now()}={}){
 const secret=env.SOCIO_META_APP_SECRET;
 if(!secret)throw fail(503,'Callback Meta não configurado.');
 if(typeof value!=='string'||value.length>16000)throw fail(400,'Solicitação inválida.');
 const parts=value.split('.');
 if(parts.length!==2||parts.some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))throw fail(400,'Solicitação inválida.');
 const expected=createHmac('sha256',secret).update(parts[1]).digest(),signature=Buffer.from(parts[0],'base64url');
 if(signature.length!==expected.length||!timingSafeEqual(signature,expected))throw fail(403,'Assinatura inválida.');
 let data;try{data=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw fail(400,'Solicitação inválida.');}
 if(data.algorithm!=='HMAC-SHA256'||!/^\d+$/.test(String(data.user_id||''))||!Number.isInteger(data.issued_at)||data.issued_at>now/1000+300||data.issued_at<now/1000-86400)
  throw fail(400,'Solicitação inválida ou expirada.');
 return data;
}
export async function handleMetaRemoval(pool,signedRequest,{env=process.env}={}){
 const data=verifyMetaSignedRequest(signedRequest,{env});
 const c=officialConfig(env),userHash=hash(c.appId+':'+data.user_id);
 const code=createHmac('sha256',c.secret).update('deletion:'+signedRequest).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userHash]);
  await client.query('INSERT INTO meta_official_revocations(meta_user_hash,revoked_at) VALUES($1,now()) ON CONFLICT(meta_user_hash) DO UPDATE SET revoked_at=now()',[userHash]);
  await client.query('DELETE FROM meta_ads_plans p USING meta_official_grants g WHERE p.tenant_id=g.tenant_id AND p.user_id=g.user_id AND g.meta_user_id=$1',[String(data.user_id)]);
  await client.query('DELETE FROM meta_official_grants WHERE meta_user_id=$1',[String(data.user_id)]);
  await client.query('INSERT INTO meta_official_deletions(confirmation_code) VALUES($1) ON CONFLICT DO NOTHING',[code]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 return {url:c.origin+'/meta-exclusao-status?code='+code,confirmation_code:code};
}
export async function metaRemovalStatus(pool,code){
 if(!/^[a-f0-9]{64}$/.test(code||''))throw fail(404,'Solicitação não encontrada.');
 const r=await pool.query('SELECT completed_at FROM meta_official_deletions WHERE confirmation_code=$1',[code]);
 if(!r.rows[0])throw fail(404,'Solicitação não encontrada.');
 return {status:'completed',completedAt:r.rows[0].completed_at,scope:'Credenciais da integração Meta Ads removidas do banco ativo. Nenhum anúncio ou dado na Meta foi excluído.'};
}

export async function selectOfficialAccount(pool,a,accountId,options={}){
 access(a,'marketing.manage');
 if(typeof accountId!=='string'||!/^act_\d{4,20}$/.test(accountId))throw fail(422,'Selecione uma conta de anúncios válida.');
 // Validate against the current actor's live grant, never against client-supplied labels.
 const {accounts}=await officialAccounts(pool,a,options);
 const account=accounts.find(x=>x.id===accountId);
 if(!account)throw fail(403,'Esta conta não está disponível na sua autorização Meta. Atualize as contas e tente novamente.');
 await pool.query(`INSERT INTO meta_official_account_selections(tenant_id,user_id,account_id,account_name,currency)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET user_id=EXCLUDED.user_id,
 account_id=EXCLUDED.account_id,account_name=EXCLUDED.account_name,currency=EXCLUDED.currency,updated_at=now()`,
 [a.active_tenant_id,a.user_id,account.id,account.name||account.id,account.currency||null]);
 return {selectedAccount:{account_id:account.id,account_name:account.name||account.id,currency:account.currency||null}};
}
// Future campaign executors must resolve the saved destination and recheck live access.
export async function resolveSelectedOfficialAccount(pool,a,options={}){
 access(a);
 const r=await pool.query('SELECT account_id FROM meta_official_account_selections WHERE tenant_id=$1',[a.active_tenant_id]);
 if(!r.rows[0])throw fail(409,'Escolha a conta de anúncios desta empresa antes de continuar.');
 const {accounts}=await officialAccounts(pool,a,options);
 const account=accounts.find(x=>x.id===r.rows[0].account_id);
 if(!account)throw fail(403,'Sua autorização não permite acessar a conta selecionada. Conecte a conta correta.');
 return account;
}
