// Sócio owner companion: read-only aggregate operational facts, scoped to one tenant.
// No arbitrary SQL, no outbound WhatsApp, no mutation or personal client data.
export async function ownerSummary(pool,tenantId){
 const queries={
  chats:"SELECT count(*)::int AS n FROM conversations WHERE tenant_id=$1 AND created_at>=now()-interval '7 days'",
  received:"SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND direction='inbound' AND created_at>=now()-interval '7 days'",
  quotes:"SELECT count(*)::int AS n FROM quote_requests WHERE tenant_id=$1 AND created_at>=now()-interval '7 days'",
  sales:"SELECT count(*)::int AS n FROM sale_intents WHERE tenant_id=$1 AND created_at>=now()-interval '7 days'",
  channels:"SELECT count(*)::int AS n FROM channels WHERE tenant_id=$1 AND status='connected'",
  catalog:"SELECT count(*)::int AS n FROM products WHERE tenant_id=$1 AND active=true",
  lowStock:"SELECT count(*)::int AS n FROM products WHERE tenant_id=$1 AND active=true AND stock_quantity IS NOT NULL AND stock_quantity<=3",
  training:"SELECT count(*)::int AS n FROM training_versions WHERE tenant_id=$1 AND status='approved'"
 };
 const values=await Promise.all(Object.entries(queries).map(async([key,sql])=>{
  try{const data=await pool.query(sql,[tenantId]);return [key,Number(data.rows[0]?.n)||0];}
  catch{return [key,null];}
 }));
 return {period:'Últimos 7 dias, exceto canais/produtos/treinamento',...Object.fromEntries(values)};
}
export function ownerReadOnlyAnswer(question,metrics){
 const text=String(question||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const f=(key)=>metrics[key]===null?'indisponível para esta consulta':String(metrics[key]);
 if(/or[cç]ament|cotac/.test(text))return 'Foram registrados '+f('quotes')+' pedidos de orçamento nos últimos sete dias. Isso não indica contratos fechados.';
 if(/venda|oportunidade|compr/.test(text))return 'Foram identificadas '+f('sales')+' oportunidades de compra nos últimos sete dias. Não são vendas pagas confirmadas.';
 if(/whatsapp|numero|conex/.test(text))return 'O Sócio registra '+f('channels')+' canal(is) conectado(s). Para detalhes e reconexão, abra WhatsApp.';
 if(/estoque|produto|cat[aá]logo/.test(text))return 'Há '+f('catalog')+' produtos ativos, sendo '+f('lowStock')+' com estoque informado de até três unidades.';
 if(/trein|ia|aprend/.test(text))return 'O sistema tem '+f('training')+' versão(ões) aprovada(s) de conhecimento. Para alterar, use Inteligência Artificial.';
 if(/mensagen|atend|cliente|conversa/.test(text))return 'Nos últimos sete dias entraram '+f('received')+' mensagens e foram criadas '+f('chats')+' conversas.';
 return 'Resumo dos últimos sete dias: '+f('received')+' mensagens recebidas, '+f('quotes')+' pedidos de orçamento e '+f('sales')+
 ' oportunidades de compra. Estado atual: '+f('channels')+' canais conectados e '+f('catalog')+' produtos ativos. Os números não representam faturamento.';
}
