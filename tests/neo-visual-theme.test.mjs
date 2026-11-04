import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
test('reference-style visual theme uses dark chocolate, orange and green, without fake balances',()=>{
 const css=read('neo-theme.css'),js=read('app.js'),html=read('index.html');
 assert.match(css, /--bg:#130d09/);
 assert.match(css, /--orange:#f4772d/);
 assert.match(css, /--green:#69d5a2/);
 assert.match(css, /\.neo-dashboard\{display:grid/);
 assert.match(css, /\.neo-side-orange\{/);
 assert.match(html, /href="\/neo-theme\.css"/);
 assert.match(js, /Atividade de atendimento/);
 assert.match(js, /Mensagens recebidas e enviadas/);
 assert.match(js, /dashboardBars\(months\)/);
 assert.match(js, /api\('\/api\/inbox'/);
 assert.doesNotMatch(js,/\$10,120|\$12,850|Trusted by Thousands|Investments/);
});
test('all tenant modules are still navigable and the command palette actually routes',()=>{
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
