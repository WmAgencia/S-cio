import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const file=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const html=file('index.html'),css=file('socio-stripe-system.css'),motion=file('socio-entry-motion.js');
test('previous full-page glass animation is replaced by one light theme',()=>{
 assert(html.indexOf('/socio-stripe-system.css')>html.indexOf('/socio-master.css'));
 assert(!html.includes('<script src="/socio-glass-motion.js'));
 assert(!html.includes('href="/socio-glass-motion.css'));
 assert.match(html,/id="productionNav"/);
 assert.match(html,/id="masterNav"/);
 assert.match(html,/id="view"/);
 assert.match(css,/--stripe-accent:#605dec/);
 assert.match(css,/\.nav>\.socio-glass-nav-pill\{display:none!important/);
});
test('entrance effect is valid, accessible, and does not take over navigation',()=>{
 assert.doesNotThrow(()=>new vm.Script(motion));
 assert.match(motion,/prefers-reduced-motion: reduce/);
 assert.match(motion,/duration=cheapMotion\?\.matches\?165:215/);
 assert.match(motion,/IntersectionObserver/);
 assert.match(motion,/translate3d/);
 assert.doesNotMatch(motion,/blur\(|clipPath|clip-path|filter:/);
 assert.doesNotMatch(motion,/fetch\(|\.addEventListener\('click'/);
});
test('existing navigation and all business modules remain wired',()=>{
 const app=file('app.js');
 assert.match(app,/function changeView/);
 assert.match(app,/state\.view=next/);
 assert.match(app,/data-view/);
 for(const section of ['overview','inbox','connections','marketing','products','training','team','admin','masterOverview']){
  assert.match(app,new RegExp("next==='"+section+"'"));
 }
 assert.doesNotMatch(motion,/dataset\.view\s*=|state\.view\s*=|\.replaceChildren\(/);
});
