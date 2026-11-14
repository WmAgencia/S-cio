// Autonomous Meta Ads traffic manager.
//
// It reads only metrics the Meta API returned, decides with a fixed, explicit
// rule set, and acts inside the owner's envelope: pause a losing ad, broaden a
// saturated audience, raise a budget by at most the configured step, duplicate
// a winning campaign for a controlled test. Anything outside that envelope is
// recorded as an approval request and never executed on its own. Every action
// carries its evidence and a plain-language explanation for the owner.
import {randomUUID} from 'node:crypto';
import {readAdsTool,prepareAdsPlan,executeAdsPlan,broadenedTargeting} from './meta-ads-tools.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {brainResponse,brainReady} from './ai-brain.mjs';

export const TRAFFIC_LIMITS=Object.freeze({
 stepPercent:20,
 minImpressions:300,
 minClicks:10,
 minSpendCents:500,
 adMinImpressions:200,
 adMinClicks:2,
 pauseCtrRatio:0.6,
 scaleCtrRatio:1.4,
 highCpmRatio:1.5,
 duplicateCtrRatio:1.4,
 maxActiveCampaigns:4,
 maxActions:4,
 cooldownHours:12,
 allowDuplicate:true
});

const num=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;};
const int=value=>{const n=num(value);return n===null?null:Math.floor(n);};
const idOf=value=>/^\d{4,30}$/.test(String(value||''))?String(value):null;
const median=list=>{
 const values=list.filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);
 if(!values.length)return null;
 const mid=Math.floor(values.length/2);
 return values.length%2?values[mid]:(values[mid-1]+values[mid])/2;
};
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
const round2=value=>Math.round(value*100)/100;
const active=row=>String(row?.effective_status||row?.status||'').toUpperCase()==='ACTIVE';

function insightMap(rows,idKey){
 const map=new Map();
 for(const row of (Array.isArray(rows)?rows:[]).slice(0,500)){
  const id=idOf(row?.[idKey]);
  if(!id)continue;
  const impressions=int(row.impressions),clicks=int(row.clicks),spend=num(row.spend);
  if(impressions===null||clicks===null||spend===null)continue;
  const prev=map.get(id)||{impressions:0,clicks:0,spend:0};
  prev.impressions+=impressions;prev.clicks+=clicks;prev.spend+=spend;
  map.set(id,prev);
 }
 const out=new Map();
 for(const [id,m] of map){
  out.set(id,{...m,
   ctr:m.impressions>0?round2(100*m.clicks/m.impressions):null,
   cpc:m.clicks>0?round2(m.spend/m.clicks):null,
   cpm:m.impressions>0?round2(1000*m.spend/m.impressions):null});
 }
 return out;
}

function budgetChangeDecision({entity,entityId,entityName,campaignId,currentBudgetCents,targetBudgetCents,limits}){
 const current=Number(currentBudgetCents);
 const target=Number(targetBudgetCents);
 if(!Number.isInteger(current)||!Number.isInteger(target)||current<100||target<100)
  return null;
 const max=Math.floor(current*(1+limits.stepPercent/100));
 const within=target<=max;
 const direction=target>current?'aumentar':'reduzir';
 const action={
  action:within?'scale':'approval_request',
  entity,entityId,entityName,campaignId,
  currentBudgetCents:current,
  targetBudgetCents:within?target:max,
  requestedBudgetCents:target,
  reason:within?'budget_within_step':'budget_above_step',
  explanation:within
   ? 'Vou '+direction+' o orçamento de '+money(current)+' para '+money(target)+
     ' por dia ('+Math.round(Math.abs(target-current)*100/current)+'%), dentro do limite automático de '+
     limits.stepPercent+'%.'
   : 'A mudança pedida é de '+money(current)+' para '+money(target)+' por dia, acima do limite automático de '+
     limits.stepPercent+'%. Posso aplicar '+money(max)+' sozinho ou você autoriza o valor cheio.',
  evidence:{currentBudgetCents:current,targetBudgetCents:target,stepPercent:limits.stepPercent},
  withinAutonomy:within,
  requiresApproval:!within,
  priority:within?3:5
 };
 return action;
}

