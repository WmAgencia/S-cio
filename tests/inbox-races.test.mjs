import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const code=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function harness(){
 const nodes=new Map(),timers=new Map(),calls=[];let timerId=0,hook;
 const node=key=>{
  if(!nodes.has(key)){
   const flags=new Set(),listeners=new Map();
   nodes.set(key,{dataset:{},style:{},value:'',innerHTML:'',textContent:'',disabled:false,
    scrollTop:0,scrollHeight:160,clientHeight:100,listeners,
    classList:{add:k=>flags.add(k),remove:k=>flags.delete(k),contains:k=>flags.has(k),
     toggle:(k,on)=>{if(on??!flags.has(k))flags.add(k);else flags.delete(k);}},
    addEventListener:(type,fn)=>listeners.set(type,[...(listeners.get(type)||[]),fn]),
    removeEventListener(){},focus(){},setAttribute(){},scrollIntoView(){},
    querySelector:selector=>node(key+':'+selector),querySelectorAll:()=>[],
    getBoundingClientRect:()=>({left:0,top:0,width:300,height:140,right:300,bottom:140})});
  }
  return nodes.get(key);
 };
 const chats=[A,B].map((id,index)=>({id,customer_name:index?'Chat B':'Chat A',customer_phone:'5515999999999',
  status:'open',channel_provider:'waakg',channel_label:'Fixture',draft:'',labels:[],handling_mode:'human'}));
 const history=id=>({conversation:{id,status:'open'},preferences:{draft:''},hasMore:id===A,nextCursor:'opaque',
  capabilities:{whatsappSend:false},messages:[{id:id===A?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   direction:'inbound',body:id===A?'Message A':'Message B',created_at:'2026-11-04T12:00:00Z'}]});
 const api=async(path,method='GET',data)=>{
  calls.push({path,method,data});
  const answer=hook?.(path,method,data);if(answer!==undefined)return answer;
  if(path.startsWith('/api/inbox/v2'))return {conversations:chats.map(c=>({...c})),capabilities:{whatsappSend:false}};
  if(path.includes('/history?'))return history(path.split('/')[3]);
  if(path.endsWith('/ui'))return {preferences:{...data}};
  if(path.endsWith('/notes'))return {message:{id:randomUUID(),direction:'note',body:data.text,created_at:new Date().toISOString()}};
  throw Error('Unexpected API '+path);
 };
 const view={innerHTML:'',querySelector:selector=>node(selector.replace(/^#/,'')),querySelectorAll:()=>[]};
 const context={window:{innerWidth:1200,innerHeight:850,getSelection:()=>({toString:()=>''})},
  document:{hidden:false,activeElement:node('focus'),querySelector:()=>null},
  navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem:()=>null,setItem(){}},
  crypto:{randomUUID},console,Date,URL,URLSearchParams,
  setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  setInterval:()=>++timerId,clearInterval(){}
 };
 vm.runInNewContext(code,context);
 const inbox=context.window.SocioInbox.create({api,e:String,toast:()=>{},view,changeView:()=>{}});
 await inbox.render();
 const event=(type,target)=>{for(const fn of node('socioInbox').listeners.get(type)||[])fn({target,preventDefault(){}});};
 return {inbox,node,calls,setHook:fn=>{hook=fn;},
  input:value=>{node('inboxDraft').value=value;event('input',{id:'inboxDraft',value});},
  click:action=>event('click',{closest:selector=>selector==='[data-chat-action]'?{dataset:{chatAction:action}}:null}),
  flush:()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}

test('switching chats persists the previous draft to its original conversation',async()=>{
 const h=await harness();h.input('Draft for A');await h.inbox.open(B);await tick();
 h.input('Draft for B');h.flush();await tick();
 const saves=h.calls.filter(c=>c.data?.draft);
 assert(saves.some(c=>c.path.includes(A)&&c.data.draft==='Draft for A'));
 assert(saves.some(c=>c.path.includes(B)&&c.data.draft==='Draft for B'));
 assert(!saves.some(c=>c.path.includes(B)&&c.data.draft==='Draft for A'));
 h.inbox.cleanup();
});
test('late preferences and history responses do not overwrite the newly selected chat',async()=>{
 const h=await harness(),pref=deferred(),older=deferred();
 h.setHook((path,method,data)=>{
  if(path.endsWith('/ui')&&data?.pinned)return pref.promise;
  if(path.includes('&before='))return older.promise;
 });
 h.click('pin');h.click('more');await h.inbox.open(B);
 pref.resolve({preferences:{handling_mode:'ai_assist',pinned:true}});
 older.resolve({messages:[{id:randomUUID(),body:'Old message A'}],hasMore:false});
 await tick();
 assert.equal(h.inbox.state.active,B);
 assert.equal(h.inbox.state.conversation.conversation.id,B);
 assert.equal(h.inbox.state.conversation.messages[0].body,'Message B');
 assert.notEqual(h.inbox.state.conversation.preferences.handling_mode,'ai_assist');
 h.inbox.cleanup();
});
test('a pending autosave completes before the draft is cleared after note creation',async()=>{
 const h=await harness(),saving=deferred();
 h.setHook((path,method,data)=>path.endsWith('/ui')&&data?.draft==='Pending draft'?saving.promise:undefined);
 h.input('Pending draft');h.flush();await tick();h.click('save-note');await tick();
 assert(!h.calls.some(c=>c.path.endsWith('/ui')&&c.data?.draft===''));
 saving.resolve({preferences:{draft:'Pending draft'}});await tick();await tick();
 assert(h.calls.some(c=>c.path.includes(A)&&c.data?.draft===''));
 assert(h.inbox.state.conversation.messages.some(m=>m.direction==='note'));
 h.inbox.cleanup();
});
test('navigation waits for note delivery and cleanup tolerates an in-flight response',async()=>{
 const h=await harness(),delivery=deferred();
 h.setHook(path=>path.endsWith('/notes')?delivery.promise:undefined);
 h.input('Internal note');h.click('save-note');await h.inbox.open(B);
 assert.equal(h.inbox.state.active,A);
 h.inbox.cleanup();delivery.resolve({message:{id:randomUUID(),direction:'note',body:'Internal note'}});
 await tick();await tick();assert.equal(h.inbox.state.active,null);
});
