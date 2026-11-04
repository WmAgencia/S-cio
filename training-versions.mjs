// Tenant-scoped knowledge approval, revision and rollback.
// A tenant row lock serializes simultaneous approvals so the published
// Markdown and the agent's active knowledge remain exactly in sync.
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function validateKnowledgeMarkdown(markdown){
 if(typeof markdown!=='string'||markdown.length>22000||
    markdown.trim().length<70||/[\u0000-\u0008\u000e-\u001f]/.test(markdown))
  throw fail(422,'O Markdown deve conter entre 70 e 22000 caracteres.');
 const value=markdown.trim();
 if(!/^#\s+\S/m.test(value))
  throw fail(422,'O documento precisa conter um título Markdown.');
 return value;
}
export async function reviseTrainingDraft(pool,{tenantId,versionId,markdown}){
 if(!uuid.test(versionId))throw fail(422,'Versão inválida.');
 const content=validateKnowledgeMarkdown(markdown);
 const updated=await pool.query(
  "UPDATE training_versions SET knowledge_md=$3,report_json=jsonb_set(report_json,'{humanEdited}','true'::jsonb,true) "+
  "WHERE tenant_id=$1 AND id=$2 AND status='draft' RETURNING id,version",
  [tenantId,versionId,content]);
 if(!updated.rowCount)throw fail(409,'Somente rascunhos da sua empresa podem ser editados.');
 return {ok:true,id:updated.rows[0].id,version:updated.rows[0].version};
}
export async function publishTrainingVersion(pool,{tenantId,versionId,mode='approve'}){
 if(!uuid.test(versionId)||!['approve','restore'].includes(mode))
  throw fail(422,'Seleção de versão inválida.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const owner=await c.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenantId]);
  if(!owner.rowCount)throw fail(404,'Empresa não encontrada.');
  const expected=mode==='approve'?'draft':'archived';
  const version=await c.query(
   'SELECT id,version,status,knowledge_md FROM training_versions WHERE tenant_id=$1 AND id=$2 AND status=$3 FOR UPDATE',
   [tenantId,versionId,expected]);
  if(!version.rowCount)
   throw fail(409,mode==='approve'?'Rascunho indisponível para aprovação.':
    'Apenas versões arquivadas da mesma empresa podem ser restauradas.');
  const prior=await c.query(
   "SELECT id,version FROM training_versions WHERE tenant_id=$1 AND status='approved'",
   [tenantId]);
  await c.query(
   "UPDATE training_versions SET status='archived' WHERE tenant_id=$1 AND status='approved'",
   [tenantId]);
  await c.query(
   "UPDATE training_versions SET status='approved',approved_at=now() WHERE tenant_id=$1 AND id=$2",
   [tenantId,versionId]);
  const agent=await c.query(
   'UPDATE agents SET knowledge_md=$2,updated_at=now() WHERE tenant_id=$1 RETURNING tenant_id',
   [tenantId,version.rows[0].knowledge_md]);
  if(!agent.rowCount)throw fail(409,'Crie o agente da empresa antes de aprovar conhecimento.');
  await c.query('COMMIT');
  return {ok:true,versionId,version:version.rows[0].version,
   previousVersion:prior.rows[0]?.version||null,restored:mode==='restore',autoReply:false};
 }catch(err){await c.query('ROLLBACK').catch(()=>{});throw err;}
 finally{c.release();}
}
