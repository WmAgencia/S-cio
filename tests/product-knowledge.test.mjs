import test from 'node:test';
import assert from 'node:assert/strict';
import {productKnowledgeMarkdown,syncProductKnowledge,readProductKnowledge,ensureProductKnowledge} from '../product-knowledge.mjs';
import {buildAiInstructions} from '../ai-replies.mjs';
const tenant='11111111-1111-4111-8111-111111111111',product='33333333-3333-4333-8333-333333333333';
const productRow={id:product,name:'iPhone 7 Plus',description:'4 GB de memória RAM e 32 GB de memória interna.',sku:'IPH7',price_cents:129990,
 compare_at_price_cents:149990,stock_quantity:20,active:true};
const variants=[
 {name:'Cor · Rosa',sku:'IPH7-ROSA',price_cents:129990,stock_quantity:5,active:true},
 {name:'Cor · Azul',sku:null,price_cents:129990,stock_quantity:null,active:true},
 {name:'Cor · Cinza',sku:null,price_cents:129990,stock_quantity:0,active:false}
];
const media=[{id:'44444444-4444-4444-8444-444444444444',alt:'iPhone 7 Plus rosa na caixa'}];
const campaigns=[{provider:'meta_ads',campaign_id:'120-2026',label:'Conversas · iPhone'},{provider:'google_ads',campaign_id:'987',label:null}];
const markdown=productKnowledgeMarkdown({tenantName:'Loja da Ana',product:productRow,variants,media,campaigns,
 now:new Date('2026-11-14T12:00:00Z')});
test('the document carries exact price, stock, description and only active variations',()=>{
 assert.match(markdown,/^# Produto: iPhone 7 Plus/);
 assert.match(markdown,/Empresa: Loja da Ana/);
 assert.match(markdown,/Preço: R\$ 1299,90/);
 assert.match(markdown,/Preço anterior: R\$ 1499,90/);
 assert.match(markdown,/Estoque: 20 unidade\(s\)/);
 assert.match(markdown,/32 GB de memória interna/);
 assert.match(markdown,/Cor · Rosa \| R\$ 1299,90 \| 5 em estoque \| SKU IPH7-ROSA/);
 assert.match(markdown,/Cor · Azul \| R\$ 1299,90 \| estoque não controlado/);
 assert.doesNotMatch(markdown,/Cor · Cinza/);
 assert.match(markdown,/Uma foto cadastrada:/);
 assert.match(markdown,/iPhone 7 Plus rosa na caixa/);
 assert.match(markdown,/Meta Ads — Conversas · iPhone \(ID 120-2026\)/);
 assert.match(markdown,/Google Ads \(ID 987\)/);
 assert.match(markdown,/Atualizado em: 2026-11-14/);
});
test('an inactive product says it must not be offered and empty data stays explicit',()=>{
 const doc=productKnowledgeMarkdown({tenantName:'Loja',product:{...productRow,active:false,stock_quantity:null,description:'',compare_at_price_cents:null},now:new Date('2026-11-14T12:00:00Z')});
 assert.match(doc,/Situação: inativo \(não oferecer\)/);
 assert.match(doc,/Estoque: não controlado/);
 assert.match(doc,/Sem descrição cadastrada\./);
 assert.match(doc,/Nenhuma variação cadastrada\./);
 assert.match(doc,/Nenhuma foto cadastrada\./);
 assert.match(doc,/Nenhuma campanha vinculada\./);
});
function fakeDb({productRow:row=productRow,variantRows=variants,mediaRows=media,campaignRows=campaigns,documents=[]}={}){
 const calls=[];
 const query=async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,name,description,sku'))return {rows:row?[row]:[],rowCount:row?1:0};
  if(sql.startsWith('SELECT name,sku,price_cents'))return {rows:variantRows,rowCount:variantRows.length};
  if(sql.startsWith('SELECT id,alt'))return {rows:mediaRows,rowCount:mediaRows.length};
  if(sql.startsWith('SELECT provider,campaign_id'))return {rows:campaignRows,rowCount:campaignRows.length};
  if(sql.startsWith('SELECT name FROM tenants'))return {rows:[{name:'Loja da Ana'}],rowCount:1};
  if(sql.startsWith('INSERT INTO socio_product_knowledge'))return {rows:[],rowCount:1};
  if(sql.startsWith('DELETE FROM socio_product_knowledge'))return {rows:[],rowCount:1};
  if(sql.startsWith('SELECT product_id,markdown'))return {rows:documents,rowCount:documents.length};
  throw new Error('Consulta inesperada: '+sql);
 };
 return {query,calls};
}
test('every product change rebuilds and overwrites the same document',async()=>{
 const db=fakeDb();
 const saved=await syncProductKnowledge(db,{tenantId:tenant,productId:product});
 assert.equal(saved,markdown.replace(/Atualizado em: \d{4}-\d{2}-\d{2}/,'Atualizado em: '+new Date().toISOString().slice(0,10)));
 const upsert=db.calls.find(call=>call.sql.startsWith('INSERT INTO socio_product_knowledge'));
 assert.match(upsert.sql,/ON CONFLICT\(tenant_id,product_id\) DO UPDATE SET markdown=EXCLUDED.markdown/);
 assert.equal(upsert.params[1],tenant);
 assert.equal(upsert.params[2],product);
 assert.match(upsert.params[3],/iPhone 7 Plus/);
 assert.equal(db.calls.filter(call=>call.sql.startsWith('SELECT id,name')).length,1);
});
test('a removed product loses its document and missing documents are rebuilt on first use',async()=>{
 const gone=fakeDb({productRow:null});
 assert.equal(await syncProductKnowledge(gone,{tenantId:tenant,productId:product}),null);
 assert.ok(gone.calls.some(call=>call.sql.startsWith('DELETE FROM socio_product_knowledge')));
 const existing=fakeDb({documents:[{product_id:product,markdown:'# Produto: antigo'}]});
 const found=await readProductKnowledge(existing,{tenantId:tenant,productIds:[product]});
 assert.equal(found.get(product),'# Produto: antigo');
 const fresh=fakeDb({documents:[]});
 const rebuilt=await ensureProductKnowledge(fresh,{tenantId:tenant,productIds:[product]});
 assert.match(rebuilt.get(product),/iPhone 7 Plus/);
 assert.ok(fresh.calls.some(call=>call.sql.startsWith('INSERT INTO socio_product_knowledge')));
});
test('only mentioned products reach the WhatsApp instructions',()=>{
 const base={name:'Sócio',tenantName:'Loja da Ana',tone:'Natural',instructions:'',knowledge:''};
 const withFacts=buildAiInstructions({...base,products:[{name:'iPhone 7 Plus',price_cents:129990,stock_quantity:20}],
  productKnowledge:['# Produto: iPhone 7 Plus\n- Preço: R$ 1299,90']});
 assert.match(withFacts,/Fichas oficiais dos produtos citados/);
 assert.match(withFacts,/Preço: R\$ 1299,90/);
 const without=buildAiInstructions({...base,products:[{name:'iPhone 7 Plus',price_cents:129990,stock_quantity:20}]});
 assert.doesNotMatch(without,/Fichas oficiais dos produtos citados/);
});
