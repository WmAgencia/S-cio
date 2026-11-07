// Account-bound tools for the official Marketing API. Writes require a saved,
// reviewed plan. An uncertain POST is never automatically retried.
import {randomUUID,createHmac} from 'node:crypto';
import {officialConfig,resolveSelectedOfficialAccount} from './meta-official.mjs';
import {openMarketingSecret} from './marketing-integrations.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {normalizeImage} from './media-storage.mjs';
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
 return {account,token:secret.token,options};
}
async function graph(c,path,params={},method='GET'){
 if(!/^\/(act_\d+|\d+|search)(\/(campaigns|adsets|ads|adcreatives|adimages|adspixels|insights|promote_pages|previews))?$/.test(path))throw fail(422,'Operação Meta inválida.');
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
export async function readAdsTool(pool,a,kind,input={},options={}){
 const c=await context(pool,a,options),id=c.account.id;
 const fields={campaigns:'id,name,status,effective_status,objective,daily_budget,lifetime_budget',adsets:'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting',ads:'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,image_url,thumbnail_url,video_id,object_story_spec}',images:'hash,name,url,width,height',pages:'id,name'};
 if(kind==='finance'){
  const data=await graph(c,'/'+id,{fields:'id,name,currency,amount_spent,spend_cap,account_status,business{id}'});
  const billing=new URL('https://adsmanager.facebook.com/billing_hub/payment_settings/');
  billing.searchParams.set('asset_id',id.slice(4));billing.searchParams.set('payment_account_id_from_jsmodule',id.slice(4));billing.searchParams.set('placement','ads_manager');
  if(numeric(data.business?.id))billing.searchParams.set('business_id',data.business.id);
  return {account:data,paymentsUrl:billing.href,manualPayment:true};
 }
 if(kind==='pages')return listing(await availablePages(c));
 if(kind==='insights'){
  const datePreset=['today','yesterday','last_7d','last_30d'].includes(input.period)?input.period:'last_7d';
  return listing(await graph(c,'/'+id+'/insights',{fields:'campaign_id,campaign_name,impressions,reach,clicks,spend,actions',level:'campaign',date_preset:datePreset,limit:100}));
 }
 if(kind==='cities'){
  if(!text(input.query,100)||input.query.trim().length<2)throw fail(422,'Digite uma cidade.');
  return listing(await graph(c,'/search',{type:'adgeolocation',location_types:['city'],country_code:'BR',q:input.query,limit:30}));
 }
 if(!fields[kind])throw fail(422,'Consulta não disponível.');
 const edge={images:'adimages',pages:'promote_pages'}[kind]||kind;
 const params={fields:fields[kind],limit:100};
 if(input.after){if(typeof input.after!=='string'||input.after.length>2000)throw fail(422,'Página inválida.');params.after=input.after;}
 const result=await graph(c,'/'+id+'/'+edge,params);
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
export function validateAdsPlan(kind,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail(422,'Operação inválida.');
 if(kind==='create'||kind==='create_whatsapp'){
  const whatsapp=kind==='create_whatsapp';
  const name=text(input.name,120),url=whatsapp?null:safeUrl(input.url),message=text(input.message,2200),headline=text(input.headline,120);
  const phone=whatsapp?String(input.whatsappPhone||'').replace(/\D/g,''):null;
  if(!name||(!whatsapp&&!url)||(whatsapp&&!/^55[1-9][0-9]{9,10}$/.test(phone))||!message||!headline||!numeric(input.pageId)||!text(input.imageHash,100)||!numeric(input.cityKey)||!text(input.cityName,100)||!money(input.dailyBudgetCents))throw fail(422,'Preencha nome, página, imagem, cidade, link HTTPS, texto, título e orçamento diário (de 1 a 100.000 na moeda da conta).');
  const ageMin=Number(input.ageMin||18),ageMax=Number(input.ageMax||65);
  if(!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<18||ageMax>65||ageMin>ageMax)throw fail(422,'Faixa etária inválida.');
  const genders=input.genders===undefined?[]:input.genders;
  if(!Array.isArray(genders)||genders.length>2||genders.some(g=>g!==1&&g!==2)||
     new Set(genders).size!==genders.length)throw fail(422,'Segmentação de gênero inválida.');
  return {name,url,whatsappPhone:phone,message,headline,pageId:input.pageId,imageHash:input.imageHash,
   cityKey:input.cityKey,cityName:input.cityName.trim(),dailyBudgetCents:input.dailyBudgetCents,ageMin,ageMax,genders};

 }
 if(kind==='create_pixel'){
  const name=text(input.name,120);
  if(!name||name.length<3)throw fail(422,'Informe um nome para o Pixel, de 3 a 120 caracteres.');
  return {name};
 }
 if(kind==='create_ad'){
  const name=text(input.name,120),url=safeUrl(input.url),message=text(input.message,2200),
   headline=text(input.headline,120);
  if(!name||!url||!message||!headline||!numeric(input.adsetId)||
   !numeric(input.pageId)||!text(input.imageHash,100))
   throw fail(422,'Escolha conjunto, página, imagem, link HTTPS, título e texto para o novo anúncio.');
  return {name,url,message,headline,adsetId:input.adsetId,pageId:input.pageId,imageHash:input.imageHash};
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
async function owned(c,id){
 const data=await graph(c,'/'+id,{fields:'id,account_id,name,status,effective_status'});
 if('act_'+data.account_id!==c.account.id)throw fail(403,'Este objeto não pertence à conta selecionada.');
 return data;
}
function ensureSafeActivation(entity,status){
 if(status==='ACTIVE'&&['WITH_ISSUES','DISAPPROVED'].includes(entity?.effective_status))
  throw fail(409,'Este anúncio ou campanha tem problemas de veiculação ou foi rejeitado. Corrija a causa na Meta antes de preparar uma ativação.');
}
async function validateAssets(c,payload){
 const pages=await availablePages(c);
 if(!(pages.data||[]).some(p=>p.id===payload.pageId))throw fail(403,'Página não autorizada para esta conta.');
 const images=await graph(c,'/'+c.account.id+'/adimages',{fields:'hash,name',hashes:[payload.imageHash],limit:100});
 if(!(images.data||[]).some(i=>i.hash===payload.imageHash))throw fail(403,'Imagem não encontrada nesta conta. Atualize a biblioteca.');
}
export async function prepareAdsPlan(pool,a,kind,input,options={}){
 const c=await context(pool,a,options,true),payload=validateAdsPlan(kind,input);
 let summary;
 if(kind==='create'||kind==='create_whatsapp'){
  await validateAssets(c,payload);
  if(kind==='create_whatsapp'){
   const channel=await pool.query("SELECT id FROM channels WHERE tenant_id=$1 AND provider='waakg' AND phone=$2 AND status='connected' LIMIT 1",
    [a.active_tenant_id,payload.whatsappPhone]);
   if(!channel.rowCount)throw fail(422,'Este número WhatsApp não está conectado ao WA-AKG da sua empresa.');
  }
  const locations=await graph(c,'/search',{type:'adgeolocation',location_types:['city'],country_code:'BR',q:payload.cityName,limit:100});
  const city=(locations.data||[]).find(x=>String(x.key)===payload.cityKey);
  if(!city)throw fail(422,'Pesquise e selecione novamente a cidade desejada.');
  payload.cityName=[city.name,city.region,city.country_name].filter(Boolean).join(' · ');
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
 }else if(kind==='create_ad'){
  await owned(c,payload.adsetId);
  await validateAssets(c,payload);
  summary={description:'Adicionar anúncio com imagem a um conjunto existente da conta selecionada. Criativo e anúncio serão criados PAUSADOS.',
   account:c.account,name:payload.name,message:payload.message,headline:payload.headline,
   pageId:payload.pageId,imageHash:payload.imageHash,destination:payload.url,adsetId:payload.adsetId};
 }else{
  const entity=await owned(c,payload.id);
  if(kind==='status')ensureSafeActivation(entity,payload.status);
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
   await validateAssets(c,p);
   const campaign=await graph(c,'/'+c.account.id+'/campaigns',{name:p.name,objective:whatsapp?'OUTCOME_ENGAGEMENT':'OUTCOME_TRAFFIC',special_ad_categories:[],status:'PAUSED',is_adset_budget_sharing_enabled:false},'POST');
   if(!numeric(campaign.id))throw Object.assign(fail(503,'A Meta não retornou o ID da campanha.'),{uncertain:true});
   result.campaignId=campaign.id;await progress();
   const adset=await graph(c,'/'+c.account.id+'/adsets',{
    name:p.name+' · Público',campaign_id:campaign.id,daily_budget:p.dailyBudgetCents,
    billing_event:'IMPRESSIONS',optimization_goal:whatsapp?'CONVERSATIONS':'LINK_CLICKS',
    bid_strategy:'LOWEST_COST_WITHOUT_CAP',destination_type:whatsapp?'WHATSAPP':'WEBSITE',
    ...(whatsapp?{promoted_object:{page_id:p.pageId,whatsapp_phone_number:p.whatsappPhone}}:{}),
    targeting:{geo_locations:{cities:[{key:p.cityKey}]},age_min:p.ageMin,age_max:p.ageMax,...(p.genders?.length?{genders:p.genders}:{})},status:'PAUSED'},'POST');
   if(!numeric(adset.id))throw Object.assign(fail(503,'A Meta não retornou o ID do conjunto.'),{uncertain:true});result.adsetId=adset.id;await progress();
   const chatLink='https://wa.me/'+p.whatsappPhone;
   const destination=whatsapp?chatLink:p.url;
   const creative=await graph(c,'/'+c.account.id+'/adcreatives',{
    name:p.name+' · Criativo',
    object_story_spec:{page_id:p.pageId,link_data:{image_hash:p.imageHash,link:destination,
     message:p.message,name:p.headline,call_to_action:{type:whatsapp?'WHATSAPP_MESSAGE':'LEARN_MORE',value:{link:destination}}}}
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
  }else if(plan.kind==='create_ad'){
   await owned(c,p.adsetId);
   await validateAssets(c,p);
   const creative=await graph(c,'/'+c.account.id+'/adcreatives',{
    name:p.name+' · Criativo',object_story_spec:{page_id:p.pageId,link_data:{
     image_hash:p.imageHash,link:p.url,message:p.message,name:p.headline,
     call_to_action:{type:'LEARN_MORE',value:{link:p.url}}}}},'POST');
   if(!numeric(creative.id))throw Object.assign(fail(503,'Não foi possível confirmar o criativo.'),{uncertain:true});
   result.creativeId=creative.id;await progress();
   const ad=await graph(c,'/'+c.account.id+'/ads',{
    name:p.name,adset_id:p.adsetId,creative:{creative_id:creative.id},status:'PAUSED'},'POST');
   if(!numeric(ad.id))throw Object.assign(fail(503,'Não foi possível confirmar o anúncio.'),{uncertain:true});
   result.adId=ad.id;result.delivery='PAUSED';await progress();
  }else{
   const entity=await owned(c,p.id);
   if(plan.kind==='status')ensureSafeActivation(entity,p.status);
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
 const imageUrl=safeMedia(creative.image_url||
  creative.object_story_spec?.video_data?.image_url||
  creative.object_story_spec?.link_data?.picture||
  creative.asset_feed_spec?.images?.[0]?.url);
 let thumbnailUrl=safeMedia(creative.thumbnail_url),videoUrl=null;
 let posterUrl=imageUrl;
 const imageHash=String(creative.image_hash||'');
 if(!posterUrl&&/^[0-9a-fA-F]{32}$/.test(imageHash)){
  try{
   const images=await graph(c,'/'+c.account.id+'/adimages',{
    fields:'hash,url,width,height',hashes:[imageHash],limit:1
   });
   const original=(images.data||[]).find(item=>item.hash?.toLowerCase()===imageHash.toLowerCase());
   posterUrl=safeMedia(original?.url)||null;
  }catch{/* Continue with safe thumbnail if account image library is unavailable. */}
 }
 let status=videoId&&numeric(videoId)?'video_unavailable':'image',previewUrl=null;
 if(numeric(videoId)){
  try{
   const video=await graph(c,'/'+videoId,{fields:'id,source,picture'});
   if(String(video.id)===videoId){
    videoUrl=safeMedia(video.source);
    posterUrl=posterUrl||safeMedia(video.picture);
    thumbnailUrl=thumbnailUrl||safeMedia(video.picture);
    // Separate optional lookup: a thumbnails permission failure must not
    // discard an otherwise playable video stream.
    if(!imageUrl){
     try{
      const thumbs=await graph(c,'/'+videoId,{fields:'thumbnails{uri,width,height,is_preferred}'});
      const pictures=Array.isArray(thumbs.thumbnails?.data)?thumbs.thumbnails.data:[];
      const largest=pictures.filter(t=>safeMedia(t.uri)).sort((a,b)=>
       (Number(b.width)||0)*(Number(b.height)||0)-(Number(a.width)||0)*(Number(a.height)||0))[0];
      if(largest&&(Number(largest.width)||0)>=320)posterUrl=safeMedia(largest.uri)||posterUrl;
     }catch{/* Optional high-resolution asset unavailable to this token. */}
    }
    if(videoUrl)status='video_ready';
   }
  }catch{/* Some placements do not expose a stream even with ads_read. */}
 }
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
  posterUrl:posterUrl||thumbnailUrl,videoUrl,previewUrl,videoId:numeric(videoId)?videoId:null,
  watchUrl:numeric(videoId)?'https://www.facebook.com/watch/?v='+videoId:null,
  quality:posterUrl?'original_or_video':'thumbnail_only',
  status,
  note:videoUrl?'Vídeo retornado pela Meta. Reprodução mediante clique.':
   numeric(videoId)?'A Meta não forneceu MP4 reproduzível nesta conexão. Abra o vídeo na Meta pelo botão de visualização.':
   'Este criativo não disponibilizou vídeo reproduzível; exiba a melhor imagem fornecida.'};
}
