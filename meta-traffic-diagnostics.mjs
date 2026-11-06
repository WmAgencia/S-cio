// Pure, read-only traffic diagnostics: only observed Meta statuses and metrics.
// Never labels a click as a paid order or a WhatsApp conversation.
// No execution functions or access to ad accounts live here.
const amount=x=>{const n=Number(x);return Number.isFinite(n)&&n>=0?n:null;};
const integer=x=>{const n=amount(x);return n===null?null:Math.floor(n);};
const code=x=>typeof x==='string'&&/^\d{4,30}$/.test(x)?x:null;
const name=x=>String(x||'Campanha').replace(/[<>\x00-\x1f]/g,' ').slice(0,100);
const status=x=>String(x||'UNKNOWN').toUpperCase().slice(0,35);
const badStatuses=new Set(['DISAPPROVED','WITH_ISSUES']);
const reviewStatuses=new Set(['PENDING_REVIEW','IN_PROCESS']);
const notice=(priority,code,label,evidence,recommendation)=>({priority,code,label,evidence,recommendation});

export function diagnoseMetaTraffic({insights=[],ads=[],period='last_7d',currency='BRL',
 insightsHasMore=false,adsHasMore=false,adsUnavailable=false}={}){
 if(!Array.isArray(insights)||!Array.isArray(ads))throw Object.assign(new Error('Dados de diagnóstico inválidos.'),{status:422});
 const byCampaign=new Map();
 for(const row of insights.slice(0,100)){
  const id=code(row?.campaign_id);if(!id)continue;
  const spend=amount(row.spend),clicks=integer(row.clicks),impressions=integer(row.impressions);
  if(spend===null||clicks===null||impressions===null)continue;
  const prev=byCampaign.get(id)||{id,name:name(row.campaign_name),spend:0,clicks:0,impressions:0,hasInsights:false,ads:[],notices:[]};
  prev.spend+=spend;prev.clicks+=clicks;prev.impressions+=impressions;prev.hasInsights=true;
  byCampaign.set(id,prev);
 }
 // Ads can have no insight rows because they have not delivered yet.
 const seen=new Set();
 for(const ad of ads.slice(0,100)){
  const id=code(ad?.id),campaignId=code(ad?.campaign_id);
  if(!id||!campaignId||seen.has(id))continue;seen.add(id);
  const entry=byCampaign.get(campaignId)||{id:campaignId,name:'Campanha '+campaignId,spend:0,clicks:0,impressions:0,ads:[],notices:[]};
  entry.ads.push({id,name:name(ad.name||'Anúncio'),status:status(ad.effective_status||ad.status)});
  byCampaign.set(campaignId,entry);
 }
 const diagnostics=[...byCampaign.values()].map(c=>{
  const issues=c.ads.filter(x=>badStatuses.has(x.status));
  const reviews=c.ads.filter(x=>reviewStatuses.has(x.status));
  const paused=c.ads.filter(x=>x.status==='PAUSED'||x.status==='CAMPAIGN_PAUSED'||x.status==='ADSET_PAUSED');
  if(issues.length)c.notices.push(notice(1,'ad_issue','Anúncio com restrição sinalizada pela Meta',
   issues.length+' anúncio(s) com situação '+[...new Set(issues.map(x=>x.status))].join(', ')+'.',
   'Consulte o motivo e a política no Gerenciador de Anúncios antes de substituir ou solicitar revisão.'));
  if(reviews.length)c.notices.push(notice(2,'under_review','Anúncio em revisão',
   reviews.length+' anúncio(s) aguardando ou passando por revisão.',
   'Aguarde a decisão da Meta antes de avaliar a entrega ou modificar o criativo.'));
  if(!c.hasInsights)c.notices.push(notice(3,'metrics_unavailable','Sem métricas retornadas',
   'A Meta não retornou uma linha de insights para esta campanha no período.',
   'Verifique o período, acesso e status na Meta. Ausência de dados não comprova zero entrega.'));
  else if(c.impressions===0&&c.spend===0)c.notices.push(notice(2,'no_delivery','Sem entrega observada no período',
   'Zero impressões e investimento nas linhas de insights consultadas.',
   'Verifique período, situação da campanha, aprovação, saldo, orçamento e público; não conclua que há falha antes da conferência.'));
  else if(c.impressions>=300&&c.clicks===0)c.notices.push(notice(2,'no_clicks','Cliques não registrados',
   c.impressions+' impressões, zero cliques e '+c.spend.toFixed(2)+' '+currency+' de gasto.',
   'Revise criativo, oferta e destino. Faça comparação controlada, sem afirmar que o anúncio é ruim apenas por uma métrica.'));
  else if(c.hasInsights&&(c.impressions<300||c.clicks<10))c.notices.push(notice(3,'limited_sample','Amostra limitada',
   c.impressions+' impressões e '+c.clicks+' cliques.',
   'Acompanhe mais dados e não pause ou redistribua verba apenas com esta amostra.'));
  if(paused.length)c.notices.push(notice(3,'paused_ads','Anúncios pausados identificados',
   paused.length+' anúncio(s) com status efetivo pausado na Meta.',
   'Confirme se a pausa foi planejada. Não ative sem autorização do proprietário.'));
  const ctr=c.impressions?+(100*c.clicks/c.impressions).toFixed(2):null;
  const cpc=c.clicks?+(c.spend/c.clicks).toFixed(2):null;
  c.notices.sort((a,b)=>a.priority-b.priority);
  return {id:c.id,name:c.name,hasInsights:c.hasInsights,spend:c.hasInsights?+c.spend.toFixed(2):null,
   impressions:c.hasInsights?c.impressions:null,clicks:c.hasInsights?c.clicks:null,
   ctrPercent:c.hasInsights?ctr:null,cpc:c.hasInsights?cpc:null,adIssues:issues.map(x=>({id:x.id,status:x.status})),
   notices:c.notices,priority:c.notices[0]?.priority||4,
   recommendations:c.notices.map(x=>x.recommendation)};
 });
 diagnostics.sort((a,b)=>a.priority-b.priority||(b.spend||0)-(a.spend||0)||a.id.localeCompare(b.id));
 return {period,currency,diagnostics:diagnostics.slice(0,30),totalCampaigns:diagnostics.length,
  alerts:diagnostics.reduce((n,c)=>n+c.adIssues.length,0),
  partial:Boolean(insightsHasMore||adsHasMore),
  adsUnavailable:Boolean(adsUnavailable),
  readOnly:true,
  warning:'Diagnóstico com dados Meta Ads. Cliques, ações relatadas pela plataforma e mensagens não provam leads qualificados, compras ou receita. Amostra e período podem limitar conclusões.'};
}
export function formatMetaTrafficDiagnosis(result,{max=5}={}){
 if(!result||!Array.isArray(result.diagnostics))throw Object.assign(new Error('Diagnóstico indisponível.'),{status:503});
 const lines=['Diagnóstico Meta Ads ('+result.period+', '+result.currency+'), sem alterar anúncios:'];
 const rows=result.diagnostics.slice(0,Math.max(1,Math.min(10,max)));
 if(!rows.length)lines.push('Sem dados de campanhas nesse período. Verifique datas e contas; isso não comprova ausência de campanhas.');
 for(const c of rows){
  const n=c.notices?.[0];
  lines.push('• '+c.name+' (ID '+c.id+'): '+(c.hasInsights?c.spend.toFixed(2)+' '+result.currency+
   ', '+c.impressions+' impressões e '+c.clicks+' cliques. ':'métricas não retornadas neste período. ')+
   (n?n.label+': '+n.evidence+' Próximo passo: '+n.recommendation:
    'Sem alerta suficiente para recomendar alteração. Confirme leads e vendas antes de otimizar.'));
 }
 if(result.partial||result.totalCampaigns>rows.length)
  lines.push('Atenção: o resultado pode ser parcial; consulte as próximas páginas antes de comparar tudo.');
 if(result.adsUnavailable)lines.push('Não foi possível confirmar os status dos anúncios; rejeições não foram avaliadas.');
 lines.push('Não medi vendas confirmadas ou respostas do WA-AKG nesta consulta. Nenhuma campanha foi alterada. Para executar uma mudança, peça o ajuste específico e confirme o plano.');
 return lines.join('\n');
}
