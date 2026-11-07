import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getExecutiveMetrics} from '../socio-executive-metrics.mjs';
import {askThalita,confirmThalita} from '../socio-thalita-assistant.mjs';

const load=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=load('public/app.js'),server=load('server.mjs'),html=load('public/index.html');
const extract=(source,start,end)=>{const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 assert(i>=0&&j>i,'Missing JS block '+start);return source.slice(i,j);};

test('all new browser modules parse in Node with no syntax regression',()=>{
 for(const name of ['public/app.js','public/inbox.js','public/socio-workspace-ui.js',
  'public/socio-thalita-ui.js','public/sales.js']){
  assert.doesNotThrow(()=>new vm.Script(load(name),{filename:name}),name);
 }
});

test('Brazilian prices are accepted, type/value variations are distinct and autocomplete remains editable',()=>{
 const script=extract(app,'const centsFromInput=text=>{','const stockFromInput=text=>{')+
  '\n'+extract(app,"const catalogTypes=['Cor'",'function catalogVariantRow(variant={}){')+
  '\nglobalThis.parsePrice=centsFromInput;globalThis.variantParts=variantParts;';
 const env={};vm.runInNewContext(script,env);
 for(const [value,expected] of [['129,90',12990],['129.90',12990],['1.299,90',129990],['R$ 19,50',1950],
  ['40',4000],['0,01',1]]){
  assert.equal(env.parsePrice(value),expected,value);
 }
 for(const invalid of ['', '129,999', 'abc', '1,299.90', '-1'])assert.throws(()=>env.parsePrice(invalid),invalid);
 assert.deepEqual(JSON.parse(JSON.stringify(env.variantParts('Cor · Preto'))),{kind:'Cor',value:'Preto'});
 assert.deepEqual(JSON.parse(JSON.stringify(env.variantParts('Tamanho · 40'))),{kind:'Tamanho',value:'40'});
 assert.deepEqual(JSON.parse(JSON.stringify(env.variantParts('Modelo · Amarelo'))),{kind:'Modelo',value:'Amarelo'});
 assert.match(app,/catalogColorSuggestions/);
 assert.match(app,/data-variant-type/);
 assert.match(app,/readVariantRows/);
});

test('catalog creates product, variations, campaign reference in one transaction; delete is explicit',()=>{
 assert.match(server,/if\(method==='POST'&&pathname==='\/api\/products'\)/);
 const start=server.indexOf("if(method==='POST'&&pathname==='/api/products')");
 const end=server.indexOf('const productVariants=pathname.match',start);
 const route=server.slice(start,end);
 assert(route.indexOf('validateVariants')<route.indexOf('INSERT INTO products'));
 assert(route.indexOf('validateCampaign')<route.indexOf('INSERT INTO products'));
 assert.match(route,/BEGIN/);assert.match(route,/COMMIT/);assert.match(route,/ROLLBACK/);
 assert.match(route,/INSERT INTO product_variants/);
 assert.match(route,/INSERT INTO product_campaign_links/);
 assert.match(server,/if\(prodMatch&&method==='DELETE'\)/);
 assert.match(server,/data\.confirm!==true/);
 assert.match(server,/DELETE FROM products WHERE tenant_id=\$1 AND id=\$2/);
 assert.match(app,/data\.variants=readVariantRows/);
 assert.match(app,/data\.campaigns=campaign\?\[campaign\]:\[\]/);
 assert.match(app,/id="deleteProduct"/);
});

test('navigation consolidates reports and quotes while keeping server endpoints backwards compatible',()=>{
 assert.doesNotMatch(html,/data-view="reports"/);
 assert.doesNotMatch(html,/data-view="quotes"/);
 assert.match(html,/data-view="connections"/);
 assert.match(app,/if\(next==='reports'\)next='overview'/);
 assert.match(app,/if\(next==='quotes'\)next='sales'/);
 assert.match(app,/SocioWorkspaceUI\.overview/);
 assert.match(app,/SocioWorkspaceUI\.marketing/);
 assert.match(server,/pathname==='\/api\/reports'/);
 assert.doesNotMatch(load('public/sales.js'),/function attachSalesAssistant/);
 assert.doesNotMatch(load('public/sales.js'),/^\s*attachSalesAssistant\(view,api\);/m);
});

