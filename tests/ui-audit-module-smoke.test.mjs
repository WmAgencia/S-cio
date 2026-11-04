import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sales=readFileSync(new URL('../public/sales.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/socio-ux.css',import.meta.url),'utf8');
const full={whatsapp:true,catalog:true,sales:true,ai:true,metaAds:true};
function dom(){
 const map=new Map();
 function make(key){
  if(!map.has(key)){
   const flags=new Set(['authScreen','appShell'].includes(key)?['hidden']:[]);
   const node={
    innerHTML:'',textContent:'',value:'',dataset:{},style:{},disabled:false,hidden:false,
    classList:{
     contains:x=>flags.has(x),add:x=>flags.add(x),remove:x=>flags.delete(x),
     toggle:(x,force)=>{if(force===undefined?!flags.has(x):force)flags.add(x);else flags.delete(x);}
    },
    addEventListener(){},setAttribute(){},focus(){},scrollIntoView(){},insertAdjacentHTML(){},
    querySelector:sel=>make(key+':'+sel),querySelectorAll(){return []},
    get elements(){return new Proxy({}, {get(_,name){return make(key+':element:'+String(name));}})}
   };
   map.set(key,node);
  }
  return map.get(key);
 }
 const nav=['overview','inbox','marketing','products','sales','training','team','admin']
  .map(name=>({...make('nav:'+name),dataset:{view:name},querySelector:()=>make('icon:'+name)}));
 const document={
  querySelector:selector=>make(selector.replace(/^#/,'id:')),
  querySelectorAll:selector=>selector.includes('.nav-item')?nav:[],
  addEventListener(){}
 };
 return {document,make,nav};
}
function bootFixture({features=full,initial='overview'}={}){
 const tree=dom();
 const product={
  id:'22222222-2222-4222-8222-222222222222',name:'Kit de cuidados premium',
  sku:'KIT-PREMIUM',active:true,price_cents:55000,stock_quantity:9,variants:[
   {id:'33333333-3333-4333-8333-333333333333',name:'Grande',price_cents:60000,stock_quantity:2,active:true}],
  media:[{id:'44444444-4444-4444-8444-444444444444',url:'/api/products/test/media/test/file',alt:'Kit real'}],
  campaigns:[],description:'Descrição aprovada',compare_at_price_cents:65000
 };
 const role=['inbox.read','catalog.read','sales.read','marketing.read','training.manage','account.manage'];
 const perms=role.filter(p=>(!p.startsWith('inbox')||features.whatsapp)&&
  (!p.startsWith('catalog')||features.catalog)&&
  (!p.startsWith('sales')||features.sales)&&
  (!p.startsWith('marketing')||features.metaAds)&&
  (!p.startsWith('training')||features.ai));
 const resources={
  '/api/bootstrap':{initialized:true},
  '/api/me':{user:{name:'Dono da empresa',role:'owner',platformOwner:true,permissions:perms},
   tenant:{id:'11111111-1111-4111-8111-111111111111',name:'Empresa de teste',features},csrf:'csrf-test'},
  '/api/dashboard':{openConversations:1,messagesReceivedToday:2},
  '/api/dashboard/activity?range=1m':{granularity:'day',points:[{date:'2026-11-04',inbound:2,outbound:1}]},
  '/api/inbox':[{id:'55555555-5555-4555-8555-555555555555',customer_name:'Cliente de teste',
   customer_phone:'5515999999999',channel_label:'WhatsApp',status:'open'}],
  '/api/waakg/channels':[],
  '/api/products':[product],
  '/api/products/storage':{configured:true},
  '/api/training/auto':{run:null,groqConfigured:true},
  '/api/training/versions':[],
  '/api/agent':{enabled:true,name:'Sócio',tone:'Natural',knowledge_md:''},
  '/api/admin/tenants':[{id:'11111111-1111-4111-8111-111111111111',name:'Empresa de teste',
   slug:'empresa-teste',plan:'essencial',status:'active',members:1,features}]
 };
 const context={document:tree.document,window:{SocioSales:{render:async()=>{}}},console,
  Intl,Date,URL,FormData,setTimeout,clearTimeout,
  fetch:async url=>({ok:url in resources,status:url in resources?200:404,
   json:async()=>resources[url]||{error:'Not found'}})};
 vm.createContext(context);
 vm.runInContext(app,context,{timeout:2500});
 return {tree,context,resources,product};
}
const wait=()=>new Promise(r=>setTimeout(r,30));
test('login is interactive, accessible and never embeds credentials in markup',()=>{
 assert.match(html,/id="loginPassword"/);
 assert.match(html,/id="toggleLoginPassword"[^>]*aria-controls="loginPassword"/);
 assert.match(html,/id="loginCapsMessage"/);
 assert.match(html,/id="loginProgress"/);
 assert.match(app,/bindPasswordToggle\('loginPassword','toggleLoginPassword'\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.doesNotMatch(html,/type="password"[^>]*value="[^"]{8,}"/);
});
test('AI training empty history does not call .forEach on a null single element',async()=>{
 const {context,tree}=bootFixture();
 await wait();
 await vm.runInContext("changeView('training')",context);
 const rendered=tree.make('id:view').innerHTML;
 assert.match(rendered,/Seu Sócio aprende com suas conversas/);
 assert.doesNotMatch(rendered,/Não foi possível carregar|Cannot read properties/);
 assert(app.includes("$$('[data-restore-version]').forEach"));
});
test('products populated with media, variants and pricing appear as interactive accessible cards',async()=>{
 const {context,tree}=bootFixture();
 await wait();
 await vm.runInContext("changeView('products')",context);
 const rendered=tree.make('id:view').innerHTML;
 for(const expected of ['Kit de cuidados premium','KIT-PREMIUM','550,00','1 variação(ões)',
  'aria-haspopup="dialog"','catalog-cover-image','Novo produto']){
  assert(rendered.includes(expected),'missing populated catalog UI: '+expected);
 }
 assert.doesNotMatch(rendered,/Não foi possível carregar/);
 assert.match(css,/\.socio-catalog-clean \.catalog-list/);
});
test('tenant with WhatsApp, AI, quotes and catalog disabled sees only the active feature',async()=>{
 const {context,tree}=bootFixture({features:{whatsapp:false,catalog:false,sales:false,ai:false,metaAds:true}});
 await wait();
 const view=tree.make('id:view').innerHTML;
 assert(view.includes('Meta Ads'));
 assert(!view.includes('Conectar WhatsApp'));
 assert(!view.includes('Inteligência Artificial'));
 await vm.runInContext("changeView('sales')",context);
 assert(!tree.make('id:view').innerHTML.includes('Orçamentos e pedidos'));
});
test('admin company editor contains five module switches, including quotes and Meta Ads',async()=>{
 const {context,tree}=bootFixture();
 await wait();
 await vm.runInContext("changeView('admin')",context);
 const rendered=tree.make('id:view').innerHTML;
 for(const key of ['whatsapp','catalog','sales','ai','metaAds']){
  assert(rendered.includes('feature_'+key),'missing company module: '+key);
 }
 assert(rendered.includes('Salvar funcionalidades'));
 assert(rendered.includes('data-module-edit'));
 assert(!rendered.includes('Google Ads'));
});
test('sales renders a customer quote request and existing catalog pricing without auto issuing proposals',async()=>{
 const tree=dom(),context={window:{},console,Intl,Date,URL,confirm:()=>true};
 vm.createContext(context);vm.runInContext(sales,context,{timeout:1500});
 const product={id:'22222222-2222-4222-8222-222222222222',name:'Kit de cuidados',
  active:true,price_cents:55000,variants:[]};
 const request={id:'66666666-6666-4666-8666-666666666666',
  conversation_id:'55555555-5555-4555-8555-555555555555',
  customer_name:'Cliente solicitante',request_excerpt:'Pode fazer um orçamento?',
  status:'pending',alert_status:'disabled',created_at:'2026-11-04T12:00:00Z'};
 const api=async path=>{
  if(path==='/api/sales')return {quotes:[],orders:[],paymentTestAvailable:false};
  if(path==='/api/products')return [product];
  if(path==='/api/inbox')return [{id:request.conversation_id,customer_name:'Cliente solicitante',channel_label:'WA'}];
  if(path==='/api/quote-requests')return {requests:[request],pendingCount:1,alerts:{enabled:false}};
  throw Error('Unexpected API: '+path);
 };
 const view=tree.make('sales-view');
 await context.window.SocioSales.render({api,e:v=>String(v),toast:()=>{},view,
  me:{user:{role:'owner',platformOwner:false}}});
 const rendered=view.innerHTML;
 assert.match(rendered,/Pedidos de orçamento recebidos/);
 assert.match(rendered,/Cliente solicitante/);
 assert.match(rendered,/Pode fazer um orçamento/);
 assert.match(rendered,/data-quote-prepare/);
 assert.match(rendered,/Ativar avisos no meu WhatsApp/);
 assert.match(rendered,/Kit de cuidados/);
 assert.match(rendered,/R\$\s*550,00/);
 assert.doesNotMatch(rendered,/enviado automaticamente ao cliente/);
});
