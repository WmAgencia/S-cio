import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {prepareAdsPlan,readSelectedAdMedia,validateAdsPlan} from '../meta-ads-tools.mjs';

const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'unit-app-secret',
 SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'unit-test-only-key-at-least-32-characters'};
const actor={active_tenant_id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222',
 role:'owner',tenant_status:'active',features:{meta_ads:true},token_hash:'unit-session'};
const grant=sealMarketingSecret(JSON.stringify({tenant:actor.active_tenant_id,user:actor.user_id,
 token:'server-only-account-token'}),env);
function mockGraph({campaignBudget=0,adsetBudget=2500,adVideo='1979307460141410'}={}){
 const requests=[],dbWrites=[];
 const pool={query:async(sql,args=[])=>{
  if(sql.includes('INSERT INTO meta_ads_plans')){
   assert.equal(args[1],actor.active_tenant_id,'The new plan must be isolated by tenant');
   assert.equal(args[2],actor.user_id,'The author must be the verified account user');
   dbWrites.push({sql,args});return {rowCount:1,rows:[]};
  }
  assert.equal(args[0],actor.active_tenant_id);
  if(sql.includes('meta_official_account_selections'))return {rows:[{account_id:'act_123456'}]};
  if(sql.includes('meta_official_grants'))return {rows:[{token_encrypted:grant,scopes:['ads_read','ads_management']}]};
  throw Error('Unexpected SQL '+sql);
 }};
 const request=async(url,opts)=>{
  const u=new URL(url);requests.push({url:u,opts});
  assert.equal(u.hostname,'graph.facebook.com');
  assert.equal(opts.method||'GET','GET','Preparing a plan must never modify an ad account.');
  assert.equal(opts.headers.Authorization,'Bearer server-only-account-token');
  const ok=data=>({ok:true,json:async()=>data});
  if(u.pathname.endsWith('/me/adaccounts'))return ok({data:[{id:'act_123456',name:'Empresa',currency:'BRL'}]});
  if(u.pathname.endsWith('/3333333333'))return ok({id:'3333333333',account_id:'123456',
   daily_budget:campaignBudget?'2500':undefined,lifetime_budget:undefined,status:'ACTIVE',effective_status:'ACTIVE',name:'Campanha ABO'});
  if(u.pathname.endsWith('/4444444444'))return ok({id:'4444444444',account_id:'123456',campaign_id:'3333333333',
   daily_budget:String(adsetBudget),lifetime_budget:undefined,status:'ACTIVE',effective_status:'ACTIVE',name:'Conjunto ABO'});
  if(u.pathname.endsWith('/5555555555'))return ok({id:'5555555555',name:'Ads 5 Centella',account_id:'123456',campaign_id:'3333333333',
   creative:{id:'6666666666',video_id:adVideo,thumbnail_url:'https://scontent.xx.fbcdn.net/tiny.jpg'}});
  if(u.pathname.endsWith('/'+adVideo)){
   if(u.searchParams.get('fields')==='id,permalink_url')
    return ok({id:adVideo,permalink_url:'https://www.facebook.com/61587715254882/videos/'+adVideo+'/'});
   if(u.searchParams.get('fields')?.startsWith('thumbnails'))
    return ok({thumbnails:{data:[{uri:'https://scontent.xx.fbcdn.net/large.jpg',width:1080,height:1920}]}});
   return ok({id:adVideo,picture:'https://scontent.xx.fbcdn.net/tiny.jpg'});
  }
  if(u.pathname.endsWith('/5555555555/previews'))return ok({data:[]});
  throw Error('Unexpected Meta URL '+u.pathname);
 };
 return {pool,request,requests,dbWrites};
}
test('video from the supplied Centella Facebook Page is embedded INSIDE Sócio',async()=>{
 const mock=mockGraph();
 const res=await readSelectedAdMedia(mock.pool,actor,'5555555555',{env,request:mock.request});
 assert.equal(res.videoId,'1979307460141410');
 assert.equal(res.videoPageUrl,'https://www.facebook.com/61587715254882/videos/1979307460141410/');
 const iframe=new URL(res.videoEmbedUrl);
 assert.equal(iframe.hostname,'www.facebook.com');
 assert.equal(iframe.pathname,'/plugins/video.php');
 assert.equal(iframe.searchParams.get('href'),res.videoPageUrl);
 assert.equal(iframe.searchParams.get('autoplay'),'false');
 assert.match(res.posterUrl,/large.jpg/);
 assert(!JSON.stringify(res).includes('server-only-account-token'));
 assert(mock.requests.every(x=>!x.url.searchParams.has('access_token')));
});
test('user can prepare budget change on ABO adset but cannot invent CBO budget on parent campaign',async()=>{
 const mock=mockGraph();
 await assert.rejects(prepareAdsPlan(mock.pool,actor,'budget',{
  entity:'campaign',id:'3333333333',dailyBudgetCents:5000
 },{env,request:mock.request}),{status:409});
 assert.equal(mock.dbWrites.length,0);
 const plan=await prepareAdsPlan(mock.pool,actor,'budget',{
  entity:'adset',id:'4444444444',dailyBudgetCents:3500
 },{env,request:mock.request});
 assert.match(plan.id,/^[a-f0-9-]{36}$/);
 assert.equal(plan.requiresConfirmation,true);
 assert.equal(mock.dbWrites.length,1);
 assert(mock.requests.every(x=>(x.opts.method||'GET')==='GET'));
 assert.equal(validateAdsPlan('status',{entity:'campaign',id:'3333333333',status:'PAUSED'}).status,'PAUSED');
});
test('CBO daily-budget campaign is editable only with plan and second confirmation',async()=>{
 const mock=mockGraph({campaignBudget:2500});
 const plan=await prepareAdsPlan(mock.pool,actor,'budget',{entity:'campaign',id:'3333333333',dailyBudgetCents:3000},{env,request:mock.request});
 assert.equal(plan.requiresConfirmation,true);
 assert.equal(mock.dbWrites.length,1);
 assert(mock.requests.every(x=>(x.opts.method||'GET')==='GET'));
});
test('Meta interface hides advanced tools and shows campaign actions with a two-stage confirmation',()=>{
 const ui=load('public/socio-workspace-ui.js'),css=load('public/socio-executive.css'),server=load('server.mjs');
 assert.doesNotThrow(()=>new vm.Script(ui));
 for(const marker of ['data-px-manage-status','data-px-manage-budget','data-px-action-review',
  'data-px-action-confirm','/api/marketing/tools/plan','/api/marketing/tools/execute',
  'plan.requiresConfirmation'])assert(ui.includes(marker),marker);
 assert(!ui.includes('Ferramentas avançadas e gerenciamento de anúncios'));
 assert(css.includes('.px-campaign-dialog'));
 assert(server.includes("requirePermission(a,'marketing.manage')"));
});
test('inline Facebook player remains inside Sócio and realtime refresh never tears down a playing video',()=>{
 const ui=load('public/socio-workspace-ui.js'),css=load('public/socio-executive.css');
 for(const marker of ['/plugins/video.php','trustedVideoEmbed','createInlineFacebookVideo',
  'placeholder.replaceChildren(frame)','holder.replaceChildren(frame)',
  'startLiveRefresh','},30000)','const playing=!!root.querySelector',
  'if(playing){await updateWhilePlaying','getCache.clear()'])
  assert(ui.includes(marker),marker);
 assert(!ui.includes('Abrir vídeo na Meta'));
 assert(css.includes('.px-facebook-video-frame'));
 assert(css.includes('.px-feature-media.px-media-lowres:after{display:none'));
});
