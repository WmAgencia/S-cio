import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {askThalita,confirmThalita} from '../socio-thalita-assistant.mjs';

const tenantA='11111111-1111-4111-8111-111111111111';
const tenantB='22222222-2222-4222-8222-222222222222';
const productId='33333333-3333-4333-8333-333333333333';
const actor=(tenant=tenantA,role='owner')=>({role,active_tenant_id:tenant,
 user_id:'44444444-4444-4444-8444-444444444444',token_hash:'session-test',
 features:{ai:true,whatsapp:true,catalog:true,quotes:true,meta_ads:true,team:true}});
function db(){
 const calls=[];
 let product={id:productId,name:'Camiseta preta',price_cents:12990,stock_quantity:5,active:true},writes=0;
 const pool={query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT id,name,price_cents,stock_quantity,active FROM products')){
   return {rows:args[0]===tenantA?[{...product}]:[],rowCount:args[0]===tenantA?1:0};
  }
  if(sql.startsWith('SELECT id,name,price_cents,stock_quantity FROM products')){
   return {rows:args[0]===tenantA?[{...product}]:[],rowCount:args[0]===tenantA?1:0};
  }
  if(sql.startsWith('SELECT label,phone,status FROM channels')){
   return {rows:args[0]===tenantA?[{label:'Atendimento',phone:'5515999999999',status:'connected'}]:[]};
  }
  if(sql.includes("SELECT count(*)::int AS n FROM conversations"))
   return {rows:[{n:args[0]===tenantA?4:0}]};
  if(sql.startsWith('UPDATE products SET')){
   assert.equal(args[0],tenantA);
   assert.equal(args[1],productId);
   if(sql.includes('price_cents=$3'))product={...product,price_cents:args[2]};
   else if(sql.includes('stock_quantity=$3'))product={...product,stock_quantity:args[2]};
   else throw Error('Unexpected column');
   writes++;return {rows:[{...product}],rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql);
 }};
 return {pool,calls,get product(){return product;},get writes(){return writes;}};
}
test('Thalita reads only the active company catalog, without inventing products or prices',async()=>{
 const b=db();
 const a=await askThalita(b.pool,actor(),{message:'Quais produtos e estoques temos cadastrados?'});
 assert.equal(a.status,'completed');
 assert.equal(a.executed,false);
 assert.match(a.message,/Camiseta preta/);
 assert.match(a.message,/129,90/);
 assert.equal(b.writes,0);
 const another=await askThalita(b.pool,actor(tenantB),{message:'Liste os produtos do catálogo'});
 assert.equal(another.data.products.length,0);
 assert(b.calls.every(x=>x.args[0]===tenantA||x.args[0]===tenantB));
});
test('Thalita reports connected WhatsApp status as database status, with no send',async()=>{
 const b=db();
 const answer=await askThalita(b.pool,actor(),{message:'Quantos WhatsApps conectados e conversas em aberto temos?'});
 assert.equal(answer.executed,false);
 assert.match(answer.message,/1 marcados como conectados na base/);
 assert.equal(answer.data.openConversations,4);
 assert(b.calls.every(x=>!/^INSERT INTO messages/i.test(x.sql)));
});
test('Product price and stock edits demand one-use confirmation and always scope to tenant',async()=>{
 const b=db(),a=actor();
 const start=await askThalita(b.pool,a,{message:'Atualize o preço do produto Camiseta preta para R$ 159,90'});
 assert.equal(start.status,'approval_required');
 assert.equal(b.writes,0);
 const approved=await confirmThalita(b.pool,a,{id:start.confirmation.id,confirm:true});
 assert.equal(approved.executed,true);
 assert.equal(b.product.price_cents,15990);
 assert.equal(b.writes,1);
 await assert.rejects(confirmThalita(b.pool,a,{id:start.confirmation.id,confirm:true}),{status:409});
 const stock=await askThalita(b.pool,a,{message:'Atualize o estoque do produto Camiseta preta para 23'});
 assert.equal(stock.status,'approval_required');
 assert.equal(b.writes,1);
 await confirmThalita(b.pool,a,{id:stock.confirmation.id,confirm:true});
 assert.equal(b.product.stock_quantity,23);
 assert.equal(b.writes,2);
 assert(b.calls.filter(x=>x.sql.startsWith('UPDATE products')).every(x=>x.args[0]===tenantA));
});
test('Ambiguous product name cannot modify another company, agent cannot request catalog writes',async()=>{
 const b=db();
 const missing=await askThalita(b.pool,actor(tenantB),{message:'Atualize o preço do produto Camiseta preta para R$ 10,00'});
 assert.equal(missing.status,'needs_details');
 assert.equal(b.writes,0);
 const agent=await askThalita(b.pool,actor(tenantA,'agent'),{message:'Atualize o estoque do produto Camiseta preta para 3'});
 assert.equal(agent.executed,false);
 assert.equal(b.writes,0);
});
test('Thalita reads authorized Meta and Google metrics, returning uncertainty instead of guessing',async()=>{
 const actorA=actor(),noSql={query:async()=>{throw Error('Metric tools must not query this fixture');}};
 const meta=await askThalita(noSql,actorA,{message:'Qual o gasto e CPC da Meta Ads hoje?'},{
  metaReport:async(pool,a,kind,input)=>{
   assert.equal(a.active_tenant_id,tenantA);assert.equal(kind,'insights');
   assert.equal(input.period,'today');
   return {items:[{spend:'32.50',clicks:'10',impressions:'1200'}]};
  }});
 assert.match(meta.message,/Meta Ads · hoje/);
 assert.equal(meta.data.spend,32.5);assert.equal(meta.data.clicks,10);
 assert.equal(meta.executed,false);
 const google=await askThalita(noSql,actorA,{message:'Como estão as campanhas Google Ads hoje?'},{
  googleReport:async(pool,a,opts)=>{
   assert.equal(opts.period,'today');
   return {period:'TODAY',summary:{campaigns:2,clicks:'11',impressions:'800',costMicros:'11000000'}};
  }});
 assert.equal(google.status,'completed');assert.match(google.message,/Google Ads · hoje/);
 assert.equal(google.data.costMicros,'11000000');
 const failure=await askThalita(noSql,actorA,{message:'Qual o gasto na Meta Ads?'},{
  metaReport:async()=>{throw Error('CONNECTION_NOT_READY');}});
 assert.equal(failure.status,'unavailable');assert.doesNotMatch(failure.message,/gasto 0/);
});
test('The executive chart supports accessible 7/30/90 day display and assistant shortcuts',()=>{
 const root=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const ui=root('public/socio-workspace-ui.js'),assistant=root('public/socio-thalita-ui.js'),css=root('public/socio-executive.css');
 for(const name of ['7d','1m','90d'])assert.match(ui,new RegExp("data-px-chart-range"));
 assert.match(ui,/activityRange='1m'/);
 assert.match(ui,/aria-pressed/);
 assert.match(ui,/px-chart-hit/);
 assert.match(css,/\.px-range-btn\.active/);
 assert.match(assistant,/data-thalita-suggest/);
 for(const name of ['Resumo de hoje','Produtos','WhatsApp','Meta Ads','Google Ads'])assert(assistant.includes(name));
 for(const f of ['public/socio-workspace-ui.js','public/socio-thalita-ui.js'])assert.doesNotThrow(()=>new vm.Script(root(f),{filename:f}));
});
