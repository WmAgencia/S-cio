// Tenant-scoped executive dashboard. No "sales" or revenue is inferred from intents,
// quote acceptances, unverified payments or ad platform conversions.
import {requirePermission} from './team-permissions.mjs';
export async function getExecutiveMetrics(pool,actor){
 requirePermission(actor,'audit.read');
 const tenant=actor.active_tenant_id;
 const [counts,top] = await Promise.all([
  pool.query(`SELECT
   (SELECT count(*)::int FROM sale_intents WHERE tenant_id=$1 AND created_at >= now()-interval '30 days') AS opportunities,
   (SELECT count(*)::int FROM sale_intents WHERE tenant_id=$1 AND status='completed' AND updated_at>=now()-interval '30 days') AS completed_opportunities,
   (SELECT count(*)::int FROM sales_orders WHERE tenant_id=$1 AND created_at>=now()-interval '30 days') AS registered_orders,
   (SELECT count(*)::int FROM quote_requests WHERE tenant_id=$1 AND created_at>=now()-interval '30 days') AS quote_requests,
   (SELECT count(*)::int FROM quote_requests WHERE tenant_id=$1 AND status IN ('pending','preparing')) AS pending_quotes,
   (SELECT count(*)::int FROM conversations WHERE tenant_id=$1 AND status<>'resolved') AS open_conversations,
   (SELECT count(*)::int FROM messages WHERE tenant_id=$1 AND direction='inbound'
     AND created_at >=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS received_today,
   (SELECT count(*)::int FROM messages WHERE tenant_id=$1 AND direction='outbound' AND provider_id IS NOT NULL
     AND created_at >=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS sent_today`,[tenant]),
  pool.query(`SELECT p.id,p.name,count(*)::int AS requests,
    coalesce(sum((item->>'quantity')::int),0)::int AS requested_units
   FROM sale_intents si CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN jsonb_typeof(si.items)='array' THEN si.items ELSE '[]'::jsonb END) item
   JOIN products p ON p.id=(CASE WHEN (item->>'productId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
   WHERE si.tenant_id=$1 AND si.created_at>=now()-interval '30 days'
     AND (item->>'productId') ~* '^[0-9a-f-]{36}$'
   GROUP BY p.id,p.name ORDER BY requests DESC,p.name ASC LIMIT 5`,[tenant])
 ]);
 const row=counts.rows[0]||{};
 return {readOnly:true,tenantScoped:true,periodDays:30,checkedAt:new Date().toISOString(),
  counts:{opportunities:Number(row.opportunities||0),completedOpportunities:Number(row.completed_opportunities||0),
    registeredOrders:Number(row.registered_orders||0),quoteRequests:Number(row.quote_requests||0),
    pendingQuotes:Number(row.pending_quotes||0),openConversations:Number(row.open_conversations||0),
    receivedToday:Number(row.received_today||0),sentToday:Number(row.sent_today||0)},
  popularProducts:(top.rows||[]).map(x=>({id:x.id,name:x.name,requests:Number(x.requests),requestedUnits:Number(x.requested_units)})),
  paidSales:null,confirmedRevenueCents:null,
  notes:['Pedidos cadastrados não são vendas pagas.','Produto mais solicitado é baseado apenas em intenções com produto identificado.',
   'Gasto de anúncios exige consulta autorizada em cada provedor; CPC/CPA dependem das métricas reportadas por ele.']};
}
 THEN (item->>'productId')::uuid ELSE NULL END) AND p.tenant_id=si.tenant_id
   WHERE si.tenant_id=$1 AND si.created_at>=now()-interval '30 days'
     AND (item->>'productId') ~* '^[0-9a-f-]{36}$'
   GROUP BY p.id,p.name ORDER BY requests DESC,p.name ASC LIMIT 5`,[tenant])
 ]);
 const row=counts.rows[0]||{};
 return {readOnly:true,tenantScoped:true,periodDays:30,checkedAt:new Date().toISOString(),
  counts:{opportunities:Number(row.opportunities||0),completedOpportunities:Number(row.completed_opportunities||0),
    registeredOrders:Number(row.registered_orders||0),quoteRequests:Number(row.quote_requests||0),
    pendingQuotes:Number(row.pending_quotes||0),openConversations:Number(row.open_conversations||0),
    receivedToday:Number(row.received_today||0),sentToday:Number(row.sent_today||0)},
  popularProducts:(top.rows||[]).map(x=>({id:x.id,name:x.name,requests:Number(x.requests),requestedUnits:Number(x.requested_units)})),
  paidSales:null,confirmedRevenueCents:null,
  notes:['Pedidos cadastrados não são vendas pagas.','Produto mais solicitado é baseado apenas em intenções com produto identificado.',
   'Gasto de anúncios exige consulta autorizada em cada provedor; CPC/CPA dependem das métricas reportadas por ele.']};
}
