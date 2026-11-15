// Revenue for the dashboard. Only a sale confirmed by the owner is money, and
// "today" means the São Paulo calendar day, not the UTC one.
const DAY='America/Sao_Paulo';

const WINDOWS_SQL=
 'WITH w AS (SELECT '+
 "(date_trunc('day',$2::timestamptz AT TIME ZONE '"+DAY+"') AT TIME ZONE '"+DAY+"') AS day_start,"+
 "(date_trunc('week',$2::timestamptz AT TIME ZONE '"+DAY+"') AT TIME ZONE '"+DAY+"') AS week_start,"+
 "(date_trunc('month',$2::timestamptz AT TIME ZONE '"+DAY+"') AT TIME ZONE '"+DAY+"') AS month_start,"+
 '$2::timestamptz AS ref) '+
 'SELECT '+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.day_start),0)::bigint AS today_cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.day_start)::int AS today_sales,'+
 // "Ontem no mesmo horário" is the same clock window one day back, not the
 // elapsed span ending at midnight — that would compare 09:00-24:00 with 00:00-15:00.
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.day_start-interval \'1 day\' '+
 'AND s.confirmed_at<w.ref-interval \'1 day\'),0)::bigint AS prev_day_cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.day_start-interval \'1 day\' '+
 'AND s.confirmed_at<w.ref-interval \'1 day\')::int AS prev_day_sales,'+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.week_start),0)::bigint AS week_cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.week_start)::int AS week_sales,'+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.week_start-interval \'1 week\' '+
 'AND s.confirmed_at<w.ref-interval \'1 week\'),0)::bigint AS prev_week_cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.week_start-interval \'1 week\' '+
 'AND s.confirmed_at<w.ref-interval \'1 week\')::int AS prev_week_sales,'+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.month_start),0)::bigint AS month_cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.month_start)::int AS month_sales,'+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.month_start-interval \'1 month\' '+
 'AND s.confirmed_at<w.ref-interval \'1 month\'),0)::bigint AS prev_month_cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.month_start-interval \'1 month\' '+
 'AND s.confirmed_at<w.ref-interval \'1 month\')::int AS prev_month_sales '+
 'FROM w LEFT JOIN socio_sales s ON s.tenant_id=$1 AND s.status=$3 '+
 'AND s.confirmed_at IS NOT NULL AND s.confirmed_at<=w.ref';

const SERIES_SQL=
 'WITH days AS (SELECT to_char(d.day,\'YYYY-MM-DD\') AS label,d.day '+
 'FROM generate_series('+
 "(date_trunc('day',$2::timestamptz AT TIME ZONE '"+DAY+"') AT TIME ZONE '"+DAY+"')::date-($3::int-1),"+
 "(date_trunc('day',$2::timestamptz AT TIME ZONE '"+DAY+"') AT TIME ZONE '"+DAY+"')::date,"+
 "interval '1 day') AS d(day)) "+
 'SELECT d.label,COALESCE(count(s.id),0)::int AS sales,'+
 'COALESCE(sum(s.amount_cents),0)::bigint AS cents '+
 'FROM days d LEFT JOIN socio_sales s ON s.tenant_id=$1 AND s.status=$4 '+
 'AND s.confirmed_at IS NOT NULL '+
 "AND (s.confirmed_at AT TIME ZONE '"+DAY+"')::date=d.day "+
 'GROUP BY d.label,d.day ORDER BY d.day';

const MONTHS_SQL=
 'WITH months AS (SELECT generate_series('+
 "date_trunc('month',$2::timestamptz AT TIME ZONE '"+DAY+"')-interval '5 months',"+
 "date_trunc('month',$2::timestamptz AT TIME ZONE '"+DAY+"'),"+
 "interval '1 month') AS month_start) "+
 'SELECT to_char(m.month_start,\'YYYY-MM\') AS month_key,'+
 'COALESCE(count(s.id),0)::int AS sales,'+
 'COALESCE(sum(s.amount_cents),0)::bigint AS cents '+
 'FROM months m LEFT JOIN socio_sales s ON s.tenant_id=$1 AND s.status=$3 '+
 'AND s.confirmed_at IS NOT NULL AND s.confirmed_at<=$2::timestamptz '+
 "AND (s.confirmed_at AT TIME ZONE '"+DAY+"')>=m.month_start "+
 "AND (s.confirmed_at AT TIME ZONE '"+DAY+"')<m.month_start+interval '1 month' "+
 'GROUP BY m.month_start ORDER BY m.month_start';

