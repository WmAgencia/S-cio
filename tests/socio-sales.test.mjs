import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {detectSaleCandidate,parseAmount,money,parseSaleAnswer,parseSaleButton,
 saleQuestionText,saleAnswerText,recordSaleCandidate,markSaleNotified,latestPendingSale,
 pendingSaleSummary,confirmSale,rejectSale,createManualSale,listSales} from '../socio-sales.mjs';

const id=()=>randomUUID();

// Money in Brazilian format, tolerating the non-breaking space Intl uses.
const brl=cents=>money(cents).replace(/\s/g,' ');

test('amount parsing accepts what a customer actually types',()=>{
 assert.equal(parseAmount('R$ 50,00'),5000);
 assert.equal(parseAmount('r$50'),5000);
 assert.equal(parseAmount('50,00'),5000);
 assert.equal(parseAmount('1.500'),150000);
 assert.equal(parseAmount('R$ 1.234,56'),123456);
 assert.equal(parseAmount('R$ 1234,56'),123456);
 assert.equal(parseAmount('1234,56'),123456);
 assert.equal(parseAmount('R$ 12.50'),1250);
 assert.equal(parseAmount('1500'),150000);
 assert.equal(parseAmount('R$ -50,00'),null);
 assert.equal(parseAmount('pix de 89,90'),8990);
 assert.equal(parseAmount('recebi 120 reais'),12000);
 assert.equal(parseAmount('120 real'),12000);
 assert.equal(parseAmount('0'),null);
 assert.equal(parseAmount('comprovante enviado'),null);
 assert.equal(parseAmount(''),null);
 assert.equal(parseAmount(null),null);
});

test('money formats in Brazilian currency',()=>{
 assert.equal(brl(5000),'R$ 50,00');
 assert.equal(brl(123456),'R$ 1.234,56');
 assert.equal(brl(null),'R$ 0,00');
});

test('receipt detection separates a sale signal from ordinary conversation',()=>{
 const text=detectSaleCandidate({body:'Segue o comprovante do pix de R$ 50,00'});
 assert.equal(text.evidenceKind,'text');
 assert.equal(text.amountCents,5000);
 assert.match(text.evidenceExcerpt,/comprovante/i);
 const image=detectSaleCandidate({mediaType:'image'});
 assert.equal(image.evidenceKind,'image');
 assert.equal(image.amountCents,null);
 assert.match(image.evidenceExcerpt,/\[imagem\]/);
 const document=detectSaleCandidate({mediaType:'document',fileName:'comprovante.pdf'});
 assert.equal(document.evidenceKind,'document');
 assert.match(document.evidenceExcerpt,/\[documento\] comprovante\.pdf/);
 const captioned=detectSaleCandidate({mediaType:'image',caption:'paguei 35,00'});
 assert.equal(captioned.amountCents,3500);
 assert.equal(detectSaleCandidate({body:'Oi, tudo bem?'}),null);
 assert.equal(detectSaleCandidate({}),null);
});

test('owner answers map to confirm, reject or an explicit amount',()=>{
 assert.deepEqual(parseSaleAnswer('Sim'),{kind:'confirm',cents:null});
 assert.deepEqual(parseSaleAnswer('sim, 50'),{kind:'confirm',cents:5000});
 assert.deepEqual(parseSaleAnswer('50'),{kind:'confirm',cents:5000});
 assert.deepEqual(parseSaleAnswer('R$ 89,90'),{kind:'confirm',cents:8990});
 assert.deepEqual(parseSaleAnswer('pode contar como venda'),{kind:'confirm',cents:null});
 assert.deepEqual(parseSaleAnswer('Não'),{kind:'reject'});
 assert.deepEqual(parseSaleAnswer('não foi venda'),{kind:'reject'});
 assert.deepEqual(parseSaleAnswer('descarta'),{kind:'reject'});
 assert.equal(parseSaleAnswer('qualquer coisa'),null);
 assert.equal(parseSaleAnswer(''),null);
});

test('sale buttons are read from the interactive reply text',()=>{
 const saleId=id();
 assert.deepEqual(parseSaleButton('[Interactive Response] socio:sale:confirm:'+saleId),
  {kind:'confirm',id:saleId});
 assert.deepEqual(parseSaleButton('[Button Response] socio:sale:reject:'+saleId),
  {kind:'reject',id:saleId});
 assert.equal(parseSaleButton('socio:sale:confirm:'+saleId),null);
 assert.equal(parseSaleButton('sim'),null);
});

test('question and answer texts carry the value and the origin',()=>{
 const question=saleQuestionText({amountCents:5000},{customerName:'Maria',customerPhone:'5515'});
 assert.match(question,/Maria/);
 assert.match(question,/50,00/);
 assert.match(question,/SIM/);
 const blank=saleQuestionText({amountCents:null},{customerPhone:'5515999'});
 assert.match(blank,/5515999/);
 assert.match(blank,/SIM e o valor/);
 const confirmed=saleAnswerText({amountCents:5000,campaignName:'Campanha A'},{kind:'confirm'});
 assert.match(confirmed,/50,00/);
 assert.match(confirmed,/Campanha A/);
 const organic=saleAnswerText({amountCents:5000},{kind:'confirm'});
 assert.match(organic,/Sem atribuição de anúncio/);
 assert.match(saleAnswerText(null,{kind:'reject'}),/não vou contar/);
});

