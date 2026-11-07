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
 const getCache=new Map();const snapshots=new Map();let selectedTenant=null,renderSerial=0;
 let liveRefreshTimer=null,liveRefreshSerial=0;
 const stopLiveRefresh=()=>{if(liveRefreshTimer){clearInterval(liveRefreshTimer);liveRefreshTimer=null;}liveRefreshSerial++;};
 const invalidateRender=()=>{renderSerial++;stopLiveRefresh();};
 const forTenant=me=>{const id=[me?.tenant?.id||'',me?.user?.id||'',me?.user?.role||''].join(':');
  if(selectedTenant!==id){stopLiveRefresh();getCache.clear();snapshots.clear();selectedTenant=id;}
 };
 const clearCache=()=>{stopLiveRefresh();getCache.clear();snapshots.clear();selectedTenant=null;};
 const startLiveRefresh=(root,kind,renderId,refresh,updateWhilePlaying)=>{
  stopLiveRefresh();const serial=liveRefreshSerial;
  liveRefreshTimer=setInterval(async()=>{
   if(serial!==liveRefreshSerial||renderId!==renderSerial||document.hidden||!root.isConnected)return;
   if(!root.querySelector('.px-'+kind)){stopLiveRefresh();return;}
   if(root.querySelector('dialog[open]')||root.querySelector('[data-px-action-review]:disabled'))return;
   const playing=!!root.querySelector('.px-feature-media video,.px-feature-media iframe,.px-ad-creative-media video,.px-ad-creative-media iframe');
   try{
    getCache.clear(); // Always ask server/Meta again, never reuse old KPI figures.
    if(playing){await updateWhilePlaying?.();return;}
    await refresh();
   }catch{/* Keep the last confirmed values on transient provider errors. */}
  },30000);
 };
 const displayLiveTime=root=>{
  const label=root.querySelector('.px-live-indicator');
  if(label&&label.isConnected)label.title='Última consulta iniciada às '+new Date().toLocaleTimeString('pt-BR')+
   '. A Meta pode publicar métricas com atraso.';
 };
 const cached=async(api,path,ttl=25000)=>{
  const existing=getCache.get(path),now=Date.now();
  if(existing?.result&&now-existing.at<ttl)return existing.result;
  if(existing?.pending)return existing.pending;
  const pending=optional(api,path).then(result=>{
   getCache.set(path,{result,at:Date.now()});return result;
  },error=>{getCache.delete(path);throw error;});
  getCache.set(path,{pending,at:now});return pending;
 };
 const scopedMetaItems=async(api,basePath)=>{
  const items=[],seen=new Set();let after=null;
  for(let page=0;page<12;page++){
   const path=basePath+(after?'&after='+encodeURIComponent(after):'');
   const response=await cached(api,path,20000);
   if(!response.ok)return {ok:false,reason:response.reason||'Consulta à Meta indisponível.',items:[]};
   const data=response.data||{};
   if(Array.isArray(data.items))items.push(...data.items);
   if(!data.hasMore)return {ok:true,items,limited:false};
   if(!data.after||seen.has(data.after))return {ok:true,items,limited:true};
   seen.add(data.after);after=data.after;
  }
  return {ok:true,items,limited:true};
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
 const posterFromAd=ad=>mediaUrl(ad?.creative?.image_url||
  ad?.creative?.object_story_spec?.video_data?.image_url||
  ad?.creative?.thumbnail_url);
 const trustedMetaPreview=value=>{
  try{
   const u=new URL(value);
   return u.protocol==='https:'&&u.hostname==='www.facebook.com'&&
    u.pathname==='/ads/api/preview_iframe.php'&&
    !/[?&](?:access_token|appsecret_proof|token)=/i.test(u.search)?u.href:null;
  }catch{return null;}
 };
 const trustedVideoEmbed=value=>{
  try{
   const u=new URL(value);
   if(u.protocol!=='https:'||u.hostname!=='www.facebook.com'||
    u.pathname!=='/plugins/video.php'||u.href.length>2200)return null;
   const source=new URL(u.searchParams.get('href')||'');
   const p=source.pathname;
   const validHost=['www.facebook.com','facebook.com','m.facebook.com'].includes(source.hostname);
   const validVideo=/^\/\d{4,30}\/videos\/\d{4,30}\/?$/.test(p)||
    (p==='/watch/'&&/^\d{4,30}$/.test(source.searchParams.get('v')||''));
   return validHost&&source.protocol==='https:'&&validVideo&&!source.username&&!source.password?u.href:null;
  }catch{return null;}
 };
 const createInlineFacebookVideo=(url,title)=>{
  const trusted=trustedVideoEmbed(url);
  if(!trusted)return null;
  const frame=document.createElement('iframe');
  frame.className='px-facebook-video-frame';
  frame.title=title||'Vídeo da campanha na Meta';
  frame.src=trusted;frame.loading='lazy';frame.allowFullscreen=true;
  frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.setAttribute('allow','autoplay; clipboard-write; encrypted-media; picture-in-picture');
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups allow-presentation');
  return frame;
 };
 const watchUrl=value=>{
  try{
   const url=new URL(value);
   return url.protocol==='https:'&&url.hostname==='www.facebook.com'&&
    url.pathname==='/watch/'&&/^\d{4,30}$/.test(url.searchParams.get('v')||'')?
    url.href:null;
  }catch{return null;}
 };
 const playButton=(label='Reproduzir anúncio')=>
  '<button type="button" class="px-media-play" data-px-media-play aria-label="'+esc(label)+'">'+
   '<span aria-hidden="true">▶</span> Ver vídeo</button>';
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
 const formattedDaily=(cents,currency)=>money(Number(cents||0)/100,currency)+'/dia';
 const actionButtons=(kind,obj,manage=true)=>{
  if(!manage)return '';
  const id=String(obj.id||''),status=String(obj.status||'').toUpperCase();
  if(!/^\d{4,30}$/.test(id))return '';
  const toggle=['ACTIVE','PAUSED'].includes(status)?
   '<button type="button" class="px-quick-action '+(status==='ACTIVE'?'pause':'activate')+
    '" data-px-manage-status="'+esc(id)+'" data-px-entity="'+kind+'" data-px-next="'+
    (status==='ACTIVE'?'PAUSED':'ACTIVE')+'" aria-label="'+(status==='ACTIVE'?'Pausar':'Ativar')+
    ' '+esc(obj.name||kind)+'">'+(status==='ACTIVE'?'Pausar':'Ativar')+'</button>':'';
  const budget=Number(obj.daily_budget)>0&&Number(obj.lifetime_budget||0)===0?
   '<button type="button" class="px-quick-action budget" data-px-manage-budget="'+esc(id)+
    '" data-px-entity="'+kind+'">Editar R$/dia</button>':'';
  return '<div class="px-quick-actions">'+toggle+budget+'</div>';
 };
 function advertRows(items,insightById,currency,manage=false,adsets=[]){
  return '<div class="px-table-scroll"><table class="px-table px-campaign-table"><thead><tr>'+
   '<th>Campanha</th><th>Situação</th><th>Orçamento</th><th>Gasto no período</th><th>Cliques</th><th>CPC</th><th>Impressões</th>'+
   (manage?'<th>Ações</th>':'')+'</tr></thead><tbody>'+
   items.slice(0,60).map(c=>{
    const m=insightById.get(String(c.id))||{},spend=Number(m.spend)||0,clicks=Number(m.clicks)||0;
    const picture=posterFromAd(c.topAd||null);
    const children=adsets.filter(s=>String(s.campaign_id||'')===String(c.id));
    const cbo=Number(c.daily_budget||0)>0, lifetime=Number(c.lifetime_budget||0)>0;
    const childBudgets=children.filter(s=>Number(s.daily_budget||0)>0);
    const btext=cbo?formattedDaily(c.daily_budget,currency):lifetime?'Orçamento total · '+money(Number(c.lifetime_budget)/100,currency):
     childBudgets.length?'Por conjunto de anúncios':'Não informado';
    const budgetDetails=!cbo&&!lifetime&&childBudgets.length?
     '<details class="px-budget-details"><summary>Ver '+childBudgets.length+' orçamento(s) dos conjuntos</summary><div class="px-budget-list">'+
      childBudgets.slice(0,30).map(s=>'<div class="px-budget-child"><span><strong>'+esc(s.name||s.id)+'</strong>'+
       '<small>'+formattedDaily(s.daily_budget,currency)+'</small></span>'+actionButtons('adset',s,manage)+'</div>').join('')+
      '</div></details>':'';
    return '<tr data-px-campaign-row="'+esc(c.id)+'"><td><div class="px-ad-name-cell">'+(picture?posterView(picture,'Miniatura de '+String(c.name||'')):'')+
     '<span><button type="button" class="px-campaign-open" data-px-open-campaign="'+esc(c.id)+'" aria-label="Ver anúncios da campanha '+esc(c.name||c.id)+'">'+esc(c.name||c.id)+'</button><small>'+esc(c.objective||c.id)+'</small></span></div></td>'+
     '<td><span class="px-status '+((c.effective_status||c.status)==='ACTIVE'?'on':'off')+'">'+esc(c.effective_status||c.status||'—')+'</span></td>'+
     '<td><span class="px-budget-value">'+esc(btext)+'</span>'+budgetDetails+'</td>'+
     '<td>'+money(spend,currency)+'</td><td>'+number(clicks)+'</td><td>'+(clicks?money(spend/clicks,currency):'—')+'</td><td>'+number(m.impressions||0)+'</td>'+
     (manage?'<td>'+actionButtons('campaign',c,true)+'</td>':'')+'</tr>';
   }).join('')+'</tbody></table></div>';
 }
 function adsetRows(items,currency,manage=false,hasCampaignBudget=false){
  return '<div class="px-table-scroll"><table class="px-table px-campaign-table px-adset-table"><thead><tr>'+
   '<th>Conjunto de anúncios</th><th>Situação</th><th>Orçamento</th>'+(manage?'<th>Ações</th>':'')+
   '</tr></thead><tbody>'+items.map(set=>{
    const daily=Number(set.daily_budget||0),lifetime=Number(set.lifetime_budget||0);
    const budget=daily>0?formattedDaily(daily,currency):lifetime>0?'Orçamento total · '+money(lifetime/100,currency):
     hasCampaignBudget?'Definido na campanha':'Não informado';
    const status=set.effective_status||set.status||'—';
    return '<tr><td><button type="button" class="px-campaign-open" data-px-open-adset="'+esc(set.id)+
     '" aria-label="Ver anúncios do conjunto '+esc(set.name||set.id)+'">'+esc(set.name||set.id)+
     '</button><small class="px-adset-subtitle">Ver anúncios deste conjunto</small></td>'+
     '<td><span class="px-status '+(status==='ACTIVE'?'on':'off')+'">'+esc(status)+'</span></td>'+
     '<td><span class="px-budget-value">'+esc(budget)+'</span></td>'+
     (manage?'<td>'+actionButtons('adset',set,true)+'</td>':'')+'</tr>';
   }).join('')+'</tbody></table></div>';
 }
 function adCards(items,manage=false){
  return '<div class="px-ads-list">'+items.slice(0,500).map(ad=>{
   const status=ad.effective_status||ad.status||'—';
   const configured=String(ad.status||'').toUpperCase();
   const inherited= configured==='ACTIVE'&&status!=='ACTIVE'?
    '<small class="px-ad-inherited-status">Este anúncio está ativo, mas o conjunto ou a campanha pode estar pausado.</small>':'';
   return '<div class="px-ad-creative-row">'+
    '<div class="px-ad-creative-media" data-px-ad-media="'+esc(ad.id)+'">'+
     (posterFromAd(ad)?posterView(posterFromAd(ad),'Miniatura do anúncio '+(ad.name||ad.id)):
      '<div class="px-feature-no-media">Criativo</div>')+
    '</div><div class="px-ad-creative-info"><strong>'+esc(ad.name||ad.id)+'</strong>'+
     '<small>ID '+esc(ad.id)+'</small>'+inherited+
     '<button type="button" class="px-quick-action" data-px-ad-play="'+esc(ad.id)+'">▶ Ver criativo</button></div>'+
     '<div class="px-ad-controls"><span class="px-status '+(status==='ACTIVE'?'on':'off')+'">'+esc(status)+'</span>'+
     actionButtons('ad',ad,manage)+'</div></div>';
  }).join('')+'</div>';
 }
 async function loadMeta(api,period='today',includeAdLevel=false){
  const [status,campaigns,ads,adsets,insights,adInsights]=await Promise.all([
   cached(api,'/api/marketing/official/status',25000),
   cached(api,'/api/marketing/tools/campaigns',20000),
   cached(api,'/api/marketing/tools/ads',20000),
   cached(api,'/api/marketing/tools/adsets',20000),
   cached(api,'/api/marketing/tools/insights?period='+encodeURIComponent(period),16000),
   includeAdLevel?cached(api,'/api/marketing/advanced/reports?period='+encodeURIComponent(period)+'&level=ad',16000):Promise.resolve({ok:false,data:null})
  ]);
  const currency=selectedCurrency(status.data);
  const list=campaigns.data?.items||[], adList=ads.data?.items||[],adsetList=adsets.data?.items||[],daily=insights.data?.items||[];
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
  return {status,campaigns,ads,adsets,adsetList,insights,adInsights,adItems,bestAd,adRankingMethod,currency,list,adList,daily,clicks,spend,purchases,
   activeCampaigns:list.filter(x=>(x.effective_status||x.status)==='ACTIVE').length,
   activeAds:adList.filter(x=>(x.effective_status||x.status)==='ACTIVE').length,
   best:daily.filter(x=>Number(x.clicks)>0).sort((a,b)=>Number(b.clicks)-Number(a.clicks))[0]||null};
 }
 async function overview({root,api,me,navigate,activityRange='1m'}){
  const renderId=++renderSerial;
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
  if(renderId!==renderSerial)return;
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
   '<p class="px-live-indicator"><span class="px-live-dot"></span>Atualização automática a cada 30 segundos · indicadores retornados pelos provedores</p>'+
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
  if(featuredAd){
   const placeholder=root.querySelector('[data-campaign-preview]');
   cached(api,'/api/marketing/tools/ad-media?adId='+encodeURIComponent(featuredAd.id),25000).then(result=>{
    if(!placeholder?.isConnected||!result.ok)return;
    // A public Facebook Page video uses the official inline player; its own
    // thumbnail stays crisp, and playback occurs here without leaving Sócio.
    const frame=createInlineFacebookVideo(result.data?.videoEmbedUrl,'Vídeo da campanha em destaque');
    if(frame){placeholder.replaceChildren(frame);return;}
    const src=mediaUrl(result.data?.posterUrl||result.data?.thumbnailUrl);
    if(src)placeholder.innerHTML=posterView(src,'Criativo da campanha');
    if(result.data?.quality==='thumbnail_only')placeholder?.classList.add('px-media-lowres');
   }).catch(()=>{});
  }
  root.querySelector('[data-px-reload]')?.addEventListener('click',()=>{
   getCache.clear();overview({root,api,me,navigate,activityRange:range});
  });
  root.querySelectorAll('[data-px-chart-range]').forEach(button=>button.addEventListener('click',()=>
   overview({root,api,me,navigate,activityRange:button.dataset.pxChartRange})));

  startLiveRefresh(root,'overview',renderId,
   ()=>overview({root,api,me,navigate,activityRange:range}),
   async()=>{
    const [nextMeta,nextGoogle,nextDashboard]=await Promise.all([
     ads?loadMeta(api,'today').catch(()=>null):Promise.resolve(null),
     ads?optional(api,'/api/google-ads/campaigns?period=today'):Promise.resolve(null),
     optional(api,'/api/dashboard')
    ]);
    if(renderId!==renderSerial||!root.querySelector('.px-overview'))return;
    const cells=root.querySelectorAll('.px-ads-strip .px-ads-metric>b');
    if(nextMeta?.insights.ok&&cells[0])cells[0].textContent=money(nextMeta.spend,nextMeta.currency);
    if(nextGoogle?.ok&&cells[1])cells[1].textContent=money(Number(nextGoogle.data?.summary?.costMicros||0)/1e6,nextGoogle.data?.currencyCode);
    if(nextMeta?.insights.ok&&cells[2])cells[2].textContent=number(nextMeta.clicks)+' cliques';
    const first=root.querySelectorAll('.px-kpi-grid .px-kpi-number');
    if(nextDashboard?.ok){
     if(first[0])first[0].textContent=number(nextDashboard.data?.openConversations);
     if(first[2])first[2].textContent=number(nextDashboard.data?.messagesReceivedToday);
    }
    displayLiveTime(root);
   });
  root.querySelector('[data-px-inbox]')?.addEventListener('click',()=>navigate('inbox'));
  root.querySelector('[data-px-products]')?.addEventListener('click',()=>navigate('products'));
  root.querySelector('[data-px-connections]')?.addEventListener('click',()=>navigate('connections'));
  root.querySelector('[data-px-marketing]')?.addEventListener('click',()=>navigate('marketing'));
 }
 async function marketing({root,api,me,navigate,period='last_7d',campaignId=null,adsetId=null}){
  const renderId=++renderSerial;
  forTenant(me);
  if(!root.querySelector('.px-marketing'))setPreview(root,'marketing');
  if(!can(me,'marketing.read')){root.textContent='Você não tem acesso às campanhas desta empresa.';return;}
  let data=null;try{data=await loadMeta(api,period,true);}catch{}
  if(renderId!==renderSerial)return;
  const connected=data?.status.data?.connected===true,selected=!!data?.status.data?.selectedAccount;
  const campaigns=data?.list||[],ads=data?.adList||[],hasData=data?.insights.ok===true,currency=data?.currency;
  const decoratedCampaigns=campaigns.map(c=>{
   const matches=ads.filter(ad=>String(ad.campaign_id||'')===String(c.id));
   return {...c,topAd:matches.find(ad=>(ad.effective_status||ad.status)==='ACTIVE')||matches[0]||null};
  });
  const bestThumbnail=mediaUrl(data?.bestAd?.thumbnailUrl);
  const selectedCampaign=campaignId?decoratedCampaigns.find(c=>String(c.id)===String(campaignId)):null;
  if(campaignId&&!selectedCampaign){campaignId=null;adsetId=null;}
  // Fetch the specific parent edge rather than assuming the first 100 account
  // records contain every ad set or ad. Parent ownership is checked server-side.
  const adsetResult=selectedCampaign?await scopedMetaItems(api,
   '/api/marketing/tools/adsets?campaignId='+encodeURIComponent(selectedCampaign.id)):null;
  if(renderId!==renderSerial)return;
  const accountAdsets=(data?.adsetList||[]).filter(set=>String(set.campaign_id||'')===String(campaignId));
  const campaignAdsets=adsetResult?.ok?adsetResult.items:accountAdsets;
  const selectedAdset=selectedCampaign&&adsetId?campaignAdsets.find(set=>String(set.id)===String(adsetId)):null;
  if(adsetId&&!selectedAdset)adsetId=null;
  const adsResult=selectedAdset?await scopedMetaItems(api,
   '/api/marketing/tools/ads?adsetId='+encodeURIComponent(selectedAdset.id)):null;
  if(renderId!==renderSerial)return;
  const accountSetAds=ads.filter(ad=>String(ad.adset_id||'')===String(adsetId));
  const visibleAds=selectedAdset?(adsResult?.ok?adsResult.items:accountSetAds):selectedCampaign?[]:ads;
  const manage=can(me,'marketing.manage');

  const insightsMap=new Map((data?.daily||[]).map(x=>[String(x.campaign_id),x]));
  const btn='<button type="button" class="btn soft" data-px-connect>Gerenciar conexões</button>';
  root.innerHTML='<div class="px-workspace px-marketing">'+
   '<div class="px-page-heading"><div><span class="px-eyebrow">MÍDIA PAGA · META ADS</span><h1>Campanhas e desempenho</h1>'+
    '<p>Seus anúncios, resultados e custo de mídia — sem configurar contas nesta página.</p></div>'+btn+'</div>'+
   (!connected||!selected?'<div class="px-notice"><strong>'+(!connected?'Conecte a Meta para visualizar as campanhas.':'Selecione a conta de anúncios em Conexões.')+'</strong><p>A autorização é feita em Conexões, por login oficial do Facebook.</p></div>':'')+
   '<p class="px-live-indicator" aria-live="off"><span class="px-live-dot"></span>Atualização automática a cada 30 segundos · dados retornados pela Meta</p>'+
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
   section(selectedAdset?'Anúncios do conjunto':selectedCampaign?'Conjuntos de anúncios':'Suas campanhas',
    selectedAdset?'Anúncios e criativos do conjunto selecionado':
     selectedCampaign?'Conjuntos vinculados à campanha selecionada':'Ativas, pausadas e rascunhos retornados pela Meta',
    selectedCampaign?'<div class="px-campaign-detail-heading">'+
      (selectedAdset?
       '<button type="button" class="px-campaign-back" data-px-adset-back>← Voltar aos conjuntos</button>':
       '<button type="button" class="px-campaign-back" data-px-campaign-back>← Voltar às campanhas</button>')+
      '<div class="px-campaign-crumbs"><strong>'+esc(selectedCampaign.name||selectedCampaign.id)+'</strong>'+
       (selectedAdset?'<span aria-hidden="true">›</span><strong>'+esc(selectedAdset.name||selectedAdset.id)+'</strong>':'')+
      '</div><small>'+(selectedAdset?visibleAds.length+' anúncio(s) no conjunto':campaignAdsets.length+' conjunto(s) nesta campanha')+'</small></div>'+
      (selectedAdset?
       (adsResult&&!adsResult.ok?'<p class="px-muted">Consulta específica indisponível; exibindo anúncios carregados da conta.</p>':'')+
       (adsResult?.limited?'<p class="px-muted">A Meta retornou mais anúncios do que o limite desta consulta.</p>':'')+
       (visibleAds.length?adCards(visibleAds,manage):empty('Nenhum anúncio encontrado neste conjunto.')):
       (adsetResult&&!adsetResult.ok?'<p class="px-muted">Consulta específica indisponível; exibindo conjuntos carregados da conta.</p>':'')+
       (adsetResult?.limited?'<p class="px-muted">A Meta retornou mais conjuntos do que o limite desta consulta.</p>':'')+
       (campaignAdsets.length?adsetRows(campaignAdsets,currency,manage,Number(selectedCampaign.daily_budget||0)>0):
        empty('Nenhum conjunto de anúncios encontrado nesta campanha.'))):
    data?.campaigns.ok?(decoratedCampaigns.length?advertRows(decoratedCampaigns,insightsMap,currency,manage,data.adsetList||[]):empty('A conta não retornou campanhas.')):
      empty(data?.campaigns.reason||'Conecte uma conta para listar campanhas.'))+
   section('Anúncio em destaque','Comparação de resultados na mesma conta e período',
    data?.bestAd?'<div class="px-featured-item px-featured-video">'+
      '<div class="px-feature-media" data-featured-media>'+posterView(bestThumbnail,'Miniatura do anúncio '+data.bestAd.name)+
       playButton('Ver vídeo do anúncio '+data.bestAd.name)+'</div>'+
      '<div class="px-feature-details"><span class="px-feature-label">'+esc(data.adRankingMethod||'Anúncio da conta')+'</span>'+
      '<strong>'+esc(data.bestAd.name)+'</strong>'+
      '<div class="px-feature-stats"><span>Cliques <b>'+(data.bestAd.clicks===null?'—':number(data.bestAd.clicks))+'</b></span>'+
       '<span>Gasto <b>'+(data.bestAd.spend===null?'—':money(data.bestAd.spend,currency))+'</b></span>'+
       '<span>CTR <b>'+(data.bestAd.ctr===null?'—':esc(data.bestAd.ctr.toLocaleString('pt-BR',{maximumFractionDigits:2}))+'%')+'</b></span>'+
       '<span>Compras atribuídas <b>'+(data.bestAd.purchases===null?'—':number(data.bestAd.purchases))+'</b></span></div>'+
      '<p class="px-muted">Reproduza o vídeo pelo botão Play quando a Meta disponibilizar a mídia. Eventos atribuídos não comprovam venda paga.</p></div></div>':
    empty(data?.adInsights.ok?'Sem anúncios com métricas suficientes no período.':'Relatório por anúncio indisponível nesta conta.'))+
   (!selectedCampaign?section('Anúncios e criativos','Anúncios vinculados à conta de anúncios selecionada',
    data?.ads.ok?(ads.length?adCards(ads,false):empty('Nenhum anúncio retornado pela conta.')):
     empty('Os anúncios estão indisponíveis até autorizar a leitura.')):'')+
   section('Interpretação dos resultados','As plataformas reportam atribuições, não pagamentos conciliados',
    '<div class="px-footnote">O CPA é calculado apenas quando a Meta retorna eventos Purchase. Esses eventos não são prova de pedido pago. Sem evento válido, o painel mostra “—”, em vez de inventar resultados.</div>')+
   '<dialog id="pxCampaignDialog" class="px-campaign-dialog" aria-labelledby="pxActionTitle">'+
    '<div class="px-action-dialog-content"><div class="px-action-heading"><h2 id="pxActionTitle">Alterar campanha</h2><button type="button" class="px-dialog-close" data-px-action-close aria-label="Fechar">×</button></div>'+
    '<p id="pxActionDetails" class="px-dialog-help"></p>'+
    '<label id="pxDailyBudgetField" hidden>Orçamento diário ('+esc(currency||'moeda da conta')+')'+
      '<input id="pxNewDailyBudget" type="text" inputmode="decimal" placeholder="Ex.: 25,00" autocomplete="off" maxlength="12"></label>'+
    '<p id="pxActionPreview" class="px-preview-text" hidden></p>'+
    '<p id="pxActionFeedback" role="status" class="px-dialog-feedback" aria-live="polite"></p>'+
    '<div class="px-action-dialog-buttons"><button type="button" class="btn soft" data-px-action-close>Cancelar</button>'+
      '<button type="button" class="btn primary" data-px-action-review>Revisar alteração</button>'+
      '<button type="button" class="btn primary" data-px-action-confirm hidden>Confirmar na Meta</button></div></div></dialog>'+
   '</div>';
  snapshots.set('marketing',root.innerHTML);
  if(data?.bestAd?.id){
   const holder=root.querySelector('[data-featured-media]');
   const adName=String(data.bestAd.name||'Anúncio');
   let media=null;
   const button=holder?.querySelector('[data-px-media-play]');
   const request=cached(api,'/api/marketing/tools/ad-media?adId='+encodeURIComponent(data.bestAd.id),25000).then(result=>{
    if(!holder?.isConnected)return null;
    if(!result.ok){
     button&&(button.textContent='Mídia indisponível');
     button&&(button.disabled=true);
     return null;
    }
    media=result.data||{};
    const poster=mediaUrl(media.posterUrl||media.thumbnailUrl)||bestThumbnail;
    if(poster){
     const img=holder.querySelector('.px-feature-poster');
     if(img)img.src=poster;
     else holder.insertAdjacentHTML('afterbegin',posterView(poster,'Miniatura do anúncio'));
    }
    if(media.quality==='thumbnail_only')holder.classList.add('px-media-lowres');
    if(!mediaUrl(media.videoUrl)&&!trustedVideoEmbed(media.videoEmbedUrl)&&!trustedMetaPreview(media.previewUrl)){
     if(button){button.textContent='Sem vídeo disponível';button.disabled=true;}
    }
    return media;
   }).catch(()=>{
    if(button){button.textContent='Mídia indisponível';button.disabled=true;}
    return null;
   });
   button?.addEventListener('click',async()=>{
    if(!holder?.isConnected)return;
    button.disabled=true;button.textContent='Carregando vídeo…';
    const result=media||await request;
    if(!result){button.disabled=false;button.textContent='Tentar novamente';return;}
    const video=mediaUrl(result.videoUrl),poster=mediaUrl(result.posterUrl||result.thumbnailUrl)||bestThumbnail;
    if(video){
     const el=document.createElement('video');
     el.className='px-feature-video';el.controls=true;el.playsInline=true;
     el.preload='metadata';el.setAttribute('aria-label','Vídeo do anúncio '+adName);
     if(poster)el.poster=poster;
     el.src=video;holder.replaceChildren(el);
     void el.play().catch(()=>{/* Native player still exposes its play control. */});
    }else if(trustedVideoEmbed(result.videoEmbedUrl)){
     const frame=createInlineFacebookVideo(result.videoEmbedUrl,'Reproduzir anúncio '+adName);
     if(frame)holder.replaceChildren(frame);
     else{button.textContent='Não foi possível carregar o player';button.disabled=true;}
    }else if(trustedMetaPreview(result.previewUrl)){
     const frame=document.createElement('iframe');
     frame.className='px-meta-preview-frame';
     frame.title='Visualizar anúncio '+adName;
     frame.src=trustedMetaPreview(result.previewUrl);
     frame.loading='lazy';
     frame.referrerPolicy='no-referrer';
     frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation allow-popups');
     frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture');
     holder.replaceChildren(frame);
    }else{
     button.textContent='Vídeo não disponibilizado pela Meta';button.disabled=true;
    }
   });
  }
  // Ads inside a campaign use the same tenant/account-verified media endpoint as the featured ad.
  root.querySelectorAll('[data-px-ad-play]').forEach(button=>button.addEventListener('click',async()=>{
   const adId=button.dataset.pxAdPlay,holder=root.querySelector('[data-px-ad-media="'+adId+'"]');
   if(!/^\d{4,30}$/.test(adId||'')||!holder||button.disabled)return;
   button.disabled=true;button.textContent='Carregando…';
   try{
    const response=await cached(api,'/api/marketing/tools/ad-media?adId='+encodeURIComponent(adId),25000);
    if(!response.ok||!response.data)throw new Error('A Meta não disponibilizou este criativo.');
    if(!holder.isConnected)return;
    const media=response.data,video=mediaUrl(media.videoUrl);
    const name=visibleAds.find(a=>String(a.id)===adId)?.name||'Anúncio';
    if(video){
     const player=document.createElement('video');player.controls=true;player.playsInline=true;
     player.preload='metadata';player.className='px-feature-video';
     player.setAttribute('aria-label','Vídeo de '+name);
     const poster=mediaUrl(media.posterUrl||media.thumbnailUrl);if(poster)player.poster=poster;
     player.src=video;holder.replaceChildren(player);void player.play().catch(()=>{});
     button.textContent='Vídeo disponível';button.disabled=true;
    }else if(trustedVideoEmbed(media.videoEmbedUrl)){
     const player=createInlineFacebookVideo(media.videoEmbedUrl,'Vídeo de '+name);
     holder.replaceChildren(player);button.textContent='Vídeo disponível';button.disabled=true;
    }else if(trustedMetaPreview(media.previewUrl)){
     const frame=document.createElement('iframe');frame.className='px-meta-preview-frame';
     frame.title='Prévia de '+name;frame.src=trustedMetaPreview(media.previewUrl);
     frame.loading='lazy';frame.referrerPolicy='no-referrer';
     frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation allow-popups');
     frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture');
     holder.replaceChildren(frame);button.textContent='Prévia disponível';button.disabled=true;
    }else{
     const poster=mediaUrl(media.posterUrl||media.thumbnailUrl);
     if(poster)holder.innerHTML=posterView(poster,'Imagem do anúncio '+name);
     button.textContent=poster?'Imagem do criativo':'Mídia indisponível';button.disabled=true;
    }
   }catch(error){button.textContent=String(error.message||'Criativo indisponível').slice(0,65);button.disabled=false;}
  }));
  root.querySelectorAll('[data-px-open-campaign]').forEach(button=>button.addEventListener('click',()=>
   marketing({root,api,me,navigate,period,campaignId:button.dataset.pxOpenCampaign})));
  root.querySelectorAll('[data-px-open-adset]').forEach(button=>button.addEventListener('click',()=>
   marketing({root,api,me,navigate,period,campaignId,adsetId:button.dataset.pxOpenAdset})));
  root.querySelector('[data-px-campaign-back]')?.addEventListener('click',()=>marketing({root,api,me,navigate,period}));
  root.querySelector('[data-px-adset-back]')?.addEventListener('click',()=>marketing({root,api,me,navigate,period,campaignId}));
  // Manual campaign actions reuse the server's 15-minute plan, second
  // confirmation and tenant/selected-account validation. No action is made
  // directly by clicking a row or editing an input.
  const modal=root.querySelector('#pxCampaignDialog');
  const feedback=modal?.querySelector('#pxActionFeedback'),preview=modal?.querySelector('#pxActionPreview');
  const title=modal?.querySelector('#pxActionTitle'),details=modal?.querySelector('#pxActionDetails');
  const budgetField=modal?.querySelector('#pxDailyBudgetField');
  const budgetInput=modal?.querySelector('#pxNewDailyBudget');
  const review=modal?.querySelector('[data-px-action-review]');
  const confirm=modal?.querySelector('[data-px-action-confirm]');
  const allItems=[...decoratedCampaigns.map(item=>({...item,kind:'campaign'})),
   ...(selectedCampaign?campaignAdsets:(data?.adsetList||[])).map(item=>({...item,kind:'adset'})),
   ...visibleAds.map(item=>({...item,kind:'ad'}))];
  let edit=null,draftId=null,submitting=false;
  const closeModal=()=>{
   if(submitting)return;
   draftId=null;edit=null;
   if(modal?.open)modal.close();
  };
  modal?.querySelectorAll('[data-px-action-close]').forEach(button=>button.addEventListener('click',closeModal));
  modal?.addEventListener('cancel',event=>{if(submitting)event.preventDefault();else{draftId=null;edit=null;}});
  const setDialogBusy=busy=>{
   submitting=busy;if(review)review.disabled=busy;if(confirm)confirm.disabled=busy;
  };
  const parseDailyBudget=value=>{
   const match=String(value||'').trim().replace(/^R\$\s*/,'').match(/^(\d{1,6})(?:[,.](\d{1,2}))?$/);
   if(!match)throw Error('Digite um orçamento diário válido. Exemplo: 25,00.');
   const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0')||'0');
   if(cents<100||cents>10000000)throw Error('Orçamento permitido neste painel: de 1,00 a 100.000,00.');
   return cents;
  };
  root.querySelectorAll('[data-px-manage-status],[data-px-manage-budget]').forEach(button=>{
   button.addEventListener('click',()=>{
    const kind=button.dataset.pxEntity,id=button.dataset.pxManageStatus||button.dataset.pxManageBudget;
    const item=allItems.find(x=>x.kind===kind&&String(x.id)===String(id));
    if(!item||!can(me,'marketing.manage'))return;
    edit={kind:button.hasAttribute('data-px-manage-budget')?'budget':'status',entity:kind,item,
     next:button.dataset.pxNext||null};
    draftId=null;if(preview){preview.hidden=true;preview.textContent='';}
    if(feedback)feedback.textContent='';
    if(confirm)confirm.hidden=true;
    if(review)review.hidden=false;
    if(budgetField)budgetField.hidden=edit.kind!=='budget';
    const kindLabel=kind==='campaign'?'Campanha':kind==='adset'?'Conjunto de anúncios':'Anúncio';
    if(title)title.textContent=edit.kind==='budget'?'Editar orçamento diário':
     (edit.next==='PAUSED'?'Pausar ':'Ativar ')+kindLabel.toLowerCase();
    if(details)details.textContent=kindLabel+': '+String(item.name||item.id)+
     (edit.kind==='status'?(edit.next==='ACTIVE'?' · Pode iniciar gastos de publicidade.':' · Vai interromper a veiculação.'):' · Orçamento atual '+formattedDaily(item.daily_budget,currency));
    if(budgetInput&&edit.kind==='budget')budgetInput.value=(Number(item.daily_budget)/100).toFixed(2).replace('.',',');
    if(modal&&!modal.open)modal.showModal();
    if(edit.kind==='budget')budgetInput?.focus();else review?.focus();
   });
  });
  review?.addEventListener('click',async()=>{
   if(!edit||submitting)return;
   setDialogBusy(true);if(feedback)feedback.textContent='Conferindo a alteração com a Meta…';
   try{
    const input={entity:edit.entity,id:String(edit.item.id)};
    if(edit.kind==='budget'){
     input.dailyBudgetCents=parseDailyBudget(budgetInput.value);
     if(input.dailyBudgetCents===Number(edit.item.daily_budget))throw Error('Esse já é o orçamento atual.');
    }else input.status=edit.next;
    const plan=await api('/api/marketing/tools/plan','POST',{kind:edit.kind,input});
    if(!plan?.id||!plan.requiresConfirmation)throw Error('O Sócio não recebeu uma prévia segura da Meta.');
    draftId=plan.id;
    const change=edit.kind==='budget'?
     'De '+formattedDaily(edit.item.daily_budget,currency)+' para '+formattedDaily(input.dailyBudgetCents,currency)+'.':
     edit.next==='ACTIVE'?'Ativar '+(edit.entity==='ad'?'este anúncio':edit.entity==='adset'?'este conjunto':'esta campanha')+
      '. A Meta poderá gastar conforme os orçamentos configurados.':
      'Pausar '+(edit.entity==='ad'?'este anúncio':edit.entity==='adset'?'este conjunto':'esta campanha')+'.';
    if(preview){preview.textContent=change+' Confirme somente se está correto.';preview.hidden=false;}
    if(feedback)feedback.textContent='Prévia pronta. Nada foi alterado ainda.';
    review.hidden=true;confirm.hidden=false;confirm.focus();
   }catch(error){draftId=null;if(feedback)feedback.textContent=String(error.message||'Não foi possível gerar a prévia.');}
   finally{setDialogBusy(false);}
  });
  confirm?.addEventListener('click',async()=>{
   if(!draftId||!edit||submitting)return;
   setDialogBusy(true);if(feedback)feedback.textContent='Confirmando a alteração na Meta…';
   try{
    const result=await api('/api/marketing/tools/execute','POST',{planId:draftId,confirmed:true});
    if(result?.status!=='succeeded')throw Error(result?.error||'A Meta não confirmou a alteração. Verifique o Gerenciador antes de tentar novamente.');
    if(feedback)feedback.textContent='Alteração confirmada pela Meta. Atualizando indicadores…';
    // The new status/budget is fetched from the Meta API, not guessed in UI.
    getCache.clear();snapshots.delete('marketing');snapshots.delete('overview');
    draftId=null;submitting=false;
    modal.close();
    await marketing({root,api,me,navigate,period,campaignId,adsetId});
   }catch(error){
    if(feedback)feedback.textContent=String(error.message||'Não foi possível concluir. Confira antes de repetir.');
    draftId=null;
    confirm.hidden=true;review.hidden=false;
    setDialogBusy(false);
   }
  });
  startLiveRefresh(root,'marketing',renderId,
   ()=>marketing({root,api,me,navigate,period,campaignId,adsetId}),
   async()=>{
    const current=await loadMeta(api,period,true).catch(()=>null);
    if(renderId!==renderSerial||!root.querySelector('.px-marketing')||!current)return;
    const kpis=root.querySelectorAll('.px-marketing-kpi .px-kpi-number');
    const vals=[money(current.spend,current.currency),number(current.clicks),
     current.clicks?money(current.spend/current.clicks,current.currency):'—',
     current.purchases?money(current.spend/current.purchases,current.currency):'—',
     number(current.activeCampaigns),number(current.activeAds)];
    kpis.forEach((node,i)=>{if(vals[i]!==undefined)node.textContent=vals[i];});
    const byId=new Map((current.daily||[]).map(x=>[String(x.campaign_id),x]));
    root.querySelectorAll('tr[data-px-campaign-row]').forEach(row=>{
     const metric=byId.get(row.dataset.pxCampaignRow);
     if(!metric)return;
     const cells=row.querySelectorAll(':scope > td');
     if(cells.length<7)return;
     const cost=Number(metric.spend)||0,clicks=Number(metric.clicks)||0;
     cells[3].textContent=money(cost,current.currency);
     cells[4].textContent=number(clicks);
     cells[5].textContent=clicks?money(cost/clicks,current.currency):'—';
     cells[6].textContent=number(metric.impressions||0);
    });
    displayLiveTime(root);
   });
  root.querySelector('[data-px-connect]')?.addEventListener('click',()=>navigate('connections'));
  root.querySelectorAll('[data-px-period]').forEach(b=>b.addEventListener('click',()=>marketing({root,api,me,navigate,period:b.dataset.pxPeriod,campaignId,adsetId})));

 }
 const connectBtn=(label,attr,enabled=true)=>'<button type="button" class="btn '+(enabled?'primary':'soft')+'" '+attr+' '+(!enabled?'disabled':'')+'>'+esc(label)+'</button>';
 async function connections({root,api,me,navigate}){
  const renderId=++renderSerial;
  forTenant(me);
  if(!root.querySelector('.px-connections'))setPreview(root,'connections');
  const [whatsapp,meta,google]=await Promise.all([
   cached(api,'/api/waakg/channels',12000),
   can(me,'marketing.read')?cached(api,'/api/marketing/official/status',20000):Promise.resolve({ok:false,data:null}),
   can(me,'marketing.read')?cached(api,'/api/google-ads/status',20000):Promise.resolve({ok:false,data:null}),
  ]);
  if(renderId!==renderSerial)return;
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
 globalThis.SocioWorkspaceUI={overview,marketing,connections,clearCache,invalidateRender};
})();
