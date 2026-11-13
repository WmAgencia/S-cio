import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html'),css=read('public/socio-stripe-system.css'),app=read('public/app.js'),server=read('server.mjs');

test('One canonical light stylesheet is loaded last and served with no 404',()=>{
 assert(html.includes('/socio-stripe-system.css?v=20261112e'));
 assert(server.includes("'/socio-stripe-system.css'"));
 assert(html.indexOf('/socio-stripe-system.css')>html.indexOf('/socio-master.css'));
 assert(!html.includes('<script src="/socio-glass-motion.js'));
 for(const old of ['socio-glass-motion.css','socio-glass-enforced.css','socio-luminous-glass.css']){
  assert(!html.includes('href="/'+old),old+' should not load');
 }
});
test('Master and Production share components but use separate light workspace skins',()=>{
 for(const selector of ['body #appShell .app-main','body #appShell .sidebar',
  'body #appShell .topbar','#appShell[data-workspace="master"]',
  '--stripe-canvas:#f7f8fa','--stripe-accent:#605dec',
  'body #appShell #view :is(.card']){
  assert(css.includes(selector),selector);
 }
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/--stripe-nav-active:#eeefff/);
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
 assert.equal(master.next,'/?workspace=master#/dashboard');
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
 assert.doesNotThrow(()=>new vm.Script(read('public/socio-entry-motion.js'),{filename:'public/socio-entry-motion.js'}));
});
