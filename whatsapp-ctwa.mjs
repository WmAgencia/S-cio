// Click-to-WhatsApp attribution confirmed by Meta: the referral object arrives on
// the first inbound message after an ad click and names the source ad. This module
// never sends WhatsApp, never edits campaigns, and never invents a sale.
import {randomUUID,createHmac} from 'node:crypto';
import {officialConfig} from './meta-official.mjs';
import {openMarketingSecret} from './marketing-integrations.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max)=>{const v=typeof value==='string'?value.trim():'';return v?v.slice(0,max):null;};
const httpsUrl=value=>{
 const v=text(value,2000);
 if(!v)return null;
 try{const url=new URL(v);return url.protocol==='https:'?url.href:null;}catch{return null;}
};
const timeOf=(seconds,now=Date.now())=>{
 const ms=Number(seconds)*1000;
 if(!Number.isFinite(ms)||ms<=0)return new Date(now);
 if(ms>now+300000||ms<now-30*86400000)return new Date(now);
 return new Date(ms);
};
const SOURCE_TYPES=Object.freeze({ad:'ad',ads:'ad',post:'post',open_thread:'open_thread'});

export function normalizeCtwaReferral(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const sourceId=text(input.source_id,128);
 if(!sourceId||!/^[A-Za-z0-9_.:-]+$/.test(sourceId))return null;
 const rawType=String(input.source_type||'').trim().toLowerCase();
 const ctwaClid=text(input.ctwa_clid,512);
 return {
  sourceId,
  sourceType:SOURCE_TYPES[rawType]||'unknown',
  ctwaClid:ctwaClid&&ctwaClid.length<=512?ctwaClid:null,
  sourceUrl:httpsUrl(input.source_url),
  headline:text(input.headline,300),
  body:text(input.body,600),
  mediaType:text(input.media_type,20),
  imageUrl:httpsUrl(input.image_url),
  videoUrl:httpsUrl(input.video_url),
  thumbnailUrl:httpsUrl(input.thumbnail_url),
  adGreetingText:text(input.ad_greeting_text,600),
  welcomeMessage:text(input.welcome_message,600)
 };
}

// One entry per real customer message. Text keeps its body; any message type can
// carry a referral, and that is exactly the first message after an ad click.
export function whatsappWebhookItems(data,{now=Date.now()}={}){
 const items=[];
 if(!data||data.object!=='whatsapp_business_account')return items;
 for(const entry of data.entry||[]){
  const wabaId=String(entry?.id||'').slice(0,64);
  for(const change of entry.changes||[]){
   const value=change?.value||{},external=value.metadata?.phone_number_id;
   const name=String(value.contacts?.[0]?.profile?.name||'').slice(0,100);
   for(const message of value.messages||[]){
    if(!external||!message?.id||!message?.from)continue;
    const body=message.type==='text'&&message.text?.body?
     String(message.text.body).slice(0,4000):null;
    const referral=normalizeCtwaReferral(message.referral);
    if(body===null&&!referral)continue;
    items.push({
     external:String(external).slice(0,64),
     messageId:String(message.id).slice(0,200),
     from:String(message.from).slice(0,32),
     body,
     name,
     referral,
     wabaId,
     occurredAt:timeOf(message.timestamp,now)
    });
   }
  }
 }
 return items;
}

export async function saveCtwaAttribution(db,{tenantId,channelId,conversationId,
 inboundMessageId,wabaId,referral,occurredAt}){
 if(!referral||typeof referral!=='object')return false;
 const when=occurredAt instanceof Date&&!Number.isNaN(occurredAt.getTime())?occurredAt:new Date();
 const result=await db.query(
  `INSERT INTO wa_ctwa_attributions(id,tenant_id,channel_id,conversation_id,
   inbound_message_id,waba_id,source_id,source_type,ctwa_clid,source_url,headline,body,
   media_type,image_url,video_url,thumbnail_url,ad_greeting_text,welcome_message,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
   ON CONFLICT(tenant_id,inbound_message_id) DO NOTHING`,
  [randomUUID(),tenantId,channelId,conversationId,String(inboundMessageId).slice(0,200),
   String(wabaId||'').slice(0,64),referral.sourceId,referral.sourceType,referral.ctwaClid,
   referral.sourceUrl,referral.headline,referral.body,referral.mediaType,referral.imageUrl,
   referral.videoUrl,referral.thumbnailUrl,referral.adGreetingText,referral.welcomeMessage,when]);
 return result.rowCount===1;
}

const PENDING_SQL=[
 "SELECT DISTINCT ON (tenant_id,source_id) tenant_id,source_id",
 "FROM wa_ctwa_attributions",
 "WHERE resolved_at IS NULL AND source_type='ad'",
 "AND created_at>now()-interval '7 days'",
 "AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '15 minutes')",
 "ORDER BY tenant_id,source_id,created_at",
 "LIMIT $1"
].join(' ');

