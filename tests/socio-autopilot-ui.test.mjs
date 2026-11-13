import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

// A DOM just large enough for the pop-up: elements, children, listeners,
// data-* lookup and the handful of properties the card touches.
function makeDom(){
 const registry=[];
 function el(tag){
  const node={
   tagName:tag,children:[],dataset:{},attributes:{},style:{},listeners:{},
   classList:{_set:new Set(),
    add(...names){for(const name of names)this._set.add(name);},
    remove(...names){for(const name of names)this._set.delete(name);},
    toggle(name,on){if(on)this._set.add(name);else this._set.delete(name);return this._set.has(name);},
    contains(name){return this._set.has(name);}},
   className:'',textContent:'',hidden:false,value:'',disabled:false,
   append(...kids){for(const kid of kids){kid.parentNode=node;node.children.push(kid);}return node;},
   appendChild(kid){return node.append(kid);},
   remove(){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(x=>x!==node);},
   setAttribute(name,value){node.attributes[name]=String(value);},
   getAttribute(name){return node.attributes[name];},
   addEventListener(type,fn){(node.listeners[type]=node.listeners[type]||[]).push(fn);},
   click(){(node.listeners.click||[]).forEach(fn=>fn({}));},
   focus(){node.focused=true;},
   querySelector(selector){
    const match=/^\[data-decision-id="(.+)"\]$/.exec(selector);
    if(!match)return null;
    const walk=list=>{for(const kid of list){if(kid.dataset?.decisionId===match[1])return kid;
     const found=walk(kid.children||[]);if(found)return found;}return null;};
    return walk(node.children);
   }
  };
  Object.defineProperty(node,'isConnected',{get:()=>node.connected!==false});
  Object.defineProperty(node,'id',{get:()=>node._id||'',set:value=>{node._id=value;}});
  registry.push(node);
  return node;
 }
 const head=el('head'),body=el('body');
 const document={
  head,body,hidden:false,
  createElement:el,
  getElementById:id=>registry.find(node=>node._id===id)||null,
  querySelector:()=>null
 };
 return {document,head,body,registry};
}

function loadUI({location}={}){
 const dom=makeDom(),timers=[],alerts=[];
 class AudioStub{
  constructor(src){this.src=src;this.played=0;this.currentTime=0;alerts.push(this);}
  play(){this.played++;return Promise.resolve();}
 }
 const context={
  document:dom.document,
  Audio:AudioStub,
  setInterval:fn=>{timers.push(fn);return timers.length;},
  clearInterval:id=>{if(id)timers[id-1]=null;},
  setTimeout:()=>0,
  console
 };
 if(location)context.location=location;
 context.globalThis=context;
 vm.createContext(context);
 new vm.Script(read('public/socio-autopilot-ui.js'),{filename:'socio-autopilot-ui.js'}).runInContext(context);
 return {ui:context.SocioAutopilotUI,dom,timers,alerts,
  tick:()=>Promise.all(timers.filter(Boolean).map(fn=>fn()))};
}

const owner={user:{permissions:['marketing.read','marketing.manage'],platformOwner:false}};
const decision={id:'11111111-1111-4111-8111-111111111111',action:'scale',
 question:'Estamos com boa performance no anúncio "Vídeo 1" da campanha "Bolos". Posso aumentar o valor diário de R$ 6,00 para R$ 10,00?',
 explanation:'CTR 2,4% e custo por conversa abaixo da meta há 3 dias.',
 targetBudgetCents:1000};

function apiStub(pending=[decision]){
 const calls=[];
 const api=async(path,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='/api/marketing/traffic/pending')return {items:pending};
  if(path==='/api/marketing/traffic/decision')return {ok:true,applied:true,
   action:{targetBudgetCents:body.targetBudgetCents||decision.targetBudgetCents}};
  throw new Error('unexpected '+path);
 };
 return {api,calls};
}

const cards=dom=>dom.body.children.find(node=>node.className==='socio-autopilot').children;
const button=(card,label)=>{
 const actions=card.children.find(node=>node.className==='socio-autopilot-actions');
 return actions.children.find(node=>node.textContent===label);
};

test('The pop-up only starts for someone allowed to read marketing',async()=>{
 const {ui,dom}=loadUI();
 const {api}=apiStub();
 ui.start({api,me:{user:{permissions:['channels.manage']}}});
 assert.equal(dom.body.children.length,0);
 ui.start({api,me:owner});
 assert.equal(dom.body.children.length,1);
 assert.equal(dom.body.children[0].className,'socio-autopilot');
});

test('Pending recommendations render one card with the exact question and all three answers',async()=>{
 const {ui,dom}=loadUI();
 const {api,calls}=apiStub();
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls[0].path,'/api/marketing/traffic/pending');
 const [card]=cards(dom);
 assert.equal(card.dataset.decisionId,decision.id);
 assert.equal(card.children.find(node=>node.textContent===decision.question).tagName,'p');
 assert(button(card,'Sim')&&button(card,'Não')&&button(card,'Outro valor'));
 assert.equal(card.children.find(node=>node.className==='socio-autopilot-amount').hidden,true);
});

