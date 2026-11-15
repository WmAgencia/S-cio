import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const index=read('index.html');
const sheets=[...index.matchAll(/<link rel="stylesheet" href="(\/[^"]+)"/g)]
 .map(x=>x[1].split('?')[0]);
const css=sheets.map(p=>read(p.slice(1))).join('\n');
const chrome=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium']
 .find(p=>p&&existsSync(p));
test('Stripe light UI survives real browser cascade at desktop and mobile', {timeout:45000},async t=>{
 if(!chrome){t.skip('Chromium not installed');return;}
 let browser;
 try{browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});}
 catch{t.skip('Chromium cannot launch');return;}
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:900}});
   const fixture=index.replace('class="app-shell hidden"','class="app-shell"')
    .replaceAll(/<link rel="stylesheet"[^>]+>/g,'')
    .replaceAll(/<script[^>]*><\/script>/g,'');
   await page.setContent(fixture,{waitUntil:'domcontentloaded'});
   await page.addStyleTag({content:css});
   await page.evaluate(()=>{
    const root=document.querySelector('#view');
    root.innerHTML='<div class="px-overview et-board"><div class="et-board-grid">'+
     '<section class="et-hero"><h2>Sócio</h2><p>Campanhas</p></section>'+
     '<section class="et-card"><h2>Resultados</h2><span class="et-card-title">Indicadores</span></section>'+
     '<section class="et-kpi"><strong class="et-kpi-value">970</strong>'+
     '<span class="et-kpi-label">Cliques</span></section></div></div>';
   });
   const current=await page.evaluate(()=>{
    const style=s=>getComputedStyle(document.querySelector(s));
    const xy=s=>document.querySelector(s).getBoundingClientRect();
    return {
     bg:style('#appShell').backgroundColor,
     theme:style('#appShell').colorScheme,
     card:style('.et-card').backgroundColor,
     cardText:style('.et-card .et-card-title').color,
     heroText:style('.et-hero h2').color,
     menu:style('.topbar').display,
     shell:xy('#appShell').width,
     topbar:xy('.topbar').width,
     kpi:xy('.et-kpi').width
    };
   });
   assert.equal(current.bg,'rgb(247, 248, 250)',JSON.stringify({width,current}));
   assert.equal(current.card,'rgb(255, 255, 255)',JSON.stringify({width,current}));
   assert.equal(current.cardText,'rgb(32, 39, 53)',JSON.stringify({width,current}));
   assert.equal(current.heroText,'rgb(32, 39, 53)',JSON.stringify({width,current}));
   assert(current.shell<=width+2&&current.topbar<=width+2,JSON.stringify({width,current}));
   assert(current.kpi>100,JSON.stringify({width,current}));
   await page.close();
  }
 }finally{await browser.close();}
});