const NOT_FOUND_CODES=new Set([100,803,80004]);

async function tenantMetaToken(pool,tenantId,env){
 const result=await pool.query(
  "SELECT token_encrypted FROM meta_official_grants WHERE tenant_id=$1 AND expires_at>now() ORDER BY updated_at DESC LIMIT 1",
  [tenantId]);
 if(!result.rowCount)return null;
 return openMarketingSecret(result.rows[0].token_encrypted,env);
}

async function lookupAd({config,token,adId,request}){
 const url=new URL('https://graph.facebook.com/'+config.version+'/'+adId);
 url.searchParams.set('fields','name,account_id,campaign{id,name},adset{id,name}');
 url.searchParams.set('appsecret_proof',createHmac('sha256',config.secret).update(token).digest('hex'));
 let response,data;
 try{
  response=await request(url,{headers:{Authorization:'Bearer '+token},redirect:'error',
   signal:AbortSignal.timeout(12000)});
  data=await response.json();
 }catch{throw fail(503,'Meta indisponível para identificar o anúncio.');}
 if(!response.ok||data.error){
  const code=Number(data.error?.code||0);
  const error=fail(503,'A Meta não identificou o anúncio.');
  error.metaCode=code;
  error.permanent=NOT_FOUND_CODES.has(code);
  error.auth=code===190||code===102;
  throw error;
 }
 if(!/^\d+$/.test(String(data.id||'')))throw fail(503,'A Meta não identificou o anúncio.');
 return data;
}

const RETRY_SQL=`UPDATE wa_ctwa_attributions SET resolution_attempts=LEAST(resolution_attempts+1,5),
 last_attempt_at=now(),resolution_error=$3 WHERE tenant_id=$1 AND source_id=$2 AND resolved_at IS NULL`;

// Read-only ad lookup. A tenant without an active Meta grant is skipped without
// counting an attempt, so a click that arrives before the owner connects is not lost.
export async function resolvePendingCtwaAds(pool,{limit=4,request=fetch,env=process.env}={}){
 let config;
 try{config=officialConfig(env);}catch{return {checked:0,resolved:0,failed:0,skipped:0};}
 const pending=await pool.query(PENDING_SQL,[Math.max(1,Math.min(Number(limit)||4,20))]);
 let resolved=0,failed=0,skipped=0;
 for(const row of pending.rows){
  let token;
  try{token=await tenantMetaToken(pool,row.tenant_id,env);}catch{token=null;}
  if(!token){skipped++;continue;}
  try{
   const ad=await lookupAd({config,token,adId:row.source_id,request});
   await pool.query(
    `UPDATE wa_ctwa_attributions SET ad_name=$3,adset_id=$4,adset_name=$5,campaign_id=$6,
     campaign_name=$7,account_id=$8,resolution_attempts=LEAST(resolution_attempts+1,5),
     last_attempt_at=now(),resolution_error=NULL,resolved_at=now()
     WHERE tenant_id=$1 AND source_id=$2 AND resolved_at IS NULL`,
    [row.tenant_id,row.source_id,text(ad.name,200),
     text(ad.adset?.id,64),text(ad.adset?.name,200),
     text(ad.campaign?.id,64),text(ad.campaign?.name,200),text(ad.account_id,64)]);
   resolved++;
  }catch(error){
   if(error?.auth){skipped++;continue;}
   const message=String(error?.message||'Falha ao identificar o anúncio').slice(0,180);
   const params=[row.tenant_id,row.source_id,message];
   if(error?.permanent)await pool.query(RETRY_SQL.replace('resolution_error=$3',
    'resolution_error=$3,resolved_at=now()'),params);
   else await pool.query(RETRY_SQL,params);
   failed++;
  }
 }
 return {checked:pending.rowCount,resolved,failed,skipped};
}

