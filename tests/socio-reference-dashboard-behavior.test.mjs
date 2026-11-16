import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
function harness(traffic=[]){
 const requests=[],navigation=[],timers=[];
 const buttons=[];
 const root={isConnected:true,_html:'',
  set innerHTML(value){this._html=value;buttons.length=0;
   for(const match of value.matchAll(/data-open-conversation="([^"]+)"/g)){
    const button={dataset:{openConversation:match[1]},addEventListener(type,fn){this[type]=fn;}};
    buttons.push(button);
   }
  },get innerHTML(){return this._html;},
  querySelector(selector){return selector==='.px-overview'?{}:null;},
  querySelectorAll(selector){return selector==='[data-open-conversation]'?buttons:[];}};
 const context={window:{},document:{hidden:false},console,Date,URL,URLSearchParams,
  setInterval:()=>1,clearInterval(){},setTimeout:fn=>timers.push(fn),clearTimeout(){}};
 vm.runInNewContext(code,context);
 const metrics=[{campaign_id:'winner',campaign_name:'Melhor no período',clicks:'30',spend:'60',
  actions:[{action_type:'omni_purchase',value:'3'},{action_type:'offsite_conversion.fb_pixel_purchase',value:'3'}]}];
 const chats=[
  {id:'old',customer_name:'Antigo IA',channel_provider:'waakg',handling_mode:'ai_assist',last_message_at:'2026-11-12T12:00:00Z'},
  {id:'human',customer_name:'Humano',channel_provider:'waakg',handling_mode:'human',last_message_at:'2026-11-14T15:00:00Z'},
  {id:'instagram',customer_name:'Instagram IA',channel_provider:'instagram',handling_mode:'ai_assist',last_message_at:'2026-11-14T16:00:00Z'},
  {id:'new',customer_name:'Novo IA',channel_provider:'waakg',handling_mode:'ai_assist',last_message_at:'2026-11-14T12:00:00Z'}];
 const api=async path=>{
  requests.push(path);
  if(path.startsWith('/api/dashboard/period?'))return {period:{from:'2026-11-08',to:'2026-11-14'},
   leads:{campaign:12,previousCampaign:6},sales:{revenueCents:123400,confirmed:4}};
  if(path==='/api/dashboard/revenue')return {months:[]};
  if(path==='/api/inbox/v2')return {conversations:chats};
  if(path==='/api/marketing/official/status')return {selectedAccount:{currency:'BRL'}};
  if(path.includes('/insights?since='))return {items:metrics};
  if(path.includes('/insights?period='))return {items:[{campaign_id:'today',campaign_name:'Somente hoje',clicks:100}]};
  if(path==='/api/marketing/tools/campaigns')return {items:[{id:'winner',name:'Melhor no período',status:'ACTIVE'}]};
  if(path.startsWith('/api/marketing/traffic?'))return {items:traffic};
  if(path.includes('/api/marketing/tools/'))return {items:[]};
  throw new Error('Unexpected '+path);
 };
 const render=()=>context.SocioWorkspaceUI.overview({root,api,me:{tenant:{id:'fixture'},
  user:{permissions:['marketing.read','inbox.read']}},navigate:(...args)=>navigation.push(args),periodPreset:'7d'});
 return {root,requests,navigation,buttons,render};
}

test('dashboard opens the selected WhatsApp conversation, with newest AI chats first',async()=>{
 const h=harness();await h.render();
 assert.deepEqual(h.buttons.map(button=>button.dataset.openConversation),['new','old']);
 h.buttons[0].click();
 assert.deepEqual(h.navigation,[['inbox','new']]);
 assert.doesNotMatch(h.root.innerHTML,/Humano|Instagram IA/);
});

test('answered recommendations stay out of the stack, including after the final answer',async()=>{
 const answered={id:'done',status:'done',question:'Already answered recommendation'};
 const pending={id:'pending',status:'awaiting_approval',question:'Next recommendation'};
 const h=harness([answered,pending]);await h.render();
 assert.doesNotMatch(h.root.innerHTML,/data-rec-id="done"|Already answered recommendation/);
 assert.match(h.root.innerHTML,/data-rec-id="pending"/);
 const empty=harness([answered]);await empty.render();
 assert.match(empty.root.innerHTML,/Nada para decidir agora/);
 assert.doesNotMatch(empty.root.innerHTML,/data-rec-id="done"/);
});

test('featured campaign uses the headline date range and spend conversion reads raw Meta actions once',async()=>{
 const h=harness();await h.render();
 assert(h.requests.includes('/api/marketing/tools/insights?since=2026-11-08&until=2026-11-14'));
 assert.match(h.root.innerHTML,/Melhor no período/);
 assert.doesNotMatch(h.root.innerHTML,/Somente hoje/);
 assert.doesNotMatch(h.root.innerHTML,/30 cliques · Últimos 7 dias/);
 assert.doesNotMatch(h.root.innerHTML,/gastos no período/);
 assert.match(h.root.innerHTML,/Taxa de conversão<\/span><span class="et-legend-value">10,00%/);
 assert.match(h.root.innerHTML,/4 vendas/);
 assert.match(h.root.innerHTML,/vindos de campanhas no período/);
 assert.match(h.root.innerHTML,/Uma conversa atribuída conta como <b>1 lead<\/b>/);
});
