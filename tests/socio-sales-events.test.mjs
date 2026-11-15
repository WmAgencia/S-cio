import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildSalePurchaseEvent,sendPendingSaleEvents} from '../socio-sales-events.mjs';
import {eventMessage} from '../whatsapp-ctwa-events.mjs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';

const id=()=>randomUUID();
const env={SOCIO_PUBLIC_URL:'https://socio.example.test',SOCIO_META_APP_ID:'123456789012',
 SOCIO_META_GRAPH_VERSION:'v23.0',SOCIO_META_APP_SECRET:'test-app-secret-value',
 CHANNEL_ENCRYPTION_KEY:'socio-test-encryption-key-0123456789abcd',
 SOCIO_META_CTWA_CAPI_ENABLED:'true'};
const day=86400000;

test('sale event is Purchase with value, currency, order id and a stable id',()=>{
 const now=Date.UTC(2026,10,14,12,0,0);
 const row={id:'0b7c0d3e-1111-4222-8333-944455556666',source_type:'ad',waba_id:'WABA-1',
  ctwa_clid:'click-raw-1',amount_cents:123456,confirmed_at:new Date(now-60000)};
 assert.deepEqual(buildSalePurchaseEvent(row,{now}),{
  event_name:'Purchase',
  event_time:Math.floor((now-60000)/1000),
  action_source:'business_messaging',
  messaging_channel:'whatsapp',
  event_id:'sale_0b7c0d3e111142228333944455556666',
  user_data:{whatsapp_business_account_id:'WABA-1',ctwa_clid:'click-raw-1'},
  custom_data:{value:1234.56,currency:'BRL',order_id:'0b7c0d3e-1111-4222-8333-944455556666'}
 });
 assert.equal(buildSalePurchaseEvent({...row,source_type:'post'},{now}),null);
 assert.equal(buildSalePurchaseEvent({...row,ctwa_clid:''},{now}),null);
 assert.equal(buildSalePurchaseEvent({...row,waba_id:''},{now}),null);
 assert.equal(buildSalePurchaseEvent({...row,amount_cents:null},{now}),null);
 assert.equal(buildSalePurchaseEvent({...row,amount_cents:0},{now}),null);
 assert.equal(buildSalePurchaseEvent({...row,confirmed_at:new Date(now-8*day)},{now}),null);
 assert.equal(buildSalePurchaseEvent({...row,confirmed_at:new Date(now+10*60000)},{now}),null);
 assert.notEqual(buildSalePurchaseEvent({...row,confirmed_at:new Date(now-6*day)},{now}),null);
});

test('purchase errors name the event Meta actually refused',()=>{
 assert.match(eventMessage({metaSubcode:2804066},'Purchase'),/Purchase/);
 assert.match(eventMessage({metaSubcode:2804066}),/LeadSubmitted/);
 assert.match(eventMessage({metaCode:10}),/whatsapp_business_management/);
});

test('purchase feedback stays off or unconfigured without touching the database',async()=>{
 const unused={query:async()=>{throw new Error('database must not be queried');}};
 assert.deepEqual(await sendPendingSaleEvents(unused,{env:{}}),
  {enabled:false,configured:true,checked:0,sent:0,failed:0,skipped:0,blocked:0});
 assert.deepEqual(await sendPendingSaleEvents(unused,{env:{SOCIO_META_CTWA_CAPI_ENABLED:'true'}}),
  {enabled:true,configured:false,checked:0,sent:0,failed:0,skipped:0,blocked:0});
});