const REPORT_SQL=[
 "WITH arrivals AS (",
 " SELECT a.conversation_id,a.occurred_at,a.source_id,a.source_type,a.ctwa_clid,",
 " a.ad_name,a.adset_id,a.adset_name,a.campaign_id,a.campaign_name,a.account_id,",
 " a.headline,a.source_url,a.resolution_error,",
 " LEAD(a.occurred_at) OVER (PARTITION BY a.tenant_id,a.conversation_id ORDER BY a.occurred_at) AS next_arrival",
 " FROM wa_ctwa_attributions a",
 " WHERE a.tenant_id=$1 AND a.occurred_at>=now()-($2::int*interval '1 day')",
 "), bounded AS (",
 " SELECT x.*,LEAST(COALESCE(x.next_arrival,x.occurred_at+interval '7 days'),",
 " x.occurred_at+interval '7 days') AS window_end",
 " FROM arrivals x",
 "), replied AS (",
 " SELECT b.*,(",
 "  SELECT MIN(r.created_at) FROM messages r",
 "  WHERE r.tenant_id=$1 AND r.conversation_id=b.conversation_id",
 "  AND r.direction='outbound' AND r.provider_id IS NOT NULL",
 "  AND r.created_at>=b.occurred_at AND r.created_at<=b.window_end",
 " ) AS first_business_reply_at",
 " FROM bounded b",
 ")",
 "SELECT r.conversation_id,r.occurred_at,r.source_id,r.source_type,r.ctwa_clid,",
 "r.ad_name,r.adset_id,r.adset_name,r.campaign_id,r.campaign_name,r.account_id,",
 "r.headline,r.source_url,r.resolution_error,r.first_business_reply_at,",
 "EXISTS(SELECT 1 FROM messages f WHERE f.tenant_id=$1",
 " AND f.conversation_id=r.conversation_id AND f.direction='inbound'",
 " AND r.first_business_reply_at IS NOT NULL",
 " AND f.created_at>r.first_business_reply_at AND f.created_at<=r.window_end)",
 " AS customer_followed_up",
 "FROM replied r ORDER BY r.occurred_at DESC LIMIT 5000"
].join('\n');

