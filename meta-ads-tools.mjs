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
 if(!/^\/(act_\d+|\d+|search)(\/(campaigns|adsets|ads|adcreatives|adimages|insights|promote_pages))?$/.test(path))throw fail(422,'Operação Meta inválida.');
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
 const fields={campaigns:'id,name,status,effective_status,objective,daily_budget,lifetime_budget',adsets:'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting',ads:'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,thumbnail_url}',images:'hash,name,url,width,height',pages:'id,name'};
 if(kind==='finance'){
  const data=await graph(c,'/'+id,{fields:'id,name,currency,amount_spent,spend_cap,account_status'});
  return {account:data,paymentsUrl:'https://adsmanager.facebook.com/adsmanager/billing?act='+id.slice(4),manualPayment:true};
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
 if(kind==='create'){
  const name=text(input.name,120),url=safeUrl(input.url),message=text(input.message,2200),headline=text(input.headline,120);
  if(!name||!url||!message||!headline||!numeric(input.pageId)||!text(input.imageHash,100)||!numeric(input.cityKey)||!text(input.cityName,100)||!money(input.dailyBudgetCents))throw fail(422,'Preencha nome, página, imagem, cidade, link HTTPS, texto, título e orçamento diário (de 1 a 100.000 na moeda da conta).');
  const ageMin=Number(input.ageMin||18),ageMax=Number(input.ageMax||65);
  if(!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<18||ageMax>65||ageMin>ageMax)throw fail(422,'Faixa etária inválida.');
  return {name,url,message,headline,pageId:input.pageId,imageHash:input.imageHash,cityKey:input.cityKey,cityName:input.cityName.trim(),dailyBudgetCents:input.dailyBudgetCents,ageMin,ageMax};
 }
 if(!['status','rename','budget'].includes(kind)||!['campaign','adset','ad'].includes(input.entity)||!numeric(input.id))throw fail(422,'Selecione uma campanha, conjunto ou anúncio válido.');
 if(kind==='status'){
  if(!['ACTIVE','PAUSED'].includes(input.status))throw fail(422,'Status inválido.');
  return {entity:input.entity,id:input.id,status:input.status};
 }
 if(kind==='rename'){if(!text(input.name,120))throw fail(422,'Nome inválido.');return {entity:input.entity,id:input.id,name:input.name.trim()};}
 if(input.entity!=='adset'||!money(input.dailyBudgetCents))throw fail(422,'Informe orçamento diário válido para um conjunto de anúncios.');
 return {entity:'adset',id:input.id,dailyBudgetCents:input.dailyBudgetCents};
}
async function owned(c,id){const data=await graph(c,'/'+id,{fields:'id,account_id,name'});if('act_'+data.account_id!==c.account.id)throw fail(403,'Este objeto não pertence à conta selecionada.');return data;}
async function validateAssets(c,payload){
 const pages=await availablePages(c);
 if(!(pages.data||[]).some(p=>p.id===payload.pageId))throw fail(403,'Página não autorizada para esta conta.');
 const images=await graph(c,'/'+c.account.id+'/adimages',{fields:'hash,name',hashes:[payload.imageHash],limit:100});
 if(!(images.data||[]).some(i=>i.hash===payload.imageHash))throw fail(403,'Imagem não encontrada nesta conta. Atualize a biblioteca.');
}
export async function prepareAdsPlan(pool,a,kind,input,options={}){
 const c=await context(pool,a,options,true),payload=validateAdsPlan(kind,input);
 let summary;
 if(kind==='create'){
  await validateAssets(c,payload);
  const locations=await graph(c,'/search',{type:'adgeolocation',location_types:['city'],country_code:'BR',q:payload.cityName,limit:100});
  const city=(locations.data||[]).find(x=>String(x.key)===payload.cityKey);
  if(!city)throw fail(422,'Pesquise e selecione novamente a cidade desejada.');
  payload.cityName=[city.name,city.region,city.country_name].filter(Boolean).join(' · ');
  summary={description:'Criar campanha de tráfego para site, conjunto, criativo e anúncio. Todos serão criados PAUSADOS.',account:c.account,name:payload.name,message:payload.message,headline:payload.headline,pageId:payload.pageId,imageHash:payload.imageHash,dailyBudgetCents:payload.dailyBudgetCents,destination:payload.url,city:payload.cityName,ageMin:payload.ageMin,ageMax:payload.ageMax};
 }else{
  const entity=await owned(c,payload.id);
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
  if(plan.kind==='create'){
   await validateAssets(c,p);
   const campaign=await graph(c,'/'+c.account.id+'/campaigns',{name:p.name,objective:'OUTCOME_TRAFFIC',special_ad_categories:[],status:'PAUSED',is_adset_budget_sharing_enabled:false},'POST');
   if(!numeric(campaign.id))throw Object.assign(fail(503,'A Meta não retornou o ID da campanha.'),{uncertain:true});
   result.campaignId=campaign.id;await progress();
   const adset=await graph(c,'/'+c.account.id+'/adsets',{name:p.name+' · Público',campaign_id:campaign.id,daily_budget:p.dailyBudgetCents,billing_event:'IMPRESSIONS',optimization_goal:'LINK_CLICKS',bid_strategy:'LOWEST_COST_WITHOUT_CAP',destination_type:'WEBSITE',targeting:{geo_locations:{cities:[{key:p.cityKey}]},age_min:p.ageMin,age_max:p.ageMax},status:'PAUSED'},'POST');
   if(!numeric(adset.id))throw Object.assign(fail(503,'A Meta não retornou o ID do conjunto.'),{uncertain:true});result.adsetId=adset.id;await progress();
   const creative=await graph(c,'/'+c.account.id+'/adcreatives',{name:p.name+' · Criativo',object_story_spec:{page_id:p.pageId,link_data:{image_hash:p.imageHash,link:p.url,message:p.message,name:p.headline,call_to_action:{type:'LEARN_MORE',value:{link:p.url}}}}},'POST');
   if(!numeric(creative.id))throw Object.assign(fail(503,'A Meta não retornou o ID do criativo.'),{uncertain:true});result.creativeId=creative.id;await progress();
   const ad=await graph(c,'/'+c.account.id+'/ads',{name:p.name+' · Anúncio',adset_id:adset.id,creative:{creative_id:creative.id},status:'PAUSED'},'POST');
   if(!numeric(ad.id))throw Object.assign(fail(503,'A Meta não retornou o ID do anúncio.'),{uncertain:true});result.adId=ad.id;result.delivery='PAUSED';await progress();
  }else{
   await owned(c,p.id);
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
export async function adsToolHistory(pool,a){permit(a);const r=await pool.query('SELECT id,account_id,kind,summary,status,result,created_at FROM meta_ads_plans WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30',[a.active_tenant_id]);return {items:r.rows};}
