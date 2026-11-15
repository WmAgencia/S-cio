import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildCtwaConversionEvent,sendPendingCtwaEvents} from '../whatsapp-ctwa-events.mjs';
import {readCtwaReport,formatCtwaReport} from '../whatsapp-ctwa.mjs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';

const id=()=>randomUUID();
const flags={meta_ads:true,whatsapp:true,ai:true,team:true,catalog:true};
const env={SOCIO_PUBLIC_URL:'https://socio.example.test',SOCIO_META_APP_ID:'123456789012',
 SOCIO_META_GRAPH_VERSION:'v23.0',SOCIO_META_APP_SECRET:'test-app-secret-value',
 CHANNEL_ENCRYPTION_KEY:'socio-test-encryption-key-0123456789abcd',
 SOCIO_META_CTWA_CAPI_ENABLED:'true'};
const day=86400000;

test('ctwa conversion event is LeadSubmitted with the raw click id and a stable id',()=>{
 const now=Date.UTC(2026,10,14,12,0,0);
 const row={id:'0b7c0d3e-1111-4222-8333-944455556666',source_type:'ad',waba_id:'WABA-1',
  ctwa_clid:'click-raw-1',occurred_at:new Date(now-60000)};
 assert.deepEqual(buildCtwaConversionEvent(row,{now}),{
  event_name:'LeadSubmitted',
  event_time:Math.floor((now-60000)/1000),
  action_source:'business_messaging',
  messaging_channel:'whatsapp',
  event_id:'ctwa_0b7c0d3e111142228333944455556666',
  user_data:{whatsapp_business_account_id:'WABA-1',ctwa_clid:'click-raw-1'}
 });
 assert.equal(buildCtwaConversionEvent({...row,source_type:'post'},{now}),null);
 assert.equal(buildCtwaConversionEvent({...row,ctwa_clid:''},{now}),null);
 assert.equal(buildCtwaConversionEvent({...row,waba_id:''},{now}),null);
 assert.equal(buildCtwaConversionEvent({...row,occurred_at:new Date(now-8*day)},{now}),null);
 assert.equal(buildCtwaConversionEvent({...row,occurred_at:new Date(now+10*60000)},{now}),null);
 assert.notEqual(buildCtwaConversionEvent({...row,occurred_at:new Date(now-6*day)},{now}),null);
});

test('conversion feedback stays off or unconfigured without touching the database',async()=>{
 const unused={query:async()=>{throw new Error('database must not be queried');}};
 assert.deepEqual(await sendPendingCtwaEvents(unused,{env:{}}),
  {enabled:false,configured:true,checked:0,sent:0,failed:0,skipped:0,blocked:0});
 assert.deepEqual(await sendPendingCtwaEvents(unused,{env:{SOCIO_META_CTWA_CAPI_ENABLED:'true'}}),
  {enabled:true,configured:false,checked:0,sent:0,failed:0,skipped:0,blocked:0});
});

