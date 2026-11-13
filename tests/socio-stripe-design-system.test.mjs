import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {chromium} from 'playwright-core';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const server=read('server.mjs');
const css=read('public/socio-stripe-system.css');
const app=read('public/app.js');
const overview=read('public/socio-workspace-ui.js');
const motion=read('public/socio-entry-motion.js');
const base=read('public/inbox.css');
const cssImports=[...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)]
 .map(match=>match[1].split('?')[0]);
const chrome=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
 '/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(x=>x&&existsSync(x));

test('one canonical Stripe-inspired light theme replaces obsolete dark overrides',()=>{
 assert.equal(cssImports.at(-1),'/socio-stripe-system.css');
 assert.match(html,/\/socio-stripe-system\.css\?v=20261112e/);
 assert(server.includes("'/socio-stripe-system.css'"));
 assert.match(html,/<meta name="theme-color" content="#f7f8fa">/);
 for(const old of ['socio-glass-motion.css','socio-glass-enforced.css',
  'socio-premium-polish.css','socio-contrast-audit.css',
  'socio-motion-refined.css','socio-luminous-glass.css']){
  assert(!cssImports.some(x=>x.endsWith('/'+old)),old+' should not be loaded');
 }
 assert(!html.includes('<script src="/socio-glass-motion.js'));
 assert.match(html,/\/socio-entry-motion\.js\?v=20261112b/);
 assert.match(motion,/prefers-reduced-motion: reduce/);
 assert.match(motion,/duration=cheapMotion\?\.matches\?165:215/);
 assert.doesNotThrow(()=>new vm.Script(motion));
 assert.doesNotThrow(()=>new vm.Script(app));
 assert.doesNotThrow(()=>new vm.Script(overview));
});

