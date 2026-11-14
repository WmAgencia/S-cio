import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {normalizeCtwaReferral,whatsappWebhookItems,saveCtwaAttribution,
 resolvePendingCtwaAds,readCtwaReport,formatCtwaReport} from '../whatsapp-ctwa.mjs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';

const id=()=>randomUUID();
const flags={meta_ads:true,whatsapp:true,ai:true,team:true,catalog:true};
const env={SOCIO_PUBLIC_URL:'https://socio.example.test',SOCIO_META_APP_ID:'123456789012',
 SOCIO_META_GRAPH_VERSION:'v23.0',SOCIO_META_APP_SECRET:'test-app-secret-value',
 CHANNEL_ENCRYPTION_KEY:'socio-test-encryption-key-0123456789abcd'};

test('ctwa referral normalization accepts only Meta-shaped referrals',()=>{
 assert.equal(normalizeCtwaReferral(null),null);
 assert.equal(normalizeCtwaReferral([]),null);
 assert.equal(normalizeCtwaReferral('referral'),null);
 assert.equal(normalizeCtwaReferral({source_type:'ad'}),null);
 assert.equal(normalizeCtwaReferral({source_id:'anúncio com espaço'}),null);
 const ad=normalizeCtwaReferral({source_id:'120208765432109876',source_type:'ADS',
  ctwa_clid:'AfJclick',source_url:'https://fb.me/abc',headline:'H'.repeat(400),
  image_url:'http://insecure.example/x.png'});
 assert.equal(ad.sourceId,'120208765432109876');
 assert.equal(ad.sourceType,'ad');
 assert.equal(ad.ctwaClid,'AfJclick');
 assert.equal(ad.sourceUrl,'https://fb.me/abc');
 assert.equal(ad.headline.length,300);
 assert.equal(ad.imageUrl,null);
 assert.equal(normalizeCtwaReferral({source_id:'9',source_type:'post'}).sourceType,'post');
 assert.equal(normalizeCtwaReferral({source_id:'9',source_type:'OPEN_THREAD'}).sourceType,'open_thread');
 assert.equal(normalizeCtwaReferral({source_id:'9',source_type:'story'}).sourceType,'unknown');
 assert.equal(normalizeCtwaReferral({source_id:'9'}).sourceType,'unknown');
});

test('webhook extraction keeps the referral carried by the first non-text message',()=>{
 assert.deepEqual(whatsappWebhookItems({object:'page',entry:[]}),[]);
 const now=Date.UTC(2026,10,14,12,0,0),seconds=Math.floor(now/1000);
 const payload={object:'whatsapp_business_account',entry:[{id:'WABA-1',changes:[{value:{
  metadata:{phone_number_id:'55501'},contacts:[{profile:{name:'Ana'}}],
  messages:[
   {id:'wamid.1',from:'5515999999999',timestamp:String(seconds),type:'image',
    image:{id:'media'},referral:{source_id:'1200000000001',source_type:'ad',ctwa_clid:'click-1'}},
   {id:'wamid.2',from:'5515999999999',timestamp:String(seconds),type:'image',image:{id:'media'}},
   {id:'wamid.3',from:'5515888888888',timestamp:String(seconds),type:'text',text:{body:'Olá'}},
   {from:'5515999999999',timestamp:String(seconds),type:'text',text:{body:'sem id'}}
  ]}}]}]};
 const items=whatsappWebhookItems(payload,{now});
 assert.equal(items.length,2);
 assert.equal(items[0].body,null);
 assert.equal(items[0].referral.sourceId,'1200000000001');
 assert.equal(items[0].wabaId,'WABA-1');
 assert.equal(items[0].external,'55501');
 assert.equal(items[0].messageId,'wamid.1');
 assert.equal(items[0].occurredAt.getTime(),seconds*1000);
 assert.equal(items[1].body,'Olá');
 assert.equal(items[1].referral,null);
 const stale=whatsappWebhookItems({object:'whatsapp_business_account',entry:[{id:'WABA-1',
  changes:[{value:{metadata:{phone_number_id:'55501'},messages:[{id:'wamid.old',
   from:'5515999999999',timestamp:String(seconds-40*86400),type:'text',text:{body:'antigo'}}]}}]}]},{now});
 assert.equal(stale.length,1);
 assert.equal(stale[0].occurredAt.getTime(),now);
});

