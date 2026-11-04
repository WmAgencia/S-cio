// Read-only WA-AKG historical synchronizer. Uses row leases so a crash resumes.
// Never sends WhatsApp messages. Raw chats are never persisted; JIDs are AES-GCM
// encrypted and the persisted training examples are anonymized.
import {randomUUID} from 'node:crypto';
import {
 gatewayConfigured,listAvailableChats,loadChatSample,
 encryptJid,decryptJid,jidHash
} from './waakg-adapter.mjs';

async function claim(pool){
 const c=await pool.connect(),token=randomUUID();
 try{
  await c.query('BEGIN');
  const q=await c.query(
   "SELECT id FROM waakg_scans WHERE status IN ('queued','scanning','importing') AND (lease_until IS NULL OR lease_until<now()) "+
   "AND tenant_id IN (SELECT id FROM tenants WHERE COALESCE((features->>'whatsapp')::boolean,true)=true) "+
   "ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
  );
  if(!q.rowCount){await c.query('COMMIT');return null;}
  const updated=await c.query(
   "UPDATE waakg_scans SET lease_token=$2,lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=$1 RETURNING *",
   [q.rows[0].id,token]
  );
  await c.query('COMMIT');
  return updated.rows[0];
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function release(pool,id,token,{errorCode=null}={}){
 await pool.query(
  "UPDATE waakg_scans SET status=CASE WHEN $3::text IS NULL THEN status ELSE 'failed' END,error_code=COALESCE($3,error_code),lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
  [id,token,errorCode]
 );
}
export async function processNextWaakgScan(pool,{env=process.env,fetchImpl=fetch}={}){
 if(!gatewayConfigured(env))return {processed:false,reason:'NOT_CONFIGURED'};
 const job=await claim(pool);
 if(!job)return {processed:false};
 const args={env,fetchImpl};
 try{
  const link=await pool.query('SELECT session_id FROM waakg_links WHERE tenant_id=$1 AND channel_id=$2',[job.tenant_id,job.channel_id]);
  if(!link.rowCount)throw new Error('SESSION_MISSING');
  const sessionId=link.rows[0].session_id;
  if(job.status==='queued'||job.status==='scanning'){
   const list=await listAvailableChats(sessionId,args);
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const guard=await c.query('SELECT status FROM waakg_scans WHERE id=$1 AND lease_token=$2 FOR UPDATE',[job.id,job.lease_token]);
    if(!guard.rowCount||!['queued','scanning'].includes(guard.rows[0].status)){await c.query('ROLLBACK');return {processed:false,reason:'PAUSED'};}
    for(const jid of list.jids)await c.query(
     "INSERT INTO waakg_scan_chats(id,tenant_id,channel_id,scan_id,jid_ciphertext,jid_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scan_id,jid_hash) DO NOTHING",
     [randomUUID(),job.tenant_id,job.channel_id,job.id,encryptJid(jid,job.tenant_id,job.channel_id,env),jidHash(jid,job.tenant_id,env)]
    );
    const total=await c.query('SELECT COUNT(*)::int AS n FROM waakg_scan_chats WHERE scan_id=$1',[job.id]);
    await c.query("UPDATE waakg_scans SET status='importing',total_chats=$2,partial_coverage=$3,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1",
     [job.id,total.rows[0].n,list.partial]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   return {processed:true,phase:'listed',count:list.jids.length,partial:list.partial};
  }
  const pending=await pool.query(
   "SELECT id,jid_ciphertext,jid_hash FROM waakg_scan_chats WHERE scan_id=$1 AND status='pending' ORDER BY created_at,id LIMIT 1",
   [job.id]
  );
  if(!pending.rowCount){
   await pool.query(
    "UPDATE waakg_scans SET status='completed',lease_until=NULL,lease_token=NULL,finished_at=now(),updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='importing'",
    [job.id,job.lease_token]
   );
   return {processed:true,completed:true};
  }
  const chat=pending.rows[0],jid=decryptJid(chat.jid_ciphertext,job.tenant_id,job.channel_id,env);
  const sample=await loadChatSample(sessionId,jid,args);
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const guard=await c.query('SELECT status FROM waakg_scans WHERE id=$1 AND lease_token=$2 FOR UPDATE',[job.id,job.lease_token]);
   if(!guard.rowCount||guard.rows[0].status!=='importing'){await c.query('ROLLBACK');return {processed:false,reason:'PAUSED'};}
   let status='empty',addedMessages=0;
   if(sample.messageCount>=3){
    const exists=await c.query(
     'SELECT id FROM waakg_import_snapshots WHERE tenant_id=$1 AND channel_id=$2 AND jid_hash=$3 AND fingerprint=$4',
     [job.tenant_id,job.channel_id,chat.jid_hash,sample.fingerprint]);
    if(exists.rowCount)status='unchanged';
    else{
     const importId=randomUUID(),fileName='waakg-'+chat.jid_hash.slice(0,12)+'.txt';
     await c.query(
      'INSERT INTO imports(id,tenant_id,filename,conversation_count,message_count,sample_md) VALUES($1,$2,$3,1,$4,$5)',
      [importId,job.tenant_id,fileName,sample.messageCount,sample.markdown]);
     await c.query(
      'INSERT INTO waakg_import_snapshots(id,tenant_id,channel_id,jid_hash,fingerprint,import_id) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),job.tenant_id,job.channel_id,chat.jid_hash,sample.fingerprint,importId]);
     status='imported';addedMessages=sample.messageCount;
    }
   }
   await c.query('UPDATE waakg_scan_chats SET status=$2,message_count=$3,truncated=$4 WHERE id=$1',
    [chat.id,status,sample.messageCount,sample.partial]);
   await c.query(
    "UPDATE waakg_scans SET processed_chats=processed_chats+1,imported_chats=imported_chats+$3,imported_messages=imported_messages+$4,truncated_chats=truncated_chats+$5,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2",
    [job.id,job.tenant_id,status==='imported'?1:0,addedMessages,sample.partial?1:0]);
   await c.query('COMMIT');
   return {processed:true,phase:'imported',status,partial:sample.partial};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }catch(e){
  // No PII, upstream raw response or credential contents in logs.
  const code=e.status===404?'SESSION_MISSING':e.status===503?'GATEWAY_UNAVAILABLE':'SYNC_FAILED';
  await release(pool,job.id,job.lease_token,{errorCode:code});
  return {processed:true,failed:true,errorCode:code};
 }
}
