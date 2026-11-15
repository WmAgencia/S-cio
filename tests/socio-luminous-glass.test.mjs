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
 // The reference theme is the last DESIGN layer; motion.css only animates it.
 assert.equal(imports.filter(x=>!x.startsWith('/socio-motion.css')).at(-1),'/socio-reference.css');
 assert.equal(imports.at(-1),'/socio-motion.css');
 assert(server.includes("'/socio-ethereal.css'"));
 assert(server.includes("'/socio-reference.css'"));
 assert(!imports.includes('/socio-luminous-glass.css'));
 assert(!imports.includes('/socio-glass-motion.css'));
 assert.match(html,/<meta name="theme-color" content="#08080a">/);
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
test('Chromium computes the Ethereal dark surface with readable cards', {timeout:40000},async t=>{
 if(!chrome){t.skip('Chromium unavailable');return;}
 let browser;
 try{browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});}
 catch(err){t.skip('Browser unavailable: '+String(err).slice(0,90));return;}
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent('<html><head><style>'+imports.map(p=>read('public'+p)).join(String.fromCharCode(10))+'</style></head><body>'+
   '<div id="appShell" class="app-shell" data-workspace="production">'+
    '<div class="app-main"><header class="topbar">Sócio</header>'+
    '<main id="view"><div class="px-workspace px-overview et-board"><div class="et-board-grid">'+
     '<section class="et-hero"><div class="et-hero-value"><strong>R$ 1.000,00</strong></div></section>'+
     '<section class="et-kpi"><b class="et-kpi-value">22</b><span class="et-kpi-label">Leads</span></section>'+
     '<section class="et-card"><h2 class="et-card-title">Resultados</h2></section>'+
    '</div></div></main></div></div>'+
    '<div id="socioThalitaDock"><section class="px-assistant-window">Thalita</section></div></body></html>');
  const data=await page.evaluate(()=>{
   const style=q=>getComputedStyle(document.querySelector(q));
   const rgb=v=>v.match(/\d+/g)?.map(Number)||[0,0,0];
   const lum=c=>{const [r,g,b]=rgb(c).map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b;};
   const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
   const card=style('#appShell #view .et-card').backgroundColor;
   return {
    shell:style('#appShell').backgroundColor,
    body:getComputedStyle(document.body).colorScheme,
    card, heroText:style('#appShell #view .et-hero-value strong').color,
    cardText:style('#appShell #view .et-card-title').color,
    label:style('#appShell #view .et-kpi-label').color,
    cardContrast:ratio(style('#appShell #view .et-card-title').color,card),
    labelContrast:ratio(style('#appShell #view .et-kpi-label').color,card),
    assistantPosition:style('#socioThalitaDock .px-assistant-window').position
   };
  });
  // The Ethereal canvas is dark, and no card may paint the retired light surface.
  const shellLum=(data.shell.match(/\d+/g)||[255,255,255]).map(Number).slice(0,3)
   .reduce((m,c)=>m+c,0)/3;
  assert(shellLum<40,'shell stays dark, never the retired light canvas: '+data.shell);
  assert.notEqual(data.card,'rgb(255, 255, 255)','cards never fall back to the light white surface');
  assert(data.cardContrast>=4.5,'card title contrast '+data.cardContrast.toFixed(2));
  assert(data.labelContrast>=4.5,'muted label contrast '+data.labelContrast.toFixed(2));
  assert.equal(data.assistantPosition,'fixed');
  for(const width of [1900,1440,390]){
   await page.setViewportSize({width,height:900});
   const bounds=await page.locator('#appShell').evaluate(el=>{
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:innerWidth};
   });
   assert.equal(bounds.x,0,'The application starts at the browser left edge');
   assert.equal(bounds.y,0,'The application starts at the browser top edge');
   assert.equal(bounds.width,bounds.viewport,'The application fills the browser width');
   assert(bounds.height>=900,'The application fills the browser height');
  }
  console.log('Ethereal dark surface verified: '+JSON.stringify(data));
 }finally{await browser.close();}
});
