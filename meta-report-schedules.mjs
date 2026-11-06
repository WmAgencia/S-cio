// Opt-in daily Meta reports saved privately to the business dashboard.
// No WhatsApp sends, no campaign changes, and no assumption that clicks are leads.
import {randomUUID} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';

const invalid=(status,msg)=>Object.assign(new Error(msg),{status});
const ZONES=Object.freeze(['America/Sao_Paulo','America/Fortaleza','America/Belem','America/Cuiaba','America/Manaus','America/Rio_Branco']);
const PERIODS=Object.freeze(['today','yesterday','last_7d','last_30d']);
export function nextDailyMetaReport(hour='20:00',timeZone='America/Sao_Paulo',now=new Date()){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(hour)||!ZONES.includes(timeZone))
  throw invalid(422,'Horário ou fuso horário inválido.');
 const [h,m]=hour.split(':').map(Number);
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const start=Math.ceil(now.getTime()/60000)*60000;
 for(let i=0;i<49*60;i++){
  const candidate=new Date(start+i*60000),parts=fmt.formatToParts(candidate);
  if(Number(parts.find(p=>p.type==='hour')?.value)===h&&Number(parts.find(p=>p.type==='minute')?.value)===m)return candidate;
 }
 throw invalid(503,'Não foi possível calcular a próxima execução.');
}
const authorize=(a,write=false)=>{
 requirePermission(a,write?'marketing.manage':'marketing.read');
 assertApiFeature(a.features,'/api/marketing/tools');
 if(a.tenant_status==='paused')throw invalid(403,'Empresa pausada.');
};
export async function saveMetaReportSchedule(pool,a,input={},options={}){
 authorize(a,true);
 const hour=input.hour||'20:00',timeZone=input.timeZone||'America/Sao_Paulo',
  period=PERIODS.includes(input.period)?input.period:'yesterday',enabled=input.enabled===true;
 const next=nextDailyMetaReport(hour,timeZone,options.now||new Date());
 const account=await resolveSelectedOfficialAccount(pool,a,options);
 const result=await pool.query(
  "INSERT INTO meta_report_schedules(tenant_id,user_id,account_id,hour,time_zone,period,enabled,next_run_at) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id) DO UPDATE "+
  "SET user_id=EXCLUDED.user_id,account_id=EXCLUDED.account_id,hour=EXCLUDED.hour,"+
  "time_zone=EXCLUDED.time_zone,period=EXCLUDED.period,enabled=EXCLUDED.enabled,"+
  "next_run_at=EXCLUDED.next_run_at,updated_at=now() "+
  "RETURNING hour,time_zone,period,enabled,next_run_at,account_id",
  [a.active_tenant_id,a.user_id,account.id,hour,timeZone,period,enabled,next]);
 return {schedule:result.rows[0],delivery:'panel_only',
  note:'O relatório aparecerá no Sócio. Envio ao grupo WA-AKG não está habilitado.'};
}
export async function listMetaReportSchedule(pool,a){
 authorize(a);
 const [settings,reports]=await Promise.all([
  pool.query('SELECT hour,time_zone,period,enabled,next_run_at,account_id FROM meta_report_schedules WHERE tenant_id=$1',[a.active_tenant_id]),
  pool.query("SELECT id,status,scheduled_for,summary,error_code,created_at FROM meta_report_runs WHERE tenant_id=$1 ORDER BY scheduled_for DESC LIMIT 20",[a.active_tenant_id])
 ]);
 return {schedule:settings.rows[0]||null,runs:reports.rows,delivery:'panel_only',
  note:'Relatórios guardados apenas no painel. Cliques e conversas são métricas diferentes.'};
}
export async function processDueMetaReport(pool,{env=process.env,now=new Date(),read=readAdvancedMetaTool}={}){
 if(env.SOCIO_META_REPORTS_ENABLED!=='true')return {processed:false,reason:'REPORTS_DISABLED'};
 const client=await pool.connect();
 let job=null;
 try{
  await client.query('BEGIN');
  const r=await client.query(
   "SELECT s.*,u.role,u.platform_owner,t.features,t.status AS tenant_status "+
   "FROM meta_report_schedules s JOIN users u ON u.id=s.user_id AND u.active=true "+
   "JOIN tenants t ON t.id=s.tenant_id AND t.status<>'paused' "+
   "WHERE s.enabled=true AND s.next_run_at<=$1 ORDER BY s.next_run_at LIMIT 1 FOR UPDATE OF s SKIP LOCKED",
   [now]);
  const s=r.rows[0];
  if(!s){await client.query('COMMIT');return {processed:false,reason:'NOT_DUE'};}
  const id=randomUUID(),next=nextDailyMetaReport(s.hour,s.time_zone,new Date(now.getTime()+1000));
  await client.query('UPDATE meta_report_schedules SET next_run_at=$2,updated_at=now() WHERE tenant_id=$1',[s.tenant_id,next]);
  const inserted=await client.query(
   "INSERT INTO meta_report_runs(id,tenant_id,scheduled_for,status) VALUES($1,$2,$3,'running') "+
   "ON CONFLICT(tenant_id,scheduled_for) DO NOTHING RETURNING id",[id,s.tenant_id,s.next_run_at]);
  await client.query('COMMIT');
  if(!inserted.rowCount)return {processed:false,reason:'ALREADY_CLAIMED'};
  job={...s,id};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 const a={active_tenant_id:job.tenant_id,user_id:job.user_id,role:job.role,
  platform_owner:job.platform_owner,tenant_status:job.tenant_status,features:job.features};
 try{
  const report=await read(pool,a,'reports',{period:job.period,level:'campaign'}, {env});
  if(report.accountId!==job.account_id)throw invalid(409,'A conta selecionada foi alterada. Revise o agendamento.');
  const summary={...report.summary,generatedAt:now.toISOString(),
   campaigns:(report.items||[]).slice(0,30).map(x=>({
    id:x.campaign_id,name:x.campaign_name,spend:x.spend,clicks:x.clicks,impressions:x.impressions
   }))};
  await pool.query(
   "UPDATE meta_report_runs SET status='completed',summary=$2::jsonb WHERE id=$1 AND tenant_id=$3",
   [job.id,JSON.stringify(summary),job.tenant_id]);
  return {processed:true,status:'completed',tenantId:job.tenant_id};
 }catch(error){
  await pool.query(
   "UPDATE meta_report_runs SET status='failed',error_code=$2 WHERE id=$1 AND tenant_id=$3",
   [job.id,String(error?.message||'Meta indisponível').slice(0,180),job.tenant_id]);
  return {processed:true,status:'failed',tenantId:job.tenant_id};
 }
}
