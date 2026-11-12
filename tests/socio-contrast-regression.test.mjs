import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('public/socio-stripe-system.css');
const html=read('public/index.html');
const server=read('server.mjs');
const app=read('public/app.js');
const dashboard=read('public/socio-workspace-ui.js');

const luminance=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255)
 .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
 .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{
 const x=luminance(a),y=luminance(b);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};

test('canonical contrast layer loads after every structural stylesheet',()=>{
 assert.match(html,/\/socio-stripe-system\.css\?v=20261112a/);
 assert(server.includes("'/socio-stripe-system.css'"));
 assert(html.indexOf('/socio-stripe-system.css')>html.indexOf('/socio-master.css'));
 assert(!html.includes('href="/socio-contrast-audit.css'));
 const code=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let balance=0;
 for(const ch of code){balance+=(ch==='{')-(ch==='}');assert(balance>=0);}
 assert.equal(balance,0);
 assert.doesNotMatch(code,/javascript:|@import|url\s*\(\s*https?:/i);
});
test('period filters and sales charts have explicit light backgrounds and active state',()=>{
 for(const key of ['.px-chart-actions button.px-range-btn.active',
  '.px-chart-actions button.px-range-btn[aria-pressed="true"]',
  '.px-graph-counts','.px-chart-wrap','.px-axis','.px-legend',
  '.px-svg path[stroke="#7650ed"]','.px-svg path[stroke="#16a778"]',
  '.px-legend .px-dot.purple','.px-legend .px-dot.green']){
  assert(css.includes(key),key);
 }
 assert.match(dashboard,/Atividade de conversas/);
 assert.match(dashboard,/data-px-chart-range=/);
 assert.match(dashboard,/aria-pressed=/);
});
test('every major SaaS area has an explicit light theme and readable inputs',()=>{
 for(const key of ['.lucid-filter','.ai-guide-tabs','.settings-tabs',
  '.ps-interview-welcome','.ps-mode','.ps-bubble','.ps-choices button',
  '.socio-training-center','.socio-knowledge-edit','.feature-choice',
  '.px-campaign-dialog','.px-campaign-picker','.wa-inbox','.wa-compose-row textarea',
  '.socio-popup-surface','.socio-billing-dialog','.master-kpi',
  '.master-table','.master-company-filters','.catalog-product',
  '.commerce-lead-card','.px-conn-card','.px-kpi',
  '#socioThalitaDock','.px-assistant-actions .btn.primary']){
  assert(css.includes(key),key);
 }
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/prefers-contrast:more/);
 assert.match(css,/@media\(max-width:560px\)/);
});
test('key foreground/background token pairs satisfy WCAG AA',()=>{
 const pairs=[
  ['#344054','#ffffff','body text'],
  ['#667085','#ffffff','secondary text'],
  ['#202735','#f7f8fa','navigation ink'],
  ['#ffffff','#605dec','primary button'],
  ['#514ed5','#ffffff','text link'],
  ['#137147','#e9f8ef','connected status'],
  ['#98611c','#fff5e6','warning status'],
  ['#ab3244','#fff0f2','error status'],
  ['#526074','#f3f4f9','inactive filter'],
  ['#273449','#f8f9fc','chart values'],
 ];
 for(const [a,b,label] of pairs)assert(ratio(a,b)>=4.5,
  label+': '+ratio(a,b).toFixed(2)+':1 below WCAG AA');
});
test('access controls remain independent of appearance, QR quiet zone stays white',()=>{
 assert.match(app,/const masterViews=new Set/);
 assert.match(css,/socio-qr-image-wrap img/);
 assert.match(css,/background:#fff!important;image-rendering:pixelated/);
 assert.doesNotMatch(css,/@import/);
});