// Pure decision engine: deterministic for the given metrics.
export function decideTrafficActions(input={}){
 const limits={...TRAFFIC_LIMITS,...(input.limits||{})};
 const alwaysAsk=input.alwaysAsk===true;
 const campaigns=Array.isArray(input.campaigns)?input.campaigns:[];
 const adsets=Array.isArray(input.adsets)?input.adsets:[];
 const ads=Array.isArray(input.ads)?input.ads:[];
 const campaignMetrics=insightMap(input.campaignInsights,'campaign_id');
 const adsetMetrics=insightMap(input.adsetInsights,'adset_id');
 const adMetrics=insightMap(input.adInsights,'ad_id');
 const sampledCampaigns=[...campaignMetrics.entries()]
  .filter(([,m])=>m.impressions>=limits.minImpressions&&m.clicks>=limits.minClicks)
  .map(([id,m])=>({id,...m}));
 const medianCpm=median(sampledCampaigns.map(c=>c.cpm));
 const medianCtr=median(sampledCampaigns.map(c=>c.ctr));
 const medianCpc=median(sampledCampaigns.map(c=>c.cpc).filter(v=>v!==null));
 const actions=[],notes=[];
 const planned=new Set();
 const add=(action)=>{
  if(actions.length>=limits.maxActions)return false;
  if(action.entity&&planned.has(action.entity+':'+action.entityId))return false;
  planned.add(action.entity+':'+action.entityId);
  actions.push(action);
  return true;
 };

 for(const ad of ads.slice(0,300)){
  const adId=idOf(ad?.id),adsetId=idOf(ad?.adset_id);
  if(!adId||!adsetId||!active(ad))continue;
  const m=adMetrics.get(adId);
  if(!m||m.impressions<limits.adMinImpressions)continue;
  const siblings=ads.filter(other=>String(other?.adset_id||'')===adsetId&&active(other))
   .map(other=>({id:idOf(other.id),metrics:adMetrics.get(idOf(other.id))}))
   .filter(row=>row.id&&row.metrics&&row.metrics.impressions>=limits.adMinImpressions)
   .sort((a,b)=>b.metrics.ctr-a.metrics.ctr);
  if(siblings.length<2)continue;
  const winner=siblings[0];
  if(winner.id===adId)continue;
  const bestCtr=winner.metrics.ctr;
  if(!(bestCtr>0))continue;
  if(m.ctr>bestCtr*limits.pauseCtrRatio)continue;
  if(m.spend<limits.minSpendCents/100)continue;
  const campaignName=campaigns.find(row=>idOf(row.id)===idOf(ad.campaign_id))?.name||null;
  add({action:'pause',entity:'ad',entityId:adId,entityName:String(ad.name||'Anúncio').slice(0,100),
   campaignId:idOf(ad.campaign_id),
   campaignName:campaignName?String(campaignName).slice(0,100):null,reason:'ad_low_ctr',
   explanation:'Vou pausar este anúncio: ele entrega '+m.ctr.toFixed(2)+'% de cliques contra '+
    bestCtr.toFixed(2)+'% do melhor anúncio do mesmo conjunto, com '+money(Math.round(m.spend*100))+
    ' gastos. O orçamento fica no anúncio que mais gera cliques.',
   evidence:{ctrPercent:m.ctr,bestCtrPercent:bestCtr,impressions:m.impressions,clicks:m.clicks,
    spendCents:Math.round(m.spend*100),adsetId},
   withinAutonomy:true,requiresApproval:false,priority:1});
 }

 for(const adset of adsets.slice(0,200)){
  const adsetId=idOf(adset?.id);
  if(!adsetId||!active(adset))continue;
  const m=adsetMetrics.get(adsetId);
  if(!m||m.impressions<limits.minImpressions||m.clicks<limits.minClicks)continue;
  const campaign=campaigns.find(row=>idOf(row.id)===idOf(adset.campaign_id));
  const campaignBudget=int(campaign?.daily_budget);
  if(medianCpm!==null&&m.cpm>=medianCpm*limits.highCpmRatio&&broadenedTargeting(adset.targeting))
   add({action:'broaden_audience',entity:'adset',entityId:adsetId,
    entityName:String(adset.name||'Conjunto').slice(0,100),campaignId:idOf(adset.campaign_id),
    campaignName:campaign?.name?String(campaign.name).slice(0,100):null,
    reason:'high_cpm',
    explanation:'O custo por mil impressões está em '+money(Math.round(m.cpm*100))+
     ', contra '+money(Math.round(medianCpm*100))+' da média das campanhas. Vou ampliar o público: '+
     'removo os interesses segmentados e abro a idade para 18–65, mantendo cidade e gênero. '+
     'O orçamento não muda.',
    evidence:{cpmCents:Math.round(m.cpm*100),medianCpmCents:Math.round(medianCpm*100),
     impressions:m.impressions,clicks:m.clicks},
    withinAutonomy:true,requiresApproval:false,priority:2});
  const budget=int(adset.daily_budget);
  if(!budget||campaignBudget>0)continue;
  if(medianCtr===null||m.ctr<medianCtr*limits.scaleCtrRatio)continue;
  if(m.cpc!==null&&medianCpc!==null&&m.cpc>medianCpc*0.8)continue;
  const target=Math.round(budget*(1+limits.stepPercent/100));
  if(target<=budget)continue;
  if(actions.length>=limits.maxActions)continue;
  add({action:'scale',entity:'adset',entityId:adsetId,
   entityName:String(adset.name||'Conjunto').slice(0,100),campaignId:idOf(adset.campaign_id),
   campaignName:campaign?.name?String(campaign.name).slice(0,100):null,
   reason:'winner_scale',currentBudgetCents:budget,targetBudgetCents:target,
   explanation:'Este conjunto entrega '+m.ctr.toFixed(2)+'% de cliques (média da conta '+
    medianCtr.toFixed(2)+'%). Vou subir o orçamento de '+money(budget)+' para '+money(target)+
    ' por dia (+'+limits.stepPercent+'%), dentro do limite automático.',
   evidence:{ctrPercent:m.ctr,medianCtrPercent:medianCtr,cpc:m.cpc,medianCpc,
    currentBudgetCents:budget,targetBudgetCents:target,impressions:m.impressions},
   withinAutonomy:true,requiresApproval:false,priority:3});
 }

 const activeCampaigns=campaigns.filter(active).length;
 if(limits.allowDuplicate&&activeCampaigns>0&&activeCampaigns<limits.maxActiveCampaigns&&
    medianCtr!==null&&sampledCampaigns.length>0){
  const best=[...sampledCampaigns]
   .filter(row=>row.ctr>=medianCtr*limits.duplicateCtrRatio)
   .sort((a,b)=>b.ctr-a.ctr||b.spend-a.spend)[0];
  const campaign=best?campaigns.find(row=>idOf(row.id)===best.id&&active(row)):null;
  if(campaign){
   add({action:'duplicate_campaign',entity:'campaign',entityId:campaign.id,
    entityName:String(campaign.name||'Campanha').slice(0,100),campaignId:campaign.id,
    campaignName:String(campaign.name||'').slice(0,100)||null,
    reason:'winner_test',
    explanation:'A campanha "'+String(campaign.name||'').slice(0,60)+'" tem '+
     best.ctr.toFixed(2)+'% de cliques, acima da média. Vou duplicá-la PAUSADA para você testar '+
     'outro criativo ou público sem mexer na que já funciona. A cópia não gasta até ser ativada.',
    evidence:{ctrPercent:best.ctr,medianCtrPercent:medianCtr,spendCents:Math.round(best.spend*100),
     activeCampaigns},
    withinAutonomy:true,requiresApproval:false,priority:4});
  }
 }

 actions.sort((a,b)=>a.priority-b.priority);
 // "Pergunta sempre": every change reaches the owner as a question, including
 // the ones inside the automatic envelope. withinAutonomy still records whether
 // the change is inside the envelope, so the owner sees the difference.
 const proposed=alwaysAsk?actions.map(action=>({...action,requiresApproval:true})):actions;
 if(!sampledCampaigns.length)
  notes.push('Ainda não há amostra suficiente (mínimo '+limits.minImpressions+' impressões e '+
   limits.minClicks+' cliques) para mudar nada com segurança.');
 return {actions:proposed,notes,readOnly:true,limits,
  summary:{campaigns:campaigns.length,adsets:adsets.length,ads:ads.length,
   sampledCampaigns:sampledCampaigns.length,medianCpmCents:medianCpm===null?null:Math.round(medianCpm*100),
   medianCtrPercent:medianCtr}};
}

