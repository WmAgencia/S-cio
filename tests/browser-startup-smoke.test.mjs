import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('client startup initializes icons and reveals login on an unauthenticated visit',async()=>{
 const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const elements=new Map();
 const node=(id)=>{
  if(!elements.has(id)){
   const names=new Set(['authScreen','appShell','setupForm'].includes(id)?['hidden']:[]);
   elements.set(id,{
    innerHTML:'',textContent:'',dataset:{view:'overview'},style:{},
    classList:{
     contains:key=>names.has(key),
     add:key=>names.add(key),
     remove:key=>names.delete(key),
     toggle:(key,forced)=>{if(forced??!names.has(key))names.add(key);else names.delete(key);}
    },
    addEventListener(){},
    querySelector(selector){return node(id+':'+selector)},
    querySelectorAll(){return []},
    setAttribute(){},focus(){}
   });
  }
  return elements.get(id);
 };
 const nav=['overview','inbox','channels','products','training','agent','team','admin']
   .map(name=>({...node('button:'+name),dataset:{view:name},querySelector:()=>node('symbol:'+name)}));
 let calls=0;
 const fakeDoc={
  querySelector:selector=>node(selector.replace(/^#/,'id:')),
  querySelectorAll:selector=>selector.includes('nav-item')?nav:[],
  addEventListener(){}
 };
 // The script must finish evaluating without throwing, including the icon
 // setup at top level, before its asynchronous /api/bootstrap request.
 const context={document:fakeDoc,console,URL,Date,FormData,Intl,setTimeout,clearTimeout,
  fetch:async url=>{
   calls++;
   return {ok:url==='/api/bootstrap',status:url==='/api/bootstrap'?200:401,
    json:async()=>url==='/api/bootstrap'?{initialized:true}:{error:'Unauthenticated'}};
  }};
 assert.doesNotThrow(()=>vm.runInNewContext(code,context,{timeout:2500}));
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(calls>=2,'boot must call bootstrap and session API');
 assert.equal(node('id:authScreen').classList.contains('hidden'),false,'login screen is visible');
 assert.equal(node('id:loginForm').classList.contains('hidden'),false,'email-or-phone login form is visible');
 assert.equal(node('id:appShell').classList.contains('hidden'),true,'private app remains hidden');
 assert.match(node('symbol:overview').innerHTML,/<svg/,'sidebar icons initialized');
});
