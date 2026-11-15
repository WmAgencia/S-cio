import test from 'node:test';
import assert from 'node:assert/strict';
import {decideTrafficActions,trafficQuestion} from '../socio-traffic-manager.mjs';

const campaign=(id,overrides={})=>({id,campaign_id:id,name:'Campanha '+id,
 effective_status:'ACTIVE',status:'ACTIVE',...overrides});
const conversations=n=>({action_type:'onsite_conversion.messaging_conversation_started_7d',
 value:String(n)});
const plain=text=>String(text).replace(/\s/g,' ');

const base=(overrides={})=>({campaigns:[campaign('1001')],adsets:[],ads:[],
 campaignInsights:[{campaign_id:'1001',impressions:'1000',clicks:'50',spend:'12',
  actions:[conversations(3)]}],...overrides});
const heavy=overrides=>base({campaignInsights:[{campaign_id:'1001',impressions:'4000',
 clicks:'120',spend:'36',actions:[conversations(9)]}],purchaseTargetCents:1000,...overrides});

test('A confirmed sale is the purchase the engine prices',()=>{
 const before=decideTrafficActions(base());
 assert.equal(before.summary.resultKind,'conversation');
 assert.equal(before.summary.results,3);
 assert.equal(before.summary.costPerResultCents,400);
 const after=decideTrafficActions(base({confirmedSales:{ever:true,
  campaigns:{'1001':1},ads:{}}}));
 assert.equal(after.summary.resultKind,'purchase');
 assert.equal(after.summary.results,1);
 assert.equal(after.summary.costPerResultCents,1200);
});

test('A campaign that spent past the cost of a sale asks to pause',()=>{
 const result=decideTrafficActions(heavy({confirmedSales:{ever:true,
  campaigns:{},ads:{}}}));
 const action=result.actions.find(a=>a.reason==='campaign_no_confirmed_sales');
 assert.ok(action,'the sale-less campaign is questioned');
 assert.equal(action.action,'pause');
 assert.equal(action.entity,'campaign');
 assert.equal(action.entityId,'1001');
 assert.equal(action.entityName,'Campanha 1001');
 assert.equal(action.withinAutonomy,false);
 assert.equal(action.requiresApproval,true);
 assert.equal(action.evidence.spendCents,3600);
 assert.equal(action.evidence.targetResultCents,1000);
 assert.equal(action.evidence.windowDays,7);
 assert.match(action.explanation,/R\$\s36,00/);
 assert.match(action.explanation,/R\$\s10,00 por venda/);

 const question=plain(trafficQuestion(action));
 assert.match(question,/campanha "Campanha 1001" gastou R\$ 36,00 nos últimos 7 dias/);
 assert.match(question,/3 vezes a sua meta de R\$ 10,00 por venda/);
 assert.match(question,/não teve nenhuma venda confirmada/);
 assert.match(question,/Posso pausar a campanha\?$/);

 // Without history of a confirmed sale, or with a sale in the window, or below
 // the spend threshold, the campaign is not questioned at all.
 const noHistory=decideTrafficActions(heavy());
 assert.equal(noHistory.actions.some(a=>a.reason==='campaign_no_confirmed_sales'),false);
 const sold=decideTrafficActions(heavy({confirmedSales:{ever:true,
  campaigns:{'1001':1},ads:{}}}));
 assert.equal(sold.actions.some(a=>a.reason==='campaign_no_confirmed_sales'),false);
 const cheap=decideTrafficActions(base({purchaseTargetCents:1000,
  confirmedSales:{ever:true,campaigns:{},ads:{}}}));
 assert.equal(cheap.actions.some(a=>a.reason==='campaign_no_confirmed_sales'),false);
 const paused=decideTrafficActions(heavy({campaigns:[campaign('1001',
  {effective_status:'PAUSED'})],confirmedSales:{ever:true,campaigns:{},ads:{}}}));
 assert.equal(paused.actions.some(a=>a.reason==='campaign_no_confirmed_sales'),false);
});