const planKind=action=>({pause:'status',scale:'budget',
 duplicate_campaign:'duplicate_campaign',broaden_audience:'broaden_adset'}[action.action]);
const planInput=action=>{
 if(action.action==='pause')return {entity:'ad',id:action.entityId,status:'PAUSED'};
 if(action.action==='scale')return {entity:action.entity,dailyBudgetCents:action.targetBudgetCents,
  id:action.entityId};
 if(action.action==='duplicate_campaign')return {campaignId:action.entityId};
 return {adsetId:action.entityId};
};

export function formatTrafficReport(result,{max=5}={}){
 const lines=['Tráfego Meta Ads (últimos 7 dias):'];
 // The brain's reading comes first so the owner reads the why before the list.
 const diagnosis=(typeof result?.diagnosis==='string'?result.diagnosis
  :String(result?.diagnosis?.text||'')).trim();
 if(diagnosis)lines.push('',diagnosis.slice(0,600));
 const executed=Array.isArray(result?.executed)?result.executed:[];
 const pending=Array.isArray(result?.pending)?result.pending:[];
 const skipped=Array.isArray(result?.skipped)?result.skipped:[];
 const decisions=Array.isArray(result?.decisions)?result.decisions:[];
 if(!decisions.length){
  lines.push(result?.notes?.[0]||'Nenhum ajuste necessário agora.');
 }else{
  for(const action of decisions.slice(0,Math.max(1,Math.min(10,max))))
   lines.push('• '+action.explanation);
 }
 if(executed.length)lines.push('',executed.length+' ajuste(s) aplicado(s) dentro do limite automático.');
 if(pending.length)lines.push('',pending.length+' mudança(s) precisam da sua autorização. Responda APROVAR para aplicar.');
 if(skipped.length)lines.push('',skipped.length+' ação(ões) já feita(s) nas últimas '+
  (result?.limits?.cooldownHours||TRAFFIC_LIMITS.cooldownHours)+' horas; não repeti.');
 lines.push('','Só altero o que as métricas da Meta mostram. Cliques não comprovam vendas no WhatsApp.');
 return lines.join('\n').slice(0,2800);
}

