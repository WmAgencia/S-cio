// Sócio executive dashboard, connected-account directory and dedicated Meta Ads analytics.
// Everything is read-only except explicit OAuth/selection/QR actions owned by existing APIs.
(()=>{
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=x=>Number(x||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
 const money=(value,currency)=>{
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0)return '—';
  if(!/^[A-Z]{3}$/.test(currency||''))return amount.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' · moeda da conta';
  try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(amount);}catch{return amount.toFixed(2)+' '+currency;}
 };
 const optional=async(api,path)=>{try{return {data:await api(path),ok:true};}catch(error){return {data:null,ok:false,reason:String(error?.message||'Dados indisponíveis').slice(0,120)};}};
 // Small per-company GET cache removes the blank transition on repeat visits.
 // In-flight calls are shared; values expire quickly and manual refresh clears them.
 const getCache=new Map();const snapshots=new Map();let selectedTenant=null;
 const forTenant=me=>{const id=[me?.tenant?.id||'',me?.user?.id||'',me?.user?.role||''].join(':');
  if(selectedTenant!==id){getCache.clear();snapshots.clear();selectedTenant=id;}
 };
 const clearCache=()=>{getCache.clear();snapshots.clear();selectedTenant=null;};
 const cached=async(api,path,ttl=25000)=>{
  const existing=getCache.get(path),now=Date.now();
  if(existing?.result&&now-existing.at<ttl)return existing.result;
  if(existing?.pending)return existing.pending;
  const pending=optional(api,path).then(result=>{
   getCache.set(path,{result,at:Date.now()});return result;
  },error=>{getCache.delete(path);throw error;});
  getCache.set(path,{pending,at:now});return pending;
 };
 const setPreview=(root,kind)=>{
  const html=snapshots.get(kind);
  if(html){root.innerHTML=html;return;}
  // Render real section chrome immediately, not a full-page loading message.
  root.innerHTML='<div class="px-workspace px-initial-view"><div class="px-page-heading"><div><h1>'+
   ({overview:'Visão geral',marketing:'Meta Ads',connections:'Conexões'}[kind]||'Sócio')+
   '</h1></div></div><div class="px-initial-grid"><div></div><div></div><div></div></div></div>';
 };
 const mediaUrl=(value)=>{
  if(typeof value!=='string'||value.length>2600)return null;
  try{
   const u=new URL(value);
   return u.protocol==='https:'&&!u.username&&!u.password&&
    /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com)$/.test(u.hostname.toLowerCase())?u.href:null;
  }catch{return null;}
 };
 const posterFromAd=ad=>mediaUrl(ad?.creative?.thumbnail_url||ad?.creative?.object_story_spec?.video_data?.image_url);
 const posterView=(image,label)=>image?
  '<img class="px-feature-poster" loading="lazy" src="'+esc(image)+'" alt="'+esc(label||'Miniatura do criativo')+'">':
  '<div class="px-feature-no-media" role="note">Miniatura não disponível</div>';
 const permissions=me=>new Set(me?.user?.permissions||[]);
 const can=(me,permission)=>me?.user?.platformOwner||permissions(me).has(permission);
 const selectedCurrency=(status)=>status?.selectedAccount?.currency||null;
 const kpi=(label,value,meta,icon='◈',tone='purple')=>'<article class="px-kpi"><div class="px-kpi-top"><span class="px-kpi-label">'+esc(label)+'</span><span class="px-kpi-icon '+tone+'">'+icon+'</span></div>'+
  '<strong class="px-kpi-number">'+esc(value)+'</strong><small>'+esc(meta)+'</small></article>';
 const empty=(text)=>'<p class="px-muted">'+esc(text)+'</p>';
 const chart=(points)=>{
  const values=(Array.isArray(points)?points:[]).map(x=>({date:String(x.date||''),inbound:Number(x.inbound)||0,outbound:Number(x.outbound)||0}));
  if(!values.length)return empty('Sem histórico de mensagens neste período.');
  const max=Math.max(1,...values.map(x=>Math.max(x.inbound,x.outbound)));
  const path=k=>values.map((d,i)=>(i?'L':'M')+(16+i/(Math.max(1,values.length-1))*712).toFixed(1)+','+(190-(d[k]/max)*162).toFixed(1)).join(' ');
  const defs='<defs><linearGradient id="pxChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7654ee" stop-opacity=".21"/><stop offset="1" stop-color="#7654ee" stop-opacity="0"/></linearGradient></defs>';
  const floor=190,xlast=16+(values.length-1)/Math.max(1,values.length-1)*712;
  const area=path('inbound')+' L'+xlast+','+floor+' L16,'+floor+'Z';
  const guides=[.25,.5,.75,1].map(r=>'<line x1="16" x2="728" y1="'+(190-r*162)+'" y2="'+(190-r*162)+'" stroke="#e8e4f3" stroke-width="1" stroke-dasharray="4 7"/>').join('');
  const hoverPoints=values.map((d,i)=>{
   const x=(16+i/Math.max(1,values.length-1)*712).toFixed(1);
   const y=(190-d.inbound/max*162).toFixed(1);
   const label=esc(d.date+' — '+d.inbound+' recebidas, '+d.outbound+' enviadas');
   return '<circle class="px-chart-hit" tabindex="0" cx="'+x+'" cy="'+y+'" r="9" fill="transparent" aria-label="'+label+'"><title>'+label+'</title></circle>';
  }).join('');
  return '<svg class="px-svg" viewBox="0 0 748 212" preserveAspectRatio="none" role="img" aria-label="Gráfico de mensagens recebidas em roxo e enviadas em verde">'+defs+guides+
   '<path d="'+area+'" fill="url(#pxChartFill)"/><path d="'+path('inbound')+'" stroke="#7650ed" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>'+
   '<path d="'+path('outbound')+'" stroke="#16a778" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'+hoverPoints+'</svg>'+
   '<div class="px-axis"><span>'+esc(values[0].date)+'</span><span>'+esc(values[Math.floor(values.length/2)].date)+'</span><span>'+esc(values.at(-1).date)+'</span></div>';
 };
 const section=(title,subtitle,content,aside='')=>'<section class="px-panel"><div class="px-panel-head"><div><h2>'+esc(title)+'</h2><p>'+esc(subtitle)+'</p></div>'+aside+'</div>'+content+'</section>';
 function advertRows(items,insightById,currency){
  return '<div class="px-table-scroll"><table class="px-table"><thead><tr><th>Campanha</th><th>Situação</th><th>Gasto</th><th>Cliques</th><th>CPC</th><th>Impressões</th></tr></thead><tbody>'+
   items.slice(0,40).map(c=>{
    const m=insightById.get(String(c.id))||{},spend=Number(m.spend)||0,clicks=Number(m.clicks)||0;
    const picture=posterFromAd(c.topAd||null);
   return '<tr><td><div class="px-ad-name-cell">'+(picture?posterView(picture,'Miniatura de '+String(c.name||'')):'')+
    '<span><strong>'+esc(c.name||c.id)+'</strong><small>'+esc(c.objective||c.id)+'</small></span></div></td>'+
     '<td><span class="px-status '+((c.effective_status||c.status)==='ACTIVE'?'on':'off')+'">'+esc(c.effective_status||c.status||'—')+'</span></td>'+
     '<td>'+money(spend,currency)+'</td><td>'+number(clicks)+'</td><td>'+(clicks?money(spend/clicks,currency):'—')+'</td><td>'+number(m.impressions||0)+'</td></tr>';
   }).join('')+'</tbody></table></div>';
 }
 async function loadMeta(api,period='today',includeAdLevel=false){
  const [status,campaigns,ads,insights,adInsights]=await Promise.all([
   cached(api,'/api/marketing/official/status',25000),
   cached(api,'/api/marketing/tools/campaigns',20000),
   cached(api,'/api/marketing/tools/ads',20000),
   cached(api,'/api/marketing/tools/insights?period='+encodeURIComponent(period),16000),
   includeAdLevel?cached(api,'/api/marketing/advanced/reports?period='+encodeURIComponent(period)+'&level=ad',16000):Promise.resolve({ok:false,data:null})
  ]);
  const currency=selectedCurrency(status.data);
  const list=campaigns.data?.items||[], adList=ads.data?.items||[],daily=insights.data?.items||[];
  const total=key=>daily.reduce((sum,x)=>sum+(Number(x[key])||0),0);
  const clicks=total('clicks'),spend=total('spend');
  const purchase=record=>Array.isArray(record.actions)?record.actions.filter(x=>
    /(^|\.)purchase$|omni_purchase|offsite_conversion\.fb_pixel_purchase/i.test(String(x.action_type||'')))
    .reduce((n,x)=>n+(Number(x.value)||0),0):0;
  const purchases=daily.reduce((sum,x)=>sum+purchase(x),0);
  // A ranking is comparable only within one account and reporting period.
  const adItems=Array.isArray(adInsights.data?.items)?adInsights.data.items:[];
  const withMetrics=adItems.map(x=>({id:String(x.ad_id||''),name:String(x.ad_name||'Anúncio'),
   clicks:Number(x.clicks)||0,impressions:Number(x.impressions)||0,spend:Number(x.spend)||0,
   purchases:purchase(x),ctr:Number(x.ctr)||0})).filter(x=>x.id&&x.impressions>0);
  const adById=new Map(adList.map(ad=>[String(ad.id),ad]));
  for(const item of withMetrics){
   const original=adById.get(item.id);
   item.thumbnailUrl=posterFromAd(original);
   item.active=original?(original.effective_status||original.status)==='ACTIVE':false;
  }
  const eligible=withMetrics.some(x=>x.active)?withMetrics.filter(x=>x.active):withMetrics;
  const purchaseAds=eligible.filter(x=>x.purchases>0&&x.spend>=0);
  let bestAd=null,adRankingMethod=null;
  if(purchaseAds.length){
   bestAd=[...purchaseAds].sort((a,b)=>(a.spend/a.purchases)-(b.spend/b.purchases)||b.purchases-a.purchases)[0];
   adRankingMethod='Menor custo por evento Purchase atribuído';
  }else if(withMetrics.length){
   bestAd=[...eligible].sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions)[0];
   adRankingMethod='Maior número de cliques (sem compras atribuídas)';
  }
  if(!bestAd&&adList.length){
   const running=adList.find(ad=>(ad.effective_status||ad.status)==='ACTIVE');
   const fallback=running||adList[0];
   bestAd={id:String(fallback.id),name:String(fallback.name||'Anúncio'),
    clicks:null,impressions:null,spend:null,ctr:null,purchases:null,
    thumbnailUrl:posterFromAd(fallback),active:Boolean(running)};
   adRankingMethod=running?'Anúncio ativo · sem métricas por anúncio':'Anúncio da conta · sem métricas por anúncio';
  }
  return {status,campaigns,ads,insights,adInsights,adItems,bestAd,adRankingMethod,currency,list,adList,daily,clicks,spend,purchases,
   activeCampaigns:list.filter(x=>(x.effective_status||x.status)==='ACTIVE').length,
   activeAds:adList.filter(x=>(x.effective_status||x.status)==='ACTIVE').length,
   best:daily.filter(x=>Number(x.clicks)>0).sort((a,b)=>Number(b.clicks)-Number(a.clicks))[0]||null};
 }
 async function overview({root,api,me,navigate,activityRange='1m'}){
  const range=['7d','1m','90d'].includes(activityRange)?activityRange:'1m';
  forTenant(me);
  if(!root.querySelector('.px-overview'))setPreview(root,'overview');
  const authorized=can(me,'audit.read'),ads=can(me,'marketing.read');
  const calls=[
   cached(api,'/api/dashboard',12000),
   cached(api,'/api/dashboard/activity?range='+range,16000),
   authorized?cached(api,'/api/dashboard/executive',12000):Promise.resolve({data:null,ok:false}),
   cached(api,'/api/waakg/channels',12000),
   authorized?cached(api,'/api/reports/monitor',16000):Promise.resolve({data:null,ok:false}),
   ads?loadMeta(api,'today').catch(()=>null):Promise.resolve(null),
   ads?cached(api,'/api/google-ads/campaigns?period=today',60000):Promise.resolve({ok:false}),
  ];
  const [dashboard,activity,exec,wa,monitor,meta,google]=await Promise.all(calls);
  const d=dashboard.data||{},ex=exec.data||{},m=ex.counts||{},realWa=Array.isArray(wa.data)?wa.data.filter(c=>c.status==='connected').length:0;
  const metaReady=meta?.insights.ok===true,googleReady=google.ok===true;
  const googleMicros=googleReady?Number(google.data?.summary?.costMicros||0)/1e6:null;
  const googleCode=google.data?.currencyCode||null;
  const daily=activity.data?.points||[],received=daily.reduce((n,x)=>n+(Number(x.inbound)||0),0),sent=daily.reduce((n,x)=>n+(Number(x.outbound)||0),0);
  const connectedWa=Array.isArray(wa.data)?wa.data.filter(w=>w.status==='connected'):[];
  const products=Array.isArray(ex.popularProducts)?ex.popularProducts:[];
  const max=Math.max(1,...products.map(x=>x.requests));
  const bestCampaign=meta?.best||meta?.list?.find(c=>(c.effective_status||c.status)==='ACTIVE')||null;
  const bestCampaignId=String(bestCampaign?.campaign_id||bestCampaign?.id||'');
  const featuredAds=meta?.adList?.filter(ad=>String(ad.campaign_id||'')===bestCampaignId)||[];
  const featuredAd=featuredAds.find(ad=>(ad.effective_status||ad.status)==='ACTIVE')||featuredAds[0]||null;
  const featuredThumb=posterFromAd(featuredAd);
  const featuredIsRanked=Boolean(meta?.best);

  root.innerHTML='<div class="px-workspace px-overview">'+
   '<div class="px-page-heading"><div><span class="px-eyebrow">CENTRAL DE INTELIGÊNCIA</span><h1>Visão geral</h1><p>Operação, atendimento e publicidade da sua empresa em um único painel.</p></div>'+
    '<button class="btn soft" data-px-reload type="button">↻ Atualizar indicadores</button></div>'+
   '<div class="px-kpi-grid">'+
    kpi('Conversas em aberto',number(d.openConversations),'Atendimento da empresa','▤')+
    kpi('WhatsApps conectados',number(realWa),'Sessões vinculadas','◉','green')+
    kpi('Mensagens hoje',number(d.messagesReceivedToday),'Recebidas · horário de Brasília','✉','blue')+
    kpi('Oportunidades (30d)',authorized?number(m.opportunities):'—','Intenções, não vendas confirmadas','◇')+
    kpi('Pedidos registrados (30d)',authorized?number(m.registeredOrders):'—','Pedidos, não pagamentos','▣','blue')+
    kpi('Vendas pagas', '—','Sem conciliação financeira de produção','◈','muted')+
   '</div>'+
   '<div class="px-ads-strip">'+
    '<article class="px-ads-metric"><div><span class="px-brand-dot meta"></span><strong>Meta Ads</strong><small>Gasto hoje</small></div><b>'+ (metaReady?money(meta.spend,meta.currency):'Não disponível')+'</b>'+
     '<small>'+(metaReady?'Retornado pela conta autorizada':'Conecte ou valide a conta para consultar')+'</small></article>'+
    '<article class="px-ads-metric"><div><span class="px-brand-dot google"></span><strong>Google Ads</strong><small>Gasto hoje</small></div><b>'+(googleReady?money(googleMicros,googleCode):'Não disponível')+'</b>'+
     '<small>'+(googleReady?'Moeda da conta: '+(googleCode||'não identificada'):'Requer OAuth, conta selecionada e API autorizada')+'</small></article>'+
    '<article class="px-ads-metric"><div><span class="px-brand-dot purple"></span><strong>Resultado de anúncios</strong><small>Hoje · Meta</small></div><b>'+(metaReady?number(meta.clicks)+' cliques':'Não disponível')+'</b>'+
     '<small>'+(metaReady&&meta.clicks?'CPC: '+money(meta.spend/meta.clicks,meta.currency):'Sem CPC verificável')+'</small></article>'+
   '</div>'+
   '<div class="px-dual">'+
    section('Atividade de conversas','Mensagens recebidas e enviadas, conforme o período selecionado',
     '<div class="px-graph-counts"><div><span>Recebidas</span><strong>'+number(received)+'</strong></div><div><span>Enviadas</span><strong>'+number(sent)+'</strong></div><div><span>Volume total</span><strong>'+number(received+sent)+'</strong></div></div>'+
     '<div class="px-chart-wrap">'+chart(daily)+'</div>'+
     '<div class="px-legend"><span><i class="px-dot purple"></i> Recebidas</span><span><i class="px-dot green"></i> Enviadas</span></div>',
     '<div class="px-chart-actions" role="group" aria-label="Período do gráfico">'+
       [['7d','7 dias'],['1m','30 dias'],['90d','90 dias']].map(([value,label])=>
        '<button type="button" class="px-range-btn '+(range===value?'active':'')+'" data-px-chart-range="'+value+'" aria-pressed="'+(range===value)+'">'+label+'</button>').join('')+
       '</div>')+
    section('Produtos mais solicitados','Intenções identificadas nos últimos 30 dias — não vendas pagas',
     products.length?'<div class="px-products-rank">'+products.map((p,i)=>
      '<div class="px-rank"><div class="px-rank-title"><span>'+(i+1)+'. '+esc(p.name)+'</span><strong>'+number(p.requests)+' solicitações</strong></div>'+
      '<div class="px-rank-track"><i style="width:'+Math.round(p.requests/max*100)+'%"></i></div></div>').join('')+'</div>':
      empty(authorized?'Ainda não há produtos identificados em intenções de compra.':'Acesso ao relatório não disponível.'),
      '<button type="button" class="btn sm soft" data-px-products>Catálogo</button>')+
   '</div>'+
   '<div class="px-dual">'+
    section('Funil de atendimento','Oportunidades acompanhadas, sem confundir status com receita',
      '<div class="px-funnel">'+[
       ['Mensagens hoje',d.messagesReceivedToday],
       ['Oportunidades',m.opportunities],
       ['Pedidos registrados',m.registeredOrders],
       ['Vendas pagas',null]
      ].map(([label,val])=>'<div><span>'+esc(label)+'</span><strong>'+(val==null?'—':number(val))+'</strong></div>').join('')+'</div>'+
      '<small class="px-muted">“Concluídas manualmente” não significa pagamento recebido.</small>')+
    section('Campanha em destaque','Destaque com métricas de hoje e miniatura do anúncio associado',
     bestCampaign?'<div class="px-featured-item">'+
      '<div class="px-feature-media" data-campaign-preview>'+posterView(featuredThumb,'Criativo da campanha '+String(bestCampaign.campaign_name||bestCampaign.name||''))+'</div>'+
      '<div class="px-feature-details"><span class="px-feature-label">'+(featuredIsRanked?'Campanha com mais cliques hoje':'Campanha ativa · sem cliques confirmados hoje')+'</span>'+
      '<strong>'+esc(bestCampaign.campaign_name||bestCampaign.name||bestCampaignId)+'</strong>'+
      '<div class="px-feature-stats"><span>Cliques <b>'+(featuredIsRanked?number(bestCampaign.clicks):'—')+'</b></span>'+
      '<span>Gasto <b>'+(featuredIsRanked?money(bestCampaign.spend,meta?.currency):'—')+'</b></span></div></div></div>':
     empty('Nenhuma campanha encontrada na conta Meta selecionada.'),
     '<button class="btn sm soft" data-px-marketing type="button">Ver Meta Ads</button>')+
   '</div>'+
   section('Seus WhatsApps','Números conectados disponíveis para o atendimento',
    connectedWa.length?'<div class="px-wa-overview-list">'+connectedWa.slice(0,8).map(w=>
     '<div><span class="px-live-dot on"></span><div><strong>'+esc(w.label||'WhatsApp')+'</strong><small>'+esc(w.phone||'Número vinculado')+'</small></div><span class="px-status on">Conectado</span></div>').join('')+
     (connectedWa.length>8?'<small>Mais '+number(connectedWa.length-8)+' número(s).</small>':'')+'</div>':
     empty('Nenhum WhatsApp conectado no momento.'),
     '<button type="button" class="btn sm soft" data-px-connections>+ Conectar WhatsApp</button>')+
   '<p class="px-provenance">Indicadores consolidados por empresa. Métricas publicitárias dependem das permissões Meta/Google; conversões atribuídas por anúncios não são comprovantes de pagamento. Nenhum número indisponível é substituído por uma estimativa.</p>'+
  '</div>';
  snapshots.set('overview',root.innerHTML);
  if(featuredAd&&!featuredThumb){
   const placeholder=root.querySelector('[data-campaign-preview]');
   cached(api,'/api/marketing/tools/ad-media?adId='+encodeURIComponent(featuredAd.id),25000).then(result=>{
    if(!placeholder?.isConnected||!result.ok)return;
    const src=mediaUrl(result.data?.thumbnailUrl);
    if(src)placeholder.innerHTML=posterView(src,'Criativo da campanha');
   });
  }
  root.querySelector('[data-px-reload]')?.addEventListener('click',()=>{
   getCache.clear();overview({root,api,me,navigate,activityRange:range});
  });
  root.querySelectorAll('[data-px-chart-range]').forEach(button=>button.addEventListener('click',()=>
   overview({root,api,me,navigate,activityRange:button.dataset.pxChartRange})));

  root.querySelector('[data-px-inbox]')?.addEventListener('click',()=>navigate('inbox'));
  root.querySelector('[data-px-products]')?.addEventListener('click',()=>navigate('products'));
  root.querySelector('[data-px-connections]')?.addEventListener('click',()=>navigate('connections'));
  root.querySelector('[data-px-marketing]')?.addEventListener('click',()=>navigate('marketing'));
 }
 async function marketing({root,api,me,navigate,period='last_7d'}){
  forTenant(me);
  if(!root.querySelector('.px-marketing'))setPreview(root,'marketing');
  if(!can(me,'marketing.read')){root.textContent='Você não tem acesso às campanhas desta empresa.';return;}
  let data=null;try{data=await loadMeta(api,period,true);}catch{}
  const connected=data?.status.data?.connected===true,selected=!!data?.status.data?.selectedAccount;
  const campaigns=data?.list||[],ads=data?.adList||[],hasData=data?.insights.ok===true,currency=data?.currency;
  const decoratedCampaigns=campaigns.map(c=>{
   const matches=ads.filter(ad=>String(ad.campaign_id||'')===String(c.id));
   return {...c,topAd:matches.find(ad=>(ad.effective_status||ad.status)==='ACTIVE')||matches[0]||null};
  });
  const bestThumbnail=mediaUrl(data?.bestAd?.thumbnailUrl);

  const insightsMap=new Map((data?.daily||[]).map(x=>[String(x.campaign_id),x]));
  const btn='<button type="button" class="btn soft" data-px-connect>Gerenciar conexões</button>';
  root.innerHTML='<div class="px-workspace px-marketing">'+
   '<div class="px-page-heading"><div><span class="px-eyebrow">MÍDIA PAGA · META ADS</span><h1>Campanhas e desempenho</h1>'+
    '<p>Seus anúncios, resultados e custo de mídia — sem configurar contas nesta página.</p></div>'+btn+'</div>'+
   (!connected||!selected?'<div class="px-notice"><strong>'+(!connected?'Conecte a Meta para visualizar as campanhas.':'Selecione a conta de anúncios em Conexões.')+'</strong><p>A autorização é feita em Conexões, por login oficial do Facebook.</p></div>':'')+
   '<div class="px-marketing-filters" role="group" aria-label="Período dos anúncios">'+
     [['today','Hoje'],['last_7d','7 dias'],['last_30d','30 dias']].map(([v,l])=>
       '<button type="button" class="'+(period===v?'selected':'')+'" data-px-period="'+v+'" aria-pressed="'+(period===v)+'">'+l+'</button>').join('')+'</div>'+
   '<div class="px-kpi-grid px-marketing-kpi">'+
    kpi('Investimento',hasData?money(data.spend,currency):'—','Período selecionado','R$')+
    kpi('Cliques',hasData?number(data.clicks):'—','Contados pela Meta','⌁','blue')+
    kpi('CPC',hasData&&data.clicks?money(data.spend/data.clicks,currency):'—','Gasto ÷ cliques','↗','green')+
    kpi('CPA atribuído',hasData&&data.purchases?money(data.spend/data.purchases,currency):'—','Evento Purchase · não receita','◈')+
    kpi('Campanhas ativas',data?.campaigns.ok?number(data.activeCampaigns):'—','Situação atual da Meta','▤','green')+
    kpi('Anúncios ativos',data?.ads.ok?number(data.activeAds):'—','Situação atual dos anúncios','◉','blue')+
   '</div>'+
   section('Suas campanhas','Ativas, pausadas e rascunhos retornados pela Meta',
    data?.campaigns.ok?(decoratedCampaigns.length?advertRows(decoratedCampaigns,insightsMap,currency):empty('A conta não retornou campanhas.')):
      empty(data?.campaigns.reason||'Conecte uma conta para listar campanhas.'))+
   section('Anúncio em destaque','Comparação de resultados na mesma conta e período',
    data?.bestAd?'<div class="px-featured-item px-featured-video">'+
      '<div class="px-feature-media" data-featured-media>'+posterView(bestThumbnail,'Miniatura do anúncio '+data.bestAd.name)+'</div>'+
      '<div class="px-feature-details"><span class="px-feature-label">'+esc(data.adRankingMethod||'Anúncio da conta')+'</span>'+
      '<strong>'+esc(data.bestAd.name)+'</strong>'+
      '<div class="px-feature-stats"><span>Cliques <b>'+(data.bestAd.clicks===null?'—':number(data.bestAd.clicks))+'</b></span>'+
       '<span>Gasto <b>'+(data.bestAd.spend===null?'—':money(data.bestAd.spend,currency))+'</b></span>'+
       '<span>CTR <b>'+(data.bestAd.ctr===null?'—':esc(data.bestAd.ctr.toLocaleString('pt-BR',{maximumFractionDigits:2}))+'%')+'</b></span>'+
       '<span>Compras atribuídas <b>'+(data.bestAd.purchases===null?'—':number(data.bestAd.purchases))+'</b></span></div>'+
      '<p class="px-muted">Reproduza o vídeo pelo botão Play quando a Meta disponibilizar a mídia. Eventos atribuídos não comprovam venda paga.</p></div></div>':
    empty(data?.adInsights.ok?'Sem anúncios com métricas suficientes no período.':'Relatório por anúncio indisponível nesta conta.'))+
   section('Anúncios e criativos','Anúncios vinculados à conta de anúncios selecionada',
    data?.ads.ok?(ads.length?'<div class="px-ads-list">'+ads.slice(0,20).map(ad=>
      '<div><div><strong>'+esc(ad.name||ad.id)+'</strong><small>'+esc(ad.id)+'</small></div>'+
      '<span class="px-status '+((ad.effective_status||ad.status)==='ACTIVE'?'on':'off')+'">'+esc(ad.effective_status||ad.status||'—')+'</span></div>').join('')+'</div>':
      empty('Nenhum anúncio retornado pela conta.')):empty('Os anúncios estão indisponíveis até autorizar a leitura.'))+
   section('Interpretação dos resultados','As plataformas reportam atribuições, não pagamentos conciliados',
    '<div class="px-footnote">O CPA é calculado apenas quando a Meta retorna eventos Purchase. Esses eventos não são prova de pedido pago. Sem evento válido, o painel mostra “—”, em vez de inventar resultados.</div>')+
   (connected&&selected?'<details class="px-advanced"><summary>Ferramentas avançadas e gerenciamento de anúncios</summary><div id="pxAdvancedMeta"></div></details>':'')+
   '</div>';
  snapshots.set('marketing',root.innerHTML);
  if(data?.bestAd?.id){
   const holder=root.querySelector('[data-featured-media]');
   cached(api,'/api/marketing/tools/ad-media?adId='+encodeURIComponent(data.bestAd.id),25000).then(result=>{
    if(!holder?.isConnected||!result.ok)return;
    const video=mediaUrl(result.data?.videoUrl),poster=mediaUrl(result.data?.thumbnailUrl)||bestThumbnail;
    if(video){
     const el=document.createElement('video');
     el.className='px-feature-video';el.controls=true;el.playsInline=true;
     el.preload='none';el.setAttribute('aria-label','Reproduzir vídeo do anúncio '+data.bestAd.name);
     if(poster)el.poster=poster;
     el.src=video;holder.replaceChildren(el);
    }else if(poster)holder.innerHTML=posterView(poster,'Miniatura do anúncio');
   });
  }
  root.querySelector('[data-px-connect]')?.addEventListener('click',()=>navigate('connections'));
  root.querySelectorAll('[data-px-period]').forEach(b=>b.addEventListener('click',()=>marketing({root,api,me,navigate,period:b.dataset.pxPeriod})));
  const advanced=root.querySelector('#pxAdvancedMeta'),details=advanced?.closest('details');
  if(advanced&&details)details.addEventListener('toggle',()=>{
   if(!details.open||advanced.dataset.loaded)return;advanced.dataset.loaded='1';
   if(globalThis.SocioMetaOfficial)globalThis.SocioMetaOfficial.render({root:advanced,api,canManage:can(me,'marketing.manage')});
  });
 }
 const connectBtn=(label,attr,enabled=true)=>'<button type="button" class="btn '+(enabled?'primary':'soft')+'" '+attr+' '+(!enabled?'disabled':'')+'>'+esc(label)+'</button>';
 async function connections({root,api,me,navigate}){
  forTenant(me);
  if(!root.querySelector('.px-connections'))setPreview(root,'connections');
  const [whatsapp,meta,google]=await Promise.all([
   cached(api,'/api/waakg/channels',12000),
   can(me,'marketing.read')?cached(api,'/api/marketing/official/status',20000):Promise.resolve({ok:false,data:null}),
   can(me,'marketing.read')?cached(api,'/api/google-ads/status',20000):Promise.resolve({ok:false,data:null}),
  ]);
  const manageWa=can(me,'channels.manage'),manageAds=can(me,'marketing.manage');
  const waList=Array.isArray(whatsapp.data)?whatsapp.data:[],connectedWa=waList.filter(w=>w.status==='connected');
  const metaConnected=meta.data?.connected===true,googleConnected=google.data?.connected===true;
  const metaSelected=meta.data?.selectedAccount,googleSelected=google.data?.selectedCustomerId;
  root.innerHTML='<div class="px-workspace px-connections">'+
   '<div class="px-page-heading"><div><span class="px-eyebrow">SUAS INTEGRAÇÕES</span><h1>Conexões</h1><p>Autorize uma vez. O Sócio organiza os dados e as campanhas no painel.</p></div></div>'+
   '<div class="px-connection-grid">'+
   '<section class="px-conn-card"><div class="px-conn-head"><span class="px-conn-icon wa">◉</span><div><h2>WhatsApp</h2><p>'+number(connectedWa.length)+' WhatsApp(s) conectado(s)</p></div><span class="px-status '+(connectedWa.length?'on':'off')+'">'+(connectedWa.length?'Ativo':'Pendente')+'</span></div>'+
    '<div class="px-conn-list">'+(waList.length?waList.map(w=>
      '<div class="px-conn-row"><span class="px-live-dot '+(w.status==='connected'?'on':'')+'"></span><span><strong>'+esc(w.label||'WhatsApp')+'</strong><small>'+esc((w.phone||'').startsWith('pending-')?'Aguardando QR':w.phone||'Sem telefone confirmado')+'</small></span></div>').join(''):
     empty('Nenhum número conectado ainda.'))+'</div>'+
    '<div class="px-conn-actions">'+connectBtn('+ Conectar WhatsApp','data-px-wa',manageWa)+'</div></section>'+
   '<section class="px-conn-card"><div class="px-conn-head"><span class="px-conn-icon meta">f</span><div><h2>Meta Ads</h2><p>Login seguro com Facebook</p></div><span class="px-status '+(metaConnected?'on':'off')+'">'+(metaConnected?'Autorizado':'Pendente')+'</span></div>'+
    '<div class="px-conn-list"><p class="px-muted">'+(metaSelected?'Conta selecionada: <strong>'+esc(metaSelected.account_name||metaSelected.account_id)+'</strong>':
      metaConnected?'Autorização recebida. Escolha uma conta de anúncios.':'Nenhuma conta Meta conectada.')+'</p>'+
    (metaConnected?'<label class="px-account-select">Conta de anúncios<select id="pxMetaAccount"><option value="">Carregando contas…</option></select></label>':'')+'</div>'+
    '<div class="px-conn-actions">'+connectBtn(metaConnected?'Reconectar Facebook':'Conectar com Facebook','data-px-meta',manageAds&&meta.data?.configured!==false)+
      (metaConnected?connectBtn('Usar conta selecionada','data-px-meta-select',manageAds):'')+'</div></section>'+
   '<section class="px-conn-card"><div class="px-conn-head"><span class="px-conn-icon google">G</span><div><h2>Google Ads</h2><p>Autorização pela conta Google</p></div><span class="px-status '+(googleConnected?'on':'off')+'">'+(googleConnected?'Autorizado':'Pendente')+'</span></div>'+
    '<div class="px-conn-list"><p class="px-muted">'+(googleSelected?'Conta Google Ads: <strong>'+esc(googleSelected)+'</strong>':
       googleConnected?'Autorizada, aguardando seleção da conta.':'Nenhuma conta Google Ads conectada.')+'</p>'+
      (googleConnected?'<label class="px-account-select">Conta Google Ads<select id="pxGoogleAccount"><option value="">Carregando contas…</option></select></label>':'')+
      '<p class="px-muted">Leitura de campanhas; criação de anúncios Google ainda não habilitada.</p></div>'+
    '<div class="px-conn-actions">'+connectBtn(googleConnected?'Reconectar Google':'Conectar com Google','data-px-google',manageAds&&google.data?.configured!==false)+
      (googleConnected?connectBtn('Usar conta selecionada','data-px-google-select',manageAds):'')+'</div></section>'+
   '</div><p class="px-provenance">Nenhuma senha, token ou chave de aplicativo é solicitada nesta página. As permissões são concedidas nas telas oficiais dos provedores. WhatsApp exige leitura do QR Code.</p>'+
   '</div>';
  snapshots.set('connections',root.innerHTML);
  const safeLocation=(uri,domain)=>{
   const url=new URL(uri);if(url.protocol!=='https:'||!(url.hostname===domain||url.hostname.endsWith('.'+domain)))throw Error('Destino de autorização não reconhecido.');
   location.assign(url.href);
  };
  root.querySelector('[data-px-wa]')?.addEventListener('click',()=>globalThis.SocioUX?.openQr({
   api,toast:msg=>{const el=root.querySelector('.px-provenance');if(el)el.textContent=msg;},canManage:manageWa,
   onConnected:()=>{clearCache();return connections({root,api,me,navigate});}}));
  root.querySelector('[data-px-meta]')?.addEventListener('click',async ev=>{
   ev.currentTarget.disabled=true;try{const r=await api('/api/marketing/official/connect','POST',{});safeLocation(r.authorizationUrl,'facebook.com');}
   catch(e){root.querySelector('.px-provenance').textContent=e.message;ev.currentTarget.disabled=false;}
  });
  root.querySelector('[data-px-google]')?.addEventListener('click',async ev=>{
   ev.currentTarget.disabled=true;try{const r=await api('/api/google-ads/connect','POST',{});safeLocation(r.authorizationUrl,'accounts.google.com');}
   catch(e){root.querySelector('.px-provenance').textContent=e.message;ev.currentTarget.disabled=false;}
  });
  if(metaConnected){
   const select=root.querySelector('#pxMetaAccount');
   optional(api,'/api/marketing/official/accounts').then(result=>{
    if(!select?.isConnected)return;select.replaceChildren(new Option('Escolha uma conta…',''));
    for(const account of result.data?.accounts||[])select.add(new Option((account.name||account.id)+' · '+(account.currency||''),account.id));
    select.value=metaSelected?.account_id||'';
   });
   root.querySelector('[data-px-meta-select]')?.addEventListener('click',async ev=>{
    if(!select?.value)return;
    ev.currentTarget.disabled=true;
    try{await api('/api/marketing/official/account','POST',{accountId:select.value});clearCache();await connections({root,api,me,navigate});}
    catch(e){root.querySelector('.px-provenance').textContent=e.message;ev.currentTarget.disabled=false;}
   });
  }
  if(googleConnected){
   const select=root.querySelector('#pxGoogleAccount');
   optional(api,'/api/google-ads/accounts').then(result=>{
    if(!select?.isConnected)return;select.replaceChildren(new Option('Escolha uma conta…',''));
    for(const account of result.data?.accounts||[])select.add(new Option(account.id,account.id));
    select.value=googleSelected||'';
   });
   root.querySelector('[data-px-google-select]')?.addEventListener('click',async ev=>{
    if(!select?.value)return;
    ev.currentTarget.disabled=true;
    try{await api('/api/google-ads/accounts/select','POST',{accountId:select.value});clearCache();await connections({root,api,me,navigate});}
    catch(e){root.querySelector('.px-provenance').textContent=e.message;ev.currentTarget.disabled=false;}
   });
  }
 }
 globalThis.SocioWorkspaceUI={overview,marketing,connections,clearCache};
})();
