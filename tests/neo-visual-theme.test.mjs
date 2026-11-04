import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
test('visual theme progressively upgrades to lavender without fictitious financial data',()=>{
 const old=read('neo-theme.css'),css=read('cloud-theme.css'),js=read('app.js'),html=read('index.html');
 assert.match(old,/\.neo-dashboard\{display:grid/);
 assert.match(css,/--bg:#e9e6f1/);
 assert.match(css,/\.lucid-dashboard/);
 assert.ok(html.indexOf('/cloud-theme.css')>html.indexOf('/app.css'),'light theme loads after base CSS');
 assert.doesNotMatch(html,/href="\/neo-theme\.css"/);
 assert.match(js,/Movimento do atendimento/);
 assert.match(js,/Mensagens recebidas e enviadas/);
 assert.match(js,/activityTicks\(trend\)/);
 assert.match(js,/api\('\/api\/inbox'/);
 assert.doesNotMatch(js,/\$10,120|\$12,850|Trusted by Thousands|Investments/);
});
test('all tenant modules remain navigable with only one IA sidebar menu item',()=>{
 const html=read('index.html'),js=read('app.js');
 for(const module of ['overview','inbox','channels','products','training','team','admin']){
  assert.match(html,new RegExp('data-view="'+module+'"'));
 }
 assert.doesNotMatch(html,/data-view="agent"/);
 assert.match(js,/data-ai-tab="agent"/);
 assert.match(js,/mountAiGuideTabs/);
 assert.match(html,/id="quickSearchBtn"/);
 assert.match(html,/id="commandOverlay"/);
 assert.match(js,/changeView\(b\.dataset\.searchView\)/);
 assert.match(js,/platformOwner/);
 assert.match(js,/aria-pressed/);
});
