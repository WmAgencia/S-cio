import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {validateTrackingInput,buildPrefilledWhatsAppLink,createTrackingLink,listTrackingLinks,deactivateTrackingLink,scanTrackingAttribution,trackingReport} from '../whatsapp-attribution.mjs';
import {readWhatsAppFunnel} from '../whatsapp-funnel.mjs';

const flags={meta_ads:true,whatsapp:true,ai:true,team:true,quotes:true,catalog:true};
const id=()=>randomUUID();
test('tracking codes are only WhatsApp prefilled messages, not confirmed Meta attribution',()=>{
 const code='SC'+randomBytes(10).toString('hex').toUpperCase();
 const link=buildPrefilledWhatsAppLink('55 (15) 99999-9999',code);
 assert.match(link,/^https:\/\/wa\.me\/5515999999999\?text=/);
 assert.equal(new URL(link).searchParams.get('text'),'Olá! Tenho interesse no anúncio ['+code+']');
 assert.throws(()=>buildPrefilledWhatsAppLink('551500',code));
 assert.throws(()=>buildPrefilledWhatsAppLink('5515999999999','SCWRONG'));
 const channelId=id();
 assert.equal(validateTrackingInput({channelId,label:'Sorocaba',campaignId:'1234567890'}).campaignId,'1234567890');
 assert.throws(()=>validateTrackingInput({channelId,label:'aa'}));
 assert.throws(()=>validateTrackingInput({channelId,label:'Sorocaba',adId:'hack'}));
});

test('tracking routes require both Meta and WhatsApp modules, permissions and tenant scope',async()=>{
 const tenant=id(),user=id(),channel=id(),a={active_tenant_id:tenant,user_id:user,role:'owner',tenant_status:'active',features:flags};
 const pool={query:async(sql,args)=>{
  if(sql.includes('FROM channels ch')){assert.deepEqual(args,[tenant,channel,user]);return {rowCount:1,rows:[{phone:'5515999999999',account_id:'act_1234567890'}]};}
  if(sql.startsWith('INSERT INTO wa_tracking_links')){assert.equal(args[1],tenant);return {rowCount:1};}
  if(sql.includes('SELECT l.id,l.label,l.account_id')){assert.deepEqual(args,[tenant]);return {rows:[]};}
  if(sql.startsWith('UPDATE wa_tracking_links')){assert.deepEqual(args,[tenant,args[1]]);return {rowCount:1,rows:[{id:args[1],active:false}]};}
  throw Error('Unexpected SQL');
 }};
 const result=await createTrackingLink(pool,a,{channelId:channel,label:'Promo local',adId:'1234567890'});
 assert.equal(result.accountId,'act_1234567890');
 assert.equal(result.confidence,'indicative');
 assert.equal((await listTrackingLinks(pool,a)).links.length,0);
 assert.equal((await deactivateTrackingLink(pool,a,result.id)).active,false);
 await assert.rejects(createTrackingLink(pool,{...a,features:{...flags,whatsapp:false}},{channelId:channel,label:'Teste'}),e=>e.status===403);
 await assert.rejects(createTrackingLink(pool,{...a,role:'agent'},{channelId:channel,label:'Teste'}),e=>e.status===403);
});