const diagnosisInstructions=[
 'Você é gestor de tráfego pago sênior e fala com o dono de uma pequena empresa brasileira.',
 'Recebe o retrato de uma conta Meta Ads: resumo das regras, ações propostas ou já feitas, evidências numéricas, orçamentos em centavos e o que foi executado.',
 'Escreva a leitura da conta em 4 a 6 linhas curtas, em português do Brasil, tom direto e profissional, sem emoji e sem jargão.',
 'Diga, nesta ordem: o que está acontecendo; o que priorizar agora; o que observar nos próximos dias.',
 'REGRAS INVIOLÁVEIS: os números e valores recebidos são a única fonte de verdade. Não invente métrica, valor, prazo, resultado, percentual nem promessa de desempenho.',
 'Não sugira mudar orçamento para um valor diferente do que está no retrato; as regras já calcularam esses valores e a decisão é do dono.',
 'Nunca diga que uma venda aconteceu: cliques e conversas iniciadas não comprovam vendas no WhatsApp.',
 'Responda apenas com o texto da leitura, sem título, sem markdown, sem saudação.'
].join('\n');
// Reads the account after the rules have decided and explained what happened.
// It is context for the owner, never a decision: a failed or empty answer is
// null and the report goes out exactly as it would without the brain.
export async function trafficDiagnosis(decision,{env=process.env,fetchImpl=fetch}={}){
 if(!brainReady(env))return null;
 const actions=Array.isArray(decision?.actions)?decision.actions:[];
 const input=JSON.stringify({
  periodoDias:7,
  resumo:decision?.summary||null,
  notas:(decision?.notes||[]).slice(0,4),
  acoes:actions.slice(0,6).map(a=>({tipo:a.action,item:a.entityName||null,
   campanha:a.campaignName||null,precisaAutonomia:a.requiresApproval===true,
   motivo:a.reason,evidencias:a.evidence||null,
   orcamentoAtualCentavos:a.currentBudgetCents??null,
   orcamentoAlvoCentavos:a.targetBudgetCents??null})),
  aplicadas:(decision?.executed||[]).length,
  aguardandoAutorizacao:(decision?.pending||[]).length,
  ignoradas:(decision?.skipped||[]).length,
  limiteAutonomia:decision?.limits||null
 });
 try{
  const result=await brainResponse({env,fetchImpl,effort:'high',maxOutputTokens:520,
   instructions:diagnosisInstructions,input});
  const text=String(result.reply||'').replace(/^```[a-z]*\n?|```$/g,'').trim();
  if(text.length<40)return null;
  return {text:text.slice(0,900),provider:result.provider||'groq',model:result.model||null};
 }catch{return null;}
}

