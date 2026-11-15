import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {salesSummary} from '../socio-sales-summary.mjs';

const id=()=>randomUUID();

test('an invalid reference date is rejected',async()=>{
 await assert.rejects(()=>salesSummary({query(){}},id(),{now:new Date('not a date')}),
  error=>error.status===422&&/Data de referência inválida/.test(error.message));
});

test('real PostgreSQL: revenue follows the São Paulo calendar and only confirmed sales',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_sales_summary_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t,t2,t3]=[id(),id(),id()];
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Resumo',$2),($3,'Outro',$4),($5,'Novo',$6)",
   [t,'sales-summary-'+t.slice(0,8),t2,'sales-summary-'+t2.slice(0,8),t3,'sales-summary-'+t3.slice(0,8)]);
  const at=s=>new Date(s);
  const add=async({cents,confirmedAt=null,status='confirmed',campaignId=null,
   campaignName=null,tenantId=t,notifiedAt=null})=>{
   await db.query('INSERT INTO socio_sales(id,tenant_id,evidence_kind,evidence_excerpt,'+
    'amount_cents,status,source,origin_source,origin_campaign_id,origin_campaign_name,'+
    'confirmed_at,notified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [id(),tenantId,'manual','fixture',cents,status,'manual',
     campaignId?'ctwa':'organic',campaignId,campaignName,confirmedAt,notifiedAt]);
  };
  // Saturday 2026-11-14 15:00 in São Paulo.
  const now=at('2026-11-14T15:00:00-03:00');
  await add({cents:10000,confirmedAt:at('2026-11-14T13:00:00-03:00'),
   campaignId:'111',campaignName:'Campanha Boa'});
  await add({cents:2000,confirmedAt:at('2026-11-14T09:00:00-03:00')});
  await add({cents:5000,confirmedAt:at('2026-11-13T10:00:00-03:00'),
   campaignId:'111',campaignName:'Campanha Boa'});
  await add({cents:30000,confirmedAt:at('2026-11-11T15:00:00-03:00'),
   campaignId:'222',campaignName:'Campanha Nova'});
  await add({cents:50000,confirmedAt:at('2026-10-05T12:00:00-03:00'),
   campaignId:'111',campaignName:'Campanha Boa'});
  await add({cents:20000,confirmedAt:at('2026-11-14T10:00:00-03:00'),status:'rejected'});
  await add({cents:99900,confirmedAt:at('2026-11-14T13:00:00-03:00'),tenantId:t2});
  await add({cents:7000,status:'pending',notifiedAt:at('2026-11-14T08:00:00-03:00')});
  await add({cents:9000,status:'pending'});

  const summary=await salesSummary(db,t,{now});
  assert.equal(summary.currency,'BRL');
  assert.equal(summary.timeZone,'America/Sao_Paulo');
  assert.equal(summary.generatedAt,now.toISOString());

  assert.deepEqual(summary.windows.today,{sales:2,revenueCents:12000,
   averageTicketCents:6000,previousSales:1,previousRevenueCents:5000,changePct:140});
  assert.equal(summary.windows.week.sales,4);
  assert.equal(summary.windows.week.revenueCents,47000);
  assert.equal(summary.windows.week.previousSales,0);
  assert.equal(summary.windows.week.previousRevenueCents,0);
  assert.equal(summary.windows.week.changePct,null);
  assert.equal(summary.windows.month.sales,4);
  assert.equal(summary.windows.month.revenueCents,47000);
  assert.equal(summary.windows.month.averageTicketCents,11750);
  // Same days last month up to the same clock time (01/10 00:00 - 14/10 15:00),
  // so the 05/10 sale is the comparison base.
  assert.equal(summary.windows.month.previousSales,1);
  assert.equal(summary.windows.month.previousRevenueCents,50000);
  assert.equal(summary.windows.month.changePct,-6);

  assert.equal(summary.pending.total,1);
  assert.equal(summary.pending.amountCents,7000);
  assert.equal(summary.everConfirmedSales,true);

  assert.equal(summary.series.length,30);
  assert.equal(summary.series[0].date,'2026-10-16');
  assert.equal(summary.series[29].date,'2026-11-14');
  assert.equal(summary.series[29].revenueCents,12000);
  assert.equal(summary.series[29].sales,2);
  assert.equal(summary.series[28].date,'2026-11-13');
  assert.equal(summary.series[28].revenueCents,5000);
  assert.equal(summary.series[0].revenueCents,0);

  assert.deepEqual(summary.topCampaigns.map(c=>[c.campaignId,c.sales,c.revenueCents]),
   [['222',1,30000],['111',2,15000]]);
  assert.equal(summary.topCampaigns[1].campaignName,'Campanha Boa');

  // Six São Paulo calendar months, oldest first, the current one last.
  assert.equal(summary.months.length,6);
  assert.deepEqual(summary.months.map(m=>m.month),
   ['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11']);
  assert.equal(summary.months[0].month,'2026-06');
  assert.deepEqual(summary.months[5],{month:'2026-11',sales:4,revenueCents:47000});
  assert.deepEqual(summary.months[4],{month:'2026-10',sales:1,revenueCents:50000});
  for(const item of summary.months.slice(0,4)){
   assert.equal(item.sales,0);
   assert.equal(item.revenueCents,0);
  }

  const narrow=await salesSummary(db,t,{now,seriesDays:7});
  assert.equal(narrow.series.length,7);
  assert.equal(narrow.series[6].date,'2026-11-14');
  assert.equal((await salesSummary(db,t,{now,seriesDays:1})).series.length,7);

  const other=await salesSummary(db,t2,{now});
  assert.equal(other.windows.today.revenueCents,99900);
  assert.equal(other.windows.today.previousRevenueCents,0);
  assert.equal(other.months.length,6);
  assert.equal(other.months[5].month,'2026-11');
  assert.equal(other.months[5].sales,1);
  assert.equal(other.months[5].revenueCents,99900);
  assert.equal((await salesSummary(db,t3,{now})).everConfirmedSales,false);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
