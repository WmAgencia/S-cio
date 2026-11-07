import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {integrationReadiness} from '../socio-integrations-readiness.mjs';
const tenant=randomUUID();
const actor={active_tenant_id:tenant,tenant_status:'trial',role:'owner',
 features:{whatsapp:true,catalog:true,quotes:true,meta_ads:true,ai:true,team:true}};
test('readiness labels connections and blockers, never claims external billing or website verification',async()=>{
 let reads=0;
 const pool={query:async(sql,args)=>{
  reads++;assert.equal(args[0],tenant);assert.match(sql,/SELECT/);
  assert(!/^\s*(INSERT|UPDATE|DELETE)/.test(sql));
  return {rows:[]};
 }};
 const env={SOCIO_STRIPE_SECRET_KEY:'sk_live_DO_NOT_EXPOSE_THIS_SECRET',
 SOCIO_GOOGLE_OAUTH_CLIENT_SECRET:'GOCSPX_DO_NOT_EXPOSE_THIS_SECRET',
 SOCIO_META_CAPI_ENABLED:'false',SOCIO_SITE_EVENTS_ENABLED:'false'};
 const output=await integrationReadiness(pool,actor,{env,whatsapp:async()=>{
  return {connectedSessions:0,textReady:false,blockers:['Nenhuma sessão WA-AKG conectada.']};
 }});
 assert.equal(output.readOnly,true);assert.equal(output.tenantScoped,true);
 assert.equal(output.tasks.length,6);
 assert.equal(output.readyChecks,0);
 assert(output.tasks.find(x=>x.id==='billing').blockers.length>0);
 assert.equal(output.tasks.find(x=>x.id==='google').verified,false);
 assert.equal(output.tasks.find(x=>x.id==='meta_capi').configured,false);
 assert.equal(output.tasks.find(x=>x.id==='whatsapp').verified,false);
 assert.equal(output.tasks.find(x=>x.id==='production_sales').verified,false);
 assert(reads>=2);
 assert(!JSON.stringify(output).includes('DO_NOT_EXPOSE_THIS_SECRET'));
 assert.match(output.note,/Nada aqui gera cobranças/);
});
test('readiness denies unauthenticated agent and paused company before reading tenant data',async()=>{
 const db={query:async()=>{throw Error('Unexpected DB read')}};
 await assert.rejects(integrationReadiness(db,{...actor,role:'agent'},{env:{}}),{status:403});
 await assert.rejects(integrationReadiness(db,{...actor,tenant_status:'paused'},{env:{}}),{status:403});
});
test('UI is static served, reports show opt-in integrations and callback endpoints cannot mutate ads',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/socio-integrations-ui.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(server,/\/api\/integrations\/readiness/);
 assert.match(server,/\/socio-integrations-ui\.js/);
 assert.match(html,/socio-integrations-ui\.js/);
 assert.match(ui,/Nenhuma campanha será criada/);
 assert.match(ui,/Conectar Google Ads/);
 assert.match(ui,/accounts\/select/);
 assert(!ui.includes('sk_live_'));
});
