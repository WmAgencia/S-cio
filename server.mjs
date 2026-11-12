import {readAdsTool,readSelectedAdMedia,uploadAdImage,prepareAdsPlan,executeAdsPlan,adsToolHistory,inspectOfficialCampaign} from './meta-ads-tools.mjs';
import {listTenantVideoChannels,findLastOutgoingVideo,importLastOutgoingVideo} from './socio-whatsapp-meta-video.mjs';
import {runVideoPilotOnce} from './socio-whatsapp-meta-video-pilot.mjs';
import {readAdvancedMetaTool,META_TOOL_CATALOG} from './meta-ads-advanced.mjs';
import {previewMetaCommand} from './meta-ads-commands.mjs';
import {SOCIO_AD_SKILLS} from './socio-ad-skills.mjs';
import {listExpertSkills,getExpertSkillGuide} from './socio-expert-skills.mjs';
import {speakToSocioSkill} from './socio-skill-router.mjs';
import {processOwnerSkillInbox} from './socio-owner-skill-inbox.mjs';
import {processOwnerSkillMedia} from './socio-owner-skill-media.mjs';
import {ownerWhatsAppReadiness} from './socio-owner-skill-readiness.mjs';
import {metaConnectionPreflight} from './meta-integration-preflight.mjs';
import {saveMetaReportSchedule,listMetaReportSchedule,processDueMetaReport} from './meta-report-schedules.mjs';
import {createTrackingLink,listTrackingLinks,deactivateTrackingLink,scanTrackingAttribution,trackingReport} from './whatsapp-attribution.mjs';
import {readWhatsAppFunnel} from './whatsapp-funnel.mjs';
import {startOfficial,finishOfficial,officialStatus,officialAccounts,disconnectOfficial,selectOfficialAccount,handleMetaRemoval,metaRemovalStatus} from './meta-official.mjs';

import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {scanQuoteRequests,listQuoteRequests,updateQuoteRequest,setQuoteAlerts,processNextOwnerQuoteAlert,saveQuoteDraft,sendQuoteDraft} from './quote-requests.mjs';
import {scanSalesIntents,listSaleIntents,updateSaleIntent} from './sales-intents.mjs';
import {askSalesAssistant} from './socio-sales-assistant.mjs';
import {validateTenantFeatures,parseTenantFeatures,filterPermissions,assertApiFeature} from './tenant-features.mjs';
import {startPipeboardOAuth,finishPipeboardOAuth,listPipeboardOAuth,revokePipeboardOAuth,oauthClientMetadata,testPipeboardConnection} from './marketing-oauth.mjs';
import {instagramHostedReady,beginInstagramHosted,instagramHostedStatus,disconnectInstagramHosted} from './instagram-hosted.mjs';
import {connectPipeboard,listMarketing,disconnectMarketing} from './marketing-integrations.mjs';
import {instagramReady,beginInstagramOAuth,completeInstagramOAuth,ingestInstagramWebhook,revokeInstagramAccount} from './instagram-integration.mjs';
import {maintenanceEnabled,writesBlocked,workersBlocked} from './migration-guard.mjs';
import {TABLES as MIGRATION_TABLES} from './scripts/socio-supabase-migrate.mjs';
import {hashToken,secureEqual,hashPassword,verifyPassword,parseWhatsAppExport,buildTrainingMarkdown,slugify,emailOk,normalizeLoginPhone,loginIdentifier} from './lib.mjs';
import {permissionsFor,requirePermission,allowedNewMemberRole,validateMemberPatch} from './team-permissions.mjs';
import {extractWhatsAppZip} from './zip-import.mjs';
import {createTrainingAnalysis,processNextAnalysisJob} from './analysis-jobs.mjs';
import {gatewayConfigured,gatewayRead,getSessionStatus,validSessionId,ensureSessionProvisioned,getSessionQr,sessionLifecycle} from './waakg-adapter.mjs';
import {processNextWaakgScan} from './waakg-history.mjs';
import {startAutoTraining,autoTrainingStatus,cancelAutoTraining,processNextAutoTraining} from './training-auto.mjs';
import {getSocioInterview,startSocioInterview,advanceSocioInterview,resetSocioInterview,transcribeSocioTraining} from './socio-training-interview.mjs';
import {synthesizeCachedThalitaVoice,prewarmThalitaAcknowledgements,SOCIO_TRAINING_VOICE} from './socio-training-tts.mjs';
import {groqReady,groqResponse,groqModel} from './groq-client.mjs';
import {lookupCompany,validCnpj,normalizeCnpj} from './cnpj-lookup.mjs';
import {handleInboxApi} from './inbox-api.mjs';
import {processLiveInboxSync} from './inbox-live-sync.mjs';
import {processNextAiReply,buildAiInstructions} from './ai-replies.mjs';
import {normalizeLabHistory,buildLabInput,polishCustomerReply,reviewReplyStyle} from './socio-intelligence.mjs';
import {analyzeSocioContinuity} from './socio-prospector-continuity.mjs';
import {knowledgeV3Enabled,loadTenantApprovedKnowledge,retrieveApprovedKnowledge} from './socio-knowledge-retrieval.mjs';
import {readConversationMemory,clearConversationMemory,purgeExpiredConversationMemories} from './socio-conversation-memory.mjs';
import {reconcileConfirmedOutbox} from './socio-outbound.mjs';
import {encodeHistoryCursor,decodeHistoryCursor} from './inbox-cursor.mjs';
import {getOperationalReadiness} from './operational-readiness.mjs';
import {getTenantBusinessMonitor,getMasterSaasMonitor} from './socio-business-monitor.mjs';
import {getExecutiveMetrics} from './socio-executive-metrics.mjs';
import {askThalita,confirmThalita} from './socio-thalita-assistant.mjs';
import {readSubscriptionStatus,createSubscriptionCheckout,createBillingPortal,processSubscriptionWebhook} from './socio-subscriptions.mjs';
import {startGoogleAdsOAuth,finishGoogleAdsOAuth,googleAdsStatus,listGoogleAdsAccounts,selectGoogleAdsAccount,disconnectGoogleAds,readGoogleAdsCampaigns} from './socio-google-ads.mjs';
import {createTrackingSite,listTrackingSites,enableTrackingSite,receiveSignedSiteEvent} from './socio-site-tracking.mjs';
import {integrationReadiness} from './socio-integrations-readiness.mjs';
import {validateProduct,validateVariants,validateCampaign,catalogPrompt,matchCatalogProducts} from './catalog.mjs';
import {createQuote,issueQuote,cancelQuote,publicQuote,approveQuote,declineQuote,listSales,createTestCheckout,processStripeTestEvent} from './sales-commerce.mjs';
import {mediaConfigured,normalizeImage,imageKey,putPrivateImage,getPrivateImage,deletePrivateImage,checkMediaStorage} from './media-storage.mjs';
import {reserveAdVideo,listAdVideos,storeAdVideo,adVideoExportUrl,resolveSignedAsset,serveSignedVideo,importWhatsAppAdVideo,createMediaMcpToken,revokeMediaMcpTokens,MAX_AD_VIDEO_BYTES} from './ads-media.mjs';
import {handleAdsMediaMcp} from './ads-media-mcp.mjs';
import {handleMediaOAuth} from './ads-media-oauth.mjs';
import {createMetaBrowser} from './meta-browser.mjs';
import {saveMetaBillingObservation,metaBillingStatus,monitorMetaBilling} from './meta-billing-observations.mjs';
import {createFlowImages} from './flow-images.mjs';
import {startLocalPairing,claimLocalPairing,authorizeLocalConnector,localHeartbeat,pollLocalJob,finishLocalJob,localConnectionStatus,enqueueLocalJob,getLocalJob,disconnectLocalConnector} from './meta-local.mjs';
import {connectorBundle} from './meta-connector/bundle.mjs';
const metaBrowser=createMetaBrowser();
const flowImages=createFlowImages();

const PORT=Number(process.env.PORT||3000);
const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL){console.error('DATABASE_URL não configurada');process.exit(1);}
// Railway remains the live source until data is copied and validated.
// Supabase uses the private socio_app schema; never create the runtime tables
// in the public Data API schema during a future database cutover.
const dbHost=new URL(DATABASE_URL).hostname;
const isSupabaseDb=dbHost.endsWith('.supabase.co')||dbHost.endsWith('.pooler.supabase.com');
const dbSchema=process.env.SOCIO_DB_SCHEMA||'public';
if(!['public','socio_app'].includes(dbSchema)||(isSupabaseDb&&dbSchema!=='socio_app')){
 console.error('SOCIO_DB_SCHEMA must be socio_app for a Supabase database');
 process.exit(1);
}
const pool=new Pool({connectionString:DATABASE_URL,max:10,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,
 options:dbSchema==='socio_app'?'-c search_path=socio_app,pg_catalog':undefined});
