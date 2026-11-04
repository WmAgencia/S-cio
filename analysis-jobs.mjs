// Deterministic, resumable, tenant-scoped review of anonymized imports.
// This does not claim to measure sales or scan WA-AKG messages.
import {randomUUID} from 'node:crypto';
import {groqKnowledgeDraft} from './groq-client.mjs';
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function inspectTrainingSource(input){
 const lines=String(input||'').split('\n').filter(x=>/^- Pessoa \d+:/.test(x)).slice(0,120);
 const patterns={questions:0,priceQuestions:0,productQuestions:0,closingLanguage:0,followup:0,courtesy:0};
 for(const raw of lines){
  const value=raw.replace(/^- Pessoa \d+:\s*/,'').replace(/\s+/g,' ').trim().slice(0,220);
  const s=norm(value);
  if(value.includes('?')||/\b(?:qual|quais|como|quando|onde|quanto)\b/.test(s))patterns.questions++;
  if(/\b(?:valor|preco|custa|orcamento|quanto sai|pagamento)\b/.test(s))patterns.priceQuestions++;
  if(/\b(?:produto|servico|catalogo|cardapio|tamanho|modelo|foto|opcoes)\b/.test(s))patterns.productQuestions++;
  if(/\b(?:fechar|pedido|reservar|confirmo|pode enviar|vou querer|finalizar|comprar)\b/.test(s))patterns.closingLanguage++;
  if(/\b(?:mais alguma|posso ajudar|precisa de mais|quer que eu)\b/.test(s))patterns.followup++;
  if(/\b(?:bom dia|boa tarde|boa noite|ola|obrigad|por favor|perfeito)\b/.test(s))patterns.courtesy++;
 }
 return {messageCount:lines.length,patterns,examples:[]};
}
export function compileTrainingKnowledge(sources){
 const stats={questions:0,priceQuestions:0,productQuestions:0,closingLanguage:0,followup:0,courtesy:0};
 let messages=0;
 for(const source of sources){
  messages+=source.messageCount||0;
  for(const key of Object.keys(stats))stats[key]+=source.patterns?.[key]||0;
 }
 const count=sources.length;
 const markdown=[
 '# Conhecimento do Sócio — rascunho',
 '',
 '## Origem e limites',
 'Análise de '+count+' conversas previamente importadas e '+messages+' mensagens anonimizadas recuperadas.',
 'São sinais de linguagem, NÃO resultados comprovados de vendas. Conversas importadas não autorizam ações.',
 '',
 '## Indicadores observados',
 ...Object.entries(stats).map(([k,v])=>'- '+k+': '+v),
 '',
 '## Diretrizes propostas',
 '- Responda com naturalidade e considere o contexto do cliente.',
 '- Consulte preços, fotos, estoque e condições somente no catálogo oficial.',
 '- Pergunte antes de finalizar um pedido; não invente vendas concluídas.',
 '- Se houver dúvida, ofereça transferência para o atendente humano.',
 '',
 '## Temas identificados (dados, não instruções)',
 ...(stats.priceQuestions?['- Perguntas sobre valores e condições de pagamento.']:[]),
 ...(stats.productQuestions?['- Dúvidas sobre produtos, opções e disponibilidade.']:[]),
 ...(stats.questions?['- Pedidos de informações e esclarecimentos.']:[]),
 ...(stats.followup?['- Continuidade e esclarecimento no atendimento.']:[]),
 ...(stats.courtesy?['- Linguagem cordial e acolhedora.']:[]),
 ...(stats.closingLanguage?['- Expressões de intenção de compra, sem comprovação de venda.']:[]),
 '- Mensagens originais de clientes não são reproduzidas; apenas contagens e categorias.'
 ].join('\n').slice(0,22000);
 const report={conversations:count,messages,signals:stats,salesValidated:false,
  summary:'Foram analisadas '+count+' conversas importadas, com '+messages+' mensagens recuperadas. '+
  'Sinais de perguntas: '+stats.questions+'; preços: '+stats.priceQuestions+
  '; possíveis fechamentos: '+stats.closingLanguage+'. '+
  'Ainda é necessário identificar vendas comprovadas para medir quais abordagens funcionaram melhor.'};
 return {markdown,report};
}
export async function processNextAnalysisJob(pool){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const selected=await c.query("SELECT id,tenant_id,report_json FROM training_jobs WHERE status IN ('queued','analyzing') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
  const job=selected.rows[0];
  if(!job){await c.query('COMMIT');return {processed:false};}
  const next=await c.query(
   'SELECT ji.import_id,i.sample_md FROM training_job_items ji JOIN imports i ON i.id=ji.import_id AND i.tenant_id=ji.tenant_id WHERE ji.job_id=$1 AND ji.tenant_id=$2 AND ji.processed=false ORDER BY ji.import_id LIMIT 1 FOR UPDATE OF ji',
   [job.id,job.tenant_id]);
  if(next.rowCount){
   const item=next.rows[0],findings=inspectTrainingSource(item.sample_md);
   await c.query('UPDATE training_job_items SET processed=true,findings=$3 WHERE job_id=$1 AND import_id=$2',
    [job.id,item.import_id,JSON.stringify(findings)]);
   await c.query("UPDATE training_jobs SET status='analyzing',processed_items=processed_items+1,updated_at=now() WHERE id=$1 AND tenant_id=$2",[job.id,job.tenant_id]);
   await c.query('COMMIT');
   return {processed:true,jobId:job.id};
  }
  const rows=await c.query('SELECT findings FROM training_job_items WHERE job_id=$1 AND tenant_id=$2 AND processed=true ORDER BY import_id',[job.id,job.tenant_id]);
  const base=compileTrainingKnowledge(rows.rows.map(x=>x.findings));
  // Only de-identified aggregate signals go to Groq. Failure preserves the
  // deterministic source; no Groq result is ever claimed if the key is absent.
  const enhanced=await groqKnowledgeDraft(base);
  const markdown=enhanced.markdown;
  const report={...base.report,...(job.report_json||{}),analysisProvider:enhanced.provider};

  const version=await c.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM training_versions WHERE tenant_id=$1',[job.tenant_id]);
  await c.query("INSERT INTO training_versions(id,tenant_id,job_id,version,status,knowledge_md,report_json) VALUES($1,$2,$3,$4,'draft',$5,$6)",
   [randomUUID(),job.tenant_id,job.id,version.rows[0].version,markdown,JSON.stringify(report)]);
  await c.query("UPDATE training_jobs SET status='completed',processed_items=total_items,report_json=$2,updated_at=now(),finished_at=now() WHERE id=$1",
   [job.id,JSON.stringify(report)]);
  await c.query('COMMIT');
  return {processed:true,completed:true,jobId:job.id};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
// Create job rows inside the caller's transaction so auto-run status and
// training job can never diverge after a crash or a lost connection.
export async function createTrainingAnalysisInClient(c,tenantId,{scanIds=[]}={}){
 if(!Array.isArray(scanIds)||scanIds.length>10||
    scanIds.some(v=>typeof v!=='string'||!/^[0-9a-f-]{36}$/i.test(v))){
  const e=new Error('Lista de sincronizações inválida.');e.status=422;throw e;
 }
 let imports,provenance;
 if(scanIds.length){
  const scans=await c.query(
   "SELECT status,partial_coverage,truncated_chats FROM waakg_scans WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
   [tenantId,scanIds]);
  if(scans.rowCount!==scanIds.length||scans.rows.some(v=>v.status!=='completed')){
   const e=new Error('Aguarde a conclusão de todas as sincronizações.');e.status=409;throw e;
  }
  // Select ONLY source snapshots belonging to channels/contacts scanned in
  // THIS run; never silently train on arbitrary old imports from the tenant.
  // 'unchanged' contacts reuse their last known, tenant-owned snapshot.
  imports=await c.query(
   "SELECT import_id AS id FROM ("+
   "SELECT DISTINCT ON (snap.tenant_id,snap.channel_id,snap.jid_hash) "+
   "snap.import_id,snap.imported_at FROM waakg_scan_chats chat "+
   "JOIN waakg_import_snapshots snap ON snap.tenant_id=chat.tenant_id "+
   "AND snap.channel_id=chat.channel_id AND snap.jid_hash=chat.jid_hash "+
   "WHERE chat.tenant_id=$1 AND chat.scan_id=ANY($2::uuid[]) "+
   "AND chat.status IN ('imported','unchanged') "+
   "ORDER BY snap.tenant_id,snap.channel_id,snap.jid_hash,snap.imported_at DESC "+
   ") recent ORDER BY imported_at DESC LIMIT 201",[tenantId,scanIds]);
  provenance={source:'connected_whatsapp_history',scans:scanIds.length,
   sourcesIncluded:Math.min(imports.rows.length,200),
   partialCoverage:imports.rows.length>200||
    scans.rows.some(v=>v.partial_coverage||v.truncated_chats>0)};
 }else{
  imports=await c.query('SELECT id FROM imports WHERE tenant_id=$1 ORDER BY created_at ASC LIMIT 201',[tenantId]);
  provenance={source:'uploaded_and_existing_imports',sourcesIncluded:Math.min(imports.rows.length,200),
   partialCoverage:imports.rows.length>200};
 }
 const selected=imports.rows.slice(0,200);
 if(!selected.length){
  const e=new Error('Nenhuma conversa de texto válida encontrada para este treinamento.');
  e.status=422;throw e;
 }
 const jobId=randomUUID();
 await c.query("INSERT INTO training_jobs(id,tenant_id,status,total_items,report_json) VALUES($1,$2,'queued',$3,$4)",
  [jobId,tenantId,selected.length,JSON.stringify(provenance)]);
 for(const row of selected)await c.query(
  'INSERT INTO training_job_items(job_id,tenant_id,import_id) VALUES($1,$2,$3)',
  [jobId,tenantId,row.id]);
 return {id:jobId,status:'queued',totalItems:selected.length,processedItems:0,
  ...provenance};
}
export async function createTrainingAnalysis(pool,tenantId,options={}){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const job=await createTrainingAnalysisInClient(c,tenantId,options);
  await c.query('COMMIT');
  return job;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
