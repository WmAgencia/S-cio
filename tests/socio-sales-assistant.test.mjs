import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {suggestQuoteForRequest,askSalesAssistant} from '../socio-sales-assistant.mjs';
import {selectExpertSkill} from '../socio-expert-skills.mjs';
import {speakToSocioSkill} from '../socio-skill-router.mjs';

const id=()=>randomUUID();
const tenant=id();
const features={whatsapp:true,catalog:true,quotes:true,ai:true,meta_ads:true,team:true};
const owner={active_tenant_id:tenant,user_id:id(),role:'owner',tenant_status:'trial',features};
const product=(patch={})=>({id:id(),name:'Vestido Primavera',description:'Vestido feminino',
 price_cents:7990,stock_quantity:8,active:true,variants:[],...patch});
const request=(patch={})=>({id:id(),customer_name:'Cliente Ana',status:'pending',delivery_status:'not_sent',
 summary:'Quero comprar 2 unidades do Vestido Primavera',...patch});

test('real catalog and explicit quantity yield a draft preview, not a sale',()=>{
 const preview=suggestQuoteForRequest(request(),[product()]);
 assert.equal(preview.readyToReview,true);assert.equal(preview.amountCents,15980);
 assert.equal(preview.quantity,2);
 assert.match(preview.text,/2 × Vestido Primavera/);
 assert.match(preview.text,/159,80/);
 assert.match(preview.reason,/revisão humana/);
});
test('do not quote ambiguous, unpriced, out of stock, variant or unidentified products',()=>{
 const base=product();
 for(const q of [
  request({summary:'Quanto custa o Vestido Primavera?'}),
  request({summary:'Quero comprar Vestido Primavera'}),
 ]){
  const preview=suggestQuoteForRequest(q,[base]);
  assert.equal(preview.readyToReview,false);assert.equal(preview.amountCents,null);
 }
 const variants=[{id:id(),name:'Tamanho M',price_cents:8990,stock_quantity:3,active:false}];
 for(const p of [
  product({variants}),product({stock_quantity:null}),product({stock_quantity:1}),
  product({price_cents:0})
 ])assert.equal(suggestQuoteForRequest(request(),[p]).readyToReview,false);
 assert.equal(suggestQuoteForRequest(request(),[product(),product({name:'Primavera'})]).readyToReview,true,
  'Partial word matches should not fabricate a second complete product match.');
 assert.equal(suggestQuoteForRequest(request({status:'resolved'}),[base]).readyToReview,false);
 assert.equal(suggestQuoteForRequest(request({delivery_status:'processing'}),[base]).readyToReview,false);
});
test('role and feature gates reject sales consultation before accessing database',async()=>{
 let read=0;const db={query:async()=>{read++;throw Error('No data should be read')}};
 for(const user of [
  {...owner,role:'agent'}, {...owner,tenant_status:'paused'},
  {...owner,features:{...features,ai:false}}, {...owner,features:{...features,quotes:false}},
  {...owner,features:{...features,catalog:false}}
 ]){
  await assert.rejects(askSalesAssistant(db,user,{message:'Meus pedidos pendentes'}),{status:403});
 }
 assert.equal(read,0);
 await assert.rejects(askSalesAssistant(db,owner,{message:''}),{status:422});
 await assert.rejects(askSalesAssistant(db,owner,{message:'Quero orçamento',requestId:'another-company'}),{status:422});
 assert.equal(read,0);
});
test('all sales reads use only the active tenant and no writes occur',async()=>{
 const quoteId=id(),prod=product(),q=request({id:quoteId});
 let reads=0;const pool={query:async(sql,args)=>{
  reads++;
  assert.equal(args[0],tenant);
  assert(!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
  if(sql.startsWith('SELECT id,name,description'))return {rows:[prod]};
  if(sql.startsWith('SELECT v.id'))return {rows:[]};
  if(sql.includes('FROM quote_requests'))return {rows:[q]};
  if(sql.includes('FROM sale_intents'))return {rows:[]};
  if(sql.includes('FROM training_versions'))return {rows:[{approved:true}]};
  throw Error('Unexpected SQL');
 }};
 const overview=await askSalesAssistant(pool,owner,{message:'Mostre meus pedidos pendentes'});
 assert.equal(overview.readOnly,true);assert.equal(overview.executed,false);
 assert.equal(overview.approvedTraining,true);assert.match(overview.message,/Cliente Ana/);
 const draft=await askSalesAssistant(pool,owner,{message:'Prepare o orçamento do último pedido'});
 assert.equal(draft.preview.amountCents,15980);
 const exact=await askSalesAssistant(pool,owner,{message:'Sugira orçamento',requestId:quoteId});
 assert.equal(exact.requestId,quoteId);assert.equal(exact.preview.readyToReview,true);
 assert(reads>=15);
});
test('platform routing prefers commercial skills only for commercial requests',async()=>{
 assert.equal(selectExpertSkill('Sócio, quero preparar um orçamento').id,'commerce.assistant');
 assert.equal(selectExpertSkill('Me mostre meus produtos').id,'commerce.assistant');
 assert.equal(selectExpertSkill('Quais oportunidades de venda tenho?').id,'commerce.assistant');
 assert.equal(selectExpertSkill('Crie campanha para meus produtos no Meta Ads').id,'meta.campaigns');
 assert.equal(selectExpertSkill('Preciso anunciar no Google Ads').id,'google.ads');
 assert.equal(selectExpertSkill('Quantas vendas no WhatsApp?').id,'whatsapp.sales');
 let calls=0;
 const response=await speakToSocioSkill({query:async()=>{throw Error('Do not query marketing')}} ,owner,
  {message:'Me mostre meus produtos'},{
   askSalesAssistant:async(_pool,a,input)=>{
    calls++;assert.equal(a.active_tenant_id,tenant);
    assert.match(input.message,/meus produtos/i);
    return {status:'completed',readOnly:true,executed:false,skillId:'commerce.assistant',message:'Produtos da empresa.'};
   },
   prepare:async()=>{throw Error('No campaigns permitted')},
   execute:async()=>{throw Error('No Meta writes')}
  });
 assert.equal(calls,1);assert.equal(response.readOnly,true);
 assert.equal(response.platform,'commerce');assert.equal(response.status,'completed');
});
test('HTTP and UI expose separate sales chat with no implicit outbound or payment',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/sales.js',import.meta.url),'utf8');
 assert.match(server,/\/api\/sales\/assistant\/chat/);
 assert.match(server,/assertApiFeature\(a.features,'\/api\/agent'\)/);
 assert.match(ui,/Converse com o Sócio sobre suas vendas/);
 assert.match(ui,/data-quote-ai/);
 assert.match(ui,/Colocar sugestão no rascunho/);
 assert.match(ui,/Sugestão inserida nos campos, ainda não salva nem enviada/);
});
test('PostgreSQL integration protects quote previews and training by tenant',{
 skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_sales_assistant_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const t1=id(),t2=id(),ch1=id(),ch2=id(),conv1=id(),conv2=id(),m1=id(),m2=id(),p1=id(),p2=id(),q1=id(),q2=id();
  await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Loja A',$2),($3,'Loja B',$4)",
   [t1,'sales-test-a-'+t1.slice(0,6),t2,'sales-test-b-'+t2.slice(0,6)]);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES "+
   "($1,$2,'Loja A','5515999991111','waakg','connected'),($3,$4,'Loja B','5515999992222','waakg','connected')",
   [ch1,t1,ch2,t2]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone,customer_name) VALUES "+
   "($1,$2,$3,'5515988881111','Cliente A'),($4,$5,$6,'5515988882222','Cliente B')",
   [conv1,t1,ch1,conv2,t2,ch2]);
  await db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES "+
   "($1,$2,$3,'inbound','Quero comprar 2 unidades de Vestido Azul'),"+
   "($4,$5,$6,'inbound','Quero comprar 2 unidades de Casaco Preto')",[m1,t1,conv1,m2,t2,conv2]);
  await db.query("INSERT INTO products(id,tenant_id,name,price_cents,stock_quantity,active) VALUES "+
   "($1,$2,'Vestido Azul',7990,5,true),($3,$4,'Casaco Preto',9900,2,true)",[p1,t1,p2,t2]);
  await db.query("INSERT INTO quote_requests(id,tenant_id,conversation_id,inbound_message_id,customer_name,summary) VALUES "+
   "($1,$2,$3,$4,'Cliente A','Quero comprar 2 unidades de Vestido Azul'),"+
   "($5,$6,$7,$8,'Cliente B','Quero comprar 2 unidades de Casaco Preto')",
   [q1,t1,conv1,m1,q2,t2,conv2,m2]);
  const a={...owner,active_tenant_id:t1},b={...owner,active_tenant_id:t2};
  const pa=await askSalesAssistant(db,a,{message:'Preparar orçamento do último pedido'});
  assert.equal(pa.preview.readyToReview,true);assert.equal(pa.preview.amountCents,15980);
  assert.doesNotMatch(pa.message,/Casaco Preto|Cliente B/);
  const pb=await askSalesAssistant(db,b,{message:'Preparar orçamento do último pedido'});
  assert.equal(pb.preview.readyToReview,true);assert.equal(pb.preview.amountCents,19800);
  assert.doesNotMatch(pb.message,/Vestido Azul|Cliente A/);
  await assert.rejects(askSalesAssistant(db,b,{message:'Preparar orçamento',requestId:q1}),{status:404});
  const after=await db.query('SELECT COUNT(*)::int AS n FROM sales_quotes');
  assert.equal(after.rows[0].n,0,'Assistant preview must not create quotes');
 }finally{await db.end().catch(()=>{});await root.query('DROP SCHEMA '+schema+' CASCADE').catch(()=>{});await root.end();}
});
