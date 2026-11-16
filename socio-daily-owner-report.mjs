// One concise, code-generated report per active owner group at 20:00 in São
// Paulo. No model is needed: verified database/provider fields are formatted
// directly, which is cheaper and prevents an LLM from changing numbers.
import {periodSummary} from './socio-period-summary.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';
import {outboundEnabled,sendGatewayText} from './socio-outbound.mjs';

const ZONE='America/Sao_Paulo';
const clean=value=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim();
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
const brl=value=>numeric(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dayParts=now=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=type=>parts.find(part=>part.type===type)?.value;
 return {date:get('year')+'-'+get('month')+'-'+get('day'),hour:Number(get('hour')),minute:Number(get('minute'))};
};
export const saoPauloReportDate=now=>dayParts(now).date;
export const dailyOwnerReportDue=now=>{
 if(!(now instanceof Date)||Number.isNaN(now.getTime()))return false;
 const local=dayParts(now);return local.hour>=20;
};

export function formatDailyOwnerReport({date,period,meta=null,metaError='',company=''}){
 const leads=numeric(period?.leads?.campaign),sales=numeric(period?.sales?.confirmed);
 const revenue=numeric(period?.sales?.revenueCents)/100;
 const rows=Array.isArray(meta?.items)?meta.items:[];
 const spend=rows.reduce((sum,row)=>sum+numeric(row.spend),0);
 const clicks=rows.reduce((sum,row)=>sum+numeric(row.clicks),0);
 const impressions=rows.reduce((sum,row)=>sum+numeric(row.impressions),0);
 const active=rows.filter(row=>String(row.effective_status||row.status||'').toUpperCase()==='ACTIVE').length;
 const stamp=String(date||'').split('-').reverse().join('/');
 return [
  '📊 Relatório diário'+(company?' · '+clean(company):''),
  stamp+' · dados registrados até 20h',
  '',
  meta?'💰 Investimento em campanhas: '+brl(spend):'💰 Investimento em campanhas: indisponível agora',
  '🎯 Leads de campanhas no WhatsApp: '+leads,
  meta?'🖱️ Cliques: '+Math.round(clicks)+' · 👁️ Impressões: '+Math.round(impressions):null,
  meta?'📣 Campanhas ativas retornadas: '+active:null,
  '🧾 Vendas confirmadas: '+Math.round(sales),
  '💵 Faturamento confirmado: '+brl(revenue),
  metaError?'⚠️ A Meta não retornou as métricas publicitárias neste fechamento.':null,
  '',
  'Lead = uma conversa atribuída a campanha. Quantidade de mensagens não aumenta esse número.',
  'Cliques e leads não são comprovantes de pagamento.'
 ].filter(line=>line!==null).join('\n').slice(0,2800);
}

export async function processDueDailyOwnerReport(pool,{env=process.env,now=new Date(),
 summarize=periodSummary,read=readAdvancedMetaTool,send=sendGatewayText}={}){
 if(env.SOCIO_DAILY_OWNER_REPORTS_ENABLED!=='true')return {processed:false,reason:'REPORTS_DISABLED'};
 if(!outboundEnabled(env))return {processed:false,reason:'OUTBOUND_DISABLED'};
 if(!dailyOwnerReportDue(now))return {processed:false,reason:'NOT_DUE'};
 const reportDate=saoPauloReportDate(now),client=await pool.connect();let job=null;
 try{
  await client.query('BEGIN');
  const found=await client.query(
   "SELECT g.id AS group_id,g.tenant_id,g.group_jid,l.session_id,t.name AS tenant_name,t.features,"+
   "t.status AS tenant_status,u.id AS user_id,u.role,u.platform_owner "+
   "FROM socio_owner_groups g JOIN tenants t ON t.id=g.tenant_id AND t.status<>'paused' "+
   "JOIN channels ch ON ch.id=g.channel_id AND ch.tenant_id=g.tenant_id AND ch.status='connected' "+
   "JOIN waakg_links l ON l.channel_id=g.channel_id AND l.tenant_id=g.tenant_id "+
   "JOIN LATERAL (SELECT id,role,platform_owner FROM users WHERE tenant_id=g.tenant_id AND active=true "+
   "ORDER BY (role='owner') DESC,created_at,id LIMIT 1) u ON true "+
   "WHERE g.status='active' AND g.group_jid IS NOT NULL AND NOT EXISTS("+
   "SELECT 1 FROM socio_daily_owner_reports r WHERE r.group_id=g.id AND r.report_date=$1) "+
   'ORDER BY g.created_at,g.id LIMIT 1 FOR UPDATE OF g SKIP LOCKED',[reportDate]);
  if(!found.rowCount){await client.query('COMMIT');return {processed:false,reason:'NO_PENDING_GROUP'};}
  job=found.rows[0];
  const claimed=await client.query(
   "INSERT INTO socio_daily_owner_reports(id,tenant_id,group_id,report_date,status) "+
   "VALUES(gen_random_uuid(),$1,$2,$3,'sending') ON CONFLICT(group_id,report_date) DO NOTHING RETURNING id",
   [job.tenant_id,job.group_id,reportDate]);
  await client.query('COMMIT');
  if(!claimed.rowCount)return {processed:false,reason:'ALREADY_CLAIMED'};
  job.report_id=claimed.rows[0].id;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}

 const actor={active_tenant_id:job.tenant_id,user_id:job.user_id,role:job.role,
  platform_owner:job.platform_owner,tenant_status:job.tenant_status,features:job.features};
 try{
  const period=await summarize(pool,job.tenant_id,{preset:'today',now,includeSales:true});
  let meta=null,metaError='';
  try{meta=await read(pool,actor,'reports',{period:'today',level:'campaign'},{env});}
  catch(error){metaError=String(error?.message||'META_UNAVAILABLE').slice(0,160);}
  const text=formatDailyOwnerReport({date:reportDate,period,meta,metaError,company:job.tenant_name});
  const delivered=await send({sessionId:job.session_id,jid:job.group_jid,text,env});
  await pool.query("UPDATE socio_daily_owner_reports SET status='sent',provider_message_id=$2,sent_at=now(),summary=$3::jsonb "+
   'WHERE id=$1 AND tenant_id=$4',[job.report_id,delivered.providerId||null,
    JSON.stringify({leads:period.leads?.campaign||0,sales:period.sales?.confirmed||0,
     revenueCents:period.sales?.revenueCents||0,metaAvailable:!!meta}),job.tenant_id]);
  return {processed:true,status:'sent',tenantId:job.tenant_id,groupId:job.group_id};
 }catch(error){
  // A network error may occur after WhatsApp accepted the message. Mark it
  // uncertain and never retry automatically, preventing duplicate reports.
  await pool.query("UPDATE socio_daily_owner_reports SET status='uncertain',error_code=$2 WHERE id=$1 AND tenant_id=$3",
   [job.report_id,String(error?.message||'DELIVERY_UNCERTAIN').slice(0,180),job.tenant_id]).catch(()=>{});
  return {processed:true,status:'uncertain',tenantId:job.tenant_id,groupId:job.group_id};
 }
}
