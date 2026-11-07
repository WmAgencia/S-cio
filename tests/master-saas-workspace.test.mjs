import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('public/app.js'),html=read('public/index.html'),master=read('public/socio-master-dashboard.js');
const server=read('server.mjs'),style=read('public/socio-master.css');

test('separate Master and production sidebars stay behind primary-owner permission',()=>{
 assert.match(html,/id="productionNav"/);
 assert.match(html,/id="masterNav"[^>]*class="[^"]*hidden"/);
 for(const view of ['masterOverview','admin','masterPlans'])assert.match(html,new RegExp('data-view="'+view+'"'));
 assert.match(app,/const masterViews=new Set\(\['masterOverview','admin','masterPlans'\]\)/);
 assert.match(app,/const isPrimaryMaster=\(\)=>!!\(state\.me\?\.user\?\.platformOwner&&state\.me\?\.user\?\.homeTenantId\)/);
 assert.match(app,/if\(masterViews\.has\(next\)&&!isPrimaryMaster\(\)\)return;/);
 assert.match(app,/body\.classList\.toggle/);
 assert.match(app,/socio-is-master/);
 assert.match(app,/syncMasterSwitch\(\)/);
 assert.match(app,/const homeTenantId=state\.me\.user\.homeTenantId/);
 assert.match(app,/await api\('\/api\/admin\/switch','POST',\{tenantId:homeTenantId\}\)/);
 assert.match(app,/await changeView\('masterOverview'\)/);
 assert.doesNotMatch(html,/data-view="sales"/);
});

test('Master dashboards only render real API metrics and explicitly exclude invented payments',()=>{
 assert.match(master,/api\('\/api\/admin\/tenants'\)/);
 assert.match(master,/api\('\/api\/admin\/monitor'\)/);
 assert.match(master,/monthData\(tenants\)/);
 assert.match(master,/const planCounts=/);
 assert.match(master,/Distribuição dos planos/);
 assert.match(master,/Dados consultados em/);
 assert.match(master,/Status ativo não significa cliente pagante/);
 assert.match(master,/Faturamento mensal recorrente/);
 assert.match(master,/Indisponível/);
 assert.match(master,/data-master-create="1"/);
 assert.match(master,/document\.querySelector\('#newCompany'\)\?\.click\(\)/);
 assert.doesNotMatch(master,/confirmedPayingCustomers\|\|0/);
 assert.doesNotThrow(()=>new vm.Script(master));
 assert.doesNotThrow(()=>new vm.Script(app));
});

test('company search and editing are restricted to platform administration and are auditable',()=>{
 assert.match(app,/id="masterCompanySearch"/);
 assert.match(app,/id="masterCompanyPlan"/);
 assert.match(app,/id="masterCompanyStatus"/);
 assert.match(app,/data-company-edit/);
 assert.match(app,/id="companyEditForm"/);
 assert.match(app,/data-feature-edit/);
 assert.match(app,/api\('\/api\/admin\/tenants\/'\+editingCompany,'PATCH'/);
 assert.match(server,/const editMasterTenant=pathname\.match/);
 assert.match(server,/if\(editMasterTenant&&method==='PATCH'\)\{\s*needPlatform\(a\);/);
 assert.match(server,/platform\.tenant_profile_updated/);
 assert.match(server,/billingChanged:false/);
 assert.match(style,/\.master-month-chart/);
 assert.match(style,/\.master-plan-chart/);
 assert.match(style,/@media\(max-width:560px\)/);
});

test('team page remains focused on user management, without audit panels',()=>{
 const team=app.slice(app.indexOf('async function team(){'),app.indexOf('function featureChecks('));
 assert.match(team,/Usuários da empresa/);
 assert.doesNotMatch(team,/Auditoria da empresa|Isolamento de dados/);
});