test('visual hierarchy remains Stripe-inspired and complete across modules',()=>{
 for(const token of ['--stripe-canvas:#f7f8fa','--stripe-card:#fff',
  '--stripe-accent:#605dec','--stripe-ink:#202735',
  '--stripe-muted:#667085','--stripe-line:#e5e7eb',
  '#appShell[data-workspace="master"]','.px-budget-meta-ribbon',
  '.px-kpi-grid','.px-chart-actions','.px-marketing-filters',
  '.wa-inbox','.wa-list-row.active','.wa-message-row.outgoing',
  '.wa-compose-send','.px-assistant-window:not(.hidden)',
  '.ps-interview-welcome','.socio-training-center',
  '.master-kpi','.master-table','.socio-popup-surface',
  '.socio-page-loading','.px-load-line',
  '@media(max-width:560px)','@media(prefers-reduced-motion:reduce)']){
  assert(css.includes(token),'missing '+token);
 }
 const withoutComments=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let level=0;
 for(const char of withoutComments){
  level+=(char==='{')-(char==='}');
  assert(level>=0,'unexpected closing CSS brace');
 }
 assert.equal(level,0,'unterminated CSS block');
 assert.doesNotMatch(withoutComments,/@import|url\s*\(\s*https?:/i);
 assert.match(base,/\.wa-inbox/);
 assert.match(overview,/Gasto hoje/);
 assert.match(overview,/Limite disponível/);
 assert.match(overview,/Abrir recarga na Meta/);
 assert.match(app,/const masterViews=new Set/);
});

test('all required CSS and scripts return from public allowlist',()=>{
 const imported=[...html.matchAll(/<(?:script|link)\s+[^>]*(?:src|href)="(\/[^"]+)"/g)]
  .map(x=>x[1].split('?')[0]).filter(x=>/\.(css|js)$/.test(x));
 assert(imported.length>=30);
 const invalid=imported.filter(p=>!server.includes("'"+p+"'")||
  !existsSync(new URL('../public'+p,import.meta.url)));
 assert.deepEqual(invalid,[]);
});

test('computed colors are legible on production, Master, inbox, Meta and Thalita', {timeout:50000},async t=>{
 if(!chrome){t.skip('Chromium unavailable; static theme and functional tests remain');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(e){t.skip('Chromium unavailable: '+String(e).slice(0,120));return;}
 try{
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  const styles=cssImports.map(x=>read('public'+x)).join('\n');
  const fixture=(workspace='production')=>'<!doctype html><html><head><style>'+styles+'</style></head><body>'+
    '<div id="appShell" class="app-shell" data-workspace="'+workspace+'">'+
    '<aside class="sidebar"><div class="sidebar-logo"><strong>Sócio</strong></div>'+
     '<div class="workspace-box"><div class="workspace-label"><small>AMBIENTE</small><strong>Consecom</strong></div></div>'+
     '<nav class="nav"><button class="nav-item selected">Visão geral</button><button class="nav-item">Mensagens</button></nav></aside>'+
    '<div class="app-main"><header class="topbar"><div class="breadcrumb">Sócio <strong>Visão geral</strong></div></header>'+
    '<main id="view"><section class="px-workspace px-overview">'+
     '<div class="px-page-heading"><h1>Visão geral</h1><p>Operação da empresa</p></div>'+
     '<section class="px-budget-top"><div class="px-budget-top-grid">'+
      '<article class="px-budget-account px-budget-meta-ribbon" data-budget-provider="meta_ads">'+
       '<div class="px-budget-meta-summary"><div class="px-budget-meta-brand"><strong>Meta Ads</strong></div>'+
       '<div class="px-budget-meta-metric"><span>Limite disponível</span><strong>R$ 13,17</strong></div></div>'+
       '<div class="px-budget-meta-action"><a class="px-budget-recharge-cta">Abrir recarga</a></div></article></div></section>'+
     '<div class="px-kpi-grid"><article class="px-kpi"><span class="px-kpi-label">Mensagens hoje</span>'+
       '<span class="px-kpi-number">25</span><small>Dados da conta</small></article></div>'+
     '<section class="px-panel"><div class="px-panel-head"><h2>Atividade de conversas</h2><p>Mensagens</p></div>'+
       '<div class="px-chart-actions"><button class="px-range-btn">7 dias</button><button class="px-range-btn active" aria-pressed="true">30 dias</button></div>'+
       '<div class="px-chart-wrap"><div class="px-axis"><span>Novembro</span></div></div></section>'+
     '<section class="master-panel"><div class="master-panel-head"><h2>Empresas</h2><p>Seus clientes</p></div>'+
       '<div class="master-kpi"><small>Empresas</small><strong>4</strong></div></section>'+
     '<div class="wa-inbox"><div class="wa-inbox-side"><div class="wa-filters"><button>IA</button><button class="active">Todas</button><button>Humano</button></div>'+
        '<div class="wa-list-row active"><div class="wa-chat-name-line"><strong>Contato</strong></div>'+
        '<div class="wa-chat-preview">Última mensagem</div></div></div>'+
       '<div class="wa-inbox-main"><div class="wa-thread-header"><div class="wa-thread-identity"><strong>Contato</strong><small>Atendente</small></div></div>'+
        '<div class="wa-message-list"><div class="wa-message-row outgoing"><div class="wa-message-bubble"><span class="wa-message-copy">Olá!</span></div></div></div>'+
        '<div class="wa-compose"><div class="wa-compose-row"><textarea placeholder="Mensagem"></textarea>'+
         '<button class="wa-compose-send">Enviar</button></div></div></div></div>'+
    '</section></main></div></div>'+
    '<div id="socioThalitaDock"><section class="px-assistant-window">'+
      '<header><strong>Thalita</strong><small>Assistente da empresa</small></header>'+
      '<div class="px-assistant-feed"><div class="px-assistant-line"><p>Olá!</p></div></div>'+
      '<div class="px-assistant-suggestions"><button>Resumo de hoje</button></div>'+
      '<form id="thalitaForm"><textarea id="thalitaInput"></textarea>'+
       '<div class="px-assistant-actions"><button class="btn primary">Enviar</button></div></form></section></div>'+
    '</body></html>';
  const selectors=[
    '#appShell .nav-item.selected','#appShell .workspace-label strong',
    '#appShell .breadcrumb strong',
    '#appShell #view .px-page-heading h1','#appShell #view .px-page-heading p',
    '#appShell #view .px-budget-meta-metric strong',
    '#appShell #view .px-budget-meta-metric span',
    '#appShell #view .px-budget-recharge-cta',
    '#appShell #view .px-kpi-number','#appShell #view .px-kpi small',
    '#appShell #view .px-chart-actions .px-range-btn.active',
    '#appShell #view .px-chart-actions .px-range-btn:not(.active)',
    '#appShell #view .px-panel-head p',
    '#appShell #view .px-axis span',
    '#appShell #view .master-panel-head p',
    '#appShell #view .wa-filters button.active',
    '#appShell #view .wa-filters button:not(.active)',
    '#appShell #view .wa-chat-name-line strong',
    '#appShell #view .wa-chat-preview',
    '#appShell #view .wa-thread-identity small',
    '#appShell #view .wa-message-copy',
    '#appShell #view .wa-compose-send',
    '#socioThalitaDock .px-assistant-window>header strong',
    '#socioThalitaDock .px-assistant-line p',
    '#socioThalitaDock .px-assistant-suggestions button',
    '#socioThalitaDock .px-assistant-actions .btn.primary'
  ];
  const metrics=[];
  for(const workspace of ['production','master']){
   await p.setContent(fixture(workspace),{waitUntil:'domcontentloaded'});
   const data=await p.evaluate(selectors=>{
    const rgba=str=>{
     const m=str.match(/rgba?\(([^)]+)\)/);
     if(!m)return [0,0,0,0];
     const v=m[1].replaceAll(',',' ').replace('/',' ').split(/\s+/).filter(Boolean).map(Number);
     return [v[0]||0,v[1]||0,v[2]||0,v.length>=4?v[3]:1];
    };
    const composite=(f,b)=>f.slice(0,3).map((v,i)=>Math.round(v*(f[3]??1)+b[i]*(1-(f[3]??1))));
    const lum=arr=>arr.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
      .reduce((t,v,i)=>t+v*[.2126,.7152,.0722][i],0);
    return selectors.map(selector=>{
     const el=document.querySelector(selector);
     if(!el)return {selector,error:'missing'};
     const color=rgba(getComputedStyle(el).color);
     const stack=[];let p=el;
     while(p){stack.unshift(p);p=p.parentElement;}
     let bg=[255,255,255];
     for(const item of stack)bg=composite(rgba(getComputedStyle(item).backgroundColor),bg);
     const a=lum(color.slice(0,3)),b=lum(bg);
     const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
     return {selector,ratio:Math.round(100*ratio)/100,bg,fg:color.slice(0,3)};
    });
   },selectors);
   metrics.push(...data.map(x=>({...x,workspace})));
  }
  const fail=metrics.filter(x=>x.error||x.ratio<4.5);
  assert.deepEqual(fail,[],'Computed text below WCAG AA: '+JSON.stringify(fail));
  console.log('Stripe visual contract: '+metrics.length+' computed text pairs; minimum '+Math.min(...metrics.map(x=>x.ratio))+':1');
 }finally{await browser.close();}
});


test('mobile: cards are single-column and assistant occupies a usable screen-height panel', {timeout:40000},async t=>{
 if(!chrome){t.skip('Chromium unavailable');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(err){t.skip('Browser unavailable: '+String(err).slice(0,90));return;}
 try{
  const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});
  const styles=cssImports.map(x=>read('public'+x)).join('\n');
  await p.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<style>'+styles+'</style></head><body><div id="appShell" class="app-shell">'+
   '<aside class="sidebar"><div class="sidebar-logo">Sócio</div></aside>'+
   '<div class="app-main"><header class="topbar">Visão geral</header><main id="view">'+
   '<div class="px-workspace"><div class="px-kpi-grid">'+
   '<article class="px-kpi">Conversas</article><article class="px-kpi">Mensagens</article></div></div>'+
   '</main></div></div><div id="socioThalitaDock"><div class="px-assistant-window">'+
   '<header><strong>Thalita</strong></header><div class="px-assistant-feed">Oi!</div></div></div></body></html>');
  const x=await p.evaluate(()=>{
   const kpi=document.querySelector('.px-kpi-grid');
   const assistant=document.querySelector('.px-assistant-window');
   const gridStyle=getComputedStyle(kpi);
   const assistantStyle=getComputedStyle(assistant);
   const cardOne=kpi.children[0].getBoundingClientRect();
   const cardTwo=kpi.children[1].getBoundingClientRect();
   const box=assistant.getBoundingClientRect();
   return {grid:gridStyle.gridTemplateColumns,
    first:cardOne,second:cardTwo,
    assistant:box,
    assistantPosition:assistantStyle.position,
    viewportWidth:document.documentElement.clientWidth};
  });
  assert(x.second.top>x.first.top,'KPI cards should stack on narrow screens');
  assert.equal(x.assistantPosition,'fixed');
  assert(x.assistant.width<=x.viewportWidth,'Thalita must not exceed the viewport');
  assert(x.assistant.height>=600,'Thalita must remain usable on 844px phones');
 }finally{await browser.close();}
});
