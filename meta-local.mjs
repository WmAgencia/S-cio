import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {parseTenantFeatures} from './tenant-features.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const secret=()=>randomBytes(32).toString('hex');
function publicOrigin(env){
 const url=new URL(env.SOCIO_PUBLIC_URL||'http://127.0.0.1:3000');
 if((url.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw fail(503,'Endereço público do Sócio inválido.');
 return url.origin;
}
export async function startLocalPairing(pool,a,env=process.env){
 requirePermission(a,'marketing.manage');
 const id=randomBytes(16).toString('hex'),code=secret();
 await pool.query("UPDATE meta_local_connections SET status='disconnected',pair_hash=NULL WHERE tenant_id=$1 AND user_id=$2 AND status='pending'",[a.active_tenant_id,a.user_id]);
 await pool.query("INSERT INTO meta_local_connections(id,tenant_id,user_id,status,pair_hash,pair_expires_at) VALUES($1,$2,$3,'pending',$4,now()+interval '10 minutes')",[id,a.active_tenant_id,a.user_id,hash(code)]);
 const link=new URL('socio-meta://connect');link.searchParams.set('server',publicOrigin(env));link.searchParams.set('code',code);
 return {connectionId:id,connectUrl:link.href,pairCode:code,expiresIn:600};
}
export async function claimLocalPairing(pool,{code,deviceLabel}){
 if(!/^[a-f0-9]{64}$/.test(code||'')||typeof deviceLabel!=='string'||deviceLabel.length>80)throw fail(422,'Código de conexão inválido.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const found=await c.query("SELECT c.*,u.role,u.platform_owner,u.active,t.status AS tenant_status,t.features FROM meta_local_connections c JOIN users u ON u.id=c.user_id JOIN tenants t ON t.id=c.tenant_id WHERE c.pair_hash=$1 AND c.status='pending' AND c.pair_expires_at>now() FOR UPDATE OF c",[hash(code)]);
  const row=found.rows[0];if(!row)throw fail(403,'Código expirado ou já utilizado. Gere outro no Sócio.');
  if(!row.active||row.tenant_status==='paused'||!parseTenantFeatures(row.features).meta_ads)throw fail(403,'Esta conexão não está autorizada.');
  requirePermission(row,'marketing.manage');
  // Serialize enrollment for this actor, including two different valid pending codes.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[row.tenant_id+':'+row.user_id]);
  await c.query("UPDATE meta_local_connections SET status='disconnected',token_hash=NULL WHERE tenant_id=$1 AND user_id=$2 AND status='active'",[row.tenant_id,row.user_id]);
  const token=secret();
  await c.query("UPDATE meta_local_connections SET status='active',token_hash=$2,pair_hash=NULL,device_label=$3,last_seen_at=now(),updated_at=now() WHERE id=$1",[row.id,hash(token),deviceLabel.trim()||'Meu computador']);
  await c.query("INSERT INTO meta_local_jobs(id,connection_id,kind,input,status) VALUES($1,$2,'login','{}','pending')",[randomUUID(),row.id]);
  await c.query('COMMIT');return {connectionId:row.id,token};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function authorizeLocalConnector(pool,authorization){
 if(!/^Bearer [a-f0-9]{64}$/.test(authorization||''))throw fail(401,'Conector não autorizado.');
 const row=(await pool.query("SELECT c.*,u.role,u.platform_owner,u.active,t.status AS tenant_status,t.features FROM meta_local_connections c JOIN users u ON u.id=c.user_id JOIN tenants t ON t.id=c.tenant_id WHERE c.token_hash=$1 AND c.status='active'",[hash(authorization.slice(7))])).rows[0];
 if(!row)throw fail(401,'Conexão revogada.');
 if(!row.active||row.tenant_status==='paused'||!parseTenantFeatures(row.features).meta_ads)throw fail(403,'Acesso ao módulo indisponível.');
 requirePermission(row,'marketing.manage');return row;
}
export async function localHeartbeat(pool,connection,data){
 const sessionPresent=data.sessionPresent===true,browserOpen=data.browserOpen===true;
 await pool.query('UPDATE meta_local_connections SET last_seen_at=now(),session_present=$2,browser_open=$3,updated_at=now() WHERE id=$1',[connection.id,sessionPresent,browserOpen]);
 return {ok:true};
}
export async function pollLocalJob(pool,connection){
 const lease=secret();
 // A claimed command is never automatically placed back in the queue.
 const result=await pool.query("UPDATE meta_local_jobs SET status='leased',lease_hash=$2,claimed_at=now() WHERE id=(SELECT id FROM meta_local_jobs WHERE connection_id=$1 AND status='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,kind,input",[connection.id,hash(lease)]);
 return result.rows[0]?{job:result.rows[0],lease}:{job:null};
}
export async function finishLocalJob(pool,connection,{jobId,lease,result}){
 if(!/^[0-9a-f-]{36}$/i.test(jobId||'')||!/^[a-f0-9]{64}$/.test(lease||'')||!result||typeof result!=='object'||Array.isArray(result))throw fail(422,'Resultado inválido.');
 const serialized=JSON.stringify(result);if(serialized.length>450000)throw fail(413,'Resultado muito grande.');
 const saved=await pool.query("UPDATE meta_local_jobs SET status='done',result=$4,completed_at=now() WHERE id=$1 AND connection_id=$2 AND lease_hash=$3 AND status='leased' RETURNING id",[jobId,connection.id,hash(lease),serialized]);
 if(!saved.rows[0])throw fail(409,'Resultado já recebido ou comando inválido.');
 return {ok:true};
}
export async function localConnectionStatus(pool,a){
 requirePermission(a,'marketing.read');
 const row=(await pool.query("SELECT id,device_label,last_seen_at,session_present,browser_open FROM meta_local_connections WHERE tenant_id=$1 AND user_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",[a.active_tenant_id,a.user_id])).rows[0];
 if(!row)return {mode:'local',paired:false,online:false,sessionPresent:false,requiresMetaApp:false};
 return {mode:'local',paired:true,online:Date.now()-new Date(row.last_seen_at).getTime()<45000,sessionPresent:row.session_present,browserOpen:row.browser_open,deviceLabel:row.device_label,lastSeenAt:row.last_seen_at,requiresMetaApp:false};
}
export async function enqueueLocalJob(pool,a,kind,input={},key,env=process.env){
 requirePermission(a,'marketing.manage');
 if(!['login','status','plan','execute'].includes(kind))throw fail(422,'Comando inválido.');
 const connection=(await pool.query("SELECT id,last_seen_at FROM meta_local_connections WHERE tenant_id=$1 AND user_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",[a.active_tenant_id,a.user_id])).rows[0];
 if(!connection||Date.now()-new Date(connection.last_seen_at).getTime()>45000)throw fail(409,'Abra o conector no seu computador e tente novamente.');
 if(kind==='login'||kind==='status')input={};
 if(kind==='plan'){
  if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(input.operation||'')||!input.args||typeof input.args!=='object'||Array.isArray(input.args))throw fail(422,'Operação ou argumentos inválidos.');
  input={operation:input.operation,args:input.args};
 }
 if(kind==='execute'){
  if(!/^[a-f0-9]{48}$/.test(input.plan_id||'')||typeof input.allow_writes!=='boolean')throw fail(422,'Plano inválido.');
  if(input.allow_writes&&env.SOCIO_META_BROWSER_ALLOW_WRITES!=='true')throw fail(403,'Alterações estão desabilitadas no servidor.');
  input={plan_id:input.plan_id,allow_writes:input.allow_writes};
 }
 if(!/^[a-zA-Z0-9_-]{8,128}$/.test(key||''))throw fail(422,'Envie Idempotency-Key.');
 const fingerprint=hash(JSON.stringify([kind,input])),id=randomUUID();
 const queued=await pool.query("INSERT INTO meta_local_jobs(id,connection_id,kind,input,status,key_hash,payload_hash) VALUES($1,$2,$3,$4,'pending',$5,$6) ON CONFLICT(connection_id,key_hash) DO NOTHING RETURNING id",[id,connection.id,kind,JSON.stringify(input),hash(key),fingerprint]);
 if(queued.rows[0])return {jobId:id};
 const previous=(await pool.query('SELECT id,payload_hash FROM meta_local_jobs WHERE connection_id=$1 AND key_hash=$2',[connection.id,hash(key)])).rows[0];
 if(previous.payload_hash!==fingerprint)throw fail(409,'Chave já utilizada para outro comando.');
 return {jobId:previous.id};
}
export async function getLocalJob(pool,a,id){
 requirePermission(a,'marketing.read');
 if(!/^[0-9a-f-]{36}$/i.test(id||''))throw fail(404,'Comando não encontrado.');
 const job=(await pool.query('SELECT j.id,j.kind,j.status,j.result,j.claimed_at FROM meta_local_jobs j JOIN meta_local_connections c ON c.id=j.connection_id WHERE j.id=$1 AND c.tenant_id=$2 AND c.user_id=$3',[id,a.active_tenant_id,a.user_id])).rows[0];
 if(!job)throw fail(404,'Comando não encontrado.');
 return {...job,uncertain:job.status==='leased'&&Date.now()-new Date(job.claimed_at).getTime()>20*60000};
}
export async function disconnectLocalConnector(pool,a){
 requirePermission(a,'marketing.manage');
 await pool.query("UPDATE meta_local_connections SET status='disconnected',token_hash=NULL,pair_hash=NULL WHERE tenant_id=$1 AND user_id=$2 AND status IN ('pending','active')",[a.active_tenant_id,a.user_id]);
 return {disconnected:true};
}
