import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html'),css=read('public/socio-stripe-system.css'),server=read('server.mjs');
const imports=[...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)].map(x=>x[1].split('?')[0]);
const chrome=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
 '/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(x=>x&&existsSync(x));

test('canonical light stylesheet is last; old luminous glass is retired',()=>{
 assert.equal(imports.at(-1),'/socio-stripe-system.css');
 assert(server.includes("'/socio-stripe-system.css'"));
 assert(!imports.includes('/socio-luminous-glass.css'));
 assert(!imports.includes('/socio-glass-motion.css'));
 assert.match(html,/<meta name="theme-color" content="#f7f8fa">/);
 const source=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let n=0;
 for(const ch of source){n+=(ch==='{')-(ch==='}');assert(n>=0);}
 assert.equal(n,0);
});
test('cards are unblurred, toolbar is white and assistant opens as a right panel',()=>{
 assert.match(css,/body #appShell \.topbar\{/);
 assert.match(css,/backdrop-filter:none!important/);
 assert.match(css,/body #appShell #view \.px-kpi\{/);
 assert.match(css,/#socioThalitaDock \.px-assistant-window:not\(\.hidden\)\{/);
 assert.match(css,/position:fixed!important/);
 assert.match(css,/width:min\(408px,calc\(100vw - 36px\)\)!important/);
 assert.match(css,/@media\(max-width:780px\)/);
});
test('Chromium computes the current white materials instead of previous graphite/glass', {timeout:40000},async t=>{
 if(!chrome){t.skip('Chromium unavailable');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(err){t.skip('Browser unavailable: '+String(err).slice(0,90));return;}
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent('<html><head><style>'+imports.map(p=>read('public'+p)).join('\n')+'</style></head><body>'+
   '<div id="appShell" class="app-shell"><aside class="sidebar">'+
    '<nav class="nav"><button class="nav-item selected">Painel</button></nav></aside>'+
    '<div class="app-main"><header class="topbar">Sócio</header>'+
    '<main id="view"><section class="px-workspace"><article class="px-kpi"><span class="px-kpi-number">22</span></article>'+
    '<section class="px-panel">Resultados</section></section></main></div></div>'+
    '<div id="socioThalitaDock"><section class="px-assistant-window">Thalita</section></div></body></html>');
  const data=await page.evaluate(()=>{
   const style=q=>getComputedStyle(document.querySelector(q));
   return {
    sidebar:style('#appShell .sidebar').backgroundColor,
    top:style('#appShell .topbar').backgroundColor,
    kpi:style('#appShell #view .px-kpi').backgroundColor,
    panel:style('#appShell #view .px-panel').backgroundColor,
    topBackdrop:style('#appShell .topbar').backdropFilter,
    cardBackdrop:style('#appShell #view .px-kpi').backdropFilter,
    assistantPosition:style('#socioThalitaDock .px-assistant-window').position
   };
  });
  assert.equal(data.top,'rgb(255, 255, 255)');
  assert.equal(data.kpi,'rgb(255, 255, 255)');
  assert.equal(data.panel,'rgb(255, 255, 255)');
  assert.equal(data.topBackdrop,'none');
  assert.equal(data.cardBackdrop,'none');
  assert.equal(data.assistantPosition,'fixed');
  console.log('Light surface material verified: '+JSON.stringify(data));
 }finally{await browser.close();}
});
