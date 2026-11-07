import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=read('public/index.html');
const js=read('public/app.js');
const server=read('server.mjs');
const meta=read('public/socio-workspace-ui.js');
test('Master/production switch is restricted to initial owner account',()=>{
 assert.match(html,/id="masterProductionSwitch"[^>]+hidden/);
 assert.match(js,/const isPrimaryMaster=\(\)=>!!\(state\.me\?\.user\?\.platformOwner&&state\.me\?\.user\?\.homeTenantId\)/);
 assert.match(js,/if\(!isPrimaryMaster\(\)\)return;/);
 assert.match(js,/if\(state\.view==='admin'\)/);
 assert.match(js,/api\('\/api\/admin\/switch','POST',\{tenantId:homeTenantId\}\)/);
 assert.match(js,/await changeView\('admin'\)/);
 assert.match(server,/homeTenantId:\(a\.platform_owner&&a\.role==='owner'\)\?a\.tenant_id:null/);
 assert.match(server,/if\(method==='POST'&&pathname==='\/api\/admin\/switch'\)\{\s*needPlatform\(a\)/);
});
test('Sales is gone from navigation and global search but business data stays available',()=>{
 assert.doesNotMatch(html,/data-view="sales"/);
 assert.match(js,/key!=='sales'&&viewAvailable\(key\)/);
 assert.match(js,/window\.SocioSales\.render/);
});
test('Meta does not render the interpretation results card',()=>{
 assert.doesNotMatch(meta,/section\('Interpretação dos resultados'/);
 assert.match(meta,/selectedAdset\?'Anúncios do conjunto'/);
});
