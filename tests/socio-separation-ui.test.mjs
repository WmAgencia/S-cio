import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=file=>readFileSync(new URL(file,import.meta.url),'utf8');

test('Sócio offers Inteligência Artificial as a separate product module',()=>{
 const html=source('../public/index.html');
 const js=source('../public/app.js');
 assert.match(html,/data-view="training"[^>]*>[^<]*<span[^>]*>[^<]*<\/span> Inteligência Artificial<\/button>/);
 assert.match(js,/training:'Inteligência Artificial'/);
 assert.match(js,/api\('\/api\/training\/auto'/);
 assert.match(js,/api\('\/api\/waakg\/channels'/);
});
test('Sócio uses its own gateway and tenant boundaries, not Prospector infrastructure',()=>{
 const gateway=source('../waakg-adapter.mjs');
 const server=source('../server.mjs');
 assert.doesNotMatch(gateway,/prospector-operacional|wa-akg-production-f9f0/i);
 assert.match(server,/active_tenant_id/);
 assert.match(gateway,/WA_AKG_BASE_URL/);
});