function authorize(actor){
 requirePermission(actor,'marketing.read');
 assertApiFeature(actor.features,'/api/marketing/tools');
 if(actor.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}

const average=(seconds,count)=>count?Math.round(seconds/count):null;
const iso=value=>value?new Date(value).toISOString():null;

export async function readCtwaReport(pool,actor,{days=30}={}){
 authorize(actor);
 const windowDays=Math.max(1,Math.min(Number(days)||30,90));
 const result=await pool.query(REPORT_SQL,[actor.active_tenant_id,windowDays]);
 const rows=result.rows.map(row=>({
  conversationId:row.conversation_id,
  occurredAt:new Date(row.occurred_at),
  sourceId:row.source_id,
  sourceType:row.source_type,
  hasClickId:Boolean(row.ctwa_clid),
  adName:row.ad_name,
  adsetId:row.adset_id,
  adsetName:row.adset_name,
  campaignId:row.campaign_id,
  campaignName:row.campaign_name,
  accountId:row.account_id,
  headline:row.headline,
  sourceUrl:row.source_url,
  resolutionError:row.resolution_error,
  firstBusinessReplyAt:row.first_business_reply_at?new Date(row.first_business_reply_at):null,
  customerFollowedUp:Boolean(row.customer_followed_up)
 }));
 const ads=new Map();
 for(const row of rows){
  let item=ads.get(row.sourceId);
  if(!item){
   item={sourceId:row.sourceId,sourceType:row.sourceType,adName:row.adName,
    adsetId:row.adsetId,adsetName:row.adsetName,campaignId:row.campaignId,
    campaignName:row.campaignName,accountId:row.accountId,headline:row.headline,
    sourceUrl:row.sourceUrl,resolutionError:row.resolutionError,
    clickIdArrivals:0,arrivals:0,conversations:new Set(),businessResponded:0,
    customerFollowedUp:0,replySeconds:0,lastArrivalAt:row.occurredAt};
   ads.set(row.sourceId,item);
  }
  if(!item.adName&&row.adName)item.adName=row.adName;
  if(!item.campaignId&&row.campaignId){item.campaignId=row.campaignId;item.campaignName=row.campaignName;item.accountId=row.accountId;}
  if(!item.resolutionError&&row.resolutionError)item.resolutionError=row.resolutionError;
  item.arrivals++;
  item.conversations.add(row.conversationId);
  if(row.hasClickId)item.clickIdArrivals++;
  if(row.firstBusinessReplyAt){
   item.businessResponded++;
   item.replySeconds+=Math.max(0,(row.firstBusinessReplyAt-row.occurredAt)/1000);
  }
  if(row.customerFollowedUp)item.customerFollowedUp++;
  if(row.occurredAt>item.lastArrivalAt)item.lastArrivalAt=row.occurredAt;
 }
 const items=[...ads.values()].map(item=>({
  sourceId:item.sourceId,sourceType:item.sourceType,adName:item.adName,
  adsetId:item.adsetId,adsetName:item.adsetName,campaignId:item.campaignId,
  campaignName:item.campaignName,accountId:item.accountId,headline:item.headline,
  sourceUrl:item.sourceUrl,resolutionError:item.resolutionError,
  clickIdArrivals:item.clickIdArrivals,arrivals:item.arrivals,
  conversations:item.conversations.size,businessResponded:item.businessResponded,
  customerFollowedUp:item.customerFollowedUp,
  averageFirstBusinessReplySeconds:average(item.replySeconds,item.businessResponded),
  lastArrivalAt:iso(item.lastArrivalAt)
 })).sort((a,b)=>b.arrivals-a.arrivals||String(b.lastArrivalAt).localeCompare(String(a.lastArrivalAt)));

 const campaigns=new Map();
 for(const row of rows){
  const key=row.campaignId||'unresolved';
  let item=campaigns.get(key);
  if(!item){
   item={campaignId:row.campaignId||null,campaignName:row.campaignName||null,
    accountId:row.accountId||null,arrivals:0,conversations:new Set(),
    businessResponded:0,customerFollowedUp:0,replySeconds:0,ads:new Set(),
    lastArrivalAt:row.occurredAt};
   campaigns.set(key,item);
  }
  item.ads.add(row.sourceId);
  item.arrivals++;
  item.conversations.add(row.conversationId);
  if(row.firstBusinessReplyAt){
   item.businessResponded++;
   item.replySeconds+=Math.max(0,(row.firstBusinessReplyAt-row.occurredAt)/1000);
  }
  if(row.customerFollowedUp)item.customerFollowedUp++;
  if(row.occurredAt>item.lastArrivalAt)item.lastArrivalAt=row.occurredAt;
 }
 const campaignItems=[...campaigns.values()].map(item=>({
  campaignId:item.campaignId,campaignName:item.campaignName,accountId:item.accountId,
  ads:item.ads.size,arrivals:item.arrivals,conversations:item.conversations.size,
  businessResponded:item.businessResponded,customerFollowedUp:item.customerFollowedUp,
  averageFirstBusinessReplySeconds:average(item.replySeconds,item.businessResponded),
  lastArrivalAt:iso(item.lastArrivalAt)
 })).sort((a,b)=>b.arrivals-a.arrivals);

 const businessResponded=items.reduce((sum,x)=>sum+x.businessResponded,0);
 const replySeconds=rows.reduce((sum,row)=>sum+(row.firstBusinessReplyAt?
  Math.max(0,(row.firstBusinessReplyAt-row.occurredAt)/1000):0),0);
 return {
  method:'ctwa_referral',
  confidence:'meta_confirmed',
  readOnly:true,
  windowDays,
  attributionWindowDays:7,
  partial:result.rowCount===5000,
  collection:'whatsapp_official_webhook',
  totals:{
   arrivals:rows.length,
   conversations:new Set(rows.map(row=>row.conversationId)).size,
   ads:items.length,
   campaigns:campaignItems.length,
   businessResponded,
   customerFollowedUp:items.reduce((sum,x)=>sum+x.customerFollowedUp,0),
   averageFirstBusinessReplySeconds:average(replySeconds,businessResponded),
   unresolvedArrivals:items.filter(x=>!x.campaignId&&x.sourceType==='ad')
    .reduce((sum,x)=>sum+x.arrivals,0)
  },
  items,
  campaigns:campaignItems,
  notes:[
   'Origem confirmada pela Meta no referral enviado na primeira mensagem após o clique.',
   'Uma pessoa que clica e chega duas vezes conta duas chegadas.',
   'A janela de atribuição da Meta para CTWA é de 7 dias.',
   'Chegadas e conversas não são vendas nem receita confirmada.'
  ]
 };
}

export function formatCtwaReport(report,{max=5}={}){
 const totals=report?.totals||{};
 const lines=[
  'Chegadas do Meta Ads para o WhatsApp — últimos '+report.windowDays+' dias',
  totals.arrivals+' chegada(s) confirmada(s) · '+totals.conversations+' conversa(s) · '+
   totals.businessResponded+' respondida(s) pela empresa',
  'Clientes que voltaram a responder: '+totals.customerFollowedUp+
   ' · Primeira resposta média: '+(totals.averageFirstBusinessReplySeconds===null?'sem dados':
   Math.round(totals.averageFirstBusinessReplySeconds/60)+' min')
 ];
 for(const item of (report.items||[]).slice(0,max)){
  lines.push((item.adName||('Anúncio '+item.sourceId))+
   (item.campaignName?' · '+item.campaignName:'')+' — '+item.arrivals+' chegada(s), '+
   item.businessResponded+' respondida(s), '+item.customerFollowedUp+' retorno(s)');
 }
 if(totals.unresolvedArrivals)lines.push('Anúncios ainda não identificados: '+
  totals.unresolvedArrivals+' chegada(s).');
 lines.push('Origem confirmada pela Meta; não representa vendas ou receita.');
 return lines.join('\n');
}
