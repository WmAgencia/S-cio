// Sends a confirmed click-to-WhatsApp arrival back to Meta as LeadSubmitted.
// Meta can then optimize delivery for real conversations, not only clicks.
// Default-off, idempotent per arrival, and it never invents a sale.
import {createHmac} from 'node:crypto';
import {officialConfig} from './meta-official.mjs';
import {tenantMetaGrant} from './whatsapp-ctwa.mjs';

const EVENT_WINDOW_MS=7*86400000;
const RETRY_MS=15*60000;
const MAX_ATTEMPTS=5;
const PERMISSION_HINT='A conexão Meta não tem a permissão de eventos do WhatsApp Business. É preciso autorizar whatsapp_business_management e whatsapp_business_manage_events.';

export const isEnabled=env=>env.SOCIO_META_CTWA_CAPI_ENABLED==='true';

function graphUrl(config,path){
 return new URL('https://graph.facebook.com/'+config.version+'/'+path);
}

function proof(config,token){
 return createHmac('sha256',config.secret).update(token).digest('hex');
}

export function classify(error){
 if(error?.config)return 'config';
 const sub=Number(error?.metaSubcode||0);
 if(sub===2804132||sub===2804066)return 'config';
 const code=Number(error?.metaCode||0);
 if(code===190||code===102)return 'auth';
 if(code===10||code===200||code===272)return 'permission';
 if(code===100||code===803||code===80004)return 'config';
 const status=Number(error?.httpStatus||0);
 if(status===429)return 'transient';
 if(status>=400&&status<500)return 'config';
 return 'transient';
}

export function datasetMessage(error){
 const kind=classify(error);
 if(kind==='auth')return 'A autorização Meta expirou. Reconecte a conta Meta.';
 if(kind==='permission')return PERMISSION_HINT;
 if(Number(error?.metaSubcode||0)===2804132)
  return 'A Meta ainda não ligou o conjunto de conversões a esta conta do WhatsApp. É preciso concluir essa ligação com o suporte da Meta.';
 if(Number(error?.metaSubcode||0)===2804066)
  return 'A Meta recusou o tipo de evento LeadSubmitted nesta versão da API.';
 return String(error?.message||'A Meta não preparou o conjunto de conversões.').slice(0,180);
}

export function eventMessage(error,name='LeadSubmitted'){
 const kind=classify(error);
 if(kind==='auth')return 'A autorização Meta expirou. Reconecte a conta Meta.';
 if(kind==='permission')return PERMISSION_HINT;
 if(Number(error?.metaSubcode||0)===2804132)
  return 'A Meta ainda não ligou o conjunto de conversões a esta conta do WhatsApp.';
 if(Number(error?.metaSubcode||0)===2804066)
  return 'A Meta recusou o tipo de evento '+name+' nesta versão da API.';
 return String(error?.message||'A Meta não confirmou o recebimento do evento.').slice(0,180);
}

function graphError(data,status){
 const error=new Error(String(data?.error?.message||'A Meta recusou a requisição.').slice(0,180));
 error.metaCode=Number(data?.error?.code||0);
 error.metaSubcode=Number(data?.error?.error_subcode||0);
 error.httpStatus=Number(status)||0;
 return error;
}

async function readGraph(response){
 try{return await response.json();}catch{return null;}
}

export function buildCtwaConversionEvent(row,{now=Date.now()}={}){
 if(!row||row.source_type!=='ad')return null;
 const id=String(row.id||'').trim();
 const wabaId=String(row.waba_id||'').trim();
 const ctwaClid=String(row.ctwa_clid||'').trim();
 if(!id||!wabaId||wabaId.length>64||!ctwaClid||ctwaClid.length>512)return null;
 const when=row.occurred_at instanceof Date?row.occurred_at:new Date(row.occurred_at);
 const ms=when.getTime();
 if(!Number.isFinite(ms)||ms>now+300000||now-ms>EVENT_WINDOW_MS)return null;
 return {
  event_name:'LeadSubmitted',
  event_time:Math.floor(ms/1000),
  action_source:'business_messaging',
  messaging_channel:'whatsapp',
  event_id:'ctwa_'+id.replace(/-/g,''),
  user_data:{whatsapp_business_account_id:wabaId,ctwa_clid:ctwaClid}
 };
}

