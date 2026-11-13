import test from 'node:test';
import assert from 'node:assert/strict';
import {
 TRAFFIC_LIMITS,decideTrafficActions,budgetChangeDecision,formatTrafficReport,
 runTrafficManager,approveTrafficDecisions,listTrafficDecisions,
 trafficQuestion,resolveTrafficDecision,listPendingDecisions,markDecisionNotified,
 recordTrafficReview,reviewIsDue,decisionNotification
} from '../socio-traffic-manager.mjs';
import {broadenedTargeting} from '../meta-ads-tools.mjs';

const tenantId='11111111-1111-4111-8111-111111111111';
const planId='22222222-2222-4222-8222-222222222222';
const actor={role:'owner',platform_owner:false,active_tenant_id:tenantId};
const env={};

const campaign=(id,overrides={})=>({id,campaign_id:id,name:'Campanha '+id,
 effective_status:'ACTIVE',status:'ACTIVE',...overrides});
const adset=(id,campaignId,overrides={})=>({id,campaign_id:campaignId,adset_id:id,
 name:'Conjunto '+id,effective_status:'ACTIVE',status:'ACTIVE',...overrides});
const ad=(id,adsetId,campaignId,overrides={})=>({id,adset_id:adsetId,campaign_id:campaignId,
 name:'Anúncio '+id,effective_status:'ACTIVE',status:'ACTIVE',...overrides});

test('Pausing an ad needs a sibling sample and real spend',()=>{
 const base={adsets:[adset('2001','1001')],
  ads:[ad('3001','2001','1001'),ad('3002','2001','1001')],
  adInsights:[
   {ad_id:'3001',impressions:'1000',clicks:'20',spend:'30'},
   {ad_id:'3002',impressions:'1000',clicks:'5',spend:'10'}]};
 const thin=decideTrafficActions({...base,
  adInsights:[{ad_id:'3001',impressions:'1000',clicks:'20',spend:'30'},
   {ad_id:'3002',impressions:'100',clicks:'0',spend:'0'}]});
 assert.equal(thin.actions.filter(a=>a.action==='pause').length,0,'small sample must not pause');
 const cheap=decideTrafficActions({...base,
  adInsights:[{ad_id:'3001',impressions:'1000',clicks:'20',spend:'30'},
   {ad_id:'3002',impressions:'1000',clicks:'5',spend:'2'}]});
 assert.equal(cheap.actions.filter(a=>a.action==='pause').length,0,'below minimum spend must not pause');
 const result=decideTrafficActions(base);
 const pause=result.actions.find(a=>a.action==='pause');
 assert.ok(pause,'losing ad is paused');
 assert.equal(pause.entityId,'3002');
 assert.equal(pause.withinAutonomy,true);
 assert.equal(pause.requiresApproval,false);
 assert.match(pause.explanation,/0\.50%/);
 assert.match(pause.explanation,/2\.00%/);
 assert.equal(pause.evidence.spendCents,1000);
});

test('Scaling a winning adset is capped at the configured step',()=>{
 const result=decideTrafficActions({
  campaigns:[campaign('1001')],
  adsets:[adset('2001','1001',{daily_budget:'5000'})],
  ads:[],
  campaignInsights:[{campaign_id:'1001',impressions:'1000',clicks:'20',spend:'40'}],
  adsetInsights:[{adset_id:'2001',impressions:'1000',clicks:'30',spend:'30'}]
 });
 const scale=result.actions.find(a=>a.action==='scale');
 assert.ok(scale,'winner is scaled');
 assert.equal(scale.currentBudgetCents,5000);
 assert.equal(scale.targetBudgetCents,6000,'exactly +20%');
 assert.equal(scale.targetBudgetCents-scale.currentBudgetCents,1000);
 assert.equal(scale.requiresApproval,false);
 assert.match(scale.explanation,/\+20%/);
 const cbo=decideTrafficActions({
  campaigns:[campaign('1001',{daily_budget:'5000'})],
  adsets:[adset('2001','1001',{daily_budget:'5000'})],
  ads:[],
  campaignInsights:[{campaign_id:'1001',impressions:'1000',clicks:'20',spend:'40'}],
  adsetInsights:[{adset_id:'2001',impressions:'1000',clicks:'30',spend:'30'}]
 });
 assert.equal(cbo.actions.filter(a=>a.action==='scale').length,0,
  'campaign-level budget (CBO) is not changed through the ad set');
});

