import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {periodSummary,resolvePeriod} from '../socio-period-summary.mjs';

const id=()=>randomUUID();
const at=(text)=>new Date(text);

test('presets resolve on the São Paulo calendar with a same-length comparison window',
 {timeout:10000},()=>{
 const saturday=at('2026-11-14T15:00:00-03:00');
 assert.deepEqual(resolvePeriod({preset:'today',now:saturday}),
  {preset:'today',from:'2026-11-14',to:'2026-11-14',days:1,
   toExclusive:'2026-11-15',previousFrom:'2026-11-13',previousTo:'2026-11-13'});
 assert.deepEqual(resolvePeriod({preset:'7d',now:saturday}),
  {preset:'7d',from:'2026-11-08',to:'2026-11-14',days:7,
   toExclusive:'2026-11-15',previousFrom:'2026-11-01',previousTo:'2026-11-07'});
 assert.deepEqual(resolvePeriod({preset:'month',now:saturday}),
  {preset:'month',from:'2026-11-01',to:'2026-11-14',days:14,
   toExclusive:'2026-11-15',previousFrom:'2026-10-18',previousTo:'2026-10-31'});
 assert.deepEqual(resolvePeriod({preset:'custom',from:'2026-11-10',to:'2026-11-12',now:saturday}),
  {preset:'custom',from:'2026-11-10',to:'2026-11-12',days:3,
   toExclusive:'2026-11-13',previousFrom:'2026-11-07',previousTo:'2026-11-09'});

 // 23:00 on Friday in São Paulo is already 02:00 on Saturday in UTC: the
 // board must still call it Friday.
 assert.equal(resolvePeriod({preset:'today',now:at('2026-11-14T02:00:00Z')}).from,'2026-11-13');
 assert.equal(resolvePeriod({preset:'today',now:at('2026-11-14T03:00:00Z')}).from,'2026-11-14');
});

test('a broken custom range is rejected with a readable reason',{timeout:10000},()=>{
 const now=at('2026-11-14T15:00:00-03:00');
 const throws=(args,status,pattern)=>assert.throws(()=>resolvePeriod({...args,now}),
  error=>error.status===status&&pattern.test(error.message));
 throws({preset:'custom',from:'2026-11-10',to:null},422,/Escolha as duas datas/);
 throws({preset:'custom',from:'2026-02-30',to:'2026-03-01'},422,/Escolha as duas datas/);
 throws({preset:'custom',from:'2026-11-12',to:'2026-11-10'},422,/antes da data final/);
 throws({preset:'custom',from:'2025-11-13',to:'2026-11-14'},422,/366 dias/);
 throws({preset:'year'},400,/Período inválido/);
 assert.throws(()=>resolvePeriod({preset:'today',now:new Date('not a date')}),
  error=>error.status===422&&/Data de referência inválida/.test(error.message));
});

