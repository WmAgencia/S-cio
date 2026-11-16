// Sales reported by customers and confirmed by the owner. A receipt only opens a
// pending candidate; revenue exists after confirmation, never before.
import {randomUUID} from 'node:crypto';

const clean=(value,max=500)=>String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);
const RECEIPT=/(?:comprovante|recibo|paguei|pix feito|fiz o pix|mandei o pix|transferi|transfer[êe]ncia feita|depositei|dep[óo]sito feito|comprei|pedido pago|valor pago|venda feita|recebi o pagamento|segue o pagamento)/i;
const SALE_YES=/^(?:sim|confirmo|confirmar|confirma|isso|exato|correto|foi venda|é venda|e venda|pode contar|contar como venda)\b/i;
const SALE_NO=/^(?:n[ãa]o|nao|descarta|descartar|n[ãa]o foi|nao foi|n[ãa]o é venda|nao e venda|ignorar|ignora)\b/i;
const SALE_BUTTON=/\[(?:Interactive|Button) Response\]\s*socio:sale:(confirm|reject):([0-9a-f-]{36})/i;
const AMOUNT_TOKEN='(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
const AMOUNT_ONLY=new RegExp('^(?:r\\$\\s*)?'+AMOUNT_TOKEN+'\\s*(?:reais|real)?$','i');
const validCents=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=100000000;

function centsOf(raw){
 let s=String(raw||'').replace(/\s/g,'');
 if(!s)return null;
 if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
 else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
 const n=Number(s);
 if(!Number.isFinite(n)||n<=0||n>1000000)return null;
 return Math.round(n*100);
}

export function parseAmount(value){
 const t=clean(value,300);
 if(!t)return null;
 // Never accept a truncated prefix ("123" from "1234,56") or the positive
 // substring of a negative amount. Both silently corrupt confirmed revenue.
 if(/(?:r\$\s*)?-\s*\d/i.test(t))return null;
 const token=new RegExp('(?<![\\d.,])('+AMOUNT_TOKEN+')(?![\\d.,])','i');
 let m=t.match(new RegExp('r\\$\\s*'+token.source,'i'));
 if(!m)m=t.match(new RegExp(token.source+'\\s*(?:reais|real)?\\b','i'));
 if(!m&&(AMOUNT_ONLY.test(t)||SALE_YES.test(t)))m=t.match(token);
 return m?centsOf(m[1]):null;
}

export function money(cents){
 return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
  .format((Number(cents)||0)/100);
}

// A receipt is either a message that speaks like one or an image/document that
// could be one. Anything else is ordinary conversation and never becomes a sale.
export function detectSaleCandidate({body=null,caption=null,fileName=null,mediaType=null}={}){
 const text=clean([body,caption,fileName].filter(Boolean).join(' '),1000);
 const kind=mediaType==='document'?'document':mediaType==='image'?'image':null;
 if(!kind&&!RECEIPT.test(text))return null;
 const excerpt=clean((kind?'['+(kind==='document'?'documento':'imagem')+'] ':'')+text,500);
 return {
  evidenceKind:kind||'text',
  evidenceExcerpt:excerpt||null,
  amountCents:parseAmount(text)
 };
}

export function parseSaleAnswer(value){
 const t=clean(value,300);
 if(!t)return null;
 if(SALE_YES.test(t))return {kind:'confirm',cents:parseAmount(t)};
 if(SALE_NO.test(t))return {kind:'reject'};
 if(AMOUNT_ONLY.test(t)){
  const cents=parseAmount(t);
  if(cents!=null)return {kind:'confirm',cents};
 }
 return null;
}

export function parseSaleButton(value){
 const match=clean(value,4000).match(SALE_BUTTON);
 return match?{kind:match[1],id:match[2]}:null;
}

