import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {computeAccountEconomics,classifyCpa,formatAccountEconomics} from '../socio-account-economics.mjs';
import {buildFunnelLadder,formatFunnelLadder,FUNNEL_THRESHOLDS} from '../socio-funnel-diagnostics.mjs';
import {diagnoseMetaTraffic,formatMetaTrafficDiagnosis} from '../meta-traffic-diagnostics.mjs';

const economics=computeAccountEconomics({ticketCents:10000,marginPercent:40});

const row=(extra={})=>({campaign_id:'1234567890',campaign_name:'Moda feminina Sorocaba',
 spend:'150.00',clicks:'100',impressions:'5000',inline_link_clicks:'100',...extra});
const videoRow=(plays,thru,extra={})=>row({video_play_actions:[{action_type:'video_view',value:String(plays)}],
 video_thruplay_watched_actions:[{action_type:'video_view',value:String(thru)}],...extra});
const purchases=n=>[{action_type:'purchase',value:String(n)}];

test('Account economics derives limits from ticket and margin only',()=>{
 assert.equal(economics.valid,true);
 assert.equal(economics.grossProfitPerSaleCents,4000);
 assert.equal(economics.maxCpaCents,4000);
 assert.equal(economics.breakEvenRoas,2.5);
 assert.equal(economics.targetCpaCents,3200);
 assert.equal(economics.killCpaCents,4160);
 assert.equal(economics.profitPerSaleAtTargetCents,800);
 assert.match(formatAccountEconomics(economics),/R\$\s32,00/);
 assert.match(formatAccountEconomics(economics),/2\.50x/);
});

test('Economics refuses to invent a ticket or margin',()=>{
 const noTicket=computeAccountEconomics({marginPercent:40});
 assert.equal(noTicket.valid,false);
 assert.equal(noTicket.reason,'ticket_ausente');
 assert.equal(noTicket.targetCpaCents,undefined);
 const noMargin=computeAccountEconomics({ticketCents:10000});
 assert.equal(noMargin.reason,'margem_invalida');
 assert.equal(noMargin.killCpaCents,undefined);
 const tooHigh=computeAccountEconomics({ticketCents:10000,marginPercent:40,targetCpaCents:9000});
 assert.equal(tooHigh.targetCpaCents,3200,'an impossible target falls back to the margin default');
 assert.equal(tooHigh.targetSource,'padrao_80_da_margem');
 const explicit=computeAccountEconomics({ticketCents:10000,marginPercent:40,targetCpaCents:2500});
 assert.equal(explicit.targetCpaCents,2500);
 assert.equal(explicit.targetSource,'informado');
});

test('CPA classification applies target and kill limits',()=>{
 assert.equal(classifyCpa({cpaCents:3000,economics}).verdict,'on_target');
 assert.equal(classifyCpa({cpaCents:4000,economics}).verdict,'over_target');
 assert.equal(classifyCpa({cpaCents:4160,economics}).verdict,'over_target');
 assert.equal(classifyCpa({cpaCents:5000,economics}).verdict,'unprofitable');
 assert.equal(classifyCpa({cpaCents:5000,economics:null}).verdict,'unknown');
 assert.equal(classifyCpa({cpaCents:null,economics}).reason,'sem_vendas_confirmadas');
});

test('Healthy funnel passes every rung and names no culprit',()=>{
 const ladder=buildFunnelLadder({insights:[videoRow(1500,300,{actions:purchases(5)})],economics});
 const c=ladder.campaigns[0];
 assert.equal(c.culprit,null);
 assert.deepEqual(c.rungs.map(r=>r.status),['ok','ok','ok','ok','ok','ok']);
 assert.equal(c.rungs.find(r=>r.id==='hook').value,30);
 assert.equal(c.rungs.find(r=>r.id==='hold').value,20);
 assert.equal(c.rungs.find(r=>r.id==='click').value,2);
 assert.equal(c.rungs.find(r=>r.id==='economics').value,3000);
 assert.equal(ladder.readOnly,true);
 assert.equal(ladder.economics.valid,true);
});

