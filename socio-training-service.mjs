// Tenant-scoped Prospector-inspired onboarding and social evidence for Sócio.
// The interface can prepare drafts, but never activates training, sends WhatsApp or charges clients.
import {randomUUID,randomBytes,createHash,createCipheriv} from 'node:crypto';
import {initialInterview,advanceInterview,interviewView,compileInterviewMarkdown,validateSocialProof,validateClosingSettings} from './socio-onboarding.mjs';
import {normalizeImage,putPrivateImage,getPrivateImage,deletePrivateImage,putPrivatePdf,normalizePdf,mediaConfigured} from './media-storage.mjs';
const error=(status,message)=>Object.assign(new Error(message),{status});
const clean=(s,max)=>String(s||'').replace(/[\u0000-\u001f\u007f<>]/g,' ').trim().slice(0,max);
export async function interviewStatus(pool,tenantId){
 const r=await pool.query('SELECT state,updated_at FROM socio_interviews WHERE tenant_id=$1',[tenantId]);
 const state=r.rows[0]?.state||null;
 return {view:state?interviewView(state):null,state:state?{answers:state.answers,phase:state.phase}:null,updatedAt:r.rows[0]?.updated_at||null};
}
export async function startInterview(pool,tenantId){
 const state=initialInterview();
 await pool.query('INSERT INTO socio_interviews(tenant_id,state) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET state=excluded.state,updated_at=now()',
 [tenantId,JSON.stringify(state)]);
 return interviewStatus(pool,tenantId);
}
export async function submitInterviewAnswer(pool,tenantId,answer){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const row=await c.query('SELECT state FROM socio_interviews WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
  if(!row.rowCount)throw error(409,'Inicie a entrevista antes de responder.');
  let next;try{next=advanceInterview(row.rows[0].state,answer);}catch(e){throw error(422,e.message);}
  await c.query('UPDATE socio_interviews SET state=$2,updated_at=now() WHERE tenant_id=$1',[tenantId,JSON.stringify(next)]);
  await c.query('COMMIT');
  return {view:interviewView(next),state:{answers:next.answers,phase:next.phase}};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function createInterviewDraft(pool,tenantId){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenantId]);
  const row=await c.query('SELECT state FROM socio_interviews WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
  if(!row.rowCount||row.rows[0].state?.phase!=='review')throw error(409,'Conclua a entrevista primeiro.');
  const proofs=await c.query('SELECT kind,title,description,url,approved FROM socio_social_proofs WHERE tenant_id=$1 AND approved=true ORDER BY created_at DESC LIMIT 20',[tenantId]);
  let markdown;try{markdown=compileInterviewMarkdown(row.rows[0].state,proofs.rows);}catch(e){throw error(422,e.message);}
  const number=await c.query('SELECT COALESCE(MAX(version),0)+1 AS next FROM training_versions WHERE tenant_id=$1',[tenantId]);
  const version=Number(number.rows[0].next),jobId=randomUUID(),id=randomUUID();
  await c.query("INSERT INTO training_jobs(id,tenant_id,status,total_items,processed_items,report_json,finished_at) VALUES($1,$2,'completed',1,1,$3,now())",
   [jobId,tenantId,JSON.stringify({source:'guided_interview',summary:'Entrevista revisada; rascunho aguardando aprovação humana.'})]);
  await c.query("UPDATE training_versions SET status='archived' WHERE tenant_id=$1 AND status='draft'",[tenantId]);
  await c.query("INSERT INTO training_versions(id,tenant_id,job_id,version,status,knowledge_md,report_json) VALUES($1,$2,$3,$4,'draft',$5,$6)",
   [id,tenantId,jobId,version,markdown,JSON.stringify({source:'guided_interview',summary:'Documento gerado pela entrevista.'})]);
  await c.query('COMMIT');
  return {id,version,status:'draft',autoActivated:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
const publicProof=r=>({id:r.id,kind:r.kind,title:r.title,description:r.description,url:r.url,
 mediaType:r.media_type,hasMedia:!!r.object_key,mediaUrl:r.object_key?'/api/training/proofs/'+r.id+'/media':null,
 approved:r.approved,createdAt:r.created_at});
export async function listProofs(pool,tenantId){
 const res=await pool.query('SELECT * FROM socio_social_proofs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 60',[tenantId]);
 return res.rows.map(publicProof);
}
export async function createProof(pool,tenantId,data){
 let parsed;try{parsed=validateSocialProof(data);}catch(e){throw error(422,e.message);}
 const id=randomUUID(),kind=parsed.kind;
 let objectKey=null,mediaType=null,buffer=null;
 if(data.imageBase64&&data.pdfBase64)throw error(422,'Envie uma imagem ou PDF, não ambos.');
 if(data.imageBase64){
  if(!mediaConfigured())throw error(503,'Armazenamento privado indisponível.');
  const result=await normalizeImage(data.imageBase64);
  buffer=result.bytes;mediaType='image/jpeg';objectKey=tenantId+'/proofs/'+id+'.jpg';
 }else if(data.pdfBase64){
  if(!mediaConfigured())throw error(503,'Armazenamento privado indisponível.');
  buffer=normalizePdf(data.pdfBase64);mediaType='application/pdf';objectKey=tenantId+'/proofs/'+id+'.pdf';
 }
 if(!parsed.url&&!objectKey)throw error(422,'Informe um link HTTPS ou selecione um arquivo.');
 const count=await pool.query('SELECT count(*)::int AS n FROM socio_social_proofs WHERE tenant_id=$1',[tenantId]);
 if(count.rows[0].n>=35)throw error(422,'Limite de 35 provas sociais por empresa.');
 if(objectKey){if(mediaType==='image/jpeg')await putPrivateImage(objectKey,buffer);else await putPrivatePdf(objectKey,buffer);}
 try{
  const r=await pool.query('INSERT INTO socio_social_proofs(id,tenant_id,kind,title,description,url,object_key,media_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
   [id,tenantId,kind,parsed.title,parsed.description,parsed.url,objectKey,mediaType]);
  return publicProof(r.rows[0]);
 }catch(e){if(objectKey)await deletePrivateImage(objectKey).catch(()=>{});throw e;}
}
export async function approveProof(pool,tenantId,id,approved){
 const r=await pool.query('UPDATE socio_social_proofs SET approved=$3,approved_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenantId,id,approved]);
 if(!r.rowCount)throw error(404,'Material não encontrado.');
 return publicProof(r.rows[0]);
}
export async function removeProof(pool,tenantId,id){
 const r=await pool.query('DELETE FROM socio_social_proofs WHERE tenant_id=$1 AND id=$2 RETURNING object_key',[tenantId,id]);
 if(!r.rowCount)throw error(404,'Material não encontrado.');
 if(r.rows[0].object_key)await deletePrivateImage(r.rows[0].object_key).catch(()=>{});
 return {ok:true};
}
export async function readProofMedia(pool,tenantId,id){
 const r=await pool.query('SELECT object_key,media_type FROM socio_social_proofs WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
 if(!r.rowCount||!r.rows[0].object_key)throw error(404,'Arquivo não encontrado.');
 return {bytes:await getPrivateImage(r.rows[0].object_key),mime:r.rows[0].media_type};
}
export async function approvedEvidenceText(pool,tenantId){
 const result=await pool.query('SELECT kind,title,description,url,object_key FROM socio_social_proofs WHERE tenant_id=$1 AND approved=true ORDER BY created_at DESC LIMIT 20',[tenantId]);
 return result.rows.map(x=>'- '+x.kind+': '+x.title+' — '+x.description+
  (x.url?' | '+x.url:' | Arquivo aprovado e privado, compartilhar apenas por canal autorizado')).join('\n').slice(0,4200);
}
function encryptPix(value,env=process.env){
 const secret=String(env.SOCIO_PAYMENT_CONFIG_KEY||'');
 if(secret.length<32)throw error(503,'Configure SOCIO_PAYMENT_CONFIG_KEY com 32 ou mais caracteres antes de cadastrar PIX.');
 const iv=randomBytes(12),key=createHash('sha256').update(secret).digest(),enc=createCipheriv('aes-256-gcm',key,iv);
 const cipher=Buffer.concat([enc.update(value,'utf8'),enc.final()]);
 return 'v1:'+iv.toString('base64')+':'+enc.getAuthTag().toString('base64')+':'+cipher.toString('base64');
}
const publicPolicy=row=>({mode:row?.mode||'handoff',methods:row?.methods||[],depositPercent:row?.deposit_percent||0,
 pixConfigured:!!row?.pix_ciphertext,pixName:row?.pix_name||''});
export async function getClosingPolicy(pool,tenantId){
 const r=await pool.query('SELECT * FROM socio_closing_policies WHERE tenant_id=$1',[tenantId]);
 return publicPolicy(r.rows[0]);
}
export async function updateClosingPolicy(pool,tenantId,data,env=process.env){
 let config;try{config=validateClosingSettings(data);}catch(e){throw error(422,e.message);}
 const prev=await pool.query('SELECT pix_ciphertext,pix_name FROM socio_closing_policies WHERE tenant_id=$1',[tenantId]);
 const original=prev.rows[0]||{};
 const key=clean(data.pixKey,140),name=clean(data.pixName??original.pix_name,120);
 let cipher=config.mode==='proposal'&&config.methods.includes('pix')?original.pix_ciphertext||null:null;
 if(data.pixKey===null||data.pixKey==='')cipher=null;
 else if(key){
  if(key.length<7||!/^[\w@.+-]+$/u.test(key))throw error(422,'Chave PIX inválida.');
  cipher=encryptPix(key,env);
 }
 const r=await pool.query('INSERT INTO socio_closing_policies(tenant_id,mode,methods,deposit_percent,pix_ciphertext,pix_name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode,methods=excluded.methods,deposit_percent=excluded.deposit_percent,pix_ciphertext=excluded.pix_ciphertext,pix_name=excluded.pix_name,updated_at=now() RETURNING *',
 [tenantId,config.mode,config.methods,config.depositPercent,cipher,name]);
 return publicPolicy(r.rows[0]);
}
