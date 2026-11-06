// Read-only, tenant-isolated seven-day demonstration report for Consecom master.
// Counts are operational signals, never inferred revenues or saved time.
const bad=(status,message)=>Object.assign(new Error(message),{status});
export async function getTrialReport(pool,tenantId){
 const query=await pool.query('SELECT id,name,status,plan,trial_started_at,trial_ends_at,contracted_at FROM tenants WHERE id=$1',[tenantId]);
 if(!query.rowCount)throw bad(404,'Empresa não encontrada.');
 const t=query.rows[0];
 if(!t.trial_started_at||!t.trial_ends_at)throw bad(409,'Esta empresa não possui período experimental datado.');
 const first=new Date(t.trial_started_at),last=new Date(t.trial_ends_at),until=last>new Date()?new Date():last;
 if(!Number.isFinite(first.getTime())||!Number.isFinite(last.getTime())||first>=last)throw bad(409,'Datas de demonstração inválidas.');
 const [messages,chats,quotes,intents,approvedKnowledge,connections]=await Promise.all([
  pool.query("SELECT count(*)::int n FROM messages WHERE tenant_id=$1 AND direction='inbound' AND created_at BETWEEN $2 AND $3",[tenantId,first,until]),
  pool.query('SELECT count(*)::int n FROM conversations WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3',[tenantId,first,until]),
  pool.query('SELECT count(*)::int n FROM quote_requests WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3',[tenantId,first,until]),
  pool.query('SELECT count(*)::int n FROM sale_intents WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3',[tenantId,first,until]),
  pool.query('SELECT count(*)::int n FROM training_versions WHERE tenant_id=$1 AND approved_at BETWEEN $2 AND $3',[tenantId,first,until]),
  pool.query("SELECT count(*)::int n FROM channels WHERE tenant_id=$1 AND status='connected'",[tenantId])
 ]);
 return {tenant:{id:t.id,name:t.name,status:t.status,plan:t.plan},period:{start:first.toISOString(),end:last.toISOString(),
  observedUntil:until.toISOString(),expired:last<=new Date(),contractedAt:t.contracted_at||null},
  activity:{inboundMessages:messages.rows[0].n,conversationsStarted:chats.rows[0].n,
   quoteRequests:quotes.rows[0].n,purchaseIntents:intents.rows[0].n,
   trainingVersionsApproved:approvedKnowledge.rows[0].n,currentlyConnectedChannels:connections.rows[0].n},
  note:'Indicadores operacionais registrados. Intenção de compra não comprova venda, e este relatório não estima faturamento nem horas economizadas.'};
}