test('real PostgreSQL: confirmed sales reach Meta once and only with an ad attribution',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_sales_events_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t,u,ch,cv]=[id(),id(),id(),id()];
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Vendas',$2)",
   [t,'sales-events-'+t.slice(0,8)]);
  await db.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'Vendas','test','owner')",
   [u,t,'sales-events-'+u+'@example.test']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'Vendas','5515933333333','waakg','connected')",
   [ch,t]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES($1,$2,$3,'5515944444444')",
   [cv,t,ch]);
  await db.query("INSERT INTO meta_official_grants(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at) "+
   "VALUES($1,$2,'104',$3,'{ads_read,ads_management}',now()+interval '2 days')",
   [t,u,sealMarketingSecret(JSON.stringify({tenant:t,user:u,token:'EAA-sales-token-'+'c'.repeat(40)}),env)]);

  const calls=[];
  let transientFailures=1;
  const request=async(link,options)=>{
   const url=new URL(link),path=url.pathname;
   const body=options.body?JSON.parse(options.body):null;
   calls.push({path,body});
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

  const insertAttribution="INSERT INTO wa_ctwa_attributions(id,tenant_id,channel_id,conversation_id,"+
   "inbound_message_id,source_id,source_type,occurred_at,waba_id,ctwa_clid) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)";
  const attribution=async({waba,clid,occurredAt,sourceType='ad',messageId})=>{
   const rowId=id();
   await db.query(insertAttribution,[rowId,t,ch,cv,
    messageId||'wamid.sale.attr.'+rowId.slice(0,8),'1200000000201',sourceType,
    occurredAt,waba,clid]);
   return rowId;
  };
  const insertSale="INSERT INTO socio_sales(id,tenant_id,conversation_id,inbound_message_id,"+
   "evidence_kind,evidence_excerpt,amount_cents,status,source,origin_source,ctwa_attribution_id,"+
   "confirmed_at) VALUES($1,$2,$3,$4,'text','fixture',$5,$6,'heuristic',$7,$8,$9)";
  const sale=async({attributionId=null,cents=5000,status='confirmed',
   confirmedAt=new Date(Date.now()-5*60000),messageId})=>{
   const saleId=id();
   await db.query(insertSale,[saleId,t,cv,messageId||'wamid.sale.'+saleId.slice(0,8),
    cents,status,attributionId?'ctwa':'organic',attributionId,
    status==='confirmed'?confirmedAt:null]);
   return saleId;
  };
  const saleRow=async saleId=>(await db.query(
   'SELECT capi_sent_at,capi_attempts,capi_last_attempt_at,capi_error,capi_event_id '+
   'FROM socio_sales WHERE id=$1',[saleId])).rows[0];
  const run=()=>sendPendingSaleEvents(db,{limit:20,request,env});

  // Only a confirmed sale with an ad click id is a Purchase. A pending sale, an
  // organic sale, a post referral, an expired click and an old confirmation are
  // never selected, so the first run checks exactly one row.
  const mainAttribution=await attribution({waba:'WABA-MAIN',clid:'click-main-1',
   occurredAt:new Date(Date.now()-2*3600000)});
  const mainSale=await sale({attributionId:mainAttribution});
  await sale({attributionId:mainAttribution,cents:7000,status:'pending'});
  await sale({cents:6000});
  const postAttribution=await attribution({waba:'WABA-MAIN',clid:'click-post-1',sourceType:'post',
   occurredAt:new Date(Date.now()-3600000)});
  await sale({attributionId:postAttribution});
  const staleAttribution=await attribution({waba:'WABA-MAIN',clid:'click-stale-1',
   occurredAt:new Date(Date.now()-9*day)});
  await sale({attributionId:staleAttribution});
  const oldConfirmAttribution=await attribution({waba:'WABA-MAIN',clid:'click-old-1',
   occurredAt:new Date(Date.now()-9*day)});
  await sale({attributionId:oldConfirmAttribution,confirmedAt:new Date(Date.now()-9*day)});

  const first=await run();
  assert.equal(first.enabled,true);
  assert.equal(first.configured,true);
  assert.equal(first.checked,1);
  assert.equal(first.sent,1);
  assert.equal(first.failed,0);
  assert.equal(calls.length,2);
  assert.match(calls[0].path,/\/WABA-MAIN\/dataset$/);
  assert.match(calls[1].path,/\/DS-WABA-MAIN\/events$/);
  assert.equal(calls[1].body.data.length,1);
  const event=calls[1].body.data[0];
  assert.equal(event.event_name,'Purchase');
  assert.equal(event.action_source,'business_messaging');
  assert.equal(event.messaging_channel,'whatsapp');
  assert.equal(event.user_data.whatsapp_business_account_id,'WABA-MAIN');
  assert.equal(event.user_data.ctwa_clid,'click-main-1');
  assert.equal(event.custom_data.value,50);
  assert.equal(event.custom_data.currency,'BRL');
  assert.equal(event.custom_data.order_id,mainSale);
  assert.match(event.event_id,/^sale_[0-9a-f]{32}$/);
  const sentRow=await saleRow(mainSale);
  assert.notEqual(sentRow.capi_sent_at,null);
  assert.equal(sentRow.capi_event_id,event.event_id);
  assert.equal(sentRow.capi_error,null);

  // The cached dataset is reused and the sent sale is never reported twice.
  const secondAttribution=await attribution({waba:'WABA-MAIN',clid:'click-main-2',
   occurredAt:new Date(Date.now()-3600000)});
  await sale({attributionId:secondAttribution,cents:8990,confirmedAt:new Date(Date.now()-2*60000)});
  const beforeSecond=calls.length;
  const second=await run();
  assert.equal(second.checked,1);
  assert.equal(second.sent,1);
  assert.equal(calls.length,beforeSecond+1);
  assert.match(calls[calls.length-1].path,/\/DS-WABA-MAIN\/events$/);
  assert.equal(calls[calls.length-1].body.data[0].custom_data.value,89.9);
  assert.equal((await run()).checked,0);

  // A transient failure backs off for 15 minutes and succeeds on the retry.
  const retryAttribution=await attribution({waba:'WABA-RETRY',clid:'click-retry-1',
   occurredAt:new Date(Date.now()-1800000)});
  const retrySale=await sale({attributionId:retryAttribution,cents:12345,
   confirmedAt:new Date(Date.now()-3*60000)});
  const retryFail=await run();
  assert.equal(retryFail.failed,1);
  assert.equal(retryFail.sent,0);
  const retryRow=await saleRow(retrySale);
  assert.equal(retryRow.capi_attempts,1);
  assert.notEqual(retryRow.capi_last_attempt_at,null);
  assert.match(retryRow.capi_error,/temporário/);
  assert.equal((await run()).checked,0);
  await db.query("UPDATE socio_sales SET capi_last_attempt_at=now()-interval '20 minutes' WHERE id=$1",[retrySale]);
  const retryOk=await run();
  assert.equal(retryOk.sent,1);
  assert.notEqual((await saleRow(retrySale)).capi_sent_at,null);

  // A permission error is explained in Portuguese, does not consume attempts and
  // blocks the rest of that WABA in the same batch.
  const deniedAttribution=await attribution({waba:'WABA-DENIED',clid:'click-denied-1',
   occurredAt:new Date(Date.now()-1200000)});
  const deniedSale=await sale({attributionId:deniedAttribution});
  const deniedAttribution2=await attribution({waba:'WABA-DENIED',clid:'click-denied-2',
   occurredAt:new Date(Date.now()-600000)});
  const deniedSale2=await sale({attributionId:deniedAttribution2,cents:9000});
  const beforeDenied=calls.length;
  const denied=await run();
  assert.equal(denied.checked,2);
  assert.equal(denied.blocked,2);
  assert.equal(denied.failed,0);
  assert.equal(calls.length,beforeDenied+2);
  for(const saleId of [deniedSale,deniedSale2]){
   const row=await saleRow(saleId);
   assert.equal(row.capi_attempts,0);
   assert.match(row.capi_error,/whatsapp_business_management/);
   assert.notEqual(row.capi_last_attempt_at,null);
  }

  // A dataset failure blocks only that WABA and never calls the event endpoint.
  const badAttribution=await attribution({waba:'WABA-BADDATASET',clid:'click-bad-1',
   occurredAt:new Date(Date.now()-600000)});
  await sale({attributionId:badAttribution});
  const beforeBad=calls.length;
  const badDataset=await run();
  assert.equal(badDataset.blocked,1);
  assert.equal(badDataset.checked,1);
  assert.equal(calls.length,beforeBad+1);
  assert.match(calls[calls.length-1].path,/\/WABA-BADDATASET\/dataset$/);

  // A tenant without a Meta grant is skipped without consuming an attempt.
  const [t2,u2,ch2,cv2]=[id(),id(),id(),id()];
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Sem grant',$2)",
   [t2,'sales-events-'+t2.slice(0,8)]);
  await db.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'Sem grant','test','owner')",
   [u2,t2,'sales-events-'+u2+'@example.test']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'Sem grant','5515955555555','waakg','connected')",
   [ch2,t2]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES($1,$2,$3,'5515966666666')",
   [cv2,t2,ch2]);
  const orphanAttribution=id(),orphanSale=id();
  await db.query(insertAttribution,[orphanAttribution,t2,ch2,cv2,'wamid.sale.orphan.1',
   '1200000000202','ad',new Date(Date.now()-600000),'WABA-MAIN','click-orphan-1']);
  await db.query(insertSale,[orphanSale,t2,cv2,'wamid.sale.orphan.1',4000,'confirmed','ctwa',
   orphanAttribution,new Date(Date.now()-60000)]);
  const beforeOrphan=calls.length;
  const orphan=await run();
  // The failed dataset sale is still pending, so it is checked again and blocked
  // by the WABA backoff; only the sale without a grant is skipped.
  assert.equal(orphan.checked,2);
  assert.equal(orphan.blocked,1);
  assert.equal(orphan.skipped,1);
  assert.equal(orphan.sent,0);
  assert.equal(calls.length,beforeOrphan);
  assert.equal((await saleRow(orphanSale)).capi_sent_at,null);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
