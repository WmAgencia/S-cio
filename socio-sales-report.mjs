// Answers what the owner actually asks: which campaign and which ad sold. Revenue
// comes only from a sale the owner confirmed; spend comes only from what the Meta
// API reported. A click is never treated as a sale, and an unattributed sale is
// shown as unattributed instead of guessed into a campaign.
const brl=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
 .format(Number(cents||0)/100);

const roas=(revenueCents,spendCents)=>{
 const value=Number(revenueCents)/Number(spendCents);
 if(!Number.isFinite(value)||value<=0)return '0x';
 return value.toFixed(1).replace('.',',')+'x';
};

const SALES_SQL=[
 'SELECT origin_campaign_id AS "campaignId",max(origin_campaign_name) AS "campaignName",',
 'origin_ad_id AS "adId",max(origin_ad_name) AS "adName",',
 'count(*)::int AS sales,coalesce(sum(amount_cents),0)::bigint AS "revenueCents"',
 'FROM socio_sales',
 "WHERE tenant_id=$1 AND status='confirmed'",
 'AND confirmed_at>now()-make_interval(days=>$2::int)',
 'GROUP BY origin_campaign_id,origin_ad_id'
].join(' ');

const byRevenue=(a,b)=>b.revenueCents-a.revenueCents||b.sales-a.sales;

const EVER_CONFIRMED_SQL=["SELECT EXISTS(SELECT 1 FROM socio_sales",
 "WHERE tenant_id=$1 AND status='confirmed') AS ever"].join(' ');

// Confirmed sales in the window, grouped by the campaign and by the ad that
// brought the customer. Both views share the same sales, so they are not added
// together; `unattributed` is the part no ad explains.
export async function salesPerformance(pool,tenantId,{days=7}={}){
 const windowDays=Math.max(1,Math.min(90,Number(days)||7));
 const [result,history]=await Promise.all([pool.query(SALES_SQL,[tenantId,windowDays]),
  pool.query(EVER_CONFIRMED_SQL,[tenantId])]);
 const campaigns=new Map(),ads=new Map();
 let totalSales=0,revenueCents=0,unattributedSales=0,unattributedRevenueCents=0;
 for(const row of result.rows){
  const sales=Number(row.sales)||0;
  const revenue=Number(row.revenueCents)||0;
  if(sales<=0)continue;
  totalSales+=sales;revenueCents+=revenue;
  const campaignId=row.campaignId?String(row.campaignId):null;
  const adId=row.adId?String(row.adId):null;
  if(!campaignId&&!adId){
   unattributedSales+=sales;unattributedRevenueCents+=revenue;
   continue;
  }
  if(campaignId){
   const entry=campaigns.get(campaignId)||
    {campaignId,campaignName:'',sales:0,revenueCents:0};
   entry.sales+=sales;entry.revenueCents+=revenue;
   entry.campaignName=entry.campaignName||String(row.campaignName||'');
   campaigns.set(campaignId,entry);
  }
  if(adId){
   const entry=ads.get(adId)||{adId,adName:'',campaignId,sales:0,revenueCents:0};
   entry.sales+=sales;entry.revenueCents+=revenue;
   entry.adName=entry.adName||String(row.adName||'');
   entry.campaignId=entry.campaignId||campaignId;
   ads.set(adId,entry);
  }
 }
 return {windowDays,totalSales,revenueCents,unattributedSales,unattributedRevenueCents,
  everConfirmedSales:history.rows[0]?.ever===true,
  campaigns:[...campaigns.values()].sort(byRevenue),
  ads:[...ads.values()].sort(byRevenue)};
}

function spendMap(rows,idKey){
 const map=new Map();
 for(const row of Array.isArray(rows)?rows:[]){
  const id=String(row?.[idKey]||'').trim();
  if(!id)continue;
  const cents=Math.round(Number(row.spend)*100);
  if(!Number.isFinite(cents)||cents<0)continue;
  map.set(id,(map.get(id)||0)+cents);
 }
 return map;
}

// The report section: sales and revenue per campaign with the spend the Meta API
// reported, so cost per sale and return are computed from real numbers only.
export function formatSalesSection(performance,{campaignInsights=[],adInsights=[],max=5}={}){
 if(!performance||!(Number(performance.totalSales)>0))return '';
 const campaignSpend=spendMap(campaignInsights,'campaign_id');
 const adSpend=spendMap(adInsights,'ad_id');
 const lines=['Vendas confirmadas (últimos '+performance.windowDays+' dias): '+
  performance.totalSales+' venda(s), '+brl(performance.revenueCents)+' de receita.'];
 const campaigns=(performance.campaigns||[]).slice(0,Math.max(1,Math.min(10,Number(max)||5)));
 if(campaigns.length){
  lines.push('Por campanha:');
  for(const campaign of campaigns){
   const spend=campaignSpend.get(campaign.campaignId)||0;
   let line='• '+(campaign.campaignName||'Campanha '+campaign.campaignId)+': '+
    campaign.sales+' venda(s), '+brl(campaign.revenueCents);
   if(spend>0)
    line+=', '+brl(spend)+' de anúncio, custo por venda '+
     brl(Math.round(spend/campaign.sales))+', retorno '+roas(campaign.revenueCents,spend);
   lines.push(line);
  }
 }
 const best=[...(performance.ads||[])].sort((a,b)=>b.sales-a.sales||b.revenueCents-a.revenueCents)[0];
 if(best){
  const spend=adSpend.get(best.adId)||0;
  let line='Anúncio com mais vendas: '+(best.adName||'Anúncio '+best.adId)+' — '+
   best.sales+' venda(s), '+brl(best.revenueCents);
  if(spend>0)line+=' (retorno '+roas(best.revenueCents,spend)+')';
  lines.push(line);
 }
 if(performance.unattributedSales>0)
  lines.push('Sem atribuição de anúncio: '+performance.unattributedSales+' venda(s), '+
   brl(performance.unattributedRevenueCents)+'.');
 return lines.join('\n').slice(0,900);
}