test('real PostgreSQL: dataset cache, event delivery, retry and honest report',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_ctwa_events_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t,u,ch,cv]=[id(),id(),id(),id()];
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'CAPI',$2)",
   [t,'ctwa-events-'+t.slice(0,8)]);
  await db.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'CAPI','test','owner')",
   [u,t,'ctwa-events-'+u+'@example.test']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'CAPI','5515977777777','waakg','connected')",
   [ch,t]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES($1,$2,$3,'5515988888888')",
   [cv,t,ch]);
  await db.query("INSERT INTO meta_official_grants(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at) "+
   "VALUES($1,$2,'103',$3,'{ads_read,ads_management}',now()+interval '2 days')",
   [t,u,sealMarketingSecret(JSON.stringify({tenant:t,user:u,token:'EAA-capi-token-'+'b'.repeat(40)}),env)]);

  const calls=[];
  let transientFailures=1;
  const request=async(link,options)=>{
   const url=new URL(link),path=url.pathname;
   const body=options.body?JSON.parse(options.body):null;
   calls.push({path,body,proof:url.searchParams.get('appsecret_proof'),
    token:options.headers.Authorization});
   if(path.endsWith('/dataset')){
    const waba=path.split('/').slice(-2)[0];
    if(waba==='WABA-BADDATASET')
     return {ok:false,status:403,json:async()=>({error:{code:10,message:'Permission denied'}})};
    return {ok:true,status:200,json:async()=>({dataset_id:'DS-'+waba})};
   }
   const dataset=path.split('/').slice(-2)[0],waba=dataset.replace(/^DS-/,'');
   if(waba==='WABA-DENIED')
    return {ok:false,status:400,json:async()=>({error:{code:10,message:'No permission'}})};
   if(waba==='WABA-RETRY'&&transientFailures>0){
    transientFailures--;
    return {ok:false,status:500,json:async()=>({error:{code:2,message:'temporário'}})};
   }
   return {ok:true,status:200,json:async()=>({events_received:1})};
  };
  const insertArrival="INSERT INTO wa_ctwa_attributions(id,tenant_id,channel_id,conversation_id,"+
   "inbound_message_id,source_id,source_type,occurred_at,waba_id,ctwa_clid) "+
   "VALUES($1,$2,$3,$4,$5,$6,'ad',$7,$8,$9)";
  const arrival=async(waba,clid,occurredAt,messageId,sourceId)=>{
   const rowId=id();
   await db.query(insertArrival,[rowId,t,ch,cv,messageId,sourceId,occurredAt,waba,clid]);
   return rowId;
  };
  const run=()=>sendPendingCtwaEvents(db,{limit:20,request,env});
  const rowOf=async rowId=>(await db.query(
   'SELECT capi_sent_at,capi_attempts,capi_last_attempt_at,capi_error FROM wa_ctwa_attributions WHERE id=$1',
   [rowId])).rows[0];

  // First arrival provisions the dataset once and delivers the event.
  const rowA=await arrival('WABA-MAIN','click-main-1',new Date(Date.now()-5*60000),'wamid.capi.1','1200000000201');
  const first=await run();
  assert.equal(first.enabled,true);
  assert.equal(first.configured,true);
  assert.equal(first.checked,1);
  assert.equal(first.sent,1);
  assert.equal(first.failed,0);
  assert.equal(calls.length,2);
  assert.match(calls[0].path,/\/WABA-MAIN\/dataset$/);
  assert.match(calls[1].path,/\/DS-WABA-MAIN\/events$/);
  assert.match(calls[0].proof,/^[0-9a-f]{64}$/);
  assert.match(calls[0].token,/^Bearer EAA-capi-token-/);
  assert.equal(calls[1].body.data.length,1);
  const event=calls[1].body.data[0];
  assert.ok(Math.abs(event.event_time-Math.floor((Date.now()-5*60000)/1000))<5);
  assert.equal(event.event_name,'LeadSubmitted');
  assert.equal(event.action_source,'business_messaging');
  assert.equal(event.messaging_channel,'whatsapp');
  assert.equal(event.user_data.whatsapp_business_account_id,'WABA-MAIN');
  assert.equal(event.user_data.ctwa_clid,'click-main-1');
  assert.match(event.event_id,/^ctwa_[0-9a-f]{32}$/);
  assert.notEqual((await rowOf(rowA)).capi_sent_at,null);
  const dataset=(await db.query(
   'SELECT dataset_id,attempts,error FROM meta_waba_datasets WHERE tenant_id=$1 AND waba_id=$2',
   [t,'WABA-MAIN'])).rows[0];
  assert.equal(dataset.dataset_id,'DS-WABA-MAIN');
  assert.equal(dataset.attempts,0);
  assert.equal(dataset.error,null);

  // The cached dataset is reused: a second arrival costs one event call only.
  const beforeSecond=calls.length;
  const rowB=await arrival('WABA-MAIN','click-main-2',new Date(Date.now()-4*60000),'wamid.capi.2','1200000000202');
  const second=await run();
  assert.equal(second.sent,1);
  assert.equal(calls.length,beforeSecond+1);
  assert.match(calls[calls.length-1].path,/\/DS-WABA-MAIN\/events$/);
  assert.notEqual((await rowOf(rowB)).capi_sent_at,null);

  // Transient failure consumes one attempt, backs off, then succeeds.
  const rowC=await arrival('WABA-RETRY','click-retry-1',new Date(Date.now()-3*60000),'wamid.capi.3','1200000000203');
  const retryFail=await run();
  assert.equal(retryFail.failed,1);
  assert.equal(retryFail.sent,0);
  const retryRow=await rowOf(rowC);
  assert.equal(retryRow.capi_attempts,1);
  assert.notEqual(retryRow.capi_last_attempt_at,null);
  assert.match(retryRow.capi_error,/temporário/);
  assert.equal((await run()).checked,0);
  await db.query("UPDATE wa_ctwa_attributions SET capi_last_attempt_at=now()-interval '20 minutes' WHERE id=$1",[rowC]);
  const retryOk=await run();
  assert.equal(retryOk.sent,1);
  assert.notEqual((await rowOf(rowC)).capi_sent_at,null);

  // A permission error is shown in Portuguese, does not consume attempts, and
  // blocks the rest of that WABA in the same batch instead of repeating the call.
  const rowD=await arrival('WABA-DENIED','click-denied-1',new Date(Date.now()-2*60000),'wamid.capi.4','1200000000204');
  const rowD2=await arrival('WABA-DENIED','click-denied-2',new Date(Date.now()-60000),'wamid.capi.4b','1200000000207');
  const beforeDenied=calls.length;
  const denied=await run();
  assert.equal(denied.checked,2);
  assert.equal(denied.blocked,2);
  assert.equal(denied.failed,0);
  assert.equal(calls.length,beforeDenied+2);
  assert.match(calls[calls.length-1].path,/\/DS-WABA-DENIED\/events$/);
  for(const rowId of [rowD,rowD2]){
   const row=await rowOf(rowId);
   assert.equal(row.capi_attempts,0);
   assert.match(row.capi_error,/whatsapp_business_management/);
   assert.notEqual(row.capi_last_attempt_at,null);
  }

  // A dataset failure blocks only that WABA and is reported without an event call.
  await arrival('WABA-BADDATASET','click-bad-1',new Date(Date.now()-60000),'wamid.capi.5','1200000000205');
  const beforeBad=calls.length;
  const badDataset=await run();
  assert.equal(badDataset.blocked,1);
  assert.equal(badDataset.checked,1);
  assert.equal(calls.length,beforeBad+1);
  assert.match(calls[calls.length-1].path,/\/WABA-BADDATASET\/dataset$/);
  const badRow=(await db.query(
   'SELECT dataset_id,attempts,error FROM meta_waba_datasets WHERE tenant_id=$1 AND waba_id=$2',
   [t,'WABA-BADDATASET'])).rows[0];
  assert.equal(badRow.dataset_id,null);
  assert.equal(badRow.attempts,0);
  assert.match(badRow.error,/whatsapp_business_management/);

  // Outside the 7-day window nothing is sent, but the report says so.
  await arrival('WABA-MAIN','click-old-1',new Date(Date.now()-8*day),'wamid.capi.6','1200000000206');
  const beforeExpired=calls.length;
  const expired=await run();
  assert.equal(expired.checked,1);
  assert.equal(expired.blocked,1);
  assert.equal(expired.sent,0);
  assert.equal(calls.length,beforeExpired);

  const owner={active_tenant_id:t,user_id:u,role:'owner',tenant_status:'trial',features:flags};
  const report=await readCtwaReport(db,owner,{days:30,env});
  assert.equal(report.conversionFeedback.enabled,true);
  assert.equal(report.conversionFeedback.sent,3);
  assert.equal(report.conversionFeedback.pending,3);
  assert.equal(report.conversionFeedback.failed,0);
  assert.equal(report.conversionFeedback.expired,1);
  assert.match(report.conversionFeedback.lastError,/whatsapp_business_management/);
  const text=formatCtwaReport(report);
  assert.match(text,/Eventos de conversa enviados à Meta: 3/);
  assert.match(text,/Pendência na Meta: .*whatsapp_business_management/);
  assert.match(text,/não representa vendas ou receita\.$/);
  const off=await readCtwaReport(db,owner,{days:30,env:{}});
  assert.equal(off.conversionFeedback.enabled,false);
  assert.equal(off.conversionFeedback.sent,3);
  assert.doesNotMatch(formatCtwaReport(off),/Eventos de conversa enviados/);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
