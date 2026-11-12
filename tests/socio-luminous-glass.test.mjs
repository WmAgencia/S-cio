import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/socio-luminous-glass.css');
const server=read('server.mjs');
const links=[...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)]
 .map(x=>x[1].split('?')[0]);
const chrome=[
 process.env.CHROME_PATH,'/usr/bin/google-chrome',
 '/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'
].find(p=>p&&existsSync(p));

function luminance(hex){
 const channel=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return channel[0]*.2126+channel[1]*.7152+channel[2]*.0722;
}
function contrast(foreground,background){
 const a=luminance(foreground),b=luminance(background);
 return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

test('the final luminous glass stylesheet loads LAST, with cache busting',()=>{
 assert(html.includes('/socio-luminous-glass.css?v=20261112a'));
 assert.equal(links.at(-1),'/socio-luminous-glass.css');
 assert(server.includes("'/socio-luminous-glass.css'"));
 assert.match(html,/<meta name="theme-color" content="#40544e">/);
 const withoutComments=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let braces=0;
 for(const letter of withoutComments){
  braces+=(letter==='{')-(letter==='}');
  assert(braces>=0,'stray } in CSS');
 }
 assert.equal(braces,0);
 assert.doesNotMatch(withoutComments,/@import|url\s*\(\s*https?:|animation\s*:\s*infinite/i);
});

test('lightened palette has a usable surface hierarchy and readable AA ink',()=>{
 for(const [name,foreground,background] of [
  ['cards and normal text','#e3eee4','#4b5e55'],
  ['secondary text','#e0ede2','#4b5e55'],
  ['sidebar labels','#deebe0','#496057'],
  ['assistant body','#e3f0e2','#526b57'],
  ['inbox metadata','#dae8db','#4a6055'],
  ['bright KPI','#f7fbf6','#53665c'],
  ['chart labels','#e2ede1','#3e5349'],
  ['primary lime','#243118','#c9f16d'],
 ]){
  assert(contrast(foreground,background)>=4.5,
    name+': '+contrast(foreground,background).toFixed(2)+' falls under WCAG AA');
 }
 for(const token of [
  '--socio-bg:#354742','--sx-panel:#455650',
  '--socio-sidebar:#40544e','rgba(255,255,255,.27)',
  '--wa-wall:#354a42',
  '[data-workspace="master"]',
  'body #appShell .nav>.socio-glass-nav-pill',
  'body #appShell .topbar',
  'body:has(#appShell:not(.hidden)) #socioThalitaDock .px-assistant-window:not(.hidden)',
  '.px-budget-account[data-budget-provider="meta_ads"].px-budget-meta-ribbon',
  '.wa-inbox','.px-panel','.px-kpi',
  '@supports not ((backdrop-filter:blur(10px))',
  '@media(prefers-reduced-transparency:reduce)',
  '@media(prefers-contrast:more)',
  '@media(max-width:760px)',
 ])assert(css.includes(token),'missing '+token);
 assert.doesNotMatch(css,/grid-template-(?:columns|rows)\s*:/);
 assert.doesNotMatch(css,/position\s*:\s*(?:absolute|fixed)\s*!important/);
});

test('computed visual materials really blur behind floating controls, not KPIs', {timeout:40000}, async t=>{
 if(!chrome){t.skip('Chromium unavailable');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(e){t.skip('Chromium not runnable: '+String(e).slice(0,140));return;}
 try{
  const page=await browser.newPage({viewport:{width:1390,height:860}});
  const allCss=links.map(p=>read('public'+p)).join('\n');
  await page.setContent('<!doctype html><html><head><style>'+allCss+'</style></head><body>'+
   '<div id="appShell" class="app-shell"><aside class="sidebar">'+
    '<nav class="nav"><span class="socio-glass-nav-pill"></span><button class="nav-item selected">Visão geral</button></nav>'+
    '</aside><div class="app-main"><div class="topbar"><span class="breadcrumb">Seu espaço</span></div>'+
    '<main id="view"><section class="px-workspace px-overview">'+
     '<div class="px-kpi-grid"><article class="px-kpi"><div class="px-kpi-top"><span class="px-kpi-label">Conversas</span></div>'+
       '<span class="px-kpi-number">56</span><small>Últimos dados</small></article></div>'+
     '<section class="px-panel"><div class="px-panel-head"><h2>Atividade</h2><p>Mensagens recebidas</p></div>'+
       '<div class="px-chart-wrap"><div class="px-axis"><span>Novembro</span></div></div></section>'+
    '</section></main></div></div>'+
    '<div id="socioThalitaDock"><section class="px-assistant-window">'+
     '<header><strong>Thalita</strong></header><div class="px-assistant-feed"><div class="px-assistant-line"><p>Olá</p></div></div>'+
    '</section></div></body></html>');
  const results=await page.evaluate(()=>{
   const s=sel=>getComputedStyle(document.querySelector(sel));
   const main=s('#appShell .app-main');
   const pill=s('#appShell .nav>.socio-glass-nav-pill');
   const top=s('#appShell .topbar');
   const kpi=s('#appShell #view .px-kpi');
   const panel=s('#appShell #view .px-panel');
   const assistant=s('#socioThalitaDock .px-assistant-window');
   return {
    mainBackground:main.backgroundImage,
    navBackdrop:pill.backdropFilter||pill.webkitBackdropFilter,
    navBackground:pill.backgroundImage,
    topBackdrop:top.backdropFilter||top.webkitBackdropFilter,
    kpiBackdrop:kpi.backdropFilter||kpi.webkitBackdropFilter,
    panelBackdrop:panel.backdropFilter||panel.webkitBackdropFilter,
    kpiBackground:kpi.backgroundImage,
    assistantBackdrop:assistant.backdropFilter||assistant.webkitBackdropFilter,
    assistantBackground:assistant.backgroundImage,
    kpiText:s('#appShell #view .px-kpi-number').color,
   };
  });
  assert.match(results.mainBackground,/#?none|gradient/i);
  assert.match(results.navBackdrop,/blur\(17px\)/);
  assert.match(results.topBackdrop,/blur\(19px\)/);
  assert.match(results.assistantBackdrop,/blur\(23px\)/);
  assert.match(results.navBackground,/gradient/);
  assert.match(results.kpiBackground,/gradient/);
  assert.match(results.assistantBackground,/gradient/);
  assert.equal(results.kpiBackdrop,'none');
  assert.equal(results.panelBackdrop,'none');
  console.log('Luminous materials verified: '+JSON.stringify(results));
 }finally{await browser.close();}
});
