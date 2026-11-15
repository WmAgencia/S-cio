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
test('Ethereal UI survives the real browser cascade at desktop and mobile', {timeout:45000},async t=>{
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
     '<section class="et-hero"><div class="et-hero-value"><strong>R$ 1.000,00</strong></div></section>'+
     '<section class="et-card"><h2>Resultados</h2><span class="et-card-title">Indicadores</span></section>'+
     '<section class="et-kpi"><strong class="et-kpi-value">970</strong>'+
     '<span class="et-kpi-label">Cliques</span></section></div></div>';
   });
   const current=await page.evaluate(()=>{
    const style=s=>getComputedStyle(document.querySelector(s));
    const xy=s=>document.querySelector(s).getBoundingClientRect();
    const lum=c=>{const [r,g,b]=(c.match(/\d+/g)||[0,0,0]).map(Number).slice(0,3);
     const lin=x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)};
     return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)};
    const card=style('.et-card').backgroundColor;
    const cardText=style('.et-card .et-card-title').color;
    const ratio=(Math.max(lum(card),lum(cardText))+.05)/(Math.min(lum(card),lum(cardText))+.05);
    return {
     bg:style('#appShell').backgroundColor,
     shellLum:lum(style('#appShell').backgroundColor),
     cardContrast:ratio,
     heroText:style('.et-hero-value strong').color,
     menu:style('.topbar').display,
     shell:xy('#appShell').width,
     topbar:xy('.topbar').width,
     kpi:xy('.et-kpi').width
    };
   });
   // Ethereal: dark canvas, readable ink, and the board never exceeds the window.
   assert(current.shellLum<0.08,'dark canvas at '+width+'px: '+current.bg);
   assert(current.cardContrast>=4.5,'readable cards at '+width+'px: '+current.cardContrast.toFixed(2));
   assert.notEqual(current.heroText,'rgb(32, 39, 53)','hero ink follows the dark theme');
   assert(current.shell<=width+2&&current.topbar<=width+2,JSON.stringify({width,current}));
   // In the board grid a KPI tile shares a row with the hero; it only needs
   // to keep a readable minimum width.
   assert(current.kpi>=24,JSON.stringify({width,current}));
   await page.close();
  }
 }finally{await browser.close();}
});