test('real PostgreSQL: every tile answers inside the picked window',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_period_summary_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t,t2,t3]=[id(),id(),id()];
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Resumo',$2),($3,'Outro',$4),($5,'Novo',$6)",
   [t,'period-'+t.slice(0,8),t2,'period-'+t2.slice(0,8),t3,'period-'+t3.slice(0,8)]);
  const channel=async(tenantId)=>{
   const value=id();
   await db.query("INSERT INTO channels(id,tenant_id,label,phone) VALUES($1,$2,'WhatsApp',$3)",
    [value,tenantId,'55'+value.slice(0,10)]);
   return value;
  };
  const ch=await channel(t),ch2=await channel(t2),ch3=await channel(t3);
  const conversation=async({tenantId=t,channelId=ch,createdAt,lastMessageAt=createdAt,status='open'})=>{
   const value=id();
   await db.query('INSERT INTO conversations(id,tenant_id,channel_id,customer_phone,status,'+
    'created_at,last_message_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [value,tenantId,channelId,'55'+value.slice(0,10),status,createdAt,lastMessageAt]);
   return value;
  };
  const message=async({conversationId,tenantId=t,direction='inbound',createdAt})=>{
   await db.query('INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at)'+
    ' VALUES($1,$2,$3,$4,$5,$6)',[id(),tenantId,conversationId,direction,'fixture',createdAt]);
  };
  const sale=async({cents,confirmedAt=null,status='confirmed',tenantId=t,notifiedAt=null})=>{
   await db.query('INSERT INTO socio_sales(id,tenant_id,evidence_kind,evidence_excerpt,'+
    'amount_cents,status,source,origin_source,confirmed_at,notified_at)'+
    ' VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id(),tenantId,'manual','fixture',cents,status,'manual','organic',confirmedAt,notifiedAt]);
  };

  // Saturday 2026-11-14 15:00 in São Paulo.
  const now=at('2026-11-14T15:00:00-03:00');
  const a=await conversation({createdAt:at('2026-11-14T08:30:00-03:00'),
   lastMessageAt:at('2026-11-14T10:00:00-03:00')});
  const g=await conversation({createdAt:at('2026-11-14T12:00:00-03:00')});
  const b=await conversation({createdAt:at('2026-11-13T09:00:00-03:00'),
   lastMessageAt:at('2026-11-13T11:30:00-03:00'),status:'human'});
  const c=await conversation({createdAt:at('2026-11-08T00:00:00-03:00'),
   lastMessageAt:at('2026-11-08T00:30:00-03:00'),status:'resolved'});
  const d=await conversation({createdAt:at('2026-11-02T09:00:00-03:00'),
   lastMessageAt:at('2026-11-02T09:30:00-03:00'),status:'resolved'});
  await conversation({createdAt:at('2026-10-05T09:00:00-03:00'),
   lastMessageAt:at('2026-10-05T09:30:00-03:00'),status:'resolved'});
  const f=await conversation({tenantId:t2,channelId:ch2,createdAt:at('2026-11-14T09:00:00-03:00')});

  await message({conversationId:a,createdAt:at('2026-11-14T08:35:00-03:00')});
  await message({conversationId:a,createdAt:at('2026-11-14T09:30:00-03:00')});
  await message({conversationId:g,createdAt:at('2026-11-14T12:05:00-03:00')});
  await message({conversationId:a,direction:'outbound',createdAt:at('2026-11-14T10:00:00-03:00')});
  await message({conversationId:a,direction:'note',createdAt:at('2026-11-14T10:30:00-03:00')});
  await message({conversationId:b,createdAt:at('2026-11-13T11:00:00-03:00')});
  await message({conversationId:b,direction:'outbound',createdAt:at('2026-11-13T11:30:00-03:00')});
  await message({conversationId:b,createdAt:at('2026-11-12T00:00:00-03:00')});
  await message({conversationId:b,createdAt:at('2026-11-11T23:59:00-03:00')});
  // The first instant of the 7-day window is inside it.
  await message({conversationId:c,direction:'outbound',createdAt:at('2026-11-08T00:00:00-03:00')});
  await message({conversationId:d,createdAt:at('2026-11-01T23:30:00-03:00')});
  await message({conversationId:d,createdAt:at('2026-11-02T00:10:00-03:00')});
  await message({conversationId:f,tenantId:t2,createdAt:at('2026-11-14T09:10:00-03:00')});

  await sale({cents:10000,confirmedAt:at('2026-11-14T13:00:00-03:00')});
  await sale({cents:5000,confirmedAt:at('2026-11-13T10:00:00-03:00')});
  await sale({cents:30000,confirmedAt:at('2026-11-11T15:00:00-03:00')});
  await sale({cents:20000,confirmedAt:at('2026-11-14T10:00:00-03:00'),status:'rejected'});
  await sale({cents:7000,status:'pending',notifiedAt:at('2026-11-14T08:00:00-03:00')});
  await sale({cents:99900,confirmedAt:at('2026-11-14T09:00:00-03:00'),tenantId:t2});
  void ch3;

  const today=await periodSummary(db,t,{preset:'today',now});
  assert.equal(today.timeZone,'America/Sao_Paulo');
  assert.equal(today.generatedAt,now.toISOString());
  assert.deepEqual(today.period,{preset:'today',from:'2026-11-14',to:'2026-11-14',days:1,
   previousFrom:'2026-11-13',previousTo:'2026-11-13'});
  assert.deepEqual(today.messages,{inbound:3,outbound:1,total:4,
   previousInbound:1,previousOutbound:1});
  assert.deepEqual(today.conversations,{started:2,active:2,open:3,waiting:1,
   previousStarted:1});
  assert.deepEqual(today.sales,{confirmed:1,revenueCents:10000,averageTicketCents:10000,
   previousConfirmed:1,previousRevenueCents:5000});
  assert.equal(today.conversionPct,50);

  const week=await periodSummary(db,t,{preset:'7d',now});
  assert.equal(week.period.from,'2026-11-08');
  assert.deepEqual(week.messages,{inbound:6,outbound:3,total:9,
   previousInbound:2,previousOutbound:0});
  assert.deepEqual(week.conversations,{started:4,active:4,open:3,waiting:1,
   previousStarted:1});
  assert.equal(week.sales.confirmed,3);
  assert.equal(week.sales.revenueCents,45000);
  assert.equal(week.sales.averageTicketCents,15000);
  assert.equal(week.sales.previousRevenueCents,0);
  assert.equal(week.conversionPct,75);

  const month=await periodSummary(db,t,{preset:'month',now});
  assert.equal(month.period.from,'2026-11-01');
  assert.equal(month.messages.inbound,8);
  assert.equal(month.conversations.started,5);
  assert.equal(month.conversations.previousStarted,0);
  assert.equal(month.sales.revenueCents,45000);

  const custom=await periodSummary(db,t,{preset:'custom',from:'2026-11-10',to:'2026-11-11',now});
  assert.deepEqual(custom.period,{preset:'custom',from:'2026-11-10',to:'2026-11-11',days:2,
   previousFrom:'2026-11-08',previousTo:'2026-11-09'});
  assert.equal(custom.messages.inbound,1);
  assert.equal(custom.messages.outbound,0);
  assert.equal(custom.messages.previousOutbound,1);
  assert.equal(custom.conversations.started,0);
  assert.equal(custom.conversations.previousStarted,1);
  assert.equal(custom.sales.confirmed,1);
  assert.equal(custom.sales.revenueCents,30000);
  assert.equal(custom.conversionPct,null);

  const other=await periodSummary(db,t2,{preset:'today',now});
  assert.equal(other.messages.inbound,1);
  assert.equal(other.sales.revenueCents,99900);
  assert.equal(other.conversionPct,100);

  const empty=await periodSummary(db,t3,{preset:'7d',now});
  assert.equal(empty.messages.total,0);
  assert.equal(empty.conversations.open,0);
  assert.equal(empty.sales.confirmed,0);
  assert.equal(empty.sales.revenueCents,0);
  assert.equal(empty.sales.averageTicketCents,null);
  assert.equal(empty.conversionPct,null);

  // A role without marketing.read still sees messages and conversations; the
  // revenue half is simply absent instead of zeroed, so the board can say why.
  const noSales=await periodSummary(db,t,{preset:'7d',now,includeSales:false});
  assert.equal(noSales.sales,null);
  assert.equal(noSales.conversionPct,null);
  assert.equal(noSales.messages.total,9);

  // A database that predates the sales table keeps working for everything else.
  await db.query('DROP TABLE socio_sales CASCADE');
  const legacy=await periodSummary(db,t,{preset:'7d',now});
  assert.equal(legacy.sales,null);
  assert.equal(legacy.messages.total,9);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
