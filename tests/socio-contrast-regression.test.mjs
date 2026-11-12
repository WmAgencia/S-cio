import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const contrastCss=read('public/socio-contrast-audit.css');
const premium=read('public/socio-premium-polish.css');
const enforced=read('public/socio-glass-enforced.css');
const html=read('public/index.html');
const server=read('server.mjs');
const app=read('public/app.js');
const dashboard=read('public/socio-workspace-ui.js');
const all=contrastCss+premium+enforced;

const lum=h=>{
 const rgb=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
 return rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
  .reduce((acc,v,i)=>acc+v*[.2126,.7152,.0722][i],0);
};
const ratio=(a,b)=>{
 const x=lum(a),y=lum(b);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};

test('final contrast stylesheet is served and outranks all historic themes',()=>{
 assert.match(html,/\/socio-contrast-audit\.css\?v=20261112a/);
 assert(server.includes("'/socio-contrast-audit.css'"));
 assert(html.indexOf('/socio-contrast-audit.css')>html.indexOf('/socio-premium-polish.css'));
 assert(html.indexOf('/socio-contrast-audit.css')>html.indexOf('/socio-glass-enforced.css'));
 const blocks=contrastCss.replace(/\/\*[\s\S]*?\*\//g,'');
 let braces=0;
 for(const c of blocks){
  if(c==='{')braces++;
  if(c==='}')braces--;
  assert(braces>=0,'unbalanced CSS closing brace');
 }
 assert.equal(braces,0,'unbalanced CSS rules');
 assert.doesNotMatch(blocks,/javascript:|@import|url\s*\(\s*https?:/i);
});

test('reported conversations period controls have explicit dark/bright pairs',()=>{
 for(const marker of [
  '.px-chart-actions {','.px-chart-actions button.px-range-btn {',
  '.px-chart-actions button.px-range-btn.active,',
  '.px-chart-actions button.px-range-btn[aria-pressed="true"]',
  'background:#c9f16d!important','color:#233119!important',
  '.px-graph-counts>div>span','.px-chart-wrap {',
  '.px-axis>span','.px-legend>span'
 ])assert(contrastCss.includes(marker),marker);
 assert.match(dashboard,/Atividade de conversas/);
 assert.match(dashboard,/data-px-chart-range=/);
 assert.match(dashboard,/aria-pressed=/);
 assert.match(contrastCss,/\.px-svg path\[stroke="#7650ed"\]/);
 assert.match(contrastCss,/\.px-svg path\[stroke="#16a778"\]/);
 assert.match(contrastCss,/\.px-legend \.px-dot\.purple/);
 assert.match(contrastCss,/\.px-legend \.px-dot\.green/);
});

test('audit covers all major production and Master surfaces, including dialogs',()=>{
 const surfaces=[
  '.lucid-filter','.ember-filter','.ai-guide-tabs','.settings-tabs',
  '.px-marketing-filters','.px-range-tabs','.lucid-stat-lilac',
  '.lucid-stat-peach','.lucid-intelligence-panel','.lucid-whatsapp-panel',
  '.support-block','.file-drop','.ps-mode','.ps-choices button',
  '.ps-feed','.ps-composer','.ps-bubble','.ps-card-dialog',
  '.ps-optional-training','.ps-markdown-advanced',
  '.feature-choice','.socio-training-center','.socio-knowledge-edit',
  '.socio-team-controls select','.commerce-page .card','.socio-product-popup .card',
  '.px-wa-overview-list>div','.px-campaign-picker','.px-campaign-dialog',
  '.px-preview-text','.px-dialog-help','.meta-browser-operations',
  '.master-company-filters input','.master-company-edit-note',
  '.master-status-trial','.wa-status-strip>div','.socio-billing-head button'
 ];
 for(const name of surfaces)assert(contrastCss.includes(name),'missing dark repair: '+name);
 assert.match(contrastCss,/body:has\(#appShell:not\(\.hidden\)\)/);
 assert.match(contrastCss,/@media\(prefers-reduced-transparency:reduce\)/);
 assert.match(contrastCss,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(contrastCss,/\.ps-error/);
 assert.match(contrastCss,/\.bubble\.note/);
 assert.match(contrastCss,/\.badge\.green/);
 assert.match(contrastCss,/\.badge\.yellow/);
 assert.match(contrastCss,/\.wa-steps b/);
 assert.match(contrastCss,/QR codes and verified brand images are intentionally not recolored/);
 assert.match(app,/const masterViews=/);
});

test('color pairs pass WCAG AA text contrast on dark and lime surfaces',()=>{
 const pairs=[
  ['#d8e6d7','#28332d','period idle'],
  ['#233119','#c9f16d','period active'],
  ['#c5d2c6','#202c26','chart labels'],
  ['#c4d4c5','#26322d','chart KPI labels'],
  ['#c2d0c2','#2c3831','training secondary text'],
  ['#edf6e8','#344038','ad controls'],
  ['#d2e0d1','#2a3730','modal labels'],
  ['#eaf4e6','#2c3831','card copy'],
  ['#c0d0c1','#2c3831','secondary metadata'],
  ['#f5d5a4','#2c3831','warning copy'],
  ['#f3f9ef','#2c3831','bright headings'],
  ['#e3f2dc','#26322d','inactive tabs']
 ];
 for(const [fg,bg,label] of pairs)assert(ratio(fg,bg)>=4.5,
  label+' contrast '+ratio(fg,bg).toFixed(2)+':1 is below AA');
});

test('no UI media is inadvertently overwritten with opaque placeholder colors',()=>{
 assert.doesNotMatch(contrastCss,/(?:\.wa-qr-image|\.meta-browser-screen)\s*\{/);
 assert.doesNotMatch(contrastCss,/\.px-feature-poster\s*\{/);
 assert.doesNotMatch(contrastCss,/\.px-svg\s*path\s*\{/);
 assert.doesNotMatch(contrastCss,/grid-template-(?:columns|rows)\s*:/);
 assert.doesNotMatch(contrastCss,/\b(?:grid-area|order)\s*:/);
});