test('Budget changes above the step become approval requests, never actions',()=>{
 const small=budgetChangeDecision({entity:'adset',entityId:'2001',entityName:'Conjunto',
  campaignId:'1001',currentBudgetCents:1000,targetBudgetCents:1100,limits:TRAFFIC_LIMITS});
 assert.equal(small.action,'scale');
 assert.equal(small.targetBudgetCents,1100);
 const big=budgetChangeDecision({entity:'adset',entityId:'2001',entityName:'Conjunto',
  campaignId:'1001',currentBudgetCents:1000,targetBudgetCents:3000,limits:TRAFFIC_LIMITS});
 assert.equal(big.action,'approval_request');
 assert.equal(big.withinAutonomy,false);
 assert.equal(big.requiresApproval,true);
 assert.equal(big.targetBudgetCents,1200,'the automatic ceiling is offered');
 assert.equal(big.requestedBudgetCents,3000);
 assert.match(big.explanation,/acima do limite automático/);
 assert.equal(budgetChangeDecision({entity:'adset',entityId:'2001',
  currentBudgetCents:0,targetBudgetCents:1000,limits:TRAFFIC_LIMITS}),null);
});

test('Broadening only fires on expensive delivery with a narrow audience',()=>{
 const narrow={geo_locations:{countries:['BR']},interests:[{id:'6003'}],
  age_min:25,age_max:40};
 const input=campaigns=>decideTrafficActions({
  campaigns:campaigns,
  adsets:[adset('2001','1001',{targeting:narrow})],
  ads:[],
  campaignInsights:[{campaign_id:'1001',impressions:'1000',clicks:'20',spend:'30'}],
  adsetInsights:[{adset_id:'2001',impressions:'1000',clicks:'20',spend:'60'}]
 });
 const broadened=input([campaign('1001')]).actions.find(a=>a.action==='broaden_audience');
 assert.ok(broadened,'high CPM plus narrow audience is broadened');
 assert.equal(broadened.withinAutonomy,true);
 assert.equal(broadened.entityId,'2001');
 assert.match(broadened.explanation,/18–65/);
 const alreadyBroad=decideTrafficActions({
  campaigns:[campaign('1001')],
  adsets:[adset('2001','1001',{targeting:{geo_locations:{countries:['BR']},age_min:18,age_max:65}})],
  ads:[],
  campaignInsights:[{campaign_id:'1001',impressions:'1000',clicks:'20',spend:'30'}],
  adsetInsights:[{adset_id:'2001',impressions:'1000',clicks:'20',spend:'60'}]
 });
 assert.equal(alreadyBroad.actions.filter(a=>a.action==='broaden_audience').length,0,
  'an already-broad audience is never broadened again');
});

test('broadenedTargeting keeps geography, drops interests and opens the age range',()=>{
 const result=broadenedTargeting({geo_locations:{cities:[{key:'1234567'}]},
  interests:[{id:'6003'}],behaviors:[{id:'1'}],age_min:24,age_max:35,genders:[1],
  publisher_platforms:['facebook']});
 assert.deepEqual(result,{geo_locations:{cities:[{key:'1234567'}]},genders:[1],
  publisher_platforms:['facebook'],age_min:18,age_max:65});
 assert.equal(broadenedTargeting({geo_locations:{countries:['BR']},age_min:18,age_max:65}),null);
 assert.equal(broadenedTargeting({interests:[{id:'1'}]}),null,'no geography is never broadened');
 assert.equal(broadenedTargeting(null),null);
});

