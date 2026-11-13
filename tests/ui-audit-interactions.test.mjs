import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const APP=file('public/app.js'),HTML=file('public/index.html'),CSS=file('public/socio-ux.css');

function simulatedApp({features=null,products=[]}={}){
 const nodes=new Map(),handlers=new Map();
 function node(id){
  if(!nodes.has(id)){
   const classes=new Set(['authScreen','appShell'].includes(id)?['hidden']:[]);
   const element={innerHTML:'',textContent:'',value:'',type:'password',
    style:{},dataset:{},disabled:false,attributes:{},
    classList:{
     contains:k=>classes.has(k),
     add:k=>classes.add(k),
     remove:k=>classes.delete(k),
     toggle:(k,forced)=>{if(forced===undefined?!classes.has(k):forced)classes.add(k);else classes.delete(k);}
    },
    addEventListener(type,cb){handlers.set(id+':'+type,cb);},
    setAttribute(k,v){this.attributes[k]=v;},
    removeAttribute(k){delete this.attributes[k];},
    focus(){},scrollIntoView(){},
    querySelector(x){return node(id+':'+x);},
    querySelectorAll(){return []}
   };
   nodes.set(id,element);
  }
  return nodes.get(id);
 }
 const names=['overview','inbox','products','marketing','training','team','admin'];
 const nav=names.map(key=>({...node('nav:'+key),dataset:{view:key},querySelector:()=>node('symbol:'+key)}));
 const values={
  '/api/bootstrap':{initialized:true},
  '/api/me':{user:{id:'u',name:'Gestora Teste',role:'owner',platformOwner:false,permissions:[
   'catalog.read','catalog.manage','marketing.read','marketing.manage','training.manage','team.read'
  ]},tenant:{id:'tenant',name:'Empresa Teste',features:features||{
   whatsapp:true,catalog:true,meta_ads:true,ai:true,team:true
  }},csrf:'abc'},
  '/api/dashboard':{openConversations:0,channels:0,products:products.length,imports:0,inboundMessages:0,messagesReceivedToday:0},
  '/api/waakg/channels':[],
  '/api/agent':{instructions:'',enabled:false},
  '/api/dashboard/activity?range=1m':{points:[]},
  '/api/dashboard/activity?range=6m':{points:[]},
  '/api/inbox':[],
  '/api/products':products,
  '/api/products/storage':{configured:false,limits:{maxPhotos:8,maxSourceBytes:3000000}},
  '/api/marketing':{connections:[],reports:[]},
  '/api/marketing/oauth':{grants:[]}
 };
 const document={
  querySelector:sel=>node(sel.replace(/^#/,'id:')),
  querySelectorAll:sel=>sel.includes('nav-item')?nav:[],
  addEventListener(){}
 };
 const context={document,Date,URL,Intl,FormData,console,setTimeout,clearTimeout,
  window:{},
  fetch:async u=>({ok:Object.hasOwn(values,u),status:Object.hasOwn(values,u)?200:404,
   json:async()=>values[u]||{error:'Not found'}})};
 vm.createContext(context);vm.runInContext(APP,context,{timeout:4000});
 return {context,node,handlers};
}
test('login uses accessible interactive controls with focus and motion fallback',()=>{
 assert.match(HTML,/id="loginPassword"/);
 assert.match(HTML,/id="togglePassword"/);
 assert.match(HTML,/id="capsWarning"/);
 assert.match(CSS,/prefers-reduced-motion/);
 assert.match(CSS,/feature-grid/);
 assert.match(APP,/setAttribute\('aria-pressed'/);
 assert.match(APP,/submit.disabled=true/);
});
test('catalog populated UI includes photos, variants and statuses without emitting raw HTML',async()=>{
 const flag={whatsapp:true,catalog:true,meta_ads:false,ai:true,team:false};
 const fixture=[{
  id:'11111111-1111-4111-8111-111111111111',name:'Câmera <Premium>',sku:'CAM-01',
  price_cents:55990,stock_quantity:7,active:true,
  variants:[],media:[{id:'a',url:'/api/products/photo/test',alt:'Foto de produto'}],campaigns:[]
 },{
  id:'22222222-2222-4222-8222-222222222222',name:'Kit sem estoque',
  sku:null,price_cents:12900,stock_quantity:0,active:true,
  variants:[{id:'v',name:'Único',price_cents:12900,stock_quantity:0,active:true}],media:[],campaigns:[]
 }];
 const sim=simulatedApp({features:flag,products:fixture});
 await new Promise(r=>setTimeout(r,55));
 await vm.runInContext("changeView('products')",sim.context);
 const html=sim.node('id:view').innerHTML;
 assert.match(html,/Câmera &lt;Premium&gt;/);
 assert.doesNotMatch(html,/<Premium>/);
 assert.match(html,/catalog-cover-image/);
 assert.match(html,/559,90/);
 assert.match(html,/Indisponível/);
 assert.match(html,/data-select-product/);
 assert.match(html,/id="catalogSearch"/);
 assert.match(html,/id="catalogStock"/);
 assert.match(html,/id="catalogNoResults"/);
 assert.match(html,/Foto de produto/);
 assert.doesNotMatch(html,/Google Ads/);
 assert.equal(sim.node('id:authScreen').classList.contains('hidden'),true);
 assert.equal(sim.node('id:appShell').classList.contains('hidden'),false);
});
test('tenant hides modules and stops navigation even when caller invokes internal view',async()=>{
 const flags={whatsapp:true,catalog:true,meta_ads:false,ai:true,team:false};
 const sim=simulatedApp({features:flags});
 await new Promise(r=>setTimeout(r,60));
 await vm.runInContext("changeView('sales')",sim.context);
 assert.equal(vm.runInContext('state.view',sim.context),'overview');
 await vm.runInContext("changeView('quotes')",sim.context);
 assert.equal(vm.runInContext('state.view',sim.context),'overview');
 await vm.runInContext("changeView('marketing')",sim.context);
 assert.equal(vm.runInContext('state.view',sim.context),'overview');
 await vm.runInContext("changeView('products')",sim.context);
 assert.match(sim.node('id:view').innerHTML,/Seu catálogo está vazio/);
});
test('commerce is fully removed from the dashboard and server',()=>{
 assert.doesNotMatch(APP,/SocioSales|sales\.read|quote-requests|quote-alerts/);
 assert.doesNotMatch(HTML,/sales\.js|sales\.css|commerceAlerts/);
});

test('own account security remains accessible without the team module',async()=>{
 const sim=simulatedApp({features:{whatsapp:false,catalog:true,meta_ads:false,ai:false,team:false}});
 await new Promise(resolve=>setTimeout(resolve,60));
 await vm.runInContext("state.me.user.permissions.push('account.manage'); changeView('settings')",sim.context);
 assert.equal(vm.runInContext('state.view',sim.context),'settings');
 const html=sim.node('id:view').innerHTML;
 assert.match(html,/id="passwordChangeForm"/);assert.match(html,/id="myPhoneForm"/);
 assert.doesNotMatch(html,/id="teamForm"|Não foi possível carregar/);
});