test('real PostgreSQL: attribution only for tenant-bound inbound messages, first touch and no sales fabrication',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_attribution_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const t1=id(),t2=id(),u1=id(),u2=id(),c1=id(),c2=id();
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Empresa A',$2),($3,'Empresa B',$4)",[t1,'attr-a-'+t1.slice(0,8),t2,'attr-b-'+t2.slice(0,8)]);
  await db.query("INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,'A','test','owner'),($4,$5,$6,'B','test','owner')",
   [u1,t1,'attr-a-'+u1+'@example.test',u2,t2,'attr-b-'+u2+'@example.test']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
   "($1,$2,'Atendimento','5515999999999','waakg','connected'),($3,$4,'Atendimento','5515888888888','waakg','connected')",[c1,t1,c2,t2]);
  await db.query("INSERT INTO meta_official_grants(tenant_id,user_id,meta_user_id,token_encrypted,scopes,expires_at) VALUES "+
   "($1,$2,'101','fake-encrypted','{ads_read}',now()+interval '2 days'),($3,$4,'102','fake-encrypted','{ads_read}',now()+interval '2 days')",[t1,u1,t2,u2]);
  await db.query("INSERT INTO meta_official_account_selections(tenant_id,user_id,account_id,account_name) VALUES "+
   "($1,$2,'act_1111111111','Conta A'),($3,$4,'act_2222222222','Conta B')",[t1,u1,t2,u2]);
  const ownerA={active_tenant_id:t1,user_id:u1,role:'owner',tenant_status:'trial',features:flags};
  const ownerB={active_tenant_id:t2,user_id:u2,role:'owner',tenant_status:'trial',features:flags};
  const a=await createTrackingLink(db,ownerA,{channelId:c1,label:'Sorocaba',campaignId:'1234567',adId:'12345678'});
  const b=await createTrackingLink(db,ownerB,{channelId:c2,label:'Outra empresa'});
  assert.notEqual(a.code,b.code);
  const convA=id(),convB=id(),otherA=id(),messageA=id(),messageB=id(),wrong=id(),outbound=id();
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES "+
   "($1,$2,$3,'5515111111111'),($4,$5,$6,'5515222222222'),($7,$2,$3,'5515333333333')",
   [convA,t1,c1,convB,t2,c2,otherA]);
  await db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES "+
   "($1,$2,$3,'inbound',$4),($5,$6,$7,'inbound',$8),($9,$2,$10,'inbound',$11),($12,$2,$10,'outbound',$13)",
   [messageA,t1,convA,'Tenho interesse ['+a.code+']',messageB,t2,convB,'Olá ['+b.code+']',
    wrong,otherA,'Código de outro comércio ['+b.code+']',outbound,'Só divulgando ['+a.code+']']);
  assert.equal((await scanTrackingAttribution(db)).attributed,2);
  assert.equal((await scanTrackingAttribution(db)).attributed,0);
  const ar=(await trackingReport(db,ownerA)).items;
  const br=(await trackingReport(db,ownerB)).items;
  assert.equal(ar.length,1);assert.equal(br.length,1);
  assert.equal(ar[0].conversations,1);assert.equal(br[0].conversations,1);
  assert.equal(ar[0].quote_requests,0);assert.equal(ar[0].purchase_intents,0);
  const quoteId=id(),intentId=id();
  await db.query("INSERT INTO quote_requests(id,tenant_id,conversation_id,inbound_message_id,summary) VALUES($1,$2,$3,$4,'Solicitação real')",
   [quoteId,t1,convA,messageA]);
  await db.query("INSERT INTO sale_intents(id,tenant_id,conversation_id,inbound_message_id,summary) VALUES($1,$2,$3,$4,'Cliente demonstrou interesse')",
   [intentId,t1,convA,messageA]);
  let updated=(await trackingReport(db,ownerA)).items[0];
  assert.equal(updated.quote_requests,1);assert.equal(updated.purchase_intents,1);
  // A quote from before the tracked message must not be attributed to this link.
  await db.query("UPDATE quote_requests SET created_at=(SELECT created_at FROM messages WHERE id=$1)-interval '1 hour' WHERE id=$2",
   [messageA,quoteId]);
  updated=(await trackingReport(db,ownerA)).items[0];
  assert.equal(updated.quote_requests,0);assert.equal(updated.purchase_intents,1);

  // Only provider-confirmed outbound responses count as business replies.
  const replyId=id(),customerFollowUp=id(),unverifiedNote=id();
  await db.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) VALUES "+
   "($1,$2,$3,'outbound','Resposta confirmada pelo gateway',$4,(SELECT created_at+interval '2 minutes' FROM messages WHERE id=$5))",
   [replyId,t1,convA,'waakg:confirmed-'+replyId,messageA]);
  await db.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) VALUES "+
   "($1,$2,$3,'inbound','Quero ver o preço',$4,(SELECT created_at+interval '3 minutes' FROM messages WHERE id=$5))",
   [customerFollowUp,t1,convA,'waakg:follow-'+customerFollowUp,messageA]);
  await db.query(
   "INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES "+
   "($1,$2,$3,'outbound','Rascunho local sem confirmação do gateway',(SELECT created_at+interval '1 minute' FROM messages WHERE id=$4))",
   [unverifiedNote,t1,convA,messageA]);
  const approvedQuote=id(),approvedOrder=id(),pendingQuote=id(),pendingOrder=id();
  await db.query("INSERT INTO sales_quotes(id,tenant_id,conversation_id,series_id,version,status,amount_cents,items) VALUES "+
   "($1,$2,$3,$4,1,'accepted',3800,'[]'::jsonb),($5,$2,$3,$6,1,'accepted',1000,'[]'::jsonb)",
   [approvedQuote,t1,convA,id(),pendingQuote,id()]);
  await db.query("INSERT INTO sales_orders(id,tenant_id,quote_id,conversation_id,customer_name,amount_cents,items,status,payment_provider,created_at,paid_at) VALUES "+
   "($1,$2,$3,$4,'Cliente',3800,'[]'::jsonb,'paid_test','stripe_test',"+
   "(SELECT created_at+interval '3 minutes' FROM messages WHERE id=$5),"+
   "(SELECT created_at+interval '4 minutes' FROM messages WHERE id=$5))",
   [approvedOrder,t1,approvedQuote,convA,messageA]);
  await db.query("INSERT INTO sales_orders(id,tenant_id,quote_id,conversation_id,customer_name,amount_cents,items,status,created_at) VALUES "+
   "($1,$2,$3,$4,'Cliente',1000,'[]'::jsonb,'pending_payment',"+
   "(SELECT created_at+interval '5 minutes' FROM messages WHERE id=$5))",
   [pendingOrder,t1,pendingQuote,convA,messageA]);
  const funnelA=await readWhatsAppFunnel(db,ownerA),funnelB=await readWhatsAppFunnel(db,ownerB);
  assert.equal(funnelA.items.length,1);assert.equal(funnelB.items.length,1);
  assert.equal(funnelA.items[0].conversations,1);
  assert.equal(funnelA.items[0].businessResponded,1);
  assert.equal(funnelA.items[0].customerFollowedUp,1);
  assert.equal(funnelA.items[0].averageFirstBusinessReplySeconds,120);
  assert.equal(funnelA.items[0].quoteRequests,0,'pre-attribution quotes excluded');
  assert.equal(funnelA.items[0].purchaseIntents,1);
  assert.equal(funnelA.items[0].ordersCreated,2);
  assert.equal(funnelA.items[0].sandboxPaidOrders,1);
  assert.equal(funnelA.items[0].sandboxRevenueCents,'3800');
  assert.equal(funnelA.items[0].livePaidOrders,null);
  assert.equal(funnelA.items[0].liveRevenueCents,null);
  assert.equal(funnelB.items[0].businessResponded,0);
  assert.equal(funnelB.items[0].sandboxPaidOrders,0);
  assert.equal(funnelB.items[0].sandboxRevenueCents,'0');

  assert.equal((await listTrackingLinks(db,ownerB)).links[0].accountId,'act_2222222222');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM wa_lead_attributions')).rows[0].n,2);
  await assert.rejects(deactivateTrackingLink(db,ownerB,a.id),e=>e.status===404);
  assert.equal((await deactivateTrackingLink(db,ownerA,a.id)).active,false);
  assert.equal((await scanTrackingAttribution(db)).attributed,0);
 }finally{await db.end().catch(()=>{});await root.query('DROP SCHEMA '+schema+' CASCADE').catch(()=>{});await root.end();}
});
