import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html');
const server=read('server.mjs');
const flags=read('public/socio-product-features.js');
const workspace=read('public/socio-workspace-ui.js');
const app=read('public/app.js');
const thalita=read('public/socio-thalita-ui.js');
const integrations=read('public/socio-integrations-ui.js');
const css=read('public/socio-motion-refined.css');
const motion=read('public/socio-entry-motion.js');

test('Google Ads remains stored but is disabled in every user-facing entry point',()=>{
 assert.match(flags,/googleAdsVisible:false/);
 assert.match(workspace,/ads&&googleAdsVisible\(\)\?googleOverview\(\):Promise\.resolve/);
 assert.match(workspace,/can\(me,'marketing\.read'\)&&googleAdsVisible\(\)\?cached\(api,'\/api\/google-ads\/status'/);
 assert.match(workspace,/googleAdsVisible\(\)\?budgetHeaderItem\('google_ads'/);
 assert.match(workspace,/googleAdsVisible\(\)\?'<section class="px-conn-card"/);
 assert.match(workspace,/if\(googleAdsVisible\(\)&&googleConnected\)/);
 assert.match(thalita,/SocioProductFeatures\?\.googleAdsVisible===true\?'<button/);
 assert.match(integrations,/visibleTasks=.*?\.filter\(item=>globalThis\.SocioProductFeatures/);
 assert.match(integrations,/googleAdsVisible!==true\|\|!google\?\.configured/);
 assert.match(app,/googleAdsVisible\(\)\?api\('\/api\/google-ads\/campaigns'/);
 assert.match(app,/googleAdsVisible\(\)\?'<option value="google_ads"/);
 assert.match(app,/data-campaign-provider value="meta_ads"/);
 assert.match(app,/current\.campaigns\.filter\(c=>googleAdsVisible\(\)\|\|c\.provider!=='google_ads'\)/);
});

test('new visual assets load after legacy styles, with flags before all application modules',()=>{
 for(const asset of ['socio-product-features.js','socio-entry-motion.js','socio-motion-refined.css']){
  assert(existsSync(new URL('../public/'+asset,import.meta.url)),asset);
  assert(html.includes('/'+asset+'?v=20261112a'));
  assert(server.includes("'/"+asset+"'"));
 }
 assert(html.indexOf('/socio-product-features.js')<html.indexOf('/socio-workspace-ui.js'));
 assert(html.indexOf('/socio-product-features.js')<html.indexOf('/app.js'));
 assert(html.indexOf('/socio-product-features.js')<html.indexOf('/socio-thalita-ui.js'));
 assert(html.indexOf('/socio-motion-refined.css')>html.indexOf('/socio-contrast-audit.css'));
 assert(html.indexOf('/socio-entry-motion.js')>html.indexOf('/socio-glass-motion.js'));
 assert.match(html,/\/socio-workspace-ui\.js\?v=20261112d/);
 assert.match(html,/\/app\.js\?v=20261112d/);
});

test('overview orders information from headline to budget, KPIs, Meta and reports',()=>{
 const p=workspace.slice(workspace.indexOf("root.innerHTML='<div class=\"px-workspace px-overview\">'+"));
 const order=['CENTRAL DE INTELIGÊNCIA','px-budget-top','px-kpi-grid',
  'px-ad-performance','Atividade de conversas','Funil de atendimento'];
 let at=-1;
 for(const marker of order){
  const next=p.indexOf(marker);
  assert(next>at,'misordered or missing '+marker);
  at=next;
 }
 const preview=workspace.slice(workspace.indexOf("if(kind==='overview')"),workspace.indexOf("if(kind==='overview')")+1800);
 assert(preview.indexOf('CENTRAL DE INTELIGÊNCIA')<preview.indexOf('px-budget-top'));
 assert.match(p,/Publicidade<\/h2>/);
 assert.match(p,/Custo por clique/);
 assert.match(p,/Cliques/);
 assert.doesNotMatch(p.slice(0,p.indexOf('px-ad-performance')),/Requer OAuth/);
});

test('entrances use route-aware one-shot compositor animations, not refresh jitter',()=>{
 assert.doesNotThrow(()=>new vm.Script(motion));
 assert.doesNotThrow(()=>new vm.Script(workspace));
 assert.doesNotThrow(()=>new vm.Script(app));
 assert.match(motion,/if\(next===presented\)return/);
 assert.match(motion,/\.px-overview-loading/);
 assert.match(motion,/\.px-screen-loading/);
 assert.match(motion,/IntersectionObserver/);
 assert.match(motion,/reduced\?\.matches/);
 assert.match(motion,/opacity:\.44/);
 assert.match(motion,/translate3d/);
 assert.doesNotMatch(motion,/filter\s*:|blur\(|clip-path|clipPath/);
});

test('polish uses coherent tokens, separates Master, responds to mobile and reduced motion',()=>{
 for(const token of ['--sx-fg:#f2f7ef','--sx-lime:#c9f16d',
  '--sx-jade:#65d6ab','--sx-violet:#b3a4ff',
  '--sx-fg-muted:#bfcdbf','[data-workspace="master"]',
  '.px-kpi-grid','.px-ad-performance','.px-ads-strip',
  '.px-budget-meta-ribbon','.px-dual','.px-conn-card',
  '.px-campaign-provider-meta','.px-assistant-window:not(.hidden)',
  '@keyframes sx-modal-enter','@media(max-width:720px)',
  '@media(prefers-reduced-motion:reduce)',
  '@media(prefers-reduced-transparency:reduce)']){
  assert(css.includes(token),token);
 }
 assert.match(css,/color:var\(--sx-lime-ink\)!important/);
 let nesting=0;
 for(const char of css.replace(/\/\*[\s\S]*?\*\//g,'')){
  if(char==='{')nesting++;
  if(char==='}')nesting--;
  assert(nesting>=0);
 }
 assert.equal(nesting,0);
});

test('disabled feature truly disappears from rendered overview and connections', async()=>{
 const context={};
 context.globalThis={SocioProductFeatures:{googleAdsVisible:false}};
 context.window=context.globalThis;
 context.URL=URL;context.Intl=Intl;
 context.setInterval=()=>1;context.clearInterval=()=>{};
 context.document={hidden:false};
 context.console=console;
 vm.runInNewContext(workspace,context);
 const root={
  innerHTML:'',
  isConnected:true,
  querySelector:()=>null,
  querySelectorAll:()=>[]
 };
 const me={tenant:{id:'tenant'},user:{id:'user',role:'member',permissions:[]}};
 const queried=[];
 const api=async path=>{
  queried.push(path);
  if(path==='/api/dashboard')return {openConversations:2,messagesReceivedToday:3};
  if(path.startsWith('/api/dashboard/activity'))return {points:[{date:'2026-11-12',inbound:5,outbound:4}]};
  if(path==='/api/waakg/channels')return [];
  return {};
 };
 await context.globalThis.SocioWorkspaceUI.overview({root,api,me,navigate:()=>{}});
 assert(root.innerHTML.includes('Visão geral'));
 assert(root.innerHTML.includes('Publicidade'));
 assert(root.innerHTML.includes('Meta Ads'));
 assert(!root.innerHTML.includes('Google Ads'));
 assert(!queried.some(p=>p.includes('/api/google-ads')));
 await context.globalThis.SocioWorkspaceUI.connections({root,api,me,navigate:()=>{}});
 assert(root.innerHTML.includes('Conexões'));
 assert(root.innerHTML.includes('Meta Ads'));
 assert(!root.innerHTML.includes('Google Ads'));
 assert(!queried.some(p=>p.includes('/api/google-ads')));
});
