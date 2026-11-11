import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const css=load('public/socio-glass-enforced.css');
const motion=load('public/socio-glass-motion.css');
const html=load('public/index.html');
const server=load('server.mjs');

test('visual palette follows the reference: quiet graphite, neutral glass, one accent',()=>{
 for(const marker of ['--socio-bg:#171b1b','--socio-sidebar:#1c2325','--socio-top:#293133',
  '--socio-accent:#c9f16d','--socio-ink:#f1f2ef','--socio-muted:#a3aba7',
  '--socio-glass-panel:linear-gradient','--socio-glass-shadow:0 5px 21px']){
  assert.ok(css.includes(marker),marker);
 }
 assert.match(css,/#appShell\[data-workspace="master"\]/);
 assert.doesNotMatch(css,/--socio-accent:#(?:c7f47f|a5c5ff)|#(?:6440d8|7b48ff|f47722)\b/i);
 assert.match(css,/\.badge\.green/);
 assert.match(css,/\.badge\.yellow/);
 assert.match(css,/\.badge\.red/);
});
test('legacy visual effects no longer fight the final style',()=>{
 assert.ok(!motion.includes('--socio-glass-lime'));
 assert.ok(!motion.includes('.px-panel{'));
 assert.ok(!motion.includes('.master-panel{'));
 assert.match(motion,/socio-glass-nav-pill/);
 assert.match(motion,/will-change:clip-path/);
 assert.ok(html.indexOf('/socio-glass-motion.css')<html.indexOf('/socio-glass-enforced.css'));
 for(const file of ['socio-glass-motion.css','socio-glass-enforced.css']){
  assert.ok(html.includes('/'+file+'?v=20261111-refined'));
  assert.ok(server.includes("'"+'/'+file+"'"));
 }
 assert.match(html,/meta name="theme-color" content="#202626"/);
});
test('refined theme protects every product workspace and does not rearrange the dashboard',()=>{
 for(const marker of ['.px-panel','.px-ads-metric','.master-panel','.master-kpi',
  '.ember-card','.ember-kpi','.wa-message-bubble','.socio-training-center',
  '.catalog-product','.socio-popup-surface','.px-assistant-window',
  '.auth-screen:not(.hidden)','.badge.green','.loading']){
  assert.ok(css.includes(marker),marker);
 }
 assert.doesNotMatch(css,/\bgrid-template-(?:columns|rows)\s*:/);
 assert.doesNotMatch(css,/\b(order|grid-area)\s*:/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('new CSS is balanced and no rule is accidentally swallowed by a comment',()=>{
 for(const source of [css,motion]){
  const withoutComments=source.replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(withoutComments,/\/\*|(?:^|[^\*])\*\//);
  let depth=0;
  for(const char of withoutComments){
   if(char==='{')depth++;
   if(char==='}')depth--;
   assert(depth>=0);
  }
  assert.equal(depth,0);
 }
});
