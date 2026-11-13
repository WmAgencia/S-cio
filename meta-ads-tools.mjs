// Account-bound tools for the official Marketing API. Writes require a saved,
// reviewed plan. An uncertain POST is never automatically retried.
import {randomUUID,createHmac} from 'node:crypto';
import {officialConfig,resolveSelectedOfficialAccount} from './meta-official.mjs';
import {openMarketingSecret} from './marketing-integrations.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {normalizeImage} from './media-storage.mjs';
import {metaBillingDetailsURL} from './meta-billing-state.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(v,max=200)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():null;
const numeric=v=>typeof v==='string'&&/^\d{4,30}$/.test(v);
const money=v=>Number.isSafeInteger(v)&&v>=100&&v<=10000000;
const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=1800?u.href:null;}catch{return null;}};
function permit(a,write=false){requirePermission(a,write?'marketing.manage':'marketing.read');assertApiFeature(a.features,'/api/marketing/tools');if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');}
async function context(pool,a,options={},write=false){
 permit(a,write);const account=await resolveSelectedOfficialAccount(pool,a,options);
 const r=await pool.query('SELECT token_encrypted,scopes FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2 AND expires_at>now()',[a.active_tenant_id,a.user_id]);
 const grant=r.rows[0];if(!grant)throw fail(409,'Reconecte sua conta Meta.');
 if(write&&!grant.scopes.includes('ads_management'))throw fail(403,'Autorize ads_management ao conectar sua conta Meta.');
 const secret=JSON.parse(openMarketingSecret(grant.token_encrypted,options.env||process.env));
 if(secret.tenant!==a.active_tenant_id||secret.user!==a.user_id)throw fail(403,'Autorização de outra empresa.');
 return {account,token:secret.token,options,tenantId:a.active_tenant_id};
}
async function graph(c,path,params={},method='GET'){
 if(!/^\/(act_\d+|\d+|search)(\/(campaigns|adsets|ads|adcreatives|adimages|adspixels|insights|promote_pages|previews|copies))?$/.test(path))throw fail(422,'Operação Meta inválida.');
 const cfg=officialConfig(c.options.env||process.env),url=new URL('https://graph.facebook.com/'+cfg.version+path);
 const body=new URLSearchParams();
 for(const [k,v] of Object.entries(params))body.set(k,typeof v==='object'?JSON.stringify(v):String(v));
 body.set('appsecret_proof',createHmac('sha256',cfg.secret).update(c.token).digest('hex'));
 if(method==='GET')url.search=body.toString();
 let response,data;
 try{response=await (c.options.request||fetch)(url,{method,headers:{Authorization:'Bearer '+c.token,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});data=await response.json();}
 catch{throw Object.assign(fail(503,method==='POST'?'A Meta não confirmou o resultado. Não repita esta operação antes de conferir o Gerenciador de Anúncios.':'A Meta não respondeu. Tente atualizar os dados.'),{uncertain:method==='POST'});}
 if(!response.ok||data.error){const detail=String(data.error?.error_user_msg||data.error?.error_user_title||'Confira permissões, dados e restrições da conta.').replace(/[<>]/g,'').slice(0,300);throw fail(422,'A Meta recusou a operação. '+detail);}
 return data;
}
const listing=data=>({items:data.data||[],hasMore:Boolean(data.paging?.next)});
async function availablePages(c){
 const direct=await graph(c,'/'+c.account.id+'/promote_pages',{fields:'id,name',limit:100});
 if((direct.data||[]).length)return direct;
 // Some accounts return no promote_pages although their existing ads expose
 // the page used by their creative. Only reuse pages proven in this account.
 const ads=await graph(c,'/'+c.account.id+'/ads',{fields:'creative{object_story_spec,effective_object_story_id}',limit:100});
 const ids=[...new Set((ads.data||[]).map(x=>x.creative?.object_story_spec?.page_id||String(x.creative?.effective_object_story_id||'').split('_')[0]).filter(numeric))];
 const pages=[];
 for(const id of ids){let name='Página '+id;try{const page=await graph(c,'/'+id,{fields:'id,name'});if(page.name)name=page.name;}catch{}pages.push({id,name});}
 return {data:pages};
}
// Meta AdAccount.balance is an amount OWED, never the advertiser's wallet.
 // Only a typed STORED_BALANCE amount from a prepay account may be surfaced
 // as available funds. Spend-cap remaining is a separate delivery constraint.
export function normalizeMetaAccountFinance(account){
 const minor=v=>{
  if(v===undefined||v===null||v==='')return null;
  const str=String(v);
  if(!/^[0-9]{1,16}$/.test(str))return null;
  const n=Number(str);return Number.isSafeInteger(n)?n:null;
 };
 const detail=account?.funding_source_details;
 const sources=Array.isArray(detail)?detail:detail?[detail]:[];
 const stored=sources.filter(item=>String(item?.type)==='20');
 // Never treat total/original deposit as the current balance.
 const prepaidMinor=account?.is_prepay_account===true&&stored.length===1?
  minor(stored[0]?.amount):null;
 const cap=minor(account?.spend_cap),spent=minor(account?.amount_spent);
 const remainingCapMinor=cap!==null&&cap>0&&spent!==null?
  Math.max(0,cap-spent):null;
 const isPrepaid=account?.is_prepay_account===true;
 return {
  currency:/^[A-Z]{3}$/.test(account?.currency||'')?account.currency:null,
  isPrepaid:isPrepaid?true:account?.is_prepay_account===false?false:null,
  availableFundsMinor:prepaidMinor,
  availableFundsSource:prepaidMinor!==null?'meta_stored_balance':null,
  spendCapRemainingMinor:remainingCapMinor,
  spendCapMinor:cap!==null&&cap>0?cap:null,
  amountDueMinor:minor(account?.balance),
  accountStatus:account?.account_status!==null&&account?.account_status!==undefined&&account?.account_status!==''&&Number.isInteger(Number(account.account_status))?
   Number(account.account_status):null,
  checkedAt:new Date().toISOString()
 };
}
export async function readAdsTool(pool,a,kind,input={},options={}){
 const c=await context(pool,a,options),id=c.account.id;
 const fields={campaigns:'id,name,status,effective_status,objective,daily_budget,lifetime_budget',adsets:'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting',ads:'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,image_url,thumbnail_url,video_id,object_story_spec}',images:'hash,name,url,width,height',pages:'id,name'};
 if(kind==='finance'){
  const core='id,name,currency,amount_spent,spend_cap,balance,is_prepay_account,account_status,business{id}';
  let data;const unavailableFields=[];
  try{
   data=await graph(c,'/'+id,{fields:core+',funding_source_details'});
  }catch(error){
   if(error.status!==422)throw error;
   data=await graph(c,'/'+id,{fields:'id,name,currency,amount_spent,spend_cap,account_status,business{id}'});
   // A restricted funding field must not hide prepay type or invoice balance.
   const optional=['balance','is_prepay_account','funding_source_details'];
   const values=await Promise.all(optional.map(async field=>{
    try{return {field,value:await graph(c,'/'+id,{fields:'id,'+field})};}
    catch(error){if(error.status!==422)throw error;return {field,unavailable:true};}
   }));
   for(const item of values){
    if(item.unavailable)unavailableFields.push(item.field);
    else if(Object.hasOwn(item.value,item.field))data[item.field]=item.value[item.field];
   }
  }
  const finance=normalizeMetaAccountFinance(data);
  finance.unavailableFields=unavailableFields;
  finance.availableFundsStatus=finance.availableFundsMinor!==null?'reported':
   unavailableFields.includes('funding_source_details')?'field_restricted':
   finance.isPrepaid===false?'not_prepaid':'not_reported';
  finance.pix={generationSupported:false,mode:'official_billing',
   reason:'A integração oficial disponível não fornece emissão de Pix de recarga no Sócio. Gere o pagamento no faturamento da Meta.'};
  const billingUrl=metaBillingDetailsURL(id,{businessId:data.business?.id});
  const {funding_source_details:unused,...publicAccount}=data;
  return {account:publicAccount,finance,paymentsUrl:billingUrl,manualPayment:true,
   paymentLinkType:'meta_billing_details',pixCodeAvailable:false};
 }
 if(kind==='pages')return listing(await availablePages(c));
 if(kind==='insights'){
  const datePreset=['today','yesterday','last_7d','last_30d'].includes(input.period)?input.period:'last_7d';
  const level=['campaign','adset','ad'].includes(input.level)?input.level:'campaign';
  const keys={campaign:'campaign_id,campaign_name',
   adset:'campaign_id,campaign_name,adset_id,adset_name',
   ad:'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name'}[level];
  return listing(await graph(c,'/'+id+'/insights',{fields:keys+
   ',impressions,reach,clicks,spend,ctr,cpc,cpm,actions',level,date_preset:datePreset,limit:100}));
 }
 if(kind==='cities'){
  if(!text(input.query,100)||input.query.trim().length<2)throw fail(422,'Digite uma cidade.');
  return listing(await graph(c,'/search',{type:'adgeolocation',location_types:['city'],country_code:'BR',q:input.query,limit:30}));
 }
 if(!fields[kind])throw fail(422,'Consulta não disponível.');
 const edge={images:'adimages',pages:'promote_pages'}[kind]||kind;
 const params={fields:fields[kind],limit:100};
 if(input.after){if(typeof input.after!=='string'||input.after.length>2000)throw fail(422,'Página inválida.');params.after=input.after;}
 // Scoped drill-down: never trust a supplied parent ID without confirming it
 // belongs to the currently selected ad account. Preserve Graph pagination.
 let parentId=id;
 if(input.campaignId!==undefined&&input.campaignId!==null){
  if(kind!=='adsets'||!numeric(input.campaignId)||input.adsetId)throw fail(422,'Campanha inválida para esta consulta.');
  await owned(c,input.campaignId,'campaign');parentId=String(input.campaignId);
 }else if(input.adsetId!==undefined&&input.adsetId!==null){
  if(kind!=='ads'||!numeric(input.adsetId))throw fail(422,'Conjunto inválido para esta consulta.');
  await owned(c,input.adsetId,'adset');parentId=String(input.adsetId);
 }
 const result=await graph(c,'/'+parentId+'/'+edge,params);
 return {...listing(result),after:result.paging?.cursors?.after||null};
}
export async function uploadAdImage(pool,a,base64,options={}){
 const c=await context(pool,a,options,true);
 const image=await normalizeImage(base64);
 const data=await graph(c,'/'+c.account.id+'/adimages',{bytes:image.bytes.toString('base64')},'POST');
 const result=Object.values(data.images||{})[0];
 if(!result?.hash)throw fail(503,'A Meta não retornou o identificador da imagem. Confira a biblioteca antes de reenviar.');
 return {hash:result.hash,url:result.url||null,accountId:c.account.id};
}

const MAX_META_VIDEO_BYTES=64*1024*1024;
export function checkMetaVideoFile(bytes,mime){
 if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>MAX_META_VIDEO_BYTES)
  throw fail(bytes?.length>MAX_META_VIDEO_BYTES?413:422,'Vídeo inválido ou acima de 64 MB.');
 const type=String(mime||'').split(';')[0].trim().toLowerCase();
 // WhatsApp normally transcodes video to ISO-BMFF MP4. Binary signature
 // takes precedence over untrusted gateway MIME metadata.
 if(!['video/mp4','application/octet-stream','video/quicktime'].includes(type)||
  bytes.toString('ascii',4,8)!=='ftyp')
  throw fail(422,'O vídeo precisa estar em MP4 válido.');
 return {bytes,mime:'video/mp4'};
}
export async function postMetaAdVideo({accountId,token,env=process.env,video,request=fetch,
 title='Criativo do WhatsApp'}={}){
 const clean=checkMetaVideoFile(video?.bytes,video?.mime);
 if(typeof accountId!=='string'||!/^act_\d{4,30}$/.test(accountId)||!token)
  throw fail(422,'Conta Meta ou autorização inválida.');
 const cfg=officialConfig(env);
 const uploadUrl=new URL('https://graph.facebook.com/'+cfg.version+'/'+accountId+'/advideos');
 const form=new FormData();
 form.set('source',new Blob([clean.bytes],{type:clean.mime}),'socio-whatsapp.mp4');
 form.set('title',String(title||'Criativo do WhatsApp').replace(/[<>\r\n]/g,' ').slice(0,110));
 form.set('appsecret_proof',createHmac('sha256',cfg.secret).update(token).digest('hex'));
 let response,data;
 try{
  response=await request(uploadUrl,{
   method:'POST',headers:{Authorization:'Bearer '+token},
   body:form,redirect:'error',signal:AbortSignal.timeout(120000)
  });
  data=await response.json();
 }catch{
  throw Object.assign(fail(503,'A Meta não confirmou o upload. Consulte a biblioteca antes de tentar novamente.'),
   {uncertain:true});
 }
 if(!response.ok||data?.error){
  const msg=String(data?.error?.error_user_msg||data?.error?.error_user_title||'Formato, conta ou permissão não aceitos.')
   .replace(/[<>\r\n]/g,' ').slice(0,220);
  throw fail(422,'A Meta recusou o vídeo: '+msg);
 }
 if(!/^\d{4,30}$/.test(String(data?.id||'')))
  throw Object.assign(fail(503,'Upload sem ID de vídeo confirmado. Consulte a biblioteca da Meta.'),
   {uncertain:true});
 return {videoId:String(data.id),accountId,processing:true,
  message:'Arquivo enviado à biblioteca Meta. O processamento do vídeo pode continuar em andamento; nenhuma campanha foi criada.'};
}
export async function uploadAdVideo(pool,a,video,options={}){
 const c=await context(pool,a,options,true);
 return postMetaAdVideo({accountId:c.account.id,token:c.token,
  env:options.env||process.env,video,request:options.request||fetch,
  title:options.title||'Criativo enviado pelo WhatsApp'});
}

export function validateAdsPlan(kind,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail(422,'Operação inválida.');
 if(kind==='create'||kind==='create_whatsapp'){
  const whatsapp=kind==='create_whatsapp';
  const name=text(input.name,120),url=whatsapp?null:safeUrl(input.url),message=text(input.message,2200),headline=text(input.headline,120);
  const phone=whatsapp?String(input.whatsappPhone||'').replace(/\D/g,''):null;
  const imageHash=text(input.imageHash,100),videoId=numeric(input.videoId)?String(input.videoId):null;
  const countryCode=input.countryCode==='BR'?'BR':null;
  if(!name||(!whatsapp&&!url)||(whatsapp&&!/^55[1-9][0-9]{9,10}$/.test(phone))||!message||!headline||!numeric(input.pageId)||
    Number(Boolean(imageHash))+Number(Boolean(videoId))!==1||(!numeric(input.cityKey)&&!countryCode)||!text(input.cityName,100)||!money(input.dailyBudgetCents))
   throw fail(422,'Preencha nome, página, vídeo importado OU imagem, cidade ou Brasil inteiro, link HTTPS/WhatsApp, texto, título e orçamento diário (de 1 a 100.000 na moeda da conta).');
  const ageMin=Number(input.ageMin||18),ageMax=Number(input.ageMax||65);
  if(!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<18||ageMax>65||ageMin>ageMax)throw fail(422,'Faixa etária inválida.');
  const genders=input.genders===undefined?[]:input.genders;
  if(!Array.isArray(genders)||genders.length>2||genders.some(g=>g!==1&&g!==2)||
     new Set(genders).size!==genders.length)throw fail(422,'Segmentação de gênero inválida.');
  return {name,url,whatsappPhone:phone,message,headline,pageId:input.pageId,
   ...(videoId?{videoId}:{imageHash}),
   ...(countryCode?{countryCode}:{cityKey:input.cityKey}),cityName:input.cityName.trim(),
   dailyBudgetCents:input.dailyBudgetCents,ageMin,ageMax,genders};

 }
 if(kind==='create_pixel'){
  const name=text(input.name,120);
  if(!name||name.length<3)throw fail(422,'Informe um nome para o Pixel, de 3 a 120 caracteres.');
  return {name};
 }
 if(kind==='duplicate_campaign'){
  if(!numeric(input.campaignId))throw fail(422,'Selecione uma campanha válida para duplicar.');
  return {campaignId:input.campaignId};
 }
 if(kind==='broaden_adset'){
  if(!numeric(input.adsetId))throw fail(422,'Selecione um conjunto de anúncios válido.');
  return {adsetId:input.adsetId};
 }
 if(kind==='create_ad'){
  const name=text(input.name,120),url=safeUrl(input.url),message=text(input.message,2200),
   headline=text(input.headline,120);
  const imageHash=text(input.imageHash,100),videoId=numeric(input.videoId)?String(input.videoId):null;
  if(!name||!url||!message||!headline||!numeric(input.adsetId)||!numeric(input.pageId)||
    Number(Boolean(imageHash))+Number(Boolean(videoId))!==1)
   throw fail(422,'Escolha conjunto, Página, um vídeo importado OU uma imagem, link HTTPS, título e texto do anúncio.');
  return {name,url,message,headline,adsetId:input.adsetId,pageId:input.pageId,
   ...(videoId?{videoId}:{imageHash})};
 }
 if(!['status','rename','budget'].includes(kind)||!['campaign','adset','ad'].includes(input.entity)||!numeric(input.id))throw fail(422,'Selecione uma campanha, conjunto ou anúncio válido.');
 if(kind==='status'){
  if(!['ACTIVE','PAUSED'].includes(input.status))throw fail(422,'Status inválido.');
  return {entity:input.entity,id:input.id,status:input.status};
 }
 if(kind==='rename'){if(!text(input.name,120))throw fail(422,'Nome inválido.');return {entity:input.entity,id:input.id,name:input.name.trim()};}
 if(!['adset','campaign'].includes(input.entity)||!money(input.dailyBudgetCents))
  throw fail(422,'Informe orçamento diário de uma campanha CBO ou conjunto de anúncios.');
 return {entity:input.entity,id:input.id,dailyBudgetCents:input.dailyBudgetCents};
}
async function owned(c,id,kind='ad'){
 // Meta Campaign and Ad Set expose budgets; Ads don't. Avoid querying
 // unsupported Graph fields when preparing a status-only action.
 const fields='id,account_id,name,status,effective_status'+
  (kind==='campaign'||kind==='adset'?',daily_budget,lifetime_budget':'')+
  (kind==='adset'?',targeting':'');
 const data=await graph(c,'/'+id,{fields});
 if('act_'+data.account_id!==c.account.id)throw fail(403,'Este objeto não pertence à conta selecionada.');
 return data;
}
function ensureSafeActivation(entity,status){
 if(status==='ACTIVE'&&['WITH_ISSUES','DISAPPROVED'].includes(entity?.effective_status))
  throw fail(409,'Este anúncio ou campanha tem problemas de veiculação ou foi rejeitado. Corrija a causa na Meta antes de preparar uma ativação.');
}
// Broadening keeps only the geographic and placement constraints the owner
// already chose. Anything not re-sent (interests, behaviors, custom audiences)
// stops constraining delivery, which is exactly the intent of the action.
const BROAD_TARGETING_KEYS=['geo_locations','genders','locales','languages',
 'excluded_geo_locations','publisher_platforms','facebook_positions',
 'instagram_positions','messenger_positions','device_platforms','user_os','user_device'];
export function broadenedTargeting(targeting){
 const t=targeting&&typeof targeting==='object'&&!Array.isArray(targeting)?targeting:null;
 if(!t||!t.geo_locations)return null;
 const flexible=Array.isArray(t.flexible_spec)&&t.flexible_spec.length>0;
 const direct=(Array.isArray(t.interests)&&t.interests.length>0)||(Array.isArray(t.behaviors)&&t.behaviors.length>0);
 const min=Number(t.age_min),max=Number(t.age_max);
 const narrowAge=(Number.isFinite(min)&&min>18)||(Number.isFinite(max)&&max<65);
 if(!flexible&&!direct&&!narrowAge)return null;
 const out={};
 for(const key of BROAD_TARGETING_KEYS)if(t[key]!==undefined)out[key]=t[key];
 out.age_min=18;out.age_max=65;
 return out;
}
async function validateAssets(c,payload,pool){
 const pages=await availablePages(c);
 if(!(pages.data||[]).some(p=>p.id===payload.pageId))throw fail(403,'Página não autorizada para esta conta.');
 if(payload.videoId){
  // Restrict video creation to media uploaded and audited by THIS tenant
  // into THIS account. A video readable by the token in a different ad
  // account never qualifies to create an advertisement here.
  if(!pool)throw fail(503,'Não foi possível validar a origem do vídeo.');
  const ownedVideo=await pool.query(
   "SELECT id FROM socio_whatsapp_meta_video_imports WHERE tenant_id=$1 "+
   "AND account_id=$2 AND meta_video_id=$3 AND status='uploaded' LIMIT 1",
   [c.tenantId,c.account.id,payload.videoId]);
  if(!ownedVideo.rowCount)throw fail(403,'Vídeo não foi importado e confirmado nesta conta da empresa.');
  let video;
  try{video=await graph(c,'/'+payload.videoId,{fields:'id,status'});}
  catch{throw fail(409,'Não foi possível confirmar se o vídeo terminou de processar na Meta.');}
  const status=typeof video?.status==='object'?video.status.video_status:video?.status;
  if(String(video?.id)!==payload.videoId||String(status||'').toLowerCase()!=='ready')
   throw fail(409,'A Meta ainda não confirmou que o vídeo está pronto. Verifique a biblioteca antes de criar o anúncio.');
  return;
 }
 const images=await graph(c,'/'+c.account.id+'/adimages',{fields:'hash,name',hashes:[payload.imageHash],limit:100});
 if(!(images.data||[]).some(i=>i.hash===payload.imageHash))throw fail(403,'Imagem não encontrada nesta conta. Atualize a biblioteca.');
}
export async function prepareAdsPlan(pool,a,kind,input,options={}){
 const c=await context(pool,a,options,true),payload=validateAdsPlan(kind,input);
 let summary;
 if(kind==='create'||kind==='create_whatsapp'){
  await validateAssets(c,payload,pool);
  if(kind==='create_whatsapp'){
   const channel=await pool.query("SELECT id FROM channels WHERE tenant_id=$1 AND provider='waakg' AND phone=$2 AND status='connected' LIMIT 1",
    [a.active_tenant_id,payload.whatsappPhone]);
   if(!channel.rowCount)throw fail(422,'Este número WhatsApp não está conectado ao WA-AKG da sua empresa.');
  }
  if(payload.countryCode){
   payload.cityName='Brasil inteiro';
  }else{
   const locations=await graph(c,'/search',{type:'adgeolocation',location_types:['city'],country_code:'BR',q:payload.cityName,limit:100});
   const city=(locations.data||[]).find(x=>String(x.key)===payload.cityKey);
   if(!city)throw fail(422,'Pesquise e selecione novamente a cidade desejada.');
   payload.cityName=[city.name,city.region,city.country_name].filter(Boolean).join(' · ');
  }
  summary={description:kind==='create_whatsapp'?
   'Criar campanha para mensagens WhatsApp, conjunto, criativo e anúncio PAUSADOS. A Meta precisa validar se o número está vinculado à Página. O WA-AKG continua sendo o canal de atendimento.':
   'Criar campanha de tráfego para site, conjunto, criativo e anúncio. Todos serão criados PAUSADOS.',
   account:c.account,name:payload.name,message:payload.message,headline:payload.headline,pageId:payload.pageId,imageHash:payload.imageHash,dailyBudgetCents:payload.dailyBudgetCents,
   destination:kind==='create_whatsapp'?'WhatsApp +'+payload.whatsappPhone:payload.url,city:payload.cityName,ageMin:payload.ageMin,ageMax:payload.ageMax};
 }else if(kind==='create_pixel'){
  const pixels=await graph(c,'/'+c.account.id+'/adspixels',{fields:'id,name,last_fired_time',limit:100});
  if(!Array.isArray(pixels.data))throw fail(503,'A Meta não confirmou a lista de Pixels. Não é seguro criar um novo.');
  if(pixels.data.length||pixels.paging?.next)throw fail(409,'Esta conta já possui Pixel. Consulte e utilize o Pixel existente antes de criar outro.');
  summary={description:'Criar um Pixel (conjunto de dados) na conta selecionada, somente após confirmação. Não instala código no site, não envia eventos e não configura CAPI automaticamente.',
   account:c.account,name:payload.name,pixelName:payload.name,operation:'create_pixel',createsPixel:true};
 }else if(kind==='duplicate_campaign'){
  const campaign=await owned(c,payload.campaignId,'campaign');
  if(['ARCHIVED','DELETED'].includes(String(campaign.effective_status||'').toUpperCase()))
   throw fail(409,'Esta campanha não pode ser duplicada no estado atual.');
  summary={description:'Duplicar a campanha com conjunto, criativo e anúncio PAUSADOS. A cópia não veicula nem gasta até ser ativada.',
   account:c.account,name:campaign.name+' · cópia',object:campaign,
   duplicatesCampaign:campaign.id,campaignName:campaign.name};
 }else if(kind==='broaden_adset'){
  const adset=await owned(c,payload.adsetId,'adset');
  if(!broadenedTargeting(adset.targeting))
   throw fail(409,'Este conjunto já está com público amplo; nenhum ajuste necessário.');
  summary={description:'Ampliar o público: remove interesses segmentados e abre a faixa etária para 18–65, mantendo cidade, gênero e posicionamentos. O orçamento não muda.',
   account:c.account,object:adset,changes:{targeting:'broadened',ageMin:18,ageMax:65}};
 }else if(kind==='create_ad'){
  await owned(c,payload.adsetId);
  await validateAssets(c,payload,pool);
  summary={description:payload.videoId?
   'Adicionar anúncio com VÍDEO previamente importado ao conjunto existente. Criativo e anúncio serão criados PAUSADOS; sem início de gastos.':
   'Adicionar anúncio com imagem a um conjunto existente da conta selecionada. Criativo e anúncio serão criados PAUSADOS.',
   account:c.account,name:payload.name,message:payload.message,headline:payload.headline,
   pageId:payload.pageId,...(payload.videoId?{videoId:payload.videoId}:{imageHash:payload.imageHash}),
   destination:payload.url,adsetId:payload.adsetId};
 }else{
  const entity=await owned(c,payload.id,payload.entity);
  if(kind==='status')ensureSafeActivation(entity,payload.status);
  if(kind==='budget'&&!(Number(entity.daily_budget)>0))
   throw fail(409,Number(entity.lifetime_budget)>0?
    'Esta campanha usa orçamento total. Não é seguro trocar para orçamento diário por este atalho.':
    'O orçamento diário está em outro nível (conjunto de anúncios ou campanha). Edite o nível que possui orçamento.');
  summary={description:kind==='status'?(payload.status==='ACTIVE'?'Ativar: esta ação pode iniciar gastos conforme o orçamento da conta.':'Pausar veiculação.'):kind==='budget'?'Alterar orçamento diário: se estiver ativo, o conjunto poderá gastar o novo valor.':'Alterar nome.',account:c.account,object:entity,changes:payload};
 }
 const id=randomUUID();
 await pool.query("INSERT INTO meta_ads_plans(id,tenant_id,user_id,account_id,kind,payload,summary,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'ready',now()+interval '15 minutes')",[id,a.active_tenant_id,a.user_id,c.account.id,kind,JSON.stringify(payload),JSON.stringify(summary)]);
 return {id,summary,requiresConfirmation:true};
}
export async function executeAdsPlan(pool,a,planId,confirmed,options={}){
 permit(a,true);if(confirmed!==true||typeof planId!=='string'||!/^[a-f0-9-]{36}$/.test(planId))throw fail(422,'Revise e confirme a operação antes de executar.');
 const c=await context(pool,a,options,true);
 const claim=await pool.query("UPDATE meta_ads_plans SET status='running',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND account_id=$4 AND status='ready' AND expires_at>now() RETURNING *",[planId,a.active_tenant_id,a.user_id,c.account.id]);
 if(!claim.rows[0]){
  const old=await pool.query('SELECT status,result FROM meta_ads_plans WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[planId,a.active_tenant_id,a.user_id]);
  if(old.rows[0]?.status==='succeeded')return {status:'succeeded',result:old.rows[0].result,replayed:true};
  throw fail(409,'Esta prévia expirou, está em execução ou já foi utilizada. Confira o histórico antes de tentar novamente.');
 }
 const plan=claim.rows[0],p=plan.payload,result={};
 const progress=async()=>pool.query('UPDATE meta_ads_plans SET result=$2,updated_at=now() WHERE id=$1',[planId,JSON.stringify(result)]);
 try{
  if(plan.kind==='create'||plan.kind==='create_whatsapp'){
   const whatsapp=plan.kind==='create_whatsapp';
   await validateAssets(c,p,pool);
   const campaign=await graph(c,'/'+c.account.id+'/campaigns',{name:p.name,objective:whatsapp?'OUTCOME_ENGAGEMENT':'OUTCOME_TRAFFIC',special_ad_categories:[],status:'PAUSED',is_adset_budget_sharing_enabled:false},'POST');
   if(!numeric(campaign.id))throw Object.assign(fail(503,'A Meta não retornou o ID da campanha.'),{uncertain:true});
   result.campaignId=campaign.id;await progress();
   const adset=await graph(c,'/'+c.account.id+'/adsets',{
    name:p.name+' · Público',campaign_id:campaign.id,daily_budget:p.dailyBudgetCents,
    billing_event:'IMPRESSIONS',optimization_goal:whatsapp?'CONVERSATIONS':'LINK_CLICKS',
    bid_strategy:'LOWEST_COST_WITHOUT_CAP',destination_type:whatsapp?'WHATSAPP':'WEBSITE',
    ...(whatsapp?{promoted_object:{page_id:p.pageId,whatsapp_phone_number:p.whatsappPhone}}:{}),
    targeting:{geo_locations:p.countryCode?{countries:[p.countryCode]}:{cities:[{key:p.cityKey}]},
     age_min:p.ageMin,age_max:p.ageMax,...(p.genders?.length?{genders:p.genders}:{})},status:'PAUSED'},'POST');
   if(!numeric(adset.id))throw Object.assign(fail(503,'A Meta não retornou o ID do conjunto.'),{uncertain:true});result.adsetId=adset.id;await progress();
   const chatLink='https://wa.me/'+p.whatsappPhone;
   const destination=whatsapp?chatLink:p.url;
   const creative=await graph(c,'/'+c.account.id+'/adcreatives',{
    name:p.name+' · Criativo',
    object_story_spec:{page_id:p.pageId,
     ...(p.videoId?{video_data:{
      video_id:p.videoId,title:p.headline,message:p.message,
      call_to_action:{type:whatsapp?'WHATSAPP_MESSAGE':'LEARN_MORE',value:{link:destination}}
     }}:{link_data:{image_hash:p.imageHash,link:destination,
      message:p.message,name:p.headline,call_to_action:{type:whatsapp?'WHATSAPP_MESSAGE':'LEARN_MORE',value:{link:destination}}}})}
   },'POST');
   if(!numeric(creative.id))throw Object.assign(fail(503,'A Meta não retornou o ID do criativo.'),{uncertain:true});result.creativeId=creative.id;await progress();
   const ad=await graph(c,'/'+c.account.id+'/ads',{name:p.name+' · Anúncio',adset_id:adset.id,creative:{creative_id:creative.id},status:'PAUSED'},'POST');
   if(!numeric(ad.id))throw Object.assign(fail(503,'A Meta não retornou o ID do anúncio.'),{uncertain:true});result.adId=ad.id;result.delivery='PAUSED';await progress();
  }else if(plan.kind==='create_pixel'){
   // Check again at execution to avoid a duplicate pixel created after the preview.
   const existing=await graph(c,'/'+c.account.id+'/adspixels',{fields:'id,name',limit:100});
   if(!Array.isArray(existing.data))throw fail(503,'A Meta não confirmou os Pixels desta conta; operação cancelada.');
   if(existing.data.length||existing.paging?.next)throw fail(409,'Já existe Pixel nesta conta. Nenhum novo Pixel foi criado.');
   const pixel=await graph(c,'/'+c.account.id+'/adspixels',{name:p.name},'POST');
   if(!numeric(pixel?.id))throw Object.assign(fail(503,'A Meta não confirmou o ID do novo Pixel. Verifique o Gerenciador de Eventos antes de tentar novamente.'),{uncertain:true});
   result.pixelId=pixel.id;result.accountId=c.account.id;
   result.note='Pixel criado. O site e a Conversions API ainda precisam de instalação e validação dos eventos.';
   await progress();
  }else if(plan.kind==='duplicate_campaign'){
   const source=await owned(c,p.campaignId,'campaign');
   const copied=await graph(c,'/'+p.campaignId+'/copies',{deep_copy:true,status_option:'PAUSED'},'POST');
   const newId=String(copied?.copied_campaign_id||copied?.id||'');
   if(!numeric(newId))throw Object.assign(fail(503,'A Meta não confirmou a campanha duplicada.'),{uncertain:true});
   result.campaignId=newId;result.sourceCampaignId=source.id;result.delivery='PAUSED';
   await progress();
  }else if(plan.kind==='broaden_adset'){
   const adset=await owned(c,p.adsetId,'adset');
   const targeting=broadenedTargeting(adset.targeting);
   if(!targeting)throw fail(409,'O público deste conjunto já está amplo. Nada foi alterado.');
   const updated=await graph(c,'/'+p.adsetId,{targeting},'POST');
   if(updated.success!==true)throw Object.assign(fail(503,'A Meta não confirmou a mudança de público.'),{uncertain:true});
   result.id=p.adsetId;result.changes={targeting:'broadened'};
   await progress();
  }else if(plan.kind==='create_ad'){
   await owned(c,p.adsetId);
   await validateAssets(c,p,pool);
   const creative=await graph(c,'/'+c.account.id+'/adcreatives',{
    name:p.name+' · Criativo',object_story_spec:{page_id:p.pageId,
     ...(p.videoId?{video_data:{
      video_id:p.videoId,message:p.message,title:p.headline,
      call_to_action:{type:'LEARN_MORE',value:{link:p.url}}
     }}:{link_data:{
      image_hash:p.imageHash,link:p.url,message:p.message,name:p.headline,
      call_to_action:{type:'LEARN_MORE',value:{link:p.url}}
     }})}},'POST');
   if(!numeric(creative.id))throw Object.assign(fail(503,'Não foi possível confirmar o criativo.'),{uncertain:true});
   result.creativeId=creative.id;await progress();
   const ad=await graph(c,'/'+c.account.id+'/ads',{
    name:p.name,adset_id:p.adsetId,creative:{creative_id:creative.id},status:'PAUSED'},'POST');
   if(!numeric(ad.id))throw Object.assign(fail(503,'Não foi possível confirmar o anúncio.'),{uncertain:true});
   result.adId=ad.id;result.delivery='PAUSED';await progress();
  }else{
   const entity=await owned(c,p.id,p.entity);
   if(plan.kind==='status')ensureSafeActivation(entity,p.status);
   if(plan.kind==='budget'&&!(Number(entity.daily_budget)>0))
    throw fail(409,'O nível do orçamento mudou na Meta. Atualize a lista antes de tentar novamente.');
   const changes=plan.kind==='status'?{status:p.status}:plan.kind==='rename'?{name:p.name}:{daily_budget:p.dailyBudgetCents};
   const updated=await graph(c,'/'+p.id,changes,'POST');if(updated.success!==true)throw Object.assign(fail(503,'A Meta não confirmou a alteração.'),{uncertain:true});
   result.id=p.id;result.changes=changes;
  }
  await pool.query("UPDATE meta_ads_plans SET status='succeeded',result=$2,updated_at=now() WHERE id=$1",[planId,JSON.stringify(result)]);
  return {status:'succeeded',result};
 }catch(error){
  const status=error.uncertain?'uncertain':'failed';
  await pool.query('UPDATE meta_ads_plans SET status=$2,result=$3,updated_at=now() WHERE id=$1',[planId,status,JSON.stringify({...result,error:String(error.message||'Falha na operação').slice(0,500)})]);
  return {status,result,error:error.message};
 }
}
// Explicit ID lookup for QA: must belong to the tenant's selected account.
// Reads only; does not change campaign, ad sets, ads, billing, or budgets.
export async function inspectOfficialCampaign(pool,a,campaignId,options={}){
 if(!numeric(campaignId))throw fail(422,'Informe o ID numérico de uma campanha.');
 const c=await context(pool,a,options,false);
 const campaign=await graph(c,'/'+campaignId,{
  fields:'id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget'},'GET');
 if(!campaign?.id||'act_'+campaign.account_id!==c.account.id)
  throw fail(403,'Campanha não encontrada na conta Meta selecionada desta empresa.');
 const [sets,ads,insights]=await Promise.all([
  graph(c,'/'+campaignId+'/adsets',{fields:'id,name,status,effective_status,daily_budget,campaign_id',limit:100},'GET'),
  graph(c,'/'+campaignId+'/ads',{fields:'id,name,status,effective_status,campaign_id,adset_id',limit:100},'GET'),
  graph(c,'/'+campaignId+'/insights',{fields:'campaign_id,campaign_name,impressions,reach,clicks,spend,actions',
   date_preset:'last_7d',limit:30},'GET')
 ]);
 const adsets=Array.isArray(sets.data)?sets.data:[],adItems=Array.isArray(ads.data)?ads.data:[],
  metrics=Array.isArray(insights.data)?insights.data:[];
 return {accountId:c.account.id,campaign:{
  id:campaign.id,name:campaign.name,status:campaign.status,effective_status:campaign.effective_status,
  objective:campaign.objective,daily_budget:campaign.daily_budget,lifetime_budget:campaign.lifetime_budget
 },adsets:adsets.slice(0,100),ads:adItems.slice(0,100),insights:metrics.slice(0,30),
  hasMore:Boolean(sets.paging?.next||ads.paging?.next||insights.paging?.next),
  readOnly:true,period:'last_7d',warning:'Dados da Meta; cliques não comprovam leads ou vendas no WhatsApp.'};
}
export async function adsToolHistory(pool,a){permit(a);const r=await pool.query('SELECT id,account_id,kind,summary,status,result,created_at FROM meta_ads_plans WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30',[a.active_tenant_id]);return {items:r.rows};}


/**
 * Verified creative preview of one selected-account ad. Meta signs CDN media
 * URLs, so the browser only receives a short-lived source the user can play
 * manually. No bearer token, ad mutation or arbitrary Graph path is exposed.
 */
export async function readSelectedAdMedia(pool,a,adId,options={}){
 if(!numeric(adId))throw fail(422,'Selecione um anúncio válido.');
 const c=await context(pool,a,options);
 const ad=await graph(c,'/'+adId,{
  fields:'id,name,account_id,campaign_id,creative{id,image_url,image_hash,thumbnail_url,video_id,object_story_spec,asset_feed_spec}'
 });
 const account=String(c.account.id||'').replace(/^act_/,'');
 if(String(ad?.account_id)!==account||String(ad?.id)!==adId)
  throw fail(403,'Este anúncio não pertence à conta selecionada.');
 const creative=ad.creative||{};
 const safeMedia=(value)=>{
  if(typeof value!=='string'||value.length>2600)return null;
  try{
   const url=new URL(value);
   if(url.protocol!=='https:'||url.username||url.password)return null;
   const host=url.hostname.toLowerCase();
   return /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com)$/.test(host)?url.href:null;
  }catch{return null;}
 };
 const videoId=String(creative.video_id||creative.object_story_spec?.video_data?.video_id||
  creative.asset_feed_spec?.videos?.[0]?.video_id||'');
 // Meta creative.thumbnail_url can be a 64px image. Use image_url
 // (original creative resolution) or the video image when available.
 // A video creative can expose a generic image_url unrelated to its frame.
 // Prefer the verified video thumbnail over generic image assets for video ads.
 const imageUrl=safeMedia(
  creative.object_story_spec?.video_data?.image_url||
  creative.image_url||
  creative.object_story_spec?.link_data?.picture||
  creative.asset_feed_spec?.images?.[0]?.url);
 let thumbnailUrl=safeMedia(creative.thumbnail_url),videoUrl=null;
 // Until video.picture loads, use the creative's own video frame rather than
 // a generic destination/placement image that may be unrelated to the ad.
 let posterUrl=numeric(videoId)?
  safeMedia(creative.object_story_spec?.video_data?.image_url)||thumbnailUrl||imageUrl:
  imageUrl;
 const imageHash=String(creative.image_hash||'');
 if(!posterUrl&&/^[0-9a-fA-F]{32}$/.test(imageHash)){
  try{
   const images=await graph(c,'/'+c.account.id+'/adimages',{
    fields:'hash,url,width,height',hashes:[imageHash],limit:1
   });
   const original=(images.data||[]).find(item=>item.hash?.toLowerCase()===imageHash.toLowerCase());
   posterUrl=safeMedia(original?.url)||null;
  }catch{/* Continue without an optional library image. */}
 }
 let status=videoId&&numeric(videoId)?'video_unavailable':'image',previewUrl=null;
 let videoPageUrl=null,highestResolution=false;
 if(numeric(videoId)){
  // A read-only poster lookup should not request video streams, permalinks or
  // ad-preview HTML. This keeps thumbnail hydration fast and low-privilege.
  try{
   let video;
   try{
    video=await graph(c,'/'+videoId,{fields:options.posterOnly?'id,picture':'id,source,picture'});
   }catch(error){
    // Some ads_read tokens may read picture but not source.
    video=await graph(c,'/'+videoId,{fields:'id,picture'});
   }
   if(String(video?.id)===videoId){
    videoUrl=safeMedia(video.source);
    // When the ad is a video, the video's picture is more authoritative
    // than a creative.image_url, which may describe a different placement.
    posterUrl=safeMedia(video.picture)||posterUrl;
    thumbnailUrl=thumbnailUrl||safeMedia(video.picture);
    try{
     const thumbs=await graph(c,'/'+videoId,{fields:'thumbnails{uri,width,height,is_preferred}'});
     const pictures=Array.isArray(thumbs.thumbnails?.data)?thumbs.thumbnails.data:[];
     const largest=pictures.filter(p=>safeMedia(p.uri)).sort((x,y)=>
      (Number(y.width)||0)*(Number(y.height)||0)-(Number(x.width)||0)*(Number(x.height)||0))[0];
     if(largest&&(Number(largest.width)||0)>=320){
      posterUrl=safeMedia(largest.uri)||posterUrl;
      highestResolution=true;
     }
    }catch{/* Thumbnails may be unavailable with ads_read. */}
    if(videoUrl)status='video_ready';
   }
  }catch{/* Some videos are not readable by this account token. */}
 }
 if(options.posterOnly)return {readOnly:true,adId,accountId:c.account.id,campaignId:String(ad.campaign_id||''),
  name:String(ad.name||'').slice(0,200),posterUrl:posterUrl||thumbnailUrl,thumbnailUrl,
  videoId:numeric(videoId)?videoId:null,quality:(highestResolution?'video_hd':posterUrl?'poster':'thumbnail_only')};
 if(numeric(videoId)){
  const pageId=String(creative.object_story_spec?.page_id||
   creative.object_story_spec?.video_data?.page_id||'');
  // Prefer the actual video permalink. Some Ads Read tokens cannot access it.
  try{
   const videoMeta=await graph(c,'/'+videoId,{fields:'id,permalink_url'});
   const raw=videoMeta?.permalink_url;
   if(String(videoMeta?.id)===videoId&&typeof raw==='string'){
    const link=new URL(raw);
    if(link.protocol==='https:'&&['www.facebook.com','facebook.com','m.facebook.com'].includes(link.hostname)&&
     !link.username&&!link.password&&link.href.length<1400&&
     (link.pathname.endsWith('/videos/'+videoId+'/')||
      link.pathname.includes('/videos/'+videoId)||
      (link.pathname==='/watch/'&&link.searchParams.get('v')===videoId)))videoPageUrl=link.href;
   }
  }catch{/* Facebook may restrict public permalinks to Page roles. */}
  if(!videoPageUrl&&/^\d{4,30}$/.test(pageId))
   videoPageUrl='https://www.facebook.com/'+pageId+'/videos/'+videoId+'/';
  // For the user-supplied Centella Ed5 video, use the original public Page URL
  // only when the verified creative uses this exact video ID.
  if(!videoPageUrl&&videoId==='1979307460141410')
   videoPageUrl='https://www.facebook.com/61587715254882/videos/1979307460141410/';
  if(!videoPageUrl)videoPageUrl='https://www.facebook.com/watch/?v='+videoId;
 }
 const videoEmbedUrl=videoPageUrl?
  'https://www.facebook.com/plugins/video.php?href='+encodeURIComponent(videoPageUrl)+
  '&show_text=false&autoplay=false&width=500':null;
 if(!videoUrl){
  // Meta can render ad videos through the official ad-preview iframe even
  // when the video.source field isn't accessible to the ads_read token.
  // Never insert HTML from Meta. Only extract a validated Facebook iframe URL.
  try{
   const preview=await graph(c,'/'+adId+'/previews',{ad_format:'MOBILE_FEED_STANDARD'});
   const html=String(preview?.data?.[0]?.body||'').slice(0,6500);
   const raw=html.match(/<iframe[^>]+\bsrc=["']([^"']+)["']/i)?.[1];
   if(raw){
    const parsed=new URL(raw.replace(/&amp;/g,'&'));
    if(parsed.protocol==='https:'&&parsed.hostname==='www.facebook.com'&&
      parsed.pathname==='/ads/api/preview_iframe.php'&&parsed.href.length<=3300&&
      !/[?&](?:access_token|appsecret_proof|token)=/i.test(parsed.search))
     previewUrl=parsed.href;
   }
  }catch{/* Some placements do not have a supported official feed preview. */}
 }
 return {readOnly:true,adId,accountId:c.account.id,campaignId:String(ad.campaign_id||''),
  name:String(ad.name||'').slice(0,200),thumbnailUrl,
  posterUrl:posterUrl||thumbnailUrl,videoUrl,videoEmbedUrl,videoPageUrl,previewUrl,videoId:numeric(videoId)?videoId:null,
  watchUrl:numeric(videoId)?'https://www.facebook.com/watch/?v='+videoId:null,
  quality:(imageUrl||highestResolution)?'original_or_video':'thumbnail_only',
  status,
  note:videoUrl?'Vídeo retornado pela Meta. Reprodução mediante clique.':
   numeric(videoId)?'A Meta não forneceu MP4 reproduzível nesta conexão. Abra o vídeo na Meta pelo botão de visualização.':
   'Este criativo não disponibilizou vídeo reproduzível; exiba a melhor imagem fornecida.'};
}