export async function provisionDataset({config,token,wabaId,request}){
 const url=graphUrl(config,encodeURIComponent(wabaId)+'/dataset');
 url.searchParams.set('appsecret_proof',proof(config,token));
 let response,data;
 try{
  response=await request(url,{method:'POST',headers:{Authorization:'Bearer '+token},
   redirect:'error',signal:AbortSignal.timeout(12000)});
  data=await readGraph(response);
 }catch{
  const error=new Error('A Meta não respondeu ao preparar o conjunto de conversões.');
  error.transient=true;
  throw error;
 }
 if(!response.ok||data?.error)throw graphError(data,response.status);
 const datasetId=String(data?.dataset_id||data?.id||'').trim();
 if(!/^[A-Za-z0-9_-]{4,64}$/.test(datasetId))
  throw Object.assign(new Error('A Meta não informou o conjunto de conversões.'),{config:true});
 return datasetId;
}

export async function sendEvent({config,token,datasetId,event,request}){
 const url=graphUrl(config,encodeURIComponent(datasetId)+'/events');
 url.searchParams.set('appsecret_proof',proof(config,token));
 let response,data;
 try{
  response=await request(url,{method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({data:[event]}),redirect:'error',signal:AbortSignal.timeout(12000)});
  data=await readGraph(response);
 }catch{
  const error=new Error('A Meta não confirmou o recebimento do evento.');
  error.transient=true;
  throw error;
 }
 if(!response.ok||data?.error)throw graphError(data,response.status);
 if(Number(data?.events_received)!==1){
  const detail=Array.isArray(data?.messages)?
   data.messages.map(x=>x?.message).filter(Boolean).join(' '):'';
  throw Object.assign(new Error(
   String(detail||'A Meta não confirmou o recebimento do evento.').slice(0,180)),{config:true});
 }
}

export async function readDataset(pool,tenantId,wabaId){
 const result=await pool.query(
  'SELECT dataset_id,attempts,last_attempt_at,error FROM meta_waba_datasets WHERE tenant_id=$1 AND waba_id=$2',
  [tenantId,wabaId]);
 return result.rows[0]||null;
}

export const DATASET_OK_SQL=`INSERT INTO meta_waba_datasets(tenant_id,waba_id,dataset_id,attempts,last_attempt_at,error,updated_at)
 VALUES($1,$2,$3,0,now(),NULL,now())
 ON CONFLICT(tenant_id,waba_id) DO UPDATE SET dataset_id=EXCLUDED.dataset_id,
 last_attempt_at=now(),error=NULL,updated_at=now()`;

export const DATASET_FAIL_SQL=`INSERT INTO meta_waba_datasets(tenant_id,waba_id,dataset_id,attempts,last_attempt_at,error,updated_at)
 VALUES($1,$2,NULL,$3,now(),$4,now())
 ON CONFLICT(tenant_id,waba_id) DO UPDATE SET
 attempts=$3,last_attempt_at=now(),error=EXCLUDED.error,updated_at=now()`;

const PENDING_EVENTS_SQL=[
 "SELECT id,tenant_id,waba_id,ctwa_clid,occurred_at,source_type,capi_attempts,capi_last_attempt_at",
 "FROM wa_ctwa_attributions",
 "WHERE source_type='ad' AND ctwa_clid IS NOT NULL AND waba_id<>''",
 "AND capi_sent_at IS NULL AND occurred_at>now()-interval '7 days'",
 "AND (capi_last_attempt_at IS NULL OR capi_last_attempt_at<now()-interval '15 minutes')",
 "AND (capi_attempts<5 OR capi_last_attempt_at IS NULL",
 " OR capi_last_attempt_at<now()-interval '24 hours')",
 "ORDER BY occurred_at LIMIT $1"
].join(' ');

