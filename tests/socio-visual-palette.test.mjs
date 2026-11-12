import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('public/socio-stripe-system.css'),html=read('public/index.html'),server=read('server.mjs');
test('Stripe-inspired paper, ink, violet and border are the only canonical palette',()=>{
 for(const token of ['--stripe-canvas:#f7f8fa','--stripe-card:#fff',
  '--stripe-ink:#202735','--stripe-muted:#667085','--stripe-accent:#605dec',
  '--stripe-line:#e5e7eb']){
  assert(css.includes(token),token);
 }
 assert.match(css,/#appShell\[data-workspace="master"\]/);
 assert.match(css,/\.px-kpi/);
 assert.match(css,/\.wa-inbox/);
 assert.match(css,/\.master-kpi/);
});
test('old glass style layers are not loaded; new theme is the last stylesheet',()=>{
 const imports=[...html.matchAll(/<link rel="stylesheet" href="(\/[^"]+)/g)].map(m=>m[1]);
 assert(imports.at(-1).startsWith('/socio-stripe-system.css?v='));
 for(const old of ['socio-glass-motion.css','socio-glass-enforced.css','socio-premium-polish.css',
  'socio-contrast-audit.css','socio-motion-refined.css','socio-luminous-glass.css']){
  assert(!imports.some(x=>x.includes('/'+old)),old);
 }
 assert(server.includes("'/socio-stripe-system.css'"));
 assert.match(html,/meta name="theme-color" content="#f7f8fa"/);
});
test('single stylesheet has balanced blocks and accessible motion modes',()=>{
 const content=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let depth=0;for(const x of content){depth+=(x==='{')-(x==='}');assert(depth>=0);}
 assert.equal(depth,0);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/prefers-contrast:more/);
});
