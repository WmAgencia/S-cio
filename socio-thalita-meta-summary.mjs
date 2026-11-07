// Human-readable and verifiable Meta Ads summaries for Thalita.
// Never infer paid sales from attribution, and never interpret WhatsApp zeros as ad-history zeros.
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function isMetaAdsIntent(input){
 const text=norm(input);
 return /\b(meta\s*(?:ads|ad|eds|ed|edge|edges)|metads|metaedge|metaed|facebook\s*ads|gerenciador\s*de\s*anuncios)\b/.test(text)||
  /\b(?:campanhas?|anuncios?|criativos?)\b.{0,65}\b(?:da|do|no|na)\s+meta\b/.test(text)||
  /\bmeta\b.{0,65}\b(?:campanhas?|anuncios?|criativos?)\b/.test(text);
}
export function isMetaOverviewIntent(input){
 const text=norm(input);
 return /\b(resumo|resumir|relatorio|relatorios|historico|campanhas?|anuncios?|desempenho|performance|comparar|analise|analisar|como estao|como vao|melhor|destaque|visao geral)\b/.test(text);
}
export function metaPeriodForQuery(input){
 const text=norm(input);
 if(/\b(hoje|de hoje)\b/.test(text))return 'today';
 if(/\b(ontem|de ontem)\b/.test(text))return 'yesterday';
 if(/\b(7 dias|sete dias|semana|semanal)\b/.test(text))return 'last_7d';
 return 'last_30d';
}
const asNumber=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;};
const formatInt=n=>Math.round(n).toLocaleString('pt-BR');
const formatMoney=(value,currency)=>/^[A-Z]{3}$/.test(String(currency||''))?
 new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value):
 value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' na moeda da conta';
const short=value=>String(value||'').replace(/[\r\n<>]/g,' ').trim().slice(0,100);
const purchases=actions=>Array.isArray(actions)?actions.filter(x=>
 /(^|\.)purchase$|omni_purchase|offsite_conversion\.fb_pixel_purchase/i.test(String(x.action_type||'')))
 .reduce((sum,x)=>sum+asNumber(x.value),0):0;
const periodName={today:'hoje',yesterday:'ontem',last_7d:'nos últimos 7 dias',last_30d:'nos últimos 30 dias'};
export function formatFriendlyMetaReport({campaigns,report,period='last_30d'}={}){
 if(!Array.isArray(campaigns?.items)||!Array.isArray(report?.items))throw new Error('A Meta não retornou listas confiáveis de campanhas e resultados.');
 const existing=campaigns.items.filter(c=>c&&typeof c==='object');
 const active=existing.filter(c=>(c.effective_status||c.status)==='ACTIVE');
 const rows=report.items.filter(r=>r&&typeof r==='object');
 const currency=report.summary?.currency||null,partial=Boolean(report.hasMore||campaigns.hasMore);
 const total=key=>rows.reduce((sum,x)=>sum+asNumber(x[key]),0);
 const spend=total('spend'),clicks=total('clicks'),impressions=total('impressions');
 const ctr=impressions?clicks/impressions*100:null,cpc=clicks?spend/clicks:null;
 const purchaseTotal=rows.reduce((sum,x)=>sum+purchases(x.actions),0);
 const ranked=[...rows].filter(r=>r.campaign_id&&asNumber(r.impressions)>0)
  .sort((a,b)=>asNumber(b.clicks)-asNumber(a.clicks)||asNumber(b.impressions)-asNumber(a.impressions));
 const best=ranked[0]||null;
 const label=periodName[period]||periodName.last_30d;
 const intro='Na Meta Ads, encontrei '+formatInt(existing.length)+(existing.length===1?' campanha cadastrada':' campanhas cadastradas')+
  ', com '+formatInt(active.length)+(active.length===1?' ativa':' ativas')+'.';
 let activity='';
 if(!rows.length){
  activity='A Meta não retornou métricas '+label+'. Isso não significa que você não tenha campanhas ou histórico anterior.';
 }else{
  activity=' '+label.charAt(0).toUpperCase()+label.slice(1)+', foram '+formatInt(clicks)+' cliques e '+
   formatMoney(spend,currency)+' de investimento'+(cpc!==null?'; cada clique custou em média '+formatMoney(cpc,currency):'')+'.';
 }
 const highlight=best?' A campanha com mais cliques foi "'+short(best.campaign_name||best.campaign_id)+'", com '+formatInt(asNumber(best.clicks))+' cliques.':'';
 let suggestion;
 if(!existing.length){
  suggestion='Sugestão: confirme a conta de anúncios selecionada em Conexões. Quer que eu confira com você?';
 }else if(!rows.length||clicks<20){
  suggestion='Sugestão: mantenha as campanhas em observação até reunir mais dados. Quer que eu compare os anúncios ativos?';
 }else if(purchaseTotal>0){
  suggestion='Sugestão: compare o custo por compra com sua margem antes de mudar o orçamento. Quer que eu analise o anúncio mais eficiente?';
 }else if(spend>0){
  suggestion='Sugestão: confira o Pixel e a página de destino antes de pausar ou aumentar investimento. Posso analisar os anúncios?';
 }else{
  suggestion='Sugestão: confira a entrega e a configuração das campanhas antes de fazer alterações. Quer que eu analise os anúncios?';
 }
 const coverage=partial?' A consulta retornou apenas parte dos registros; os totais podem estar incompletos.':'';
 const caution=purchaseTotal?
  ' Há '+formatInt(purchaseTotal)+' eventos de compra atribuídos, que não comprovam pagamento.':
  '';
 const message=intro+activity+highlight+caution+coverage+'\n'+suggestion;
 // Keep the recommended next step audible. Long reports are displayed in
 // full as text, but speech is short enough to generate quickly.
 const speechOptions=[
  [intro,activity,highlight,suggestion].join(' '),
  [intro,activity,suggestion].join(' '),
  [intro,highlight,suggestion].join(' '),
  [intro,suggestion].join(' ')
 ];
 const speechText=speechOptions.find(t=>t.length<=420)||
  [intro,suggestion].join(' ').slice(0,420);
 return {status:'completed',executed:false,readOnly:true,message,speechText,
  data:{source:'meta_ads',period,listedCampaigns:existing.length,activeCampaigns:active.length,
   campaignsPartial:Boolean(campaigns.hasMore),insightsPartial:Boolean(report.hasMore),
   campaignsWithMetrics:rows.length,spend,clicks,impressions,cpc,ctr,purchaseEvents:purchaseTotal,
   currency,topCampaign:best?{id:best.campaign_id,name:short(best.campaign_name||best.campaign_id),
     clicks:asNumber(best.clicks)}:null,
   advice:suggestion}};
}