export function saleQuestionText(sale,{customerName='',customerPhone=''}={}){
 const who=clean(customerName,80)||clean(customerPhone,40)||'um cliente';
 const amount=sale?.amountCents?money(sale.amountCents):null;
 return 'Recebi uma mensagem de '+who+' que parece ser comprovante de venda'+
  (amount?' no valor de '+amount:'')+'. Confirma essa venda?'+
  (amount?' Responda SIM ou NÃO.':' Responda SIM e o valor (ex.: 50), ou NÃO.');
}

export function saleAnswerText(sale,answer){
 if(answer.kind!=='confirm')return 'Ok, não vou contar essa mensagem como venda.';
 const origin=clean(sale?.campaignName,120)||clean(sale?.adName,120);
 return 'Venda confirmada: '+money(sale?.amountCents)+'.'+
  (origin?' Origem: '+origin+'.':' Sem atribuição de anúncio.')+
  ' Ela já entra no relatório de retorno.';
}

function saleView(row){
 if(!row)return null;
 return {
  id:row.id,
  status:row.status,
  amountCents:row.amount_cents==null?null:Number(row.amount_cents),
  evidenceKind:row.evidence_kind,
  evidenceExcerpt:row.evidence_excerpt,
  originSource:row.origin_source,
  campaignId:row.origin_campaign_id,
  campaignName:row.origin_campaign_name,
  adsetId:row.origin_adset_id,
  adsetName:row.origin_adset_name,
  adId:row.origin_ad_id,
  adName:row.origin_ad_name,
  conversationId:row.conversation_id,
  notifiedAt:row.notified_at,
  confirmedAt:row.confirmed_at,
  capiSentAt:row.capi_sent_at,
  capiError:row.capi_error,
  createdAt:row.created_at
 };
}

async function resolveOrigin(db,{tenantId,conversationId}){
 if(!conversationId)return {originSource:'unknown'};
 const ctwa=await db.query(
  'SELECT id,campaign_id,campaign_name,adset_id,adset_name,source_id,source_type,ad_name '+
  'FROM wa_ctwa_attributions WHERE tenant_id=$1 AND conversation_id=$2 '+
  'ORDER BY occurred_at ASC LIMIT 1',[tenantId,conversationId]);
 if(ctwa.rowCount){
  const row=ctwa.rows[0];
  return {
   originSource:'ctwa',
   campaignId:row.campaign_id||null,
   campaignName:row.campaign_name||null,
   adsetId:row.adset_id||null,
   adsetName:row.adset_name||null,
   adId:row.source_type==='ad'?row.source_id||null:null,
   adName:row.ad_name||null,
   ctwaAttributionId:row.id
  };
 }
 const link=await db.query(
  'SELECT a.id AS attribution_id,l.campaign_id,l.adset_id,l.ad_id '+
  'FROM wa_lead_attributions a JOIN wa_tracking_links l '+
  'ON l.tenant_id=a.tenant_id AND l.id=a.link_id '+
  'WHERE a.tenant_id=$1 AND a.conversation_id=$2 ORDER BY a.created_at ASC LIMIT 1',
  [tenantId,conversationId]);
 if(link.rowCount){
  const row=link.rows[0];
  return {
   originSource:'link',
   campaignId:row.campaign_id||null,
   adsetId:row.adset_id||null,
   adId:row.ad_id||null,
   leadAttributionId:row.attribution_id
  };
 }
 return {originSource:'organic'};
}

const INSERT_SALE='INSERT INTO socio_sales(id,tenant_id,conversation_id,inbound_message_id,'+
 'evidence_kind,evidence_excerpt,amount_cents,status,source,origin_source,'+
 'origin_campaign_id,origin_campaign_name,origin_adset_id,origin_adset_name,'+
 'origin_ad_id,origin_ad_name,ctwa_attribution_id,lead_attribution_id,created_at,updated_at) '+
 'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) '+
 'ON CONFLICT(tenant_id,inbound_message_id) DO NOTHING RETURNING *';

