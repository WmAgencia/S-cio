// Read-only WhatsApp sales funnel based on actual tenant-scoped WA-AKG messages.
// A prefilled code is indicative source evidence, never proof of a Meta click.
// Only Stripe TEST signed-webhook-paid orders are known here, and never real revenue.
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});

const SQL=[
 "WITH attributed AS (",
 " SELECT a.tenant_id,a.link_id,a.conversation_id,first_inbound.created_at AS attributed_at,",
 " (SELECT MIN(reply.created_at) FROM messages reply",
 " WHERE reply.tenant_id=a.tenant_id AND reply.conversation_id=a.conversation_id",
 " AND reply.direction='outbound' AND reply.provider_id IS NOT NULL",
 " AND reply.created_at>first_inbound.created_at) AS first_business_reply_at",
 " FROM wa_lead_attributions a",
 " JOIN messages first_inbound ON first_inbound.tenant_id=a.tenant_id AND first_inbound.id=a.inbound_message_id",
 " AND first_inbound.direction='inbound'",
 " WHERE a.tenant_id=$1",
 "), per_lead AS (",
 " SELECT a.tenant_id,a.link_id,a.conversation_id,a.attributed_at,a.first_business_reply_at,",
 " EXISTS(SELECT 1 FROM messages follow_up",
 " WHERE follow_up.tenant_id=a.tenant_id AND follow_up.conversation_id=a.conversation_id",
 " AND follow_up.direction='inbound' AND follow_up.created_at>a.first_business_reply_at)",
 " AS customer_followed_up",
 " FROM attributed a",
 ")",
 " SELECT l.id,l.label,l.account_id,l.campaign_id,l.adset_id,l.ad_id,l.active,",
 " COUNT(p.conversation_id)::int AS conversations,",
 " COUNT(p.first_business_reply_at)::int AS business_responded,",
 " COUNT(p.conversation_id) FILTER (WHERE p.customer_followed_up)::int AS customer_followed_up,",
 " COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (p.first_business_reply_at-p.attributed_at)))",
 " FILTER (WHERE p.first_business_reply_at IS NOT NULL))::int,NULL) AS avg_business_reply_seconds",
 " FROM wa_tracking_links l LEFT JOIN per_lead p ON p.link_id=l.id AND p.tenant_id=l.tenant_id",
 " WHERE l.tenant_id=$1",
 " GROUP BY l.id ORDER BY l.created_at DESC LIMIT 100"
].join(' ');

export async function readWhatsAppFunnel(pool,actor,{env=process.env}={}){
 requirePermission(actor,'marketing.read');
 assertApiFeature(actor.features,'/api/marketing/tools');
 assertApiFeature(actor.features,'/api/waakg');
 if(actor.tenant_status==='paused')throw fail(403,'Empresa pausada.');
 const result=await pool.query(SQL,[actor.active_tenant_id]);
 return {period:'Desde o primeiro código observado em cada link',method:'message_code',confidence:'indicative',
  readOnly:true,partial:result.rows.length===100,collectionEnabled:env.SOCIO_ATTRIBUTION_ENABLED==='true',
  items:result.rows.map(row=>({
   id:row.id,label:row.label,accountId:row.account_id,campaignId:row.campaign_id,
   adsetId:row.adset_id,adId:row.ad_id,active:row.active,
   conversations:row.conversations,businessResponded:row.business_responded,
   customerFollowedUp:row.customer_followed_up,
   averageFirstBusinessReplySeconds:row.avg_business_reply_seconds,
   livePaidOrders:null,liveRevenueCents:null
  })),
  note:'As conversas com código indicam possível origem do anúncio, não clique confirmado pela Meta. Respostas da empresa exigem uma mensagem outbound identificada pelo provedor. Vendas e receita não são rastreadas neste relatório.'
 };
}
export function formatWhatsAppFunnel(report,{max=5}={}){
 if(!report||!Array.isArray(report.items))throw fail(503,'Funil de WhatsApp indisponível.');
 const lines=['Funil WhatsApp WA-AKG (origem apenas indicativa; nenhuma operação realizada):'];
 const rows=report.items.slice(0,Math.max(1,Math.min(10,max)));
 if(!rows.length)lines.push('Nenhum link de rastreamento cadastrado ou com dados disponíveis. Isso não prova ausência de clientes no WhatsApp.');
 for(const row of rows){
  lines.push('• '+String(row.label||'Link').slice(0,90)+': '+Number(row.conversations||0)+
   ' conversas com código, '+Number(row.businessResponded||0)+' com resposta registrada da empresa e '+
   Number(row.customerFollowedUp||0)+' com nova resposta do cliente.');
 }
 if(report.collectionEnabled===false)
  lines.push('Coleta automática de novos códigos desativada. Números podem estar incompletos.');
 if(report.partial||report.items.length>rows.length)
  lines.push('Relatório parcial: consulte todos os links antes de comparar resultados.');
 lines.push('Vendas reais e receita confirmada: indisponíveis; sem integração de pagamento de produção validada. Não calcule ROAS com esses dados.');
 lines.push('O código pré-preenchido não comprova clique Meta. Nenhuma campanha, gasto ou mensagem foi alterada.');
 return lines.join('\n');
}