const CAMPAIGNS_SQL=
 'SELECT s.origin_campaign_id AS campaign_id,max(s.origin_campaign_name) AS campaign_name,'+
 'count(*)::int AS sales,COALESCE(sum(s.amount_cents),0)::bigint AS cents '+
 'FROM socio_sales s WHERE s.tenant_id=$1 AND s.status=$3 '+
 'AND s.confirmed_at IS NOT NULL AND s.origin_campaign_id IS NOT NULL '+
 'AND s.confirmed_at>=(date_trunc(\'month\',$2::timestamptz AT TIME ZONE \''+DAY+'\') AT TIME ZONE \''+DAY+'\') '+
 'AND s.confirmed_at<=$2::timestamptz '+
 'GROUP BY s.origin_campaign_id ORDER BY cents DESC,sales DESC LIMIT 5';

const STATE_SQL=
 "SELECT (SELECT count(*)::int FROM socio_sales WHERE tenant_id=$1 AND status='pending' "+
 "AND notified_at IS NOT NULL) AS pending_total,"+
 " (SELECT COALESCE(sum(amount_cents),0)::bigint FROM socio_sales WHERE tenant_id=$1 "+
 "AND status='pending' AND notified_at IS NOT NULL) AS pending_cents,"+
 " (SELECT EXISTS(SELECT 1 FROM socio_sales WHERE tenant_id=$1 AND status='confirmed' "+
 'AND confirmed_at IS NOT NULL)) AS ever';

const num=value=>Number(value)||0;

function changePct(revenueCents,previousRevenueCents){
 if(!previousRevenueCents)return null;
 return Math.round(((revenueCents-previousRevenueCents)/previousRevenueCents)*1000)/10;
}

function windowOf(sales,cents,previousSales,previousRevenueCents){
 return {
  sales:num(sales),
  revenueCents:num(cents),
  averageTicketCents:num(sales)>0?Math.round(num(cents)/num(sales)):0,
  previousSales:num(previousSales),
  previousRevenueCents:num(previousRevenueCents),
  changePct:changePct(num(cents),num(previousRevenueCents))
 };
}

export async function salesSummary(pool,tenantId,{now=new Date(),seriesDays=30}={}){
 const ref=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(ref.getTime()))
  throw Object.assign(new Error('Data de referência inválida.'),{status:422});
 const span=Number.isFinite(Number(seriesDays))?
  Math.min(Math.max(Math.floor(Number(seriesDays)),7),90):30;
 const [windows,series,months,campaigns,state]=await Promise.all([
  pool.query(WINDOWS_SQL,[tenantId,ref,'confirmed']),
  pool.query(SERIES_SQL,[tenantId,ref,span,'confirmed']),
  pool.query(MONTHS_SQL,[tenantId,ref,'confirmed']),
  pool.query(CAMPAIGNS_SQL,[tenantId,ref,'confirmed']),
  pool.query(STATE_SQL,[tenantId])
 ]);
 const row=windows.rows[0]||{},extra=state.rows[0]||{};
 return {
  currency:'BRL',
  timeZone:DAY,
  generatedAt:ref.toISOString(),
  windows:{
   today:windowOf(row.today_sales,row.today_cents,row.prev_day_sales,row.prev_day_cents),
   week:windowOf(row.week_sales,row.week_cents,row.prev_week_sales,row.prev_week_cents),
   month:windowOf(row.month_sales,row.month_cents,row.prev_month_sales,row.prev_month_cents)
  },
  pending:{total:num(extra.pending_total),amountCents:num(extra.pending_cents)},
  series:series.rows.map(item=>({
   date:item.label,
   sales:num(item.sales),
   revenueCents:num(item.cents)
  })),
  months:months.rows.map(item=>({
   month:item.month_key,
   sales:num(item.sales),
   revenueCents:num(item.cents)
  })),
  topCampaigns:campaigns.rows.map(item=>({
   campaignId:item.campaign_id,
   campaignName:item.campaign_name,
   sales:num(item.sales),
   revenueCents:num(item.cents)
  })),
  everConfirmedSales:extra.ever===true
 };
}