const decisionColumns='id,action,entity,entity_id AS "entityId",entity_name AS "entityName",'+
 'campaign_id AS "campaignId",reason,explanation,evidence,within_autonomy AS "withinAutonomy",'+
 'status,current_budget_cents AS "currentBudgetCents",target_budget_cents AS "targetBudgetCents",'+
 'question,notified_at AS "notifiedAt",responded_at AS "respondedAt",resolved_via AS "resolvedVia",'+
 'created_at AS "createdAt"';

// The exact question the owner sees. It names the ad and the campaign and, for
// a budget change, both amounts, so the answer needs no extra context.
export function trafficQuestion(action={}){
 const entity=String(action.entityName||'').slice(0,80);
 const campaign=String(action.campaignName||'').slice(0,80);
 const where=entity&&campaign&&entity!==campaign
  ?entity+' da campanha "'+campaign+'"'
  :entity||(campaign?'campanha "'+campaign+'"':'conta');
 if(action.action==='pause')
  return 'Estamos com baixa performance no '+where+'. Posso pausá-lo?';
 if(action.action==='scale'||action.action==='approval_request')
  return 'Estamos tendo boa performance no '+where+'. Posso aumentar o valor diário de '+
   money(action.currentBudgetCents)+' para '+
   money(action.action==='approval_request'?(action.requestedBudgetCents??action.targetBudgetCents):action.targetBudgetCents)+
   '?';
 if(action.action==='broaden_audience')
  return 'O custo por mil impressões está alto no '+where+'. Posso ampliar o público, '+
   'removendo os interesses e abrindo a idade para 18–65?';
 if(action.action==='duplicate_campaign')
  return 'A campanha "'+(campaign||entity)+'" está acima da média. Posso duplicá-la PAUSADA '+
   'para você testar outro criativo?';
 return action.explanation||'Posso aplicar essa mudança?';
}

async function recordDecision(pool,tenantId,accountId,action,status){
 const id=randomUUID();
 await pool.query(
  "INSERT INTO socio_traffic_decisions(id,tenant_id,account_id,action,entity,entity_id,entity_name,"+
  "campaign_id,reason,explanation,evidence,within_autonomy,status,current_budget_cents,target_budget_cents,question) "+
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
  [id,tenantId,accountId,action.action,action.entity,action.entityId,action.entityName||null,
   action.campaignId||null,action.reason,action.explanation,JSON.stringify(action.evidence||{}),
   action.withinAutonomy===true,status,action.currentBudgetCents??null,action.targetBudgetCents??null,
   String(action.question||trafficQuestion(action)).slice(0,600)]);
 return id;
}

async function recentDuplicate(pool,tenantId,action,cooldownHours){
 const found=await pool.query(
  "SELECT id FROM socio_traffic_decisions WHERE tenant_id=$1 AND action=$2 AND entity_id=$3 "+
  "AND created_at>now()-($4||' hours')::interval "+
  "AND status IN ('awaiting_approval','executing','done','dismissed') LIMIT 1",
  [tenantId,action.action,action.entityId,String(cooldownHours)]);
 return found.rowCount>0;
}

