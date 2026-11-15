// Sócio executive dashboard, connected-account directory and dedicated Meta Ads analytics.
// Everything is read-only except explicit OAuth/selection/QR actions owned by existing APIs.
(()=>{
 const googleAdsVisible=()=>globalThis.SocioProductFeatures?.googleAdsVisible===true;
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
 const getCache=new Map();const snapshots=new Map();const posterCache=new Map();const billingAutoAttempts=new Map();let selectedTenant=null,renderSerial=0,periodDraft=null;
 // The spend breakdown answers to its own window, independent of the headline
 // filter: an owner comparing this month's revenue against today's spend breakdown
 // must not have one choice silently rewrite the other.
 const splitState={preset:'month',from:null,to:null};
 let liveRefreshTimer=null,liveRefreshSerial=0,liveRefreshBusy=false;
 const stopLiveRefresh=()=>{if(liveRefreshTimer){clearInterval(liveRefreshTimer);liveRefreshTimer=null;}liveRefreshSerial++;};
 const invalidateRender=()=>{renderSerial++;stopLiveRefresh();};
 const forTenant=me=>{const id=[me?.tenant?.id||'',me?.user?.id||'',me?.user?.role||''].join(':');
  if(selectedTenant!==id){stopLiveRefresh();window.SocioMetaBilling?.dispose();getCache.clear();posterCache.clear();billingAutoAttempts.clear();snapshots.clear();periodDraft=null;splitState.preset='month';splitState.from=null;splitState.to=null;selectedTenant=id;}
 };
 const clearCache=()=>{stopLiveRefresh();getCache.clear();posterCache.clear();snapshots.clear();selectedTenant=null;};
 const startLiveRefresh=(root,kind,renderId,refresh,updateWhilePlaying)=>{
  stopLiveRefresh();const serial=liveRefreshSerial;
  liveRefreshTimer=setInterval(async()=>{
   if(liveRefreshBusy||serial!==liveRefreshSerial||renderId!==renderSerial||document.hidden||!root.isConnected)return;
   if(!root.querySelector('.px-'+kind)){stopLiveRefresh();return;}
   if(root.querySelector('dialog[open]')||root.querySelector('[data-px-action-review]:disabled'))return;
   const playing=!!root.querySelector('.px-feature-media video,.px-feature-media iframe,.px-ad-creative-media video,.px-ad-creative-media iframe');
   liveRefreshBusy=true;
   try{
    getCache.clear(); // Fresh provider values, no estimated KPIs.
    if(playing){await updateWhilePlaying?.();return;}
    await refresh();
   }catch{/* Keep the last confirmed values on transient provider errors. */}
   finally{liveRefreshBusy=false;}
  },60000);
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
  const title=({overview:'Visão geral',marketing:'Meta Ads',connections:'Conexões'}[kind]||'Sócio');
  const skeleton='<span class="px-load-line" aria-hidden="true"></span>';
  if(kind==='overview'){
   // Final-geometry placeholders: no white default cards, wrong balances or
   // empty rectangles while ad providers and company KPIs are loading.
   root.innerHTML='<div class="px-workspace px-overview px-overview-loading et-board" aria-busy="true">'+
    '<h1 class="et-title">Visão geral</h1>'+
    '<div class="et-board-grid px-overview-skeleton" aria-hidden="true">'+
     '<section class="et-hero px-load-card">'+skeleton+skeleton+skeleton+'</section>'+
     '<article class="et-kpi et-income px-load-card">'+skeleton+skeleton+'</article>'+
     '<article class="et-kpi px-load-card">'+skeleton+skeleton+'</article>'+
     '<article class="et-block et-recs et-card px-load-card">'+skeleton+skeleton+skeleton+'</article>'+
     '<article class="et-card et-flow px-load-card">'+skeleton+skeleton+skeleton+'</article>'+
     '<article class="et-card et-expense-split px-load-card">'+skeleton+skeleton+skeleton+'</article>'+
     '<article class="et-block et-subs px-load-card">'+skeleton+skeleton+'</article>'+
    '</div>'+
    '<p class="px-load-status" role="status">Consultando dados confirmados da empresa…</p>'+
    '</div>';
   return;
  }
  root.innerHTML='<div class="px-workspace px-initial-view px-screen-loading" aria-busy="true">'+
   '<div class="px-page-heading"><div><h1>'+esc(title)+'</h1>'+
   '<p>Carregando informações da empresa…</p></div></div>'+
   '<div class="px-initial-grid" aria-hidden="true">'+
   '<div class="px-load-card">'+skeleton+skeleton+'</div>'+
   '<div class="px-load-card">'+skeleton+skeleton+'</div>'+
   '<div class="px-load-card">'+skeleton+skeleton+'</div></div></div>';
 };
 const mediaUrl=(value)=>{
  if(typeof value!=='string'||value.length>2600)return null;
  try{
   const u=new URL(value);
   return u.protocol==='https:'&&!u.username&&!u.password&&
    /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com)$/.test(u.hostname.toLowerCase())?u.href:null;
  }catch{return null;}
 };
 const posterFromAd=ad=>{
  const creative=ad?.creative||{},video=Boolean(creative.video_id||
   creative.object_story_spec?.video_data?.video_id||creative.asset_feed_spec?.videos?.length);
  const candidates=video?
   [creative.object_story_spec?.video_data?.image_url,creative.thumbnail_url,
    creative.image_url,creative.object_story_spec?.link_data?.picture]:
   [creative.image_url,creative.object_story_spec?.link_data?.picture,creative.thumbnail_url];
  return candidates.map(mediaUrl).find(Boolean)||null;
 };
 // Replace placeholders instead of appending a tiny second image beside the button.
 const applyPoster=(holder,value,label)=>{
  const url=mediaUrl(value);
  if(!url||!holder?.isConnected)return false;
  let img=holder.querySelector('.px-feature-poster');
  if(!img){
   img=document.createElement('img');img.className='px-feature-poster';
   img.loading='lazy';img.alt=label||'Miniatura do anúncio';
   holder.prepend(img);
  }
  if(img.getAttribute('src')!==url)img.src=url;
  holder.querySelector('.px-feature-no-media')?.remove();
  holder.classList.add('px-has-poster');
  img.addEventListener('error',()=>{
   // Broken signed CDN URL must not leave a misleading miniature.
   holder.classList.remove('px-has-poster');img.remove();
   if(!holder.querySelector('.px-feature-no-media')&&
      !holder.querySelector('video,iframe'))
    holder.insertAdjacentHTML('afterbegin','<div class="px-feature-no-media">Imagem indisponível</div>');
  },{once:true});
  return true;
 };
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
 const kpiIcon=(name)=>globalThis.SocioIcons?.has(name)?globalThis.SocioIcons.svg(name):esc(name);
 const kpi=(label,value,meta,icon='overview',tone='purple')=>'<article class="px-kpi"><div class="px-kpi-top"><span class="px-kpi-label">'+esc(label)+'</span><span class="px-kpi-icon '+tone+'">'+kpiIcon(icon)+'</span></div>'+
  '<strong class="px-kpi-number">'+esc(value)+'</strong><small>'+esc(meta)+'</small></article>';
 const empty=(text)=>'<p class="px-muted">'+esc(text)+'</p>';
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
      '<div class="px-feature-no-media">Carregando capa…</div>')+
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
 async function overview({root,api,me,navigate,periodPreset='7d',periodFrom=null,periodTo=null,progressive=false,
  splitPreset=splitState.preset,splitFrom=splitState.from,splitTo=splitState.to}){
  const renderId=++renderSerial;
  // One period decides every tile on the board: Hoje, 7 dias, Mês atual or a
  // custom range. An incomplete custom range never reaches the server, which
  // would reject it, and never leaves the board showing a window it did not ask
  // for — it simply falls back to the last valid choice.
  const preset=['today','7d','month','custom'].includes(periodPreset)?periodPreset:'7d';
  const isDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
  const customOk=preset==='custom'&&isDay(periodFrom)&&isDay(periodTo)&&periodFrom<=periodTo;
  const activePreset=preset==='custom'&&!customOk?'7d':preset;
  const windowFrom=customOk?periodFrom:null,windowTo=customOk?periodTo:null;
  const periodQuery='preset='+activePreset+(activePreset==='custom'?
   '&from='+encodeURIComponent(windowFrom)+'&to='+encodeURIComponent(windowTo):'');
  // Re-renders keep the owner's choice, including raw dates of a half-filled form.
  const keepPeriod={periodPreset:preset,periodFrom,periodTo};
  forTenant(me);
  if(!root.querySelector('.px-overview'))setPreview(root,'overview');
  const ads=can(me,'marketing.read');
  // Google Ads may not yet have project OAuth or a selected customer.
  // Its campaigns route returns 503 when disabled: don't poll it every 30s.
  const googleOverview=async()=>{
   const status=await cached(api,'/api/google-ads/status',60000);
   if(status?.ok!==true||status?.data?.configured!==true||
      status?.data?.connected!==true||!status?.data?.selectedCustomerId)
    return {ok:false,data:null,skipped:'google_not_connected'};
   return cached(api,'/api/google-ads/campaigns?period=today',60000);
  };
  // Revenue has its own endpoint so a company without the Meta Ads module still
  // sees what it sold. It is an own-database read, fast enough for the first paint.
  const revenueCall=cached(api,'/api/dashboard/revenue',30000);
  const periodCall=cached(api,'/api/dashboard/period?'+periodQuery,20000);
  const campaignPeriodCall=ads?periodCall.then(result=>{
   const span=result?.ok===true?result.data?.period:null;
   if(!isDay(span?.from)||!isDay(span?.to))return {ok:false};
   return cached(api,'/api/marketing/tools/insights?since='+encodeURIComponent(span.from)+
    '&until='+encodeURIComponent(span.to),16000);
  }):Promise.resolve({ok:false});
  // The spend breakdown carries its own period control, so it resolves its own
  // window. When both controls point at the same window the cache serves one read.
  const splitOk=['today','7d','month','custom'].includes(splitPreset)?splitPreset:'month';
  const splitCustomOk=splitOk==='custom'&&isDay(splitFrom)&&isDay(splitTo)&&splitFrom<=splitTo;
  const splitActive=splitOk==='custom'&&!splitCustomOk?'month':splitOk;
  const splitQuery='preset='+splitActive+(splitActive==='custom'?
   '&from='+encodeURIComponent(splitFrom)+'&to='+encodeURIComponent(splitTo):'');
  const splitPeriodCall=cached(api,'/api/dashboard/period?'+splitQuery,20000);
  const splitSpendCall=splitPeriodCall.then(splitPeriod=>{
   const span=splitPeriod?.ok===true?splitPeriod.data?.period:null;
   const from=span?.from||(splitActive==='custom'?splitFrom:null);
   const to=span?.to||(splitActive==='custom'?splitTo:null);
   if(!isDay(from)||!isDay(to))return {ok:false,period:null,data:null};
   if(!ads)return {ok:false,period:span,data:null};
   return cached(api,'/api/marketing/tools/insights?since='+encodeURIComponent(from)+
    '&until='+encodeURIComponent(to),16000).then(insights=>({
     ok:insights?.ok===true,data:insights?.data||null,reason:insights?.reason||'',
     period:span||{from,to}
    }));
  });
  // The last customer messages the assistant answered come from the inbox module.
  const inboxCall=can(me,'inbox.read')?
   cached(api,'/api/inbox/v2',20000).catch(()=>({data:null,ok:false})):Promise.resolve({data:null,ok:false});
  const calls=[
   ads?loadMeta(api,'today').catch(()=>null):Promise.resolve(null),
   ads?cached(api,'/api/marketing/traffic?limit=12',30000):Promise.resolve({ok:false}),
  ];
  // First paint: the own-company revenue window renders at once; Meta answers
  // separately (sometimes >2 seconds). The second paint reuses the already
  // settled request cache, never new requests.
  const later=progressive&&ads?Promise.all(calls):null;
  const skip=()=>Promise.resolve({ok:false});
  const base=progressive?[Promise.resolve(null),...calls.slice(1).map(skip)]:calls;
  const [results,revenue,period,splitSpend,inbox,campaignPeriod]=await Promise.all([Promise.all(base),revenueCall,periodCall,
   progressive?Promise.resolve({ok:false}):splitSpendCall,inboxCall,
   progressive?Promise.resolve({ok:false}):campaignPeriodCall]);
  const [meta,traffic]=results;
  if(renderId!==renderSerial)return;
  const rev=revenue?.ok===true?revenue.data:null;
  const metaReady=meta?.insights.ok===true;
  // Everything below answers the same window the owner picked. When an endpoint
  // fails the tile says so instead of showing a number from another period.
  const periodData=period?.ok===true?period.data:null;
  const periodConversations=periodData?.conversations||null;
  const periodSales=periodData?.sales??null;
  const splitRows=splitSpend?.ok===true&&Array.isArray(splitSpend.data?.items)?splitSpend.data.items:[];
  const splitSpendValue=splitRows.reduce((sum,x)=>sum+(Number(x.spend)||0),0);
  const splitClicks=splitRows.reduce((sum,x)=>sum+(Number(x.clicks)||0),0);
  const purchasesFor=row=>{
   if(Number.isFinite(Number(row.purchases))&&row.purchases!=null)return Number(row.purchases);
   const actions=Array.isArray(row.actions)?row.actions:[];
   // Meta can include the same purchase under overlapping aliases. Prefer the
   // aggregate count, then the website count, rather than counting it twice.
   for(const kind of ['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase']){
    const action=actions.find(item=>item.action_type===kind);
    if(action)return Number(action.value)||0;
   }
   return 0;
  };
  const splitPurchases=splitRows.reduce((sum,x)=>sum+purchasesFor(x),0);
  const splitPeriodSpan=splitSpend?.period||null;
  const conversations=inbox?.ok===true&&Array.isArray(inbox.data?.conversations)?
   inbox.data.conversations.filter(item=>item.channel_provider!=='instagram'&&item.handling_mode==='ai_assist')
    .sort((a,b)=>(Date.parse(b.last_message_at)||0)-(Date.parse(a.last_message_at)||0)):[];
  const campaignMetrics=campaignPeriod?.ok&&Array.isArray(campaignPeriod.data?.items)?campaignPeriod.data.items:[];
  const campaignPurchases=campaignMetrics.filter(item=>purchasesFor(item)>0);
  const rankedCampaign=campaignPurchases.length?
   campaignPurchases.slice().sort((a,b)=>(Number(a.spend)||0)/purchasesFor(a)-
    (Number(b.spend)||0)/purchasesFor(b))[0]:
   campaignMetrics.filter(item=>Number(item.clicks)>0).sort((a,b)=>Number(b.clicks)-Number(a.clicks))[0];
  const bestCampaign=rankedCampaign||meta?.list?.find(c=>(c.effective_status||c.status)==='ACTIVE')||null;
  const bestCampaignId=String(bestCampaign?.campaign_id||bestCampaign?.id||'');
  const featuredAds=meta?.adList?.filter(ad=>String(ad.campaign_id||'')===bestCampaignId)||[];
  const featuredAd=featuredAds.find(ad=>(ad.effective_status||ad.status)==='ACTIVE')||featuredAds[0]||null;
  const featuredThumb=posterFromAd(featuredAd);
  const featuredIsRanked=Boolean(rankedCampaign);
  const trafficLabels={pause:'Pausar anúncio',scale:'Aumentar orçamento',broaden_audience:'Ampliar público',duplicate_campaign:'Duplicar campanha',hold:'Sem ação'};
  const trafficStatusLabels={awaiting_approval:'Aguardando aprovação',executing:'Aplicando',done:'Aplicado',failed:'Falhou',skipped:'Ignorado'};
  const trafficPending=traffic?.ok&&Array.isArray(traffic.data?.items)?
   traffic.data.items.filter(item=>item.status==='awaiting_approval').length:0;
  // The recommendation rail on the right of the overview: everything Sócio asked
  // and everything it already did. Pending items breathe slowly; answered ones
  // are grey and quiet, so the eye goes to what still needs a decision.
  const recAnswerLabel={done:'Aplicado',failed:'Falhou',skipped:'Ignorado',dismissed:'Recusado',
   executing:'Aplicando'};
  // Each recommendation is one card in the stack; answering it animates the card
  // out and the next one moves forward.
  const recCard=item=>{
   const pending=item.status==='awaiting_approval';
   const state=pending?'is-pending':(item.status==='done'?'is-done':'is-muted');
   const status=pending?'Aguardando você':(recAnswerLabel[item.status]||trafficStatusLabels[item.status]||item.status||'');
   return '<article class="ov-rec et-rec '+state+'" data-rec-id="'+esc(item.id)+'"'+
    (item.explanation?' title="'+esc(item.explanation)+'"':'')+'>'+
    '<div class="et-rec-top"><span class="et-rec-kind">'+esc(trafficLabels[item.action]||item.action||'Ajuste')+'</span>'+
     '<span class="ov-rec-status et-rec-when">'+esc(status)+'</span></div>'+
    '<p class="et-rec-title ov-rec-question">'+esc(item.question||item.reason||item.explanation||'Ajuste na campanha')+'</p>'+
    (item.explanation?'<ul class="et-rec-facts"><li class="ov-rec-detail">'+esc(item.explanation)+'</li></ul>':'')+
    (pending?'<div class="et-rec-actions ov-rec-actions" role="group" aria-label="Responder recomendação">'+
      '<button type="button" class="et-btn primary" data-rec-answer="approve">Aprovar</button>'+
      '<button type="button" class="et-btn ghost" data-rec-answer="dismiss">Recusar</button>'+
      '<button type="button" class="et-btn ghost" data-rec-other>Outro valor</button></div>'+
     '<div class="ov-rec-amount" hidden><input type="text" inputmode="decimal" maxlength="12" '+
      'placeholder="Valor diário em reais" aria-label="Valor diário em reais" value="'+
      (item.targetBudgetCents?(item.targetBudgetCents/100).toFixed(2).replace('.',','):'')+'">'+
      '<button type="button" class="et-btn primary" data-rec-apply>Aplicar</button></div>':'')+
    '<p class="ov-rec-note" role="status" aria-live="polite" hidden></p></article>';
  };
  const trafficList=traffic?.ok&&Array.isArray(traffic.data?.items)?traffic.data.items:[];
  const pendingItems=trafficList.filter(item=>item.status==='awaiting_approval').slice(0,3);
  const trafficRail='<div class="et-stack">'+
    (traffic?.ok?
     (pendingItems.length?pendingItems.map(recCard).join(''):
      '<p class="ov-rail-empty">Nada para decidir agora. O Sócio revisa as campanhas a cada 6 horas.</p>'):
     '<p class="ov-rail-empty">'+esc(traffic?.reason||'Recomendações indisponíveis agora.')+'</p>')+
   '</div>';
  // Every revenue number comes from a sale the owner confirmed himself —
  // nothing is projected or inferred from conversations.
  const brl=cents=>money(Number(cents||0)/100,'BRL');
  const dayLabel=value=>value?value.slice(8,10)+'/'+value.slice(5,7):'';
  const compactMoney=cents=>{
   const value=Number(cents||0)/100;
   if(value>=1e6)return 'R$ '+(value/1e6).toFixed(1).replace('.',',')+' mi';
   if(value>=1e3)return 'R$ '+(value>=1e4?Math.round(value/1e3):(value/1e3).toFixed(1).replace('.',','))+' mil';
   return 'R$ '+Math.round(value);
  };
  // One control decides the window for the whole board, so the owner reads a
  // single period instead of guessing which filter each panel is obeying.
  const presetNames={today:'Hoje','7d':'Últimos 7 dias',month:'Mês atual',custom:'Personalizado'};
  const periodWindow=periodData?.period||null;
  const periodName=periodWindow?
   (activePreset==='custom'?dayLabel(periodWindow.from)+' a '+dayLabel(periodWindow.to):
    presetNames[activePreset]):presetNames[activePreset];
  const previousName=periodWindow?
   dayLabel(periodWindow.previousFrom)+' a '+dayLabel(periodWindow.previousTo):'';
  const deltaPill=(current,previous)=>{
   if(current==null||previous==null)return '';
   const title=' title="Versus '+esc(previousName||'o período anterior')+'"';
   if(previous===0)return current===0?
    '<span class="ov-rev-pill flat"'+title+'>0%</span>':
    '<span class="ov-rev-pill up"'+title+'>novo</span>';
   const change=Math.round((current-previous)/previous*100);
   return '<span class="ov-rev-pill '+(change>0?'up':change<0?'down':'flat')+'"'+title+'>'+
    (change>0?'▲':change<0?'▼':'—')+' '+number(Math.abs(change))+'%</span>';
  };
  const monthShort=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const draft=periodDraft?.open?periodDraft:null;
  const formOpen=preset==='custom'||!!draft;
  const fromValue=draft?draft.from:isDay(periodFrom)?periodFrom:(isDay(periodWindow?.from)?periodWindow.from:'');
  const toValue=draft?draft.to:isDay(periodTo)?periodTo:(isDay(periodWindow?.to)?periodWindow.to:'');
  const todayStamp=(()=>{
   try{return new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});}
   catch{return '';}
  })();
  const heroCents=periodSales?Number(periodSales.revenueCents)||0:null;
  const heroSales=periodSales?Number(periodSales.confirmed)||0:null;
  const heroDelta=periodSales?deltaPill(heroCents,Number(periodSales.previousRevenueCents)||0):'';
  // The hero's four choices are the dashboard's single window; leads and money
  // below answer the same one.
  const periodSeg=on=>'<div class="et-pills" role="group" aria-label="Período do faturamento">'+
   [['today','Hoje'],['7d','Últimos 7 dias'],['month','Esse mês']].map(([value,label])=>
    '<button type="button" class="et-pill'+(activePreset===value?' on':'')+'"'+
    ' data-period-preset="'+value+'" aria-pressed="'+(activePreset===value)+'">'+label+'</button>').join('')+
   '<button type="button" class="et-pill'+(activePreset==='custom'?' on':'')+'" data-period-custom aria-expanded="'+on+'">'+
   'Personalizado</button></div>';
  const heroAmount=heroCents==null?'—':new Intl.NumberFormat('pt-BR',
   {minimumFractionDigits:2,maximumFractionDigits:2}).format(heroCents/100);
  const hero='<section class="et-hero" aria-label="Faturamento total">'+
   '<span class="et-hero-mark" aria-hidden="true">R$</span>'+
   '<div class="et-hero-head"><span class="et-hero-label">Faturamento total</span></div>'+
   '<div class="et-hero-value"><strong><sup>R$</sup>'+heroAmount+'</strong>'+
    '<span class="et-hero-sales">'+(heroSales==null?'—':number(heroSales))+
     ' venda'+(heroSales===1?'':'s')+'</span>'+(heroDelta||'')+'</div>'+
   '<p class="et-hero-note">'+esc(periodSales?'Somente vendas confirmadas por você · '+periodName:
     'Somente vendas confirmadas por você')+'</p>'+
   '<div class="et-hero-foot">'+periodSeg(formOpen)+
    '<button type="button" class="et-hero-refresh" data-px-refresh aria-label="Atualizar painel" title="Atualizar painel">'+
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg></button></div>'+
   '<div class="period-fields" '+(formOpen?'':'hidden ')+'data-period-fields>'+
    '<label>De<input type="date" data-period-from value="'+esc(fromValue)+'"'+(todayStamp?' max="'+todayStamp+'"':'')+'></label>'+
    '<label>Até<input type="date" data-period-to value="'+esc(toValue)+'"'+(todayStamp?' max="'+todayStamp+'"':'')+'></label>'+
    '<button type="button" class="btn sm soft" data-period-apply>Aplicar</button>'+
    '<span class="period-hint'+(draft?.error?' is-error':'')+'" data-period-hint role="status">'+
     (draft?.error?esc(draft.error):'')+'</span></div></section>';
  // Leads are conversations the ads brought in, over the same window as revenue.
  const incomeCard='<section class="et-kpi et-income" aria-label="Leads no WhatsApp">'+
   '<div class="et-kpi-head"><span class="et-kpi-label">Leads no WhatsApp</span></div>'+
   '<div class="et-kpi-metric"><strong class="et-kpi-value">'+
    (periodConversations?number(periodConversations.started):'—')+'</strong>'+
    (periodConversations?deltaPill(periodConversations.started,periodConversations.previousStarted):'')+'</div>'+
   '<p class="et-kpi-sub">'+(periodConversations?'no período selecionado':'indisponível agora')+'</p>'+
   '<p class="et-kpi-note">'+(periodConversations?
     '<b>'+number(periodConversations.open)+'</b> conversa(s) em aberto agora':
     'Aguardando o período')+'</p></section>';
  // The expense slot belongs to the campaign that is performing best, because
  // that is the one the owner can act on today.
  const campaignCard='<section class="et-kpi et-kpi-campaign" aria-label="Campanha em destaque">'+
   '<div class="et-kpi-head"><span class="et-kpi-label">Campanha em destaque</span>'+
    '<button type="button" class="et-kpi-link" data-px-marketing>Ver</button></div>'+
   (bestCampaign?'<div class="et-campaign-body">'+
     '<span class="et-campaign-thumb" data-campaign-preview>'+
      posterView(featuredThumb,'Criativo da campanha '+String(bestCampaign.campaign_name||bestCampaign.name||''))+'</span>'+
     '<span class="et-campaign-copy"><strong>'+
      esc(bestCampaign.campaign_name||bestCampaign.name||bestCampaignId)+'</strong></span></div>':
    '<p class="et-muted">Nenhuma campanha encontrada na conta Meta.</p>')+'</section>';
  const flowMonths=Array.isArray(rev?.months)?rev.months:[];
  const flowPeak=Math.max(1,...flowMonths.map(m=>Number(m.revenueCents)||0));
  const flowW=360,flowTop=30,flowBase=170,slot=flowW/(flowMonths.length||6),barW=46;
  const flowPrevious=index=>Number(flowMonths[index-1]?.revenueCents)||0;
  const flowBars=flowMonths.map((month,index)=>{
    const cents=Number(month.revenueCents)||0;
    const height=cents>0?Math.max(8,Math.round(cents/flowPeak*(flowBase-flowTop))):3;
    const x=Math.round(index*slot+(slot-barW)/2);
    const y=flowBase-height;
    const last=index===flowMonths.length-1;
    const label=monthShort[Number(String(month.month).slice(5,7))-1]||String(month.month||'');
    const pillW=Math.max(46,Math.round(compactMoney(cents).length*6.4));
    const pillX=Math.round(x+barW/2-pillW/2);
    const pillY=Math.max(2,y-(last?30:24));
    const previous=flowPrevious(index);
    const change=previous>0?Math.round((cents-previous)/previous*100):null;
    return '<g>'+
     (cents>0?'<rect class="et-chart-pill'+(last?' is-now':'')+'" x="'+pillX+'" y="'+pillY+
      '" width="'+pillW+'" height="19" rx="9.5"/>'+
      '<text class="et-chart-value'+(last?' is-now':'')+'" x="'+(x+barW/2)+'" y="'+(pillY+13)+
      '" text-anchor="middle">'+(last?'+':'')+esc(compactMoney(cents))+'</text>':'')+
     '<rect x="'+x+'" y="'+y+'" width="'+barW+'" height="'+height+'" rx="12'+
     '" fill="url(#'+(last?'etFlowNow':'etFlowPast')+')"><title>'+
     esc(label+' · '+(cents?brl(cents):'sem vendas confirmadas')+
      (change!=null?' · '+(change>0?'+':'')+change+'% no mês anterior':''))+'</title></rect>'+
     '<text class="et-chart-axis" x="'+(x+barW/2)+'" y="'+(flowBase+26)+
      '" text-anchor="middle">'+esc(label)+'</text></g>';
  }).join('');
  const flowCard='<section class="et-card et-flow" aria-label="Fluxo de faturamento">'+
   '<div class="et-card-head"><div><h2 class="et-card-title">Fluxo de faturamento</h2>'+
    '<p class="et-card-sub">Mês atual e os últimos cinco meses</p></div></div>'+
   (flowMonths.length?'<div class="et-chart"><svg viewBox="0 0 360 208" role="img" aria-label="Faturamento dos últimos seis meses">'+
    '<defs><linearGradient id="etFlowPast" x1="0" y1="0" x2="0" y2="1">'+
     '<stop offset="0" stop-color="#a494b8"/><stop offset="1" stop-color="#736184"/></linearGradient>'+
    '<linearGradient id="etFlowNow" x1="0" y1="0" x2="0" y2="1">'+
     '<stop offset="0" stop-color="#e1b5f6"/><stop offset="1" stop-color="#a28bc2"/></linearGradient></defs>'+
    '<line class="et-baseline" x1="0" y1="'+flowBase+'" x2="360" y2="'+flowBase+'"/>'+
    flowBars+'</svg></div>':
    '<div class="et-chart-empty">Nenhuma venda confirmada ainda. O gráfico aparece quando você confirmar o primeiro comprovante.</div>')+'</section>';
  const splitSorted=splitRows.slice().sort((a,b)=>(Number(b.spend)||0)-(Number(a.spend)||0));
  const splitTop=splitSorted.slice(0,5);
  const splitRingTotal=splitTop.reduce((sum,row)=>sum+(Number(row.spend)||0),0)||splitSpendValue;
  const splitPalette=['#f5dc69','#f39bb6','#ad94e1','#9cd7ad','#f5b394'];
  let splitCursor=0;
  const splitArcs=splitTop.length&&splitRingTotal>0?splitTop.map((row,index)=>{
    const share=(Number(row.spend)||0)/splitRingTotal*100;
    const length=Math.max(share-0.9,0.4);
    const arc='<circle cx="100" cy="100" r="76" fill="none" stroke="'+splitPalette[index%5]+
     '" stroke-width="22" pathLength="100" stroke-dasharray="'+length.toFixed(2)+' 100"'+
     ' stroke-dashoffset="'+(-splitCursor).toFixed(2)+'" stroke-linecap="round"><title>'+
     esc(String(row.name||row.campaign_name||row.campaignName||'Campanha')+' · '+
      money(Number(row.spend)||0,meta?.currency))+'</title></circle>';
    splitCursor+=share;
    return arc;
  }).join(''):'<circle cx="100" cy="100" r="76" fill="none" stroke="#ffffff12" stroke-width="22"/>';
  const splitCpc=splitClicks>0?money(splitSpendValue/splitClicks,meta?.currency):'—';
  const splitConversion=splitClicks>0?splitPurchases/splitClicks*100:null;
  const splitWindowName=splitPeriodSpan&&isDay(splitPeriodSpan.from)&&isDay(splitPeriodSpan.to)?
   dayLabel(splitPeriodSpan.from)+' a '+dayLabel(splitPeriodSpan.to):presetNames[splitActive];
  const splitFieldsOpen=splitPreset==='custom';
  const splitLegend=[
   ['Cliques',number(splitClicks),'et-c1'],
   ['Custo por clique',splitCpc,'et-c2'],
   ['Campanhas ativas',metaReady?number(meta.activeCampaigns):'—','et-c3'],
   ['Taxa de conversão',splitConversion==null?'—':splitConversion.toFixed(2).replace('.',',')+'%','et-c4']
  ].map(([label,value,tone])=>'<li><i class="et-swatch '+tone+'"></i><span class="et-legend-label">'+
   esc(label)+'</span><span class="et-legend-value">'+value+'</span></li>').join('');
  const splitPicker='<div class="et-seg et-seg-dark" role="group" aria-label="Período do gasto">'+
   [['today','Hoje'],['7d','7 dias'],['month','Esse mês']].map(([value,label])=>
    '<button type="button" data-split-preset="'+value+'" aria-pressed="'+(splitActive===value)+'"'+
    ' class="'+(splitActive===value?'on':'')+'">'+label+'</button>').join('')+
   '<button type="button" data-split-custom aria-expanded="'+splitFieldsOpen+'"'+
   ' class="'+(splitActive==='custom'?'on':'')+'">Personalizado</button></div>';
  const splitCard='<section class="et-card et-expense-split" aria-label="Métricas de anúncios">'+
   '<div class="et-card-head"><div><h2 class="et-card-title">Métricas de anúncios</h2>'+
    '<p class="et-card-sub">Meta Ads · investimento por campanha</p></div>'+splitPicker+'</div>'+
   '<div class="et-split-fields" '+(splitFieldsOpen?'':'hidden ')+'data-split-fields>'+
    '<label>De<input type="date" data-split-from value="'+esc(isDay(splitFrom)?splitFrom:fromValue)+'"'+
     (todayStamp?' max="'+todayStamp+'"':'')+'></label>'+
    '<label>Até<input type="date" data-split-to value="'+esc(isDay(splitTo)?splitTo:toValue)+'"'+
     (todayStamp?' max="'+todayStamp+'"':'')+'></label>'+
    '<button type="button" class="btn sm soft" data-split-apply>Aplicar</button>'+
    '<span class="period-hint" data-split-hint role="status"></span></div>'+
   '<div class="et-split">'+
    '<div class="et-donut"><svg viewBox="0 0 200 200" role="img" aria-label="Investimento por campanha">'+
     '<g transform="rotate(-90 100 100)">'+splitArcs+'</g>'+
     '<text class="et-donut-label" x="100" y="88" text-anchor="middle">Total</text>'+
     '<text class="et-donut-center" x="100" y="111" text-anchor="middle">'+
      esc(splitSpendValue>0?money(splitSpendValue,meta?.currency):'—')+'</text>'+
     '<text class="et-donut-center-sub" x="100" y="130" text-anchor="middle">'+
      esc(splitSpendValue>0?splitWindowName.toUpperCase():'SEM INVESTIMENTO')+'</text></svg></div>'+
    '<ul class="et-legend">'+splitLegend+'</ul></div>'+
   (splitSpend?.ok?'':'<p class="et-muted">A Meta não respondeu agora. O valor volta na próxima leitura.</p>')+
   '</section>';
  const conversationsCard='<section class="et-block et-subs" aria-label="Conversas no WhatsApp">'+
   '<div class="et-block-head"><h2>Conversas no WhatsApp</h2>'+
    (conversations.length?'<span class="et-block-count">'+number(conversations.length)+'</span>':'')+
    '<button type="button" class="et-block-link" data-px-inbox>Ver todas <span aria-hidden="true">›</span></button></div>'+
   // A fileira de avatares é a marca da referência: pessoas reais desta empresa.
   (conversations.length?'<div class="et-subs-icons">'+conversations.slice(0,5).map(item=>{
     const name=String(item.customer_name||item.customer_phone||'Cliente');
     return '<span class="et-subs-icon" title="'+esc(name)+'" aria-hidden="true">'+
      esc(name.charAt(0).toUpperCase()||'C')+'</span>';
    }).join('')+'</div>':'')+
   (conversations.length?'<div class="et-subs-list">'+conversations.slice(0,4).map(item=>{
     const name=String(item.customer_name||item.customer_phone||'Cliente');
     const raw=item.last_message;
     const preview=typeof raw==='string'?raw:(raw&&typeof raw==='object'?
      String(raw.body||raw.text||raw.preview||''):'');
     return '<div class="et-sub-row"><span class="et-sub-avatar">'+
      esc(name.charAt(0).toUpperCase()||'C')+'</span>'+
      '<div class="et-sub-copy"><strong>'+esc(name)+'</strong><small>'+
      esc(preview.slice(0,64)||'Sem mensagens ainda')+'</small></div>'+
      (item.handling_mode==='ai_assist'?'<span class="et-tag active">IA</span>':'')+
      '<button type="button" class="et-open" data-open-conversation="'+esc(item.id)+'">Abrir</button></div>';
    }).join('')+'</div>':'<div class="et-stack-empty">Nenhuma conversa ainda. Conecte um WhatsApp para começar.</div>')+'</section>';
  const recsBlock='<section class="et-block et-recs" aria-label="Recomendações">'+
   '<div class="et-block-head"><h2>Recomendações</h2>'+
    (trafficPending?'<span class="et-block-count">'+number(trafficPending)+'</span>':'')+
    '<button type="button" class="et-block-link" data-px-traffic-review>Analisar</button></div>'+
   trafficRail+
   '<span class="ov-rail-feedback et-block-feedback" data-px-traffic-feedback role="status" aria-live="polite"></span></section>';
  root.innerHTML='<div class="px-workspace px-overview et-board">'+
   '<h1 class="et-title">Visão geral</h1>'+
   '<div class="et-board-grid">'+
    hero+
    incomeCard+
    campaignCard+
    recsBlock+
    flowCard+
    splitCard+
    conversationsCard+
   '</div>'+
   '<p class="px-live-indicator"><span class="px-live-dot"></span>'+(progressive?'Indicadores da empresa disponíveis · consultando anúncios em segundo plano':'Atualização automática a cada 60 segundos · indicadores retornados pelos provedores')+'</p>'+
   '<p class="px-provenance">Indicadores consolidados por empresa. Métricas publicitárias dependem das permissões das contas autorizadas; conversões atribuídas por anúncios não são comprovantes de pagamento. Nenhum número indisponível é substituído por uma estimativa.</p>'+
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

  // Give the first paint a readable count-up instead of a sudden jump.
  const animateBoardValues=()=>{
   const nodes=root.querySelectorAll('.et-hero-value strong,.et-kpi-value,.et-legend-value,.et-donut-center');
   nodes.forEach(node=>{
    if(node.dataset.countAnimated)return;
    const text=node.textContent||'';
    const match=text.match(/^(.*?)([\d.,]+)([^\d]*)$/);
    if(!match)return;
    const raw=Number(match[2].replace(/\./g,'').replace(',','.'));
    if(!Number.isFinite(raw)||raw===0)return;
    node.dataset.countAnimated='true';
    const prefix=match[1],suffix=match[3],decimals=(match[2].split(',')[1]||'').length;
    const start=performance.now(),duration=720;
    const tick=now=>{
     const p=Math.min(1,(now-start)/duration), eased=1-Math.pow(1-p,3);
     const value=(raw*eased).toLocaleString('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
     node.textContent=prefix+value+suffix;
     if(p<1)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
   });
  };
  animateBoardValues();

  // One period control owns every number on the board. A preset repaints at
  // once with the own-database reads and lets Meta arrive in the second paint;
  // a custom range only goes out when both dates are real and in order.
  const rerender=next=>overview({root,api,me,navigate,...next,progressive:true});
  root.querySelectorAll('[data-period-preset]').forEach(button=>button.addEventListener('click',()=>{
   const value=button.dataset.periodPreset;
   if(value===activePreset)return;
   periodDraft=null;
   rerender({periodPreset:value,periodFrom:null,periodTo:null});
  }));
  const periodFields=root.querySelector('[data-period-fields]');
  const periodHint=root.querySelector('[data-period-hint]');
  const readDraft=()=>({open:true,
   from:String(periodFields?.querySelector('[data-period-from]')?.value||''),
   to:String(periodFields?.querySelector('[data-period-to]')?.value||'')});
  root.querySelector('[data-period-custom]')?.addEventListener('click',()=>{
   if(!periodFields)return;
   periodFields.hidden=!periodFields.hidden;
   periodDraft=periodFields.hidden?null:readDraft();
   root.querySelector('[data-period-custom]')?.setAttribute('aria-expanded',String(!periodFields.hidden));
   if(!periodFields.hidden)periodFields.querySelector('[data-period-from]')?.focus();
  });
  ['[data-period-from]','[data-period-to]'].forEach(selector=>{
   periodFields?.querySelector(selector)?.addEventListener('input',()=>{
    if(periodDraft)periodDraft={...readDraft(),error:''};
   });
  });
  root.querySelector('[data-period-apply]')?.addEventListener('click',()=>{
   const from=String(periodFields?.querySelector('[data-period-from]')?.value||'');
   const to=String(periodFields?.querySelector('[data-period-to]')?.value||'');
   const fail=text=>{
    periodDraft={...readDraft(),error:text};
    if(!periodHint)return;
    periodHint.textContent=text;
    periodHint.classList.add('is-error');
   };
   if(!isDay(from)||!isDay(to))return fail('Escolha a data inicial e a final.');
   if(from>to)return fail('A data inicial precisa vir antes da data final.');
   periodDraft=null;
   rerender({periodPreset:'custom',periodFrom:from,periodTo:to});
  });
  const trafficFeedback=root.querySelector('[data-px-traffic-feedback]');
  root.querySelector('[data-px-traffic-review]')?.addEventListener('click',async()=>{
   if(!trafficFeedback)return;
   trafficFeedback.textContent='Analisando campanhas…';
   try{
    const result=await api('/api/marketing/traffic/preview');
    trafficFeedback.textContent=result.report||((result.actions||[]).length?
     result.actions.length+' decisão(ões) encontradas.':'Nenhum ajuste necessário com a amostra atual.');
   }catch(error){trafficFeedback.textContent=String(error?.message||'Não foi possível analisar agora.');}
  });
  // Answer a recommendation from the rail itself, with the same three choices
  // the pop-up and the WhatsApp question offer.
  const centsFrom=value=>{
   const clean=String(value||'').replace(/[^\d.,]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');
   const amount=Number(clean);
   return Number.isFinite(amount)?Math.round(amount*100):NaN;
  };
  root.querySelectorAll('.ov-rec[data-rec-id]').forEach(card=>{
   const note=card.querySelector('.ov-rec-note');
   const say=(text,error=false)=>{
    if(!note)return;
    note.hidden=!text;note.textContent=text;note.classList.toggle('is-error',!!error);
   };
   const buttons=[...card.querySelectorAll('button')];
   const answer=async payload=>{
    buttons.forEach(button=>{button.disabled=true;});
    try{
     const result=await api('/api/marketing/traffic/decision','POST',{id:card.dataset.recId,...payload});
     card.classList.remove('is-pending','is-muted');card.classList.add('is-done','is-out');
     say(result?.dismissed?'Tudo bem. Não mexi na campanha.':'Feito. Mudança aplicada.');
     getCache.clear();
     // Let the answered card slide out before the next one moves forward.
     setTimeout(()=>{
      if(renderId!==renderSerial||!root.isConnected||!root.querySelector('.px-overview'))return;
      void overview({root,api,me,navigate,...keepPeriod});
     },900);
    }catch(error){
     buttons.forEach(button=>{button.disabled=false;});
     say('Não consegui aplicar: '+String(error?.message||'tente novamente.'),true);
    }
   };
   card.querySelectorAll('[data-rec-answer]').forEach(button=>button.addEventListener('click',()=>
    answer({resolution:button.dataset.recAnswer})));
   card.querySelector('[data-rec-other]')?.addEventListener('click',event=>{
    const amount=card.querySelector('.ov-rec-amount');
    if(amount)amount.hidden=false;
    amount?.querySelector('input')?.focus();
    event.currentTarget.hidden=true;
   });
   card.querySelector('[data-rec-apply]')?.addEventListener('click',()=>{
    const cents=centsFrom(card.querySelector('.ov-rec-amount input')?.value);
    if(!Number.isFinite(cents)||cents<100){say('Informe um valor diário válido em reais (ex.: 10).',true);return;}
    answer({resolution:'approve',targetBudgetCents:cents});
   });
  });

  if(progressive&&ads){
   // Never hold up the dashboard for an ad provider. If the visitor switches
   // pages meanwhile, renderSerial stops the stale secondary paint.
   void later.then(()=>{
    if(renderId!==renderSerial||!root.isConnected||!root.querySelector('.px-overview'))return;
    return overview({root,api,me,navigate,...keepPeriod,progressive:false});
   }).catch(()=>{});
  }else startLiveRefresh(root,'overview',renderId,
   ()=>overview({root,api,me,navigate,...keepPeriod}),
   // Every number on the board answers the chosen window, so a live refresh
   // repaints the board instead of patching individual elements: a late
   // provider never writes a figure into a tile it does not own.
   async()=>{
    getCache.clear();
    await overview({root,api,me,navigate,...keepPeriod,progressive:false});
   });
  // The spend card owns its own window, so its control never touches the
  // headline period. The choice lives in module state and survives a repaint.
  const splitFields=root.querySelector('[data-split-fields]');
  const splitHint=root.querySelector('[data-split-hint]');
  root.querySelectorAll('[data-split-preset]').forEach(button=>button.addEventListener('click',()=>{
   const value=button.dataset.splitPreset;
   if(value===splitState.preset)return;
   splitState.preset=value;splitState.from=null;splitState.to=null;
   rerender(keepPeriod);
  }));
  root.querySelector('[data-split-custom]')?.addEventListener('click',()=>{
   if(!splitFields)return;
   splitFields.hidden=!splitFields.hidden;
   // Opening the date fields changes nothing yet; closing them restores the
   // last applied window, so no state is written before Aplicar.
   if(splitFields.hidden){
    if(splitState.preset==='custom'){splitState.preset='month';splitState.from=null;splitState.to=null;}
    rerender(keepPeriod);
   }else splitFields.querySelector('[data-split-from]')?.focus();
  });
  root.querySelector('[data-split-apply]')?.addEventListener('click',()=>{
   const from=String(splitFields?.querySelector('[data-split-from]')?.value||'');
   const to=String(splitFields?.querySelector('[data-split-to]')?.value||'');
   const fail=text=>{
    if(!splitHint)return;
    splitHint.textContent=text;
    splitHint.classList.add('is-error');
   };
   if(!isDay(from)||!isDay(to))return fail('Escolha a data inicial e a final.');
   if(from>to)return fail('A data inicial precisa vir antes da data final.');
   splitState.preset='custom';splitState.from=from;splitState.to=to;
   rerender(keepPeriod);
  });
  // A refresh circle sits next to the period pills, like the reference's "+".
  root.querySelector('[data-px-refresh]')?.addEventListener('click',()=>{
   getCache.clear();
   void overview({root,api,me,navigate,...keepPeriod,progressive:true});
  });
  root.querySelectorAll('[data-open-conversation]').forEach(button=>button.addEventListener('click',()=>
   navigate('inbox',button.dataset.openConversation)));
  root.querySelector('[data-px-inbox]')?.addEventListener('click',()=>navigate('inbox'));
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
   '<p class="px-live-indicator" aria-live="off"><span class="px-live-dot"></span>Atualização automática a cada 60 segundos · dados retornados pela Meta</p>'+
   '<div class="px-marketing-filters" role="group" aria-label="Período dos anúncios">'+
     [['today','Hoje'],['last_7d','7 dias'],['last_30d','30 dias']].map(([v,l])=>
       '<button type="button" class="'+(period===v?'selected':'')+'" data-px-period="'+v+'" aria-pressed="'+(period===v)+'">'+l+'</button>').join('')+'</div>'+
   '<div class="px-kpi-grid px-marketing-kpi">'+
    kpi('Investimento',hasData?money(data.spend,currency):'—','Período selecionado','money','green')+
    kpi('Cliques',hasData?number(data.clicks):'—','Contados pela Meta','clicks','blue')+
    kpi('CPC',hasData&&data.clicks?money(data.spend/data.clicks,currency):'—','Gasto ÷ cliques','trend','sky')+
    kpi('CPA atribuído',hasData&&data.purchases?money(data.spend/data.purchases,currency):'—','Evento Purchase · não receita','target')+
    kpi('Campanhas ativas',data?.campaigns.ok?number(data.activeCampaigns):'—','Situação atual da Meta','campaigns','indigo')+
    kpi('Anúncios ativos',data?.ads.ok?number(data.activeAds):'—','Situação atual dos anúncios','ads','teal')+
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
   (!selectedCampaign?section('Anúncio em destaque','Comparação de resultados na mesma conta e período',
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
    empty(data?.adInsights.ok?'Sem anúncios com métricas suficientes no período.':'Relatório por anúncio indisponível nesta conta.')):'')+
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
  if(selectedAdset&&visibleAds.length){
   // Only visible cards fetch private, verified ad media. IntersectionObserver
   // avoids bulk Graph calls for long campaigns; a short fallback covers old UAs.
   const accountId=String(data?.status?.data?.selectedAccount?.id||'');
   const byId=new Map(visibleAds.map(ad=>[String(ad.id),ad]));
   const queue=[];let active=0;
   const hydrate=async(holder,ad)=>{
    if(!holder?.isConnected||renderId!==renderSerial)return;
    const cacheKey=[selectedTenant,accountId,ad.id].join(':');
    const saved=posterCache.get(cacheKey);
    let poster=saved&&Date.now()-saved.at<180000?saved.poster:null;
    if(!poster){
     const result=await cached(api,'/api/marketing/tools/ad-media?adId='+
      encodeURIComponent(ad.id)+'&posterOnly=1',60000);
     poster=mediaUrl(result.data?.posterUrl)||mediaUrl(result.data?.thumbnailUrl);
     if(poster)posterCache.set(cacheKey,{at:Date.now(),poster});
    }
    if(renderId!==renderSerial||!holder.isConnected)return;
    if(poster)applyPoster(holder,poster,'Miniatura de '+String(ad.name||'anúncio'));
    else{
     const placeholder=holder.querySelector('.px-feature-no-media');
     if(placeholder)placeholder.textContent='Sem miniatura';
    }
   };
   const run=()=>{
    while(queue.length&&active<3){
     const [holder,ad]=queue.shift();active++;
     Promise.resolve(hydrate(holder,ad)).catch(()=>{
      if(holder.isConnected){
       const label=holder.querySelector('.px-feature-no-media');
       if(label)label.textContent='Miniatura indisponível';
      }
     }).finally(()=>{active--;run();});
    }
   };
   const enqueue=(holder)=>{
    const id=holder?.dataset?.pxAdMedia,ad=byId.get(String(id));
    if(!ad||!/^\d{4,30}$/.test(String(id)))return;
    queue.push([holder,ad]);run();
   };
   const holders=[...root.querySelectorAll('.px-ad-creative-media[data-px-ad-media]')];
   if(typeof IntersectionObserver==='function'){
    const observer=new IntersectionObserver(entries=>{
     entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      observer.unobserve(entry.target);enqueue(entry.target);
     });
     if(renderId!==renderSerial)observer.disconnect();
    },{rootMargin:'420px 0px'});
    holders.forEach(holder=>observer.observe(holder));
   }else holders.slice(0,30).forEach(enqueue);
  }
  if(!selectedCampaign&&data?.bestAd?.id){
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
    const poster=mediaUrl(media.posterUrl)||mediaUrl(media.thumbnailUrl)||bestThumbnail;
    if(poster)applyPoster(holder,poster,'Miniatura do anúncio '+adName);
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
    const video=mediaUrl(result.videoUrl),poster=mediaUrl(result.posterUrl)||mediaUrl(result.thumbnailUrl)||bestThumbnail;
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
     const poster=mediaUrl(media.posterUrl)||mediaUrl(media.thumbnailUrl);if(poster)player.poster=poster;
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
     const poster=mediaUrl(media.posterUrl)||mediaUrl(media.thumbnailUrl);
     if(poster)applyPoster(holder,poster,'Imagem do anúncio '+name);
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
   can(me,'marketing.read')&&googleAdsVisible()?cached(api,'/api/google-ads/status',20000):Promise.resolve({ok:false,data:null}),
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
   (googleAdsVisible()?'<section class="px-conn-card"><div class="px-conn-head"><span class="px-conn-icon google">G</span><div><h2>Google Ads</h2><p>Autorização pela conta Google</p></div><span class="px-status '+(googleConnected?'on':'off')+'">'+(googleConnected?'Autorizado':'Pendente')+'</span></div>'+
    '<div class="px-conn-list"><p class="px-muted">'+(googleSelected?'Conta Google Ads: <strong>'+esc(googleSelected)+'</strong>':
       googleConnected?'Autorizada, aguardando seleção da conta.':'Nenhuma conta Google Ads conectada.')+'</p>'+
      (googleConnected?'<label class="px-account-select">Conta Google Ads<select id="pxGoogleAccount"><option value="">Carregando contas…</option></select></label>':'')+
      '<p class="px-muted">Leitura de campanhas; criação de anúncios Google ainda não habilitada.</p></div>'+
    '<div class="px-conn-actions">'+connectBtn(googleConnected?'Reconectar Google':'Conectar com Google','data-px-google',manageAds&&google.data?.configured!==false)+
      (googleConnected?connectBtn('Usar conta selecionada','data-px-google-select',manageAds):'')+'</div></section>':'')+
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
  if(googleAdsVisible())root.querySelector('[data-px-google]')?.addEventListener('click',async ev=>{
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
  if(googleAdsVisible()&&googleConnected){
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