// Sends at most `limit` confirmed arrivals. A tenant without a grant is skipped
// without consuming an attempt, so a click that arrives before the owner connects
// is still sent once the grant exists. Dataset errors block that WABA, not the
// other tenants, and never count against an individual arrival.
export async function sendPendingCtwaEvents(pool,{limit=20,request=fetch,env=process.env,now=Date.now()}={}){
 if(!isEnabled(env))return {enabled:false,configured:true,checked:0,sent:0,failed:0,skipped:0,blocked:0};
 let config;
 try{config=officialConfig(env);}
 catch{return {enabled:true,configured:false,checked:0,sent:0,failed:0,skipped:0,blocked:0};}
 const pending=await pool.query(PENDING_EVENTS_SQL,[Math.max(1,Math.min(Number(limit)||20,100))]);
 const grants=new Map(),datasets=new Map(),blockedWabas=new Map();
 let sent=0,failed=0,skipped=0,blocked=0;
 for(const row of pending.rows){
  const event=buildCtwaConversionEvent(row,{now});
  if(!event){skipped++;continue;}
  if(!grants.has(row.tenant_id)){
   let grant=null;
   try{grant=await tenantMetaGrant(pool,row.tenant_id,env);}catch{grant=null;}
   grants.set(row.tenant_id,grant);
  }
  const grant=grants.get(row.tenant_id);
  if(!grant){skipped++;continue;}
  const wabaId=String(row.waba_id);
  const key=row.tenant_id+':'+wabaId;
  const wabaError=blockedWabas.get(key);
  if(wabaError){
   try{
    await pool.query(
     'UPDATE wa_ctwa_attributions SET capi_last_attempt_at=now(),capi_error=$3 WHERE id=$1 AND tenant_id=$2',
     [row.id,row.tenant_id,wabaError]);
   }catch{}
   blocked++;
   continue;
  }
  if(!datasets.has(key)){
   let cached=null;
   try{cached=await readDataset(pool,row.tenant_id,wabaId);}catch{cached=null;}
   datasets.set(key,{datasetId:cached?.dataset_id||null,
    attempts:Number(cached?.attempts||0),
    lastAttemptAt:cached?.last_attempt_at?new Date(cached.last_attempt_at).getTime():0});
  }
  const state=datasets.get(key);
  if(!state.datasetId){
   if(state.attempts>=MAX_ATTEMPTS&&now-state.lastAttemptAt<24*3600000){blocked++;continue;}
   if(state.lastAttemptAt&&now-state.lastAttemptAt<RETRY_MS){blocked++;continue;}
   try{
    state.datasetId=await provisionDataset({config,token:grant.token,wabaId,request});
    await pool.query(DATASET_OK_SQL,[row.tenant_id,wabaId,state.datasetId]);
    state.attempts=0;
   }catch(error){
    const kind=classify(error);
    const countAttempt=kind==='transient';
    const nextAttempts=countAttempt?Math.min(state.attempts+1,MAX_ATTEMPTS):0;
    state.attempts=nextAttempts;
    state.lastAttemptAt=now;
    try{
     await pool.query(DATASET_FAIL_SQL,
      [row.tenant_id,wabaId,nextAttempts,datasetMessage(error)]);
    }catch{}
    blocked++;
    continue;
   }
  }
  try{
   await sendEvent({config,token:grant.token,datasetId:state.datasetId,event,request});
   await pool.query(
    'UPDATE wa_ctwa_attributions SET capi_sent_at=now(),capi_last_attempt_at=now(),capi_error=NULL WHERE id=$1 AND tenant_id=$2',
    [row.id,row.tenant_id]);
   sent++;
  }catch(error){
   const kind=classify(error);
   const message=eventMessage(error);
   try{
    if(kind==='transient'){
     await pool.query(
      `UPDATE wa_ctwa_attributions SET capi_attempts=LEAST(capi_attempts+1,5),
       capi_last_attempt_at=now(),capi_error=$3 WHERE id=$1 AND tenant_id=$2`,
      [row.id,row.tenant_id,message]);
    }else{
     await pool.query(
      'UPDATE wa_ctwa_attributions SET capi_last_attempt_at=now(),capi_error=$3 WHERE id=$1 AND tenant_id=$2',
      [row.id,row.tenant_id,message]);
    }
   }catch{}
   if(kind==='auth'||kind==='permission'||kind==='config'){
    blockedWabas.set(key,message);
    blocked++;
   }else failed++;
  }
 }
 return {enabled:true,configured:true,checked:pending.rowCount,sent,failed,skipped,blocked};
}
