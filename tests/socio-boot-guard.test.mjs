import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/socio-boot-guard.js',import.meta.url),'utf8');

function harness({authHidden=true,appHidden=true}={}){
 const children=[],timers=[],handlers={};
 let reloads=0;
 const status={hidden:false,textContent:'Conectando…',appendChild:node=>children.push(node)};
 const login={classList:{contains:x=>x==='hidden'&&authHidden}};
 const app={classList:{contains:x=>x==='hidden'&&appHidden}};
 const document={
  getElementById:id=>({socioBootStatus:status,authScreen:login,appShell:app}[id]??null),
  createElement:type=>({type,textContent:'',addEventListener:(name,fn)=>{handlers[name]=fn;}})
 };
 vm.runInNewContext(script,{document,setTimeout:(fn,delay)=>{timers.push({fn,delay});},location:{reload:()=>reloads++}});
 return {status,children,timers,handlers,getReloads:()=>reloads};
}

test('a failing main bundle never leaves the full-screen boot spinner forever',()=>{
 const x=harness();
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].delay,20000);
 x.timers[0].fn();
 assert.match(x.status.textContent,/Não foi possível concluir/);
 assert.equal(x.children.length,1);
 assert.equal(x.children[0].textContent,'Recarregar Sócio');
 x.handlers.click();
 assert.equal(x.getReloads(),1);
});

test('guard never interferes with login, authenticated app or successful boot',()=>{
 for(const params of [{authHidden:false},{appHidden:false}]){
  const x=harness(params);x.timers[0].fn();
  assert.equal(x.status.hidden,true);
  assert.equal(x.children.length,0);
 }
 const x=harness();x.status.hidden=true;x.timers[0].fn();
 assert.equal(x.children.length,0);
});
