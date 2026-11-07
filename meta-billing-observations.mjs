import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';
import {readAdsTool} from './meta-ads-tools.mjs';
import {assessMetaFunds} from './meta-billing-state.mjs';

function access(a){
 requirePermission(a,'marketing.read');assertApiFeature(a.features,'/api/marketing/tools');
 if(a.tenant_status==='paused')throw Object.assign(new Error('Empresa pausada.'),{status:403});
}
export async function saveMetaBillingObservation(pool,a,result){
 access(a);
 const o=result?.observation;
 if(!o||o.accountId!==result.accountId||o.source!=='meta_billing_browser'||o.currency!=='BRL'||
  !/^act_[0-9]{4,30}$/.test(o.accountId)||!Number.isSafeInteger(o.availableFundsMinor)||
  o.availableFundsMinor<0||!Number.isFinite(Date.parse(o.observedAt))||
  Date.now()-Date.parse(o.observedAt)>120000||Date.parse(o.observedAt)>Date.now()+60000||
  Date.parse(o.validUntil)!==Date.parse(o.observedAt)+15*60000)
  throw Object.assign(new Error('Observação de saldo inválida.'),{status:422});
 let daily=null;
 try{
  const report=await readAdvancedMetaTool(pool,a,'reports',{level:'account',period:'last_7d'});
  if(!report.hasMore&&report.items.length===1){
   const spend=Number(report.items[0].spend);
   if(Number.isFinite(spend)&&spend>0)daily=Math.round(spend*100/7);
  }
 }catch{/* Absolute balance threshold remains available without spend insights. */}
 await pool.query("INSERT INTO meta_billing_observations(tenant_id,user_id,account_id,currency,available_funds_minor,observed_at,valid_until,daily_spend_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,user_id,account_id) DO UPDATE SET available_funds_minor=$5,observed_at=$6,valid_until=$7,daily_spend_minor=$8,last_attempt_at=now(),last_error=NULL,monitor_enabled=true",
  [a.active_tenant_id,a.user_id,o.accountId,o.currency,o.availableFundsMinor,o.observedAt,o.validUntil,daily]);
 const alert=assessMetaFunds(o,{dailySpendMinor:daily});
 if(alert.state==='low'||alert.state==='critical'){
  await pool.query("INSERT INTO meta_billing_alerts(tenant_id,user_id,account_id,level,amount_minor,observed_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,user_id,account_id) DO UPDATE SET level=$4,amount_minor=$5,observed_at=$6,resolved_at=NULL",
   [a.active_tenant_id,a.user_id,o.accountId,alert.state,o.availableFundsMinor,o.observedAt]);
 }else await pool.query('UPDATE meta_billing_alerts SET resolved_at=now() WHERE tenant_id=$1 AND user_id=$2 AND account_id=$3 AND resolved_at IS NULL',
  [a.active_tenant_id,a.user_id,o.accountId]);
 return {observation:o,alert};
}
export async function metaBillingStatus(pool,a,accountId=null){
 access(a);
 const account=accountId?{id:accountId}:await resolveSelectedOfficialAccount(pool,a);
 const result=await pool.query('SELECT currency,available_funds_minor,observed_at,valid_until,daily_spend_minor,minimum_minor,last_error,monitor_enabled FROM meta_billing_observations WHERE tenant_id=$1 AND user_id=$2 AND account_id=$3',
  [a.active_tenant_id,a.user_id,account.id]);
 const row=result.rows[0];
 if(!row)return {accountId:account.id,observation:null,alert:{state:'unknown',daysLeft:null}};
 const observation={accountId:account.id,currency:row.currency,availableFundsMinor:Number(row.available_funds_minor),
  source:'meta_billing_browser',observedAt:new Date(row.observed_at).toISOString(),validUntil:new Date(row.valid_until).toISOString()};
 return {accountId:account.id,observation,
  alert:assessMetaFunds(observation,{dailySpendMinor:row.daily_spend_minor===null?null:Number(row.daily_spend_minor),minimumMinor:Number(row.minimum_minor)}),
  monitorEnabled:row.monitor_enabled,needsLogin:row.last_error==='needs_login'};
}
export async function monitorMetaBilling(pool,browserService){
 const rows=await pool.query("SELECT s.tenant_id,s.user_id,s.account_id,u.role,u.platform_owner,t.status AS tenant_status,t.features FROM meta_billing_observations s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=s.tenant_id JOIN meta_browser_connections c ON c.tenant_id=s.tenant_id AND c.user_id=s.user_id AND c.status='active' WHERE s.monitor_enabled=true AND u.active=true AND t.status<>'paused' AND s.last_attempt_at<now()-interval '5 minutes' ORDER BY s.last_attempt_at LIMIT 2");
 let checked=0;
 for(const row of rows.rows){
  const a={...row,active_tenant_id:row.tenant_id};
  try{
   const account=await resolveSelectedOfficialAccount(pool,a);
   if(account.id!==row.account_id){
    await pool.query('UPDATE meta_billing_observations SET monitor_enabled=false WHERE tenant_id=$1 AND user_id=$2 AND account_id=$3',[row.tenant_id,row.user_id,row.account_id]);
    continue;
   }
   const result=await browserService.billing(pool,a,'read',{background:true});
   if(result.observation)await saveMetaBillingObservation(pool,a,result);
   else await pool.query('UPDATE meta_billing_observations SET last_attempt_at=now(),last_error=$4 WHERE tenant_id=$1 AND user_id=$2 AND account_id=$3',
    [row.tenant_id,row.user_id,row.account_id,result.state==='busy'?'busy':'needs_login']);
   checked++;
  }catch{
   await pool.query("UPDATE meta_billing_observations SET last_attempt_at=now(),last_error='refresh_failed' WHERE tenant_id=$1 AND user_id=$2 AND account_id=$3",
    [row.tenant_id,row.user_id,row.account_id]);
  }
 }
 return {checked};
}

export async function readMetaFinanceWithObservation(pool,a,options={}){
 const result=await readAdsTool(pool,a,'finance',{},options);
 const observed=await metaBillingStatus(pool,a,result.account.id);
 result.balanceObservation=observed.observation;result.balanceAlert=observed.alert;
 result.billingNeedsLogin=observed.needsLogin===true;
 if(result.finance.availableFundsMinor===null&&observed.alert.state!=='unknown'){
  result.finance.availableFundsMinor=observed.observation.availableFundsMinor;
  result.finance.availableFundsSource=observed.observation.source;
  result.finance.checkedAt=observed.observation.observedAt;
  result.finance.validUntil=observed.observation.validUntil;
  result.finance.availableFundsStatus='observed_browser';
 }
 result.assistedPix={supported:result.finance.currency==='BRL',requiresBillingSession:true,automaticPayment:false};
 return result;
}
