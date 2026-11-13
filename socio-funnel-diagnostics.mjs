// Funnel ladder diagnostics. Read-only and honest: a rung with no metric is
// "unavailable", never a failure, and the first failing rung is the culprit.
// Benchmarks are practitioner ranges, not guarantees from Meta.
import {classifyCpa} from './socio-account-economics.mjs';

export const FUNNEL_VERSION='socio-funnel-diagnostics-v1';

export const FUNNEL_THRESHOLDS=Object.freeze({
 minImpressions:300,
 hookRatePercent:25,
 holdRatePercent:15,
 linkCtrPercent:1
});

const PURCHASE_TYPES=['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase'];
const CONVERSATION_TYPES=['onsite_conversion.messaging_conversation_started_7d',
 'onsite_conversion.total_messaging_connection'];
const LEAD_TYPES=['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead'];

const num=value=>{
 const n=Number(value);
 return Number.isFinite(n)&&n>=0?n:0;
};
const list=row=>Array.isArray(row.actions)?row.actions:[];
const actionCount=(row,types)=>{
 for(const type of types){
  const found=list(row).find(a=>a&&a.action_type===type);
  if(found){const n=Number(found.value);if(Number.isFinite(n))return n;}
 }
 return 0;
};
const videoCount=(row,field)=>{
 const source=Array.isArray(row[field])?row[field]:null;
 if(source===null)return null;
 const found=source.find(a=>a&&a.action_type==='video_view');
 if(!found)return num(source[0]?.value)||0;
 const n=Number(found.value);
 return Number.isFinite(n)?n:0;
};
const money=(cents,currency)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'BRL'})
 .format(Number(cents||0)/100);
const percent=value=>Math.round(value*10)/10;

function rung({id,label,value=null,unit='percent',benchmark=null,status='unavailable',detail=null}){
 return {id,label,value,unit,benchmark,status,detail};
}

const RECOMMENDATIONS={
 delivery:'Não há entrega suficiente para julgar o anúncio. Confira status, aprovação, saldo, orçamento e público antes de trocar o criativo.',
 hook:'A queda está nos primeiros segundos. Troque a abertura do vídeo antes de mexer em oferta, público ou orçamento.',
 hold:'O público vê o início e abandona no meio. Encurte o vídeo ou mostre o produto mais cedo.',
 click:'Há entrega e retenção, mas poucos cliques. O problema é a oferta ou a clareza do anúncio, não o público.',
 result:'Há cliques e nenhum resultado registrado pela Meta. Verifique página, atendimento e a atribuição antes de culpar a campanha.',
 economics:'O custo por venda passou do limite calculado com a sua margem: cada venda nesse custo dá prejuízo. Pausar ou reduzir é mais barato que insistir.'
};

function resultKind(row){
 if(actionCount(row,PURCHASE_TYPES)>0)return {kind:'purchase',events:actionCount(row,PURCHASE_TYPES)};
 if(actionCount(row,CONVERSATION_TYPES)>0)return {kind:'conversation',events:actionCount(row,CONVERSATION_TYPES)};
 if(actionCount(row,LEAD_TYPES)>0)return {kind:'lead',events:actionCount(row,LEAD_TYPES)};
 return {kind:null,events:0};
}

