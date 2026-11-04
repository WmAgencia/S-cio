// Instagram hosted account linking: Ayrshare Business Profile SSO.
// Official provider handles Instagram login; Sócio never accepts Instagram
// passwords, cookies, 2FA codes or nonofficial private API sessions.
import {sealMarketingSecret,openMarketingSecret} from './marketing-integrations.mjs';
const bad=(status,message)=>Object.assign(new Error(message),{status});
const base='https://api.ayrshare.com/api';
export function instagramHostedReady(env=process.env){
 return Boolean(typeof env.AYRSHARE_API_KEY==='string'&&env.AYRSHARE_API_KEY.length>=18&&
  typeof env.AYRSHARE_SSO_DOMAIN==='string'&&env.AYRSHARE_SSO_DOMAIN.length>=3&&
  typeof env.AYRSHARE_PRIVATE_KEY==='string'&&env.AYRSHARE_PRIVATE_KEY.includes('PRIVATE KEY'));
}
async function ayrshare(path,method,env,request,body,profileKey){
 if(!instagramHostedReady(env))throw bad(503,'Conexão oficial Instagram depende da integração Ayrshare Business da agência.');
 const headers={Authorization:'Bearer '+env.AYRSHARE_API_KEY,Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(profileKey)headers['Profile-Key']=profileKey;
 let response;
 try{response=await request(base+path,{method,headers,
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  redirect:'manual',signal:AbortSignal.timeout(12000)});
 }catch{throw bad(503,'O serviço de autorização Instagram não respondeu.');}
 if(!response.ok)throw bad(503,'O parceiro de autenticação Instagram recusou a operação.');
 const raw=await response.text();
 if(raw.length>100000)throw bad(503,'Resposta do provedor Instagram fora do limite.');
 let parsed;
 try{parsed=JSON.parse(raw);}catch{throw bad(503,'Resposta inválida do provedor Instagram.');}
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')
  throw bad(503,'Resposta inválida do provedor Instagram.');
 return parsed;
}
const sealProfile=(profileKey,env)=>sealMarketingSecret('socio:ayrshare-profile:'+profileKey,env);
const unsealProfile=(sealed,env)=>{
 const raw=openMarketingSecret(sealed,env);
 if(!raw.startsWith('socio:ayrshare-profile:'))throw bad(503,'Perfil Instagram não pôde ser recuperado.');
 return raw.slice('socio:ayrshare-profile:'.length);
};
export async function beginInstagramHosted(pool,identity,tenantName,{env=process.env,request=fetch}={}){
 if(!instagramHostedReady(env))throw bad(503,'O provedor de autorização Instagram ainda não foi configurado pela agência.');
 const redirect=String(env.SOCIO_PUBLIC_URL||'').replace(/\/$/,'');
 if(!/^https:\/\/[a-z\d.-]+$/i.test(redirect))throw bad(503,'URL pública da agência não configurada.');
 const client=await pool.connect();
 let ref,key;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['socio-instagram:'+identity.active_tenant_id]);
  const prev=await client.query(
   "SELECT profile_ref,profile_key_ciphertext FROM instagram_hosted_profiles WHERE tenant_id=$1",
   [identity.active_tenant_id]);
  if(prev.rowCount){
   ref=prev.rows[0].profile_ref;key=unsealProfile(prev.rows[0].profile_key_ciphertext,env);
  }else{
   const created=await ayrshare('/profiles','POST',env,request,{
    title:'Sócio '+identity.active_tenant_id,
    messagingActive:false,
    disableSocial:['bluesky','facebook','gmb','linkedin','pinterest','reddit','snapchat','telegram','threads','tiktok','twitter','youtube']
   });
   if(created.status!=='success'||typeof created.refId!=='string'||created.refId.length<10||
      typeof created.profileKey!=='string'||created.profileKey.length<18)
    throw bad(503,'O parceiro não criou um perfil Instagram válido.');
   ref=created.refId;key=created.profileKey;
   await client.query(
    "INSERT INTO instagram_hosted_profiles(tenant_id,profile_ref,profile_key_ciphertext,status,created_by) "+
    "VALUES($1,$2,$3,'pending',$4)",
    [identity.active_tenant_id,ref,sealProfile(key,env),identity.user_id]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 const link=await ayrshare('/profiles/generateJWT','POST',env,request,{
  domain:env.AYRSHARE_SSO_DOMAIN,
  privateKey:env.AYRSHARE_PRIVATE_KEY.replace(/\\n/g,'\n'),
  profileKey:key,
  logout:true,allowedSocial:['instagram'],redirect:redirect+'/?instagram=return'
 });
 if(link.status!=='success'||typeof link.url!=='string')
  throw bad(503,'O parceiro não retornou a página de conexão Instagram.');
 const target=new URL(link.url);
 if(target.protocol!=='https:'||target.hostname!=='profile.ayrshare.com')
  throw bad(503,'O endereço de autorização Instagram não é confiável.');
 return {authorizationUrl:target.toString(),provider:'ayrshare',status:'pending'};
}
export async function instagramHostedStatus(pool,identity,{env=process.env,request=fetch}={}){
 const row=await pool.query(
  "SELECT profile_ref,status,updated_at FROM instagram_hosted_profiles WHERE tenant_id=$1",
  [identity.active_tenant_id]);
 if(!row.rowCount)return {configured:instagramHostedReady(env),linked:false,status:'not_connected'};
 if(!instagramHostedReady(env))return {configured:false,linked:false,status:'provider_unavailable'};
 const profile=row.rows[0];
 const list=await ayrshare('/profiles?refId='+encodeURIComponent(profile.profile_ref),'GET',env,request);
 const matched=Array.isArray(list.profiles)&&list.profiles.find(p=>p.refId===profile.profile_ref);
 const linked=matched?.status==='active'&&Array.isArray(matched.activeSocialAccounts)&&
  matched.activeSocialAccounts.includes('instagram');
 await pool.query(
  "UPDATE instagram_hosted_profiles SET status=$2,updated_at=now() WHERE tenant_id=$1",
  [identity.active_tenant_id,linked?'linked':'pending']);
 return {configured:true,linked:!!linked,status:linked?'linked':'pending'};
}
export async function disconnectInstagramHosted(pool,identity,{env=process.env,request=fetch}={}){
 const row=await pool.query(
  "SELECT profile_key_ciphertext FROM instagram_hosted_profiles WHERE tenant_id=$1",
  [identity.active_tenant_id]);
 if(!row.rowCount)throw bad(404,'Conta Instagram não encontrada.');
 const key=unsealProfile(row.rows[0].profile_key_ciphertext,env);
 await ayrshare('/profiles/social','DELETE',env,request,{platform:'instagram'},key);
 await pool.query(
  "UPDATE instagram_hosted_profiles SET status='pending',updated_at=now() WHERE tenant_id=$1",
  [identity.active_tenant_id]);
 return {ok:true,linked:false};
}
