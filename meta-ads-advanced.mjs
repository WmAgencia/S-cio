// Extended Meta Marketing API toolbox — SELECTED ACCOUNT ONLY.
// All operations are read-only; a client cannot supply graph paths or arbitrary fields.
import {createHmac} from 'node:crypto';
import {officialConfig,resolveSelectedOfficialAccount} from './meta-official.mjs';
import {openMarketingSecret} from './marketing-integrations.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';

const fail=(status,msg)=>Object.assign(new Error(msg),{status});
export const META_REPORT_PERIODS=Object.freeze(['today','yesterday','last_7d','last_30d']);
export const META_REPORT_LEVELS=Object.freeze(['account','campaign','adset','ad']);
export const META_BREAKDOWNS=Object.freeze(['none','age','gender','country','region','publisher_platform','platform_position','device_platform']);
export const META_TOOL_CATALOG=Object.freeze([
 {id:'account',label:'Informações da conta',readOnly:true},
 {id:'creatives',label:'Criativos',readOnly:true},
 {id:'videos',label:'Vídeos',readOnly:true},
 {id:'audiences',label:'Públicos personalizados',readOnly:true},
 {id:'pixels',label:'Pixels da conta',readOnly:true},
 {id:'conversions',label:'Conversões personalizadas',readOnly:true},
 {id:'reports',label:'Relatórios por campanha, conjunto ou anúncio',readOnly:true},
 {id:'diagnosis',label:'Diagnóstico de eficiência por campanha',readOnly:true}
]);
const PATHS=Object.freeze({
 creatives:['adcreatives','id,name,thumbnail_url,object_story_spec,effective_object_story_id'],
 videos:['advideos','id,title,description,created_time,length,thumbnail_url'],
 audiences:['customaudiences','id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound'],
 pixels:['adspixels','id,name,last_fired_time'],
 conversions:['customconversions','id,name,custom_event_type,rule']
});
export function validateMetaReport(input={}){
 const period=META_REPORT_PERIODS.includes(input.period)?input.period:'last_7d',
  level=META_REPORT_LEVELS.includes(input.level)?input.level:'campaign',
  breakdown=META_BREAKDOWNS.includes(input.breakdown)?input.breakdown:'none',
  daily=input.daily===true||input.daily==='true';
 return {period,level,breakdown,daily};
}
export function summarizeMetaInsights(rows,{currency='BRL',period='last_7d',level='campaign'}={}){
 const sum=(field)=>rows.reduce((n,row)=>n+(Number.isFinite(Number(row[field]))?Number(row[field]):0),0);
 const spend=sum('spend'),impressions=sum('impressions'),clicks=sum('clicks');
 const ctr=impressions?clicks/impressions*100:0, cpc=clicks?spend/clicks:null;
 const sorted=rows.filter(row=>Number(row.spend)>0).sort((a,b)=>Number(b.spend)-Number(a.spend));
 return {period,level,currency,rows:rows.length,spend:+spend.toFixed(2),impressions,clicks,
  ctrPercent:+ctr.toFixed(2),cpc:cpc===null?null:+cpc.toFixed(2),
  highestSpend:sorted[0]?{id:sorted[0].campaign_id||sorted[0].adset_id||sorted[0].ad_id||null,
   name:sorted[0].campaign_name||sorted[0].adset_name||sorted[0].ad_name||'Item',
   spend:Number(sorted[0].spend)}:null,
  qualification:'Indicadores Meta Ads: cliques não são mensagens, leads nem vendas confirmadas.'};
}
async function context(pool,a,options={}){
 requirePermission(a,'marketing.read');
 assertApiFeature(a.features,'/api/marketing/tools');
 if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');
 const account=await resolveSelectedOfficialAccount(pool,a,options);
 const r=await pool.query('SELECT token_encrypted,scopes FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2 AND expires_at>now()',
  [a.active_tenant_id,a.user_id]);
 const grant=r.rows[0];
 if(!grant||!grant.scopes.includes('ads_read'))throw fail(409,'Acesso Meta expirado ou sem permissão ads_read.');
 const value=JSON.parse(openMarketingSecret(grant.token_encrypted,options.env||process.env));
 if(value.tenant!==a.active_tenant_id||value.user!==a.user_id)throw fail(403,'Acesso de outra empresa.');
 return {account,token:value.token,env:options.env||process.env,request:options.request||fetch};
}
async function graph(c,edge,params={}){
 if(!/^[a-z][a-z_]{2,25}$/.test(edge)||!['insights','adcreatives','advideos','customaudiences','adspixels','customconversions'].includes(edge))
  throw fail(422,'Ferramenta Meta inválida.');
 const cfg=officialConfig(c.env),url=new URL('https://graph.facebook.com/'+cfg.version+'/'+c.account.id+'/'+edge);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,typeof value==='object'?JSON.stringify(value):String(value));
 url.searchParams.set('appsecret_proof',createHmac('sha256',cfg.secret).update(c.token).digest('hex'));
 let res,data;
 try{res=await c.request(url,{headers:{Authorization:'Bearer '+c.token},redirect:'error',signal:AbortSignal.timeout(20000)});data=await res.json();}
 catch{throw fail(503,'A Meta não respondeu. Tente novamente.');}
 if(!res.ok||data.error){
  const detail=String(data.error?.error_user_msg||data.error?.message||'Permissão não disponível nesta conta.')
   .replace(/[<>\x00-\x1f]/g,' ').slice(0,180);
  throw fail(data.error?.code===190?409:422,'Consulta recusada pela Meta: '+detail);
 }
 return data;
}
export async function readAdvancedMetaTool(pool,a,kind,input={},options={}){
 if(!META_TOOL_CATALOG.some(t=>t.id===kind))throw fail(422,'Ferramenta não disponível.');
 const c=await context(pool,a,options);
 if(kind==='account')return {account:c.account,tools:META_TOOL_CATALOG,readOnly:true};
 if(PATHS[kind]){
  const [edge,fields]=PATHS[kind];
  const params={fields,limit:100};
  if(input.after){
   if(typeof input.after!=='string'||!/^[A-Za-z0-9=+\/_-]{1,512}$/.test(input.after))throw fail(422,'Cursor inválido.');
   params.after=input.after;
  }
  const result=await graph(c,edge,params);
  return {kind,accountId:c.account.id,items:Array.isArray(result.data)?result.data:[],
   after:result.paging?.cursors?.after||null,hasMore:Boolean(result.paging?.next),
   readOnly:true};
 }
 const report=validateMetaReport(input);
 const params={fields:'date_start,date_stop,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,inline_link_clicks,spend,actions,cpc,ctr,cpm,frequency',
  level:kind==='diagnosis'?'campaign':report.level,date_preset:report.period,limit:100};
 if(report.breakdown!=='none'&&kind==='reports')params.breakdowns=report.breakdown;
 if(report.daily&&kind==='reports')params.time_increment='1';
 const result=await graph(c,'insights',params),rows=Array.isArray(result.data)?result.data:[];
 const summary=summarizeMetaInsights(rows,{currency:c.account.currency,period:report.period,level:params.level});
 const diagnostics=kind==='diagnosis'?rows.map(row=>{
  const spend=Number(row.spend||0),clicks=Number(row.clicks||0),impressions=Number(row.impressions||0);
  return {id:row.campaign_id||null,name:row.campaign_name||'Campanha',spend,clicks,impressions,
   ctrPercent:impressions?+(100*clicks/impressions).toFixed(2):null,
   cpc:clicks?+(spend/clicks).toFixed(2):null,
   note:!impressions?'Sem impressões suficientes para diagnóstico.':
    !clicks?'Sem cliques no período; revise criativo, público e posicionamentos.':
    'Compare custo por resultado e leads reais antes de otimizar. Não houve alterações automáticas.'};
 }):null;
 return {kind,accountId:c.account.id,items:rows,summary,diagnostics,
  hasMore:Boolean(result.paging?.next),after:result.paging?.cursors?.after||null,
  readOnly:true,warning:summary.qualification};
}
