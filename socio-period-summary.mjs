// One period for the whole dashboard: the owner picks Hoje, 7 dias, Mês atual
// or a custom range, and every tile below answers inside that window. Days are
// São Paulo calendar days, and the comparison window has the same length so a
// day of the week never gets compared against half of another one.
const DAY='America/Sao_Paulo';
const DAY_MS=86400000;

const invalid=(message)=>Object.assign(new Error(message),{status:422});
const isDay=(value)=>{
 const text=String(value||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
 const epoch=Date.parse(text+'T00:00:00Z');
 return Number.isFinite(epoch)&&new Date(epoch).toISOString().slice(0,10)===text;
};
const dayFromEpoch=(epoch)=>new Date(epoch).toISOString().slice(0,10);
const epochOf=(day)=>Date.parse(day+'T00:00:00Z');
const todayInSaoPaulo=(now)=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:DAY,year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(now);
 const part=(type)=>parts.find((entry)=>entry.type===type)?.value;
 return part('year')+'-'+part('month')+'-'+part('day');
};

export function resolvePeriod({preset='7d',from=null,to=null,now=new Date()}={}){
 if(!(now instanceof Date)||Number.isNaN(now.getTime()))throw invalid('Data de referência inválida.');
 const today=todayInSaoPaulo(now);
 let start;let end;
 if(preset==='today'){
  start=today;end=today;
 }else if(preset==='7d'){
  start=dayFromEpoch(epochOf(today)-6*DAY_MS);end=today;
 }else if(preset==='month'){
  start=today.slice(0,8)+'01';end=today;
 }else if(preset==='custom'){
  if(!isDay(from)||!isDay(to))throw invalid('Escolha as duas datas do período.');
  if(from>to)throw invalid('A data inicial precisa vir antes da data final.');
  if(epochOf(to)-epochOf(from)>365*DAY_MS)throw invalid('O período personalizado vai até 366 dias.');
  start=from;end=to;
 }else{
  throw Object.assign(new Error('Período inválido.'),{status:400});
 }
 const days=Math.round((epochOf(end)-epochOf(start))/DAY_MS)+1;
 return {preset,from:start,to:end,days,
  toExclusive:dayFromEpoch(epochOf(end)+DAY_MS),
  previousFrom:dayFromEpoch(epochOf(start)-days*DAY_MS),
  previousTo:dayFromEpoch(epochOf(start)-DAY_MS)};
}

const windowSql=
 'WITH w AS (SELECT '+
 "(($2)::date::timestamp AT TIME ZONE '"+DAY+"') AS cur_from,"+
 "(($3)::date::timestamp AT TIME ZONE '"+DAY+"') AS cur_to,"+
 "(($4)::date::timestamp AT TIME ZONE '"+DAY+"') AS prev_from) ";

const MESSAGES_SQL=windowSql+
 'SELECT '+
 "(SELECT count(*)::int FROM messages m WHERE m.tenant_id=$1 AND m.direction='inbound'"+
 ' AND m.created_at>=w.cur_from AND m.created_at<w.cur_to) AS inbound,'+
 "(SELECT count(*)::int FROM messages m WHERE m.tenant_id=$1 AND m.direction='outbound'"+
 ' AND m.created_at>=w.cur_from AND m.created_at<w.cur_to) AS outbound,'+
 "(SELECT count(*)::int FROM messages m WHERE m.tenant_id=$1 AND m.direction='inbound'"+
 ' AND m.created_at>=w.prev_from AND m.created_at<w.cur_from) AS prev_inbound,'+
 "(SELECT count(*)::int FROM messages m WHERE m.tenant_id=$1 AND m.direction='outbound'"+
 ' AND m.created_at>=w.prev_from AND m.created_at<w.cur_from) AS prev_outbound '+
 'FROM w';

const CONVERSATIONS_SQL=windowSql+
 'SELECT '+
 '(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1'+
 ' AND c.created_at>=w.cur_from AND c.created_at<w.cur_to) AS started,'+
 '(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1'+
 ' AND c.created_at>=w.prev_from AND c.created_at<w.cur_from) AS prev_started,'+
 '(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1'+
 ' AND c.last_message_at>=w.cur_from AND c.last_message_at<w.cur_to) AS active,'+
 "(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1 AND c.status!='resolved') AS open,"+
 '(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1'+
 ' AND c.status=\'human\') AS waiting '+
 'FROM w';

const SALES_SQL=windowSql+
 'SELECT '+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.cur_from AND s.confirmed_at<w.cur_to)::int AS confirmed,'+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.cur_from AND s.confirmed_at<w.cur_to),0)::bigint AS cents,'+
 'count(s.id) FILTER (WHERE s.confirmed_at>=w.prev_from AND s.confirmed_at<w.cur_from)::int AS prev_confirmed,'+
 'COALESCE(sum(s.amount_cents) FILTER (WHERE s.confirmed_at>=w.prev_from AND s.confirmed_at<w.cur_from),0)::bigint AS prev_cents '+
 'FROM w LEFT JOIN socio_sales s ON s.tenant_id=$1 AND s.status=$5'+
 " AND s.confirmed_at IS NOT NULL AND s.confirmed_at<=now() "+
 'GROUP BY w.cur_from,w.cur_to,w.prev_from';

export async function periodSummary(pool,tenantId,{preset='7d',from=null,to=null,
 now=new Date(),includeSales=true}={}){
 const period=resolvePeriod({preset,from,to,now});
 const params=[tenantId,period.from,period.toExclusive,period.previousFrom];
 const [messages,conversations]=await Promise.all([
  pool.query(MESSAGES_SQL,params),
  pool.query(CONVERSATIONS_SQL,params),
 ]);
 let sales=null;
 if(includeSales){
  try{
   const row=(await pool.query(SALES_SQL,[...params,'confirmed'])).rows[0];
   const averageTicketCents=row.confirmed>0?Math.round(Number(row.cents)/row.confirmed):null;
   sales={confirmed:row.confirmed,revenueCents:Number(row.cents),averageTicketCents,
    previousConfirmed:row.prev_confirmed,previousRevenueCents:Number(row.prev_cents)};
  }catch(error){
   // A tenant whose database predates the sales table still gets messages and
   // conversations; the cards say revenue is unavailable instead of guessing.
   if(error.code!=='42P01')throw error;
  }
 }
 const m=messages.rows[0];
 const c=conversations.rows[0];
 const inbound=m.inbound;
 const outbound=m.outbound;
 return {
  timeZone:DAY,
  generatedAt:now.toISOString(),
  period:{preset:period.preset,from:period.from,to:period.to,days:period.days,
   previousFrom:period.previousFrom,previousTo:period.previousTo},
  messages:{inbound,outbound,total:inbound+outbound,
   previousInbound:m.prev_inbound,previousOutbound:m.prev_outbound},
  conversations:{started:c.started,active:c.active,open:c.open,waiting:c.waiting,
   previousStarted:c.prev_started},
  sales,
  conversionPct:sales&&c.started>0?Math.round(sales.confirmed/c.started*1000)/10:null,
 };
}