export async function runTrafficManager(pool,actor,options={}){
 const env=options.env||process.env;
 const read=options.read||readAdsTool;
 const prepare=options.prepare||prepareAdsPlan;
 const execute=options.execute||executeAdsPlan;
 const resolve=options.resolve||resolveSelectedOfficialAccount;
 const limits={...TRAFFIC_LIMITS,...(options.limits||{})};
 const period=['today','yesterday','last_7d','last_30d'].includes(options.period)?options.period:'last_7d';
 const [campaigns,adsets,ads,campaignInsights,adsetInsights,adInsights,account]=await Promise.all([
  read(pool,actor,'campaigns',{}, {env}),
  read(pool,actor,'adsets',{}, {env}),
  read(pool,actor,'ads',{}, {env}),
  read(pool,actor,'insights',{period,level:'campaign'},{env}),
  read(pool,actor,'insights',{period,level:'adset'},{env}),
  read(pool,actor,'insights',{period,level:'ad'},{env}),
  resolve(pool,actor,{env})
 ]);
 const accountId=idOf(String(account?.id||'').replace(/^act_/,''));
 if(!accountId)throw Object.assign(new Error('Selecione a conta de anúncios Meta antes de otimizar o tráfego.'),{status:409});
 // Sócio asks before every change. Only an explicit alwaysAsk:false restores
 // silent execution inside the automatic envelope, and nothing calls it that way.
 const decision=decideTrafficActions({campaigns:campaigns.items,adsets:adsets.items,ads:ads.items,
  campaignInsights:campaignInsights.items,adsetInsights:adsetInsights.items,
  adInsights:adInsights.items,limits,alwaysAsk:options.alwaysAsk!==false});
 const executed=[],pending=[],skipped=[];
 // A preview is a click and must answer immediately: no brain on this path.
 if(options.apply===false)return {accountId,period,decisions:decision.actions,notes:decision.notes,
  summary:decision.summary,executed,pending,skipped,limits,diagnosis:null,
  report:formatTrafficReport({...decision,executed,pending,skipped,limits})};
 if(!decision.actions.length){
  await recordDecision(pool,actor.active_tenant_id,'act_'+accountId,{
   action:'hold',entity:'campaign',entityId:accountId,reason:'no_action',
   explanation:decision.notes[0]||'Nenhum ajuste necessário com a amostra atual.',
   evidence:{summary:decision.summary},withinAutonomy:true},'done').catch(()=>{});
 }
 for(const action of decision.actions){
  if(await recentDuplicate(pool,actor.active_tenant_id,action,limits.cooldownHours)){
   skipped.push(action);
   continue;
  }
  const status=action.requiresApproval?'awaiting_approval':'executing';
  const decisionId=await recordDecision(pool,actor.active_tenant_id,'act_'+accountId,action,status);
  if(action.requiresApproval){pending.push(action);continue;}
  try{
   const plan=await prepare(pool,actor,planKind(action),planInput(action),{env});
   await pool.query('UPDATE socio_traffic_decisions SET plan_id=$2,updated_at=now() WHERE id=$1',
    [decisionId,plan.id]);
   const outcome=await execute(pool,actor,plan.id,true,{env});
   const ok=outcome?.status==='succeeded';
   await pool.query('UPDATE socio_traffic_decisions SET status=$2,result=$3,error_code=$4,updated_at=now() '+
    'WHERE id=$1',[decisionId,ok?'done':'failed',JSON.stringify(outcome?.result||{}),
    ok?null:String(outcome?.status||'FAILED').slice(0,40)]);
   if(ok)executed.push({...action,result:outcome.result});
   else skipped.push({...action,error:String(outcome?.error||'A Meta não confirmou a mudança.').slice(0,200)});
  }catch(error){
   await pool.query("UPDATE socio_traffic_decisions SET status='failed',error_code=$2,updated_at=now() WHERE id=$1",
    [decisionId,String(error?.status||error?.code||'ERROR').slice(0,40)]).catch(()=>{});
   skipped.push({...action,error:String(error?.message||'Falha ao aplicar').slice(0,200)});
  }
 }
 // The brain speaks last, after everything the rules allowed has run, so its
 // reading can never change an action or a budget.
 const diagnosis=await (options.diagnose||trafficDiagnosis)(
  {...decision,executed,pending,skipped,limits},{env});
 return {accountId,period,decisions:decision.actions,notes:decision.notes,summary:decision.summary,
  executed,pending,skipped,limits,diagnosis,
  report:formatTrafficReport({...decision,executed,pending,skipped,limits,diagnosis})};
}