test('A winning campaign is duplicated PAUSED, within the active-campaign cap',()=>{
 const two=decideTrafficActions({
  campaigns:[campaign('1001'),campaign('1002')],
  adsets:[],ads:[],
  campaignInsights:[
   {campaign_id:'1001',impressions:'1000',clicks:'30',spend:'60'},
   {campaign_id:'1002',impressions:'1000',clicks:'10',spend:'20'}]
 });
 const duplicate=two.actions.find(a=>a.action==='duplicate_campaign');
 assert.ok(duplicate);
 assert.equal(duplicate.entityId,'1001');
 assert.match(duplicate.explanation,/PAUSADA/);
 const capped=decideTrafficActions({
  campaigns:[campaign('1001'),campaign('1002'),campaign('1003'),campaign('1004')],
  adsets:[],ads:[],
  campaignInsights:[
   {campaign_id:'1001',impressions:'1000',clicks:'30',spend:'60'},
   {campaign_id:'1002',impressions:'1000',clicks:'10',spend:'20'}]
 });
 assert.equal(capped.actions.filter(a=>a.action==='duplicate_campaign').length,0,
  'never more than the configured number of active campaigns');
});

test('No sample means no action and an explicit note',()=>{
 const result=decideTrafficActions({
  campaigns:[campaign('1001')],adsets:[],ads:[],
  campaignInsights:[{campaign_id:'1001',impressions:'12',clicks:'1',spend:'1'}],
  adInsights:[{ad_id:'3001',impressions:'5',clicks:'0',spend:'0'}]
 });
 assert.deepEqual(result.actions,[]);
 assert.match(result.notes[0],/amostra suficiente/);
 const report=formatTrafficReport(result);
 assert.match(report,/amostra suficiente/);
 assert.match(report,/Cliques não comprovam vendas/);
});

const stubPool=(handler=()=>null)=>({calls:[],query:async function(sql,args=[]){
 this.calls.push({sql,args});
 return handler(sql,args)||{rowCount:0,rows:[]};
}});

const trafficRead=({
 ads=[ad('3001','2001','1001'),ad('3002','2001','1001')],
 adInsights=[{ad_id:'3001',impressions:'1000',clicks:'20',spend:'30'},
  {ad_id:'3002',impressions:'1000',clicks:'5',spend:'10'}]
}={})=>async(pool,a,kind)=>{
 if(kind==='campaigns')return {items:[]};
 if(kind==='adsets')return {items:[adset('2001','1001')]};
 if(kind==='ads')return {items:ads};
 if(kind==='insights')return {items:adInsights};
 return {items:[]};
};

test('runTrafficManager records the decision, applies it and reports the result',async()=>{
 const prepared=[];
 const pool=stubPool(sql=>{
  if(/SELECT id FROM socio_traffic_decisions WHERE tenant_id=\$1 AND action=\$2/.test(sql))
   return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[]};
 });
 const result=await runTrafficManager(pool,actor,{env,alwaysAsk:false,
  read:trafficRead(),
  resolve:async()=>({id:'act_1234567890'}),
  prepare:async(p,a,kind,input)=>{prepared.push({kind,input});return {id:planId};},
  execute:async()=>({status:'succeeded',result:{id:'3002',status:'PAUSED'}})});
 assert.equal(result.accountId,'1234567890');
 assert.equal(result.executed.length,1);
 const insert=pool.calls.find(c=>/INSERT INTO socio_traffic_decisions/.test(c.sql));
 assert.ok(insert,'decision is persisted before execution');
 assert.equal(insert.args[2],'act_1234567890');
 assert.equal(insert.args[3],'pause');
 assert.equal(insert.args[12],'executing');
 assert.deepEqual(prepared,[{kind:'status',input:{entity:'ad',id:'3002',status:'PAUSED'}}]);
 const applied=pool.calls.find(c=>/SET status=\$2,result=\$3/.test(c.sql));
 assert.equal(applied.args[1],'done');
 assert.match(result.report,/1 ajuste\(s\) aplicado/);
});

