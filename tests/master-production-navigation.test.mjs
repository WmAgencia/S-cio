import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=read('public/index.html');
const js=read('public/app.js');
const server=read('server.mjs');
const meta=read('public/socio-workspace-ui.js');
test('Master and Production are isolated authenticated workspaces sharing the same login',()=>{
 assert.match(html,/id="masterProductionSwitch"[^>]+hidden/);
 assert.match(html,/data-workspace="production"/);
 assert.match(html,/id="workspaceKind"/);
 assert.match(js,/const isPrimaryMaster=\(\)=>!!\(state\.me\?\.user\?\.platformOwner&&state\.me\?\.user\?\.homeTenantId\)/);
 assert.match(js,/const isMasterView=\(\)=>isPrimaryMaster\(\)&&state\.workspace==='master'/);
 assert.match(js,/function workspaceFromLocation\(\)/);
 assert.match(js,/function initialWorkspaceView\(\)/);
 assert.match(js,/function workspaceUrl\(mode,section\)/);
 assert.match(js,/url\.searchParams\.set\('workspace',mode\)/);
 assert.match(js,/if\(isMasterView\(\)&&!masterViews\.has\(next\)\)return/);
 assert.match(js,/if\(!isMasterView\(\)&&masterViews\.has\(next\)\)return/);
 assert.match(js,/nav\.inert=hide/);
 assert.match(js,/location\.assign\(workspaceUrl\(nextMode\)\)/);
 assert.match(js,/location\.assign\(workspaceUrl\('production','overview'\)\)/);
 assert.match(js,/api\('\/api\/admin\/switch','POST',\{tenantId:homeTenantId\}\)/);
 assert.match(server,/homeTenantId:\(a\.platform_owner&&a\.role==='owner'\)\?a\.tenant_id:null/);
 assert.match(server,/if\(method==='POST'&&pathname==='\/api\/admin\/switch'\)\{\s*needPlatform\(a\)/);
});
test('Commerce is gone from navigation, search and the client bundle',()=>{
 assert.doesNotMatch(html,/data-view="sales"|data-view="quotes"/);
 assert.doesNotMatch(html,/\/sales\.js|\/sales\.css|commerceAlerts/);
 assert.doesNotMatch(js,/SocioSales|sales\.read|commerceAlert/);
});
test('Meta does not render the interpretation results card',()=>{
 assert.doesNotMatch(meta,/section\('Interpretação dos resultados'/);
 assert.match(meta,/selectedAdset\?'Anúncios do conjunto'/);
});
