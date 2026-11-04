// One-click Sócio training: queued WA-AKG text scans + existing deterministic
// anonymized analysis. Never sends WhatsApp messages, never auto-approves Markdown.
import {randomUUID} from 'node:crypto';
import {createTrainingAnalysis} from './analysis-jobs.mjs';
import {gatewayConfigured,getSessionStatus} from './waakg-adapter.mjs';
const uuid=()=>randomUUID();
const bad=(status,message)=>Object.assign(new Error(message),{status});
const activeScan=new Set(['queued','scanning','importing','paused']);
const finishedScan=new Set(['completed','failed','cancelled']);
export function scanDecision(statuses,expected){
 if(statuses.length!==expected)return {state:'waiting'};
 if(statuses.some(s=>s==='failed'||s==='cancelled'))return {state:'failed',errorCode:'SCAN_INTERRUPTED'};
 if(statuses.some(s=>activeScan.has(s)||s==='importing'))return {state:'waiting'};
 if(statuses.every(s=>s==='completed'))return {state:'ready'};
 return {state:'failed',errorCode:'SCAN_INVALID_STATE'};
}
export async function startAutoTraining(pool,tenantId,{getStatus=getSessionStatus,configured=gatewayConfigured}={}){
 if(!configured())throw bad(503,'Gateway WhatsApp indisponível.');
 const available=await pool.query(
  "SELECT l.channel_id AS id,l.session_id,ch.phone,ch.label FROM waakg_links l "+
  "JOIN channels ch ON ch.tenant_id=l.tenant_id AND ch.id=l.channel_id "+
  "WHERE l.tenant_id=$1 AND ch.provider='waakg' AND ch.status='connected' ORDER BY l.created_at",
  [tenantId]);
 if(!available.rowCount)throw bad(422,'Conecte pelo menos um WhatsApp por QR Code antes de treinar.');
 const verified=[];
 for(const c of available.rows.slice(0,10)){
  try{const r=await getStatus(c.session_id);
   if(r.connected&&r.connectedNumber===c.phone)verified.push(c);
  }catch{/* disconnected session will not enter an auto scan */}
 }
 if(!verified.length)throw bad(409,'Os WhatsApps cadastrados não estão disponíveis para sincronização.');
 const client=await pool.connect(),runId=uuid(),ids=[];
 try{
  await client.query('BEGIN');
  const current=await client.query(
   "SELECT id FROM training_auto_runs WHERE tenant_id=$1 AND status IN ('scanning','analyzing') FOR UPDATE",
   [tenantId]);
  if(current.rowCount)throw bad(409,'Já existe um treinamento automático em andamento.');
  const previous=await client.query(
   "SELECT id FROM training_jobs WHERE tenant_id=$1 AND status IN ('queued','analyzing','paused') LIMIT 1",
   [tenantId]);
  if(previous.rowCount)throw bad(409,'Finalize ou cancele a análise anterior antes de iniciar novo treinamento.');
  for(const c of verified){
   const existing=await client.query(
    "SELECT id FROM waakg_scans WHERE tenant_id=$1 AND channel_id=$2 AND status IN ('queued','scanning','importing','paused') FOR UPDATE",
    [tenantId,c.id]);
   if(existing.rowCount){ids.push(existing.rows[0].id);continue;}
   const sid=uuid();
   await client.query(
    "INSERT INTO waakg_scans(id,tenant_id,channel_id,status) VALUES($1,$2,$3,'queued')",
    [sid,tenantId,c.id]);
   ids.push(sid);
  }
  await client.query(
   "INSERT INTO training_auto_runs(id,tenant_id,status,scan_ids) VALUES($1,$2,'scanning',$3::uuid[])",
   [runId,tenantId,ids]);
  await client.query('COMMIT');
  return {id:runId,status:'scanning',percent:0,connectedChannels:verified.length,
   note:'Apenas o histórico de texto disponível nos números conectados. Conhecimento exige aprovação.'};
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}
export async function autoTrainingStatus(pool,tenantId){
 const rows=await pool.query(
  "SELECT id,status,scan_ids,job_id,error_code,created_at,finished_at FROM training_auto_runs "+
  "WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1",[tenantId]);
 if(!rows.rowCount)return null;
 const run=rows.rows[0];
 const scans=run.scan_ids.length?await pool.query(
  "SELECT id,status,total_chats,processed_chats,partial_coverage,truncated_chats,imported_messages "+
  "FROM waakg_scans WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenantId,run.scan_ids]):{rows:[]};
 const totalScans=run.scan_ids.length;
 const finished=scans.rows.filter(s=>finishedScan.has(s.status)).length;
 const ratio=scans.rows.reduce((n,s)=>
  n+(finishedScan.has(s.status)?1:s.total_chats>0?Math.min(.95,s.processed_chats/s.total_chats):0),0)/Math.max(1,totalScans);
 let job=null;
 if(run.job_id){
  const j=await pool.query(
   "SELECT id,status,total_items,processed_items FROM training_jobs WHERE id=$1 AND tenant_id=$2",
   [run.job_id,tenantId]);job=j.rows[0]||null;
 }
 const analysisPercent=job?.total_items?Math.min(1,job.processed_items/job.total_items):0;
 const percent=run.status==='completed'?100:run.status==='scanning'?
  Math.min(59,Math.floor(ratio*60)):run.status==='analyzing'?
  Math.min(99,60+Math.floor(analysisPercent*40)):0;
 return {id:run.id,status:run.status,percent,errorCode:run.error_code,
  channels:totalScans,scanned:finished,jobId:run.job_id,jobStatus:job?.status||null,
  partialCoverage:scans.rows.some(s=>s.partial_coverage||s.truncated_chats>0||s.status!=='completed'),
  messagesImported:scans.rows.reduce((n,s)=>n+Number(s.imported_messages||0),0),
  source:'available_waakg_text',approvalRequired:true};
}
export async function cancelAutoTraining(pool,tenantId,runId){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const q=await c.query(
   "SELECT id,scan_ids,job_id FROM training_auto_runs WHERE id=$1 AND tenant_id=$2 AND status IN ('scanning','analyzing') FOR UPDATE",
   [runId,tenantId]);
  if(!q.rowCount)throw bad(409,'Treinamento não encontrado ou já finalizado.');
  const run=q.rows[0];
  await c.query(
   "UPDATE waakg_scans SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now(),finished_at=now() "+
   "WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status IN ('queued','scanning','importing','paused')",
   [tenantId,run.scan_ids]);
  if(run.job_id)await c.query(
   "UPDATE training_jobs SET status='cancelled',updated_at=now(),finished_at=now() "+
   "WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','analyzing','paused')",
   [tenantId,run.job_id]);
  await c.query(
   "UPDATE training_auto_runs SET status='cancelled',updated_at=now(),finished_at=now() WHERE id=$1",
   [runId]);
  await c.query('COMMIT');
  return {id:runId,status:'cancelled'};
 }catch(err){await c.query('ROLLBACK').catch(()=>{});throw err;}
 finally{c.release();}
}
export async function processNextAutoTraining(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const rows=await client.query(
   "SELECT * FROM training_auto_runs WHERE status IN ('scanning','analyzing') "+
   "AND tenant_id IN (SELECT id FROM tenants WHERE COALESCE((features->>'ai')::boolean,true)=true) "+
   "ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
  if(!rows.rowCount){await client.query('COMMIT');return {processed:false};}
  const run=rows.rows[0];
  if(run.status==='scanning'){
   const scans=await client.query(
    "SELECT status FROM waakg_scans WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
    [run.tenant_id,run.scan_ids]);
   const decision=scanDecision(scans.rows.map(s=>s.status),run.scan_ids.length);
   if(decision.state==='waiting'){
    await client.query('COMMIT');return {processed:false,reason:'SCANNING'};
   }
   if(decision.state==='failed'){
    await client.query(
     "UPDATE training_auto_runs SET status='failed',error_code=$2,updated_at=now(),finished_at=now() WHERE id=$1",
     [run.id,decision.errorCode]);
    await client.query('COMMIT');return {processed:true,failed:true};
   }
   try{
    const job=await createTrainingAnalysis(pool,run.tenant_id,{scanIds:run.scan_ids});
    await client.query(
     "UPDATE training_auto_runs SET status='analyzing',job_id=$2,updated_at=now() WHERE id=$1",
     [run.id,job.id]);
    await client.query('COMMIT');return {processed:true,stage:'ANALYZING',jobId:job.id};
   }catch(err){
    await client.query(
     "UPDATE training_auto_runs SET status='failed',error_code=$2,updated_at=now(),finished_at=now() WHERE id=$1",
     [run.id,err.status===422?'NO_TEXT_HISTORY':'ANALYSIS_NOT_STARTED']);
    await client.query('COMMIT');return {processed:true,failed:true};
   }
  }
  const job=await client.query("SELECT status FROM training_jobs WHERE id=$1 AND tenant_id=$2",
   [run.job_id,run.tenant_id]);
  if(job.rows[0]?.status==='completed'){
   await client.query(
    "UPDATE training_auto_runs SET status='completed',updated_at=now(),finished_at=now() WHERE id=$1",[run.id]);
   await client.query('COMMIT');return {processed:true,completed:true};
  }
  if(!job.rowCount||job.rows[0].status==='cancelled'||job.rows[0].status==='failed'){
   await client.query(
    "UPDATE training_auto_runs SET status='failed',error_code='ANALYSIS_INTERRUPTED',updated_at=now(),finished_at=now() WHERE id=$1",[run.id]);
   await client.query('COMMIT');return {processed:true,failed:true};
  }
  await client.query('COMMIT');return {processed:false,reason:'ANALYZING'};
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}
