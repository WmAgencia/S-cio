import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('Inbox browser module renders empty and authenticated message history without a blank screen',async()=>{
 const js=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
 const nodes=new Map(),classes=new Map();
 const make=(key)=>{
  if(!nodes.has(key)){
   const flags=new Set();
   const node={dataset:{},style:{},textContent:'',innerHTML:'',value:'',disabled:false,
    scrollTop:0,scrollHeight:160,clientHeight:100,
    classList:{add:k=>flags.add(k),remove:k=>flags.delete(k),
      contains:k=>flags.has(k),toggle:(k,on)=>{if(on??!flags.has(k))flags.add(k);else flags.delete(k)}},
    addEventListener(){},removeEventListener(){},focus(){},querySelector(){return make(key+':child')},
    querySelectorAll(){return []},getBoundingClientRect(){return {left:0,top:0,right:300,bottom:140,width:300,height:140}},
    scrollIntoView(){},setAttribute(){}
   };
   nodes.set(key,node);classes.set(key,flags);
  }
  return nodes.get(key);
 };
 const view={
  innerHTML:'',
  querySelector:sel=>make(sel.startsWith('#')?sel.slice(1):sel),
  querySelectorAll:()=>[]
 };
 const ctx={
  window:{innerWidth:1250,innerHeight:860,getSelection:()=>({toString:()=>''})},
  document:{hidden:false,activeElement:make('focus'),querySelector:()=>null},
  navigator:{clipboard:{writeText:async()=>{}}},
  localStorage:{getItem:()=>null,setItem(){}},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},console,Date,URL,URLSearchParams,
 };
 vm.runInNewContext(js,ctx,{timeout:3000});
 assert.equal(typeof ctx.window.SocioInbox.create,'function');
 let ids=[];
 const reply={conversation:{id:'11111111-1111-4111-8111-111111111111',status:'open',
  customer_name:'Cliente',customer_phone:'5515999999999'},
  preferences:{draft:''},hasMore:false,nextCursor:null,
  messages:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',direction:'inbound',
   body:'Qual o preço?',created_at:'2026-11-04T12:00:00Z',starred:false,reaction:null}]};
 const user={id:'11111111-1111-4111-8111-111111111111',customer_name:'Cliente',
  customer_phone:'5515999999999',status:'open',channel_label:'Atendimento',draft:'',
  labels:[],handling_mode:'human',last_message_at:'2026-11-04T12:00:00Z'};
 const api=async(path,method='GET',data)=>{
  ids.push(path);
  if(path.startsWith('/api/inbox/v2'))return {conversations:[user],capabilities:{whatsappSend:false}};
  if(path.endsWith('/history?limit=80'))return {...reply,messages:[...reply.messages]};
  if(path.endsWith('/ui')&&method==='PATCH')return {ok:true,preferences:{...data}};
  throw Error('Unexpected '+path);
 };
 const inbox=ctx.window.SocioInbox.create({
  api,e:x=>String(x??'').replace(/</g,'&lt;'),toast:()=>{},view,changeView:()=>{}
 });
 await inbox.render();
 assert.match(view.innerHTML,/socioInbox/);
 assert.match(make('inboxItems').innerHTML,/Cliente/);
 assert.match(make('inboxMain').innerHTML,/wa-thread-container/);
 assert.match(make('inboxMessageList').innerHTML,/Qual o preço/);
 assert.match(make('inboxCompose').innerHTML,/não enviada ao cliente/i);
 assert(ids.some(path=>path.includes('/history?limit=80')));
 inbox.cleanup();
});
