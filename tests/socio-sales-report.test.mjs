import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {salesPerformance,formatSalesSection} from '../socio-sales-report.mjs';

const id=()=>randomUUID();
const day=86400000;
const plain=text=>String(text).replace(/\s/g,' ');

test('the section compares campaigns and names the ad that sold',()=>{
 const performance={windowDays:7,totalSales:3,revenueCents:160000,
  unattributedSales:1,unattributedRevenueCents:10000,
  campaigns:[{campaignId:'111',campaignName:'Campanha Boa',sales:2,revenueCents:120000},
   {campaignId:'222',campaignName:'Campanha Fraca',sales:1,revenueCents:40000}],
  ads:[{adId:'20',adName:'Anúncio Campeão',campaignId:'111',sales:2,revenueCents:120000},
   {adId:'21',adName:'Anúncio Caro',campaignId:'111',sales:1,revenueCents:200000}]};
 const raw=formatSalesSection(performance,{
  campaignInsights:[{campaign_id:'111',spend:'300.00'},{campaign_id:'999',spend:'10.00'}],
  adInsights:[{ad_id:'20',spend:'150.00'}]});
 const text=plain(raw);
 assert.match(text,/Vendas confirmadas \(últimos 7 dias\): 3 venda\(s\), R\$ 1\.600,00 de receita\./);
 assert.match(text,/• Campanha Boa: 2 venda\(s\), R\$ 1\.200,00, R\$ 300,00 de anúncio, custo por venda R\$ 150,00, retorno 4,0x/);
 assert.match(text,/• Campanha Fraca: 1 venda\(s\), R\$ 400,00/);
 assert.doesNotMatch(raw,/Campanha Fraca[^\n]*anúncio/);
 assert.match(text,/Anúncio com mais vendas: Anúncio Campeão — 2 venda\(s\), R\$ 1\.200,00 \(retorno 8,0x\)/);
 assert.doesNotMatch(text,/Anúncio Caro/);
 assert.match(text,/Sem atribuição de anúncio: 1 venda\(s\), R\$ 100,00\./);
 // Only the campaign with confirmed revenue and a reported spend gets a return.
 assert.doesNotMatch(text,/Campanha 999|Campanha 111/);
 assert.equal(formatSalesSection({...performance,totalSales:0}),'');
 assert.equal(formatSalesSection(null),'');
 assert.equal(formatSalesSection(performance,{max:1,}).includes('Campanha Fraca'),false);
});

test('real PostgreSQL: revenue comes only from confirmed sales, by campaign and by ad',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_sales_report_test_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,
  options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const [t,t2]=[id(),id()];
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Relatório',$2),($3,'Outro',$4)",
   [t,'sales-report-'+t.slice(0,8),t2,'sales-report-'+t2.slice(0,8)]);
  const addSale=async({cents,status='confirmed',confirmedAt=new Date(Date.now()-3600000),
   campaignId=null,campaignName=null,adId=null,adName=null,tenantId=t,
   originSource='ctwa'})=>{
   await db.query("INSERT INTO socio_sales(id,tenant_id,evidence_kind,evidence_excerpt,"+
    "amount_cents,status,source,origin_source,origin_campaign_id,origin_campaign_name,"+
    "origin_ad_id,origin_ad_name,confirmed_at) "+
    "VALUES($1,$2,'manual','fixture',$3,$4,'manual',$5,$6,$7,$8,$9,$10)",
    [id(),tenantId,cents,status,originSource,campaignId,campaignName,adId,adName,
     status==='confirmed'?confirmedAt:null]);
  };
  await addSale({cents:30000,campaignId:'111',campaignName:'Campanha Boa',adId:'20',
   adName:'Anúncio Campeão'});
  await addSale({cents:30000,campaignId:'111',campaignName:'Campanha Boa',adId:'20',
   adName:'Anúncio Campeão'});
  await addSale({cents:20000,campaignId:'111',campaignName:'Campanha Boa',adId:'21',
   adName:'Anúncio B'});
  await addSale({cents:40000,campaignId:'222',campaignName:'Campanha Nova',adId:'30',
   adName:'Anúncio C'});
  await addSale({cents:10000,originSource:'organic'});
  await addSale({cents:90000,campaignId:'111',campaignName:'Campanha Boa',status:'rejected'});
  await addSale({cents:70000,campaignId:'111',campaignName:'Campanha Boa',
   confirmedAt:new Date(Date.now()-10*day)});
  await addSale({cents:50000,campaignId:'111',campaignName:'Campanha Boa',tenantId:t2});

  const week=await salesPerformance(db,t);
  assert.equal(week.windowDays,7);
  assert.equal(week.totalSales,5);
  assert.equal(week.revenueCents,130000);
  assert.equal(week.unattributedSales,1);
  assert.equal(week.unattributedRevenueCents,10000);
  assert.equal(week.everConfirmedSales,true);
  assert.equal((await salesPerformance(db,id())).everConfirmedSales,false);
  assert.deepEqual(week.campaigns.map(c=>[c.campaignId,c.sales,c.revenueCents]),
   [['111',3,80000],['222',1,40000]]);
  assert.equal(week.campaigns[0].campaignName,'Campanha Boa');
  assert.deepEqual(week.ads.map(a=>[a.adId,a.sales,a.revenueCents]),
   [['20',2,60000],['30',1,40000],['21',1,20000]]);
  assert.equal(week.ads[1].campaignId,'222');

  const text=plain(formatSalesSection(week,{
   campaignInsights:[{campaign_id:'111',spend:'600.00'}],
   adInsights:[{ad_id:'20',spend:'400.00'}]}));
  assert.match(text,/Campanha Boa: 3 venda\(s\), R\$ 800,00, R\$ 600,00 de anúncio, custo por venda R\$ 200,00, retorno 1,3x/);
  assert.match(text,/Anúncio com mais vendas: Anúncio Campeão — 2 venda\(s\), R\$ 600,00 \(retorno 1,5x\)/);

  // A wider window includes the older confirmation but still never the rejection.
  const month=await salesPerformance(db,t,{days:30});
  assert.equal(month.totalSales,6);
  assert.equal(month.revenueCents,200000);
  assert.equal(month.campaigns[0].campaignId,'111');
  assert.equal(month.campaigns[0].sales,4);
  assert.equal((await salesPerformance(db,t2)).totalSales,1);
 }finally{
  await db.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();
 }
});