test('WhatsApp inbox has one search, Connect navigates to Connections, and auto sync remains active',()=>{
 const inbox=load('public/inbox.js');
 assert.match(inbox,/id="inboxSearch"/);
 assert.doesNotMatch(inbox,/data-inbox-sync aria-label/);
 assert.doesNotMatch(inbox,/id="inboxSettings" aria-label/);
 assert.match(inbox,/changeView\('connections'\)/);
 assert.match(inbox,/channel_provider!=='instagram'/);
 assert.match(inbox,/setInterval\(poll,12000\)/);
 assert.match(server,/processLiveInboxSync\(pool\)/);
 assert.match(server,/\},16000\)/);
});

test('executive dashboard reads scoped values and does not infer paid sales',async()=>{
 const tenant='00000000-0000-4000-8000-000000000005';
 const calls=[],pool={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('SELECT p.id,p.name,count')){
   return {rows:[{id:'1',name:'Kit azul',requests:4,requested_units:7}]};
  }
  return {rows:[{opportunities:8,completed_opportunities:3,registered_orders:2,
   quote_requests:5,pending_quotes:2,open_conversations:4,received_today:9,sent_today:6}]};
 }};
 const a={role:'owner',active_tenant_id:tenant};
 const data=await getExecutiveMetrics(pool,a);
 assert.equal(data.tenantScoped,true);assert.equal(data.readOnly,true);
 assert.equal(data.counts.receivedToday,9);
 assert.equal(data.popularProducts[0].name,'Kit azul');
 assert.equal(data.paidSales,null);
 assert.equal(data.confirmedRevenueCents,null);
 assert(calls.every(x=>x.args.length===1&&x.args[0]===tenant));
});

test('Thalita only prepares catalog writes and executes one approved action once',async()=>{
 const tenant='00000000-0000-4000-8000-000000000005';
 const a={role:'owner',active_tenant_id:tenant,user_id:'00000000-0000-4000-8000-000000000007',token_hash:'only-this-session',features:{ai:true,quotes:true,meta_ads:true,catalog:true}};
 let inserted=0;
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('INSERT INTO products')){inserted++;return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000008'}]};}
  throw Error('Unexpected SQL: '+sql);
 }};
 const before=await askThalita(pool,a,{message:'cadastre produto Caneca por R$ 39,90'});
 assert.equal(before.status,'approval_required');assert.equal(before.executed,false);
 assert.equal(inserted,0);
 await assert.rejects(confirmThalita(pool,a,{id:before.confirmation.id,confirm:false}),{status:409});
 assert.equal(inserted,0);
 const after=await confirmThalita(pool,a,{id:before.confirmation.id,confirm:true});
 assert.equal(after.executed,true);assert.equal(inserted,1);
 await assert.rejects(confirmThalita(pool,a,{id:before.confirmation.id,confirm:true}),{status:409});
});

test('dashboard ad spend and assistant tools degrade gracefully without invented data',()=>{
 const css=load('public/socio-executive.css'),dash=load('public/socio-workspace-ui.js'),floating=load('public/socio-thalita-ui.js');
 assert.match(css,/\.px-overview/);
 assert.match(css,/\.px-assistant-fab/);
 assert.match(css,/\.wa-inbox-search input/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(dash,/api\/marketing\/tools\/insights\?period=/);
 assert.match(dash,/api\/google-ads\/campaigns\?period=today/);
 assert.match(dash,/Não disponível/);
 assert.match(dash,/Vendas pagas/);
 assert.match(dash,/CPA atribuído/);
 assert.match(floating,/Confirmar alteração/);
 assert.match(floating,/\/api\/thalita\/transcribe/);
 assert.match(floating,/\/api\/thalita\/tts/);
 assert.match(server,/pathname==='\/api\/thalita\/ask'/);
 assert.match(server,/pathname==='\/api\/thalita\/confirm'/);
});