test('real PostgreSQL: ctwa capture, read-only ad resolution and honest arrival report',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_ctwa_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t1,t2,t3,t4]=Array.from({length:4},id);
  const [u3,c1,c2,c3,c4]=Array.from({length:5},id);
  const [cv1,cv2,cvB,cv3,cv4]=Array.from({length:5},id);
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'A',$2),($3,'B',$4),($5,'C',$6),($7,'D',$8)",
   [t1,'ctwa-a-'+t1.slice(0,8),t2,'ctwa-b-'+t2.slice(0,8),t3,'ctwa-c-'+t3.slice(0,8),t4,'ctwa-d-'+t4.slice(0,8)]);
  await db.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'C','test','owner')",
   [u3,t3,'ctwa-c-'+u3+'@example.test']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
   "($1,$2,'A','5515900000001','waakg','connected'),($3,$4,'B','5515900000002','waakg','connected'),"+
   "($5,$6,'C','5515900000003','waakg','connected'),($7,$8,'D','5515900000004','waakg','connected')",
   [c1,t1,c2,t2,c3,t3,c4,t4]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES "+
   "($1,$2,$3,'5515911111111'),($4,$5,$6,'5515922222222'),($7,$8,$9,'5515933333333'),"+
   "($10,$11,$12,'5515944444444'),($13,$14,$15,'5515955555555')",
   [cv1,t1,c1,cv2,t1,c1,cvB,t2,c2,cv3,t3,c3,cv4,t4,c4]);

  // A referral is stored once per inbound message; a webhook retry changes nothing.
  const referral=normalizeCtwaReferral({source_id:'1200000000101',source_type:'ad',ctwa_clid:'click-1'});
  const arrivedAt=new Date(Date.now()-60*60000);
  const save=()=>saveCtwaAttribution(db,{tenantId:t3,channelId:c3,conversationId:cv3,
   inboundMessageId:'wamid.ctwa.one',wabaId:'WABA-3',referral,occurredAt:arrivedAt});
  assert.equal(await save(),true);
  assert.equal(await save(),false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM wa_ctwa_attributions WHERE tenant_id=$1',[t3])).rows[0].n,1);
  assert.equal(await saveCtwaAttribution(db,{tenantId:t3,channelId:c3,conversationId:cv3,
   inboundMessageId:'wamid.ctwa.none',wabaId:'WABA-3',referral:null,occurredAt:arrivedAt}),false);

  // Resolution: one read-only Graph lookup per tenant+ad, never per arrival.
  const insertAttribution="INSERT INTO wa_ctwa_attributions(id,tenant_id,channel_id,conversation_id,"+
   "inbound_message_id,source_id,source_type,occurred_at) VALUES($1,$2,$3,$4,$5,$6,'ad',now())";
  await db.query(insertAttribution,[id(),t3,c3,cv3,'wamid.ctwa.two','1200000000101']);
  await db.query(insertAttribution,[id(),t3,c3,cv3,'wamid.ctwa.three','1200000000102']);
  await db.query(insertAttribution,[id(),t3,c3,cv3,'wamid.ctwa.four','1200000000103']);
  await db.query(insertAttribution,[id(),t4,c4,cv4,'wamid.ctwa.five','1200000000104']);
  await db.query("INSERT INTO meta_official_grants(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at) "+
   "VALUES($1,$2,'103',$3,'{ads_read}',now()+interval '2 days')",
   [t3,u3,sealMarketingSecret('EAA-test-token-'+'a'.repeat(40),env)]);
  const calls=[];
  const request=async(link,options)=>{
   const adId=new URL(link).pathname.split('/').pop();
   calls.push({adId,proof:new URL(link).searchParams.get('appsecret_proof'),token:options.headers.Authorization});
   if(adId==='1200000000101')return {ok:true,json:async()=>({id:'1200000000101',name:'Anúncio Bom',
    account_id:'act_333',campaign:{id:'555',name:'Campanha C'},adset:{id:'666',name:'Conjunto C'}})};
   if(adId==='1200000000102')return {ok:true,json:async()=>({error:{code:100,message:'Unsupported get request.'}})};
   return {ok:false,status:500,json:async()=>({error:{code:2,message:'temporário'}})};
  };
  const first=await resolvePendingCtwaAds(db,{limit:10,request,env});
  assert.deepEqual(first,{checked:4,resolved:1,failed:2,skipped:1});
  assert.equal(calls.length,3);
  assert.match(calls[0].proof,/^[0-9a-f]{64}$/);
  assert.match(calls[0].token,/^Bearer EAA-test-token-/);
  const okRows=(await db.query("SELECT ad_name,campaign_id,campaign_name,resolved_at FROM wa_ctwa_attributions WHERE tenant_id=$1 AND source_id='1200000000101'",[t3])).rows;
  assert.equal(okRows.length,2);
  for(const row of okRows){
   assert.equal(row.ad_name,'Anúncio Bom');
   assert.equal(row.campaign_id,'555');
   assert.equal(row.campaign_name,'Campanha C');
   assert.notEqual(row.resolved_at,null);
  }
  const gone=(await db.query("SELECT resolution_attempts,resolved_at,resolution_error FROM wa_ctwa_attributions WHERE tenant_id=$1 AND source_id='1200000000102'",[t3])).rows[0];
  assert.equal(gone.resolution_attempts,1);
  assert.notEqual(gone.resolved_at,null);
  assert.match(gone.resolution_error,/não identificou/);
  const flaky=(await db.query("SELECT resolution_attempts,resolved_at,last_attempt_at FROM wa_ctwa_attributions WHERE tenant_id=$1 AND source_id='1200000000103'",[t3])).rows[0];
  assert.equal(flaky.resolution_attempts,1);
  assert.equal(flaky.resolved_at,null);
  assert.notEqual(flaky.last_attempt_at,null);
  const noGrant=(await db.query("SELECT resolution_attempts,last_attempt_at FROM wa_ctwa_attributions WHERE tenant_id=$1",[t4])).rows[0];
  assert.equal(noGrant.resolution_attempts,0);
  assert.equal(noGrant.last_attempt_at,null);
  // A recent attempt waits 15 minutes; a tenant without a grant is retried for free.
  assert.deepEqual(await resolvePendingCtwaAds(db,{limit:10,request,env}),
   {checked:1,resolved:0,failed:0,skipped:1});
  await db.query("UPDATE wa_ctwa_attributions SET last_attempt_at=now()-interval '20 minutes' WHERE tenant_id=$1 AND source_id='1200000000103'",[t3]);
  assert.deepEqual(await resolvePendingCtwaAds(db,{limit:10,request,env}),
   {checked:2,resolved:0,failed:1,skipped:1});
  assert.deepEqual(await resolvePendingCtwaAds(db,{limit:10,request,env:{}}),
   {checked:0,resolved:0,failed:0,skipped:0});

  // Report: arrivals are counted per click, replies only inside the 7-day window.
  const base=Date.now(),at=minutes=>new Date(base-minutes*60000);
  const insertReport="INSERT INTO wa_ctwa_attributions(id,tenant_id,channel_id,conversation_id,"+
   "inbound_message_id,source_id,source_type,occurred_at,campaign_id,campaign_name,ad_name,account_id) "+
   "VALUES($1,$2,$3,$4,$5,$6,'ad',$7,$8,$9,$10,'act_999')";
  await db.query(insertReport,[id(),t1,c1,cv1,'wamid.r.1','9001',at(200),'555','Campanha Um','Anúncio Um']);
  await db.query(insertReport,[id(),t1,c1,cv1,'wamid.r.2','9001',at(100),'555','Campanha Um','Anúncio Um']);
  await db.query(insertReport,[id(),t1,c1,cv2,'wamid.r.3','9002',at(60),'555','Campanha Um','Anúncio Dois']);
  await db.query(insertReport,[id(),t2,c2,cvB,'wamid.r.4','9003',at(60),'999','Outra Campanha','Outro Anúncio']);
  const insertMessage="INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)";
  await db.query(insertMessage,[id(),t1,cv1,'outbound','Resposta 1','wamid.out.1',at(190)]);
  await db.query(insertMessage,[id(),t1,cv1,'inbound','Voltei 1','wamid.in.2',at(180)]);
  await db.query(insertMessage,[id(),t1,cv1,'outbound','Resposta 2','wamid.out.3',at(95)]);
  await db.query(insertMessage,[id(),t1,cv1,'inbound','Voltei 2','wamid.in.4',at(90)]);
  const ownerA={active_tenant_id:t1,user_id:id(),role:'owner',tenant_status:'trial',features:flags};
  const ownerB={active_tenant_id:t2,user_id:id(),role:'owner',tenant_status:'trial',features:flags};
  const report=await readCtwaReport(db,ownerA,{days:30});
  assert.equal(report.method,'ctwa_referral');
  assert.equal(report.confidence,'meta_confirmed');
  assert.equal(report.readOnly,true);
  assert.equal(report.attributionWindowDays,7);
  assert.equal(report.totals.arrivals,3);
  assert.equal(report.totals.conversations,2);
  assert.equal(report.totals.ads,2);
  assert.equal(report.totals.campaigns,1);
  assert.equal(report.totals.businessResponded,2);
  assert.equal(report.totals.customerFollowedUp,2);
  assert.equal(report.totals.averageFirstBusinessReplySeconds,450);
  assert.equal(report.totals.unresolvedArrivals,0);
  assert.equal(Object.hasOwn(report.totals,'sales'),false);
  assert.equal(Object.hasOwn(report.totals,'revenueCents'),false);
  assert.equal(report.notes.length,4);
  assert.equal(report.items[0].sourceId,'9001');
  assert.equal(report.items[0].arrivals,2);
  assert.equal(report.items[0].conversations,1);
  assert.equal(report.items[0].businessResponded,2);
  assert.equal(report.items[0].customerFollowedUp,2);
  assert.equal(report.items[0].averageFirstBusinessReplySeconds,450);
  assert.equal(report.items[1].sourceId,'9002');
  assert.equal(report.items[1].arrivals,1);
  assert.equal(report.items[1].businessResponded,0);
  assert.equal(report.items[1].averageFirstBusinessReplySeconds,null);
  assert.equal(report.campaigns[0].campaignId,'555');
  assert.equal(report.campaigns[0].arrivals,3);
  assert.equal(report.campaigns[0].ads,2);
  assert.equal(report.campaigns[0].conversations,2);
  assert.equal((await readCtwaReport(db,ownerB,{days:30})).totals.arrivals,1);
  assert.equal((await readCtwaReport(db,ownerA,{days:1})).totals.arrivals,3);
  await assert.rejects(readCtwaReport(db,{...ownerA,features:{...flags,meta_ads:false}}),e=>e.status===403);
  await assert.rejects(readCtwaReport(db,{...ownerA,tenant_status:'paused'}),e=>e.status===403);
  const text=formatCtwaReport(report);
  assert.match(text,/Chegadas do Meta Ads para o WhatsApp/);
  assert.match(text,/3 chegada\(s\)/);
  assert.match(text,/não representa vendas ou receita\.$/);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