const query=(sql,values=[])=>pool.query(sql,values);
async function fullCatalog(tenantId){
 const [items,variants,media,campaigns]=await Promise.all([
  query('SELECT id,name,description,sku,price_cents,stock_quantity,compare_at_price_cents,active FROM products WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 500',[tenantId]),
  query('SELECT id,product_id,name,sku,price_cents,stock_quantity,active FROM product_variants WHERE tenant_id=$1 ORDER BY created_at ASC',[tenantId]),
  query('SELECT id,product_id,alt,bytes FROM product_media WHERE tenant_id=$1 ORDER BY created_at ASC',[tenantId]),
  query('SELECT id,product_id,provider,campaign_id,label,verified FROM product_campaign_links WHERE tenant_id=$1 ORDER BY created_at DESC',[tenantId])
 ]);
 const byId=new Map(items.rows.map(p=>[p.id,{...p,variants:[],media:[],campaigns:[]}]));
 for(const variant of variants.rows){const p=byId.get(variant.product_id);if(p)p.variants.push(variant);}
 for(const m of media.rows){const p=byId.get(m.product_id);
  if(p)p.media.push({id:m.id,alt:m.alt,bytes:m.bytes,url:'/api/products/'+m.product_id+'/media/'+m.id+'/file'});
 }
 for(const c of campaigns.rows){const p=byId.get(c.product_id);if(p)p.campaigns.push(c);}
 return [...byId.values()];
}

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const fail=(status,message)=>Object.assign(new Error(message),{status});
const id=()=>randomUUID();
const now=()=>new Date();
const validText=(v,max=500)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const trimmed=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const money=v=>Number.isInteger(v)&&v>=0&&v<100000000;
const safeDetail=e=>[400,401,403,404,409,413,422,429,503].includes(e.status)?e.message:'Erro interno. Tente novamente.';
const authAttempts=new Map(),simulationAttempts=new Map(),cnpjCache=new Map();
function limiter(map,key,windowMs,max){
 const ts=Date.now(),value=map.get(key);
 if(!value||ts-value.since>windowMs){
  if(map.size>=10000){
   for(const [oldKey,entry] of map)if(ts-entry.since>windowMs)map.delete(oldKey);
   if(map.size>=10000)map.delete(map.keys().next().value);
  }
  map.set(key,{since:ts,count:1});return true;
 }
 value.count++;return value.count<=max;
}
function clientIp(req){return String(req.socket.remoteAddress||'unknown');}
function sessionCookie(token,clear=false){
 return 'socio_session='+(clear?'':encodeURIComponent(token))+'; Path=/; HttpOnly; SameSite=Strict'+(process.env.NODE_ENV==='production'?'; Secure':'')+(clear?'; Max-Age=0':'; Max-Age=604800');
}
async function body(req,limit=900000){
 let size=0,parts=[];
 for await(const piece of req){
  size+=piece.length;if(size>limit)throw fail(413,'Arquivo ou solicitação muito grande.');
  parts.push(piece);
 }
 const raw=Buffer.concat(parts);
 let data;
 try{data=raw.length?JSON.parse(raw.toString('utf8')):{};}catch{throw fail(400,'JSON inválido.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'Envie um objeto JSON válido.');
 return {raw,data};
}
function sameOrigin(req){
 const o=req.headers.origin;
 if(o){
  try{if(new URL(o).host!==req.headers.host)throw fail(403,'Origem não permitida.');}
  catch{throw fail(403,'Origem não permitida.');}
 }
 if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Origem não permitida.');
}
async function sessionFor(req){
 const match=String(req.headers.cookie||'').match(/(?:^|;\s*)socio_session=([^;]+)/);
 if(!match)return null;
 let token;try{token=decodeURIComponent(match[1]);}catch{return null;}
 if(!token||token.length>256)return null;
 const result=await query("SELECT s.token_hash,s.csrf,s.active_tenant_id,u.id AS user_id,u.name,u.email,u.phone,u.role,u.platform_owner,u.tenant_id,t.name AS tenant_name,t.plan,t.status AS tenant_status,t.features,t.quote_alert_whatsapp FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=s.active_tenant_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true AND (u.platform_owner=true OR u.tenant_id=s.active_tenant_id)",[hashToken(token)]);
 return result.rows[0]||null;
}
async function createSession(userId,tenantId,res){
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
 await query("INSERT INTO sessions(token_hash,user_id,active_tenant_id,csrf,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",[hashToken(token),userId,tenantId,csrf]);
 res.setHeader('Set-Cookie',sessionCookie(token));
 return csrf;
}
async function audit(a,action,metadata={}){
 await query('INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id(),a.active_tenant_id,a.user_id,action,JSON.stringify(metadata)]);
}
const mutations=new Set(['POST','PUT','PATCH','DELETE']);
async function handle(req,res){
 const pathname=new URL(req.url||'/', 'http://local').pathname;
 const method=req.method||'GET';
 if(process.env.SOCIO_INSTAGRAM_ENABLED!=='true'&&(pathname.startsWith('/api/instagram/')||pathname==='/webhooks/instagram'))return json(res,404,{error:'Integração Instagram indisponível.'});
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob: https://*.fbcdn.net https://*.fbsbx.com https://*.cdninstagram.com; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob: https://*.fbcdn.net https://*.fbsbx.com https://*.cdninstagram.com; frame-src https://www.facebook.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(method==='GET'&&pathname==='/health'){
  // Railway only considers the app ready when the tenant database is usable.
  // A static 200 here used to hide Postgres outages from the healthcheck.
  await query('SELECT 1');
  return json(res,200,{ok:true,app:'socio',database:'connected',readOnly:maintenanceEnabled()});
 }
 // Migration safety: every state-changing endpoint is blocked, including
 // login/session writes, public buyer acceptance and external webhooks.
 // The read barrier is evaluated BEFORE any webhook or authenticated route.
 if(writesBlocked(method)){
  res.setHeader('Retry-After','120');
  return json(res,503,{error:'Manutenção do Sócio em andamento. Novas alterações estão temporariamente bloqueadas.'});
 }
 // Public OAuth metadata for clients that support CIMD instead of dynamic registration.
 if(method==='GET'&&pathname==='/.well-known/oauth-client'){
  res.setHeader('Cache-Control','public,max-age=1800');
  return json(res,200,oauthClientMetadata());
 }
 if(method==='POST'&&['/api/marketing/official/deauthorize','/api/marketing/official/data-deletion'].includes(pathname)){
  let raw='';for await(const chunk of req){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>20000)throw fail(413,'Solicitação muito grande.');}
  const signed=new URLSearchParams(raw).get('signed_request');
  return json(res,200,await handleMetaRemoval(pool,signed));
 }
 if(method==='GET'&&pathname==='/meta-exclusao-status'){
  const qs=new URL(req.url,'http://local').searchParams;
  return json(res,200,await metaRemovalStatus(pool,qs.get('code')));
 }
 if(method==='GET'&&pathname==='/api/marketing/official/callback'){
  const qs=new URL(req.url,'http://local').searchParams;
  let outcome='failed';
  if(qs.get('error'))outcome='cancelled';
  else try{await finishOfficial(pool,qs.get('state'),qs.get('code'));outcome='authorized';}catch{}
  res.writeHead(303,{Location:'/?meta_official='+outcome,'Cache-Control':'no-store'});return res.end();
 }
 if(method==='GET'&&pathname==='/api/marketing/oauth/callback'){
  const qs=new URL(req.url,'http://local').searchParams;
  const isDenied=Boolean(qs.get('error'));
  let provider=null;
  if(!isDenied){
   try{
    const completed=await finishPipeboardOAuth(pool,qs.get('state'),qs.get('code'));
    provider=completed.provider==='meta'?'meta':null;
   }catch(error){
    console.warn('[marketing-oauth]',String(error?.status||'OAUTH_ERROR').slice(0,24));
    res.writeHead(303,{Location:'/?marketing=failed','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    return res.end();
   }
  }
  res.writeHead(303,{Location:isDenied?'/?marketing=cancelled':
   '/?marketing=authorized'+(provider?'&provider='+provider:''),
   'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  return res.end();
 }

 // Signed private video export for Meta fetch (never exposes S3 credentials).
 const assetExport=pathname.match(/^\/media\/ads\/([0-9a-f-]{36})$/i);
 if(assetExport&&['GET','HEAD'].includes(method)){
  const q=new URL(req.url,'http://local').searchParams;
  return serveSignedVideo(pool,assetExport[1],q.get('expires'),q.get('signature'),req,res);
 }
 const uploadPath=pathname.match(/^\/ads-upload\/([0-9a-f-]{36})$/i);
 if(uploadPath){
  const q=new URL(req.url,'http://local').searchParams;
  const asset=await resolveSignedAsset(pool,uploadPath[1],q.get('expires'),q.get('signature'),'upload');
  res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
  res.setHeader('Cache-Control','private,no-store');
  if(method==='GET'){
   if(asset.status!=='reserved')throw fail(409,'Este link já foi utilizado.');
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
   return res.end(await readFile(new URL('./public/ads-upload.html',import.meta.url)));
  }
  if(method==='POST'){
   sameOrigin(req);
   if(asset.status!=='reserved')throw fail(409,'Vídeo já enviado.');
   const bytes=Number(req.headers['content-length']||0);
   if(bytes>MAX_AD_VIDEO_BYTES)throw fail(413,'Vídeo excede 90 MB.');
   if(!['video/mp4','video/quicktime'].includes(String(req.headers['content-type'])))throw fail(422,'Envie MP4 ou MOV.');
   return json(res,201,await storeAdVideo(pool,asset.tenant_id,asset.id,req,{declaredBytes:bytes||undefined}));
  }
  throw fail(405,'Método não permitido.');
 }
 if(pathname==='/mcp/ads-media')return handleAdsMediaMcp(pool,req,res);
 // OAuth 2.1 for ChatGPT custom MCP: discovery, DCR, login+consent, token exchange.
 // All endpoints precede the normal tenant cookie/CSRF router by design.
 if(pathname==='/.well-known/oauth-protected-resource'||
    pathname==='/.well-known/oauth-protected-resource/mcp/ads-media'||
    pathname==='/.well-known/oauth-authorization-server'||
    pathname==='/oauth/register'||pathname==='/oauth/authorize'||pathname==='/oauth/token'){
   return handleMediaOAuth(pool,req,res,{sessionFor,limiter,authAttempts});
 }
 if(method==='GET'&&pathname==='/api/bootstrap'){
  const r=await query('SELECT EXISTS(SELECT 1 FROM users WHERE platform_owner=true) AS initialized');
  return json(res,200,{initialized:r.rows[0].initialized,groqConfigured:groqReady(),groqModel:groqModel()});
 }
 if(method==='GET'&&['/','/index.html','/legal.css','/privacidade.html','/termos.html','/exclusao-dados.html','/quote.html','/quote.js','/quote.css','/sales.js','/sales.css','/app.js','/flow-images-ui.js','/flow-owner-ui.js','/inbox.js','/socio-ux.js','/app.css','/neo-theme.css','/cloud-theme.css','/ember-theme.css','/inbox.css','/socio-ux.css','/prospector-socio.css','/socio-interview-ui.js','/socio-francisca-live.mjs','/socio-semantic-turn.mjs','/socio-workspace-ui.js','/socio-thalita-ui.js','/socio-executive.css','/socio-glass-motion.css','/socio-glass-motion.js','/socio-glass-enforced.css','/socio-premium-polish.css','/socio-contrast-audit.css','/socio-product-features.js','/socio-entry-motion.js','/socio-motion-refined.css','/socio-luminous-glass.css','/socio-stripe-system.css','/socio-master.css','/socio-master-dashboard.js','/meta-billing-ui.js','/ads-upload.js','/ads-media-ui.js','/meta-browser-ui.js','/meta-local-ui.js','/meta-official-ui.js','/meta-ads-tools-ui.js','/meta-advanced-ui.js','/meta-command-ui.js','/socio-ad-skills-ui.js','/meta-report-schedule-ui.js','/attribution-ui.js','/socio-integrations-ui.js','/meta-browser.css'].includes(pathname)){
  const file=pathname==='/'?'/index.html':pathname;
  const content=await readFile(new URL('./public'+file,import.meta.url));
  res.writeHead(200,{'Content-Type':(file.endsWith('.js')||file.endsWith('.mjs'))?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});
  return res.end(content);
 }
 if(pathname==='/webhooks/whatsapp'&&method==='GET'){
  const url=new URL(req.url,'http://local'),mode=url.searchParams.get('hub.mode'),verify=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
  if(mode==='subscribe'&&process.env.META_WEBHOOK_VERIFY_TOKEN&&secureEqual(verify,process.env.META_WEBHOOK_VERIFY_TOKEN)&&/^\d+$/.test(challenge||'')){res.writeHead(200,{'Content-Type':'text/plain'});return res.end(challenge);}
  throw fail(403,'Verificação rejeitada.');
 }
 if(pathname==='/webhooks/whatsapp'&&method==='POST')return receiveWhatsApp(req,res);
 // Instagram has a separate verified webhook; it can never claim WA-AKG channels.
 if(pathname==='/webhooks/instagram'&&method==='GET'){
  const url=new URL(req.url,'http://local');
  const challenge=url.searchParams.get('hub.challenge')||'';
  if(url.searchParams.get('hub.mode')==='subscribe'&&
   process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN&&
   secureEqual(url.searchParams.get('hub.verify_token'),process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN)&&
   /^\d{1,100}$/.test(challenge)){
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
   return res.end(challenge);
  }
  throw fail(403,'Verificação Instagram rejeitada.');
 }
 if(pathname==='/webhooks/instagram'&&method==='POST'){
  const {raw}=await body(req,250000);
  const result=await ingestInstagramWebhook(pool,raw,req.headers['x-hub-signature-256']);
  return json(res,200,result);
 }
 // OAuth callback is server-to-server; CSRF lives in the one-use hashed state
 // stored with the initiating authorized user, not in a cross-site cookie.
 if(pathname==='/api/instagram/oauth/callback'&&method==='GET'){
  const url=new URL(req.url,'http://local');
  try{
   await completeInstagramOAuth(pool,url.searchParams.get('state'),url.searchParams.get('code'));
   res.writeHead(303,{'Location':'/?instagram=connected','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  }catch(error){
   console.warn('[instagram-oauth]',String(error?.status||'PROVIDER_ERROR').slice(0,20));
   res.writeHead(303,{'Location':'/?instagram=failed','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  }
  return res.end();
 }
 if(method==='GET'&&pathname==='/api/google-ads/oauth/callback'){
  const params=new URL(req.url,'http://local').searchParams;
  let result='failed';
  if(params.get('error'))result='cancelled';
  else try{await finishGoogleAdsOAuth(pool,params.get('state'),params.get('code'));result='connected';}
  catch(error){console.warn('[google-ads-oauth]',String(error?.status||'OAUTH_FAILED').slice(0,20));}
  res.writeHead(303,{Location:'/?google_ads='+result,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  return res.end();
 }
 // Retired Google Ads Scripts receiver is intentionally closed.
 if(/^\/webhooks\/google-ads\/[0-9a-f-]{36}$/i.test(pathname))
  throw fail(410,'O conector Google Ads foi desativado.');
 // Stripe server-to-server webhook validates its raw signature before using JSON.
 if(pathname==='/webhooks/site-events'&&method==='POST'){
  const {raw}=await body(req,10000);
  if(!limiter(authAttempts,'site-events:'+clientIp(req),60000,120))
   throw fail(429,'Limite de eventos temporariamente atingido.');
  return json(res,200,await receiveSignedSiteEvent(pool,raw,req.headers));
 }
 if(pathname==='/webhooks/stripe-saas'&&method==='POST'){
  const {raw}=await body(req,200000);
  if(!limiter(authAttempts,'stripe-billing:'+clientIp(req),60000,250))
   throw fail(429,'Limite de eventos do Stripe atingido.');
  return json(res,200,await processSubscriptionWebhook(pool,raw,req.headers['stripe-signature']));
 }
 if(pathname==='/webhooks/stripe-test'&&method==='POST'){
  const {raw}=await body(req,160000);
  const result=await processStripeTestEvent(pool,raw,req.headers['stripe-signature']);
  return json(res,200,result);
 }
 if(mutations.has(method))sameOrigin(req);
 if(pathname==='/downloads/socio-meta-connector.zip'&&method==='GET'){
  const archive=await connectorBundle();
  res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="socio-meta-connector.zip"','Cache-Control':'no-store'});
  return res.end(archive);
 }
 if(pathname.startsWith('/api/meta-connector/')){
  if(method!=='POST')throw fail(405,'Método não permitido.');
  if(pathname==='/api/meta-connector/pair'){
   if(!limiter(authAttempts,'local-pair:'+clientIp(req),600000,40))throw fail(429,'Aguarde para conectar novamente.');
   const {data}=await body(req,2000);return json(res,200,await claimLocalPairing(pool,data));
  }
  const connection=await authorizeLocalConnector(pool,req.headers.authorization);
  if(!limiter(authAttempts,'connector:'+connection.id,60000,90))throw fail(429,'Aguarde antes de consultar novamente.');
  if(pathname==='/api/meta-connector/heartbeat'){
   const {data}=await body(req,2000);return json(res,200,await localHeartbeat(pool,connection,data));
  }
  if(pathname==='/api/meta-connector/poll')return json(res,200,await pollLocalJob(pool,connection));
  if(pathname==='/api/meta-connector/result'){
   const {data}=await body(req,500000);return json(res,200,await finishLocalJob(pool,connection,data));
  }
  throw fail(404,'Operação não encontrada.');
 }
 // Opaque buyer approval link; no access to unrelated tenant records.
 const publicQuotePath=pathname.match(/^\/api\/public\/quotes\/([a-f0-9]{64})$/);
 if(publicQuotePath&&method==='GET'){
  return json(res,200,await publicQuote(pool,publicQuotePath[1]));
 }
 const publicQuoteAction=pathname.match(/^\/api\/public\/quotes\/([a-f0-9]{64})\/(accept|decline|checkout)$/);
 if(publicQuoteAction&&method==='POST'){
  const [,token,action]=publicQuoteAction;
  if(!limiter(simulationAttempts,'buyer:'+token.slice(0,20),60000,12))
   throw fail(429,'Muitas solicitações neste orçamento.');
  if(action==='accept'){
   const {data}=await body(req,8000);
   return json(res,200,await approveQuote(pool,token,data.buyerName,data.agree===true));
  }
  if(action==='decline')return json(res,200,await declineQuote(pool,token));
  return json(res,200,await createTestCheckout(pool,token));
 }
 if(method==='POST'&&pathname==='/api/setup'){
  if(!limiter(authAttempts,'setup:'+clientIp(req),600000,8))throw fail(429,'Muitas tentativas.');
  const {data}=await body(req);
  if(!process.env.SETUP_TOKEN||process.env.SETUP_TOKEN.length<32)throw fail(503,'Configure SETUP_TOKEN com pelo menos 32 caracteres no Railway.');
  if(!secureEqual(String(data.setupToken||''),process.env.SETUP_TOKEN))throw fail(403,'Token de instalação incorreto.');
  if(!emailOk(data.email)||!validText(data.name,100)||!validText(data.company,120))throw fail(422,'Informe nome, empresa e e-mail válidos.');
  const accountPhone=String(data.phone||'').trim();
  const phone=accountPhone?normalizeLoginPhone(accountPhone):null;
  if(accountPhone&&!phone)throw fail(422,'Informe um celular válido com DDD.');
  const pw=await hashPassword(data.password);
  const c=await pool.connect(),tenant=id(),user=id();
  try{
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(2026110301)');
   const exists=await c.query('SELECT 1 FROM users WHERE platform_owner=true LIMIT 1');
   if(exists.rowCount)throw fail(409,'Instalação já concluída.');
   await c.query("INSERT INTO tenants(id,name,slug,plan,status) VALUES($1,$2,$3,'essencial','trial')",[tenant,data.company.trim(),slugify(data.company)+'-'+tenant.slice(0,6)]);
   await c.query('INSERT INTO users(id,tenant_id,email,phone,name,password_hash,role,platform_owner) VALUES($1,$2,$3,$4,$5,$6,$7,true)',[user,tenant,String(data.email).toLowerCase().trim(),phone,data.name.trim(),pw,'owner']);
   await c.query('INSERT INTO agents(tenant_id) VALUES($1)',[tenant]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const csrf=await createSession(user,tenant,res);
  return json(res,201,{ok:true,csrf});
 }
 if(method==='POST'&&pathname==='/api/login'){
  const {data}=await body(req);
  const identity=loginIdentifier(data.identifier??data.email);
  const key='login:'+hashToken(identity?identity.type+':'+identity.value:'invalid');
  if(!limiter(authAttempts,'login-source:'+clientIp(req),600000,300)||
     !limiter(authAttempts,key,600000,15))throw fail(429,'Muitas tentativas de login. Tente mais tarde.');
  const result=identity?await query(
   identity.type==='email'
    ?'SELECT id,tenant_id,password_hash FROM users WHERE email=$1 AND active=true'
    :'SELECT id,tenant_id,password_hash FROM users WHERE phone=$1 AND active=true',[identity.value]
  ):{rows:[]};
  const u=result.rows[0];
  if(!u||!(await verifyPassword(data.password||'',u.password_hash)))throw fail(401,'E-mail, número ou senha incorretos.');
  authAttempts.delete(key);
  const csrf=await createSession(u.id,u.tenant_id,res);
  return json(res,200,{ok:true,csrf});
 }
 const a=await sessionFor(req);
 if(!a)throw fail(401,'Entre na sua conta para continuar.');
 // Keep account/session recovery and platform administration available while
 // preventing a paused company from continuing its normal operations.
 if(a.tenant_status==='paused'&&!['/api/me','/api/logout','/api/me/phone','/api/me/password'].includes(pathname)&&
    !(a.platform_owner&&pathname.startsWith('/api/admin/')))
  throw fail(403,'Esta empresa está pausada. Entre em contato com a administração.');
 if(mutations.has(method)){
  const csrf=req.headers['x-csrf-token'];
  if(!csrf||!secureEqual(String(csrf),a.csrf))throw fail(403,'Sessão sem validação de segurança.');
 }
 if(method==='GET'&&pathname==='/api/me')return json(res,200,{
  user:{id:a.user_id,name:a.name,email:a.email,phone:a.phone,role:a.role,
   platformOwner:a.platform_owner,homeTenantId:(a.platform_owner&&a.role==='owner')?a.tenant_id:null,
   permissions:filterPermissions(permissionsFor(a.role,a.platform_owner),a.features)},
  tenant:{id:a.active_tenant_id,name:a.tenant_name,plan:a.plan,status:a.tenant_status,
   features:parseTenantFeatures(a.features),quoteAlertWhatsApp:a.quote_alert_whatsapp===true},
  csrf:a.csrf,groqConfigured:groqReady(),groqModel:groqModel()});
 // The viewer role is enforced server-side: never permit writes through any authenticated API.
 // Explicitly preserve account logout and personal password management.
 if(a.role==='viewer'&&!a.platform_owner&&!['GET','HEAD','OPTIONS'].includes(method)&&
  !['/api/logout','/api/me/password','/api/me/phone'].includes(pathname))
  throw fail(403,'Este perfil tem acesso somente de leitura.');
 // Feature restrictions are server-side. Hidden navigation never constitutes authorization.
 assertApiFeature(a.features,pathname);

 if(pathname==='/api/flow/status'&&method==='GET')return json(res,200,await flowImages.status(a));
 const flowBrowser=pathname.match(/^\/api\/flow\/browser\/(status|open|screen|input|finish|close)$/);
 if(flowBrowser){
  const kind=flowBrowser[1],read=['status','screen'].includes(kind);
  if(method!==(read?'GET':'POST'))throw fail(405,'Método inválido.');
  if(a.platform_owner!==true)throw fail(403,'Somente o administrador master pode conectar a conta Google compartilhada.');
  if(!limiter(authAttempts,'flow-browser:'+a.user_id,60000,180))throw fail(429,'Aguarde antes de tentar novamente.');
  const data=read?{}:(await body(req,12000)).data;
  const result=await flowImages.browser(a,kind,data);
  if(kind==='screen'){
   res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store'});
   return res.end(Buffer.from(result.jpeg,'base64'));
  }
  return json(res,200,result);
 }
 if(pathname==='/api/flow/images'&&method==='POST'){
  if(!limiter(simulationAttempts,'flow-images:'+a.user_id,60000,12))throw fail(429,'Aguarde antes de gerar novamente.');
  const {data}=await body(req,32768);
  const result=await flowImages.create(pool,a,data,req.headers['idempotency-key']);
  await audit(a,'flow.image.requested',{jobId:result.id});
  return json(res,202,result);
 }
 const flowImage=pathname.match(/^\/api\/flow\/images\/([a-f0-9-]{36})(\/content)?$/);
 if(flowImage&&method==='GET'){
  if(!flowImage[2])return json(res,200,await flowImages.read(pool,a,flowImage[1]));
  const image=await flowImages.content(pool,a,flowImage[1]);
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.mime];
  res.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.bytes.length,
   'Content-Disposition':`attachment; filename="socio-${flowImage[1]}.${ext}"`,'Cache-Control':'private, no-store'});
  return res.end(image.bytes);
 }

 if(pathname==='/api/marketing/attribution/links'&&method==='GET')
  return json(res,200,await listTrackingLinks(pool,a));
 if(pathname==='/api/marketing/attribution/report'&&method==='GET')
  return json(res,200,await trackingReport(pool,a));
 if(pathname==='/api/marketing/attribution/funnel'&&method==='GET')
  return json(res,200,await readWhatsAppFunnel(pool,a));
 if(pathname==='/api/marketing/attribution/links'&&method==='POST'){
  if(!limiter(simulationAttempts,'tracking-link:'+a.user_id,60000,12))throw fail(429,'Aguarde antes de gerar outro link.');
  const {data}=await body(req,3000);
  const result=await createTrackingLink(pool,a,data);
  await audit(a,'marketing.attribution.link.created',{id:result.id,channelId:result.channelId});
  return json(res,201,result);
 }
 const deactivateLink=pathname.match(/^\/api\/marketing\/attribution\/links\/([0-9a-f-]{36})$/i);
 if(deactivateLink&&method==='DELETE'){
  const result=await deactivateTrackingLink(pool,a,deactivateLink[1]);
  await audit(a,'marketing.attribution.link.disabled',{id:result.id});
  return json(res,200,result);
 }
 if(pathname==='/api/marketing/report-schedule'&&method==='GET')
  return json(res,200,await listMetaReportSchedule(pool,a));
 if(pathname==='/api/marketing/report-schedule'&&method==='PUT'){
  if(!limiter(simulationAttempts,'meta-schedule:'+a.user_id,60000,8))
   throw fail(429,'Aguarde para alterar o agendamento.');
  const {data}=await body(req,1500);
  const result=await saveMetaReportSchedule(pool,a,data);
  await audit(a,'marketing.report.schedule.updated',{enabled:result.schedule.enabled,hour:result.schedule.hour});
  return json(res,200,result);
 }
 if(pathname==='/api/marketing/skills/whatsapp-readiness'&&method==='GET'){
  if(!limiter(simulationAttempts,'wa-owner-readiness:'+a.user_id,60000,6))
   throw fail(429,'Aguarde antes de repetir o diagnóstico.');
  return json(res,200,await ownerWhatsAppReadiness(pool,a));
 }
 if(pathname==='/api/marketing/skills/catalog'&&method==='GET'){
  requirePermission(a,'marketing.read');
  return json(res,200,{skills:SOCIO_AD_SKILLS,experts:listExpertSkills(),
   note:'Meta Ads usa integração oficial. Google Ads ainda não está conectado. Pixel não funciona dentro do WhatsApp, e CAPI depende de sites autorizados.'});
 }
 if(pathname==='/api/marketing/skills/guidance'&&method==='GET'){
  requirePermission(a,'marketing.read');
  const id=new URL(req.url,'http://local').searchParams.get('id');
  // The allowlist resolves the file; never read arbitrary paths from a request.
  return json(res,200,getExpertSkillGuide(id));
 }
 if(pathname==='/api/marketing/skills/chat'&&method==='POST'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'marketing-skill:'+a.user_id,60000,12))
   throw fail(429,'Muitas solicitações. Tente novamente em um minuto.');
  const {data}=await body(req,3500);
  const answer=await speakToSocioSkill(pool,a,{message:data.message,runId:data.runId,imageHash:data.imageHash,videoId:data.videoId});
  await audit(a,'marketing.skill.request',{runId:answer.runId,status:answer.status,skill:answer.skillId||'ads.campaign.launch'});
  return json(res,200,answer);
 }
 if(pathname==='/api/marketing/commands/preview'&&method==='POST'){
  if(!limiter(simulationAttempts,'marketing-command:'+a.user_id,60000,15))
   throw fail(429,'Aguarde antes de preparar outra consulta.');
  const {data}=await body(req,3000);
  return json(res,200,await previewMetaCommand(pool,a,data.text));
 }
 if(pathname==='/api/marketing/advanced/catalog'&&method==='GET')
  return json(res,200,{tools:META_TOOL_CATALOG});
 const advancedRoute=pathname.match(/^\/api\/marketing\/advanced\/(account|creatives|videos|audiences|pixels|conversions|reports|diagnosis|activity|labels|rules|delivery|video_report|conversion_report|budget_report|creative_report)$/);
 if(advancedRoute&&method==='GET'){
  requirePermission(a,'marketing.read');
  if(!limiter(simulationAttempts,'meta-advanced:'+a.user_id+':'+a.active_tenant_id,60000,90))
   throw fail(429,'Muitas consultas Meta. Aguarde antes de consultar novamente.');
  const qs=new URL(req.url,'http://local').searchParams;
  return json(res,200,await readAdvancedMetaTool(pool,a,advancedRoute[1],
   {period:qs.get('period'),level:qs.get('level'),breakdown:qs.get('breakdown'),
    daily:qs.get('daily'),after:qs.get('after')}));
 }
 if(method==='GET'&&pathname==='/api/marketing/tools/ad-media'){
  const params=new URL(req.url,'http://local').searchParams;
  const adId=params.get('adId'),posterOnly=params.get('posterOnly')==='1';
  if(!limiter(simulationAttempts,(posterOnly?'ad-poster:':'ad-preview:')+a.user_id,60000,posterOnly?120:36))
   throw fail(429,'Muitas consultas de criativos. Tente novamente.');
  return json(res,200,await readSelectedAdMedia(pool,a,adId,{posterOnly}));
 }
 const adsRead=pathname.match(/^\/api\/marketing\/tools\/(campaigns|adsets|ads|images|pages|insights|finance|cities)$/);
 if(adsRead&&method==='GET'){
  const qs=new URL(req.url,'http://local').searchParams;
  const result=await readAdsTool(pool,a,adsRead[1],{query:qs.get('q'),period:qs.get('period'),after:qs.get('after'),campaignId:qs.get('campaignId'),adsetId:qs.get('adsetId')});
  if(adsRead[1]==='finance'){
   const observed=await metaBillingStatus(pool,a,result.account.id);
   result.balanceObservation=observed.observation;
   result.balanceAlert=observed.alert;
   result.billingNeedsLogin=observed.needsLogin===true;
   if(result.finance.availableFundsMinor===null&&observed.alert.state!=='unknown'){
    result.finance.availableFundsMinor=observed.observation.availableFundsMinor;
    result.finance.availableFundsSource=observed.observation.source;
    result.finance.checkedAt=observed.observation.observedAt;
    result.finance.validUntil=observed.observation.validUntil;
    result.finance.availableFundsStatus='observed_browser';
   }
   result.assistedPix={supported:result.finance.currency==='BRL',requiresBillingSession:true,automaticPayment:false};
  }
  return json(res,200,result);
 }
 if(pathname==='/api/marketing/tools/history'&&method==='GET')return json(res,200,await adsToolHistory(pool,a));
 if(pathname==='/api/marketing/tools/image'&&method==='POST'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'meta-image:'+a.user_id,60000,8))throw fail(429,'Aguarde antes de enviar outra imagem.');
  const {data}=await body(req,4500000);const result=await uploadAdImage(pool,a,data.contentBase64);
  await audit(a,'marketing.official.image.uploaded',{hash:result.hash,accountId:result.accountId});return json(res,201,result);
 }
 if(pathname==='/api/marketing/tools/whatsapp-video/channels'&&method==='GET'){
  requirePermission(a,'marketing.manage');
  return json(res,200,await listTenantVideoChannels(pool,a));
 }
 if(pathname==='/api/marketing/tools/whatsapp-video/last'&&method==='GET'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'wa-video-last:'+a.user_id,60000,8))
   throw fail(429,'Aguarde antes de consultar outro vídeo.');
  const qs=new URL(req.url,'http://local').searchParams;
  return json(res,200,await findLastOutgoingVideo(pool,a,{
   channelId:qs.get('channelId'),recipientPhone:qs.get('recipientPhone'),
   direction:qs.get('direction')||'outgoing'
  }));
 }
 if(pathname==='/api/marketing/tools/whatsapp-video/import'&&method==='POST'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'wa-video-import:'+a.user_id,60000,2))
   throw fail(429,'Aguarde antes de importar outro vídeo.');
  const {data}=await body(req,3000);
  const result=await importLastOutgoingVideo(pool,a,{
   channelId:data.channelId,recipientPhone:data.recipientPhone,
   direction:data.direction||'outgoing',messageId:data.messageId,confirmed:data.confirmed
  });
  await audit(a,'marketing.official.video.imported',{
   channelId:data.channelId,accountId:result.accountId,videoId:result.videoId,
   status:result.status,replayed:Boolean(result.replayed)
  });
  return json(res,result.replayed?200:201,result);
 }
 if(pathname==='/api/marketing/tools/plan'&&method==='POST'){
  requirePermission(a,'marketing.manage');const {data}=await body(req,12000);
  return json(res,201,await prepareAdsPlan(pool,a,data.kind,data.input));
 }
 if(pathname==='/api/marketing/tools/execute'&&method==='POST'){
  requirePermission(a,'marketing.manage');const {data}=await body(req,2000);
  const result=await executeAdsPlan(pool,a,data.planId,data.confirmed);
  await audit(a,'marketing.official.operation',{planId:data.planId,status:result.status});return json(res,200,result);
 }
 if(pathname==='/api/marketing/official/status'&&method==='GET')return json(res,200,await officialStatus(pool,a));
 const campaignAuditRoute=pathname.match(/^\/api\/marketing\/official\/campaign\/([0-9]{4,30})\/audit$/);
 if(campaignAuditRoute&&method==='GET'){
  if(!limiter(simulationAttempts,'meta-campaign-audit:'+a.user_id,60000,6))
   throw fail(429,'Aguarde antes de repetir o diagnóstico.');
  return json(res,200,await inspectOfficialCampaign(pool,a,campaignAuditRoute[1]));
 }
 if(pathname==='/api/marketing/official/preflight'&&method==='GET'){
  if(!limiter(simulationAttempts,'meta-official-preflight:'+a.user_id,60000,4))
   throw fail(429,'Aguarde um minuto antes de repetir o diagnóstico.');
  return json(res,200,await metaConnectionPreflight(pool,a));
 }

 if(pathname==='/api/marketing/official/accounts'&&method==='GET')return json(res,200,await officialAccounts(pool,a));
 if(pathname==='/api/marketing/official/account'&&method==='POST'){
  requirePermission(a,'marketing.manage');
  const {data}=await body(req,2000);
  const result=await selectOfficialAccount(pool,a,data.accountId);
  await audit(a,'marketing.official.account.selected',{accountId:result.selectedAccount.account_id});
  return json(res,200,result);
 }
 if(pathname==='/api/marketing/official/connect'&&method==='POST'){
  if(!limiter(authAttempts,'meta-official:'+a.user_id,600000,10))throw fail(429,'Aguarde antes de tentar novamente.');
  return json(res,200,await startOfficial(pool,a));
 }
 if(pathname==='/api/marketing/official/disconnect'&&method==='POST')return json(res,200,await disconnectOfficial(pool,a));
 if(pathname==='/api/marketing/local/status'&&method==='GET')return json(res,200,await localConnectionStatus(pool,a));
 if(pathname==='/api/marketing/local/pairing'&&method==='POST'){
  if(!limiter(authAttempts,'local-pairing:'+a.user_id,600000,10))throw fail(429,'Muitas tentativas. Aguarde antes de conectar novamente.');
  const result=await startLocalPairing(pool,a);await audit(a,'marketing.local.pairing',{});return json(res,200,result);
 }
 if(pathname==='/api/marketing/local/disconnect'&&method==='POST')return json(res,200,await disconnectLocalConnector(pool,a));
 if(pathname==='/api/marketing/local/jobs'&&method==='POST'){
  if(!limiter(authAttempts,'local-job:'+a.user_id,60000,12))throw fail(429,'Aguarde a operação atual.');
  const {data}=await body(req,250000);return json(res,200,await enqueueLocalJob(pool,a,data.kind,data.input,req.headers['idempotency-key']));
 }
 const localJob=pathname.match(/^\/api\/marketing\/local\/jobs\/([0-9a-f-]{36})$/i);
 if(localJob&&method==='GET')return json(res,200,await getLocalJob(pool,a,localJob[1]));

 // Wallet observations and Pix preparation use a server-resolved account only.
 if(pathname==='/api/marketing/billing/status'&&method==='GET')
  return json(res,200,await metaBillingStatus(pool,a));
 const billingRoute=pathname.match(/^\/api\/marketing\/billing\/(refresh|prepare|pix)$/);
 if(billingRoute&&method==='POST'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'meta-billing:'+a.user_id+':'+a.active_tenant_id,60000,6))
   throw fail(429,'Aguarde antes de atualizar o faturamento novamente.');
  const {data}=await body(req,2000);
  if(billingRoute[1]==='prepare'&&data.confirmed!==true)
   throw fail(422,'Confira o valor antes de preparar a recarga.');
  const result=await metaBrowser.billing(pool,a,billingRoute[1]==='refresh'?'read':billingRoute[1]==='pix'?'pix':'prepare',{
   amountMinor:data.amountMinor,background:billingRoute[1]==='refresh'&&data.background===true});
  const saved=result.observation?await saveMetaBillingObservation(pool,a,result):null;
  await audit(a,'marketing.billing.'+billingRoute[1],{accountId:result.accountId,state:result.state});
  return json(res,200,{...result,...saved,paymentInitiated:false});
 }
 // API Anything uses only the actor's isolated browser profile in the active tenant.
 if(pathname==='/api/marketing/browser/status'&&method==='GET')return json(res,200,await metaBrowser.status(pool,a));
 const browserRoute=pathname.match(/^\/api\/marketing\/browser\/(open|screen|input|finish|close|disconnect|plan|execute)$/);
 if(browserRoute){
  const kind=browserRoute[1];
  if(kind==='screen'&&method==='GET'){
   const result=await metaBrowser.action(pool,a,'screen');
   res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private,no-store'});
   return res.end(Buffer.from(result.jpeg,'base64'));
  }
  if(kind!=='screen'&&method==='POST'){
   const {data}=await body(req,250000);
   const result=await metaBrowser.action(pool,a,kind,data,req.headers['idempotency-key']);
   // Input may contain a password/2FA. Never include it in audit or error logs.
   if(['open','finish','close','disconnect'].includes(kind))await audit(a,'marketing.browser.'+kind,{});
   return json(res,200,result);
  }
  throw fail(405,'Método não permitido.');
 }

 // Tenant-scoped Media Bridge: uploads here do not publish or modify Meta campaigns.
 if(method==='GET'&&pathname==='/api/ads-media'){
  requirePermission(a,'marketing.read');
  return json(res,200,{configured:mediaConfigured(),maxBytes:MAX_AD_VIDEO_BYTES,items:await listAdVideos(pool,a.active_tenant_id)});
 }
 if(method==='POST'&&pathname==='/api/ads-media/reserve'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'ads-reserve:'+a.active_tenant_id,3600000,40))throw fail(429,'Limite de mídia atingido.');
  const {data}=await body(req,2000);
  return json(res,201,await reserveAdVideo(pool,a,String(data.filename||''),'chat'));
 }
 const adsFile=pathname.match(/^\/api\/ads-media\/([0-9a-f-]{36})\/(upload|export)$/i);
 if(adsFile&&method==='POST'){
  requirePermission(a,'marketing.manage');
  if(adsFile[2]==='export')return json(res,200,await adVideoExportUrl(pool,a.active_tenant_id,adsFile[1]));
  const bytes=Number(req.headers['content-length']||0);
  if(bytes>MAX_AD_VIDEO_BYTES)throw fail(413,'Vídeo maior que 90 MB.');
  if(!['video/mp4','video/quicktime','application/octet-stream'].includes(String(req.headers['content-type'])))throw fail(422,'Envie MP4 ou MOV.');
  const stored=await storeAdVideo(pool,a.active_tenant_id,adsFile[1],req,{declaredBytes:bytes||undefined});
  await audit(a,'ads.media.uploaded',{mediaId:adsFile[1],bytes:stored.bytes});
  return json(res,201,stored);
 }
 if(method==='POST'&&pathname==='/api/ads-media/import-whatsapp'){
  requirePermission(a,'marketing.manage');
  if(!limiter(simulationAttempts,'ads-wa:'+a.user_id,60000,4))throw fail(429,'Muitas importações.');
  const {data}=await body(req,2000);
  const imported=await importWhatsAppAdVideo(pool,a,{channelId:data.channelId,jid:data.jid,messageId:data.messageId,filename:data.filename});
  await audit(a,'ads.media.whatsapp_imported',{mediaId:imported.id});
  return json(res,201,imported);
 }
 if(method==='POST'&&pathname==='/api/ads-media/mcp-token'){
  requirePermission(a,'marketing.manage');
  if(!limiter(authAttempts,'mcp-token:'+a.user_id,3600000,5))throw fail(429,'Muitas chaves.');
  const token=await createMediaMcpToken(pool,a);
  await audit(a,'ads.media.mcp_token_rotated',{});
  return json(res,201,token);
 }
 if(method==='POST'&&pathname==='/api/ads-media/mcp-revoke'){
  requirePermission(a,'marketing.manage');
  await revokeMediaMcpTokens(pool,a);
  await audit(a,'ads.media.mcp_token_revoked',{});
  return json(res,200,{revoked:true});
 }
 // Hosted one-click OAuth (Pipeboard). Tokens never go to the browser.
 if(method==='GET'&&pathname==='/api/marketing/oauth'){
  requirePermission(a,'marketing.read');
  return json(res,200,{grants:await listPipeboardOAuth(pool,a)});
 }
 if(method==='POST'&&pathname==='/api/marketing/oauth/start'){
  requirePermission(a,'marketing.manage');
  if(!limiter(authAttempts,'marketing-oauth:'+a.user_id,600000,6))
   throw fail(429,'Muitas tentativas de conexão. Tente novamente.');
  const {data}=await body(req,2500);
  const result=await startPipeboardOAuth(pool,a,String(data.provider||''));
  await audit(a,'marketing.oauth_started',{provider:result.provider});
  return json(res,200,result);
 }
 const oauthTest=pathname.match(/^\/api\/marketing\/oauth\/(meta)\/test$/);
 if(oauthTest&&method==='POST'){
  requirePermission(a,'marketing.manage');
  if(!limiter(authAttempts,'marketing-test:'+a.user_id,60000,6))throw fail(429,'Aguarde um minuto para testar novamente.');
  const result=await testPipeboardConnection(pool,a,oauthTest[1]);
  await audit(a,'marketing.connection_test',{provider:oauthTest[1],status:result.status,accounts:result.accounts.length});
  return json(res,200,result);
 }
 const oauthRevoke=pathname.match(/^\/api\/marketing\/oauth\/(meta)\/disconnect$/);
 if(oauthRevoke&&method==='POST'){
  requirePermission(a,'marketing.manage');
  const result=await revokePipeboardOAuth(pool,a,oauthRevoke[1]);
  await audit(a,'marketing.oauth_disconnected',{provider:oauthRevoke[1]});
  return json(res,200,result);
 }
 // Managed Instagram SSO; only enabled when agency has configured a hosted
 // provider with separately created tenant profiles.
 if(method==='GET'&&pathname==='/api/instagram/hosted/status'){
  requirePermission(a,'channels.manage');
  return json(res,200,await instagramHostedStatus(pool,a));
 }
 if(method==='POST'&&pathname==='/api/instagram/hosted/connect'){
  requirePermission(a,'channels.manage');
  if(!limiter(authAttempts,'hosted-instagram:'+a.user_id,600000,5))
   throw fail(429,'Muitas tentativas de conectar Instagram.');
  const result=await beginInstagramHosted(pool,a,a.tenant_name);
  await audit(a,'instagram.hosted_link_started',{provider:result.provider});
  return json(res,200,result);
 }
 if(method==='POST'&&pathname==='/api/instagram/hosted/disconnect'){
  requirePermission(a,'channels.manage');
  const result=await disconnectInstagramHosted(pool,a);
  await audit(a,'instagram.hosted_link_revoked');
  return json(res,200,result);
 }
 // Google Ads has been retired from Sócio. Preserve historical records,
 // but do not allow new credentials, OAuth checks or report ingestion.
 if((pathname==='/api/marketing/google/register' ||
     /^\/api\/marketing\/oauth\/google\/(test|disconnect)$/.test(pathname) ||
     /^\/webhooks\/google-ads\/[0-9a-f-]{36}$/i.test(pathname)))
  throw fail(410,'Google Ads não está mais disponível no Sócio.');
 // Company-level Meta Ads integration: read-only by default.
 if(method==='GET'&&pathname==='/api/marketing'){
  requirePermission(a,'marketing.read');
  const report=await listMarketing(pool,a);
  // Google integrations are retired; retain historic SQL rows privately,
  // but never surface them through the active company dashboard API.
  return json(res,200,{
   connections:report.connections.filter(c=>c.provider==='pipeboard_meta'),
   reports:report.reports.filter(row=>row.provider==='pipeboard_meta'),
   providers:{pipeboard_meta:report.providers.pipeboard_meta}
  });
 }
 if(method==='POST'&&pathname==='/api/marketing/meta/connect'){
  requirePermission(a,'marketing.manage');
  if(!limiter(authAttempts,'pipeboard:'+a.user_id,600000,5))
   throw fail(429,'Muitas tentativas de autenticação Pipeboard.');
  const {data}=await body(req,23000);
  const connection=await connectPipeboard(pool,a,data);
  await audit(a,'marketing.pipeboard.verified',{connectionId:connection.id,accountId:connection.account_id});
  return json(res,201,connection);
 }
 const marketingDisconnect=pathname.match(/^\/api\/marketing\/connections\/([0-9a-f-]{36})\/disconnect$/i);
 if(marketingDisconnect&&method==='POST'){
  requirePermission(a,'marketing.manage');
  const result=await disconnectMarketing(pool,a,marketingDisconnect[1]);
  await audit(a,'marketing.connection.disconnected',{connectionId:marketingDisconnect[1],provider:result.connection.provider});
  return json(res,200,{ok:true,disconnected:true});
 }
 // Instagram Login is available only to owners/admins. Access token and
 // webhook verification secrets never leave the server.
 if(method==='GET'&&pathname==='/api/instagram/config'){
  return json(res,200,{configured:instagramReady(),redirectUri:process.env.SOCIO_PUBLIC_URL?
   process.env.SOCIO_PUBLIC_URL.replace(/\/$/,'')+'/api/instagram/oauth/callback':null,
   webhookPath:'/webhooks/instagram',requiresProfessionalAccount:true,
   outboundPolicy:'Only human replies after a recent incoming message',permissionsRequired:[
    'instagram_business_basic','instagram_business_manage_messages']});
 }
 if(method==='GET'&&pathname==='/api/instagram/accounts'){
  requirePermission(a,'channels.manage');
  const r=await query(
   "SELECT i.channel_id,i.username,i.status,i.token_expires_at,i.created_at,ch.label "+
   "FROM instagram_accounts i JOIN channels ch ON ch.id=i.channel_id AND ch.tenant_id=i.tenant_id "+
   "WHERE i.tenant_id=$1 ORDER BY i.created_at DESC",[a.active_tenant_id]);
  return json(res,200,r.rows);
 }
 if(method==='POST'&&pathname==='/api/instagram/connect'){
  requirePermission(a,'channels.manage');
  if(!limiter(authAttempts,'instagram-oauth:'+a.user_id,600000,5))
   throw fail(429,'Muitas tentativas de conexão Instagram.');
  const result=await beginInstagramOAuth(pool,a.active_tenant_id,a.user_id);
  await audit(a,'instagram.oauth_initiated');
  return json(res,200,result);
 }
 const igRevoke=pathname.match(/^\/api\/instagram\/accounts\/([0-9a-f-]{36})\/revoke$/);
 if(igRevoke&&method==='POST'){
  requirePermission(a,'channels.manage');
  return json(res,200,await revokeInstagramAccount(pool,a.active_tenant_id,a.user_id,igRevoke[1]));
 }
 // Changing a phone login identifier requires the signed-in user's current password.
 // Never infer this from the company's connected WhatsApp number.
 if(method==='POST'&&pathname==='/api/me/phone'){
  if(!limiter(authAttempts,'phone-update:'+a.user_id,600000,8))throw fail(429,'Muitas tentativas. Tente novamente.');
  const {data}=await body(req);
  const raw=typeof data.phone==='string'?data.phone.trim():'';
  if(raw.length>32)throw fail(422,'Número de telefone inválido.');
  const normalized=raw?normalizeLoginPhone(raw):null;
  if(raw&&!normalized)throw fail(422,'Informe um número válido com DDD.');
  const record=await query('SELECT password_hash FROM users WHERE id=$1',[a.user_id]);
  if(!record.rowCount||!(await verifyPassword(data.currentPassword||'',record.rows[0].password_hash)))
   throw fail(401,'Senha atual incorreta.');
  const updated=await query('UPDATE users SET phone=$2 WHERE id=$1 RETURNING phone',[a.user_id,normalized]);
  authAttempts.delete('phone-update:'+a.user_id);
  await audit(a,'auth.login_phone_updated',{configured:!!normalized});
  return json(res,200,{ok:true,phone:updated.rows[0].phone});
 }
 if(method==='POST'&&pathname==='/api/me/password'){
  if(!limiter(authAttempts,'password-change:'+a.user_id,600000,7))
   throw fail(429,'Muitas tentativas. Tente mais tarde.');
  const {data}=await body(req,1200);
  if(typeof data?.currentPassword!=='string'||typeof data?.newPassword!=='string'||
    data.newPassword.length<12||data.newPassword.length>128||
    data.newPassword===data.currentPassword)
   throw fail(422,'A nova senha deve ter de 12 a 128 caracteres e ser diferente da anterior.');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const previous=await c.query('SELECT password_hash FROM users WHERE id=$1 AND active=true FOR UPDATE',[a.user_id]);
   if(!previous.rowCount||!(await verifyPassword(data.currentPassword,previous.rows[0].password_hash)))
    throw fail(401,'Senha atual incorreta.');
   const encrypted=await hashPassword(data.newPassword);
   await c.query('UPDATE users SET password_hash=$2 WHERE id=$1',[a.user_id,encrypted]);
   await c.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2',[a.user_id,a.token_hash]);
   await c.query('INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[
    id(),a.active_tenant_id,a.user_id,'auth.password_changed',JSON.stringify({otherSessionsRevoked:true})]);
   await c.query('COMMIT');
   authAttempts.delete('password-change:'+a.user_id);
   return json(res,200,{ok:true,otherSessionsRevoked:true});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 if(method==='POST'&&pathname==='/api/logout'){
  await query('DELETE FROM sessions WHERE token_hash=$1',[a.token_hash]);
  res.setHeader('Set-Cookie',sessionCookie('',true));
  return json(res,200,{ok:true});
 }
 // Real activity grouped by period for the dashboard visualizations.
 // All counts are tenant-scoped; the chart never uses illustrative or invented data.
 if(method==='GET'&&pathname==='/api/dashboard/activity'){
  const requested=new URL(req.url,'http://local').searchParams.get('range')||'6m';
  const ranges={'12m':{count:12,unit:'month'},'6m':{count:6,unit:'month'},'3m':{count:3,unit:'month'},'1m':{count:30,unit:'day'},'7d':{count:7,unit:'day'},'90d':{count:90,unit:'day'}};
  const range=Object.hasOwn(ranges,requested)?ranges[requested]:null;
  if(!range)throw fail(400,'Período inválido.');
  const interval=range.unit==='day'?'1 day':'1 month';
  const sql=`WITH buckets AS (
   SELECT date_trunc('${range.unit}', now() AT TIME ZONE 'America/Sao_Paulo') - step * interval '${interval}' AS bucket
   FROM generate_series(${range.count-1},0,-1) AS series(step)
  ) SELECT to_char(b.bucket,'YYYY-MM-DD') AS date,
   COALESCE(count(m.id) FILTER (WHERE m.direction='inbound'),0)::int AS inbound,
   COALESCE(count(m.id) FILTER (WHERE m.direction='outbound'),0)::int AS outbound
   FROM buckets b LEFT JOIN messages m ON m.tenant_id=$1 AND $2::boolean=true
    AND m.created_at>=(b.bucket AT TIME ZONE 'America/Sao_Paulo')
    AND m.created_at<((b.bucket + interval '${interval}') AT TIME ZONE 'America/Sao_Paulo')
   GROUP BY b.bucket ORDER BY b.bucket ASC`;
  const results=await query(sql,[a.active_tenant_id,parseTenantFeatures(a.features).whatsapp]);
  return json(res,200,{range:requested,granularity:range.unit,points:results.rows});
 }
 // Floating Thalita: read tools for the active company; all writes need one-use approval.
 if(method==='POST'&&pathname==='/api/thalita/ask'){
  assertApiFeature(a.features,'/api/agent');
  if(!limiter(simulationAttempts,'thalita-chat:'+a.user_id,60000,16))throw fail(429,'Aguarde antes de consultar novamente.');
  const {data}=await body(req,2400);
  const result=await askThalita(pool,a,{message:data.message,runId:data.runId});
  await audit(a,'thalita.chat',{status:result.status,readOnly:result.readOnly===true,executed:result.executed===true});
  return json(res,200,result);
 }
 if(method==='POST'&&pathname==='/api/thalita/confirm'){
  assertApiFeature(a.features,'/api/agent');
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'thalita-confirm:'+a.user_id,60000,6))throw fail(429,'Aguarde antes de executar novamente.');
  const {data}=await body(req,1200);
  const result=await confirmThalita(pool,a,data);
  await audit(a,'thalita.approved_action',result.audit||{});
  return json(res,200,result);
 }
 if(method==='POST'&&pathname==='/api/thalita/tts'){
  assertApiFeature(a.features,'/api/agent');
  if(!limiter(simulationAttempts,'thalita-tts:'+a.active_tenant_id,60000,14))throw fail(429,'Limite temporário de voz.');
  const {data}=await body(req,1200);
  const audio=await synthesizeCachedThalitaVoice(data.text);
  res.writeHead(200,{'Content-Type':audio.mime,'Cache-Control':'private, no-store',
   'Content-Length':String(audio.bytes.length),'X-TTS-Voice':audio.voice});
  return res.end(audio.bytes);
 }
 if(method==='POST'&&pathname==='/api/thalita/transcribe'){
  assertApiFeature(a.features,'/api/agent');sameOrigin(req);
  if(!limiter(simulationAttempts,'thalita-transcribe:'+a.active_tenant_id,60000,12))throw fail(429,'Limite de áudio atingido.');
  const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  if(!['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav'].includes(mime))throw fail(422,'Formato de áudio inválido.');
  if(Number(req.headers['content-length']||0)>3*1024*1024)throw fail(413,'Máximo de 3 MB por áudio.');
  let total=0;const chunks=[];
  for await(const chunk of req){total+=chunk.length;if(total>3*1024*1024)throw fail(413,'Máximo de 3 MB por áudio.');chunks.push(chunk);}
  return json(res,200,await transcribeSocioTraining(Buffer.concat(chunks),mime));
 }
 if(method==='GET'&&pathname==='/api/dashboard/executive'){
  return json(res,200,await getExecutiveMetrics(pool,a));
 }
 if(method==='GET'&&pathname==='/api/dashboard'){
  const [ch,prod,imp,conv,msg,today]=await Promise.all([
   query('SELECT count(*)::int AS n FROM channels WHERE tenant_id=$1',[a.active_tenant_id]),
   query('SELECT count(*)::int AS n FROM products WHERE tenant_id=$1 AND active=true',[a.active_tenant_id]),
   query('SELECT count(*)::int AS n FROM imports WHERE tenant_id=$1',[a.active_tenant_id]),
   query("SELECT count(*)::int AS n FROM conversations WHERE tenant_id=$1 AND status!='resolved'",[a.active_tenant_id]),
   query("SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND direction='inbound'",[a.active_tenant_id]),
   query("SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND direction='inbound' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')",[a.active_tenant_id])
  ]);
  const flags=parseTenantFeatures(a.features);
  return json(res,200,{channels:flags.whatsapp?ch.rows[0].n:0,products:flags.catalog?prod.rows[0].n:0,
   imports:flags.ai?imp.rows[0].n:0,openConversations:flags.whatsapp?conv.rows[0].n:0,
   inboundMessages:flags.whatsapp?msg.rows[0].n:0,messagesReceivedToday:flags.whatsapp?today.rows[0].n:0});
 }

 // WA-AKG is a server-side, read-only integration. It does not expose the
 // shared gateway key or allow tenants to claim arbitrary gateway sessions.
 if(method==='GET'&&pathname==='/api/waakg/config'){
  return json(res,200,{configured:gatewayConfigured(),mode:'read_only',selfService:true,
   limitations:'Até 50 conversas retornadas pelo gateway por sessão; até 400 mensagens por conversa. Histórico antigo pode não estar disponível.'});
 }
 if(method==='GET'&&pathname==='/api/waakg/channels'){
  const r=await query(
   'SELECT l.channel_id AS id,ch.label,ch.phone,ch.status,l.created_at FROM waakg_links l JOIN channels ch ON ch.id=l.channel_id AND ch.tenant_id=l.tenant_id WHERE l.tenant_id=$1 ORDER BY l.created_at DESC',
   [a.active_tenant_id]);
  return json(res,200,r.rows);
 }

 // Self-service onboarding to a dedicated gateway. No user-provided session id:
 // session id is CSPRNG and exclusively bound to the active tenant in Postgres.
 if(method==='POST'&&pathname==='/api/waakg/channels/connect'){
  needRole(a,['owner','admin']);
  if(!gatewayConfigured())throw fail(503,'O gateway exclusivo do Sócio ainda não está configurado.');
  if(!limiter(simulationAttempts,'waakg-connect:'+a.active_tenant_id,3600000,12))throw fail(429,'Limite de solicitações de conexão.');
  const {data}=await body(req);
  if(!validText(data.label,90))throw fail(422,'Informe um nome para o WhatsApp.');
  const counter=await query('SELECT COUNT(*)::int AS n FROM waakg_links WHERE tenant_id=$1',[a.active_tenant_id]);
  if(counter.rows[0].n>=10)throw fail(422,'Limite inicial de dez sessões por empresa. Contate a Consecom para ampliar.');
  const channelId=id(),sessionId='socio_'+randomBytes(20).toString('hex');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query(
    "INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,$3,$4,'waakg','connecting')",
    [channelId,a.active_tenant_id,data.label.trim(),'pending-'+channelId]);
   await client.query('INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES($1,$2,$3,$4)',
    [id(),a.active_tenant_id,channelId,sessionId]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  let ready=false;
  try{await ensureSessionProvisioned(sessionId,data.label.trim());ready=true;}
  catch(error){
   // Preserve mapping for safe retry; never leave an unknown orphan in the
   // gateway, and never report the gateway session id to the tenant.
   console.warn('[socio-waakg-connect]',String(error?.status||'unavailable'));
  }
  await audit(a,'waakg.onboarding.created',{channelId,ready});
  return json(res,201,{id:channelId,label:data.label.trim(),status:ready?'qr_pending':'connecting',
   note:ready?'Escaneie o QR Code no seu WhatsApp.':'Conexão iniciada; use Reiniciar para tentar novamente.'});
 }
 const qrPath=pathname.match(/^\/api\/waakg\/channels\/([0-9a-f-]{36})\/qr$/);
 if(qrPath&&method==='GET'){
  needRole(a,['owner','admin']);
  const found=await query('SELECT l.session_id FROM waakg_links l WHERE l.channel_id=$1 AND l.tenant_id=$2',
   [qrPath[1],a.active_tenant_id]);
  if(!found.rowCount)throw fail(404,'Canal não encontrado nesta empresa.');
  return json(res,200,await getSessionQr(found.rows[0].session_id));
 }
 const lifecycle=pathname.match(/^\/api\/waakg\/channels\/([0-9a-f-]{36})\/(start|stop|restart|logout)$/);
 if(lifecycle&&method==='POST'){
  needRole(a,['owner','admin']);
  const [channelId,action]=lifecycle.slice(1);
  const found=await query('SELECT l.session_id,c.label,c.phone FROM waakg_links l JOIN channels c ON c.id=l.channel_id AND c.tenant_id=l.tenant_id WHERE l.channel_id=$1 AND l.tenant_id=$2',
   [channelId,a.active_tenant_id]);
  if(!found.rowCount)throw fail(404,'Canal não encontrado nesta empresa.');
  const record=found.rows[0];
  if(action==='start'||action==='restart'){
   await ensureSessionProvisioned(record.session_id,record.label);
  }else{
   await sessionLifecycle(record.session_id,action);
   await query("UPDATE channels SET status=$3 WHERE id=$1 AND tenant_id=$2",
    [channelId,a.active_tenant_id,action==='logout'?'disconnected':'stopped']);
  }
  await audit(a,'waakg.session.'+action,{channelId});
  return json(res,200,{id:channelId,status:action==='logout'?'disconnected':action==='stop'?'stopped':'connecting'});
 }
 if(method==='POST'&&pathname==='/api/waakg/channels/link'){
  needPlatform(a); // Shared gateway credentials are Consecom-only.
  if(!gatewayConfigured())throw fail(503,'WA-AKG não configurado. Conecte um gateway dedicado ao Sócio.');
  const {data}=await body(req);
  const sessionId=trimmed(data.sessionId,64),phone=trimmed(data.phone,20).replace(/\D/g,'');
  if(!validSessionId(sessionId)||!validText(data.label,90)||!/^\d{10,15}$/.test(phone))throw fail(422,'Informe sessão existente, nome e telefone internacional válido.');
  const remote=await getSessionStatus(sessionId);
  if(!remote.connected||!remote.connectedNumber||remote.connectedNumber!==phone)
   throw fail(422,'O número informado não corresponde a uma sessão WA-AKG conectada e verificada.');
  const channelId=id(),client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,$3,$4,'waakg','connected')",
    [channelId,a.active_tenant_id,data.label.trim(),phone]);
   await client.query('INSERT INTO waakg_links(id,tenant_id,channel_id,session_id) VALUES($1,$2,$3,$4)',
    [id(),a.active_tenant_id,channelId,sessionId]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  await audit(a,'waakg.channel.linked',{channelId});
  return json(res,201,{id:channelId,label:data.label.trim(),phone,status:'connected'});
 }
 const linkStatus=pathname.match(/^\/api\/waakg\/channels\/([0-9a-f-]{36})\/status$/);
 if(linkStatus&&method==='GET'){
  const found=await query(
   'SELECT l.session_id,ch.phone FROM waakg_links l JOIN channels ch ON ch.id=l.channel_id AND ch.tenant_id=l.tenant_id WHERE l.channel_id=$1 AND l.tenant_id=$2',
   [linkStatus[1],a.active_tenant_id]);
  if(!found.rowCount)throw fail(404,'Canal não encontrado nesta empresa.');
  const remote=await getSessionStatus(found.rows[0].session_id);
  const verified=remote.connected&&/^\d{10,15}$/.test(remote.connectedNumber);
  if(verified&&found.rows[0].phone.startsWith('pending-')){
   // Never allow a provider number belonging to another channel to be claimed.
   // The unique tenant+phone constraint protects double-scanning of the same phone.
   await query("UPDATE channels SET phone=$3,status='connected' WHERE id=$1 AND tenant_id=$2 AND phone LIKE 'pending-%'",
    [linkStatus[1],a.active_tenant_id,remote.connectedNumber]);
  }else if(verified&&found.rows[0].phone===remote.connectedNumber){
   await query("UPDATE channels SET status='connected' WHERE id=$1 AND tenant_id=$2",[linkStatus[1],a.active_tenant_id]);
  }
  const phoneVerified=verified&&(found.rows[0].phone===remote.connectedNumber||found.rows[0].phone.startsWith('pending-'));
  return json(res,200,{connected:verified&&phoneVerified,
   status:remote.status,phoneVerified,phone:phoneVerified?remote.connectedNumber:null});
 }
 if(method==='GET'&&pathname==='/api/waakg/scans'){
  requirePermission(a,'training.manage');
  const r=await query(
   'SELECT id,channel_id AS "channelId",status,total_chats AS "totalChats",processed_chats AS "processedChats",imported_chats AS "importedChats",imported_messages AS "importedMessages",partial_coverage AS "partialCoverage",truncated_chats AS "truncatedChats",error_code AS "errorCode",created_at AS "createdAt",updated_at AS "updatedAt" FROM waakg_scans WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30',
   [a.active_tenant_id]);
  return json(res,200,r.rows);
 }
 if(method==='POST'&&pathname==='/api/waakg/scans'){
  needRole(a,['owner','admin']);
  if(!gatewayConfigured())throw fail(503,'WA-AKG ainda não configurado no servidor Sócio.');
  if(!limiter(simulationAttempts,'waakg-start:'+a.active_tenant_id,60000,12))throw fail(429,'Muitas análises solicitadas.');
  const {data}=await body(req);
  const channelId=String(data.channelId||'');
  if(!/^[0-9a-f-]{36}$/.test(channelId))throw fail(422,'Selecione um canal WA-AKG válido.');
  const result=await query(
   'SELECT l.session_id,ch.phone FROM waakg_links l JOIN channels ch ON ch.id=l.channel_id AND ch.tenant_id=l.tenant_id WHERE l.channel_id=$1 AND l.tenant_id=$2',
   [channelId,a.active_tenant_id]);
  if(!result.rowCount)throw fail(404,'O WhatsApp não está vinculado a esta empresa.');
  const remote=await getSessionStatus(result.rows[0].session_id);
  if(!remote.connected||remote.connectedNumber!==result.rows[0].phone)throw fail(409,'WhatsApp indisponível ou número não verificado.');
  const jobId=id();
  await query("INSERT INTO waakg_scans(id,tenant_id,channel_id,status) VALUES($1,$2,$3,'queued')",
   [jobId,a.active_tenant_id,channelId]);
  await audit(a,'waakg.history.requested',{channelId,jobId});
  return json(res,201,{id:jobId,status:'queued',readOnly:true});
 }
 const scanAction=pathname.match(/^\/api\/waakg\/scans\/([0-9a-f-]{36})\/(pause|resume|cancel)$/);
 if(scanAction&&method==='POST'){
  needRole(a,['owner','admin']);
  const [jobId,action]=scanAction.slice(1);
  const next=action==='pause'?'paused':action==='resume'?'queued':'cancelled';
  const allowed=action==='pause'?['queued','scanning','importing']:action==='resume'?['paused','failed']:['queued','scanning','importing','paused','failed'];
  const r=await query(
   "UPDATE waakg_scans SET status=$3,error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=now(),finished_at=CASE WHEN $3='cancelled' THEN now() ELSE finished_at END WHERE id=$1 AND tenant_id=$2 AND status=ANY($4::text[]) RETURNING id,status",
   [jobId,a.active_tenant_id,next,allowed]);
  if(!r.rowCount)throw fail(409,'Análise indisponível ou estado incompatível.');
  await audit(a,'waakg.history.'+action,{jobId});
  return json(res,200,r.rows[0]);
 }
 if(method==='GET'&&pathname==='/api/channels'){
  const r=await query('SELECT id,label,phone,provider,external_phone_id,status,created_at FROM channels WHERE tenant_id=$1 ORDER BY created_at DESC',[a.active_tenant_id]);
  return json(res,200,r.rows);
 }
 if(method==='POST'&&pathname==='/api/channels'){
  needRole(a,['owner','admin']);
  const {data}=await body(req);
  if(!validText(data.label,90)||!/^\+?\d{10,15}$/.test(String(data.phone||'').replace(/\s/g,'')))throw fail(422,'Informe identificação e número completo (10 a 15 dígitos).');
  const external=trimmed(data.externalPhoneId,80)||null;
  if(external&&!a.platform_owner)throw fail(403,'A vinculação do identificador Meta requer validação pela administração da Consecom.');
  const r=await query("INSERT INTO channels(id,tenant_id,label,phone,provider,external_phone_id) VALUES($1,$2,$3,$4,'meta',$5) RETURNING id,label,phone,provider,external_phone_id,status",[id(),a.active_tenant_id,data.label.trim(),String(data.phone).replace(/\s/g,''),external]);
  await audit(a,'channel.created',{channelId:r.rows[0].id});
  return json(res,201,r.rows[0]);
 }

 if(method==='GET'&&pathname==='/api/integrations/readiness')
  return json(res,200,await integrationReadiness(pool,a));
 if(method==='GET'&&pathname==='/api/tracking/sites')
  return json(res,200,await listTrackingSites(pool,a));
 if(method==='POST'&&pathname==='/api/tracking/sites'){
  if(!limiter(simulationAttempts,'tracking-sites:'+a.active_tenant_id,3600000,10))
   throw fail(429,'Aguarde antes de cadastrar outro site.');
  const {data}=await body(req,1400);
  return json(res,201,await createTrackingSite(pool,a,{origin:data.origin,pixelId:data.pixelId}));
 }
 const siteFlag=pathname.match(/^\/api\/tracking\/sites\/([a-f0-9-]{36})\/enabled$/i);
 if(siteFlag&&method==='PUT'){
  const {data}=await body(req,1500);
  return json(res,200,await enableTrackingSite(pool,a,siteFlag[1],data.enabled));
 }
 if(method==='GET'&&pathname==='/api/google-ads/status')
  return json(res,200,await googleAdsStatus(pool,a));
 if(method==='POST'&&pathname==='/api/google-ads/connect')
  return json(res,200,await startGoogleAdsOAuth(pool,a));
 if(method==='GET'&&pathname==='/api/google-ads/accounts')
  return json(res,200,await listGoogleAdsAccounts(pool,a));
 if(method==='GET'&&pathname==='/api/google-ads/campaigns'){
  const period=new URL(req.url,'http://local').searchParams.get('period');
  return json(res,200,await readGoogleAdsCampaigns(pool,a,{period:period==='today'?'today':'last_30d'}));
 }
 if(method==='POST'&&pathname==='/api/google-ads/accounts/select'){
  const {data}=await body(req,1500);
  return json(res,200,await selectGoogleAdsAccount(pool,a,data.accountId));
 }
 if(method==='POST'&&pathname==='/api/google-ads/disconnect')
  return json(res,200,await disconnectGoogleAds(pool,a));
 if(method==='GET'&&pathname==='/api/billing/status'){
  return json(res,200,await readSubscriptionStatus(pool,a));
 }
 if(method==='POST'&&pathname==='/api/billing/checkout'){
  if(!limiter(simulationAttempts,'billing-checkout:'+a.active_tenant_id,3600000,8))
   throw fail(429,'Aguarde antes de abrir um novo Checkout.');
  return json(res,200,await createSubscriptionCheckout(pool,a));
 }
 if(method==='POST'&&pathname==='/api/billing/portal'){
  if(!limiter(simulationAttempts,'billing-portal:'+a.active_tenant_id,60000,6))
   throw fail(429,'Aguarde antes de abrir o portal de cobrança.');
  return json(res,200,await createBillingPortal(pool,a));
 }
 if(method==='GET'&&pathname==='/api/reports/monitor'){
  requirePermission(a,'audit.read');
  return json(res,200,await getTenantBusinessMonitor(pool,a));
 }
 if(method==='GET'&&pathname==='/api/reports'){
  requirePermission(a,'audit.read');
  const [totals,daily]=await Promise.all([
   query("SELECT "+
    "(SELECT count(*)::int FROM sale_intents WHERE tenant_id=$1 AND created_at>=now()-interval '30 days') AS purchase_intents,"+
    "(SELECT count(*)::int FROM sale_intents WHERE tenant_id=$1 AND status='pending' AND created_at>=now()-interval '30 days') AS purchase_pending,"+
    "(SELECT count(*)::int FROM sale_intents WHERE tenant_id=$1 AND status='completed' AND updated_at>=now()-interval '30 days') AS purchase_completed_manually,"+
    "(SELECT count(*)::int FROM quote_requests WHERE tenant_id=$1 AND created_at>=now()-interval '30 days') AS quote_requests,"+
    "(SELECT count(*)::int FROM quote_requests WHERE tenant_id=$1 AND delivery_status='sent' AND quote_sent_at>=now()-interval '30 days') AS quote_sent,"+
    "(SELECT count(*)::int FROM sales_orders WHERE tenant_id=$1 AND created_at>=now()-interval '30 days') AS approved_orders,"+
    "(SELECT count(*)::int FROM sales_orders WHERE tenant_id=$1 AND status='paid_test' AND created_at>=now()-interval '30 days') AS sandbox_payments,"+
    "(SELECT count(*)::int FROM messages WHERE tenant_id=$1 AND direction='inbound' AND created_at>=now()-interval '30 days') AS inbound_messages",
    [a.active_tenant_id]),
   query("SELECT date_trunc('day',m.created_at)::date AS day,count(*)::int AS messages "+
    "FROM messages m WHERE m.tenant_id=$1 AND m.direction='inbound' AND m.created_at>=now()-interval '14 days' "+
    "GROUP BY 1 ORDER BY 1",[a.active_tenant_id])
  ]);
  return json(res,200,{periodDays:30,totals:totals.rows[0],
   dailyMessages:daily.rows,note:'Intenção de compra, pedido aprovado e pagamento são eventos distintos. Pagamento de teste não é receita real.'});
 }
 if(method==='POST'&&pathname==='/api/sales/assistant/chat'){
  requirePermission(a,'sales.read');
  assertApiFeature(a.features,'/api/agent');
  if(!limiter(simulationAttempts,'sales-assistant:'+a.user_id,60000,12))
   throw fail(429,'Aguarde antes de fazer outra pergunta comercial.');
  const {data}=await body(req,2500);
  const result=await askSalesAssistant(pool,a,{message:data.message,requestId:data.requestId??null});
  await audit(a,'sales.assistant.read',{requestId:result.requestId||null,
   previewReady:result.preview?.readyToReview===true});
  return json(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/sales/intents'){
  requirePermission(a,'sales.read');
  return json(res,200,{intents:await listSaleIntents(pool,a.active_tenant_id)});
 }
 const saleIntentRoute=pathname.match(/^\/api\/sales\/intents\/([a-f0-9-]{36})$/i);
 if(saleIntentRoute&&method==='PATCH'){
  requirePermission(a,'sales.manage');
  const {data}=await body(req,15000);
  const updated=await updateSaleIntent(pool,a.active_tenant_id,saleIntentRoute[1],data);
  await audit(a,'sales.intent.updated',{intentId:updated.id,status:updated.status});
  return json(res,200,updated);
 }
 if(method==='GET'&&pathname==='/api/sales/alerts'){
  requirePermission(a,'sales.read');
  const [intents,quotes]=await Promise.all([
   query("SELECT id,conversation_id,customer_name,customer_phone,summary,items,amount_cents,created_at FROM sale_intents WHERE tenant_id=$1 AND status='pending' AND created_at>now()-interval '48 hours' ORDER BY created_at DESC LIMIT 20",[a.active_tenant_id]),
   query("SELECT id,conversation_id,customer_name,customer_phone,summary,created_at FROM quote_requests WHERE tenant_id=$1 AND status='pending' AND created_at>now()-interval '48 hours' ORDER BY created_at DESC LIMIT 20",[a.active_tenant_id])
  ]);
  return json(res,200,{items:[...intents.rows.map(x=>({...x,kind:'sale'})),...quotes.rows.map(x=>({...x,kind:'quote'}))]
   .sort((x,y)=>new Date(y.created_at)-new Date(x.created_at)).slice(0,20)});
 }
 const quoteDraftRoute=pathname.match(/^\/api\/sales\/quote-requests\/([a-f0-9-]{36})\/(draft|send)$/i);
 if(quoteDraftRoute&&method==='POST'){
  requirePermission(a,'sales.manage');
  const [,requestId,action]=quoteDraftRoute;
  if(action==='send'&&!limiter(simulationAttempts,'quote-send:'+a.user_id,60000,10))
   throw fail(429,'Limite de envios por minuto atingido.');
  const data=action==='draft'?(await body(req,6000)).data:{};
  const result=action==='draft'?await saveQuoteDraft(pool,a.active_tenant_id,requestId,data):
   await sendQuoteDraft(pool,a.active_tenant_id,requestId,a.user_id);
  await audit(a,'sales.quote_request.'+action,{requestId,confirmed:action==='send'});
  return json(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/sales/quote-requests'){
  requirePermission(a,'sales.read');
  return json(res,200,{requests:await listQuoteRequests(pool,a.active_tenant_id),
   alertWhatsAppEnabled:a.quote_alert_whatsapp===true});
 }
 if(method==='PUT'&&pathname==='/api/sales/quote-alerts'){
  requirePermission(a,'sales.manage');
  const {data}=await body(req,1000);
  const result=await setQuoteAlerts(pool,a,data.enabled);
  await audit(a,'sales.quote_alerts.changed',{enabled:result.enabled});
  return json(res,200,result);
 }
 const reqStatus=pathname.match(/^\/api\/sales\/quote-requests\/([a-f0-9-]{36})\/status$/);
 if(reqStatus&&method==='PATCH'){
  requirePermission(a,'sales.manage');
  const {data}=await body(req,1000);
  const result=await updateQuoteRequest(pool,a.active_tenant_id,reqStatus[1],data.status);
  await audit(a,'sales.quote_request.updated',{requestId:result.id,status:result.status});
  return json(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/sales'){
  requirePermission(a,'sales.read');
  return json(res,200,await listSales(pool,a.active_tenant_id));
 }
 if(method==='POST'&&pathname==='/api/sales/quotes'){
  needRole(a,['owner','admin']);
  const {data}=await body(req,15000);
  const quote=await createQuote(pool,a.active_tenant_id,a.user_id,data);
  await audit(a,'sales.quote.created',{quoteId:quote.id,seriesId:quote.series_id,version:quote.version});
  return json(res,201,quote);
 }
 const salesAction=pathname.match(/^\/api\/sales\/quotes\/([a-f0-9-]{36})\/(issue|cancel)$/);
 if(salesAction&&method==='POST'){
  needRole(a,['owner','admin']);
  const result=salesAction[2]==='issue'?
   await issueQuote(pool,a.active_tenant_id,salesAction[1]):
   await cancelQuote(pool,a.active_tenant_id,salesAction[1]);
  await audit(a,'sales.quote.'+salesAction[2],{quoteId:salesAction[1]});
  return json(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/products'){
  return json(res,200,await fullCatalog(a.active_tenant_id));
 }
 if(method==='GET'&&pathname==='/api/products/storage'){
  return json(res,200,{configured:mediaConfigured(),limits:{maxPhotos:8,maxSourceBytes:3000000},
   supported:['image/jpeg','image/png','image/webp']});
 }
 if(method==='POST'&&pathname==='/api/products'){
  needRole(a,['owner','admin']);
  const {data}=await body(req,22000);
  // Validate every nested field BEFORE inserting anything, fixing the
  // "product created but invalid variation price" partial-success bug.
  const p=validateProduct(data);
  const variants=validateVariants(data.variants||[]);
  const campaigns=Array.isArray(data.campaigns)?data.campaigns.map(validateCampaign):[];
  if(campaigns.length>8||new Set(campaigns.map(x=>x.provider+':'+x.campaignId)).size!==campaigns.length)
   throw fail(422,'Selecione até oito campanhas distintas.');
  const client=await pool.connect();let product;
  try{
   await client.query('BEGIN');
   // Serialize catalog insertions per company so the 500-product limit is real.
   await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[a.active_tenant_id]);
   const count=await client.query('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id=$1',[a.active_tenant_id]);
   if(Number(count.rows[0].count)>=500)throw fail(422,'Limite de 500 produtos por empresa.');
   const item=await client.query(
    'INSERT INTO products(id,tenant_id,name,description,sku,price_cents,stock_quantity,compare_at_price_cents,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,description,sku,price_cents,stock_quantity,compare_at_price_cents,active',
    [id(),a.active_tenant_id,p.name,p.description,p.sku,p.priceCents,p.stockQuantity,p.compareAtPriceCents,p.active]);
   product=item.rows[0];
   for(const v of variants){
    await client.query('INSERT INTO product_variants(id,tenant_id,product_id,name,sku,price_cents,stock_quantity,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
     [id(),a.active_tenant_id,product.id,v.name,v.sku,v.priceCents,v.stockQuantity,v.active]);
   }
   for(const campaign of campaigns){
    await client.query('INSERT INTO product_campaign_links(id,tenant_id,product_id,provider,campaign_id,label) VALUES($1,$2,$3,$4,$5,$6)',
     [id(),a.active_tenant_id,product.id,campaign.provider,campaign.campaignId,campaign.label]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  await audit(a,'product.created',{productId:product.id,variants:variants.length,campaigns:campaigns.length});
  return json(res,201,product);
 }
 const productVariants=pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/variants$/);
 if(productVariants&&method==='PUT'){
  needRole(a,['owner','admin']);
  const {data}=await body(req,22000);
  const variants=validateVariants(data.variants);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const check=await client.query('SELECT id FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[a.active_tenant_id,productVariants[1]]);
   if(!check.rowCount)throw fail(404,'Produto não encontrado nesta empresa.');
   await client.query('DELETE FROM product_variants WHERE tenant_id=$1 AND product_id=$2',[a.active_tenant_id,productVariants[1]]);
   for(const variant of variants){
    await client.query('INSERT INTO product_variants(id,tenant_id,product_id,name,sku,price_cents,stock_quantity,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
     [id(),a.active_tenant_id,productVariants[1],variant.name,variant.sku,variant.priceCents,variant.stockQuantity,variant.active]);
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  await audit(a,'product.variants.updated',{productId:productVariants[1],count:variants.length});
  return json(res,200,{ok:true,count:variants.length});
 }
 const productMedia=pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/media$/);
 if(productMedia&&method==='POST'){
  needRole(a,['owner','admin']);
  if(!mediaConfigured())throw fail(503,'Armazenamento de imagens indisponível.');
  if(!limiter(simulationAttempts,'media:'+a.active_tenant_id,60000,16))throw fail(429,'Muitos envios de imagem. Tente novamente.');
  const {data}=await body(req,4300000);
  const alt=typeof data.alt==='string'?data.alt.trim():'';
  if(alt.length>200)throw fail(422,'Texto alternativo muito longo.');
  const product=await query('SELECT id FROM products WHERE tenant_id=$1 AND id=$2',[a.active_tenant_id,productMedia[1]]);
  if(!product.rowCount)throw fail(404,'Produto não encontrado nesta empresa.');
  const count=await query('SELECT count(*)::int AS n FROM product_media WHERE tenant_id=$1 AND product_id=$2',[a.active_tenant_id,productMedia[1]]);
  if(count.rows[0].n>=8)throw fail(422,'Cada produto permite até 8 fotos.');
  const img=await normalizeImage(data.contentBase64);
  const objectKey=imageKey(a.active_tenant_id,productMedia[1]),mediaId=id();
  try{
   await putPrivateImage(objectKey,img.bytes);
   await query('INSERT INTO product_media(id,tenant_id,product_id,object_key,content_type,bytes,alt) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [mediaId,a.active_tenant_id,productMedia[1],objectKey,img.contentType,img.bytes.length,alt]);
  }catch(e){try{await deletePrivateImage(objectKey);}catch{}throw e;}
  await audit(a,'product.media.uploaded',{productId:productMedia[1],mediaId,bytes:img.bytes.length});
  return json(res,201,{id:mediaId,url:'/api/products/'+productMedia[1]+'/media/'+mediaId+'/file',alt,bytes:img.bytes.length});
 }
 const productFile=pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/media\/([a-f0-9-]{36})\/file$/);
 if(productFile&&method==='GET'){
  const record=await query('SELECT object_key,content_type FROM product_media WHERE tenant_id=$1 AND product_id=$2 AND id=$3',
   [a.active_tenant_id,productFile[1],productFile[2]]);
  if(!record.rowCount)throw fail(404,'Foto não encontrada nesta empresa.');
  const bytes=await getPrivateImage(record.rows[0].object_key);
  res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,
   'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  return res.end(bytes);
 }
 const mediaDelete=pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/media\/([a-f0-9-]{36})$/);
 if(mediaDelete&&method==='DELETE'){
  needRole(a,['owner','admin']);
  const record=await query('SELECT object_key FROM product_media WHERE tenant_id=$1 AND product_id=$2 AND id=$3',
   [a.active_tenant_id,mediaDelete[1],mediaDelete[2]]);
  if(!record.rowCount)throw fail(404,'Foto não encontrada nesta empresa.');
  await deletePrivateImage(record.rows[0].object_key);
  await query('DELETE FROM product_media WHERE tenant_id=$1 AND product_id=$2 AND id=$3',
   [a.active_tenant_id,mediaDelete[1],mediaDelete[2]]);
  await audit(a,'product.media.deleted',{productId:mediaDelete[1],mediaId:mediaDelete[2]});
  return json(res,200,{ok:true});
 }
 const campaignPath=pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/campaigns$/);
 if(campaignPath&&method==='POST'){
  needRole(a,['owner','admin']);
  const {data}=await body(req);
  const campaign=validateCampaign(data);
  const check=await query('SELECT id FROM products WHERE tenant_id=$1 AND id=$2',[a.active_tenant_id,campaignPath[1]]);
  if(!check.rowCount)throw fail(404,'Produto não encontrado nesta empresa.');
  const result=await query(
   'INSERT INTO product_campaign_links(id,tenant_id,product_id,provider,campaign_id,label) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,provider,campaign_id,label,verified',
   [id(),a.active_tenant_id,campaignPath[1],campaign.provider,campaign.campaignId,campaign.label]);
  await audit(a,'product.campaign.linked',{productId:campaignPath[1],provider:campaign.provider});
  return json(res,201,result.rows[0]);
 }
 const campaignDelete=pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/campaigns\/([a-f0-9-]{36})$/);
 if(campaignDelete&&method==='DELETE'){
  needRole(a,['owner','admin']);
  const deleted=await query('DELETE FROM product_campaign_links WHERE tenant_id=$1 AND product_id=$2 AND id=$3 RETURNING id',
   [a.active_tenant_id,campaignDelete[1],campaignDelete[2]]);
  if(!deleted.rowCount)throw fail(404,'Vínculo de campanha não encontrado.');
  await audit(a,'product.campaign.unlinked',{productId:campaignDelete[1]});
  return json(res,200,{ok:true});
 }
 const prodMatch=pathname.match(/^\/api\/products\/([a-f0-9-]{36})$/);
 if(prodMatch&&method==='PATCH'){
  needRole(a,['owner','admin']);
  const {data}=await body(req),p=validateProduct(data);
  const result=await query(
   'UPDATE products SET name=$3,description=$4,sku=$5,price_cents=$6,stock_quantity=$7,compare_at_price_cents=$8,active=$9,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,name,description,sku,price_cents,stock_quantity,compare_at_price_cents,active',
   [prodMatch[1],a.active_tenant_id,p.name,p.description,p.sku,p.priceCents,p.stockQuantity,p.compareAtPriceCents,p.active]);
  if(!result.rowCount)throw fail(404,'Produto não encontrado.');
  await audit(a,'product.updated',{productId:prodMatch[1]});
  return json(res,200,result.rows[0]);
 }

 // Product deletion removes its variants, campaign links and media rows via existing
 // tenant-constrained cascading foreign keys. Payment/order snapshots stay intact.
 if(prodMatch&&method==='DELETE'){
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'catalog-delete:'+a.active_tenant_id,60000,10))
   throw fail(429,'Muitas exclusões; aguarde.');
  const {data}=await body(req,1000);
  if(data.confirm!==true)throw fail(422,'Confirme a exclusão permanente do produto.');
  const client=await pool.connect();let objects=[],removed=null;
  try{
   await client.query('BEGIN');
   const check=await client.query('SELECT id,name FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [a.active_tenant_id,prodMatch[1]]);
   if(!check.rowCount)throw fail(404,'Produto não encontrado nesta empresa.');
   removed=check.rows[0];
   const media=await client.query('SELECT object_key FROM product_media WHERE tenant_id=$1 AND product_id=$2',
    [a.active_tenant_id,prodMatch[1]]);
   objects=media.rows.map(x=>x.object_key);
   await client.query('DELETE FROM products WHERE tenant_id=$1 AND id=$2',[a.active_tenant_id,prodMatch[1]]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  const cleanup=await Promise.allSettled(objects.map(objectKey=>deletePrivateImage(objectKey)));
  const failed=cleanup.filter(x=>x.status==='rejected').length;
  await audit(a,'product.deleted',{productId:prodMatch[1],photoCleanupFailures:failed});
  return json(res,200,{deleted:true,id:prodMatch[1],name:removed.name,
   photoCleanupPending:failed>0,photosPending:failed});
 }
 // Tenant-owner operational checks: never return credentials or assert that a
 // configured integration has passed a real end-to-end test.
 if(method==='GET'&&pathname==='/api/ops/migration-readiness'){
  requirePermission(a,'audit.read');
  const metadata=await query(
   "SELECT current_setting('server_version') AS version, current_schema() AS schema_name, "+
   "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema=$1 "+
   " AND table_type='BASE TABLE') AS schema_table_count",[dbSchema]);
  const state=metadata.rows[0],isTarget=dbSchema==='socio_app'&&isSupabaseDb;
  const blockers=[];
  if(!isTarget)blockers.push('O banco ativo continua no Railway: sem corte de produção autorizado.');
  if(!maintenanceEnabled())blockers.push('A aplicação não está em modo de manutenção; gravações podem continuar.');
  if(process.env.SOCIO_VERIFIED_BACKUP!=='YES')
   blockers.push('Backup de produção íntegro não foi atestado no processo de migração.');
  if(!process.env.SOCIO_SUPABASE_DATABASE_URL&&!isTarget)
   blockers.push('Conexão PostgreSQL autenticada do Supabase não está configurada para o migrador.');
  blockers.push('Falta validação externa do inventário de fotos S3 e gateway WA-AKG/MySQL.');
  return json(res,200,{database:isTarget?'supabase_private':'railway',schema:state.schema_name,
   postgresVersion:state.version,tableCount:state.schema_table_count,
   maintenance:maintenanceEnabled(),backupConfirmationConfigured:process.env.SOCIO_VERIFIED_BACKUP==='YES',
   destinationConfigured:!!process.env.SOCIO_SUPABASE_DATABASE_URL,
   automaticCutoverEnabled:false,blockers,
   note:'Diagnóstico não autoriza nem executa migração e não comprova backup ou restauração de produção.'});
 }
 if(method==='GET'&&pathname==='/api/ops/readiness'){
  needRole(a,['owner','admin']);
  const report=await getOperationalReadiness(pool,a.active_tenant_id);
  return json(res,200,report);
 }
 if(method==='POST'&&pathname==='/api/ops/groq/test'){
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'groq-health:'+a.active_tenant_id,600000,3))
   throw fail(429,'Limite de testes Groq atingido. Tente novamente.');
  if(!groqReady())throw fail(503,'GROQ_API_KEY ausente no servidor.');
  const start=Date.now();
  const test=await groqResponse({
   instructions:'Você está verificando uma integração técnica. Responda em português, de forma muito curta.',
   input:'Responda apenas confirmando que a integração de texto está respondendo.',
   maxOutputTokens:280,timeoutMs:16000
  });
  if(!test.reply.trim())throw fail(503,'Groq não retornou uma resposta válida.');
  const latencyMs=Date.now()-start;
  await audit(a,'integration.groq.tested',{model:test.model,success:true});
  return json(res,200,{ok:true,provider:'Groq',model:test.model,
   responseVerified:true,latencyMs,checkedAt:new Date().toISOString()});
 }
 if(method==='GET'&&pathname==='/api/agent'){
  requirePermission(a,'training.manage');
  const r=await query('SELECT name,tone,instructions,knowledge_md,enabled,updated_at FROM agents WHERE tenant_id=$1',[a.active_tenant_id]);
  return json(res,200,r.rows[0]||{});
 }
 if(method==='PUT'&&pathname==='/api/agent'){
  needRole(a,['owner','admin']);const {data}=await body(req);
  if(!validText(data.name,80)||!validText(data.tone,300)||!validText(data.instructions,6000)||typeof data.enabled!=='boolean')throw fail(422,'Configuração inválida.');
  const r=await query('UPDATE agents SET name=$2,tone=$3,instructions=$4,enabled=$5,updated_at=now() WHERE tenant_id=$1 RETURNING name,tone,instructions,knowledge_md,enabled',[a.active_tenant_id,data.name.trim(),data.tone.trim(),data.instructions.trim(),data.enabled]);
  await audit(a,'agent.updated',{enabled:data.enabled});return json(res,200,r.rows[0]);
 }
 // Prospector guided interview: per-company private draft, approval stays in /versions/:id/approve.
 if(method==='GET'&&pathname==='/api/training/interview'){
  requirePermission(a,'training.manage');
  return json(res,200,{interview:await getSocioInterview(pool,a.active_tenant_id)});
 }
 if(method==='POST'&&pathname==='/api/training/interview/start'){
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'interview-start:'+a.active_tenant_id,60000,12))
   throw fail(429,'Muitas solicitações de treinamento.');
  const {data}=await body(req,1600);
  const interview=await startSocioInterview(pool,a.active_tenant_id,data.mode);
  await audit(a,'training.interview.started',{mode:data.mode});
  return json(res,200,{interview});
 }
 if(method==='POST'&&pathname==='/api/training/interview/turn'){
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'interview-turn:'+a.active_tenant_id,60000,45))
   throw fail(429,'Aguarde antes de responder novamente.');
  const {data}=await body(req,2200);
  const interview=await advanceSocioInterview(pool,a.active_tenant_id,data.text);
  await audit(a,'training.interview.answered',{step:interview.step,completed:interview.completed});
  return json(res,200,{interview});
 }
 if(method==='POST'&&pathname==='/api/training/interview/reset'){
  needRole(a,['owner','admin']);
  const result=await resetSocioInterview(pool,a.active_tenant_id);
  await audit(a,'training.interview.reset');
  return json(res,200,result);
 }
 if(method==='POST'&&pathname==='/api/training/interview/audio'){
  needRole(a,['owner','admin']);sameOrigin(req);
  if(!limiter(simulationAttempts,'interview-audio:'+a.active_tenant_id,60000,12))
   throw fail(429,'Limite temporário de gravações atingido.');
  const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  if(!['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav'].includes(mime))
   throw fail(422,'Formato de áudio não suportado.');
  if(Number(req.headers['content-length']||0)>3*1024*1024)throw fail(413,'O áudio deve ter até 3 MB.');
  let length=0;const chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>3*1024*1024)throw fail(413,'O áudio deve ter até 3 MB.');chunks.push(chunk);}
  return json(res,200,await transcribeSocioTraining(Buffer.concat(chunks),mime));
 }
 // Thalita replaces the browser's unpredictable system voice for the guided interview.
 // Access is authenticated, tenant-scoped, CSRF guarded, rate limited; no audio is stored.
 if(method==='POST'&&pathname==='/api/training/interview/tts'){
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'interview-tts:'+a.active_tenant_id,60000,20))
   throw fail(429,'Muitas solicitações de voz. Aguarde um instante.');
  const current=await getSocioInterview(pool,a.active_tenant_id);
  if(!current||current.mode!=='voice'||current.phase!=='active')
   throw fail(409,'Inicie uma entrevista por voz antes de gerar uma fala.');
  const {data}=await body(req,2000);
  const audio=await synthesizeCachedThalitaVoice(data.text);
  res.writeHead(200,{'Content-Type':audio.mime,'Cache-Control':'private, no-store',
   'Content-Length':String(audio.bytes.length),'X-TTS-Voice':SOCIO_TRAINING_VOICE});
  return res.end(audio.bytes);
 }
 if(method==='GET'&&pathname==='/api/training/auto'){
  requirePermission(a,'training.manage');
  return json(res,200,{run:await autoTrainingStatus(pool,a.active_tenant_id),groqConfigured:groqReady(),groqModel:groqModel()});
 }
 if(method==='POST'&&pathname==='/api/training/auto'){
  needRole(a,['owner','admin']);
  if(!limiter(simulationAttempts,'auto-train:'+a.active_tenant_id,600000,4))
   throw fail(429,'Muitas solicitações de treinamento.');
  const run=await startAutoTraining(pool,a.active_tenant_id);
  await audit(a,'training.auto.started',{runId:run.id,connectedChannels:run.connectedChannels});
  return json(res,201,run);
 }
 const autoCancel=pathname.match(/^\/api\/training\/auto\/([0-9a-f-]{36})\/cancel$/);
 if(autoCancel&&method==='POST'){
  needRole(a,['owner','admin']);
  const result=await cancelAutoTraining(pool,a.active_tenant_id,autoCancel[1]);
  await audit(a,'training.auto.cancelled',{runId:result.id});
  return json(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/training/jobs'){
  requirePermission(a,'training.manage');
  const r=await query("SELECT id,status,total_items AS \"totalItems\",processed_items AS \"processedItems\",report_json AS report,created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM training_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 12",[a.active_tenant_id]);
  return json(res,200,r.rows);
 }
 if(method==='POST'&&pathname==='/api/training/jobs'){
  needRole(a,['owner','admin']);
  const active=await query("SELECT id FROM training_jobs WHERE tenant_id=$1 AND status IN ('queued','analyzing','paused') LIMIT 1",[a.active_tenant_id]);
  if(active.rowCount)throw fail(409,'Já existe uma análise em andamento. Finalize ou cancele a anterior.');
  const job=await createTrainingAnalysis(pool,a.active_tenant_id);
  await audit(a,'training.analysis.started',{jobId:job.id,source:'imported_whatsapp_exports'});
  return json(res,201,{...job,source:'imports_only',note:'Ainda não analisa automaticamente históricos conectados ao WA-AKG.'});
 }
 const jobAction=pathname.match(/^\/api\/training\/jobs\/([0-9a-f-]{36})\/(pause|resume|cancel)$/);
 if(jobAction&&method==='POST'){
  needRole(a,['owner','admin']);
  const [jobId,action]=jobAction.slice(1),next=action==='pause'?'paused':action==='resume'?'queued':'cancelled';
  const accepted=action==='pause'?['queued','analyzing']:action==='resume'?['paused']:['queued','analyzing','paused'];
  const result=await query('UPDATE training_jobs SET status=$3,updated_at=now(),finished_at=CASE WHEN $3=$4 THEN now() ELSE finished_at END WHERE id=$1 AND tenant_id=$2 AND status=ANY($5::text[]) RETURNING id,status',
   [jobId,a.active_tenant_id,next,'cancelled',accepted]);
  if(!result.rowCount)throw fail(409,'Análise indisponível ou estado incompatível.');
  await audit(a,'training.analysis.'+action,{jobId});
  return json(res,200,result.rows[0]);
 }
 if(method==='GET'&&pathname==='/api/training/versions'){
  requirePermission(a,'training.manage');
  const versions=await query('SELECT id,job_id AS "jobId",version,status,knowledge_md AS markdown,report_json AS report,created_at AS "createdAt",approved_at AS "approvedAt" FROM training_versions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 15',[a.active_tenant_id]);
  return json(res,200,versions.rows);
 }
 // Revising an approved training creates a private draft; never mutates the live manual.
 const trainingFork=pathname.match(/^\/api\/training\/versions\/([0-9a-f-]{36})\/fork$/);
 if(trainingFork&&method==='POST'){
  requirePermission(a,'training.manage');
  const client=await pool.connect();
  let versionId;
  try{
   await client.query('BEGIN');
   await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[a.active_tenant_id]);
   const existing=await client.query("SELECT id FROM training_versions WHERE tenant_id=$1 AND status='draft' ORDER BY created_at DESC LIMIT 1",[a.active_tenant_id]);
   if(existing.rowCount){versionId=existing.rows[0].id;}
   else{
    const original=await client.query("SELECT job_id,knowledge_md,report_json FROM training_versions WHERE id=$1 AND tenant_id=$2 AND status='approved' FOR UPDATE",[trainingFork[1],a.active_tenant_id]);
    if(!original.rowCount)throw fail(409,'Somente um treinamento aprovado desta empresa pode gerar rascunho.');
    const next=await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM training_versions WHERE tenant_id=$1",[a.active_tenant_id]);
    versionId=id();
    await client.query("INSERT INTO training_versions(id,tenant_id,job_id,version,status,knowledge_md,report_json) VALUES($1,$2,$3,$4,'draft',$5,$6)",[
     versionId,a.active_tenant_id,original.rows[0].job_id,next.rows[0].version,original.rows[0].knowledge_md,original.rows[0].report_json]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  await audit(a,'training.version.forked',{sourceId:trainingFork[1],versionId});
  return json(res,200,{ok:true,versionId});
 }
 const knowledgeEdit=pathname.match(/^\/api\/training\/versions\/([0-9a-f-]{36})\/edit$/);
 if(knowledgeEdit&&method==='POST'){
  needRole(a,['owner','admin']);
  const {data}=await body(req);
  if(!validText(data.markdown,22000)||data.markdown.trim().length<20)
   throw fail(422,'Markdown de conhecimento inválido.');
  const edited=await query(
   "UPDATE training_versions SET knowledge_md=$3 WHERE tenant_id=$1 AND id=$2 AND status='draft' RETURNING id,version",
   [a.active_tenant_id,knowledgeEdit[1],data.markdown.trim()]);
  if(!edited.rowCount)throw fail(409,'Somente rascunhos podem ser editados.');
  await audit(a,'training.version.edited',{versionId:edited.rows[0].id});
  return json(res,200,{ok:true,versionId:edited.rows[0].id});
 }
 const knowledgeRestore=pathname.match(/^\/api\/training\/versions\/([0-9a-f-]{36})\/restore$/);
 if(knowledgeRestore&&method==='POST'){
  needRole(a,['owner','admin']);
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   // Serialize all approval/rollback operations for the same company.
   await c.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[a.active_tenant_id]);
   const version=await c.query(
    "SELECT id,knowledge_md FROM training_versions WHERE tenant_id=$1 AND id=$2 AND status='archived' FOR UPDATE",
    [a.active_tenant_id,knowledgeRestore[1]]);
   if(!version.rowCount)throw fail(409,'Somente versões anteriores podem ser restauradas.');
   await c.query("UPDATE training_versions SET status='archived' WHERE tenant_id=$1 AND status='approved'",[a.active_tenant_id]);
   await c.query(
    "UPDATE training_versions SET status='approved',approved_at=now() WHERE tenant_id=$1 AND id=$2",
    [a.active_tenant_id,knowledgeRestore[1]]);
   await c.query('UPDATE agents SET knowledge_md=$2,updated_at=now() WHERE tenant_id=$1',
    [a.active_tenant_id,version.rows[0].knowledge_md]);
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  await audit(a,'training.version.restored',{versionId:knowledgeRestore[1]});
  return json(res,200,{ok:true,versionId:knowledgeRestore[1],autoReply:false});
 }
 const knowledgeApprove=pathname.match(/^\/api\/training\/versions\/([0-9a-f-]{36})\/approve$/);
 if(knowledgeApprove&&method==='POST'){
  needRole(a,['owner','admin']);
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[a.active_tenant_id]);
   const version=await c.query("SELECT id,knowledge_md FROM training_versions WHERE tenant_id=$1 AND id=$2 AND status='draft' FOR UPDATE",[a.active_tenant_id,knowledgeApprove[1]]);
   if(!version.rowCount)throw fail(409,'Versão não encontrada, já aprovada ou inválida.');
   await c.query("UPDATE training_versions SET status='archived' WHERE tenant_id=$1 AND status='approved'",[a.active_tenant_id]);
   await c.query("UPDATE training_versions SET status='approved',approved_at=now() WHERE tenant_id=$1 AND id=$2",[a.active_tenant_id,knowledgeApprove[1]]);
   await c.query('UPDATE agents SET knowledge_md=$2,updated_at=now() WHERE tenant_id=$1',[a.active_tenant_id,version.rows[0].knowledge_md]);
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  await audit(a,'training.version.approved',{versionId:knowledgeApprove[1]});
  return json(res,200,{ok:true,versionId:knowledgeApprove[1],autoReply:false});
 }
 if(method==='GET'&&pathname==='/api/imports'){
  requirePermission(a,'training.manage');
  const r=await query('SELECT id,filename,conversation_count,message_count,created_at FROM imports WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[a.active_tenant_id]);return json(res,200,r.rows);
 }
 if(method==='POST'&&pathname==='/api/imports/zip'){
  needRole(a,['owner','admin']);
  const {data}=await body(req,2_850_000);
  const filename=trimmed(data.filename,120);
  if(!/\.zip$/i.test(filename))throw fail(422,'Envie um arquivo ZIP exportado do WhatsApp.');
  const files=extractWhatsAppZip(data.contentBase64);
  // Skip unrelated text files, but fail rather than claim training when
  // the archive has no valid WhatsApp conversations.
  const ready=files.map(file=>({...file,parsed:parseWhatsAppExport(file.content)})).filter(file=>file.parsed.messageCount>=3);
  if(!ready.length)throw fail(422,'ZIP não contém conversas reconhecidas do WhatsApp.');
  const c=await pool.connect();
  let totalMessages=0;
  try{
   await c.query('BEGIN');
   for(const file of ready){
    const md=buildTrainingMarkdown(file.parsed,'conversa-importada.txt');
    totalMessages+=file.parsed.messageCount;
    await c.query('INSERT INTO imports(id,tenant_id,filename,conversation_count,message_count,sample_md) VALUES($1,$2,$3,1,$4,$5)',[id(),a.active_tenant_id,trimmed(file.filename,120),file.parsed.messageCount,md]);
   }
   await c.query('COMMIT');
  }catch(err){await c.query('ROLLBACK');throw err;}finally{c.release();}
  await audit(a,'training.zip.imported',{count:ready.length,messages:totalMessages});
  return json(res,201,{conversationCount:ready.length,messageCount:totalMessages});
 }
 if(method==='POST'&&pathname==='/api/imports'){
  needRole(a,['owner','admin']);const {data}=await body(req,950000);
  const filename=trimmed(data.filename,120);
  if(!/\.(txt|md)$/i.test(filename)||typeof data.content!=='string'||data.content.length>700000)throw fail(422,'Envie um arquivo de conversa .txt ou .md de até 700 KB (extraia o ZIP antes do envio).');
  const parsed=parseWhatsAppExport(data.content);
  if(parsed.messageCount<3)throw fail(422,'Arquivo não contém mensagens reconhecidas no formato de exportação do WhatsApp.');
  const md=buildTrainingMarkdown(parsed,filename),item=id();
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('INSERT INTO imports(id,tenant_id,filename,conversation_count,message_count,sample_md) VALUES($1,$2,$3,1,$4,$5)',[item,a.active_tenant_id,filename,parsed.messageCount,md]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await audit(a,'training.imported',{importId:item,messages:parsed.messageCount});
  return json(res,201,{id:item,messageCount:parsed.messageCount,speakers:parsed.speakers});
 }
 if(method==='POST'&&pathname==='/api/simulate'){
  requirePermission(a,'training.manage');
  const key='simulate:'+a.user_id;
  if(!limiter(simulationAttempts,key,60000,12))throw fail(429,'Limite de testes por minuto atingido.');
  const {data}=await body(req);
  if(!validText(data.message,1200))throw fail(422,'Digite uma mensagem de até 1200 caracteres.');
  const [agent,catalogProducts]=await Promise.all([
   query('SELECT name,tone,instructions,knowledge_md FROM agents WHERE tenant_id=$1',[a.active_tenant_id]),
   parseTenantFeatures(a.features).catalog?fullCatalog(a.active_tenant_id):Promise.resolve([])
  ]);
  if(!groqReady())throw fail(503,'Configure GROQ_API_KEY para usar o Groq no simulador.');
  const catalog=catalogPrompt(catalogProducts.filter(p=>p.active));
  const config=agent.rows[0]||{};
  // Lab history is provided for this simulation only, never used as
  // authorization or stored as customer memory.
  const history=normalizeLabHistory(data.history);
  // Build continuity BEFORE the prompt; the previous order used an
  // uninitialized const and broke the real laboratory request.
  const continuity=analyzeSocioContinuity(history.map(turn=>({direction:turn.role==='assistant'?'outbound':'inbound',body:turn.content})),data.message);
  let knowledgeRetrieval=null;
  if(knowledgeV3Enabled()){
   const approved=await loadTenantApprovedKnowledge(pool,a.active_tenant_id);
   knowledgeRetrieval=retrieveApprovedKnowledge({markdown:approved.markdown,version:approved.version,question:data.message,maxChars:4800});
  }
  const system=buildAiInstructions({
   name:config.name,tenantName:a.tenant_name,tone:config.tone,
   instructions:config.instructions,knowledge:config.knowledge_md,
   catalogText:catalog,question:data.message,simulation:true,continuity,knowledgeRetrieval
  });
  const hasConversation=history.some(turn=>turn.role==='assistant');
  const response=await groqResponse({
   instructions:system,input:buildLabInput(history,data.message),maxOutputTokens:550
  });
  const reply=polishCustomerReply(response.reply,{hasConversation,incoming:data.message,
   previousAssistant:history.filter(turn=>turn.role==='assistant').at(-1)?.content||''});
  return json(res,200,{
   reply,simulation:true,provider:'groq',model:response.model,
   quality:reviewReplyStyle(response.reply,{hasConversation}),
   knowledgeEvidence:knowledgeRetrieval?.publicMeta||null,
   productCards:matchCatalogProducts(data.message,catalogProducts)
  });
 }
 // Topic memory is tenant-owned and stores no raw chat. Authorized staff can
 // inspect or clear it without changing the source WhatsApp conversation.
 const memoryMatch=pathname.match(/^\/api\/conversations\/([a-f0-9-]{36})\/ai-memory$/i);
 if(memoryMatch&&(method==='GET'||method==='DELETE')){
  requirePermission(a,'training.manage');
  const conversationId=memoryMatch[1];
  if(method==='GET'){
   return json(res,200,await readConversationMemory(pool,{
    tenantId:a.active_tenant_id,conversationId
   }));
  }
  const cleared=await clearConversationMemory(pool,{
   tenantId:a.active_tenant_id,conversationId
  });
  await audit(a,'agent.memory.cleared',{conversationId});
  return json(res,200,cleared);
 }
 // Inbox v2: tenant-bound WhatsApp-style management. Keep legacy API for
 // existing dashboards and migrations; never expose gateway send operations.
 if(pathname==='/api/inbox/v2'||pathname==='/api/inbox/capabilities'||pathname==='/api/inbox/sync'||
    /^\/api\/conversations\/[a-f0-9-]{36}\/(?:ui|history|notes|send|forward-internal|messages\/[a-f0-9-]{36}\/ui)$/i.test(pathname)){
  return await handleInboxApi({pathname,method,req,res,a,query,body,json,id,audit,pool});
 }
 if(method==='GET'&&pathname==='/api/inbox'){
  const r=await query("SELECT c.id,c.customer_name,c.customer_phone,c.status,c.last_message_at,ch.label AS channel_label,(SELECT m.body FROM messages m WHERE m.conversation_id=c.id AND m.tenant_id=$1 ORDER BY m.created_at DESC LIMIT 1) AS last_message FROM conversations c JOIN channels ch ON ch.id=c.channel_id WHERE c.tenant_id=$1 ORDER BY c.last_message_at DESC LIMIT 80",[a.active_tenant_id]);
  return json(res,200,r.rows);
 }
 const conversationMatch=pathname.match(/^\/api\/conversations\/([a-f0-9-]{36})(?:\/(messages|note))?$/);
 if(conversationMatch){
  const conv=await query('SELECT id,status,customer_name,customer_phone FROM conversations WHERE id=$1 AND tenant_id=$2',[conversationMatch[1],a.active_tenant_id]);
  if(!conv.rowCount)throw fail(404,'Conversa não encontrada.');
  if(method==='GET'&&conversationMatch[2]==='messages'){
   const msgs=await query('SELECT id,direction,body,created_at FROM messages WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 150',[a.active_tenant_id,conv.rows[0].id]);
   return json(res,200,{conversation:conv.rows[0],messages:msgs.rows.reverse()});
  }
  if(method==='POST'&&conversationMatch[2]==='note'){
   const {data}=await body(req);if(!validText(data.text,3000))throw fail(422,'Nota inválida.');
   await query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'note',$4)",[id(),a.active_tenant_id,conv.rows[0].id,data.text.trim()]);
   return json(res,201,{ok:true});
  }
  if(method==='PATCH'&&!conversationMatch[2]){
   const {data}=await body(req);if(!['open','human','resolved'].includes(data.status))throw fail(422,'Status inválido.');
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    await client.query('UPDATE conversations SET status=$3 WHERE tenant_id=$1 AND id=$2',[a.active_tenant_id,conv.rows[0].id,data.status]);
    if(data.status==='resolved'||data.status==='human')await client.query(
     "UPDATE conversation_ui_state SET handling_mode='human',ai_activated_at=NULL,updated_at=now() WHERE tenant_id=$1 AND conversation_id=$2",
     [a.active_tenant_id,conv.rows[0].id]);
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
   return json(res,200,{ok:true});
  }
 }
 if(method==='GET'&&pathname==='/api/team'){
  requirePermission(a,'team.read');
  const r=await query('SELECT id,name,email,phone,role,active,created_at FROM users WHERE tenant_id=$1 ORDER BY created_at',[a.active_tenant_id]);
  return json(res,200,r.rows);
 }
 const teamMember=pathname.match(/^\/api\/team\/([0-9a-f-]{36})$/);
 if(teamMember&&method==='PATCH'){
  requirePermission(a,'team.manage');
  const {data}=await body(req,2000),change=validateMemberPatch(data);
  if(change.role==='admin')requirePermission(a,'team.promote');
  if(teamMember[1]===a.user_id)throw fail(403,'Você não pode alterar o próprio perfil por esta rota.');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const target=await c.query(
    'SELECT id,role,active,platform_owner FROM users WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [a.active_tenant_id,teamMember[1]]);
   if(!target.rowCount)throw fail(404,'Colaborador não encontrado nesta empresa.');
   if(target.rows[0].role==='owner'||target.rows[0].platform_owner)
    throw fail(403,'Não é possível alterar um proprietário por esta operação.');
   if(target.rows[0].role==='admin'&&a.role!=='owner'&&!a.platform_owner)
    throw fail(403,'Somente o proprietário pode modificar o perfil de um administrador.');
   const nextRole=change.changeRole?change.role:target.rows[0].role;
   const nextActive=change.changeActive?change.active:target.rows[0].active;
   const updated=await c.query(
    'UPDATE users SET role=$3,active=$4 WHERE tenant_id=$1 AND id=$2 RETURNING id,name,email,phone,role,active',
    [a.active_tenant_id,teamMember[1],nextRole,nextActive]);
   if(!nextActive)await c.query('DELETE FROM sessions WHERE user_id=$1',[teamMember[1]]);
   await c.query('INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,$4,$5)',
    [id(),a.active_tenant_id,a.user_id,'team.member_updated',
      JSON.stringify({userId:teamMember[1],before:{role:target.rows[0].role,active:target.rows[0].active},
       after:{role:nextRole,active:nextActive},sessionsRevoked:!nextActive})]);
   await c.query('COMMIT');
   return json(res,200,updated.rows[0]);
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
 }
 if(method==='POST'&&pathname==='/api/team'){
  requirePermission(a,'team.invite');const {data}=await body(req);
  if(data.role==='admin')requirePermission(a,'team.promote');
  if(!emailOk(data.email)||!validText(data.name,100)||!allowedNewMemberRole(a,data.role))throw fail(422,'Dados de usuário ou permissão inválidos.');
  if(typeof data.password!=='string'||data.password.length<12||data.password.length>128)
   throw fail(422,'Senha inicial deve conter de 12 a 128 caracteres.');
  const raw=String(data.phone||'').trim(),phone=raw?normalizeLoginPhone(raw):null;
  if(raw&&!phone)throw fail(422,'Número de colaborador inválido. Informe o DDD.');
  const hash=await hashPassword(data.password),c=await pool.connect();
  try{
   await c.query('BEGIN');
   const r=await c.query(
    'INSERT INTO users(id,tenant_id,email,phone,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,email,phone,role,active',
    [id(),a.active_tenant_id,data.email.trim().toLowerCase(),phone,data.name.trim(),hash,data.role]);
   await c.query('INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,$4,$5)',
    [id(),a.active_tenant_id,a.user_id,'team.invited',JSON.stringify({userId:r.rows[0].id,role:data.role})]);
   await c.query('COMMIT');
   return json(res,201,r.rows[0]);
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
 }
 if(method==='GET'&&pathname==='/api/ops/tenant-integrity'){
  requirePermission(a,'audit.read');
  const record=await query(
   "SELECT "+
   "(SELECT count(*)::int FROM conversations c LEFT JOIN channels ch ON ch.id=c.channel_id "+
   " WHERE c.tenant_id=$1 AND (ch.id IS NULL OR ch.tenant_id IS DISTINCT FROM c.tenant_id)) AS channel_links,"+
   "(SELECT count(*)::int FROM messages m LEFT JOIN conversations c ON c.id=m.conversation_id "+
   " WHERE m.tenant_id=$1 AND (c.id IS NULL OR c.tenant_id IS DISTINCT FROM m.tenant_id)) AS message_links,"+
   "(SELECT count(*)::int FROM product_variants v LEFT JOIN products p ON p.id=v.product_id "+
   " WHERE v.tenant_id=$1 AND (p.id IS NULL OR p.tenant_id IS DISTINCT FROM v.tenant_id)) AS variant_links,"+
   "(SELECT count(*)::int FROM product_media pm LEFT JOIN products p ON p.id=pm.product_id "+
   " WHERE pm.tenant_id=$1 AND (p.id IS NULL OR p.tenant_id IS DISTINCT FROM pm.tenant_id)) AS media_links,"+
   "(SELECT count(*)::int FROM sales_quotes q LEFT JOIN conversations c ON c.id=q.conversation_id "+
   " WHERE q.tenant_id=$1 AND (c.id IS NULL OR c.tenant_id IS DISTINCT FROM q.tenant_id)) AS quote_links,"+
   "(SELECT count(*)::int FROM sales_orders o LEFT JOIN sales_quotes q ON q.id=o.quote_id "+
   " WHERE o.tenant_id=$1 AND (q.id IS NULL OR q.tenant_id IS DISTINCT FROM o.tenant_id)) AS order_links,"+
   "(SELECT count(*)::int FROM sessions s JOIN users u ON u.id=s.user_id "+
   " WHERE s.active_tenant_id=$1 AND u.platform_owner=false AND u.tenant_id<>s.active_tenant_id) AS foreign_sessions",
   [a.active_tenant_id]);
  const counts=record.rows[0],total=Object.values(counts).reduce((n,v)=>n+Number(v||0),0);
  return json(res,200,{checkedAt:new Date().toISOString(),tenantId:a.active_tenant_id,
   mismatches:counts,totalMismatches:total,preflightClean:total===0,
   note:'Contagens das relações existentes. Restrições novas não foram validadas retroativamente.'});
 }
 if(method==='GET'&&pathname==='/api/ops/audit'){
  requirePermission(a,'audit.read');
  const u=new URL(req.url,'http://localhost');
  const rawLimit=u.searchParams.get('limit')||'40',limit=Number(rawLimit);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw fail(422,'Limite de auditoria inválido.');
  const before=decodeHistoryCursor(u.searchParams.get('before'));
  const rows=await query(
   "SELECT a.id,a.action,a.metadata,a.created_at,a.created_at::text AS cursor_created_at,CASE WHEN u.tenant_id=a.tenant_id THEN u.name ELSE 'Administração Consecom' END AS actor "+
   "FROM audit a LEFT JOIN users u ON u.id=a.actor_id "+
   "WHERE a.tenant_id=$1 AND ($2::timestamptz IS NULL OR a.created_at<$2::timestamptz OR ($4::uuid IS NOT NULL AND a.created_at=$2 AND a.id<$4)) "+
   "ORDER BY a.created_at DESC,a.id DESC LIMIT $3",
   [a.active_tenant_id,before.time,limit+1,before.id]);
  const events=rows.rows.slice(0,limit),hasMore=rows.rows.length>limit;
  return json(res,200,{events,limit,hasMore,nextCursor:hasMore?encodeHistoryCursor(events.at(-1)):null});
 }
 if(method==='GET'&&pathname==='/api/admin/cnpj'){
  needPlatform(a);
  if(!limiter(authAttempts,'cnpj:'+a.user_id,600000,12))
   throw fail(429,'Muitas consultas CNPJ. Tente novamente.');
  const cnpj=normalizeCnpj(new URL(req.url,'http://local').searchParams.get('number'));
  if(!validCnpj(cnpj))throw fail(422,'Informe um CNPJ válido de 14 dígitos.');
  const previous=cnpjCache.get(cnpj);
  if(previous&&Date.now()-previous.at<900000)return json(res,200,previous.result);
  const result=await lookupCompany(cnpj);
  cnpjCache.set(cnpj,{result,at:Date.now()});
  if(cnpjCache.size>150)cnpjCache.clear();
  return json(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/admin/monitor'){
  needPlatform(a);
  return json(res,200,await getMasterSaasMonitor(pool,a));
 }
 if(method==='GET'&&pathname==='/api/admin/tenants'){
  needPlatform(a);
  const r=await query("SELECT t.id,t.name,t.slug,t.plan,t.status,t.cnpj,t.legal_name,t.trade_name,t.features,t.quote_alert_whatsapp,t.created_at,(SELECT count(*)::int FROM users u WHERE u.tenant_id=t.id) AS members FROM tenants t ORDER BY t.created_at DESC");
  return json(res,200,r.rows);
 }
 const editMasterTenant=pathname.match(/^\/api\/admin\/tenants\/([a-f0-9-]{36})$/i);
 if(editMasterTenant&&method==='PATCH'){
  needPlatform(a);
  const {data}=await body(req,2500);
  if(!data||typeof data!=='object'||Object.keys(data).some(key=>!['name','plan'].includes(key))||
     !validText(data.name,120)||!['essencial','equipe','voz'].includes(data.plan))
   throw fail(422,'Informe um nome válido e um plano cadastral permitido.');
  const target=await query('SELECT id,name,plan FROM tenants WHERE id=$1',[editMasterTenant[1]]);
  if(!target.rowCount)throw fail(404,'Empresa não encontrada.');
  const name=data.name.trim(),plan=data.plan;
  const result=await query('UPDATE tenants SET name=$2,plan=$3 WHERE id=$1 RETURNING id,name,plan,status',
   [editMasterTenant[1],name,plan]);
  await audit(a,'platform.tenant_profile_updated',{
   targetTenantId:editMasterTenant[1],before:{name:target.rows[0].name,plan:target.rows[0].plan},
   after:{name,plan},billingChanged:false});
  return json(res,200,{...result.rows[0],billingChanged:false});
 }
 const tenantFeaturesRoute=pathname.match(/^\/api\/admin\/tenants\/([a-f0-9-]{36})\/features$/i);
 if(tenantFeaturesRoute&&method==='PUT'){
  needPlatform(a);
  const {data}=await body(req,3000);
  const features=validateTenantFeatures(data.features);
  const updated=await query("UPDATE tenants SET features=$2 WHERE id=$1 RETURNING id,features",
   [tenantFeaturesRoute[1],JSON.stringify(features)]);
  if(!updated.rowCount)throw fail(404,'Empresa não encontrada.');
  await audit(a,'platform.tenant_features.updated',{targetTenantId:tenantFeaturesRoute[1],features});
  return json(res,200,updated.rows[0]);
 }
 if(method==='POST'&&pathname==='/api/admin/tenants'){
  needPlatform(a);const {data}=await body(req);
  if(!validText(data.company,120)||!validText(data.ownerName,100)||!emailOk(data.ownerEmail)||!['essencial','equipe','voz'].includes(data.plan||'essencial'))throw fail(422,'Dados da empresa inválidos.');
  const rawCnpj=String(data.cnpj||'').trim();
  const companyCnpj=rawCnpj?normalizeCnpj(rawCnpj):null;
  if(rawCnpj&&!validCnpj(companyCnpj))throw fail(422,'CNPJ inválido.');
  const candidate=typeof data.companyProfile==='object'&&data.companyProfile&&!Array.isArray(data.companyProfile)?
   data.companyProfile:{};
  const addr=candidate.address&&typeof candidate.address==='object'&&!Array.isArray(candidate.address)?candidate.address:{};
  const features=validateTenantFeatures(data.features||{
   whatsapp:true,catalog:true,quotes:true,meta_ads:true,ai:true,team:true
  });
  const companyProfile={
   address:Object.fromEntries(['street','number','additional','neighborhood','city','state','postalCode']
    .map(key=>[key,trimmed(addr[key]||'',key==='street'?130:100)])),
   primaryActivity:trimmed(candidate.primaryActivity||'',150),
   status:trimmed(candidate.status||'',70),
   commercialPhone:trimmed(candidate.commercialPhone||data.companyPhone||'',30),
   commercialEmail:trimmed(candidate.commercialEmail||data.companyEmail||'',150)
  };
  const legalName=trimmed(data.legalName||'',200),tradeName=trimmed(data.tradeName||'',200);
  const raw=String(data.ownerPhone||'').trim(),phone=raw?normalizeLoginPhone(raw):null;
  if(raw&&!phone)throw fail(422,'Número do responsável inválido. Informe o DDD.');
  const hash=await hashPassword(data.ownerPassword),tenant=id(),user=id(),client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query("INSERT INTO tenants(id,name,slug,plan,status,cnpj,legal_name,trade_name,company_profile,features) VALUES($1,$2,$3,$4,'trial',$5,$6,$7,$8,$9)",[tenant,data.company.trim(),slugify(data.company)+'-'+tenant.slice(0,6),data.plan||'essencial',companyCnpj,legalName,tradeName,JSON.stringify(companyProfile),JSON.stringify(features)]);
   await client.query('INSERT INTO users(id,tenant_id,email,phone,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,tenant,data.ownerEmail.trim().toLowerCase(),phone,data.ownerName.trim(),hash,'owner']);
   await client.query('INSERT INTO agents(tenant_id) VALUES($1)',[tenant]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  await audit(a,'tenant.created',{tenantId:tenant});return json(res,201,{id:tenant});
 }
 if(method==='POST'&&pathname==='/api/admin/switch'){
  needPlatform(a);const {data}=await body(req);
  const result=await query('SELECT id FROM tenants WHERE id=$1',[data.tenantId]);
  if(!result.rowCount)throw fail(404,'Empresa não encontrada.');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('UPDATE sessions SET active_tenant_id=$2 WHERE token_hash=$1',[a.token_hash,data.tenantId]);
   await c.query('INSERT INTO audit(id,tenant_id,actor_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[
    id(),a.active_tenant_id,a.user_id,'platform.tenant_switched',JSON.stringify({targetTenantId:data.tenantId})]);
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  return json(res,200,{ok:true});
 }
 throw fail(404,'Rota não encontrada.');
}
function needPlatform(a){if(!a.platform_owner)throw fail(403,'Somente a administração da Consecom pode acessar.');}
function needRole(a,allowed){if(!allowed.includes(a.role)&&!(a.role==='manager'&&allowed.includes('admin'))&&!a.platform_owner)throw fail(403,'Você não tem permissão para esta ação.');}
async function receiveWhatsApp(req,res){
 if(!process.env.META_APP_SECRET)throw fail(503,'Webhook ainda não configurado.');
 const {raw,data}=await body(req,500000);
 const signature=String(req.headers['x-hub-signature-256']||'');
 const expected='sha256='+createHmac('sha256',process.env.META_APP_SECRET).update(raw).digest('hex');
 if(!secureEqual(signature,expected))throw fail(403,'Assinatura inválida.');
 if(data.object!=='whatsapp_business_account')return json(res,200,{ok:true});
 const items=[];
 for(const entry of data.entry||[])for(const change of entry.changes||[]){
  const value=change.value||{},external=value.metadata?.phone_number_id;
  for(const m of value.messages||[])if(m.type==='text'&&m.text?.body&&external)items.push({external:String(external),messageId:String(m.id||''),from:String(m.from||''),body:String(m.text.body).slice(0,4000),name:String(value.contacts?.[0]?.profile?.name||'').slice(0,100)});
 }
 for(const item of items.slice(0,50)){
  if(!item.from||!item.messageId)continue;
  const ch=await query('SELECT id,tenant_id FROM channels WHERE external_phone_id=$1',[item.external]);
  if(!ch.rowCount)continue;
  const {id:channelId,tenant_id:tenantId}=ch.rows[0];
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const conv=await c.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,channel_id,customer_phone) DO UPDATE SET last_message_at=now(),customer_name=CASE WHEN conversations.customer_name='' THEN EXCLUDED.customer_name ELSE conversations.customer_name END RETURNING id",[id(),tenantId,channelId,item.name,item.from]);
   await c.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id) VALUES($1,$2,$3,'inbound',$4,$5) ON CONFLICT(tenant_id,provider_id) DO NOTHING",[id(),tenantId,conv.rows[0].id,item.body,item.messageId]);
   await c.query('COMMIT');
  }catch(err){await c.query('ROLLBACK');console.error('webhook persistence failed',err?.code||'db error');throw err;}finally{c.release();}
 }
 return json(res,200,{ok:true});
}
async function main(){
 const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
 if(dbSchema==='socio_app'){
  // Private Supabase runtime is migrated explicitly; do not silently run
  // Railway's public DDL against a remotely managed Postgres project.
  const expected=MIGRATION_TABLES;
  const check=await query(
   "SELECT table_name FROM information_schema.tables WHERE table_schema='socio_app' AND table_name=ANY($1::text[])",
   [expected]);
  const names=new Set(check.rows.map(x=>x.table_name));
  if(expected.some(name=>!names.has(name)))throw new Error('Private Supabase schema is incomplete');
  const requiredColumns=await query(
   "SELECT column_name FROM information_schema.columns WHERE table_schema='socio_app' "+
   "AND table_name='users' AND column_name='active'");
  if(!requiredColumns.rowCount)throw new Error('Private Supabase team schema is outdated');
 }else await query(schema);
 // Google Ads was removed from this SaaS. Revoke any previously stored local
 // authorizations and legacy script secrets, without deleting historic metrics.
 // Idempotent: after the first successful deployment subsequent runs are no-ops.
 await query("UPDATE marketing_oauth_attempts SET consumed_at=now() "+
  "WHERE provider='google' AND consumed_at IS NULL");
 await query("UPDATE marketing_oauth_grants SET status='disconnected',token_ciphertext=NULL,expires_at=NULL,"+
  "last_read_status='not_tested',last_checked_at=NULL,last_account_count=0,updated_at=now() "+
  "WHERE provider='google' AND (status<>'disconnected' OR token_ciphertext IS NOT NULL)");
 await query("UPDATE marketing_connections SET status='disabled',secret_ciphertext=NULL,updated_at=now() "+
  "WHERE provider='google_ads_scripts' AND (status<>'disabled' OR secret_ciphertext IS NOT NULL)");
 // Storage probe checks the real private S3 endpoint without touching customer files.
 if(mediaConfigured())void checkMediaStorage()
  .then(x=>console.info('[socio product media]',JSON.stringify(x)))
  .catch(()=>console.warn('[socio product media]',JSON.stringify({configured:true,reachable:false})));
 // Asynchronous gateway auth/scope probe; logs only boolean readiness.
 // Never log session ids, telephone numbers, raw responses or secrets.
 if(gatewayConfigured()){
  void gatewayRead('/api/sessions',{timeoutMs:7000})
   .then(result=>console.info('[socio gateway private]',JSON.stringify({reachable:true,authorized:true,
     sessions:Array.isArray(result.data)?result.data.length:0})))
   .catch(error=>console.warn('[socio gateway private]',JSON.stringify({reachable:false,
     code:Number(error?.status||503)})));
 }
 // Refresh only wallets that the owner explicitly connected and observed.
 let metaBillingBusy=false;
 const metaBillingWorker=setInterval(async()=>{
  if(metaBillingBusy||workersBlocked()||process.env.SOCIO_META_BILLING_MONITOR_ENABLED==='false')return;
  metaBillingBusy=true;
  try{await monitorMetaBilling(pool,metaBrowser);}
  catch{console.warn('[socio-meta-wallet] refresh unavailable');}
  finally{metaBillingBusy=false;}
 },60000);
 metaBillingWorker.unref();
 // Continuously import only the text available in authorized WhatsApp chats.
 // This worker NEVER sends; it detects newly arrived messages for the inbox.
 let liveSyncBusy=false;
 const liveSyncWorker=setInterval(async()=>{
  if(liveSyncBusy||workersBlocked()||!gatewayConfigured()||process.env.SOCIO_LIVE_SYNC_ENABLED==='false')return;
  liveSyncBusy=true;
  try{await processLiveInboxSync(pool);}
  catch(e){console.warn('[socio-inbox-sync]',String(e?.code||'SYNC_ERROR').slice(0,40));}
  finally{liveSyncBusy=false;}
 },16000);
 liveSyncWorker.unref();
 // Owner-only WA-AKG command bridge. Requires explicit opt-in, verified sender,
 // connected private chat and authorized outbound. Never processes group/customer commands.
 let ownerSkillBusy=false;
 const ownerSkillsWorker=setInterval(async()=>{
  if(ownerSkillBusy||workersBlocked()||process.env.SOCIO_OWNER_COMMANDS_ENABLED!=='true')return;
  ownerSkillBusy=true;
  try{await processOwnerSkillInbox(pool);}
  catch(error){console.warn('[socio-owner-skills]',String(error?.code||'SKILL_ERROR').slice(0,40));}
  finally{ownerSkillBusy=false;}
 },19000);
 ownerSkillsWorker.unref();
 // WA-AKG photo/audio owner bridge: separate explicit opt-in, never processes groups.
 // Only content from a verified, currently connected private owner conversation.
 // Voice can prepare requests but cannot authorize Meta spending or activation.
 let ownerMediaBusy=false;
 const ownerMediaWorker=setInterval(async()=>{
  if(ownerMediaBusy||workersBlocked()||process.env.SOCIO_OWNER_COMMANDS_ENABLED!=='true'||
   process.env.SOCIO_OWNER_MEDIA_ENABLED!=='true')return;
  ownerMediaBusy=true;
  try{await processOwnerSkillMedia(pool);}
  catch(error){console.warn('[socio-owner-media]',String(error?.code||'MEDIA_ERROR').slice(0,40));}
  finally{ownerMediaBusy=false;}
 },23000);
 ownerMediaWorker.unref();

 // Attribution: only observed inbound prefilled codes. Never reads/writes campaigns or sends messages.
 let attributionBusy=false;
 const attributionWorker=setInterval(async()=>{
  if(attributionBusy||workersBlocked()||process.env.SOCIO_ATTRIBUTION_ENABLED!=='true')return;
  attributionBusy=true;
  try{await scanTrackingAttribution(pool);}
  catch(error){console.warn('[socio-attribution]',String(error?.code||'ATTRIBUTION_ERROR').slice(0,40));}
  finally{attributionBusy=false;}
 },17000);
 attributionWorker.unref();
 // Official Meta reporting worker. Generates private, read-only snapshots.
 // It is opt-in and does not send WA-AKG messages or alter campaigns.
 let metaReportBusy=false;
 const metaReportsWorker=setInterval(async()=>{
  if(metaReportBusy||workersBlocked()||process.env.SOCIO_META_REPORTS_ENABLED!=='true')return;
  metaReportBusy=true;
  try{await processDueMetaReport(pool);}
  catch(error){console.warn('[socio-meta-report]',String(error?.code||'REPORT_ERROR').slice(0,40));}
  finally{metaReportBusy=false;}
 },60000);
 metaReportsWorker.unref();
 // Quote lead intake scans only recent inbound messages. It never sends any
 // quote to the customer and cannot create a paid order automatically.
 let quoteBusy=false;
 const quoteWorker=setInterval(async()=>{
  if(quoteBusy||workersBlocked())return;
  quoteBusy=true;
  try{await scanQuoteRequests(pool);}
  catch(error){console.warn('[socio-quote-intake]',String(error?.code||'INTAKE_ERROR').slice(0,40));}
  finally{quoteBusy=false;}
 },15000);
 quoteWorker.unref();
 let saleIntakeBusy=false;
 const saleIntakeWorker=setInterval(async()=>{
  if(saleIntakeBusy||workersBlocked())return;
  saleIntakeBusy=true;
  try{await scanSalesIntents(pool);}
  catch(error){console.warn('[socio-sales-intake]',String(error?.code||'INTAKE_ERROR').slice(0,40));}
  finally{saleIntakeBusy=false;}
 },15000);
 saleIntakeWorker.unref();
 // Owner WhatsApp alerts only when the owner explicitly enabled the setting.
 // Uncertain sends are marked permanently, never retried automatically.
 let ownerAlertBusy=false;
 const ownerAlertWorker=setInterval(async()=>{
  if(ownerAlertBusy||workersBlocked())return;
  ownerAlertBusy=true;
  try{await processNextOwnerQuoteAlert(pool);}
  catch(error){console.warn('[socio-quote-alert]',String(error?.code||'ALERT_ERROR').slice(0,40));}
  finally{ownerAlertBusy=false;}
 },12000);
 ownerAlertWorker.unref();
 // Physically purge expired derived topic summaries on startup and hourly,
 // even if the feature was disabled after previously storing a memory.
 // Underlying customer messages are never deleted by this worker.
 const purgeConversationTopics=async()=>{
  if(workersBlocked())return;
  try{await purgeExpiredConversationMemories(pool);}
  catch(error){console.warn('[socio-ai-memory-purge]',String(error?.code||'PURGE_ERROR').slice(0,35));}
 };
 void purgeConversationTopics();
 const memoryPurgeWorker=setInterval(purgeConversationTopics,3600000);
 memoryPurgeWorker.unref();
 // AI only attempts replies if explicitly enabled, agent enabled and each
 // conversation handed over. Claims are durable to avoid duplicate messages.
 let replyBusy=false;
 const aiReplyWorker=setInterval(async()=>{
  if(replyBusy||workersBlocked())return;
  replyBusy=true;
  try{await reconcileConfirmedOutbox(pool);await processNextAiReply(pool);}
  catch(e){console.warn('[socio-ai-reply]',String(e?.code||'REPLY_ERROR').slice(0,40));}
  finally{replyBusy=false;}
 },6000);
 aiReplyWorker.unref();
 // Automatically move a supervised training run from scan to Markdown draft;
 // per-run database row locks make this safe across replicas.
 let autoBusy=false;
 const autoWorker=setInterval(async()=>{
  if(autoBusy||workersBlocked())return;
  autoBusy=true;
  try{await processNextAutoTraining(pool);}
  catch(error){console.warn('[socio-auto-training]',String(error?.code||'worker-error').slice(0,55));}
  finally{autoBusy=false;}
 },2400);
 autoWorker.unref();
 // One active worker per Node instance; row locks serialize jobs across replicas.
 // All results remain drafts until the tenant owner approves them.
 let waBusy=false,waLastError=0;
 const waWorker=setInterval(async()=>{
  if(waBusy||workersBlocked()||!gatewayConfigured())return;
  waBusy=true;
  try{await processNextWaakgScan(pool);}
  catch(err){if(Date.now()-waLastError>30000){
    console.warn('[socio-waakg-worker]',String(err?.code||'worker-error').slice(0,70));
    waLastError=Date.now();
  }}
  finally{waBusy=false;}
 },2200);
 waWorker.unref();
 let workerBusy=false,lastWorkerError=0;
 const worker=setInterval(async()=>{
  if(workerBusy||workersBlocked())return;
  workerBusy=true;
  try{await processNextAnalysisJob(pool);}
  catch(error){if(Date.now()-lastWorkerError>30000){
   console.warn('[socio-training-worker]',String(error?.code||error?.message||'error').slice(0,100));
   lastWorkerError=Date.now();
  }}
  finally{workerBusy=false;}
 },750);
 worker.unref();
 const server=http.createServer((req,res)=>Promise.resolve(handle(req,res)).catch(e=>{
  const code=e.code;
  if(code==='23505')return json(res,409,{error:'Este e-mail, telefone ou identificador já está cadastrado.'});
  if(code==='23503')return json(res,409,{error:'Existe um registro vinculado que impede a alteração.'});
  if(!e.status)console.error('request failed',e?.message||e);
  if(!res.headersSent)json(res,e.status||500,{error:safeDetail(e)});
  else res.end();
 }));
 server.listen(PORT,'0.0.0.0',()=>{
  console.log('Socio listening on '+PORT);
  // Warm only generic public voice acknowledgements, never tenant/customer data.
  // Fire-and-forget after listening; readiness is not blocked by external TTS.
  if(process.env.NODE_ENV!=='test'){
   const warming=setTimeout(()=>{void prewarmThalitaAcknowledgements().catch(()=>{});},1500);
   warming.unref();
  }
  // Explicit one-time, source+destination+Meta-account scoped pilot. Not a
  // recurring worker and never a campaign activation. The DB receipt prevents
  // duplicate uploads across restarts or simultaneous service replicas.
  if(process.env.SOCIO_WA_VIDEO_PILOT_ONCE==='true'&&process.env.NODE_ENV!=='test'){
   const oneTime=setTimeout(()=>{
    if(workersBlocked())return;
    void runVideoPilotOnce(pool).then(result=>{
     console.info('[socio-wa-meta-video-pilot]',JSON.stringify(result));
    }).catch(error=>{
     console.warn('[socio-wa-meta-video-pilot]',JSON.stringify({
      reason:'UNEXPECTED_ERROR',code:String(error?.status||'UNEXPECTED').slice(0,16)
     }));
    });
   },10000);
   oneTime.unref();
  }
 });
 process.on('SIGTERM',()=>server.close(()=>Promise.allSettled([metaBrowser.close(),flowImages.close()]).then(()=>pool.end()).then(()=>process.exit(0))));
}
main().catch(e=>{console.error('startup failed',e.message);process.exit(1);});