test('A repeated action inside the cooldown is skipped, not executed twice',async()=>{
 let prepared=0;
 const pool=stubPool(sql=>{
  if(/SELECT id FROM socio_traffic_decisions WHERE tenant_id=\$1 AND action=\$2/.test(sql))
   return {rowCount:1,rows:[{id:'x'}]};
  return {rowCount:1,rows:[]};
 });
 const result=await runTrafficManager(pool,actor,{env,
  read:trafficRead(),
  resolve:async()=>({id:'1234567890'}),
  prepare:async()=>{prepared++;return {id:planId};},
  execute:async()=>({status:'succeeded'})});
 assert.equal(prepared,0);
 assert.equal(result.executed.length,0);
 assert.equal(result.skipped.length,1);
 assert.equal(pool.calls.filter(c=>/INSERT INTO socio_traffic_decisions/.test(c.sql)).length,0);
 assert.match(result.report,/últimas 12 horas/);
});

test('A preview never writes or executes anything',async()=>{
 const pool=stubPool();
 const result=await runTrafficManager(pool,actor,{env,apply:false,
  read:trafficRead(),
  resolve:async()=>({id:'1234567890'}),
  prepare:async()=>{throw new Error('preview must not prepare');},
  execute:async()=>{throw new Error('preview must not execute');}});
 assert.equal(result.decisions.length,1);
 assert.equal(pool.calls.length,0);
});

test('An account must be selected before the manager touches anything',async()=>{
 await assert.rejects(runTrafficManager(stubPool(),actor,{env,
  read:trafficRead(),resolve:async()=>({})}),/Selecione a conta de anúncios/);
});

test('An execution failure is recorded and reported, never hidden',async()=>{
 const pool=stubPool(sql=>{
  if(/SELECT id FROM socio_traffic_decisions/.test(sql))return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[]};
 });
 const result=await runTrafficManager(pool,actor,{env,alwaysAsk:false,
  read:trafficRead(),
  resolve:async()=>({id:'1234567890'}),
  prepare:async()=>({id:planId}),
  execute:async()=>({status:'failed'})});
 assert.equal(result.executed.length,0);
 assert.equal(result.skipped.length,1);
 const update=pool.calls.find(c=>/SET status=\$2,result=\$3/.test(c.sql));
 assert.equal(update.args[1],'failed');
 assert.equal(update.args[3],'failed');
});

test('APROVAR applies the requests that were held back',async()=>{
 const applied=[];
 const pool=stubPool(sql=>{
  if(/FROM socio_traffic_decisions WHERE tenant_id=\$1 AND status='awaiting_approval'/.test(sql))
   return {rowCount:1,rows:[{id:'55555555-5555-4555-8555-555555555555',action:'scale',
    entity:'adset',entityId:'2001',entityName:'Conjunto',campaignId:'1001',
    reason:'budget_above_step',explanation:'Subir o orçamento para R$ 30,00.',
    evidence:{},currentBudgetCents:1000,targetBudgetCents:1200}]};
  return {rowCount:1,rows:[]};
 });
 const result=await approveTrafficDecisions(pool,actor,{env,
  prepare:async(p,a,kind,input)=>{applied.push({kind,input});return {id:planId};},
  execute:async()=>({status:'succeeded',result:{id:'2001'}})});
 assert.deepEqual(applied,[{kind:'budget',input:{entity:'adset',dailyBudgetCents:1200,id:'2001'}}]);
 assert.equal(result.applied.length,1);
 assert.equal(result.failed.length,0);
 assert.match(result.report,/✓/);
 const empty=await approveTrafficDecisions(stubPool(),actor,{env});
 assert.match(empty.report,/nenhuma mudança esperando aprovação/);
});