test('real PostgreSQL: sale lifecycle from receipt to confirmed revenue',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_sales_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t1,t2]=[id(),id()];
  const [c1,c2]=[id(),id()];
  const [cv1,cv2,cv3,cv4,cv5]=Array.from({length:5},id);
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'A',$2),($3,'B',$4)",
   [t1,'sales-a-'+t1.slice(0,8),t2,'sales-b-'+t2.slice(0,8)]);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
   "($1,$2,'A','5515800000001','waakg','connected'),($3,$4,'B','5515800000002','waakg','connected')",
   [c1,t1,c2,t2]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) VALUES "+
   "($1,$2,$3,'Maria','5515811111111'),($4,$5,$6,'João','5515822222222'),"+
   "($7,$2,$3,'Ana','5515833333333'),($8,$2,$3,'Bia','5515844444444'),($9,$5,$6,'Caio','5515855555555')",
   [cv1,t1,c1,cv2,t2,c2,cv3,cv4,cv5]);
  // A CTWA arrival already resolved earlier to campaign, adset and ad names.
  await db.query("INSERT INTO wa_ctwa_attributions(id,tenant_id,channel_id,conversation_id,"+
   "inbound_message_id,source_id,source_type,ctwa_clid,occurred_at,campaign_id,campaign_name,"+
   "adset_id,adset_name,ad_name) VALUES($1,$2,$3,$4,'wamid.sales.ctwa','1200000000201','ad',"+
   "'clid-sales',now()-interval '1 hour','777','Campanha Boa','888','Conjunto B','Anúncio Campeão')",
   [id(),t1,c1,cv1]);

  // Candidate: created once, replayed webhooks never duplicate it.
  const receipt={evidenceKind:'text',evidenceExcerpt:'Segue o comprovante do pix de R$ 50,00',
   amountCents:5000};
  const first=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv1,
   inboundMessageId:'wamid.sales.one',evidence:receipt});
  assert.equal(first.created,true);
  assert.equal(first.sale.status,'pending');
  assert.equal(first.sale.originSource,'ctwa');
  assert.equal(first.sale.campaignName,'Campanha Boa');
  assert.equal(first.sale.adsetName,'Conjunto B');
  assert.equal(first.sale.adName,'Anúncio Campeão');
  assert.equal(first.sale.adId,'1200000000201');
  assert.equal(first.sale.amountCents,5000);
  const replay=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv1,
   inboundMessageId:'wamid.sales.one',evidence:receipt});
  assert.equal(replay.created,false);
  assert.equal(replay.sale.id,first.sale.id);

  // The same customer sending a second receipt for the same value stays one question.
  const merged=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv1,
   inboundMessageId:'wamid.sales.two',
   evidence:{evidenceKind:'image',evidenceExcerpt:'[imagem] comprovante',amountCents:5000}});
  assert.equal(merged.created,false);
  assert.equal(merged.merged,true);
  assert.equal(merged.sale.id,first.sale.id);

  // A different value is a second sale, not a duplicate.
  const second=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv1,
   inboundMessageId:'wamid.sales.three',
   evidence:{evidenceKind:'image',evidenceExcerpt:'[imagem] comprovante',amountCents:8000}});
  assert.equal(second.created,true);
  assert.notEqual(second.sale.id,first.sale.id);

  // The owner is asked; only notified sales count as pending questions.
  assert.equal((await pendingSaleSummary(db,t1)).total,0);
  await markSaleNotified(db,t1,first.sale.id);
  await markSaleNotified(db,t1,second.sale.id);
  const latest=await latestPendingSale(db,t1);
  assert.equal(latest.id,second.sale.id);
  assert.equal(latest.customerName,'Maria');
  assert.equal(latest.customerPhone,'5515811111111');
  const summary=await pendingSaleSummary(db,t1);
  assert.equal(summary.total,2);
  assert.equal(summary.amountCents,13000);

  // Confirmation uses the value the receipt already carried.
  const confirmed=await confirmSale(db,{tenantId:t1,id:first.sale.id,amountCents:5000,by:'whatsapp'});
  assert.equal(confirmed.ok,true);
  assert.equal(confirmed.sale.status,'confirmed');
  assert.equal(confirmed.sale.amountCents,5000);
  assert.equal(confirmed.sale.confirmedAt instanceof Date,true);
  assert.equal((await confirmSale(db,{tenantId:t1,id:first.sale.id,amountCents:6000})).reason,'resolved');
  const rejected=await rejectSale(db,{tenantId:t1,id:second.sale.id,by:'whatsapp'});
  assert.equal(rejected.ok,true);
  assert.equal(rejected.sale.status,'rejected');
  assert.equal((await rejectSale(db,{tenantId:t1,id:second.sale.id})).reason,'not_pending');
  assert.equal((await confirmSale(db,{tenantId:t1,id:id()})).reason,'not_found');
  assert.equal((await confirmSale(db,{tenantId:t2,id:first.sale.id})).reason,'not_found');

  // After a rejection, media in the same conversation is not asked again for a day;
  // a text receipt still is, because words are explicit evidence.
  const quietImage=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv1,
   inboundMessageId:'wamid.sales.four',evidence:{evidenceKind:'image',evidenceExcerpt:'[imagem]',
    amountCents:null}});
  assert.equal(quietImage.created,false);
  assert.equal(quietImage.suppressed,true);
  const loudText=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv1,
   inboundMessageId:'wamid.sales.five',
   evidence:{evidenceKind:'text',evidenceExcerpt:'paguei outra venda',amountCents:null}});
  assert.equal(loudText.created,true);
  assert.equal(loudText.sale.status,'pending');

  // A receipt without a value waits for the owner to say how much it was.
  assert.equal((await confirmSale(db,{tenantId:t1,id:loudText.sale.id})).reason,'amount_required');
  assert.equal((await confirmSale(db,{tenantId:t1,id:loudText.sale.id,amountCents:25.5})).reason,'amount_required');
  const withValue=await confirmSale(db,{tenantId:t1,id:loudText.sale.id,amountCents:2500,
   by:'whatsapp'});
  assert.equal(withValue.ok,true);
  assert.equal(withValue.sale.amountCents,2500);
  assert.equal((await pendingSaleSummary(db,t1)).total,0);

  // Origin from a tracking link, and honest "organic" when nothing attributes it.
  const linkId=id();
  await db.query("INSERT INTO wa_tracking_links(id,tenant_id,channel_id,account_id,label,"+
   "campaign_id,adset_id,ad_id,code,expires_at) VALUES($1,$2,$3,'act_123456','Link do post',"+
   "'4444','1010','2020','SC0123456789ABCDEF0123',now()+interval '30 days')",[linkId,t1,c1]);
  const msgId=id();
  await db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) "+
   "VALUES($1,$2,$3,'inbound','vi no post')",[msgId,t1,cv3]);
  await db.query("INSERT INTO wa_lead_attributions(id,tenant_id,conversation_id,inbound_message_id,"+
   "link_id,method,confidence) VALUES($1,$2,$3,$4,$5,'message_code','indicative')",
   [id(),t1,cv3,msgId,linkId]);
  const fromLink=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv3,
   inboundMessageId:'wamid.sales.six',
   evidence:{evidenceKind:'text',evidenceExcerpt:'paguei, segue recibo',amountCents:7000}});
  assert.equal(fromLink.sale.originSource,'link');
  assert.equal(fromLink.sale.campaignId,'4444');
  assert.equal(fromLink.sale.adsetId,'1010');
  assert.equal(fromLink.sale.adId,'2020');
  const organic=await recordSaleCandidate(db,{tenantId:t1,conversationId:cv4,
   inboundMessageId:'wamid.sales.seven',
   evidence:{evidenceKind:'text',evidenceExcerpt:'fiz o pix',amountCents:3000}});
  assert.equal(organic.sale.originSource,'organic');
  assert.equal(organic.sale.campaignId,null);

  // Manual registration applies the conversation origin and is confirmed at once.
  assert.equal((await createManualSale(db,{tenantId:t1,amountCents:0})).reason,'amount_required');
  assert.equal((await createManualSale(db,{tenantId:t1,amountCents:10.5})).reason,'amount_required');
  assert.equal((await createManualSale(db,{tenantId:t1,amountCents:100,conversationId:id()}))
   .reason,'conversation_not_found');
  assert.equal((await createManualSale(db,{tenantId:t1,amountCents:100,conversationId:cv2}))
   .reason,'conversation_not_found');
  const manual=await createManualSale(db,{tenantId:t1,amountCents:15000,conversationId:cv1,
   createdBy:'user-1'});
  assert.equal(manual.ok,true);
  assert.equal(manual.sale.status,'confirmed');
  assert.equal(manual.sale.amountCents,15000);
  assert.equal(manual.sale.evidenceKind,'manual');
  assert.equal(manual.sale.originSource,'ctwa');
  assert.equal(manual.sale.campaignName,'Campanha Boa');

  // Listing is tenant-scoped and filters by status.
  const confirmedList=await listSales(db,t1,{days:30,status:'confirmed'});
  assert.equal(confirmedList.length,3);
  assert.equal(confirmedList.every(sale=>sale.status==='confirmed'),true);
  const pendingList=await listSales(db,t1,{days:30,status:'pending'});
  assert.equal(pendingList.length,2);
  assert.equal(pendingList.some(sale=>sale.customerName==='Ana'),true);
  assert.equal((await listSales(db,t1,{days:30})).length,6);
  assert.equal((await listSales(db,t2,{days:30})).length,0);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
