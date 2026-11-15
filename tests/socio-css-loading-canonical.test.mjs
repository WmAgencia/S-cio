import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html'),app=read('public/app.js'),
 workspace=read('public/socio-workspace-ui.js'),server=read('server.mjs');
const imported=[...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)]
 .map(x=>x[1].split('?')[0]);
const css=imported.map(x=>read('public'+x)).join('\n');
const shell=read('public/socio-stripe-shell.css');
const chrome=[process.env.CHROME_PATH,
 '/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
 '/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'
].find(p=>p&&existsSync(p));

test('only one final canonical light shell; no dark overrides or invisible boot',()=>{
 assert.equal(imported.at(-1),'/socio-stripe-shell.css');
 assert(!imported.includes('/socio-ethereal.css'));
 assert(!imported.includes('/socio-reference.css'));
 assert.match(html,/<meta name="theme-color" content="#f7f8fa">/);
 assert(server.includes("'/socio-stripe-shell.css'"));
 assert.match(html,/id="socioBootStatus"/);
 assert.match(app,/\$\('#socioBootStatus'\)\?\.setAttribute\('hidden',''\)/);
 assert.match(shell,/\.socio-boot-status\[hidden\]/);
 assert.match(shell,/\.app-shell:not\(\.hidden\)/);
 assert.match(shell,/@media\(max-width:720px\)/);
 const old=read('public/socio-reference.css').length+read('public/socio-ethereal.css').length;
 assert(shell.length<old/4,'Canonical shell must be smaller than a quarter of removed styles');
 let balance=0;
 for(const ch of shell.replace(/\/\*[\s\S]*?\*\//g,'')){
  balance+=(ch==='{')-(ch==='}');
  assert(balance>=0);
 }
 assert.equal(balance,0);
 assert.doesNotMatch(shell,/url\s*\(\s*https?:|@import/i);
});
test('GET timeout covers streamed body and dashboard does not block on inbox',()=>{
 const start=app.indexOf('async function api('),end=app.indexOf('function heading(',start);
 const api=app.slice(start,end);
 assert(api.indexOf('data=await resp.json()')<api.indexOf('finally{if(timeout)clearTimeout(timeout);}'));
 assert.match(app,/routeFeedbackTimer=setTimeout\(\(\)=>\{/);
 assert.match(app,/\},180\)/);
 assert.match(app,/const navigationTicket=\+\+navigationEpoch/);
 assert.match(app,/if\(navigationTicket!==navigationEpoch\)return/);
 assert.match(workspace,/const later=progressive\?Promise\.all\(ads\?/);
 assert.match(workspace,/progressive\?Promise\.resolve\(\{data:null,ok:false\}\):inboxCall/);
 assert.match(workspace,/inbox\.data\.conversations\.filter\(item=>item\.channel_provider!=='instagram'\)/);
 assert.match(workspace,/expiresAt:completed\+\(result\.ok\?ttl:1500\)/);
});

test('Chromium: desktop and mobile stay light and responsive with nonblocking loading', {timeout:55000},async t=>{
 if(!chrome){t.skip('Chromium not installed');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(e){t.skip('Chromium unavailable '+String(e).slice(0,140));return;}
 try{
  const appShell=html.slice(html.indexOf('<div id="appShell"'),html.indexOf('<div id="commandOverlay"'))
   .replace('class="app-shell hidden"','class="app-shell"');
  assert(appShell.includes('id="view"'));
  const view='<div class="px-workspace px-overview et-board">'+
   '<h1 class="et-title">Visão geral</h1><div class="et-board-grid">'+
   '<section class="et-hero"><span class="et-hero-label">Faturamento total</span><div class="et-hero-value"><strong>R$ 2.000,00</strong></div>'+
    '<p class="et-hero-note">Vendas confirmadas</p><div class="et-hero-foot"><div class="et-pills"><button class="et-pill on">7 dias</button></div></div></section>'+
   '<section class="et-kpi et-income"><div class="et-kpi-head"><span class="et-kpi-label">Leads no WhatsApp</span></div>'+
    '<strong class="et-kpi-value">56</strong></section>'+
   '<section class="et-kpi et-kpi-campaign"><div class="et-kpi-head"><span class="et-kpi-label">Campanha em destaque</span></div></section>'+
   '<section class="et-block et-recs"><div class="et-block-head"><h2>Recomendações</h2></div></section>'+
   '<section class="et-card et-flow"><h2 class="et-card-title">Fluxo de faturamento</h2></section>'+
   '<section class="et-card et-expense-split"><h2 class="et-card-title">Métricas de anúncios</h2></section>'+
   '<section class="et-block et-subs"><h2>Conversas no WhatsApp</h2></section>'+
   '</div></div><div class="socio-loading-overlay"><span class="socio-page-loading">Atualizando a tela</span></div>';
  const page=await browser.newPage();
  const load=async(width,workspaceType)=>{
   await page.setViewportSize({width,height:800});
   const frame='<!doctype html><html lang="pt-BR"><head><style>'+css+'</style></head><body>'+
    appShell.replace('data-workspace="production"','data-workspace="'+workspaceType+'"')
      .replace(/<main id="view" tabindex="-1">[\s\S]*?<\/main>/,
       '<main id="view">'+view+'</main>')+'</body></html>';
   await page.setContent(frame,{waitUntil:'domcontentloaded'});
   return page.evaluate(()=>{
    const get=s=>{const el=document.querySelector(s);return el?getComputedStyle(el):null;};
    const nav=document.querySelector('#productionNav .nav-item.selected');
    const rail=document.querySelector('#productionNav');
    return {
     canvas:get('#appShell').backgroundColor,
     topbar:get('.topbar').backgroundColor,
     card:get('.et-income').backgroundColor,
     ink:get('.et-kpi-value').color,
     scheme:get('#appShell').colorScheme,
     navVisible:nav&&getComputedStyle(nav).display!=='none',
     hiddenMaster:get('#masterNav').display==='none',
     navFlex:get('#productionNav').flexDirection,
     navScroll:rail.scrollWidth>rail.clientWidth,
     bodyOverflow:document.documentElement.scrollWidth>window.innerWidth+2,
     loadingBlur:get('.socio-loading-overlay').backdropFilter,
     loadingPointer:get('.socio-loading-overlay').pointerEvents,
     columns:get('.et-board-grid').gridTemplateColumns.split(' ').filter(Boolean).length
    };
   });
  };
  const desktop=await load(1440,'production');
  assert.equal(desktop.topbar,'rgb(255, 255, 255)',JSON.stringify(desktop));
  assert.equal(desktop.card,'rgb(255, 255, 255)',JSON.stringify(desktop));
  assert.equal(desktop.canvas,'rgb(247, 248, 250)',JSON.stringify(desktop));
  assert.equal(desktop.ink,'rgb(32, 39, 53)',JSON.stringify(desktop));
  assert.equal(desktop.scheme,'light');
  assert.equal(desktop.navVisible,true);
  assert.equal(desktop.hiddenMaster,true);
  assert.equal(desktop.navFlex,'row');
  assert.equal(desktop.loadingBlur,'none');
  assert.equal(desktop.loadingPointer,'none');
  assert.equal(desktop.bodyOverflow,false,JSON.stringify(desktop));
  const mobile=await load(390,'production');
  assert.equal(mobile.navVisible,true);
  assert.equal(mobile.bodyOverflow,false,JSON.stringify(mobile));
  assert.equal(mobile.canvas,'rgb(247, 248, 250)');
  assert(mobile.columns<=2,'mobile grid must be 2 columns or fewer: '+JSON.stringify(mobile));
  const master=await load(1440,'master');
  assert.equal(master.topbar,'rgb(255, 255, 255)');
  assert.equal(master.card,'rgb(255, 255, 255)');
  assert.equal(master.scheme,'light');
 }finally{await browser.close();}
});