test('listTrafficDecisions bounds the requested limit',async()=>{
 const pool=stubPool(()=>({rowCount:0,rows:[]}));
 await listTrafficDecisions(pool,tenantId,{limit:5000});
 assert.equal(pool.calls[0].args[1],50);
 await listTrafficDecisions(pool,tenantId,{limit:0});
 assert.equal(pool.calls[1].args[1],20);
});

const decisionRow=(overrides={})=>({id:'55555555-5555-4555-8555-555555555555',action:'scale',
 entity:'adset',entityId:'2001',entityName:'Conjunto',campaignId:'1001',reason:'winner_scale',
 explanation:'Subir o orçamento.',evidence:{},withinAutonomy:true,status:'awaiting_approval',
 currentBudgetCents:600,targetBudgetCents:720,question:'Posso?',createdAt:new Date(),
 accountId:'act_1234567890',...overrides});

const decisionPool=(row)=>({calls:[],query:async function(sql,args=[]){
 this.calls.push({sql,args});
 if(/^SELECT id,action,entity/.test(sql.trim())&&/id=\$2/.test(sql))
  return row?{rowCount:1,rows:[row]}:{rowCount:0,rows:[]};
 if(/status='executing'/.test(sql)||/status='dismissed'/.test(sql))return {rowCount:1,rows:[{id:row?.id}]};
 return {rowCount:1,rows:[]};
}});

test('Every change asks the owner first, even inside the automatic envelope',async()=>{
 const pool=stubPool(sql=>{
  if(/SELECT id FROM socio_traffic_decisions WHERE tenant_id=\$1 AND action=\$2/.test(sql))
   return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[]};
 });
 let prepared=0;
 const result=await runTrafficManager(pool,actor,{env,
  read:trafficRead(),
  resolve:async()=>({id:'act_1234567890'}),
  prepare:async()=>{prepared++;return {id:planId};},
  execute:async()=>({status:'succeeded'})});
 assert.equal(prepared,0,'nothing is executed before the owner answers');
 assert.equal(result.executed.length,0);
 assert.equal(result.pending.length,1);
 const insert=pool.calls.find(c=>/INSERT INTO socio_traffic_decisions/.test(c.sql));
 assert.equal(insert.args[12],'awaiting_approval');
 assert.match(insert.args[15],/Posso pausá-lo\?/);
 assert.match(result.report,/precisam da sua autorização/);
});

test('The question names the ad, the campaign and both amounts',()=>{
 const q=trafficQuestion({action:'scale',entityName:'Conjunto 2001',
  campaignName:'Bolos caseiros',currentBudgetCents:600,targetBudgetCents:1000});
 assert.match(q,/Conjunto 2001 da campanha "Bolos caseiros"/);
 assert.match(q,/aumentar o valor diário de R\$\s6,00 para R\$\s10,00/);
 const approval=trafficQuestion({action:'approval_request',entityName:'Conjunto',
  currentBudgetCents:1000,targetBudgetCents:1200,requestedBudgetCents:3000});
 assert.match(approval,/R\$\s30,00/);
 const notif=decisionNotification({question:q,explanation:'Dentro do limite automático.'});
 assert.ok(notif.body.startsWith(q));
 assert.match(notif.body,/Dentro do limite automático/);
 assert.equal(notif.footer,'Sócio · Meta Ads');
});

test('Approving one decision applies exactly the amount the owner chose',async()=>{
 const applied=[];
 const row=decisionRow();
 const pool=decisionPool(row);
 const result=await resolveTrafficDecision(pool,actor,{id:row.id,resolution:'approve',
  targetBudgetCents:1000,
  prepare:async(p,a,kind,input)=>{applied.push({kind,input});return {id:planId};},
  execute:async()=>({status:'succeeded',result:{id:'2001'}})});
 assert.deepEqual(applied,[{kind:'budget',input:{entity:'adset',dailyBudgetCents:1000,id:'2001'}}]);
 assert.equal(result.applied,true);
 const claim=pool.calls.find(c=>/status='executing'/.test(c.sql));
 assert.equal(claim.args[2],1000,'the custom amount is persisted with the decision');
 assert.equal(claim.args[3],'system');
});

