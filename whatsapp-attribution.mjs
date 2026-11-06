// WA-AKG attribution, phase 1: tenant-scoped, prefilled-message evidence only.
// A code observed in an inbound message is NOT proof that Meta delivered the click.
// This module NEVER sends WhatsApp, reads Meta credentials, or edits campaigns.
import {randomUUID,randomBytes} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const validId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const adId=x=>x===null||x===undefined||x===''?null:typeof x==='string'&&/^\d{4,30}$/.test(x)?x:false;
const label=x=>typeof x==='string'&&x.trim().length>=3&&x.trim().length<=90?x.trim():null;
const normalizePhone=x=>String(x||'').replace(/\D/g,'');
function authorize(actor,write=false){
 requirePermission(actor,write?'marketing.manage':'marketing.read');
 assertApiFeature(actor.features,'/api/marketing/tools');
 assertApiFeature(actor.features,'/api/waakg');
 if(actor.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}
export function validateTrackingInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!validId(input.channelId)||!label(input.label))
  throw fail(422,'Informe o WhatsApp conectado e uma identificação para o link.');
 const campaignId=adId(input.campaignId),adsetId=adId(input.adsetId),creativeAdId=adId(input.adId);
 if([campaignId,adsetId,creativeAdId].includes(false))throw fail(422,'IDs de campanha ou anúncio inválidos.');
 return {channelId:input.channelId,label:label(input.label),campaignId,adsetId,adId:creativeAdId};
}
export function buildPrefilledWhatsAppLink(phone,code){
 const digits=normalizePhone(phone);
 if(!/^55\d{10,11}$/.test(digits)||!/^SC[A-F0-9]{20}$/.test(code))throw fail(422,'Número WhatsApp ou código inválido.');
 const url=new URL('https://wa.me/'+digits);
 url.searchParams.set('text','Olá! Tenho interesse no anúncio ['+code+']');
 return url.href;
}
export async function createTrackingLink(pool,actor,input){
 authorize(actor,true);
 const data=validateTrackingInput(input);
 const row=await pool.query(
  "SELECT ch.id,ch.phone,s.account_id FROM channels ch "+
  "JOIN meta_official_account_selections s ON s.tenant_id=ch.tenant_id AND s.user_id=$3 "+
  "JOIN meta_official_grants g ON g.tenant_id=s.tenant_id AND g.user_id=s.user_id "+
  "AND g.expires_at>now() AND 'ads_read'=ANY(g.scopes) "+
  "WHERE ch.tenant_id=$1 AND ch.id=$2 AND ch.provider='waakg' AND ch.status='connected'",
  [actor.active_tenant_id,data.channelId,actor.user_id]);
 if(!row.rowCount)throw fail(409,'Conecte o WhatsApp da empresa e selecione sua conta Meta autorizada.');
 const {phone,account_id:accountId}=row.rows[0];
 const code='SC'+randomBytes(10).toString('hex').toUpperCase();
 const url=buildPrefilledWhatsAppLink(phone,code);
 const id=randomUUID();
 await pool.query(
  "INSERT INTO wa_tracking_links(id,tenant_id,channel_id,created_by,account_id,label,campaign_id,adset_id,ad_id,code,expires_at) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '90 days')",
  [id,actor.active_tenant_id,data.channelId,actor.user_id,accountId,data.label,data.campaignId,data.adsetId,data.adId,code]);
 return {id,label:data.label,accountId,channelId:data.channelId,campaignId:data.campaignId,adsetId:data.adsetId,
  adId:data.adId,code,url,expiresInDays:90,method:'prefilled_message',confidence:'indicative',
  warning:'Este código identifica uma mensagem recebida; não comprova clique da Meta, venda ou pagamento.'};
}
export async function listTrackingLinks(pool,actor){
 authorize(actor);
 const result=await pool.query(
  "SELECT l.id,l.label,l.account_id,l.campaign_id,l.adset_id,l.ad_id,l.code,l.active,l.created_at,l.expires_at,"+
  "ch.phone FROM wa_tracking_links l JOIN channels ch ON ch.tenant_id=l.tenant_id AND ch.id=l.channel_id "+
  "WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT 100",[actor.active_tenant_id]);
 return {links:result.rows.map(row=>({
  id:row.id,label:row.label,accountId:row.account_id,campaignId:row.campaign_id,adsetId:row.adset_id,
  adId:row.ad_id,active:row.active,createdAt:row.created_at,expiresAt:row.expires_at,
  url:buildPrefilledWhatsAppLink(row.phone,row.code)})),
  note:'Links identificam códigos em mensagens recebidas. Origem publicitária não verificada pela Meta.'};
}
export async function deactivateTrackingLink(pool,actor,id){
 authorize(actor,true);
 if(!validId(id))throw fail(422,'Link inválido.');
 const result=await pool.query(
  'UPDATE wa_tracking_links SET active=false WHERE tenant_id=$1 AND id=$2 RETURNING id,active',
  [actor.active_tenant_id,id]);
 if(!result.rowCount)throw fail(404,'Link não encontrado.');
 return result.rows[0];
}
export async function scanTrackingAttribution(pool){
 // SQL-only idempotent worker. Separate tenants/channels, only true inbound messages.
 // Never infer origin from an arbitrary campaign name or an outbound message.
 const result=await pool.query(
  "INSERT INTO wa_lead_attributions(id,tenant_id,conversation_id,inbound_message_id,link_id,method,confidence) "+
  "SELECT gen_random_uuid(),m.tenant_id,m.conversation_id,m.id,l.id,'message_code','indicative' "+
  "FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id "+
  "JOIN channels ch ON ch.id=c.channel_id AND ch.tenant_id=m.tenant_id AND ch.provider='waakg' "+
  "JOIN tenants t ON t.id=m.tenant_id AND t.status<>'paused' "+
  "JOIN wa_tracking_links l ON l.tenant_id=m.tenant_id AND l.channel_id=c.channel_id "+
  "AND l.active=true AND m.created_at>=l.created_at AND m.created_at<=l.expires_at "+
  "AND strpos(upper(m.body),'['||l.code||']')>0 "+
  "WHERE m.direction='inbound' AND m.created_at>now()-interval '48 hours' "+
  "AND COALESCE((t.features->>'whatsapp')::boolean,true)=true "+
  "AND COALESCE((t.features->>'meta_ads')::boolean,true)=true "+
  "AND NOT EXISTS(SELECT 1 FROM wa_lead_attributions a "+
  "WHERE a.tenant_id=m.tenant_id AND a.conversation_id=m.conversation_id) "+
  "ORDER BY m.created_at ASC,m.id ASC LIMIT 30 "+
  "ON CONFLICT DO NOTHING RETURNING id");
 return {attributed:result.rowCount||0,method:'message_code',confidence:'indicative'};
}
export async function trackingReport(pool,actor){
 authorize(actor);
 const result=await pool.query(
  "SELECT l.id,l.label,l.account_id,l.campaign_id,l.adset_id,l.ad_id,l.active,"+
  "COUNT(DISTINCT a.conversation_id)::int AS conversations,"+
  "COUNT(DISTINCT qr.id)::int AS quote_requests,"+
  "COUNT(DISTINCT si.id)::int AS purchase_intents "+
  "FROM wa_tracking_links l "+
  "LEFT JOIN wa_lead_attributions a ON a.tenant_id=l.tenant_id AND a.link_id=l.id "+
  "LEFT JOIN messages source ON source.tenant_id=a.tenant_id AND source.id=a.inbound_message_id "+
  "LEFT JOIN quote_requests qr ON qr.tenant_id=a.tenant_id AND qr.conversation_id=a.conversation_id "+
  "AND qr.created_at>=source.created_at "+
  "LEFT JOIN sale_intents si ON si.tenant_id=a.tenant_id AND si.conversation_id=a.conversation_id "+
  "AND si.created_at>=source.created_at "+
  "WHERE l.tenant_id=$1 GROUP BY l.id ORDER BY l.created_at DESC LIMIT 100",[actor.active_tenant_id]);
 return {period:'Desde a criação de cada link',method:'message_code',confidence:'indicative',items:result.rows,
  note:'Código observado na mensagem ≠ atribuição confirmada pela Meta. Intenções e orçamentos ≠ vendas pagas. Cliques e receita não são estimados.'};
}
