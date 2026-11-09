// Optional one-off, explicitly scoped pilot for a previously authorized upload.
// Deliberately disabled without ALL exact identifiers. Never creates an ad,
// assigns a WhatsApp owner, initiates messages or activates campaign spending.
// The job ID is committed in PostgreSQL BEFORE any external upload; never replay
// an uncertain result, even after a crash, redeploy or repeated startup.
import {brazilWhatsappDestination,findLastOutgoingVideo,importLastOutgoingVideo} from './socio-whatsapp-meta-video.mjs';
import {randomUUID} from 'node:crypto';

const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export function parseVideoPilotConfig(env=process.env,{now=Date.now()}={}){
 if(env.SOCIO_WA_VIDEO_PILOT_ONCE!=='true')return null;
 const id=env.SOCIO_WA_VIDEO_PILOT_ID,account=env.SOCIO_WA_VIDEO_PILOT_ACCOUNT;
 const cutoff=Date.parse(String(env.SOCIO_WA_VIDEO_PILOT_CUTOFF||''));
 let source,recipient;
 try{
  source=brazilWhatsappDestination(env.SOCIO_WA_VIDEO_PILOT_SOURCE);
  recipient=brazilWhatsappDestination(env.SOCIO_WA_VIDEO_PILOT_DESTINATION);
 }catch{return null;}
 // A stale flag after 72h cannot start importing some later WhatsApp video.
 if(!uuid(id)||!/^act_\d{4,30}$/.test(String(account))||source===recipient||
  !Number.isFinite(cutoff)||cutoff>now+60000||cutoff<now-72*3600000)return null;
 return {id,account,source,recipient,cutoff};
}
export async function runVideoPilotOnce(pool,{
 env=process.env,now=Date.now(),find=findLastOutgoingVideo,
 importVideo=importLastOutgoingVideo
}={}){
 const config=parseVideoPilotConfig(env,{now});
 if(!config)return {processed:false,reason:'PILOT_DISABLED_OR_EXPIRED'};
 // Unique source number and user grant; cannot assign arbitrary contact an
 // admin role, borrow another tenant's OAuth or switch Meta accounts.
 const found=await pool.query(
  "SELECT t.id AS tenant_id,t.status AS tenant_status,t.features,t.name AS tenant_name,"+
  "u.id AS user_id,u.role,u.platform_owner,ch.id AS channel_id,sel.account_id "+
  "FROM meta_official_account_selections sel "+
  "JOIN users u ON u.id=sel.user_id AND u.tenant_id=sel.tenant_id "+
  "AND u.active=true AND u.role IN ('owner','admin') "+
  "JOIN tenants t ON t.id=sel.tenant_id AND t.status<>'paused' "+
  "JOIN meta_official_grants g ON g.tenant_id=sel.tenant_id AND g.user_id=sel.user_id "+
  "AND g.expires_at>now() AND 'ads_management'=ANY(g.scopes) "+
  "JOIN channels ch ON ch.tenant_id=sel.tenant_id AND ch.provider='waakg' "+
  "AND ch.status='connected' AND regexp_replace(ch.phone,'[^0-9]','','g')=$1 "+
  "JOIN waakg_links l ON l.tenant_id=ch.tenant_id AND l.channel_id=ch.id "+
  "WHERE sel.account_id=$2 LIMIT 2",
  [config.source,config.account]
 );
 if(found.rows.length!==1)
  return {processed:false,reason:found.rows.length?'PILOT_AMBIGUOUS_OWNER':'PILOT_NO_EXACT_OWNER_GRANT'};
 const r=found.rows[0];
 const actor={active_tenant_id:r.tenant_id,user_id:r.user_id,role:r.role,
  platform_owner:r.platform_owner,tenant_status:r.tenant_status,
  features:r.features,tenant_name:r.tenant_name};
 const claim=await pool.query(
  "INSERT INTO socio_whatsapp_meta_video_pilot_jobs "+
  "(id,tenant_id,channel_id,user_id,account_id,status) "+
  "VALUES($1,$2,$3,$4,$5,'started') ON CONFLICT(id) DO NOTHING RETURNING id",
  [config.id,r.tenant_id,r.channel_id,r.user_id,r.account_id]);
 if(!claim.rowCount)return {processed:false,reason:'PILOT_ALREADY_ATTEMPTED'};
 const writeAudit=async(status,videoId=null)=>pool.query(
  "INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,$4,$5)",
  [randomUUID(),r.tenant_id,r.user_id,'marketing.official.video.pilot',
   JSON.stringify({operationId:config.id,accountId:config.account,status,videoId})]
 ).catch(()=>{});
 const finish=async(status,videoId=null,reasonCode=null)=>pool.query(
  "UPDATE socio_whatsapp_meta_video_pilot_jobs "+
  "SET status=$2,meta_video_id=$3,reason_code=$4,updated_at=now() WHERE id=$1 AND tenant_id=$5",
  [config.id,status,videoId,reasonCode,r.tenant_id]);
 try{
  const input={channelId:r.channel_id,recipientPhone:config.recipient};
  // Exact cutoff is fixed when the user requested this one video; a later
  // video in the same WhatsApp conversation cannot silently replace it.
  const latest=await find(pool,actor,input,{env,now:config.cutoff});
  if(!latest?.video){
   await finish('not_found',null,'NO_MATCHING_OUTBOUND_VIDEO');
   await writeAudit('not_found');
   return {processed:true,reason:'PILOT_VIDEO_NOT_FOUND'};
  }
  const output=await importVideo(pool,actor,{
   ...input,messageId:latest.video.messageId,confirmed:true
  },{env,now:config.cutoff});
  const status=output.status==='uploaded'?'uploaded':output.status==='uncertain'?'uncertain':'failed';
  await finish(status,output.videoId||null,status==='uploaded'?null:'IMPORT_NOT_CONFIRMED');
  await writeAudit(status,output.videoId||null);
  return {processed:true,reason:status==='uploaded'?'PILOT_UPLOADED':'PILOT_NOT_CONFIRMED',
   videoId:output.videoId||null,accountId:output.accountId||null,status};
 }catch(error){
  // A Meta POST may have completed before timing out. Mark uncertain and
  // require manual account-library inspection instead of doing it again.
  await finish(error?.uncertain?'uncertain':'failed',null,
   error?.uncertain?'META_UNCONFIRMED':'PILOT_ERROR').catch(()=>{});
  await writeAudit(error?.uncertain?'uncertain':'failed');
  return {processed:true,reason:error?.uncertain?'PILOT_UNCERTAIN':'PILOT_FAILED',
   status:error?.uncertain?'uncertain':'failed',
   errorCode:String(error?.status||'UNEXPECTED').slice(0,16)};
 }
}