async function insertSale(db,{tenantId,conversationId,inboundMessageId,evidence,source,origin,when}){
 const saleId=randomUUID();
 const inserted=await db.query(INSERT_SALE,[
  saleId,tenantId,conversationId,inboundMessageId,evidence.evidenceKind,
  evidence.evidenceExcerpt,evidence.amountCents,'pending',source,
  origin.originSource||'unknown',origin.campaignId||null,origin.campaignName||null,
  origin.adsetId||null,origin.adsetName||null,origin.adId||null,origin.adName||null,
  origin.ctwaAttributionId||null,origin.leadAttributionId||null,when||new Date()]);
 if(inserted.rowCount)return {sale:saleView(inserted.rows[0]),created:true};
 const existing=await db.query(
  'SELECT * FROM socio_sales WHERE tenant_id=$1 AND inbound_message_id=$2',[tenantId,inboundMessageId]);
 return {sale:saleView(existing.rows[0]),created:false};
}

export async function recordSaleCandidate(db,{tenantId,conversationId,inboundMessageId,
 occurredAt=null,evidence,source='heuristic'}){
 if(!evidence)return {sale:null,created:false};
 const duplicate=await db.query(
  'SELECT * FROM socio_sales WHERE tenant_id=$1 AND inbound_message_id=$2',[tenantId,inboundMessageId]);
 if(duplicate.rowCount)return {sale:saleView(duplicate.rows[0]),created:false};
 if(evidence.evidenceKind!=='text'){
  const rejected=await db.query(
   "SELECT 1 FROM socio_sales WHERE tenant_id=$1 AND conversation_id=$2 AND status='rejected' "+
   "AND rejected_at>now()-interval '24 hours' LIMIT 1",[tenantId,conversationId]);
  if(rejected.rowCount)return {sale:null,created:false,suppressed:true};
 }
 const pending=await db.query(
  "SELECT * FROM socio_sales WHERE tenant_id=$1 AND conversation_id=$2 AND status='pending' "+
  "AND created_at>now()-interval '2 hours' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
  [tenantId,conversationId]);
 if(pending.rowCount){
  const current=pending.rows[0];
  const sameAmount=!current.amount_cents||!evidence.amountCents||
   Number(current.amount_cents)===evidence.amountCents;
  if(sameAmount){
   const merged=await db.query(
    'UPDATE socio_sales SET amount_cents=COALESCE(amount_cents,$3::bigint),updated_at=now() '+
    'WHERE tenant_id=$1 AND id=$2 AND status=$4 RETURNING *',
    [tenantId,current.id,evidence.amountCents||null,'pending']);
   return {sale:saleView(merged.rows[0]||current),created:false,merged:true};
  }
 }
 const origin=await resolveOrigin(db,{tenantId,conversationId});
 return insertSale(db,{tenantId,conversationId,inboundMessageId,evidence,source,origin,when:occurredAt});
}

export async function markSaleNotified(db,tenantId,saleId){
 await db.query(
  'UPDATE socio_sales SET notified_at=now(),updated_at=now() '+
  "WHERE tenant_id=$1 AND id=$2 AND status='pending' AND notified_at IS NULL",[tenantId,saleId]);
}

export async function latestPendingSale(db,tenantId){
 const result=await db.query(
  'SELECT s.*,c.customer_name,c.customer_phone FROM socio_sales s '+
  'LEFT JOIN conversations c ON c.tenant_id=s.tenant_id AND c.id=s.conversation_id '+
  "WHERE s.tenant_id=$1 AND s.status='pending' AND s.notified_at IS NOT NULL "+
  'ORDER BY s.notified_at DESC LIMIT 1',[tenantId]);
 const row=result.rows[0];
 if(!row)return null;
 const view=saleView(row);
 view.customerName=row.customer_name||'';
 view.customerPhone=row.customer_phone||'';
 return view;
}

export async function pendingSaleSummary(db,tenantId){
 const result=await db.query(
  'SELECT count(*)::int AS total,COALESCE(sum(amount_cents),0)::bigint AS cents '+
  "FROM socio_sales WHERE tenant_id=$1 AND status='pending' AND notified_at IS NOT NULL",
  [tenantId]);
 const row=result.rows[0]||{};
 return {total:Number(row.total)||0,amountCents:Number(row.cents)||0};
}

