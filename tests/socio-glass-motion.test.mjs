import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const file=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const html=file('index.html'),css=file('socio-glass-motion.css'),motion=file('socio-glass-motion.js');
test('glass/motion is the final skin after approved application CSS and JS',()=>{
  assert.ok(html.indexOf('/socio-glass-motion.css')>html.indexOf('/socio-master.css'));
  assert.ok(html.indexOf('/socio-glass-motion.js')>html.indexOf('/app.js'));
  assert.match(html,/id="productionNav"/);
  assert.match(html,/id="masterNav"/);
  assert.match(html,/id="view"/);
  assert.match(css,/socio-glass-nav-pill/);
  assert.match(css,/will-change:clip-path/);
  assert.doesNotMatch(css,/--socio-glass-lime|\.px-panel\s*\{|\.master-panel\s*\{/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('motion is valid JS, respects accessible motion choice and never replaces navigation handlers',()=>{
  assert.doesNotThrow(()=>new vm.Script(motion,{filename:'socio-glass-motion.js'}));
  assert.match(motion,/prefers-reduced-motion: reduce/);
  assert.match(motion,/clipPath/);
  assert.match(motion,/duration:560/);
  assert.match(motion,/attributeFilter:\['class'\]/);
  assert.doesNotMatch(motion,/\\.innerHTML\s*=|fetch\(|\\.addEventListener\('click'/);
});
test('existing Sócio layout, business logic and core navigation remain untouched by new skin',()=>{
  const app=file('app.js');
  assert.match(app,/function changeView/);
  assert.match(app,/state\.view=next/);
  assert.match(app,/data-view/);
  for(const section of ['overview','inbox','connections','marketing','products','training','team','admin','masterOverview']){
    assert.match(app,new RegExp("next==='"+section+"'"));
  }
  assert.doesNotMatch(css,/\.px-kpi-grid\s*\{|\.master-main-grid\s*\{|\.ember-primary-grid\s*\{|\.ember-secondary-grid\s*\{/);
  assert.doesNotMatch(motion,/dataset\.view\s*=|state\.view\s*=|\\.replaceChildren\(/);
});
