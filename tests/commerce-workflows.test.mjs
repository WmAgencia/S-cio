import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isPurchaseIntent,proposedQuantity,scanSalesIntents,updateSaleIntent} from '../sales-intents.mjs';
import {saveQuoteDraft,sendQuoteDraft} from '../quote-requests.mjs';

const tenant='11111111-1111-4111-8111-111111111111';
const lead='22222222-2222-4222-8222-222222222222';
const message='33333333-3333-4333-8333-333333333333';
const conversation='44444444-4444-4444-8444-444444444444';
const product='55555555-5555-4555-8555-555555555555';

test('purchase intent only for clear affirmative buying and not pricing questions',()=>{
 assert.equal(isPurchaseIntent('Quero comprar 2 unidades do Kit Premium'),true);
 assert.equal(isPurchaseIntent('Vou levar o kit!'),true);
 assert.equal(isPurchaseIntent('Pode separar 3 peças para mim'),true);
 assert.equal(isPurchaseIntent('Quanto custa o Kit Premium?'),false);
 assert.equal(isPurchaseIntent('Não quero comprar agora'),false);
 assert.equal(isPurchaseIntent('Quero um orçamento'),false);
 assert.equal(proposedQuantity('Vou levar 3 unidades'),3);
 assert.equal(proposedQuantity('Vou levar o produto'),null);
});

test('incoming sale leads use tenant-scoped catalog and avoid guessing quantities',async()=>{
 const logged=[];
 const mock={
  async query(sql,args){
   logged.push({sql,args});
   if(sql.includes('FROM messages m'))return {rows:[
    {id:message,tenant_id:tenant,conversation_id:conversation,
     body:'Quero comprar 2 unidades do Kit Premium',customer_name:'Cliente teste',customer_phone:'5515999999999'}
   ],rowCount:1};
   if(sql.includes('FROM products p'))return {rows:[
    {id:product,name:'Kit Premium',price_cents:12000,stock_quantity:20,variant_count:0}
   ]};
   if(sql.includes('INSERT INTO sale_intents')){
    assert.equal(args[1],tenant);
    assert.equal(args[8],24000);
    assert.equal(JSON.parse(args[7])[0].quantity,2);
    return {rowCount:1,rows:[{id:lead}]};
   }
   throw Error('unexpected SQL');
  }
 };
 const result=await scanSalesIntents(mock);
 assert.deepEqual(result,{scanned:1,created:1});
 assert.ok(logged.every(x=>x.sql.includes('tenant_id')||x.sql.includes('FROM messages m')));
});

test('sale update refuses cross-tenant records even for valid UUID',async()=>{
 const db={
  async connect(){return {
   async query(sql,args){
    if(sql.startsWith('SELECT id,status FROM sale_intents')){assert.equal(args[0],tenant);return {rows:[],rowCount:0};}
    return {rows:[]};
   },release(){}
  };}
 };
 await assert.rejects(updateSaleIntent(db,tenant,lead,{status:'completed'}),/não encontrada/);
});

test('manual quote draft must include a human-reviewed amount and body',async()=>{
 let called=false;
 const mock={async query(){called=true;return {rows:[{id:lead}],rowCount:1};}};
 await assert.rejects(saveQuoteDraft(mock,tenant,lead,{text:'',amountCents:100}),/descrição/);
 await assert.rejects(saveQuoteDraft(mock,tenant,lead,{text:'Serviço',amountCents:-1}),/valor/);
 assert.equal(called,false);
 const record=await saveQuoteDraft(mock,tenant,lead,{text:'Serviço revisado',amountCents:25000});
 assert.equal(record.id,lead);
});

test('quote send fails closed with outbound disabled and never attempts delivery',async()=>{
 let queried=false,delivered=false;
 const mock={async query(){queried=true;return {rows:[]};}};
 await assert.rejects(sendQuoteDraft(mock,tenant,lead,lead,{
  env:{SOCIO_OUTBOUND_ENABLED:'false'},deliver:async()=>{delivered=true;}
 }),/indisponível/);
 assert.equal(queried,false);
 assert.equal(delivered,false);
});

test('navigation separates sales, estimates and business reports',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const sales=readFileSync(new URL('../public/sales.js',import.meta.url),'utf8');
 assert.match(html,/data-view="sales"/);
 assert.match(html,/data-view="quotes"/);
 assert.match(html,/data-view="reports"/);
 assert.match(html,/id="commerceAlerts"/);
 assert.match(js,/changeView\('inbox',item.conversation_id\)/);
 assert.match(sales,/data-lead-chat/);
 assert.match(sales,/data-quote-send/);
});