test('Sim and Não answer that decision through the decision route',async()=>{
 for(const [label,resolution] of [['Sim','approve'],['Não','dismiss']]){
  const {ui,dom}=loadUI();
  const {api,calls}=apiStub();
  ui.start({api,me:owner});
  await new Promise(resolve=>setImmediate(resolve));
  const [card]=cards(dom);
  button(card,label).click();
  await new Promise(resolve=>setImmediate(resolve));
  const post=calls.find(call=>call.method==='POST');
  assert.equal(post.path,'/api/marketing/traffic/decision');
  assert.deepEqual({...post.body},{id:decision.id,resolution});
 }
});

test('Outro valor reveals the amount field and sends the number in cents',async()=>{
 const {ui,dom}=loadUI();
 const {api,calls}=apiStub();
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 const [card]=cards(dom);
 button(card,'Outro valor').click();
 const wrap=card.children.find(node=>node.className==='socio-autopilot-amount');
 assert.equal(wrap.hidden,false);
 const [amount]=wrap.children;
 amount.value='12,50';
 wrap.children[1].click();
 await new Promise(resolve=>setImmediate(resolve));
 const post=calls.find(call=>call.method==='POST');
 assert.deepEqual({...post.body},{id:decision.id,resolution:'approve',targetBudgetCents:1250});
});

test('An invalid amount is refused without calling the server',async()=>{
 const {ui,dom}=loadUI();
 const {api,calls}=apiStub();
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 const [card]=cards(dom);
 button(card,'Outro valor').click();
 const wrap=card.children.find(node=>node.className==='socio-autopilot-amount');
 wrap.children[0].value='abc';
 wrap.children[1].click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(call=>call.method==='POST').length,0);
 const note=card.children.at(-1);
 assert.equal(note.hidden,false);
 assert.match(note.textContent,/valor diário válido/);
});

test('A resolved decision disappears and an already answered card is not rebuilt',async()=>{
 const {ui,dom}=loadUI();
 const pending=[decision];
 const {api}=apiStub(pending);
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards(dom).length,1);
 pending.length=0;
 await ui.poll();
 assert.equal(cards(dom).length,0);
 assert.equal(dom.body.children.length,1);
});

test('A recommendation that arrives while the app is open chimes once',async()=>{
 const {ui,alerts}=loadUI();
 const pending=[];
 const {api}=apiStub(pending);
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(alerts.length,0,'nothing rings just for opening the page');
 pending.push(decision);
 await ui.poll();
 assert.equal(alerts.length,1);
 assert.equal(alerts[0].src,'/socio-new-recommendation.mp3');
 assert.equal(alerts[0].played,1);
 await ui.poll();
 assert.equal(alerts[0].played,1,'the same recommendation never rings twice');
});

test('The overview shows recommendations in its own column and hides the pop-up there',async()=>{
 const location={hash:'#/overview'};
 const {ui,dom}=loadUI({location});
 const {api}=apiStub();
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 const root=()=>dom.body.children.find(node=>node.className==='socio-autopilot');
 assert.equal(root().classList.contains('is-suppressed'),true);
 location.hash='#/marketing';
 await ui.poll();
 assert.equal(root().classList.contains('is-suppressed'),false);
 location.hash='#/overview';
 await ui.poll();
 assert.equal(root().classList.contains('is-suppressed'),true);
});

test('Polling pauses while the tab is hidden',async()=>{
 const {ui,dom}=loadUI();
 const {api,calls}=apiStub();
 ui.start({api,me:owner});
 await new Promise(resolve=>setImmediate(resolve));
 dom.document.hidden=true;
 const before=calls.length;
 await ui.poll();
 assert.equal(calls.length,before);
});

test('The pop-up itself is wired into the page, the app and the server',()=>{
 const html=read('public/index.html'),app=read('public/app.js'),server=read('server.mjs');
 assert(html.includes('/socio-autopilot-ui.js'));
 assert(html.indexOf('/socio-autopilot-ui.js')<html.indexOf('/app.js'));
 assert(server.includes("'/socio-autopilot-ui.js'"));
 assert(html.includes('/socio-autopilot.css'),'the card styles ship in a file; the CSP blocks inline <style>');
 assert(server.includes("'/socio-autopilot.css'"));
 const css=read('public/socio-autopilot.css');
 assert.match(css,/\.socio-autopilot\{[^}]*position:fixed[^}]*bottom:1[2-9]\dpx/,'the card sits above the orb instead of on top of it');
 assert.match(css,/@keyframes socio-autopilot-in/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(app,/SocioAutopilotUI\?\.start\(\{api,me:state\.me\}\)/);
 assert.match(app,/SocioAutopilotUI\?\.dispose\(\)/);
 assert(server.includes("'/socio-new-recommendation.mp3'"),'the alert sound is served from our own origin, never a third party');
 assert.match(server,/file\.endsWith\('\.mp3'\)\?'audio\/mpeg'/);
 assert(read('public/socio-autopilot-ui.js').includes("'/socio-new-recommendation.mp3'"));
 assert(server.includes("pathname==='/api/marketing/traffic/pending'&&method==='GET'"));
 assert(server.includes("pathname==='/api/marketing/traffic/decision'&&method==='POST'"));
 assert.match(server,/listPendingDecisions\(pool,a\.active_tenant_id\)/);
 assert.match(server,/resolveTrafficDecision\(pool,a,\{id:data\.id,resolution:data\.resolution/);
});
