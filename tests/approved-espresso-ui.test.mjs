import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');

test('approved espresso palette has orange glow, green status and is loaded last',()=>{
 const html=load('index.html'),css=load('ember-theme.css');
 assert.match(html,/meta name="theme-color" content="#120b07"/);
 assert.ok(html.indexOf('/ember-theme.css')>html.indexOf('/cloud-theme.css'));
 for(const value of ['--bg:#100907','--orange:#ff791c','--green:#58d08a',
  '.ember-kpi-grid','.ember-primary-grid','.ember-secondary-grid','.ember-qr-card',
  '.ember-ai-card','.ember-recent-card','.ember-status.green']){
  assert.ok(css.includes(value),'missing approved visual token / component: '+value);
 }
 assert.match(css,/\.sidebar\{width:218px/);
 assert.match(css,/@media\(max-width:630px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('approved layout uses real tenant counts, three live chart filters and no fake QR',()=>{
 const js=load('app.js');
 assert.match(js,/api\('\/api\/dashboard'/);
 assert.match(js,/api\('\/api\/waakg\/channels'/);
 assert.match(js,/api\('\/api\/dashboard\/activity\?range=1m'/);
 for(const period of ['7d','1m','90d'])assert.match(js,new RegExp('data-range="'+period+'"'));
 assert.match(js,/status==='connected'/);
 assert.match(js,/connectedWhatsApps/);
 assert.match(js,/whatsappSummary/);
 assert.match(js,/dashboardConnectWhatsApp/);
 assert.match(js,/Conexão por QR Code/);
 assert.match(js,/window\.SocioUX\.openQr/);
 assert.doesNotMatch(load('index.html'),/data-view="channels"/);
 assert.match(js,/data-go="training"/);
 assert.match(js,/aiRow\('user','Personalidade'/);
 assert.match(js,/aiRow\('play','Testar IA'/);
 assert.doesNotMatch(js,/1\.984|28\.430|8\.430|1\.240 mensagens|Rafael Santos/);
});