// Owner said APROVAR: apply the requests that were held back.
export async function approveTrafficDecisions(pool,actor,{env=process.env,
 prepare=prepareAdsPlan,execute=executeAdsPlan,limits={}}={}){
 const found=await pool.query(
  "SELECT "+decisionColumns+" FROM socio_traffic_decisions WHERE tenant_id=$1 "+
  "AND status='awaiting_approval' ORDER BY created_at DESC LIMIT 10",[actor.active_tenant_id]);
 const applied=[],failed=[];
 for(const row of found.rows){
  const action={action:row.action,entity:row.entity,entityId:row.entityId,
   entityName:row.entityName,campaignId:row.campaignId,reason:row.reason,
   explanation:row.explanation,evidence:row.evidence,
   currentBudgetCents:row.currentBudgetCents,targetBudgetCents:row.targetBudgetCents};
  const kind=planKind(action);
  try{
   if(!kind)throw Object.assign(new Error('Ação não pode ser aplicada automaticamente.'),{status:422});
   const plan=await prepare(pool,actor,kind,planInput(action),{env});
   await pool.query("UPDATE socio_traffic_decisions SET status='executing',plan_id=$2,updated_at=now() WHERE id=$1",
    [row.id,plan.id]);
   const outcome=await execute(pool,actor,plan.id,true,{env});
   const ok=outcome?.status==='succeeded';
   await pool.query('UPDATE socio_traffic_decisions SET status=$2,result=$3,error_code=$4,updated_at=now() WHERE id=$1',
    [row.id,ok?'done':'failed',JSON.stringify(outcome?.result||{}),
     ok?null:String(outcome?.status||'FAILED').slice(0,40)]);
   if(ok)applied.push(action);else failed.push({...action,error:outcome?.error||'A Meta não confirmou.'});
  }catch(error){
   await pool.query("UPDATE socio_traffic_decisions SET status='failed',error_code=$2,updated_at=now() WHERE id=$1",
    [row.id,String(error?.status||error?.code||'ERROR').slice(0,40)]).catch(()=>{});
   failed.push({...action,error:String(error?.message||'Falha ao aplicar')});
  }
 }
 const lines=[];
 for(const action of applied)lines.push('✓ '+action.explanation);
 for(const action of failed)lines.push('✗ '+String(action.error).slice(0,200));
 if(!lines.length)lines.push('Não havia nenhuma mudança esperando aprovação.');
 return {applied,failed,report:lines.join('\n').slice(0,2800)};
}

export async function listTrafficDecisions(pool,tenantId,{limit=20}={}){
 const safe=Math.max(1,Math.min(50,Number(limit)||20));
 const rows=await pool.query('SELECT '+decisionColumns+',result,error_code AS "errorCode" '+
  'FROM socio_traffic_decisions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2',[tenantId,safe]);
 return {items:rows.rows};
}

const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=(status,message)=>Object.assign(new Error(message),{status});
const isBudgetAction=action=>action==='scale'||action==='approval_request';

export async function listPendingDecisions(pool,tenantId,{limit=10}={}){
 const safe=Math.max(1,Math.min(50,Number(limit)||10));
 const rows=await pool.query('SELECT '+decisionColumns+',account_id AS "accountId" '+
  "FROM socio_traffic_decisions WHERE tenant_id=$1 AND status='awaiting_approval' "+
  'ORDER BY created_at DESC LIMIT $2',[tenantId,safe]);
 return {items:rows.rows};
}

// Persist that the owner was actually told about this decision. Never re-ask a
// decision that was already delivered.
export async function markDecisionNotified(pool,tenantId,id){
 const updated=await pool.query(
  "UPDATE socio_traffic_decisions SET notified_at=now(),updated_at=now() "+
  "WHERE tenant_id=$1 AND id=$2 AND status='awaiting_approval' AND notified_at IS NULL RETURNING id",
  [tenantId,id]);
 return {notified:updated.rowCount>0};
}

// The exact message the owner receives, with the question first and the
// evidence second, in the same words the system pop-up shows.
export function decisionNotification(action={}){
 const question=String(action.question||trafficQuestion(action)).slice(0,600);
 const detail=String(action.explanation||'').slice(0,700);
 return {title:'Recomendação de tráfego',question,
  body:question+(detail?'\n\n'+detail:''),
  footer:'Sócio · Meta Ads'};
}