test('The first failing rung is the culprit, not the loudest metric',()=>{
 const ladder=buildFunnelLadder({insights:[videoRow(500,400,{actions:purchases(5)})],economics});
 const c=ladder.campaigns[0];
 assert.equal(c.culprit.id,'hook');
 assert.match(c.culprit.label,/Gancho/);
 assert.match(c.culprit.recommendation,/primeiros segundos/);
 assert(formatFunnelLadder(ladder).includes('Problema principal: Gancho'));
 const short=ladder.campaigns[0].rungs.find(r=>r.id==='hold');
 assert.equal(short.status,'ok','a strong hold rate does not excuse a weak hook');
});

test('Zero delivery is the culprit before any creative judgement',()=>{
 const ladder=buildFunnelLadder({insights:[row({impressions:'0',clicks:'0',spend:'0'})],economics});
 assert.equal(ladder.campaigns[0].culprit.id,'delivery');
 assert.match(ladder.campaigns[0].culprit.recommendation,/status, aprovação, saldo/);
});

test('Clicks without a recorded result are reported as unproven, not as a failure',()=>{
 const ladder=buildFunnelLadder({insights:[row()],economics});
 const c=ladder.campaigns[0];
 const result=c.rungs.find(r=>r.id==='result');
 assert.equal(result.status,'unavailable');
 assert.match(result.detail,/Clique não comprova conversa nem venda/);
 assert.equal(c.culprit,null);
 assert(!c.rungs.some(r=>r.id==='economics'),'no purchase event means no CPA claim');
 assert.doesNotMatch(formatFunnelLadder(ladder),/vendas? confirmada|ROAS 3/);
});

test('A small sample never accuses an ad set',()=>{
 const ladder=buildFunnelLadder({insights:[row({impressions:'100',clicks:'5',inline_link_clicks:'5'})],economics});
 const c=ladder.campaigns[0];
 assert.equal(c.sampleLimited,true);
 assert.equal(c.culprit,null);
 assert(c.rungs.filter(r=>r.status!=='unavailable').every(r=>r.status==='limited'));
 assert.match(formatFunnelLadder(ladder),/Amostra pequena/);
});

test('Cost per sale above the kill limit fails on economics',()=>{
 const ladder=buildFunnelLadder({insights:[videoRow(1500,300,{spend:'500.00',actions:purchases(5)})],economics});
 const c=ladder.campaigns[0];
 assert.equal(c.cpaCents,10000);
 assert.equal(c.culprit.id,'economics');
 assert.match(c.culprit.recommendation,/prejuízo/);
});

test('Diagnosis keeps its shape and adds the funnel per campaign',()=>{
 const result=diagnoseMetaTraffic({insights:[videoRow(500,400,{actions:purchases(5)})],
  ads:[{id:'9001',campaign_id:'1234567890',name:'Anúncio',effective_status:'ACTIVE'}],
  economics});
 assert.equal(result.readOnly,true);
 assert.equal(result.diagnostics.length,1);
 assert.equal(result.diagnostics[0].impressions,5000);
 assert.equal(result.diagnostics[0].ctrPercent,2);
 assert.equal(result.diagnostics[0].funnel.culprit.id,'hook');
 assert.equal(result.funnel.campaigns.length,1);
 const text=formatMetaTrafficDiagnosis(result);
 assert.match(text,/Funil de Moda feminina Sorocaba/);
 assert.match(text,/primeira etapa abaixo do parâmetro é Gancho/);
 assert.match(text,/alvo de R\$\s32,00 por venda/);
 assert.doesNotMatch(text,/5 vendas|ROAS 3|convers[aã]o confirmada/);
});

test('Diagnosis without economics still reports the funnel and the honest limit',()=>{
 const result=diagnoseMetaTraffic({insights:[row({actions:purchases(5)})]});
 const text=formatMetaTrafficDiagnosis(result);
 assert.doesNotMatch(text,/alvo de/);
 assert.equal(result.funnel.economics.valid,false);
 assert.equal(result.diagnostics[0].funnel.culprit,null);
});

test('Funnel and economics modules stay read-only',()=>{
 for(const file of ['../socio-funnel-diagnostics.mjs','../socio-account-economics.mjs']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/method:\s*['"]POST['"]|fetch\(|graph\(/i);
 }
 assert.equal(FUNNEL_THRESHOLDS.minImpressions,300);
 assert.equal(FUNNEL_THRESHOLDS.hookRatePercent,25);
});
