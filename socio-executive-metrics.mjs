// Tenant-scoped executive reporting; ad platform conversions and draft sales are not receipts.
import {requirePermission} from './team-permissions.mjs';
export async function getExecutiveMetrics(pool,actor){
 requirePermission(actor,'audit.read');
 const tenant=actor.active_tenant_id;
 const counts=await pool.query(`SELECT
   (SELECT count(*)::int FROM conversations WHERE tenant_id=$1 AND status<>'resolved') AS open_conversations,
   (SELECT count(*)::int FROM messages WHERE tenant_id=$1 AND direction='inbound' AND
    created_at >= (date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS received_today,
   (SELECT count(*)::int FROM messages WHERE tenant_id=$1 AND direction='outbound'
    AND provider_id IS NOT NULL AND created_at >=
    (date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS sent_today`,[tenant]);
 const row=counts.rows[0]||{};
 return {readOnly:true,tenantScoped:true,periodDays:30,checkedAt:new Date().toISOString(),
  counts:{openConversations:Number(row.open_conversations||0),
   receivedToday:Number(row.received_today||0),sentToday:Number(row.sent_today||0)},
  paidSales:null,confirmedRevenueCents:null,
  notes:['Vendas e faturamento não são rastreados sem conciliação financeira.',
   'Gasto de anúncios depende de uma consulta de cada conta autorizada.']};
}
