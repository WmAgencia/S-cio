import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const server=read('server.mjs');
const css=read('public/socio-glass-enforced.css');
const motion=read('public/socio-glass-motion.js');
const workspace=read('public/socio-workspace-ui.js');
const app=read('public/app.js');

const luminosity=hex=>{
 const colors=[0,2,4].map(i=>parseInt(hex.replace('#','').slice(i,i+2),16)/255);
 return colors.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4)
  .reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
};
const contrast=(a,b)=>{
 const x=luminosity(a),y=luminosity(b);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};

test('Every CSS and JavaScript linked in the dashboard HTML is served, including Master and billing',()=>{
 const imports=[...html.matchAll(/<(?:script|link)\s+[^>]*(?:src|href)="(\/[^"]+)"/g)]
  .map(m=>m[1].split('?')[0]).filter(path=>path.endsWith('.js')||path.endsWith('.css'));
 assert(imports.length>=30);
 const missing=imports.filter(path=>!server.includes("'"+path+"'")||
  !existsSync(new URL('../public'+path,import.meta.url)));
 assert.deepEqual(missing,[], 'Dashboard resources MUST be served, not 404: '+missing.join(', '));
 for(const name of ['/socio-master.css','/socio-master-dashboard.js','/meta-billing-ui.js'])
  assert(imports.includes(name));
});

test('Graphite text, secondary labels and primary buttons meet WCAG AA on solid surfaces',()=>{
 const pairs=[
  ['#f1f2ef','#272e2c'],
  ['#b7c4ba','#303936'],
  ['#a3aba7','#293132'],
  ['#233019','#c9f16d'],
  ['#b5bfba','#202828'],
  ['#bec9c1','#333b39'],
  ['#d8f1b8','#303936'],
  ['#f6d5a2','#303936']
 ];
 for(const [fg,bg] of pairs)assert(contrast(fg,bg)>=4.5,
  fg+' on '+bg+' has only '+contrast(fg,bg).toFixed(2)+':1 contrast');
 for(const marker of ['--socio-accent:#c9f16d','--socio-soft:#b2bdb5',
  'body #appShell #view :is(','text-shadow:none!important',
  'body #appShell #view :is(.btn.primary','color:inherit!important']){
  assert(css.includes(marker),marker);
 }
});

test('Apple-inspired glass stays on functional controls, not data cards or giant page clips',()=>{
 assert.match(css,/\.nav>\.socio-glass-nav-pill/);
 assert.match(css,/backdrop-filter:blur\(18px\)/);
 assert.match(css,/backdrop-filter:none!important/);
 assert.match(css,/@media\(prefers-reduced-transparency:reduce\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/@supports not/);
 assert.doesNotMatch(motion,/filter:'blur\(10px\)'|clipPath:'inset\(0 100%/);
 assert.match(motion,/duration:280/);
 assert.doesNotThrow(()=>new vm.Script(motion));
});

test('Dashboard first paints operational metrics and fetches Meta independently',()=>{
 assert.match(workspace,/async function overview\(\{root,api,me,navigate,activityRange='1m',progressive=false\}\)/);
 assert.match(app,/progressive:true/);
 assert.match(workspace,/Promise\.all\(calls\.slice\(4\)\)/);
 assert.match(workspace,/if\(renderId!==renderSerial\|\|!root\.isConnected/);
 assert.match(workspace,/progressive:false/);
 assert.match(workspace,/getCache\.clear/);
 assert.match(workspace,/if\(liveRefreshBusy\|\|serial!==liveRefreshSerial/);
 assert.match(workspace,/\},60000\)/);
 assert.match(workspace,/ads&&googleAdsVisible\(\)\?googleOverview\(\):Promise\.resolve\(\{ok:false\}\)/);
 assert.doesNotMatch(workspace,/optional\(api,'\/api\/google-ads\/campaigns\?period=today'\)/);
});

test('Slow GET requests cannot leave screens loading forever, without timing out explicit writes',()=>{
 assert.match(app,/method==='GET'&&!opts\.signal/);
 assert.match(app,/setTimeout\(\(\)=>controller\.abort\(\),18000\)/);
 assert.match(app,/Tempo limite da consulta atingido/);
 assert.match(app,/clearTimeout\(timeout\)/);
 assert.match(app,/if\(!resp\.ok\)/);
 assert.match(app,/data\.error\|\|'Falha ao acessar o servidor/);
 assert.doesNotThrow(()=>new vm.Script(app));
 assert.doesNotThrow(()=>new vm.Script(workspace));
});