function buildCampaignLadder(row,economics,currency){
 const impressions=num(row.impressions);
 const clicks=num(row.clicks);
 const linkClicks=num(row.inline_link_clicks)||clicks;
 const spendCents=Math.round(num(row.spend)*100);
 const plays=videoCount(row,'video_play_actions');
 const thruplays=videoCount(row,'video_thruplay_watched_actions');
 const hasVideo=plays===null?false:plays>0||(thruplays||0)>0;
 const thin=impressions<FUNNEL_THRESHOLDS.minImpressions;
 const rungs=[];

 if(impressions===0)
  rungs.push(rung({id:'delivery',label:'Entrega',value:0,unit:'impressions',status:'fail',
   detail:'Sem impressões no período.'}));
 else
  rungs.push(rung({id:'delivery',label:'Entrega',value:impressions,unit:'impressions',
   benchmark:`mínimo ${FUNNEL_THRESHOLDS.minImpressions} impressões para julgar`,
   status:thin?'limited':'ok',
   detail:thin?'Amostra pequena: a leitura abaixo ainda não é confiável.':null}));

 if(!hasVideo){
  rungs.push(rung({id:'hook',label:'Gancho (3s)',benchmark:`≥ ${FUNNEL_THRESHOLDS.hookRatePercent}% das impressões`,
   detail:'A Meta não retornou métrica de vídeo neste período.'}));
  rungs.push(rung({id:'hold',label:'Retenção no vídeo',benchmark:`≥ ${FUNNEL_THRESHOLDS.holdRatePercent}% dos que iniciaram`,
   detail:'A Meta não retornou métrica de vídeo neste período.'}));
 }else{
  const hookRate=impressions>0?plays/impressions*100:0;
  const holdRate=plays>0?(thruplays||0)/plays*100:0;
  rungs.push(rung({id:'hook',label:'Gancho (3s)',value:percent(hookRate),
   benchmark:`≥ ${FUNNEL_THRESHOLDS.hookRatePercent}% das impressões`,
   status:thin?'limited':hookRate>=FUNNEL_THRESHOLDS.hookRatePercent?'ok':'fail'}));
  rungs.push(rung({id:'hold',label:'Retenção no vídeo',value:percent(holdRate),
   benchmark:`≥ ${FUNNEL_THRESHOLDS.holdRatePercent}% dos que iniciaram`,
   status:thin?'limited':holdRate>=FUNNEL_THRESHOLDS.holdRatePercent?'ok':'fail'}));
 }

 const ctr=impressions>0?linkClicks/impressions*100:0;
 rungs.push(rung({id:'click',label:'Clique no link',value:percent(ctr),
  benchmark:`≥ ${FUNNEL_THRESHOLDS.linkCtrPercent}% das impressões`,
  status:thin?'limited':ctr>=FUNNEL_THRESHOLDS.linkCtrPercent?'ok':'fail',
  detail:clicks===0&&impressions>0?'Há impressões e nenhum clique.':null}));

 const total=resultKind(row);
 if(total.kind===null){
  rungs.push(rung({id:'result',label:'Resultado',benchmark:'evento de conversa, lead ou compra',
   detail:'A Meta não retornou evento de resultado. Clique não comprova conversa nem venda.'}));
 }else{
  const costCents=Math.round(spendCents/total.events);
  rungs.push(rung({id:'result',label:total.kind==='purchase'?'Venda':total.kind==='lead'?'Lead':'Conversa iniciada',
   value:costCents,unit:'cents',benchmark:'custo por resultado',
   status:thin?'limited':'ok',
   detail:total.events+' resultado(s) registrados pela Meta no período.'}));
 }

 let cpa=null;
 if(total.kind==='purchase'&&economics?.valid&&total.events>0){
  cpa=Math.round(spendCents/total.events);
  const verdict=classifyCpa({cpaCents:cpa,economics});
  const rungsSale=rung({id:'economics',label:'Custo por venda',value:cpa,unit:'cents',
   benchmark:`alvo ${money(economics.targetCpaCents,currency)}, corte ${money(economics.killCpaCents,currency)}`,
   status:verdict.verdict==='on_target'?'ok':verdict.verdict==='over_target'?'over':'fail',
   detail:verdict.detail});
  rungs.push(rungsSale);
 }

 const culprit=rungs.find(r=>r.status==='fail')||null;
 return {
  campaignId:String(row.campaign_id||''),
  campaignName:String(row.campaign_name||'Campanha'),
  rungs,
  culprit:culprit?{id:culprit.id,label:culprit.label,recommendation:RECOMMENDATIONS[culprit.id]||null}:null,
  sampleLimited:thin,
  impressions,spendCents,cpaCents:cpa
 };
}

export function buildFunnelLadder({insights=[],economics=null,period='last_7d',currency='BRL'}={}){
 const rows=Array.isArray(insights)?insights.filter(r=>r&&r.campaign_id):[];
 const campaigns=rows.map(row=>buildCampaignLadder(row,economics,currency));
 return {
  version:FUNNEL_VERSION,
  period,currency,
  thresholds:FUNNEL_THRESHOLDS,
  economics: economics?.valid?{valid:true,targetCpaCents:economics.targetCpaCents,
   killCpaCents:economics.killCpaCents,breakEvenRoas:economics.breakEvenRoas}:{valid:false},
  campaigns,
  readOnly:true
 };
}

export function formatFunnelLadder(result,{max=3}={}){
 const lines=[];
 for(const campaign of (result?.campaigns||[]).slice(0,max)){
  const visible=campaign.rungs.filter(r=>r.status!=='unavailable');
  if(!visible.length){
   lines.push(`${campaign.campaignName}: sem métricas suficientes para ler o funil.`);
   continue;
  }
  const parts=campaign.rungs.filter(r=>r.status!=='unavailable')
   .map(r=>`${r.label} ${r.unit==='cents'?money(r.value,result.currency):
    r.unit==='impressions'?`${r.value}`:`${r.value}%`}`).join(' · ');
  const head=`${campaign.campaignName}: ${parts}`;
  if(campaign.culprit)
   lines.push(`${head}\nProblema principal: ${campaign.culprit.label}. ${campaign.culprit.recommendation||''}`.trim());
  else if(campaign.sampleLimited)
   lines.push(`${head}\nAmostra pequena: ainda não há base para apontar a etapa culpada.`);
  else
   lines.push(`${head}\nNenhuma etapa abaixo do parâmetro no período.`);
 }
 if(!lines.length)lines.push('Nenhuma campanha com dados no período.');
 return lines.join('\n');
}
