import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('public/socio-premium-polish.css');
const html=read('public/index.html');
const server=read('server.mjs');
const app=read('public/app.js');
const inbox=read('public/inbox.js');
const thalita=read('public/socio-thalita-ui.js');
const workspace=read('public/socio-workspace-ui.js');

test('polish CSS exists, is last, is cache-busted, and the server returns it',()=>{
 assert(existsSync(new URL('../public/socio-premium-polish.css',import.meta.url)));
 assert.match(html,/\/socio-premium-polish\.css\?v=20261112c/);
 assert(html.indexOf('socio-premium-polish.css')>html.indexOf('socio-glass-enforced.css'));
 assert(server.includes("'/socio-premium-polish.css'"));
});

test('the three screens have an explicit, scoped design system',()=>{
 for(const cls of ['.px-budget-account','.px-kpi','.px-live-indicator',
   '.wa-inbox','.wa-filters button','.wa-list-row.active',
   '.wa-thread-header','.wa-message-bubble','.wa-compose-row textarea',
   '.wa-compose-send','.px-assistant-window:not(.hidden)',
   '.px-assistant-feed','.px-assistant-suggestions button',
   '#thalitaInput','.px-assistant-actions .btn.primary']){
  assert(css.includes(cls),'missing component '+cls);
 }
 assert.match(css,/#socioThalitaDock/);
 assert.match(css,/body #appShell #view \.wa-inbox/);
 assert.match(css,/body #appShell #view \.px-overview/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/@media\(prefers-reduced-transparency:reduce\)/);
 assert.doesNotMatch(css,/\.px-kpi-grid\s*\{[^}]*grid-template-(?:columns|rows)\s*:/s);
 assert.doesNotMatch(css,/\.px-budget-top-grid\s*\{[^}]*grid-template-(?:columns|rows)\s*:/s);
 assert.doesNotMatch(css,/\b(?:grid-area|order)\s*:/);
});

test('assistant is dark and white-on-white regressions cannot recur',()=>{
 assert.match(css,/#socioThalitaDock \.px-assistant-feed\s*\{[\s\S]*?background:[^;]*#222e29/);
 assert.match(css,/#socioThalitaDock #thalitaInput\s*\{[\s\S]*?background:#1a2621!important/);
 assert.match(css,/#socioThalitaDock #thalitaInput\s*\{[\s\S]*?color:#f1f8eb!important/);
 assert.match(css,/#socioThalitaDock \.px-assistant-line p\s*\{[\s\S]*?color:#eef6e9!important/);
 assert.match(css,/#socioThalitaDock \.px-assistant-suggestions button\s*\{[\s\S]*?color:#e3f2dd!important/);
 assert.match(css,/button\.wa-inbox-connect,[\s\S]*?button\.wa-compose-send/);
 assert.match(css,/color:#243116!important/);
 assert.match(thalita,/id="socioThalitaDock"|instance\.id='socioThalitaDock'/);
 assert.match(thalita,/data-thalita-send/);
 assert.match(thalita,/data-thalita-voice/);
});

test('new CSS has valid balanced blocks and contains no accidental script changes',()=>{
 const noComments=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let depth=0;
 for(const ch of noComments){
  if(ch==='{')depth++;
  if(ch==='}')depth--;
  assert(depth>=0,'unexpected closing block');
 }
 assert.equal(depth,0);
 assert.doesNotMatch(css,/javascript:|@import|url\s*\(\s*https?:/i);
 assert.match(inbox,/wa-compose-send/);
 assert.match(workspace,/px-budget-top/);
 assert.match(app,/changeView/);
});

const L=hex=>{
 const a=[0,2,4].map(i=>parseInt(hex.slice(1).slice(i,i+2),16)/255)
  .map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 return a[0]*.2126+a[1]*.7152+a[2]*.0722;
};
const cr=(f,b)=>(Math.max(L(f),L(b))+.05)/(Math.min(L(f),L(b))+.05);
test('screenshot text colors maintain accessible contrast on corresponding surfaces',()=>{
 const pairs=[
  ['#f4f7f2','#252e2d'],['#d4ddd2','#35403c'],
  ['#c0cbc1','#28322f'],['#d2dfd1','#222b28'],
  ['#eef6e9','#303d35'],['#e3f2dd','#26312c'],
  ['#b6c8b9','#1a2621'],['#243116','#c9f16d'],
  ['#f6faf4','#28322f']
 ];
 for(const [fg,bg] of pairs){
  const ratio=cr(fg,bg);
  assert(ratio>=4.5,'contrast '+fg+' on '+bg+' = '+ratio.toFixed(2));
 }
});
