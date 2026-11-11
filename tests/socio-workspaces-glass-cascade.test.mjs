import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html'),css=read('public/socio-glass-enforced.css'),app=read('public/app.js'),server=read('server.mjs');

test('Glass assets are linked AND publicly served, fixing the previous 404',()=>{
 for(const file of ['socio-glass-motion.css','socio-glass-motion.js','socio-glass-enforced.css']){
  assert.ok(server.includes("'"+'/'+file+"'"),file+' must be on the static allowlist');
  assert.ok(html.includes('/'+file+'?v='),file+' must be loaded');
 }
 assert.ok(html.indexOf('/socio-glass-enforced.css')>html.indexOf('/socio-master.css'));
 assert.ok(html.indexOf('/socio-glass-enforced.css')>html.indexOf('/socio-glass-motion.css'));
 assert.ok(html.indexOf('/socio-glass-motion.js')>html.indexOf('/app.js'));
});
test('Final theme wins the legacy !important palette',()=>{
 for(const selector of ['body #appShell .app-main{','body #appShell .sidebar{','body #appShell .topbar{',
  'body #appShell #view :is(.card','--socio-accent:#c7f47f','--socio-accent:#a5c5ff',
  'background:var(--socio-glass-panel)!important','body #appShell #productionNav.hidden']){
  assert.ok(css.includes(selector),selector);
 }
 assert.match(css,/display:none!important;visibility:hidden!important;pointer-events:none!important/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('Master and Production routes are distinct, with one login and enforced privileges',()=>{
 const start=app.indexOf('const isMasterView='),end=app.indexOf('function syncMasterSwitch()',start);
 assert(start>0&&end>start);
 const source=app.slice(start,end);
 const simulate=(url,allowed,workspace,view)=>{
  const location=new URL(url);
  const setup='const state={workspace:'+JSON.stringify(workspace)+',view:'+JSON.stringify(view)+',me:true};const isPrimaryMaster=()=>'+allowed+';';
  return JSON.parse(vm.runInNewContext(setup+source+
   'JSON.stringify({mode:workspaceFromLocation(),initial:initialWorkspaceView(),next:workspaceUrl("master"),isMaster:isMasterView()})',
   {URL,location,history:{replaceState(){}}}));
 };
 const master=simulate('https://socio.test/?workspace=master#/companies',true,'master','admin');
 assert.equal(master.mode,'master');assert.equal(master.initial,'admin');assert.equal(master.isMaster,true);
 assert.equal(master.next,'/?workspace=master#/companies');
 const production=simulate('https://socio.test/?workspace=production#/marketing',true,'production','marketing');
 assert.equal(production.mode,'production');assert.equal(production.initial,'marketing');assert.equal(production.isMaster,false);
 const denied=simulate('https://socio.test/?workspace=master#/dashboard',false,'production','overview');
 assert.equal(denied.mode,'production');assert.equal(denied.isMaster,false);
});
test('Workspace navigation cannot mix production menus, AI and SaaS administration',()=>{
 assert.match(app,/if\(isMasterView\(\)&&!masterViews\.has\(next\)\)return/);
 assert.match(app,/if\(!isMasterView\(\)&&masterViews\.has\(next\)\)return/);
 assert.match(app,/if\(isMasterView\(\)\)globalThis\.SocioThalitaUI\?\.unmount\(\)/);
 assert.match(app,/location\.assign\(workspaceUrl\('production','overview'\)\)/);
 assert.match(app,/location\.assign\(workspaceUrl\(nextMode\)\)/);
 assert.match(app,/nav\.inert=hide/);
});
test('Application and animations parse',()=>{
 assert.doesNotThrow(()=>new vm.Script(app,{filename:'public/app.js'}));
 assert.doesNotThrow(()=>new vm.Script(read('public/socio-glass-motion.js'),{filename:'public/socio-glass-motion.js'}));
});
