import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {diagnoseMetaTraffic,formatMetaTrafficDiagnosis} from '../meta-traffic-diagnostics.mjs';
import {selectExpertSkill} from '../socio-expert-skills.mjs';
import {speakToSocioSkill} from '../socio-skill-router.mjs';

const accountRow={campaign_id:'1234567890',campaign_name:'Moda feminina Sorocaba',spend:'12.50',clicks:'0',impressions:'400'};
const actor={active_tenant_id:randomUUID(),user_id:randomUUID(),role:'owner',tenant_status:'active',
 features:{meta_ads:true,ai:true,whatsapp:true,catalog:true,quotes:true,team:true}};
test('Meta stage4 uses disapproved effective ad statuses and observed account metrics only',()=>{
 const result=diagnoseMetaTraffic({
  insights:[accountRow],ads:[{id:'111111',name:'Vestido',campaign_id:'1234567890',effective_status:'DISAPPROVED'}],
  period:'last_7d',currency:'BRL'});
 assert.equal(result.readOnly,true);
 assert.equal(result.alerts,1);
 assert.equal(result.diagnostics.length,1);
 const row=result.diagnostics[0];
 assert.equal(row.spend,12.5);assert.equal(row.impressions,400);
 assert.equal(row.clicks,0);assert.equal(row.cpc,null);
 assert.equal(row.notices[0].code,'ad_issue');
 assert.equal(row.notices[1].code,'no_clicks');
 assert.match(row.notices[0].recommendation,/Gerenciador/);
 const chat=formatMetaTrafficDiagnosis(result);
 assert.match(chat,/sem alterar anúncios/);
 assert.match(chat,/restrição|sinalizada/);
 assert.match(chat,/Nenhuma campanha foi alterada/);
 assert.doesNotMatch(chat,/5 vendas|ROAS 3|convers[aã]o confirmada/);
});
test('small samples cannot be treated as proven ad problems or conversions',()=>{
 const result=diagnoseMetaTraffic({insights:[{campaign_id:'22334455',campaign_name:'Teste novo',spend:'2',impressions:'80',clicks:'2'}]});
 const row=result.diagnostics[0];
 assert.equal(row.notices[0].code,'limited_sample');
 assert.match(row.notices[0].recommendation,/não pause/);
 assert.equal(row.ctrPercent,2.5);assert.equal(row.cpc,1);
 assert.equal(result.alerts,0);
});
test('status without insights is reported, not misrepresented as sales or spend',()=>{
 const result=diagnoseMetaTraffic({
  insights:[],ads:[
   {id:'999991',campaign_id:'888888',effective_status:'PENDING_REVIEW',name:'Em revisão'},
   {id:'999992',campaign_id:'888888',effective_status:'PAUSED',name:'Pausado'}
  ]});
 assert.equal(result.diagnostics.length,1);
 assert.equal(result.diagnostics[0].impressions,null);
 assert.equal(result.diagnostics[0].spend,null);
 assert(result.diagnostics[0].notices.some(x=>x.code==='metrics_unavailable'));
 assert(result.diagnostics[0].notices.some(x=>x.code==='under_review'));
 assert(!result.diagnostics[0].notices.some(x=>x.code==='no_delivery'));
 assert(result.diagnostics[0].notices.some(x=>x.code==='paused_ads'));
 assert.match(formatMetaTrafficDiagnosis(result),/métricas não retornadas/i);
});
test('partial and unavailable ad status are disclosed, and invalid numbers never become fake success metrics',()=>{
 const result=diagnoseMetaTraffic({insights:[
  {campaign_id:'555555',spend:'not a number',clicks:'8',impressions:'500'},
  {campaign_id:'999999',spend:'0',clicks:'0',impressions:'0'}
 ],adsUnavailable:true,insightsHasMore:true});
 assert.equal(result.totalCampaigns,1);
 assert.equal(result.partial,true);
 assert.equal(result.adsUnavailable,true);
 const msg=formatMetaTrafficDiagnosis(result);
 assert.match(msg,/resultado pode ser parcial/);
 assert.match(msg,/rejeições não foram avaliadas/);
 assert.throws(()=>diagnoseMetaTraffic({insights:{}}),{status:422});
});
test('Meta optimization questions route to diagnosis; Google and WhatsApp reports remain isolated',()=>{
 for(const question of ['Analise meus anúncios','Otimize minhas campanhas Meta Ads',
  'Por que meus anúncios estão rejeitados?','Melhore o desempenho da campanha']){
  assert.equal(selectExpertSkill(question).id,'meta.optimization',question);
 }
 assert.equal(selectExpertSkill('Analisa Google Ads e Meta Ads').id,'google.ads');
 assert.equal(selectExpertSkill('Quantas vendas no WhatsApp?').id,'whatsapp.sales');
 assert.equal(selectExpertSkill('Crie campanha feminina Sorocaba R$ 6 por dia').id,'meta.campaigns.brief');
});
test('conversational diagnosis reads only and never calls plan, approve or Meta write',async()=>{
 const pool={query:async()=>{throw new Error('Do not touch DB for injected read-only diagnosis')}};
 let calls=0;
 const answer=await speakToSocioSkill(pool,actor,{message:'Analise meus anúncios de hoje'},{
  diagnose:async(_pool,a,kind,input)=>{
   calls++;assert.equal(a.active_tenant_id,actor.active_tenant_id);
   assert.equal(kind,'diagnosis');assert.deepEqual(input,{period:'today'});
   return {diagnosis:diagnoseMetaTraffic({period:'today',insights:[accountRow]})};
  },prepare:async()=>{throw Error('No mutation allowed')},execute:async()=>{throw Error('No execution allowed')}
 });
 assert.equal(calls,1);assert.equal(answer.status,'completed');
 assert.equal(answer.skillId,'meta.optimization');assert.equal(answer.readOnly,true);
 assert.equal(answer.executed,false);
 assert.match(answer.message,/próximo passo/i);
 assert.equal(answer.runId,null);
 await assert.rejects(speakToSocioSkill(pool,{...actor,role:'agent'},{message:'Otimize campanhas Meta Ads'}),{status:403});
});
test('diagnostic Graph operations remain scoped to selected ad account and never mutate ads',()=>{
 const advanced=readFileSync(new URL('../meta-ads-advanced.mjs',import.meta.url),'utf8');
 assert.match(advanced,/readOnly:true/);
 assert.match(advanced,/graph\(c,'ads',\{fields:/);
 assert(advanced.includes("c.account.id+'/'+edge"));
 assert.doesNotMatch(advanced,/method:'POST'|method='POST'/);
 const panel=readFileSync(new URL('../public/meta-advanced-ui.js',import.meta.url),'utf8');
 assert.match(panel,/Próximo passo sugerido/);
 assert.match(panel,/selected!=='diagnosis'/);
});
