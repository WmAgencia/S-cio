// Sends a confirmed sale back to Meta as Purchase, attributed through the click id
// the customer arrived with. Only sales with a WhatsApp ad attribution become
// events, and only after the owner confirms the receipt. Default-off and
// idempotent per sale.
import {officialConfig} from './meta-official.mjs';
import {tenantMetaGrant} from './whatsapp-ctwa.mjs';
import {isEnabled,classify,eventMessage,datasetMessage,provisionDataset,sendEvent,
 readDataset,DATASET_OK_SQL,DATASET_FAIL_SQL,grantCanSendEvents} from './whatsapp-ctwa-events.mjs';

const EVENT_WINDOW_MS=7*86400000;
const RETRY_MS=15*60000;
const MAX_ATTEMPTS=5;

const PENDING_SALES_SQL=[
 'SELECT s.id,s.tenant_id,s.amount_cents,s.confirmed_at,a.waba_id,a.ctwa_clid,a.source_type',
 'FROM socio_sales s JOIN wa_ctwa_attributions a',
 'ON a.tenant_id=s.tenant_id AND a.id=s.ctwa_attribution_id',
 "WHERE s.status='confirmed' AND s.capi_sent_at IS NULL AND s.amount_cents>0",
 "AND s.confirmed_at>now()-interval '7 days'",
 "AND a.source_type='ad' AND a.ctwa_clid IS NOT NULL AND a.waba_id<>''",
 "AND a.occurred_at>=s.confirmed_at-interval '7 days' AND a.occurred_at<=s.confirmed_at",
 "AND (s.capi_last_attempt_at IS NULL OR s.capi_last_attempt_at<now()-interval '15 minutes')",
 'AND (s.capi_attempts<5 OR s.capi_last_attempt_at IS NULL',
 " OR s.capi_last_attempt_at<now()-interval '24 hours')",
 'ORDER BY s.confirmed_at LIMIT $1'
].join(' ');

// A sale outside the 7-day click window cannot be attributed by Meta, so it never
// becomes an event. It is still revenue in the panel; only delivery optimisation
// loses it. The reason is returned so the owner can see why a sale has no event.
export function saleEventSkipReason(row,{now=Date.now()}={}){
 if(!row)return 'no_row';
 if(row.source_type!=='ad')return 'not_from_ad';
 if(!String(row.waba_id||'').trim())return 'no_waba';
 if(!String(row.ctwa_clid||'').trim())return 'no_click_id';
 const cents=Number(row.amount_cents);
 if(!Number.isFinite(cents)||cents<=0)return 'no_amount';
 const when=row.confirmed_at instanceof Date?row.confirmed_at:new Date(row.confirmed_at);
 const ms=when.getTime();
 if(!Number.isFinite(ms))return 'no_date';
 if(ms>now+300000)return 'future_date';
 if(now-ms>EVENT_WINDOW_MS)return 'outside_window';
 return null;
}

export function buildSalePurchaseEvent(row,{now=Date.now()}={}){
 if(saleEventSkipReason(row,{now}))return null;
 const id=String(row.id||'').trim();
 const wabaId=String(row.waba_id||'').trim();
 const ctwaClid=String(row.ctwa_clid||'').trim();
 const cents=Number(row.amount_cents);
 if(!id||wabaId.length>64||ctwaClid.length>512)return null;
 const when=row.confirmed_at instanceof Date?row.confirmed_at:new Date(row.confirmed_at);
 const ms=when.getTime();
 return {
  event_name:'Purchase',
  event_time:Math.floor(ms/1000),
  action_source:'business_messaging',
  messaging_channel:'whatsapp',
  event_id:'sale_'+id.replace(/-/g,''),
  user_data:{whatsapp_business_account_id:wabaId,ctwa_clid:ctwaClid},
  custom_data:{value:Math.round(cents)/100,currency:'BRL',order_id:id}
 };
}

// Sends at most `limit` confirmed sales. A tenant without a grant is skipped
// without consuming an attempt, so a sale confirmed before the owner connects is
// still sent once the grant exists. Dataset errors block that WABA only.
export async function sendPendingSaleEvents(pool,{limit=20,request=fetch,env=process.env,now=Date.now()}={}){
 if(!isEnabled(env))return {enabled:false,configured:true,checked:0,sent:0,failed:0,skipped:0,blocked:0};
 let config;
 try{config=officialConfig(env);}
 catch{return {enabled:true,configured:false,checked:0,sent:0,failed:0,skipped:0,blocked:0};}
 const pending=await pool.query(PENDING_SALES_SQL,[Math.max(1,Math.min(Number(limit)||20,100))]);
 const grants=new Map(),datasets=new Map(),blockedWabas=new Map(),missingScopes=new Set();
 let sent=0,failed=0,skipped=0,blocked=0;
 for(const row of pending.rows){
  const event=buildSalePurchaseEvent(row,{now});
  if(!event){skipped++;continue;}
  if(!grants.has(row.tenant_id)){
   let grant=null;
   try{grant=await tenantMetaGrant(pool,row.tenant_id,env);}catch{grant=null;}
   grants.set(row.tenant_id,grant);
  }
  const grant=grants.get(row.tenant_id);
  if(!grant){skipped++;continue;}
  // A grant without the WhatsApp event scopes cannot send; report it once per
  // tenant instead of writing an error on every row.
  if(!grantCanSendEvents(grant)){missingScopes.add(row.tenant_id);skipped++;continue;}
  const wabaId=String(row.waba_id);
  const key=row.tenant_id+':'+wabaId;
  const wabaError=blockedWabas.get(key);
  if(wabaError){
   try{
    await pool.query(
     'UPDATE socio_sales SET capi_last_attempt_at=now(),capi_error=$3 WHERE id=$1 AND tenant_id=$2',
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
    'UPDATE socio_sales SET capi_sent_at=now(),capi_last_attempt_at=now(),'+
    'capi_event_id=$3,capi_error=NULL WHERE id=$1 AND tenant_id=$2',
    [row.id,row.tenant_id,event.event_id]);
   sent++;
  }catch(error){
   const kind=classify(error);
   const message=eventMessage(error,'Purchase');
   try{
    if(kind==='transient'){
     await pool.query(
      `UPDATE socio_sales SET capi_attempts=LEAST(capi_attempts+1,5),
       capi_last_attempt_at=now(),capi_error=$3 WHERE id=$1 AND tenant_id=$2`,
      [row.id,row.tenant_id,message]);
    }else{
     await pool.query(
      'UPDATE socio_sales SET capi_last_attempt_at=now(),capi_error=$3 WHERE id=$1 AND tenant_id=$2',
      [row.id,row.tenant_id,message]);
    }
   }catch{}
   if(kind==='auth'||kind==='permission'||kind==='config'){
    blockedWabas.set(key,message);
    blocked++;
   }else failed++;
  }
 }
 return {enabled:true,configured:true,checked:pending.rowCount,sent,failed,skipped,blocked,
  missingEventScopes:[...missingScopes],
  reason:missingScopes.size?'META_EVENT_SCOPES_MISSING':null};
}
