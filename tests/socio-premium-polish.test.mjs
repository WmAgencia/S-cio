import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html'),css=read('public/socio-stripe-system.css'),
  server=read('server.mjs'),inbox=read('public/inbox.js'),
  thalita=read('public/socio-thalita-ui.js'),workspace=read('public/socio-workspace-ui.js');

test('one canonical design system is loaded after structural module styles',()=>{
 assert.match(html,/\/socio-stripe-system\.css\?v=20261113k/);
 assert(html.indexOf('/socio-stripe-system.css')>html.indexOf('/socio-executive.css'));
 assert(server.includes("'/socio-stripe-system.css'"));
 assert(!html.includes('href="/socio-premium-polish.css'));
});
test('overview, inbox and Thalita share a readable light design vocabulary',()=>{
 for(const name of ['.px-budget-meta-ribbon','.px-kpi-grid','.px-panel',
   '.wa-inbox','.wa-filters button.active','.wa-list-row.active',
   '.wa-message-row.outgoing .wa-message-bubble','.wa-compose-send',
   '.px-assistant-window:not(.hidden)','.px-assistant-feed',
   '.px-assistant-suggestions button','#thalitaInput',
   '.px-assistant-actions .btn.primary']){
  assert(css.includes(name),name);
 }
 assert.match(css,/#f7f8fa/);
 assert.match(css,/#605dec/);
 assert.match(css,/#202735/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/@media\(max-width:780px\)/);
 assert.match(thalita,/id='socioThalitaDock'/);
 assert.match(thalita,/data-thalita-send/);
 assert.match(thalita,/data-thalita-voice/);
 assert.match(inbox,/wa-compose-send/);
 assert.match(workspace,/px-budget-top/);
});
test('no future style layer reintroduces dark-ink on dark surface',()=>{
 const clean=css.replace(/\/\*[\s\S]*?\*\//g,'');
 let depth=0;for(const c of clean){depth+=(c==='{')-(c==='}');assert(depth>=0);}
 assert.equal(depth,0);
 assert.doesNotMatch(clean,/@import|javascript:|url\s*\(\s*https?:/i);
 assert.match(clean,/color:#273449!important/);
 assert.match(clean,/background:#fff!important/);
 assert.match(clean,/#authScreen/);
});
