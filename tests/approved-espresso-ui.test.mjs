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
 assert.match(js,/qr\?\.ready/);
 assert.match(js,/data:image\\\//);
 assert.match(js,/Gerado ao conectar/);
 assert.match(js,/A leitura de conversas depende de autorização/);
 assert.match(js,/aria-label="QR Code disponível após iniciar a conexão"/);
 assert.match(js,/data-go="channels"/);
 assert.match(js,/data-go="training"/);
 assert.match(js,/aiRow\('user','Personalidade'/);
 assert.match(js,/aiRow\('play','Testar IA'/);
 assert.doesNotMatch(js,/1\.984|28\.430|8\.430|1\.240 mensagens|Rafael Santos/);
});