export async function confirmSale(pool,{tenantId,id,amountCents=null,by='owner'}){
 const found=await pool.query(
  'SELECT * FROM socio_sales WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
 if(!found.rowCount)return {ok:false,reason:'not_found'};
 if(found.rows[0].status!=='pending')return {ok:false,reason:'resolved',sale:saleView(found.rows[0])};
 const amount=amountCents==null?Number(found.rows[0].amount_cents):Number(amountCents);
 if(!validCents(amount))return {ok:false,reason:'amount_required',sale:saleView(found.rows[0])};
 const result=await pool.query(
  "UPDATE socio_sales SET status='confirmed',amount_cents=$3,confirmed_at=now(),"+
  'confirmed_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status=$5 RETURNING *',
  [tenantId,id,amount,clean(by,200)||'owner','pending']);
 if(!result.rowCount)return {ok:false,reason:'resolved'};
 return {ok:true,sale:saleView(result.rows[0])};
}

export async function rejectSale(pool,{tenantId,id,by='owner'}){
 const result=await pool.query(
  "UPDATE socio_sales SET status='rejected',rejected_at=now(),updated_at=now() "+
  'WHERE tenant_id=$1 AND id=$2 AND status=$3 RETURNING *',[tenantId,id,'pending']);
 if(!result.rowCount)return {ok:false,reason:'not_pending'};
 return {ok:true,sale:saleView(result.rows[0])};
}

export async function createManualSale(pool,{tenantId,amountCents,conversationId=null,
 origin=null,createdBy='owner'}){
 if(!validCents(amountCents))return {ok:false,reason:'amount_required'};
 let conversation=null;
 if(conversationId){
  const found=await pool.query(
   'SELECT id FROM conversations WHERE tenant_id=$1 AND id=$2',[tenantId,conversationId]);
  if(!found.rowCount)return {ok:false,reason:'conversation_not_found'};
  conversation=conversationId;
 }
 const resolved=origin&&Object.keys(origin).length?{originSource:'organic',...origin}:
  await resolveOrigin(pool,{tenantId,conversationId:conversation});
 const saleId=randomUUID();
 const inserted=await pool.query(INSERT_SALE,[
  saleId,tenantId,conversation,null,'manual','Registrada manualmente pelo dono',
  Number(amountCents),'confirmed','manual',resolved.originSource||'unknown',
  resolved.campaignId||null,resolved.campaignName||null,resolved.adsetId||null,
  resolved.adsetName||null,resolved.adId||null,resolved.adName||null,
  resolved.ctwaAttributionId||null,resolved.leadAttributionId||null,new Date()]);
 const confirmed=await pool.query(
  "UPDATE socio_sales SET confirmed_at=now(),confirmed_by=$2 WHERE tenant_id=$1 AND id=$3 RETURNING *",
  [tenantId,clean(createdBy,200)||'owner',saleId]);
 return {ok:true,sale:saleView(confirmed.rows[0]||inserted.rows[0])};
}

export async function listSales(pool,tenantId,{days=30,status=null,limit=50}={}){
 const span=Math.min(Math.max(Number(days)||30,1),365);
 const size=Math.min(Math.max(Number(limit)||50,1),200);
 const wanted=status==='pending'||status==='confirmed'||status==='rejected'?status:null;
 const result=await pool.query(
  'SELECT s.*,c.customer_name,c.customer_phone FROM socio_sales s '+
  'LEFT JOIN conversations c ON c.tenant_id=s.tenant_id AND c.id=s.conversation_id '+
  'WHERE s.tenant_id=$1 AND s.created_at>now()-make_interval(days=>$2) '+
  'AND ($3::text IS NULL OR s.status=$3) '+
  'ORDER BY s.created_at DESC LIMIT $4',[tenantId,span,wanted,size]);
 return result.rows.map(row=>{
  const view=saleView(row);
  view.customerName=row.customer_name||'';
  view.customerPhone=row.customer_phone||'';
  return view;
 });
}

export const __test={centsOf};