// Approve or dismiss ONE decision. A budget decision also accepts any daily
// amount in cents ("outro valor"). The claim is atomic: two taps cannot apply
// the same decision twice.
export async function resolveTrafficDecision(pool,actor,{id,resolution,targetBudgetCents=null,
 via='system',env=process.env,prepare=prepareAdsPlan,execute=executeAdsPlan}={}){
 if(!uuidRe.test(String(id||'')))throw bad(422,'Recomendação inválida.');
 if(!['approve','dismiss'].includes(resolution))throw bad(422,'Resposta inválida.');
 if(!['system','whatsapp','whatsapp_amount'].includes(via))throw bad(422,'Origem inválida.');
 const tenantId=actor.active_tenant_id;
 const loaded=await pool.query('SELECT '+decisionColumns+',account_id AS "accountId" '+
  'FROM socio_traffic_decisions WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
 if(!loaded.rowCount)throw bad(404,'Recomendação não encontrada.');
 const row=loaded.rows[0];
 if(row.status!=='awaiting_approval')throw bad(409,'Esta recomendação já foi respondida.');
 if(resolution==='dismiss'){
  const closed=await pool.query(
   "UPDATE socio_traffic_decisions SET status='dismissed',responded_at=now(),resolved_via=$3,updated_at=now() "+
   "WHERE tenant_id=$1 AND id=$2 AND status='awaiting_approval' RETURNING id",[tenantId,id,via]);
  if(!closed.rowCount)throw bad(409,'Esta recomendação já foi respondida.');
  return {ok:true,dismissed:true,id};
 }
 let target=row.targetBudgetCents;
 if(targetBudgetCents!==null&&targetBudgetCents!==undefined){
  if(!isBudgetAction(row.action))throw bad(422,'Só mudanças de orçamento aceitam outro valor.');
  const cents=Math.round(Number(targetBudgetCents));
  if(!Number.isInteger(cents)||cents<100||cents>100000000)
   throw bad(422,'Informe um valor diário entre R$ 1,00 e R$ 1.000.000,00.');
  target=cents;
 }
 const action={action:row.action,entity:row.entity,entityId:row.entityId,entityName:row.entityName,
  campaignId:row.campaignId,reason:row.reason,explanation:row.explanation,evidence:row.evidence,
  currentBudgetCents:row.currentBudgetCents,targetBudgetCents:target,requiresApproval:false};
 const kind=planKind(action);
 if(!kind)throw bad(422,'Ação não pode ser aplicada automaticamente.');
 const claimed=await pool.query(
  "UPDATE socio_traffic_decisions SET status='executing',target_budget_cents=$3,responded_at=now(),"+
  "resolved_via=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='awaiting_approval' RETURNING id",
  [tenantId,id,target,via]);
 if(!claimed.rowCount)throw bad(409,'Esta recomendação já foi respondida.');
 try{
  const plan=await prepare(pool,actor,kind,planInput(action),{env});
  await pool.query('UPDATE socio_traffic_decisions SET plan_id=$2,updated_at=now() WHERE id=$1',
   [id,plan.id]);
  const outcome=await execute(pool,actor,plan.id,true,{env});
  const ok=outcome?.status==='succeeded';
  await pool.query('UPDATE socio_traffic_decisions SET status=$2,result=$3,error_code=$4,updated_at=now() '+
   'WHERE id=$1',[id,ok?'done':'failed',JSON.stringify(outcome?.result||{}),
   ok?null:String(outcome?.status||'FAILED').slice(0,40)]);
  if(!ok)throw bad(502,String(outcome?.error||'A Meta não confirmou a mudança.').slice(0,200));
  return {ok:true,applied:true,id,action,result:outcome?.result||{}};
 }catch(error){
  await pool.query("UPDATE socio_traffic_decisions SET status='failed',error_code=$2,updated_at=now() "+
   'WHERE id=$1 AND status<>\'done\'',[id,String(error?.status||error?.code||'ERROR').slice(0,40)]).catch(()=>{});
  throw error.status?error:bad(502,'Não foi possível aplicar a mudança.');
 }
}

// One row per scheduled review: the 6-hour gate and the audit trail.
export async function recordTrafficReview(pool,tenantId,accountId,{status='done',decisions=0,pending=0,
 summary={},errorCode=null}={}){
 const id=randomUUID();
 await pool.query(
  'INSERT INTO socio_traffic_reviews(id,tenant_id,account_id,status,decisions,pending,summary,error_code) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [id,tenantId,accountId,status,Math.max(0,Math.floor(Number(decisions)||0)),
   Math.max(0,Math.floor(Number(pending)||0)),JSON.stringify(summary||{}),
   errorCode?String(errorCode).slice(0,60):null]);
 return id;
}

export async function lastReviewAt(pool,tenantId,accountId){
 const found=await pool.query(
  "SELECT max(created_at) AS at FROM socio_traffic_reviews WHERE tenant_id=$1 AND account_id=$2 AND status='done'",
  [tenantId,accountId]);
 const at=found.rows[0]?.at;
 return at?new Date(at):null;
}

export async function reviewIsDue(pool,tenantId,accountId,{hours=6,now=Date.now()}={}){
 const at=await lastReviewAt(pool,tenantId,accountId);
 if(!at)return true;
 return now-at.getTime()>=hours*3600*1000;
}

export {budgetChangeDecision};