test('Dismissing a decision closes it and never executes',async()=>{
 const row=decisionRow();
 const pool=decisionPool(row);
 let prepared=0;
 const result=await resolveTrafficDecision(pool,actor,{id:row.id,resolution:'dismiss',
  prepare:async()=>{prepared++;return {id:planId};}});
 assert.equal(result.dismissed,true);
 assert.equal(prepared,0);
 const update=pool.calls.find(c=>/status='dismissed'/.test(c.sql));
 assert.equal(update.args[2],'system');
});

test('An already answered decision cannot be applied twice',async()=>{
 const pool=decisionPool(decisionRow({status:'done'}));
 await assert.rejects(resolveTrafficDecision(pool,actor,{id:'55555555-5555-4555-8555-555555555555',
  resolution:'approve'}),/já foi respondida/);
 const lost=decisionPool(null);
 await assert.rejects(resolveTrafficDecision(lost,actor,{id:'55555555-5555-4555-8555-555555555555',
  resolution:'dismiss'}),/não encontrada/);
});

test('Another value is rejected on a non-budget decision and out of range amounts',async()=>{
 const pause=decisionRow({action:'pause',entity:'ad',entityId:'3002',currentBudgetCents:null,
  targetBudgetCents:null});
 await assert.rejects(resolveTrafficDecision(decisionPool(pause),actor,{id:pause.id,
  resolution:'approve',targetBudgetCents:5000}),/Só mudanças de orçamento/);
 const scale=decisionRow();
 await assert.rejects(resolveTrafficDecision(decisionPool(scale),actor,{id:scale.id,
  resolution:'approve',targetBudgetCents:50}),/entre R\$\s1,00/);
});

test('Only undelivered pending decisions are returned and notification is recorded once',async()=>{
 const pool=stubPool(sql=>{
  if(/status='awaiting_approval'/.test(sql)&&/^SELECT id,action,entity/.test(sql.trim()))
   return {rowCount:1,rows:[decisionRow()]};
  if(/notified_at IS NULL/.test(sql))return {rowCount:1,rows:[{id:'x'}]};
  return {rowCount:0,rows:[]};
 });
 const pending=await listPendingDecisions(pool,tenantId,{limit:5000});
 assert.equal(pending.items.length,1);
 assert.equal(pool.calls[0].args[1],50);
 const marked=await markDecisionNotified(pool,tenantId,'55555555-5555-4555-8555-555555555555');
 assert.equal(marked.notified,true);
});

test('A review is due only after six hours',async()=>{
 const now=Date.parse('2026-11-13T12:00:00Z');
 const at=new Date('2026-11-13T07:00:00Z');
 const pool=stubPool(()=>({rowCount:1,rows:[{at}]}));
 assert.equal(await reviewIsDue(pool,tenantId,'act_1234567890',{now}),false);
 assert.equal(await reviewIsDue(pool,tenantId,'act_1234567890',{now:now+3600*1000}),true);
 const empty=stubPool(()=>({rowCount:1,rows:[{at:null}]}));
 assert.equal(await reviewIsDue(empty,tenantId,'act_1234567890',{now}),true);
 await recordTrafficReview(pool,tenantId,'act_1234567890',{decisions:2,pending:1,
  summary:{campaigns:1}});
 const insert=pool.calls.at(-1);
 assert.match(insert.sql,/INSERT INTO socio_traffic_reviews/);
 assert.equal(insert.args[4],2);
 assert.equal(insert.args[5],1);
});
