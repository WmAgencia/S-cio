
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const state={me:null,view:'overview',dashboard:null,csrf:'',currentConversation:null,workspace:'production',aiTab:'training',catalogSearch:'',catalogStock:'all'};
const googleAdsVisible=()=>globalThis.SocioProductFeatures?.googleAdsVisible===true;
const featureLabels={whatsapp:'Atendimento WhatsApp',catalog:'Produtos e serviços',meta_ads:'Meta Ads',ai:'Inteligência Artificial',team:'Equipe'};
const featureView={inbox:'whatsapp',products:'catalog',marketing:'meta_ads',training:'ai',team:'team'};
const featureKeys=Object.keys(featureLabels);
const featuresEnabled=()=>state.me?.tenant?.features||{};
const featureAvailable=key=>featuresEnabled()[key]!==false;
const ownAccountAvailable=()=>!!state.me?.user?.platformOwner||(state.me?.user?.permissions||[]).includes('account.manage');
const isPrimaryMaster=()=>!!(state.me?.user?.platformOwner&&state.me?.user?.homeTenantId);
const masterViews=new Set(['masterOverview','admin','masterPlans']);
const isMasterView=()=>isPrimaryMaster()&&state.workspace==='master';
const workspaceRoutes={dashboard:'masterOverview',companies:'admin',plans:'masterPlans'};
const workspaceSections={masterOverview:'dashboard',admin:'companies',masterPlans:'plans'};
function workspaceUrl(mode,section){
 const url=new URL(typeof location==='object'&&location?.href?location.href:'http://localhost/');
 url.searchParams.set('workspace',mode);
 for(const param of ['marketing','provider','google_ads','meta_official'])url.searchParams.delete(param);
 url.hash='/'+(mode==='master'?(workspaceSections[section]||'dashboard'):(section||'overview'));
 return url.pathname+url.search+url.hash;
}
function workspaceFromLocation(){
 if(typeof location!=='object'||!location?.href)return 'production';
 return new URL(location.href).searchParams.get('workspace')==='master'&&isPrimaryMaster()?'master':'production';
}
function initialWorkspaceView(){
 const part=typeof location==='object'?String(location.hash||'').replace(/^#\//,''):'';
 if(state.workspace==='master')return workspaceRoutes[part]||'masterOverview';
 return ['overview','orb','inbox','connections','marketing','products','training','team','settings'].includes(part)?part:'overview';
}
function updateWorkspaceUrl(){
 if(typeof history!=='object'||typeof location!=='object'||!state.me)return;
 const next=workspaceUrl(state.workspace,state.view);
 if(location.pathname+location.search+location.hash!==next)history.replaceState(null,'',next);
}
function syncMasterSwitch(){
 const visible=isPrimaryMaster(),master=isMasterView();
 document.body?.classList?.toggle('socio-is-master',master);
 document.body?.classList?.toggle('socio-is-production',!master);
 const shell=$('#appShell');
 if(shell)shell.dataset.workspace=master?'master':'production';
 const switcher=$('#workspaceSwitcher');
 if(switcher){
  switcher.classList.toggle('hidden',!visible);
  switcher.dataset.active=master?'master':'production';
  switcher.querySelectorAll('[data-workspace-target]').forEach(button=>{
   const active=button.dataset.workspaceTarget===(master?'master':'production');
   button.setAttribute('aria-selected',String(active));
   button.tabIndex=active?0:-1;
  });
 }
 const kind=$('#workspaceKind');
 if(kind)kind.textContent=master?'ADMINISTRAÇÃO MASTER':'AMBIENTE DE PRODUÇÃO';
 const pill=document.querySelector('.top-pill');
 if(pill)pill.innerHTML='<i></i> '+(master?'Painel Master · SaaS':'Ambiente de produção');
 const production=$('#productionNav'),admin=$('#masterNav');
 for(const [nav,hide] of [[production,master],[admin,!master]]){
  if(!nav)continue;
  nav.classList.toggle('hidden',hide);
  nav.setAttribute('aria-hidden',String(hide));
  nav.inert=hide;
 }
 $('#productionMenuLabel')?.classList.toggle('hidden',master);
 document.querySelector('.sidebar-bottom [data-view="settings"]')?.classList.toggle('hidden',master);
 if(!visible)return;
 const workspace=$('#workspaceName'),initial=$('#workspaceInitial'),crumb=$('#crumbRoot');
 if(workspace)workspace.textContent=master?'Sócio · Plataforma':state.me?.tenant?.name||'Seu espaço';
 if(initial)initial.textContent=master?'M':(state.me?.tenant?.name?.[0]||'S').toUpperCase();
 if(crumb)crumb.textContent=master?'Master':'Sócio';
 const role=$('#userRole');
 if(role)role.textContent=master?'Administração da plataforma':'Ambiente da empresa';
}

const viewAvailable=key=>!featureView[key]||featureAvailable(featureView[key])||key==='team'&&ownAccountAvailable();
const titles={overview:'Visão geral',orb:'Conversar com IA',inbox:'WhatsApp',connections:'Conexões',marketing:'Meta Ads',products:'Produtos e serviços',training:'Inteligência Artificial',agent:'Meu Sócio',team:'Equipe',settings:'Configurações da conta',admin:'Empresas',masterOverview:'Dashboard',masterPlans:'Planos e métricas'};
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=cent=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cent||0)/100);
const date=v=>v?new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}):'—';
const val=(form,k)=>String(new FormData(form).get(k)||'').trim();
const errMsg=error=>String(error?.message||'Não foi possível concluir a solicitação.');
const view=$('#view');
let toastTimer,trainingTimer,waQrTimer;
let activeInbox=null;

function toast(message,error=false){
 const el=$('#toast');el.textContent=message;el.className='toast'+(error?' error':'');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),5000);
}
async function api(path,method='GET',body,headers={},options={}){
 const opts={method,credentials:'same-origin',headers:{'Accept':'application/json',...headers}};
 if(options?.signal)opts.signal=options.signal;
 // A stalled GET must not keep a dashboard in "Carregando" forever.
 const controller=method==='GET'&&!opts.signal&&typeof AbortController==='function'?new AbortController():null;
 const timeout=controller?setTimeout(()=>controller.abort(),18000):null;
 if(controller)opts.signal=controller.signal;
 if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
 if(method!=='GET'&&state.csrf)opts.headers['X-CSRF-Token']=state.csrf;
 let resp;
 try{resp=await fetch(path,opts);}
 catch(error){if(controller?.signal.aborted)throw new Error('Tempo limite da consulta atingido. Tente novamente.');throw error;}
 finally{if(timeout)clearTimeout(timeout);}
 const data=await resp.json().catch(()=>({error:'Erro de conexão.'}));
 if(!resp.ok){if(resp.status===401&&state.me){state.me=null;boot();}throw new Error(data.error||'Falha ao acessar o servidor.');}
 return data;
}


function heading(eyebrow,title,description,action=''){
 return '<div class="view-heading"><div><span class="eyebrow">'+e(eyebrow)+'</span><h1>'+e(title)+'</h1><p>'+e(description)+'</p></div>'+action+'</div>';
}
function empty(icon,title,description,action=''){
 return '<div class="empty"><div class="empty-icon">'+icon+'</div><h3>'+e(title)+'</h3><p>'+e(description)+'</p>'+action+'</div>';
}
function badge(text,color='gray'){return '<span class="badge '+color+'">'+e(text)+'</span>';}
function panel(title,description,body){return '<div class="card"><div class="panel-head"><div><h2>'+e(title)+'</h2>'+ (description?'<p>'+e(description)+'</p>':'')+'</div></div>'+body+'</div>';}
function formValues(form){return Object.fromEntries(new FormData(form).entries());}
function setLoading(){view.innerHTML='<div class="loading socio-page-loading" role="status" aria-live="polite"><span class="socio-loading-sigil" aria-hidden="true">✳</span><span class="socio-loading-title">Preparando seu espaço</span><span class="socio-loading-copy">Carregando as informações da sua empresa…</span></div>';}
function setupAuth(initialized){
 $('#authScreen').classList.remove('hidden');$('#appShell').classList.add('hidden');
 $('#loginForm').classList.toggle('hidden',!initialized);
 $('#setupForm').classList.toggle('hidden',initialized);
 $('#authTitle').textContent=initialized?'Entre na sua conta.':'Vamos preparar seu espaço.';
 $('#authDescription').textContent=initialized?'Seu atendimento começa aqui.':'A primeira conta será a administração principal do Sócio.';
 $('#authError').textContent='';
}
async function boot(){
 try{
  const bootstrap=await api('/api/bootstrap');
  try{
   const me=await api('/api/me');
   state.me=me;state.csrf=me.csrf;
   state.workspace=workspaceFromLocation();
   state.view=initialWorkspaceView();
   $('#authScreen').classList.add('hidden');$('#appShell').classList.remove('hidden');
   $('#workspaceName').textContent=me.tenant.name;
   $('#workspaceInitial').textContent=(me.tenant.name[0]||'S').toUpperCase();
   $('#userChip').textContent=me.user.name.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
   $('#userName').textContent=me.user.name;
   $('#userRole').textContent=me.user.platformOwner?'Administrador master':me.user.role==='owner'?'Proprietário':'Equipe da empresa';
   syncMasterSwitch();
   $('#teamNav')?.classList.toggle('hidden',!(me.user.permissions||[]).includes('account.manage')&&!me.user.platformOwner);
   const access=new Set(me.user.permissions||[]);
   document.querySelector('.nav-item[data-view="connections"]')?.classList.toggle('hidden',
    !access.has('marketing.read')&&!access.has('channels.manage'));

   for(const [section,permission] of [['training','training.manage'],['reports','audit.read'],['marketing','marketing.read']]){
    document.querySelector('.nav-item[data-view="'+section+'"]')?.classList.toggle('hidden',!access.has(permission));
   }
   for(const [section,feature] of Object.entries(featureView)){
    const nav=document.querySelector('.nav-item[data-view="'+section+'"]');
    if(nav)nav.classList.toggle('hidden',!viewAvailable(section)||
     (section==='training'&&!access.has('training.manage'))||
     (section==='marketing'&&!access.has('marketing.read')));
   }
   $('#teamNav')?.classList.toggle('hidden',!featureAvailable('team')||!access.has('team.read'));
   document.querySelector('.nav-item[data-view="settings"]')?.classList.remove('hidden');
   const accountNav=$('#teamNav'),accountLabel='Equipe';
   if(accountNav?.lastChild?.nodeType===3)accountNav.lastChild.textContent=' '+accountLabel;
   if(accountNav){accountNav.title=accountLabel;accountNav.setAttribute('aria-label',accountLabel);}
   document.querySelector('.nav-item[data-view="settings"]')?.classList.toggle('hidden',!ownAccountAvailable());
   const marketingStatus=typeof location==='object'?new URL(location.href).searchParams.get('marketing'):null;
   const marketingProvider=typeof location==='object'?new URL(location.href).searchParams.get('provider'):null;
   const googleOAuth=typeof location==='object'?new URL(location.href).searchParams.get('google_ads'):null;
   const officialOAuth=typeof location==='object'?new URL(location.href).searchParams.get('meta_official'):null;
   if(googleOAuth||officialOAuth){state.view='connections';if(typeof history==='object')history.replaceState(null,'',location.pathname);}
   if(['authorized','failed','cancelled'].includes(marketingStatus)){
    state.view='connections';
    if(typeof history==='object')history.replaceState(null,'',location.pathname);
   }
   if(isMasterView())globalThis.SocioThalitaUI?.unmount();
   else globalThis.SocioThalitaUI?.mount({client:api,auth:state.me,csrfToken:state.csrf});
   await changeView(state.view);
   if(googleOAuth==='connected')toast('Conta Google autorizada. Selecione a conta de anúncios em Conexões.');
   if(officialOAuth==='authorized')toast('Meta autorizada. Selecione a conta de anúncios em Conexões.');
   if(googleOAuth==='failed'||officialOAuth==='failed')toast('Não foi possível concluir a conexão. Verifique sua conta.',true);
   if(marketingStatus==='authorized'){
    toast('Login autorizado. Verificando contas de anúncios disponíveis...');
    if(marketingProvider==='meta')void (async()=>{
     const provider=marketingProvider;
     try{
      const result=await api('/api/marketing/oauth/'+provider+'/test','POST',{});
      if(state.view==='connections'){
       await globalThis.SocioWorkspaceUI?.connections({root:view,api,me:state.me,navigate:changeView});
       const target=view.querySelector('[data-marketing-result="'+provider+'"]');
       if(target){
        target.textContent=result.message;
        if(result.accounts?.length)target.innerHTML='<p>'+e(result.message)+'</p><ul>'+
         result.accounts.map(x=>'<li>'+e(x.name)+' · '+e(x.id)+'</li>').join('')+'</ul>';
       }
      }
      toast(result.status==='verified'?'Contas disponíveis confirmadas!':
       'Login autorizado, mas nenhuma conta publicitária foi encontrada.',result.status!=='verified');
     }catch(error){
      const message='Login autorizado, mas a leitura das contas não pôde ser confirmada: '+errMsg(error);
      if(state.view==='marketing'){
       const target=view.querySelector('[data-marketing-result="'+provider+'"]');
       if(target)target.textContent=message;
      }
      toast(message,true);
     }
    })();
   }
   if(marketingStatus==='failed')toast('Não foi possível concluir autorização. Confira a conta e tente novamente.',true);
   if(marketingStatus==='cancelled')toast('Autorização cancelada; nenhuma conta foi alterada.');
  }catch(error){state.me=null;state.csrf='';setupAuth(bootstrap.initialized);}
 }catch(error){setupAuth(true);$('#authError').textContent='Não foi possível conectar ao servidor. '+errMsg(error);}
}
async function changeView(next,conversationId=null){
 globalThis.SocioMetaBilling?.dispose();
 globalThis.SocioInterviewUI?.dispose();
 if(next!=='inbox'&&activeInbox){activeInbox.cleanup();activeInbox=null;}
 if(next==='channels')next='connections';
 if(next==='reports')next='overview';
 if(next==='quotes'||next==='sales')next='overview';
 if(next==='agent'){state.aiTab='agent';next='training';}
 else if(next==='training'&&state.view!=='training')state.aiTab='training';
 clearTimeout(trainingTimer);clearTimeout(waQrTimer);
 // Workspace boundary: Master tools never render in production and vice versa.
 if(masterViews.has(next)&&!isPrimaryMaster())return;
 if(isMasterView()&&!masterViews.has(next))return;
 if(!isMasterView()&&masterViews.has(next))return;
 if(!viewAvailable(next))next='overview';
 const access=new Set(state.me?.user?.permissions||[]);
 if(next==='training'&&!access.has('training.manage'))next='overview';
 if(next==='connections'&&!access.has('marketing.read')&&!access.has('channels.manage'))next='overview';
 if(next==='instagram')next='marketing';
 if(next==='marketing'&&!access.has('marketing.read'))next='overview';
 globalThis.SocioWorkspaceUI?.invalidateRender();
 globalThis.SocioMasterDashboard?.invalidate();
 globalThis.SocioFlowImages?.dispose();
 globalThis.SocioMetaBrowser?.dispose();
 globalThis.SocioMetaLocal?.dispose();
 if(next!=='orb')globalThis.SocioOrbUI?.dispose();
 document.body?.classList?.toggle('socio-orb-view',next==='orb');
 state.view=next;
 syncMasterSwitch();
 $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===next));
 $('#topTitle').textContent=titles[next]||'Sócio';
 updateWorkspaceUrl();
 setLoading();
 try{
  if(next==='orb'&&globalThis.SocioOrbUI){
   await globalThis.SocioOrbUI.render({root:view,api,me:state.me,csrfToken:state.csrf,navigate:changeView});
  }
  if(next==='overview')await overview();
   if(next==='connections'){
    await globalThis.SocioWorkspaceUI.connections({root:view,api,me:state.me,navigate:changeView});
    await globalThis.SocioOwnerChannelUI?.render({root:view,api,me:state.me});
   }
  if(next==='products')await products();
  if(next==='training'){
   if(state.aiTab==='images'){await window.SocioFlowImages.render({root:view,api,me:state.me});mountAiGuideTabs();}
   else await (state.aiTab==='agent'?agent():training());
  }
  if(next==='inbox'){await inbox();if(conversationId)await openThread(conversationId);}
  if(next==='marketing')await marketing();
  if(next==='team')await team();
  if(next==='settings')await settings();
  if(next==='admin')await admin();
  if(next==='masterOverview'||next==='masterPlans')
   await globalThis.SocioMasterDashboard.render({root:view,api,me:state.me,navigate:changeView,
    mode:next==='masterPlans'?'plans':'overview'});
 }catch(error){view.innerHTML=empty('!', 'Não foi possível carregar',errMsg(error),'<button class="btn" id="retryView">Tentar novamente</button>');$('#retryView')?.addEventListener('click',()=>changeView(next));}
}

function chartNumber(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.round(n):0;}
function shortPeriodLabel(item,granularity){
 const value=new Date(String(item.date||'')+'T12:00:00');
 if(Number.isNaN(value.getTime()))return '';
 if(granularity==='day')return value.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
 return value.toLocaleDateString('pt-BR',{month:'short'});
}
function renderActivityGraph(data){
 const items=Array.isArray(data?.points)?data.points:[];
 if(!items.length)return '<div class="neo-empty-recent">Nenhuma atividade disponível.</div>';
 const x0=10,x1=733,y0=20,y1=169;
 const all=items.flatMap(p=>[chartNumber(p.inbound),chartNumber(p.outbound)]);
 const max=Math.max(1,...all);
 const xy=(p,i,key)=>[x0+(x1-x0)*(items.length<=1?.5:i/(items.length-1)),y1-chartNumber(p[key])/max*(y1-y0)];
 const positions=(key)=>items.map((p,i)=>xy(p,i,key));
 const inbound=positions('inbound'),outbound=positions('outbound');
 const plot=pts=>pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
 const grid=[0,.25,.5,.75,1].map(r=>{
  const y=(y1-r*(y1-y0)).toFixed(1);
  const n=Math.round(max*r);
  return '<line class="chart-grid" x1="8" x2="738" y1="'+y+'" y2="'+y+'"/>'+
   '<text x="748" y="'+(Number(y)+3)+'" font-size="10" fill="#816a59">'+n+'</text>';
 }).join('');
 const fill=plot(inbound)+' L '+inbound[inbound.length-1][0].toFixed(1)+','+y1+' L '+inbound[0][0].toFixed(1)+','+y1+' Z';
 const markers=items.map((item,i)=>{
  const ins=inbound[i],outs=outbound[i],period=shortPeriodLabel(item,data.granularity);
  if(items.length>12 && i%3!==0 && i!==items.length-1)return '';
  return '<circle class="chart-node" cx="'+ins[0]+'" cy="'+ins[1]+'" r="3"><title>'+e(period+': '+chartNumber(item.inbound)+' recebidas')+'</title></circle>'+
   '<circle class="chart-node-green" cx="'+outs[0]+'" cy="'+outs[1]+'" r="2.3"><title>'+e(period+': '+chartNumber(item.outbound)+' enviadas')+'</title></circle>';
 }).join('');
 return '<svg role="img" aria-label="Atividade real do atendimento: linha laranja para mensagens recebidas e verde para enviadas" viewBox="0 0 795 190" preserveAspectRatio="none">'+
  '<defs><linearGradient id="neoOrangeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f57b22" stop-opacity=".25"/><stop offset="100%" stop-color="#f57b22" stop-opacity="0"/></linearGradient></defs>'+
  grid+'<path d="'+fill+'" fill="url(#neoOrangeFill)"/>'+
  '<path class="chart-orange" d="'+plot(inbound)+'"/>'+
  '<path class="chart-green" d="'+plot(outbound)+'"/>'+markers+'</svg>';
}
function activityTicks(data){
 const points=Array.isArray(data?.points)?data.points:[];
 if(!points.length)return '';
 const stops=[0,.25,.5,.75,1].map(x=>Math.min(points.length-1,Math.round(x*(points.length-1))));
 return [...new Set(stops)].map(i=>'<span>'+e(shortPeriodLabel(points[i],data.granularity))+'</span>').join('');
}
function dashboardBars(data){
 const points=Array.isArray(data?.points)?data.points:[];
 if(!points.length)return '<div class="neo-empty-recent">Ainda não há registros no período.</div>';
 const totals=points.map(p=>chartNumber(p.inbound)+chartNumber(p.outbound));
 const max=Math.max(1,...totals),maxIndex=totals.indexOf(Math.max(...totals));
 return points.map((p,i)=>{
  const v=totals[i],height=v===0?3:Math.max(6,Math.round(v/max*108));
  return '<div class="neo-bar-column'+(i===maxIndex&&v>0?' is-highlight':'')+'"><span class="neo-bar-value">'+e(v)+'</span>'+
   '<span class="neo-bar-shape" data-height="'+height+'" title="'+e(v+' mensagens no mês')+'"></span>'+
   '<span class="neo-bar-label">'+e(shortPeriodLabel(p,'month'))+'</span></div>';
 }).join('');
}


const emberIcons={
 bubble:'<path d="M20 11.4c0 4.5-3.6 8-8.1 8-1.6 0-3.2-.4-4.5-1.2L3 20l1.7-4.3C3.6 14.4 3 12.8 3 11.4c0-4.4 3.9-8.2 8.9-8.2S20 7 20 11.4Z"/>',
 whatsapp:'<path d="M21 11.9a9 9 0 0 1-13.4 7.8L3 21l1.4-4.4A9 9 0 1 1 21 11.9Z"/><path d="M9 8.5c.6 3 2.4 4.8 5.5 6l1.5-1.4"/>',
 mail:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
 spark:'<path d="m12 2 2.1 7 7 3-7 3-2.1 7-2.3-7-6.7-3 6.7-3Z"/>',
 book:'<path d="M12 6C9 4.2 6.7 4 3 4v14c3.7 0 6 .3 9 2 3-1.7 5.3-2 9-2V4c-3.7 0-6 .2-9 2Zm0 0v14"/>',
 user:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-1.6c0-4.3 3.2-6.5 7.5-6.5s7.5 2.2 7.5 6.5V21"/>',
 play:'<path d="m8 5 11 7-11 7z"/>',
 scan:'<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><path d="M7 10h4v4H7zm7 0h3m-3 4h3m-10 3h3"/>',
 arrows:'<path d="m5 13 5 5L20 8"/>'
};
function emberIcon(kind){
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(emberIcons[kind]||emberIcons.spark)+'</svg>';
}
async function overview(){
 if(globalThis.SocioWorkspaceUI)return globalThis.SocioWorkspaceUI.overview({root:view,api,me:state.me,navigate:changeView,progressive:true});
 const [d,trend,recent,links]=await Promise.all([
  api('/api/dashboard'),api('/api/dashboard/activity?range=1m'),
  featureAvailable('whatsapp')?api('/api/inbox'):Promise.resolve([]),
  featureAvailable('whatsapp')?api('/api/waakg/channels'):Promise.resolve([])
 ]);
 state.dashboard=d;
 const openCount=chartNumber(d.openConversations);
 const online=Array.isArray(links)?links.filter(channel=>channel.status==='connected').length:0;
 const messages=chartNumber(d.messagesReceivedToday);
 const totalMessages=(trend.points||[]).reduce((sum,p)=>sum+chartNumber(p.inbound)+chartNumber(p.outbound),0);
 const received=(trend.points||[]).reduce((sum,p)=>sum+chartNumber(p.inbound),0);
 const sent=(trend.points||[]).reduce((sum,p)=>sum+chartNumber(p.outbound),0);
 const recentItems=Array.isArray(recent)?recent.slice(0,4):[];
 const connectedWhatsApps=Array.isArray(links)?links.filter(c=>c.status==='connected'):[];
 const kpi=(kind,label,value,meta,type)=>'<div class="ember-kpi ember-kpi-'+type+'">'+
  '<div class="ember-kpi-symbol">'+emberIcon(kind)+'</div>'+
  '<div class="ember-kpi-copy"><div class="ember-kpi-name">'+e(label)+'</div>'+
  '<div class="ember-kpi-value">'+e(value)+'</div><div class="ember-kpi-meta">'+e(meta)+'</div></div>'+
  '<div class="ember-kpi-glow" aria-hidden="true"></div></div>';
 const aiRow=(kind,label,description,section)=>'<button class="ember-ai-row" data-go="'+section+'" type="button">'+
  '<span class="ember-ai-row-icon">'+emberIcon(kind)+'</span>'+
  '<span class="ember-ai-row-copy"><strong>'+e(label)+'</strong><small>'+e(description)+'</small></span>'+
  '<span class="ember-ai-chevron" aria-hidden="true">›</span></button>';
 const conversation=(item,index)=>{
  const first=(item.customer_name||item.customer_phone||'C').trim().slice(0,1).toUpperCase();
  const time=item.last_message_at?new Date(item.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
  const label=item.status==='resolved'?'Resolvida':item.status==='human'?'Com atendente':'Em andamento';
  const chip=item.status==='resolved'?'muted':item.status==='human'?'amber':'green';
  return '<button class="ember-conversation" data-go="inbox" type="button">'+
   '<span class="ember-avatar ember-avatar-'+index%4+'">'+e(first)+'</span>'+
   '<span class="ember-conversation-copy"><strong>'+e(item.customer_name||item.customer_phone||'Cliente')+'</strong>'+
    '<small>'+e(item.channel_label||'WhatsApp')+' · '+e(item.last_message_at?date(item.last_message_at):'Sem data')+'</small></span>'+
   '<span class="ember-conversation-tail">'+(time?'<small>'+e(time)+'</small>':'')+
    '<span class="ember-status '+chip+'">'+e(label)+'</span></span></button>';
 };
 const whatsappSummary=connectedWhatsApps.length?
  '<div class="socio-connected-list">'+connectedWhatsApps.slice(0,5).map(c=>
    '<div class="socio-connected-item"><span class="socio-green-dot"></span><div><strong>'+e(c.label||'WhatsApp')+
    '</strong><small>'+e(c.phone||'Número confirmado')+'</small></div><span class="badge green">Conectado</span></div>'
   ).join('')+(connectedWhatsApps.length>5?'<small>Mais '+(connectedWhatsApps.length-5)+' número(s) conectado(s)</small>':'')+'</div>':
  '<div class="socio-no-connections"><span class="socio-wa-empty-icon">◉</span><strong>Nenhum WhatsApp conectado</strong>'+
  '<p>Conecte seu primeiro número usando o QR Code.</p></div>';
 view.innerHTML=
 '<div class="lucid-dashboard ember-dashboard">'+
  '<div class="ember-kpi-grid">'+
   kpi('bubble','Conversas em aberto',openCount.toLocaleString('pt-BR'),'Atendimentos aguardando acompanhamento','conversations')+
   kpi('whatsapp','WhatsApps conectados',online.toLocaleString('pt-BR'),'Sessões vinculadas neste espaço','connected')+
   kpi('mail','Mensagens recebidas hoje',messages.toLocaleString('pt-BR'),'Dia atual · horário de Brasília','messages')+
  '</div>'+
  '<div class="ember-primary-grid">'+
   '<section class="ember-card ember-activity">'+
    '<div class="ember-card-heading ember-chart-heading"><div class="ember-heading-left">'+
     '<span class="ember-heading-icon">'+emberIcon('arrows')+'</span><div><h1>Atividade de conversas</h1>'+
     '<p>Mensagens recebidas e enviadas no período</p></div></div>'+
     '<div class="ember-filter" role="group" aria-label="Período do gráfico">'+
      '<button type="button" data-range="7d" aria-pressed="false">7 dias</button>'+
      '<button type="button" class="is-active" data-range="1m" aria-pressed="true">30 dias</button>'+
      '<button type="button" data-range="90d" aria-pressed="false">90 dias</button>'+
     '</div></div>'+
    '<div class="ember-chart-metrics">'+
     '<div><span>Mensagens no período</span><strong id="activitySummary">'+e(totalMessages.toLocaleString('pt-BR'))+'</strong></div>'+
     '<div><span>Recebidas</span><strong id="activityInbound">'+e(received.toLocaleString('pt-BR'))+'</strong></div>'+
     '<div><span>Enviadas</span><strong id="activityOutbound">'+e(sent.toLocaleString('pt-BR'))+'</strong></div>'+
    '</div>'+
    '<div class="neo-chart-canvas ember-chart-area" id="activityChart">'+renderActivityGraph(trend)+'</div>'+
    '<div id="chartTicks" class="neo-month-ticks ember-chart-labels">'+activityTicks(trend)+'</div>'+
    '<div class="ember-chart-legend">'+
     '<span><i class="ember-dot orange"></i>Recebidas</span>'+
     '<span><i class="ember-dot green"></i>Enviadas</span>'+
     '<small>Dados reais da empresa selecionada</small></div>'+
   '</section>'+
   '<section class="ember-card ember-qr-card socio-dashboard-whatsapp">'+
    '<div class="ember-qr-head"><span class="ember-whatsapp-icon">'+emberIcon('whatsapp')+'</span>'+
      '<div><h2>Seus WhatsApps</h2><p>Números da empresa disponíveis para atendimento.</p></div></div>'+
    whatsappSummary+
    '<button type="button" class="btn primary ember-qr-cta" id="dashboardConnectWhatsApp">+ Conectar WhatsApp</button>'+
    '<p class="ember-qr-disclaimer">Conexão por QR Code. Atendimento e envios exigem número conectado e autorização.</p>'+
   '</section>'+
  '</div>'+
  '<div class="ember-secondary-grid">'+
   '<section class="ember-card ember-ai-card">'+
    '<div class="ember-card-heading"><div class="ember-heading-left"><span class="ember-heading-icon orange">'+emberIcon('spark')+'</span>'+
     '<div><h2>Inteligência Artificial</h2><p>Treine, personalize e teste a IA do atendimento.</p></div></div></div>'+
    '<div class="ember-ai-layout"><div class="ember-ai-actions">'+
     aiRow('book','Treinamento','Analise conversas e aprove o conhecimento da IA.','training')+
     aiRow('user','Personalidade','Defina o estilo, instruções e limites de resposta.','agent')+
     aiRow('play','Testar IA','Simule perguntas e veja como ela responde.','agent')+
    '</div><div class="ember-ai-visual" aria-hidden="true">'+
      '<span class="ember-ai-layer one"></span><span class="ember-ai-layer two"></span>'+
      '<span class="ember-ai-layer front">✦</span><span class="ember-ai-sparkle">✧</span></div></div>'+
    '<button type="button" class="btn primary ember-ai-cta" data-go="training">Abrir Inteligência Artificial <span>↗</span></button>'+
   '</section>'+
   '<section class="ember-card ember-recent-card">'+
    '<div class="ember-card-heading ember-recent-heading"><div class="ember-heading-left">'+
     '<span class="ember-heading-icon">'+emberIcon('bubble')+'</span><h2>Conversas recentes</h2></div>'+
     '<button class="ember-link" type="button" data-go="inbox">Ver todas →</button></div>'+
    '<div class="ember-recent-list">'+(recentItems.length?recentItems.map(conversation).join(''):
     '<p class="ember-empty-recent">As conversas da sua empresa aparecerão aqui quando houver mensagens.</p>')+'</div>'+
   '</section>'+
  '</div>'+
 '</div>';
 bindNavWithin();
 if(!featureAvailable('whatsapp')){
  view.querySelector('.socio-dashboard-whatsapp')?.classList.add('hidden');
  view.querySelector('.ember-recent-card')?.classList.add('hidden');
 }
 if(!featureAvailable('ai')||!(state.me.user.permissions||[]).includes('training.manage'))
  view.querySelector('.ember-ai-card')?.classList.add('hidden');
 $('#dashboardConnectWhatsApp')?.addEventListener('click',()=>window.SocioUX.openQr({
  api,toast,canManage:state.me.user.platformOwner||['owner','admin'].includes(state.me.user.role),
  onConnected:()=>state.view==='overview'?overview():Promise.resolve()
 }));
 view.querySelectorAll('[data-range]').forEach(btn=>btn.addEventListener('click',async()=>{
  const range=btn.dataset.range;
  if(!['7d','1m','90d'].includes(range))return;
  view.querySelectorAll('[data-range]').forEach(x=>x.disabled=true);
  try{
   const data=await api('/api/dashboard/activity?range='+range);
   if(state.view!=='overview'||!$('#activityChart'))return;
   const inbound=(data.points||[]).reduce((n,p)=>n+chartNumber(p.inbound),0);
   const outbound=(data.points||[]).reduce((n,p)=>n+chartNumber(p.outbound),0);
   $('#activitySummary').textContent=(inbound+outbound).toLocaleString('pt-BR');
   $('#activityInbound').textContent=inbound.toLocaleString('pt-BR');
   $('#activityOutbound').textContent=outbound.toLocaleString('pt-BR');
   $('#activityChart').innerHTML=renderActivityGraph(data);
   $('#chartTicks').innerHTML=activityTicks(data);
   view.querySelectorAll('[data-range]').forEach(x=>{
    const on=x.dataset.range===range;
    x.classList.toggle('is-active',on);
    x.setAttribute('aria-pressed',String(on));
   });
  }catch(err){toast(errMsg(err),true)}
  finally{if(state.view==='overview')view.querySelectorAll('[data-range]').forEach(x=>x.disabled=false);}
 }));
}
function bindNavWithin(){view.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>changeView(b.dataset.go)));}
async function channels(){
 const [data,waConfig,linked]=await Promise.all([
  api('/api/channels'),api('/api/waakg/config'),api('/api/waakg/channels')
 ]);
 const canManage=state.me.user.platformOwner||(state.me.user.permissions||[]).includes('training.manage');
 const connected=linked.filter(c=>c.status==='connected').length;
 const pending=linked.length-connected;
 const legacy=data.filter(c=>!linked.some(x=>x.id===c.id));
 const connectedList=linked.map(c=>{
  const ok=c.status==='connected';
  const phone=c.phone?.startsWith('pending-')?'Aguardando leitura do QR Code':c.phone;
  return '<div class="wa-number-row"><div class="wa-number-icon">'+(ok?'✓':'◌')+'</div>'+
   '<div class="wa-number-info"><strong>'+e(c.label)+'</strong><small>'+e(phone)+'</small></div>'+
   '<span class="badge '+(ok?'green':'yellow')+'">'+(ok?'Conectado':'Aguardando')+'</span>'+
   '<div class="wa-number-actions">'+
   '<button class="btn sm soft" type="button" data-wa-check="'+e(c.id)+'">Verificar</button>'+
   (canManage?
    '<button class="btn sm soft" type="button" data-wa-qr="'+e(c.id)+'">'+(ok?'QR':'Ver QR')+'</button>'+
    '<button class="btn sm ghost" type="button" data-wa-control="start" data-wa-id="'+e(c.id)+'">Reconectar</button>'+
    '<button class="btn sm ghost" type="button" data-wa-control="logout" data-wa-id="'+e(c.id)+'">Desconectar</button>':'')+
   '</div><span class="wa-number-feedback" data-wa-state="'+e(c.id)+'" aria-live="polite"></span></div>';
 }).join('');
 view.innerHTML=heading('CANAIS DE ATENDIMENTO','Conecte seus WhatsApps.','Um QR Code por número, com acesso exclusivo aos dados da sua empresa.')+
 '<div class="wa-status-strip"><div><span class="wa-status-dot"></span><strong>'+e(connected)+'</strong><small>Conectados</small></div>'+
 '<div><span class="wa-status-dot amber"></span><strong>'+e(pending)+'</strong><small>Aguardando QR</small></div>'+
 '<div><span class="wa-status-dot gray"></span><strong>'+e(linked.length)+'</strong><small>Sessões vinculadas</small></div></div>'+
 '<div class="wa-layout"><section class="card card-pad wa-setup">'+
 '<div class="wa-setup-heading"><span class="wa-setup-icon">▣</span><div><h2>Conectar via QR Code</h2>'+
 '<p>Use o WhatsApp do celular para autorizar esta conexão.</p></div></div>'+
 '<div class="wa-steps"><div><b>1</b><span>Abra <strong>WhatsApp</strong> no celular.</span></div>'+
 '<div><b>2</b><span>Entre em <strong>Dispositivos conectados</strong> e escolha <strong>Conectar dispositivo</strong>.</span></div>'+
 '<div><b>3</b><span>Aponte a câmera para o QR Code exibido no Sócio.</span></div></div>'+
 (canManage&&waConfig.configured?
 '<form id="waakgSelfConnect" class="form-stack wa-connect-form">'+
 '<label>Nome para identificar este WhatsApp<input name="label" required maxlength="90" placeholder="Ex.: Atendimento principal" autocomplete="off"></label>'+
 '<button class="btn primary wide" type="submit">Gerar QR Code <span>↗</span></button></form>':
 '<div class="info-strip">'+(!waConfig.configured?
 'O serviço de conexão do Sócio está indisponível no momento.':'Somente proprietários e administradores podem conectar novos números.')+'</div>')+
 '<div id="waQrPanel" class="wa-qr-panel hidden" aria-live="polite"><h3>Escaneie para conectar</h3>'+
 '<img id="waQrImage" class="wa-qr-image" width="270" height="270" alt="QR Code de conexão WhatsApp" style="display:none">'+
 '<p id="waQrHelp" class="form-note">Preparando QR Code...</p>'+
 '<button class="btn soft" type="button" id="waQrClose">Fechar QR Code</button></div>'+
 '</section><section class="card card-pad wa-list"><div class="wa-list-head"><div><h2>Seus números</h2>'+
 '<p>Gerencie os WhatsApps já vinculados ao espaço.</p></div><span class="badge gray">'+e(linked.length)+' total</span></div>'+
 '<div class="wa-number-list">'+(connectedList||empty('▣','Nenhum WhatsApp conectado','Gere o primeiro QR Code ao lado para começar.'))+'</div>'+
 (legacy.length?'<details class="wa-legacy"><summary>'+e(legacy.length)+' cadastro(s) antigos sem sessão QR</summary>'+
 '<p class="form-note">Estes cadastros não significam uma conexão ativa. Para autorizar um WhatsApp, use o QR Code.</p>'+
 '<div>'+legacy.map(c=>'<div class="wa-legacy-item">'+e(c.label)+' · '+e(c.phone)+'</div>').join('')+'</div></details>':'')+
 '<p class="form-note wa-readonly">A conexão por QR permite leitura e análise do histórico disponível. O envio automático de mensagens permanece desativado.</p>'+
 '</section></div>';
 $('#waakgSelfConnect')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const label=val(ev.currentTarget,'label');
  await action(async()=>{
   const channel=await api('/api/waakg/channels/connect','POST',{label});
   toast('Sessão criada. Escaneie o QR para conectar.');
   await channels();
   await showWaQr(channel.id);
  });
 });
 $('#waQrClose')?.addEventListener('click',()=>{
  clearTimeout(waQrTimer);$('#waQrPanel').classList.add('hidden');
 });
 view.querySelectorAll('[data-wa-qr]').forEach(button=>button.addEventListener('click',()=>showWaQr(button.dataset.waQr)));
 view.querySelectorAll('[data-wa-check]').forEach(button=>button.addEventListener('click',async()=>{
  const id=button.dataset.waCheck;
  const feedback=view.querySelector('[data-wa-state="'+id+'"]');
  try{
   const status=await api('/api/waakg/channels/'+id+'/status');
   feedback.textContent=status.connected?'Conexão verificada':'Aguardando conexão ou número divergente';
  }catch(err){feedback.textContent=errMsg(err);}
 }));
 view.querySelectorAll('[data-wa-control]').forEach(button=>button.addEventListener('click',async()=>{
  const id=button.dataset.waId,command=button.dataset.waControl;
  if(command==='logout'&&!confirm('Desconectar este WhatsApp e apagar a sessão autorizada?'))return;
  await action(async()=>{
   await api('/api/waakg/channels/'+id+'/'+command,'POST',{});
   toast(command==='logout'?'WhatsApp desconectado.':'Solicitação enviada ao gateway.');
   await channels();
   if(command==='start')await showWaQr(id);
  });
 }));
 if(globalThis.SocioOwnerChannelUI)await globalThis.SocioOwnerChannelUI.render({root:view,api,me:state.me});
}
async function marketing(){
 if(globalThis.SocioWorkspaceUI)return globalThis.SocioWorkspaceUI.marketing({root:view,api,me:state.me,navigate:changeView});
 if(globalThis.SocioMetaOfficial)return globalThis.SocioMetaOfficial.render({root:view,api,canManage:(state.me?.user?.permissions||[]).includes('marketing.manage')});
 if(!globalThis.SocioMetaLocal)throw Error('Recarregue a página para conectar o Ads Manager.');
 return globalThis.SocioMetaLocal.render({root:view,api,canManage:(state.me?.user?.permissions||[]).includes('marketing.manage')});
}
async function legacyMarketing(){
 const [data,auth]=await Promise.all([api('/api/marketing'),api('/api/marketing/oauth')]);
 const grants=(auth.grants||[]).filter(x=>x.provider==='meta'),connections=(data.connections||[]).filter(x=>x.provider==='pipeboard_meta'),reports=(data.reports||[]).filter(x=>x.provider==='pipeboard_meta');
 const scope=key=>grants.find(x=>x.provider===key&&x.status==='authorized');
 const accountCards=(provider,legacy)=>connections.filter(x=>x.provider===legacy&&x.status==='verified')
   .map(x=>'<p class="form-note">Conta com acesso de leitura verificado: '+e(x.label)+' · '+e(x.account_id)+'</p>').join('');
 const item=(key,label,description,legacy)=>{
  const grant=scope(key);
  const expiry=grant?.expires_at?new Date(grant.expires_at).getTime():null;
  const valid=!!grant&&(!expiry||expiry>Date.now());
  const lastCheck=grant?.last_checked_at?new Date(grant.last_checked_at).getTime():null;
  const checkedRecently=!!lastCheck&&Number.isFinite(lastCheck)&&Date.now()-lastCheck<24*60*60*1000;
  const verified=valid&&checkedRecently&&grant.last_read_status==='verified'&&Number(grant.last_account_count)>0;
  const noAccounts=valid&&checkedRecently&&grant.last_read_status==='no_accounts';
  const statusText=!valid?'Não autorizado no Sócio.':
   verified?Number(grant.last_account_count)+' conta(s) com leitura confirmada nas últimas 24 horas.':
   noAccounts?'Login autorizado, mas nenhuma conta de anúncios foi liberada.':
   'Login autorizado. A leitura das contas ainda precisa ser confirmada ou atualizada.';
  const existing=accountCards(key,legacy);
  return '<section class="card" style="padding:24px;margin-bottom:18px">'+
   '<h2>'+e(label)+'</h2>'+
   '<p>'+e(description)+'</p>'+
   '<p class="form-note">'+e(statusText)+'</p>'+
   '<button type="button" class="btn primary" data-marketing-oauth="'+key+'">'+
    (valid?'Reconectar '+e(label):'Conectar '+e(label))+'</button> '+
   (valid?'<button type="button" class="btn soft" data-marketing-test="'+key+'">Testar conexão</button> <button type="button" class="btn soft" data-marketing-oauth-revoke="'+key+'">Desconectar</button>':'')+
   '<div data-marketing-result="'+key+'" role="status" aria-live="polite"></div>'+
   '<p class="form-note">Login em janela segura, sem senha ou token colado no Sócio. '+
    'Após autorizar, selecione as contas em '+
    '<a href="https://pipeboard.co/connections" rel="noopener noreferrer" target="_blank">Gerenciar contas no Pipeboard</a>.'+
    '</p>'+existing+
   '</section>';
 };
 view.innerHTML=heading('META ADS','Meta Ads.',
  'Apenas conecte a sua conta. Sem códigos, scripts ou configurações de API.')+
  item('meta','Meta Ads','Conecte o Facebook e escolha as contas de anúncios que deseja autorizar.','pipeboard_meta')+
  '<section class="card" style="padding:22px">'+
   '<h2>Relatórios</h2>'+
   (reports.length?
    '<div style="overflow-x:auto"><table class="table"><thead><tr><th>Data</th><th>Campanha</th>'+
    '<th>Impressões</th><th>Cliques</th><th>Investimento (moeda da conta)</th></tr></thead><tbody>'+
    reports.slice(0,30).map(r=>'<tr><td>'+e(String(r.date||'').slice(0,10))+'</td>'+
     '<td>'+e(r.campaign_name)+'</td><td>'+e(r.impressions)+'</td><td>'+e(r.clicks)+
     '</td><td>'+e((Number(r.cost_micros)/1000000).toFixed(2))+'</td></tr>').join('')+
    '</tbody></table></div>':
    '<p class="form-note">Quando uma conta for vinculada e a leitura de dados estiver confirmada, os relatórios aparecerão aqui.</p>')+
  '</section>'+
  '<p class="form-note" style="margin-top:12px">A autorização do Pipeboard não comprova, por si só, que uma conta de anúncios foi vinculada.'+
  ' Nenhuma campanha será criada, alterada ou ativada sem permissão e confirmação separadas.</p>';
 view.querySelectorAll('[data-marketing-oauth]').forEach(btn=>btn.addEventListener('click',()=>action(async()=>{
  const result=await api('/api/marketing/oauth/start','POST',{provider:btn.dataset.marketingOauth});
  const target=new URL(result.authorizationUrl);
  if(target.protocol!=='https:'||!(/(^|\.)pipeboard\.co$/.test(target.hostname)))
   throw Error('O destino da autorização não é confiável.');
  window.location.assign(target.toString());
 })));
 view.querySelectorAll('[data-marketing-test]').forEach(btn=>btn.addEventListener('click',()=>action(async()=>{
  const target=view.querySelector('[data-marketing-result="'+btn.dataset.marketingTest+'"]');
  btn.disabled=true;target.textContent='Verificando acesso às contas...';
  try{
   const result=await api('/api/marketing/oauth/'+btn.dataset.marketingTest+'/test','POST',{});
   target.textContent=result.message;
   if(result.accounts?.length)target.innerHTML='<p>'+e(result.message)+'</p><ul>'+result.accounts.map(x=>'<li>'+e(x.name)+' · '+e(x.id)+'</li>').join('')+'</ul>';
  }catch(error){target.textContent=errMsg(error);}finally{btn.disabled=false;}
 })));
 view.querySelectorAll('[data-marketing-oauth-revoke]').forEach(btn=>btn.addEventListener('click',()=>{
  if(!confirm('Revogar a autorização desta plataforma no Sócio?'))return;
  void action(async()=>{
   await api('/api/marketing/oauth/'+btn.dataset.marketingOauthRevoke+'/disconnect','POST',{});
   toast('Autorização do Sócio revogada. Você também pode revogar no Pipeboard.');
   await marketing();
  });
 }));
}

async function showWaQr(channelId){
 clearTimeout(waQrTimer);
 const panel=$('#waQrPanel'),image=$('#waQrImage'),help=$('#waQrHelp');
 if(!panel||!image||!help)return;
 panel.classList.remove('hidden');help.textContent='Preparando QR Code...';
 image.style.display='none';panel.scrollIntoView({behavior:'smooth',block:'nearest'});
 async function poll(){
  if(state.view!=='channels'||$('#waQrPanel')?.classList.contains('hidden'))return;
  try{
   const status=await api('/api/waakg/channels/'+channelId+'/status');
   if(status.connected){
    clearTimeout(waQrTimer);
    image.style.display='none';
    toast('WhatsApp conectado e número verificado!');
    await channels();
    return;
   }
   const qr=await api('/api/waakg/channels/'+channelId+'/qr');
   if(qr.ready&&qr.image){image.src=qr.image;image.style.display='block';help.textContent='Escaneie o QR usando WhatsApp > Dispositivos conectados. O código pode mudar automaticamente.';}
   else{image.style.display='none';help.textContent='Aguardando QR. Se não aparecer, use Reiniciar na lista de números.';}
  }catch(error){help.textContent='Não foi possível buscar o QR: '+errMsg(error);}
  waQrTimer=setTimeout(poll,3000);
 }
 await poll();
}


const catalogPrice=cents=>brl(Number(cents||0));
// Accept the Brazilian decimal separator without modifying a saved price twice.
const centsFromInput=text=>{
 const raw=String(text??'').trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
 let normalized;
 if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw))normalized=raw.replace(/\./g,'').replace(',','.');
 else if(/^\d{1,7}(?:[.,]\d{1,2})?$/.test(raw))normalized=raw.replace(',','.');
 else throw Error('Preço inválido. Use, por exemplo, 129,90.');
 const n=Number(normalized);
 if(!Number.isFinite(n)||n<0||Math.round(n*100)>=100000000)throw Error('Valor fora do limite permitido.');
 return Math.round(n*100);
};
const stockFromInput=text=>{
 const value=String(text??'').trim();
 if(!value)return null;
 if(!/^\d{1,7}$/.test(value)||Number(value)>1000000)throw Error('Estoque inválido: use um número não negativo ou deixe vazio.');
 return Number(value);
};
async function compressCatalogImage(file){
 if(file.size>12000000)throw Error('Foto original acima de 12 MB. Escolha outra imagem.');
 if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Selecione JPG, PNG ou WebP.');
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width<20||bitmap.height<20)throw Error('Foto muito pequena.');
  const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
  const context=canvas.getContext('2d');if(!context)throw Error('Não foi possível preparar a imagem.');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.83));
  if(!blob||blob.size>3000000)throw Error('Foto resultante muito grande. Selecione outra imagem.');
  return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(String(reader.result).split(',')[1]);
   reader.onerror=()=>reject(new Error('Não foi possível ler a foto.'));
   reader.readAsDataURL(blob);
  });
 }finally{bitmap.close();}
}
const catalogTypes=['Cor','Tamanho','Modelo','Outro'];
const catalogColors=['Amarelo','Azul','Azul-marinho','Bege','Branco','Cinza','Dourado','Laranja','Marrom','Prata','Preto','Rosa','Roxo','Verde','Vermelho','Vinho'];
const catalogSizes=['PP','P','M','G','GG','XG','XXG','Único','34','36','38','40','42','44','46','48','50','52'];
const variantParts=name=>{
 const raw=String(name||'').trim(),m=/^(Cor|Tamanho|Modelo|Outro)\s*[·:-]\s*(.+)$/i.exec(raw);
 if(!m)return {kind:'Outro',value:raw};
 return {kind:catalogTypes.find(x=>x.toLowerCase()===m[1].toLowerCase())||'Outro',value:m[2]};
};
function catalogVariantRow(variant={}){
 const {kind,value}=variantParts(variant.name||'');
 return '<div class="catalog-variant-row" data-variant-row>'+
  '<select data-variant-type aria-label="Tipo de variação">'+catalogTypes.map(x=>
   '<option value="'+e(x)+'"'+(kind===x?' selected':'')+'>'+e(x)+'</option>').join('')+'</select>'+
  '<input data-variant-value aria-label="Valor da variação" required maxlength="80" list="'+(kind==='Cor'?'catalogColorSuggestions':kind==='Tamanho'?'catalogSizeSuggestions':'catalogGenericSuggestions')+'" placeholder="'+(kind==='Cor'?'Ex.: Preto':kind==='Tamanho'?'Ex.: 40':'Ex.: Premium')+'" value="'+e(value)+'">'+
  '<input data-variant-price aria-label="Preço da variação" type="text" inputmode="decimal" maxlength="18" placeholder="Preço R$" value="'+e(variant.price_cents===undefined?'':(variant.price_cents/100).toFixed(2).replace('.',','))+'">'+
  '<input data-variant-stock aria-label="Estoque da variação" type="number" min="0" step="1" placeholder="Estoque" value="'+e(variant.stock_quantity??'')+'">'+
  '<input data-variant-sku aria-label="SKU da variação" maxlength="50" placeholder="SKU opcional" value="'+e(variant.sku||'')+'">'+
  '<button type="button" class="btn sm ghost" data-remove-variant aria-label="Excluir variação">×</button>'+
 '</div>';
}
const readVariantRows=(root,basePrice)=>[...root.querySelectorAll('[data-variant-row]')].map(row=>{
 const kind=row.querySelector('[data-variant-type]')?.value||'Outro';
 const value=row.querySelector('[data-variant-value]')?.value.trim()||'';
 if(!catalogTypes.includes(kind)||!value||value.length>80)throw Error('Informe um valor para cada variação, como Preto, 40 ou Premium.');
 const price=row.querySelector('[data-variant-price]')?.value.trim()||basePrice;
 const sku=row.querySelector('[data-variant-sku]')?.value||'';
 return {name:kind+' · '+value,sku,priceCents:centsFromInput(price),
  stockQuantity:stockFromInput(row.querySelector('[data-variant-stock]')?.value),active:true};
});
async function products(selected=null){
 const [list,storage]=await Promise.all([api('/api/products'),api('/api/products/storage')]);
 const canReadCampaigns=(state.me?.user?.permissions||[]).includes('marketing.read')&&featureAvailable('meta_ads');
 const showDetails=selected==='new'||Boolean(selected);
 const [metaChoices,googleChoices]=canReadCampaigns&&showDetails?await Promise.all([
  api('/api/marketing/tools/campaigns').then(d=>d.items||[]).catch(()=>[]),
  googleAdsVisible()?api('/api/google-ads/campaigns').then(d=>d.campaigns||[]).catch(()=>[]):Promise.resolve([])
 ]):[[],[]];
 const campaignOptions={
  meta_ads:metaChoices.map(x=>({id:String(x.id),name:String(x.name||x.id),status:String(x.effective_status||x.status||'') })),
  google_ads:googleChoices.map(x=>({id:String(x.id),name:String(x.name||x.id),status:String(x.status||'') }))
 };
 const campaignSelect=(scope)=>!featureAvailable('meta_ads')?'':'<div class="px-campaign-picker">'+
  (googleAdsVisible()?
    '<label>Plataforma<select data-campaign-provider aria-label="Plataforma de anúncios"'+(scope==='create'?' name="newCampaignProvider"':' name="provider"')+'>'+
     '<option value="meta_ads">Meta Ads</option><option value="google_ads">Google Ads</option></select></label>':
    '<input type="hidden" data-campaign-provider value="meta_ads"'+(scope==='create'?' name="newCampaignProvider"':' name="provider"')+'>'+
    '<div class="px-campaign-provider-meta"><span class="px-brand-dot meta"></span><strong>Meta Ads</strong><small>Campanhas da conta autorizada</small></div>')+
  '<label>Campanha cadastrada<select data-campaign-target aria-label="Campanha existente"'+(scope==='create'?' name="newCampaignId"':' name="campaignId"')+'>'+
   '<option value="">Selecione uma campanha na sua conta</option></select></label>'+
  '<small>Selecione pelo nome. Campanhas ativas ou pausadas aparecem quando retornadas pela conta autorizada; resultados dependem do rastreamento.</small>'+
  '</div>';
 const fillCampaignOptions=(form)=>{
  const provider=form?.querySelector('[data-campaign-provider]'),picker=form?.querySelector('[data-campaign-target]');
  if(!provider||!picker||typeof picker.replaceChildren!=='function'||typeof picker.add!=='function')return;
  const old=picker.value;picker.replaceChildren(new Option('Nenhuma campanha selecionada',''));
  for(const x of campaignOptions[provider.value]||[]){
   const label=x.name+(x.status?' · '+x.status:'');
   const option=new Option(label,x.id);option.dataset.label=x.name;picker.add(option);
  }
  if((campaignOptions[provider.value]||[]).some(x=>x.id===old))picker.value=old;
  picker.disabled=picker.options.length===1;
 };
 const campaignPayload=(form)=>{
  const provider=form?.querySelector('[data-campaign-provider]')?.value;
  const picker=form?.querySelector('[data-campaign-target]');
  if(!picker?.value)return null;
  const selected=(campaignOptions[provider]||[]).find(x=>x.id===picker.value);
  if(!selected)throw Error('Selecione uma campanha autorizada na lista.');
  return {provider,campaignId:selected.id,label:selected.name};
 };
 if(selected&&selected!=='new'&&!list.some(p=>p.id===selected))selected=null;
 state.catalogProductId=selected&&selected!=='new'?selected:null;
 const current=list.find(p=>p.id===selected);
 const photo=p=>p.media?.length?'<img class="catalog-cover-image" src="'+e(p.media[0].url)+'" alt="'+e(p.media[0].alt||p.name)+'" loading="lazy">':
   '<div class="catalog-placeholder">◈</div>';
 const productCards=list.length?'<div class="catalog-list">'+list.map(p=>{
  const stockedVariants=p.variants?.filter(v=>v.active!==false)||[];
  const available=p.active&&(stockedVariants.length?stockedVariants.some(v=>v.stock_quantity===null||v.stock_quantity>0):(p.stock_quantity===null||p.stock_quantity>0));
  return '<button type="button" class="catalog-product '+(selected===p.id?'is-selected':'')+
   '" data-catalog-item data-catalog-label="'+e((p.name||'')+' '+(p.sku||''))+
   '" data-catalog-available="'+(available?'true':'false')+'" data-select-product="'+e(p.id)+'">'+
   '<div class="catalog-cover">'+photo(p)+'</div>'+
   '<div class="catalog-product-copy"><strong>'+e(p.name)+'</strong><small>'+e(p.sku||'Sem SKU')+' · '+e(p.media?.length||0)+' foto(s)</small>'+
   '<span>'+e(catalogPrice(p.price_cents))+'</span></div>'+
   '<span class="catalog-status '+(available?'yes':'no')+'">'+(available?'Ativo':'Indisponível')+'</span></button>';
 }).join('')+'</div>':
 empty('▦','Seu catálogo está vazio','Cadastre um produto para incluir preço, variações e fotos.');
 const gallery=current?'<div class="catalog-gallery">'+current.media.map(m=>
  '<div class="catalog-gallery-item"><img src="'+e(m.url)+'" alt="'+e(m.alt||current.name)+'" loading="lazy">'+
  '<button type="button" data-delete-photo="'+e(m.id)+'" class="btn sm ghost">Remover</button></div>').join('')+'</div>':'';
 const detail=current?
  '<section class="card card-pad section-gap"><div class="section-title">Fotos do produto · '+e(current.media.length)+'/8</div>'+
   '<p class="form-note">Arquivos privados por empresa. JPG, PNG e WebP são otimizados sem metadados da foto. A IA poderá exibir essas imagens no laboratório.</p>'+
   gallery+
   '<form id="catalogPhotoForm" class="form-stack"><label>Adicionar fotos<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple '+(!storage.configured?'disabled':'')+'></label>'+
   '<button class="btn primary" type="submit" '+(!storage.configured?'disabled':'')+'>Adicionar fotos →</button></form>'+
   (!storage.configured?'<p class="form-note">Armazenamento de fotos não configurado no servidor.</p>':'')+
  '</section>'+
  '<section class="card card-pad section-gap"><div class="section-title">Variações e preços</div>'+
   '<p class="form-note">Tamanhos, cores e versões podem ter preços e estoques próprios. Estoque vazio significa não controlado.</p>'+
   '<form id="catalogVariantForm" class="form-stack"><div id="catalogVariantRows">'+current.variants.map(catalogVariantRow).join('')+'</div>'+
   '<div class="row-actions"><button class="btn soft" id="addVariant" type="button">+ Adicionar variação</button><button class="btn primary" type="submit">Salvar variações</button></div></form></section>'+
  '<section class="card card-pad section-gap"><div class="section-title">Campanhas associadas</div>'+
   '<p class="form-note">Associação manual de referência. A conexão e os resultados da conta de anúncios ainda não foram verificados.</p>'+
   (current.campaigns.some(c=>googleAdsVisible()||c.provider!=='google_ads')?'<div class="catalog-campaign-list">'+current.campaigns.filter(c=>googleAdsVisible()||c.provider!=='google_ads').map(c=>
     '<div><strong>'+e(c.provider==='google_ads'?'Google Ads':'Meta Ads')+'</strong> · '+e(c.label||c.campaign_id)+
     '<span class="form-note"> '+e(c.campaign_id)+' · Não verificada</span>'+
     '<button class="btn sm ghost" data-delete-campaign="'+e(c.id)+'">Remover</button></div>').join('')+'</div>':'')+
   '<form id="catalogCampaignForm" class="form-stack">'+campaignSelect('edit')+


   '<button class="btn soft" type="submit">Associar campanha →</button></form></section>':'';
 const modalOpen=selected==='new'||Boolean(current);
 view.innerHTML=heading('CATÁLOGO','Produtos e serviços.','Catálogo, preços e disponibilidade da empresa.',
  '<button class="btn primary" id="newProduct">+ Novo produto</button>')+
  '<section class="card card-pad socio-catalog-clean">'+
   '<div class="socio-clean-head"><h2>Seu catálogo</h2><small>'+list.length+' produto(s) cadastrado(s)</small></div>'+
   (list.length?'<div class="catalog-filters"><label>Buscar produtos<input id="catalogSearch" type="search" maxlength="120" placeholder="Nome ou SKU" value="'+e(state.catalogSearch)+'"></label>'+
    '<label>Disponibilidade<select id="catalogStock"><option value="all"'+(state.catalogStock==='all'?' selected':'')+'>Todos</option>'+
    '<option value="available"'+(state.catalogStock==='available'?' selected':'')+'>Disponíveis</option>'+
    '<option value="unavailable"'+(state.catalogStock==='unavailable'?' selected':'')+'>Sem estoque / inativos</option></select></label></div>':'')+
   productCards+
   '<p id="catalogNoResults" class="form-note hidden" role="status">Nenhum produto corresponde aos filtros. Tente outra busca.</p></section>'+
  '<div class="socio-popup-backdrop'+(modalOpen?'':' hidden')+'" id="productModal" role="presentation">'+
   '<section class="socio-popup-surface socio-product-popup" role="dialog" aria-modal="true" aria-labelledby="productFormTitle">'+
    '<div class="socio-popup-header"><div><small>CATÁLOGO DA EMPRESA</small>'+
    '<h2 id="productFormTitle">'+(current?'Editar produto':'Novo produto')+'</h2>'+
    '<p>Preencha as informações do produto. Fotos e variações ficam no mesmo lugar.</p></div>'+
    '<button type="button" class="socio-popup-close" id="closeProductModal" aria-label="Fechar cadastro">×</button></div>'+
    '<form class="form-stack" id="productForm">'+
     '<label>Nome ou título do produto<input name="name" required maxlength="120" placeholder="Ex.: Kit profissional" value="'+e(current?.name||'')+'"></label>'+
     '<div class="catalog-pair"><label>Preço (R$)<input name="price" required type="text" inputmode="decimal" placeholder="Ex.: 129,90" maxlength="18" value="'+e(current?(current.price_cents/100).toFixed(2).replace('.',','):'')+'"></label>'+
     '<label>Preço anterior (opcional)<input name="compareAtPrice" type="text" inputmode="decimal" maxlength="18" value="'+e(current?.compare_at_price_cents!=null?(current.compare_at_price_cents/100).toFixed(2).replace('.',','):'')+'"></label></div>'+
     '<div class="catalog-pair"><label>Código / SKU<input name="sku" maxlength="50" placeholder="Opcional" value="'+e(current?.sku||'')+'"></label>'+
     '<label>Estoque disponível<input name="stock" type="number" min="0" step="1" placeholder="Sem controle" value="'+e(current?.stock_quantity??'')+'"></label></div>'+
     '<label>Descrição do produto<textarea name="description" maxlength="1200" placeholder="Características, benefícios e condições...">'+e(current?.description||'')+'</textarea></label>'+
     '<label>Disponibilidade<select name="active"><option value="true"'+(current?.active===false?'':' selected')+'>Disponível</option>'+
       '<option value="false"'+(current?.active===false?' selected':'')+'>Indisponível</option></select></label>'+
     (!current?'<label>Fotos do produto (JPG, PNG, WebP; até 8)<input type="file" name="newPhotos" accept="image/jpeg,image/png,image/webp" multiple '+(!storage.configured?'disabled':'')+'></label>'+
     '<div class="socio-clean-section"><h3>Variações</h3><div id="newVariantRows"></div>'+
      '<button class="btn soft" id="addNewVariant" type="button">+ Adicionar variação</button></div>'+
     '<div class="socio-clean-section"><h3>Associar campanha (opcional)</h3>'+campaignSelect('create')+'</div>':'')+
     '<div class="form-actions"><button class="btn primary" type="submit">'+(current?'Salvar alterações':'Cadastrar produto')+'</button>'+
      (current?'<button class="btn ghost" type="button" id="clearProduct">Novo produto</button>':'')+'</div>'+
    '</form>'+
    (current?detail+'<div class="px-danger-zone"><button type="button" class="btn ghost" id="deleteProduct">Excluir produto permanentemente</button></div>':'')+
   '</section></div>'+
   '<datalist id="catalogColorSuggestions">'+catalogColors.map(x=>'<option value="'+e(x)+'"></option>').join('')+'</datalist>'+
   '<datalist id="catalogSizeSuggestions">'+catalogSizes.map(x=>'<option value="'+e(x)+'"></option>').join('')+'</datalist>'+
   '<datalist id="catalogGenericSuggestions"></datalist>';
 $('#newProduct')?.addEventListener('click',()=>products('new'));
 $('#closeProductModal')?.addEventListener('click',()=>products(null));
 $('#productModal')?.addEventListener('click',ev=>{if(ev.target===$('#productModal'))products(null)});
 $('#addNewVariant')?.addEventListener('click',()=>{
  const host=$('#newVariantRows');
  if(host.querySelectorAll('[data-variant-row]').length>=25)return toast('Máximo de 25 variações.',true);
  host.insertAdjacentHTML('beforeend',catalogVariantRow());
 });
 $('#newVariantRows')?.addEventListener('click',ev=>{
  const btn=ev.target.closest('[data-remove-variant]');if(btn)btn.closest('[data-variant-row]').remove();
 });
 const modal=$('#productModal');
 modal?.addEventListener('change',ev=>{
  const type=ev.target.closest('[data-variant-type]');if(!type)return;
  const value=type.closest('[data-variant-row]')?.querySelector('[data-variant-value]');
  if(!value)return;
  value.setAttribute('list',type.value==='Cor'?'catalogColorSuggestions':
   type.value==='Tamanho'?'catalogSizeSuggestions':'catalogGenericSuggestions');
  value.placeholder=type.value==='Cor'?'Ex.: Preto':type.value==='Tamanho'?'Ex.: 40':
   type.value==='Modelo'?'Ex.: Premium':'Descreva a variação';
 });
 for(const form of [$('#productForm'),$('#catalogCampaignForm')]){
  if(!form)continue;
  fillCampaignOptions(form);
  form.querySelector('[data-campaign-provider]')?.addEventListener('change',()=>fillCampaignOptions(form));
 }
 if(modalOpen)$('#productForm')?.elements?.name?.focus();
 const applyCatalogFilters=()=>{
  const needle=String(state.catalogSearch||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  let shown=0;
  view.querySelectorAll('[data-catalog-item]').forEach(card=>{
   const label=String(card.dataset.catalogLabel||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const available=card.dataset.catalogAvailable==='true';
   const visible=label.includes(needle)&&(state.catalogStock==='all'||
    (state.catalogStock==='available'&&available)||(state.catalogStock==='unavailable'&&!available));
   card.classList.toggle('hidden',!visible);
   if(visible)shown++;
  });
  const empty=$('#catalogNoResults');
  if(empty)empty.classList.toggle('hidden',!list.length||shown>0);
 };
 $('#catalogSearch')?.addEventListener('input',ev=>{state.catalogSearch=ev.currentTarget.value;applyCatalogFilters();});
 $('#catalogStock')?.addEventListener('change',ev=>{state.catalogStock=ev.currentTarget.value;applyCatalogFilters();});
 applyCatalogFilters();
 view.querySelectorAll('[data-select-product]').forEach(btn=>btn.addEventListener('click',()=>products(btn.dataset.selectProduct)));
 $('#clearProduct')?.addEventListener('click',()=>products(null));
 $('#productForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget,d=formValues(form);
  await action(async()=>{
   // Validate EVERYTHING before creating the product. API saves variants and
   // campaign links atomically with the product, with rollback on error.
   const data={name:d.name,description:d.description,sku:d.sku,
    priceCents:centsFromInput(d.price),compareAtPriceCents:d.compareAtPrice?centsFromInput(d.compareAtPrice):null,
    stockQuantity:stockFromInput(d.stock),active:d.active==='true'};
   let photos=[];
   if(!current){
    data.variants=readVariantRows(form.querySelector('#newVariantRows'),d.price);
    const campaign=campaignPayload(form);
    data.campaigns=campaign?[campaign]:[];
    photos=[...(form.elements.newPhotos?.files||[])];
    if(photos.length>8)throw Error('Máximo de oito fotos por produto.');
    if(photos.some(file=>file.size>12000000||!['image/jpeg','image/png','image/webp'].includes(file.type)))
     throw Error('Use até 8 imagens JPG, PNG ou WebP, cada uma com até 12 MB.');
   }
   const submit=form.querySelector('[type="submit"]');
   if(submit)submit.disabled=true;
   let result;
   try{result=await api(current?'/api/products/'+current.id:'/api/products',current?'PATCH':'POST',data);}
   finally{if(submit)submit.disabled=false;}
   const productId=current?.id||result.id;let uploaded=0;
   for(const file of photos){
    try{
     const contentBase64=await compressCatalogImage(file);
     await api('/api/products/'+productId+'/media','POST',{contentBase64,alt:d.name});
     uploaded++;
    }catch(error){
     toast('Produto e variações salvos. '+uploaded+' foto(s) enviadas; falha na próxima foto: '+errMsg(error),true);
     await products(productId);return;
    }
   }
   toast(current?'Produto atualizado com sucesso.':'Produto cadastrado com variações e campanhas.');
   await products(productId);
  });
 });
 if(!current)return;
 $('#catalogPhotoForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const files=[...ev.currentTarget.elements.photos.files];
  if(!files.length)return toast('Selecione pelo menos uma foto.',true);
  if(files.length+current.media.length>8)return toast('Cada produto aceita até 8 fotos.',true);
  await action(async()=>{
   for(const file of files){
    const contentBase64=await compressCatalogImage(file);
    await api('/api/products/'+current.id+'/media','POST',{contentBase64,alt:current.name});
   }
   toast('Fotos adicionadas.');await products(current.id);
  });
 });
 view.querySelectorAll('[data-delete-photo]').forEach(btn=>btn.addEventListener('click',()=>action(async()=>{
  await api('/api/products/'+current.id+'/media/'+btn.dataset.deletePhoto,'DELETE',{});
  toast('Foto removida.');await products(current.id);
 })));
 $('#addVariant').addEventListener('click',()=>{
  const rows=$('#catalogVariantRows');
  if(rows.querySelectorAll('[data-variant-row]').length>=25)return toast('Máximo de 25 variações.',true);
  rows.insertAdjacentHTML('beforeend',catalogVariantRow());
 });
 $('#catalogVariantRows').addEventListener('click',ev=>{const btn=ev.target.closest('[data-remove-variant]');if(btn)btn.closest('[data-variant-row]').remove();});
 $('#catalogVariantForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  await action(async()=>{
   const variants=readVariantRows($('#catalogVariantRows'),String(current.price_cents/100));
   await api('/api/products/'+current.id+'/variants','PUT',{variants});
   toast('Variações atualizadas.');await products(current.id);
  });
 });
 $('#catalogCampaignForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  await action(async()=>{
   const campaign=campaignPayload(ev.currentTarget);
   if(!campaign)throw Error('Escolha uma campanha na lista vinculada à sua conta.');
   await api('/api/products/'+current.id+'/campaigns','POST',campaign);
   toast('Campanha associada ao produto.');await products(current.id);
  });
 });
 $('#deleteProduct')?.addEventListener('click',()=>action(async()=>{
  if(!window.confirm('Excluir definitivamente “'+current.name+'” e todas as suas variações, fotos e vínculos de anúncios? Esta ação não pode ser desfeita.'))return;
  const result=await api('/api/products/'+current.id,'DELETE',{confirm:true});
  toast(result.photoCleanupPending?'Produto excluído. Algumas imagens precisam de limpeza no armazenamento.':'Produto excluído permanentemente.');
  await products(null);
 }));
 view.querySelectorAll('[data-delete-campaign]').forEach(btn=>btn.addEventListener('click',()=>action(async()=>{
  await api('/api/products/'+current.id+'/campaigns/'+btn.dataset.deleteCampaign,'DELETE',{});
  toast('Associação removida.');await products(current.id);
 })));
}

function mountAiGuideTabs(){
 if(state.view!=='training')return;
 const selected=['agent','images'].includes(state.aiTab)?state.aiTab:'training';
 const tabs='<div class="ai-guide-head"><div class="ai-guide-title"><span class="eyebrow">CENTRAL DE INTELIGÊNCIA</span>'+
 '<h1>Inteligência artificial</h1><p>Treine seu Sócio e crie imagens em um só lugar.</p></div>'+
 '<div class="ai-guide-tabs" role="tablist" aria-label="Áreas da inteligência artificial">'+
 '<button type="button" role="tab" data-ai-tab="training" aria-selected="'+(selected==='training')+'" class="'+(selected==='training'?'active':'')+'">Aprendizado e análises</button>'+
 '<button type="button" role="tab" data-ai-tab="agent" aria-selected="'+(selected==='agent')+'" class="'+(selected==='agent'?'active':'')+'">Personalidade e testes</button>'+
 '<button type="button" role="tab" data-ai-tab="images" aria-selected="'+(selected==='images')+'" class="'+(selected==='images'?'active':'')+'">Criar imagens</button></div></div>';
 view.insertAdjacentHTML('afterbegin',tabs);
 // The content inside each tab retains its original API calls and handlers.
 view.querySelectorAll('[data-ai-tab]').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.aiTab===state.aiTab)return;
  state.aiTab=button.dataset.aiTab;changeView('training');
 }));
}

async function training(){
 clearTimeout(trainingTimer);
 const [auto,versions,waLinks,ag]=await Promise.all([
  api('/api/training/auto'),api('/api/training/versions'),
  (featureAvailable('whatsapp')?api('/api/waakg/channels'):Promise.resolve([])),api('/api/agent')
 ]);
 const run=auto.run,connected=waLinks.filter(c=>c.status==='connected');
 const percent=run?.percent??0;
 const draft=versions.find(v=>v.status==='draft'),published=versions.find(v=>v.status==='approved'),archived=versions.filter(v=>v.status==='archived').slice(0,8);
 const ongoing=run&&['scanning','analyzing'].includes(run.status);
 const status=run?.status==='scanning'?'Lendo conversas dos WhatsApps conectados':
  run?.status==='analyzing'?'Organizando o conhecimento e gerando Markdown':
  run?.status==='completed'?'Análise concluída — conhecimento pronto para revisão':
  run?.status==='failed'?'Não foi possível concluir o treinamento':
  run?.status==='cancelled'?'Treinamento cancelado':
  'Pronto para iniciar';
 const canManage=state.me.user.platformOwner||['owner','admin'].includes(state.me.user.role);
 const percentText=ongoing||run?.status==='completed'?percent+'%':'0%';
 view.innerHTML=
 '<div class="socio-training-clean">'+
  '<section class="card card-pad socio-training-center">'+
   '<span class="eyebrow">APRENDIZADO E ANÁLISES</span>'+
   '<div class="socio-train-emblem">✳</div>'+
   '<h2>Seu Sócio aprende com suas conversas.</h2>'+
   '<p>Com um clique, analisamos as conversas disponíveis nos WhatsApps conectados da empresa e criamos um Markdown de conhecimento para sua aprovação.</p>'+
   '<div class="socio-train-accounts">'+connected.map(c=>
    '<span class="socio-train-account"><span class="socio-green-dot"></span>'+e(c.label||c.phone||'WhatsApp')+'</span>').join('')+
    (!connected.length?'<span>Conecte seu WhatsApp para começar</span>':'')+'</div>'+
   '<button type="button" class="btn primary socio-train-cta" id="startAutoTraining" '+
    (!connected.length||ongoing||!canManage?'disabled':'')+'>Treinar</button>'+
   (ongoing&&canManage?'<button type="button" class="btn soft" id="cancelAutoTraining">Cancelar treinamento</button>':'')+
   '<div class="socio-train-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'" aria-label="Progresso da análise">'+
    '<div class="progress-track"><div class="progress-fill"></div></div></div>'+
   '<strong class="socio-train-percent">'+percentText+' analisado</strong>'+
   '<p class="form-note" role="status">'+e(status)+'</p>'+
   (run?.messagesImported?'<p class="form-note">'+e(run.messagesImported)+' mensagens de texto novas importadas neste treinamento.</p>':'')+
   (run?.partialCoverage?'<p class="form-note">Cobertura parcial: o gateway limita o histórico a 50 conversas por número e até 400 mensagens por conversa. Não representa todo o WhatsApp.</p>':'')+
   (run?.errorCode?'<p class="form-error">Erro: '+e(run.errorCode)+'</p>':'')+
   (!auto.groqConfigured?'<p class="form-note">A chave GROQ_API_KEY ainda não está configurada. A análise gera Markdown preliminar por regras; a síntese pelo Groq será habilitada quando a chave for instalada.</p>':
    '<p class="form-note">Síntese pelo Groq habilitada. O conhecimento continua como rascunho até sua aprovação.</p>')+
   (!featureAvailable('whatsapp')?'<p class="form-note">O WhatsApp está desabilitado para esta empresa. O administrador Consecom pode habilitá-lo em Empresas.</p>':!connected.length?'<button type="button" class="btn soft" id="trainConnectWhatsApp">+ Conectar WhatsApp</button>':'')+
  '</section>'+
  (draft?'<section class="card card-pad socio-train-result"><div class="socio-clean-head"><h2>Markdown gerado · versão '+e(draft.version)+'</h2>'+
    '<span class="badge yellow">Aguardando aprovação</span></div>'+
    '<p class="form-note">'+e(draft.report?.summary||'Reveja o conteúdo antes de ativá-lo.')+'</p>'+
    '<p class="form-note">Processamento: '+e(draft.report?.analysisProvider==='groq'?'Groq':draft.report?.analysisProvider==='deterministic_fallback'?'Síntese preliminar (Groq indisponível)':'Síntese preliminar')+'</p>'+
    '<textarea id="knowledgeDraft" class="socio-knowledge-edit" rows="15" maxlength="22000" aria-label="Markdown de conhecimento para revisão" '+(!canManage?'readonly':'')+'>'+e(draft.markdown||'')+'</textarea>'+
    (canManage?'<div class="socio-knowledge-actions"><button type="button" class="btn soft" id="analysisSave">Salvar ajustes</button>'+
    '<button type="button" class="btn primary" id="analysisApprove" data-id="'+e(draft.id)+'">Aprovar Markdown</button></div>':'')+'</section>':'')+
  (published?'<section class="card card-pad socio-train-result"><div class="socio-clean-head"><h2>Conhecimento aprovado</h2><span class="badge green">Versão '+e(published.version)+'</span></div>'+
    '<pre class="code-preview">'+e(ag.knowledge_md||'')+'</pre></section>':'')+
  (archived.length?'<section class="card card-pad socio-train-result"><h2>Histórico de versões</h2>'+
   '<p class="form-note">Restaurar uma versão substitui somente o conhecimento ativo desta empresa.</p>'+
   archived.map(v=>'<div class="socio-version-item"><span>Versão '+e(v.version)+' · arquivada</span>'+
    (canManage?'<button type="button" class="btn soft" data-restore-version="'+e(v.id)+'">Restaurar</button>':'')+'</div>').join('')+
   '</section>':'')+
 '</div>';
 const progress=view.querySelector('.progress-fill');if(progress)progress.style.width=percent+'%';
 $('#startAutoTraining')?.addEventListener('click',()=>action(async()=>{
  const btn=$('#startAutoTraining');if(btn)btn.disabled=true;
  await api('/api/training/auto','POST',{});
  toast('Treinamento iniciado. O conhecimento será preparado para sua revisão.');
  await training();
 }));
 $('#trainConnectWhatsApp')?.addEventListener('click',()=>window.SocioUX.openQr({
  api,toast,canManage,
  onConnected:()=>state.view==='training'?training():Promise.resolve()
 }));
 $('#cancelAutoTraining')?.addEventListener('click',()=>action(async()=>{
  await api('/api/training/auto/'+run.id+'/cancel','POST',{});
  toast('Treinamento cancelado.');
  await training();
 }));
 $('#analysisSave')?.addEventListener('click',()=>action(async()=>{
  await api('/api/training/versions/'+draft.id+'/edit','POST',{markdown:$('#knowledgeDraft').value});
  toast('Ajustes do Markdown salvos. O conhecimento ainda não foi aprovado.');
  await training();
 }));
 $$('[data-restore-version]').forEach(btn=>btn.addEventListener('click',()=>action(async()=>{
  await api('/api/training/versions/'+btn.dataset.restoreVersion+'/restore','POST',{});
  toast('Versão anterior restaurada como conhecimento ativo.');
  await training();
 })));
 $('#analysisApprove')?.addEventListener('click',()=>action(async()=>{
  await api('/api/training/versions/'+draft.id+'/approve','POST',{});
  toast('Markdown aprovado e disponível para a IA.');
  await training();
 }));
 mountAiGuideTabs();
 if(globalThis.SocioInterviewUI)await globalThis.SocioInterviewUI.mount({root:view,api,toast,csrf:state.csrf,user:state.me.user});
 if(ongoing)trainingTimer=setTimeout(()=>{
  if(state.view==='training'&&state.aiTab==='training')
   training().catch(error=>toast(errMsg(error),true));
 },1800);
}
async function agent(){
 const ag=await api('/api/agent');
 const missing=!state.me.groqConfigured;
 const labHistory=[]; // local to this training screen, never saved as customer memory
 view.innerHTML=
 '<div class="two-pane train"><div class="card card-pad"><div class="section-title">Identidade e comportamento</div><form id="agentForm" class="form-stack"><label>Nome do agente<input name="name" required maxlength="80" value="'+e(ag.name||'Sócio')+'"></label><label>Tom de voz<input name="tone" required maxlength="300" value="'+e(ag.tone||'Profissional e natural')+'"></label><label>Instruções e limites<textarea name="instructions" required maxlength="6000" rows="8">'+e(ag.instructions||'')+'</textarea></label><label>Modo operacional<select name="enabled"><option value="false"'+(!ag.enabled?' selected':'')+'>Em preparação</option><option value="true"'+(ag.enabled?' selected':'')+'>Preparado para integrar (não envia sozinho)</option></select></label><button type="submit" class="btn primary">Salvar personalidade →</button><p class="form-note">Marcar como preparado não conecta um WhatsApp ou libera envios automáticos.</p></form></div>'+
 '<div class="card"><div class="panel-head"><div><h2>Laboratório de conversas</h2><p>Faça perguntas como se fosse um cliente.</p></div>'+badge('Simulação','gray')+'</div><div class="messages-preview" id="simulationMessages"><div class="bubble">Olá! Este é seu laboratório. Configure produtos e treinamento e faça uma pergunta para experimentar a personalidade do seu Sócio.</div></div><p class="form-note" id="simulationQuality" role="status" aria-live="polite">Teste isolado: nenhuma mensagem é enviada ao WhatsApp. A revisão automática avalia apenas sinais de linguagem.</p><p class="form-note" id="simulationEvidence" aria-live="polite">A origem das informações aprovadas aparecerá aqui quando a busca estiver ativada.</p><form class="chat-compose" id="simulateForm"><input name="message" required maxlength="1200" placeholder="Ex.: Quais serviços vocês oferecem?" autocomplete="off"><button type="submit" class="btn primary">Enviar ↗</button></form>'+(missing?'<div class="info-strip" style="margin:14px">Configure GROQ_API_KEY no Railway para ativar as respostas do Groq no simulador.</div>':'')+'</div></div>';
 $('#agentForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/agent','PUT',{...d,enabled:d.enabled==='true'});toast('Personalidade atualizada.');await agent();});});
 $('#simulateForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget,txt=val(form,'message');if(!txt)return;
  const msgs=$('#simulationMessages');msgs.insertAdjacentHTML('beforeend','<div class="bubble agent">'+e(txt)+'</div>');form.reset();msgs.scrollTop=msgs.scrollHeight;
  await action(async()=>{
   const result=await api('/api/simulate','POST',{message:txt,history:labHistory});
   labHistory.push({role:'user',content:txt},{role:'assistant',content:result.reply||''});
   if(labHistory.length>12)labHistory.splice(0,labHistory.length-12);
   const quality=$('#simulationQuality');
   if(quality){
    const flags=Array.isArray(result.quality?.signals)?result.quality.signals:[];
    const labels={repeated_greeting:'saudação repetida',generic_closing:'encerramento genérico',robotic_intro:'apresentação robótica',length:'resposta longa',empty:'resposta vazia'};
    quality.textContent=(flags.length?'Revisar linguagem: '+flags.map(flag=>labels[flag]||flag).join(', ')+'.':'Sem sinais superficiais de linguagem robótica nesta resposta.')+' Isso não comprova a exatidão das informações.';
   }
   const evidence=$('#simulationEvidence');
   if(evidence){
    const k=result.knowledgeEvidence;
    if(!k)evidence.textContent='Busca de fontes aprovadas ainda não ativada neste ambiente.';
    else {
     const version=k.provenance?.versionNumber!=null?'Versão aprovada '+k.provenance.versionNumber+'. ':'';
     const sections=Array.isArray(k.matches)?k.matches.map(x=>x.id+' — '+x.title).slice(0,5):[];
     const label=k.status==='supported'?'Trechos relacionados encontrados.':
      k.status==='no_approved_knowledge'?'Nenhum treinamento aprovado disponível.':
      'Não foram encontradas evidências suficientes no manual aprovado.';
     evidence.textContent=version+label+(sections.length?' Seções consultadas: '+sections.join('; ')+'.':'')+
      ' Verifique os fatos antes de publicar o atendimento.';
    }
   }
   msgs.insertAdjacentHTML('beforeend','<div class="bubble">'+e(result.reply||'Não foi possível gerar uma resposta.')+'</div>');
   const cards=Array.isArray(result.productCards)?result.productCards:[];
   if(cards.length){
    const html=cards.map(p=>'<div class="catalog-ai-card"><strong>'+e(p.name)+'</strong> · '+e(brl(p.priceCents))+
     '<div class="catalog-ai-photos">'+(p.media||[]).map(m=>'<img loading="lazy" src="'+e(m.url)+'" alt="'+e(m.alt||p.name)+'">').join('')+'</div>'+
     '<small>Produto encontrado no catálogo oficial. Fotos mostradas apenas neste laboratório.</small></div>').join('');
    msgs.insertAdjacentHTML('beforeend',html);
   }
   msgs.scrollTop=msgs.scrollHeight;
  });
 });
 const canInspect=state.me.user.platformOwner||['owner','admin'].includes(state.me.user.role);
 if(canInspect){
  view.insertAdjacentHTML('beforeend',
   '<section class="card card-pad socio-ops-panel">'+
   '<div class="socio-clean-head"><div><h2>Verificação operacional</h2>'+
   '<p class="form-note">Veja o que está configurado e teste o Groq sem enviar mensagens aos clientes.</p></div></div>'+
   '<div class="socio-ops-actions"><button type="button" class="btn soft" id="checkSocioOps">Verificar operação</button>'+
   '<button type="button" class="btn primary" id="testSocioGroq">Testar conexão Groq</button>'+
   '<button type="button" class="btn soft" id="checkSocioMigration">Verificar preparação Supabase</button></div>'+
   '<div id="socioOpsResult" role="status" aria-live="polite" class="socio-ops-result">'+
   'Nenhuma verificação executada nesta sessão.</div>'+
   '<div id="socioMigrationResult" role="status" aria-live="polite" class="socio-ops-result" hidden></div></section>');
  $('#checkSocioOps')?.addEventListener('click',()=>action(async()=>{
   const btn=$('#checkSocioOps');btn.disabled=true;
   try{
    const result=await api('/api/ops/readiness');
    $('#socioOpsResult').innerHTML='<div class="socio-ops-grid">'+
     (result.checks||[]).map(check=>
      '<div class="socio-ops-check"><span class="socio-ops-indicator '+e(check.status)+'" aria-hidden="true"></span>'+
      '<div><strong>'+e(check.label)+'</strong><small>'+e(check.detail)+'</small></div></div>').join('')+
     '</div><p class="form-note">'+e(result.numbers?.verified||0)+
     ' WhatsApp(s) verificado(s). A presença da chave Groq não prova uma resposta real: use o botão de teste.</p>';
   }finally{btn.disabled=false;}
  }));
  $('#checkSocioMigration')?.addEventListener('click',()=>action(async()=>{
   const btn=$('#checkSocioMigration');btn.disabled=true;
   try{
    const status=await api('/api/ops/migration-readiness');
    const panel=$('#socioMigrationResult');
    panel.hidden=false;
    panel.innerHTML='<strong>Banco ativo: '+e(status.database==='railway'?'Railway PostgreSQL':'Supabase privado')+'</strong>'+
     '<p class="form-note">Schema '+e(status.schema)+' · '+e(status.tableCount)+' tabelas · '+
     (status.maintenance?'modo de manutenção ativo':'funcionamento normal')+'</p>'+
     '<p class="form-note">A migração automática permanece desabilitada. Pendências:</p>'+
     '<ul>'+status.blockers.map(item=>'<li>'+e(item)+'</li>').join('')+'</ul>';
   }finally{btn.disabled=false;}
  }));
  $('#testSocioGroq')?.addEventListener('click',()=>action(async()=>{
   const btn=$('#testSocioGroq');btn.disabled=true;
   try{
    const r=await api('/api/ops/groq/test','POST',{});
    $('#socioOpsResult').textContent='Groq respondeu ao teste: '+r.model+
     ' · '+r.latencyMs+' ms. Nenhuma mensagem foi enviada ao WhatsApp.';
    toast('Conexão Groq validada com resposta real.');
   }finally{btn.disabled=false;}
  }));
 }
 mountAiGuideTabs();
}
async function reports(){
 const [report,monitor,billing]=await Promise.all([
  api('/api/reports'),api('/api/reports/monitor').catch(()=>null),
  api('/api/billing/status').catch(()=>null)
 ]);
 const t=report.totals||{};
 const days=Array.isArray(report.dailyMessages)?report.dailyMessages:[];
 const max=Math.max(1,...days.map(d=>Number(d.messages||0)));
 const ops=monitor?.activity||null;
 const showNumber=value=>value===null||value===undefined?'Indisponível':Number(value).toLocaleString('pt-BR');
 const cards=[
  ['Mensagens recebidas',t.inbound_messages,'WhatsApp · últimos 30 dias'],
  ['Respostas confirmadas',ops?.confirmedBusinessMessages30d,'Somente envios com ID do provedor'],
  ['Conversas aguardando resposta',ops?.awaitingBusinessReply30d,'Clientes sem retorno do negócio']
 ];
 const monitorSection=ops?
  '<section class="card card-pad"><h2>Monitoramento da operação</h2>'+
   '<p class="form-note">Últimos 30 dias. Só mensagens com ID do provedor são respostas confirmadas; canal cadastrado não comprova conexão ativa no gateway.</p>'+
   '<div class="report-note-grid"><div><small>Conversas aguardando resposta</small><strong>'+e(showNumber(ops.awaitingBusinessReply30d))+'</strong></div>'+
   '<div><small>Respostas confirmadas</small><strong>'+e(showNumber(ops.confirmedBusinessMessages30d))+'</strong></div>'+
   '<div><small>Conversas iniciadas</small><strong>'+e(showNumber(ops.conversationsStarted30d))+'</strong></div>'+
   '<div><small>Canais cadastrados</small><strong>'+e(showNumber(ops.connectedChannelRecords))+'</strong></div></div>'+
   '<h3>Pontos de atenção</h3>'+
   (monitor.alerts.length?monitor.alerts.map(a=>'<p class="form-note">• '+e(a.message)+' ('+e(a.count)+')</p>').join(''):
    '<p class="form-note">Nenhum alerta encontrado nos registros disponíveis.</p>')+
   '<p class="form-note">Vendas reais e receita confirmada: indisponíveis. Pagamentos de teste não são faturamento.</p></section>':
  '<section class="card card-pad"><h2>Monitoramento</h2><p class="form-note">Consulta operacional indisponível; os demais relatórios continuam acessíveis.</p></section>';
 const billingSection=billing?
  '<section class="card card-pad"><h2>Assinatura do Sócio</h2>'+
   '<p class="form-note">Plano '+e(billing.plan)+' · Estado registrado da assinatura: '+e(billing.subscription.status)+
    '. O teste cadastral termina em '+e(new Date(billing.trial.endsAt).toLocaleDateString('pt-BR'))+'.</p>'+
   '<p class="form-note">Clientes pagantes e receita recorrente não são inferidos por status da conta. Nenhum bloqueio automático por fim do teste.</p>'+
   (billing.checkout.available?
     '<button class="btn soft" type="button" data-billing-checkout>Contratar no Stripe (revisar preço no Checkout)</button> '+
     '<button class="btn soft" type="button" data-billing-portal>Gerenciar assinatura</button>':
     '<p class="form-note">Assinatura ainda não liberada: a administração precisa definir preços e configurar a integração financeira.</p>')+
   '<p class="form-note" data-billing-feedback role="status"></p></section>':
  '<section class="card card-pad"><h2>Assinatura do Sócio</h2><p class="form-note">Estado de assinatura indisponível nesta sessão.</p></section>';
 view.innerHTML='<section class="socio-reports">'+
  heading('INTELIGÊNCIA OPERACIONAL','Relatórios','Indicadores reais dos últimos 30 dias, sem confundir oportunidade, orçamento e pagamento.')+
  '<div class="report-kpi-grid">'+cards.map(([name,count,sub])=>
   '<article class="card report-kpi"><small>'+e(name)+'</small><strong>'+e(count??0)+'</strong><p>'+e(sub)+'</p></article>').join('')+'</div>'+
  monitorSection+
  billingSection+
  '<div class="report-sections"><section class="card card-pad"><h2>Atividade de mensagens</h2>'+
   '<p class="form-note">Volume diário de mensagens recebidas nos últimos 14 dias.</p>'+
   (days.length?'<div class="report-bars" role="img" aria-label="Mensagens recebidas por dia">'+days.map(d=>{
    const n=Number(d.messages||0),width=Math.max(2,Math.round(n/max*100));
    const stamp=new Date(String(d.day).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    return '<div class="report-bar-row"><span>'+e(stamp)+'</span><div class="report-bar-track"><i data-width="'+width+'"></i></div><strong>'+e(n)+'</strong></div>';
   }).join('')+'</div>':'<p class="form-note">Nenhuma mensagem recebida no período.</p>')+
  '</section><section class="card card-pad"><h2>Interpretação dos dados</h2>'+
   '<p class="form-note">Estes números medem volume e tempo de resposta no WhatsApp. Vendas e receita só podem ser afirmadas com conciliação de pagamento; o Sócio não infere faturamento a partir de conversa.</p>'+
  '</section></div></section>';
 if(window.SocioIntegrationsUI)
  window.SocioIntegrationsUI.render({root:view,api}).catch(error=>console.warn('[integrations-panel]',String(error?.message||'unavailable').slice(0,100)));
 const billFeedback=view.querySelector('[data-billing-feedback]');
 for(const [action,endpoint,field] of [
  ['checkout','/api/billing/checkout','checkoutUrl'],
  ['portal','/api/billing/portal','portalUrl']
 ]){
  const btn=view.querySelector('[data-billing-'+action+']');
  btn?.addEventListener('click',async()=>{
   btn.disabled=true;
   if(billFeedback)billFeedback.textContent='Consultando a integração segura…';
   try{
    const answer=await api(endpoint,'POST',{});
    const url=new URL(answer[field]);
    if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))
     throw new Error('Destino de pagamento não confiável.');
    window.location.assign(url.toString());
   }catch(error){if(billFeedback)billFeedback.textContent=error.message;}
   finally{btn.disabled=false;}
  });
 }
 view.querySelectorAll('.report-bar-track i[data-width]').forEach(bar=>{
  bar.style.width=String(Math.min(100,Math.max(2,Number(bar.dataset.width)||2)))+'%';
 });
}

async function inbox(){
 if(!window.SocioInbox)throw new Error('Módulo de conversas não foi carregado. Recarregue a página.');
 if(activeInbox)activeInbox.cleanup();
 activeInbox=window.SocioInbox.create({api,e,toast,view,changeView,
  canManageMemory:state.me.user.platformOwner||['owner','admin','manager'].includes(state.me.user.role),
  openQr:()=>window.SocioUX.openQr({api,toast,
   canManage:state.me.user.platformOwner||['owner','admin'].includes(state.me.user.role),
   onConnected:()=>state.view==='inbox'?inbox():Promise.resolve()})
 });
 await activeInbox.render();
}
async function openThread(convId){
 if(!activeInbox)return;
 return activeInbox.open(convId);
}
async function settings(){
 view.innerHTML=heading('CONTA','Configurações da conta.','Atualize seus dados de acesso e a segurança do seu perfil.')+
 '<section class="card card-pad" style="margin-bottom:18px"><div class="section-title">Minha conta</div>'+
 '<div class="socio-my-account"><form id="myPhoneForm" class="form-stack">'+
 '<label>Meu celular para login<input name="phone" type="tel" maxlength="32" autocomplete="tel" value="'+e(state.me?.user?.phone||'')+'" placeholder="(15) 99999-9999"></label>'+
 '<label>Senha atual<input name="currentPassword" type="password" required autocomplete="current-password"></label>'+
 '<button class="btn soft" type="submit">Salvar celular</button></form>'+
 '<form id="passwordChangeForm" class="form-stack">'+
 '<label>Senha atual<input name="currentPassword" type="password" required autocomplete="current-password"></label>'+
 '<label>Nova senha (mínimo 12 caracteres)<input name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>'+
 '<button type="submit" class="btn primary">Alterar senha e encerrar outras sessões</button></form></div></section>';
 $('#myPhoneForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget;
  await action(async()=>{
   const result=await api('/api/me/phone','POST',formValues(form));
   state.me.user.phone=result.phone;toast('Dados de acesso atualizados.');await settings();
  });
 });
 $('#passwordChangeForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget;
  await action(async()=>{
   const result=await api('/api/me/password','POST',formValues(form));
   if(result.csrf)state.csrf=result.csrf;
   toast('Senha alterada. Todas as outras sessões foram encerradas.');await settings();
  });
 });
}
async function team(){
 const permissions=new Set(state.me?.user?.permissions||[]);
 const ownAccountOnly=!featureAvailable('team')||state.me?.tenant?.status==='paused';
 const mayView=!ownAccountOnly&&permissions.has('team.read'),mayInvite=!ownAccountOnly&&permissions.has('team.invite'),
  mayManage=permissions.has('team.manage'),mayPromote=permissions.has('team.promote');
 const teamResponse=mayView?await api('/api/team'):[];
 const people=Array.isArray(teamResponse)?teamResponse:[];
 const roleLabel=role=>({owner:'Proprietário',admin:'Administrador',manager:'Gestor',viewer:'Somente leitura',agent:'Atendente'}[role]||role);
 const members=mayView?'<section class="card card-pad"><div class="section-title">Usuários da empresa</div>'+
  '<p class="form-note">Acesso inativo encerra todas as sessões existentes e bloqueia novos logins. Proprietários não podem ser desativados nesta tela.</p>'+
  '<div class="table-wrap"><table class="data-table"><thead><tr><th>Colaborador</th><th>Permissão</th><th>Status</th><th>Ação</th></tr></thead><tbody>'+
  people.map(member=>{
   const protectedUser=member.role==='owner'||member.id===state.me.user.id;
   return '<tr><td><strong>'+e(member.name)+'</strong><div class="table-detail">'+e(member.email)+'</div></td>'+
    '<td>'+e(roleLabel(member.role))+'</td>'+
    '<td>'+badge(member.active?'Ativo':'Inativo',member.active?'green':'gray')+'</td>'+
    '<td><div class="socio-team-controls">'+(mayManage&&!protectedUser?
      '<button type="button" class="btn sm soft" data-team-toggle="'+e(member.id)+'" data-team-active="'+(!member.active)+'">'+
      (member.active?'Desativar':'Reativar')+'</button>'+
      '<select aria-label="Alterar permissão de '+e(member.name)+'" data-team-select="'+e(member.id)+'">'+
      [['viewer','Somente leitura'],['manager','Gestor'],...(mayPromote?[['admin','Administrador']]:[]),...(member.role==='admin'?[['admin','Administrador']]:[]),['agent','Atendente (legado)']].filter(([key],idx,arr)=>arr.findIndex(([role])=>role===key)===idx).map(([key,label])=>'<option value="'+key+'" '+(member.role===key?'selected':'')+'>'+label+'</option>').join('')+'</select>':'<span class="form-note">—</span>')+
    '</div></td></tr>';
  }).join('')+'</tbody></table></div></section>':'';
 const invite=mayInvite?'<section class="card card-pad" id="teamInvitePanel" hidden><div class="section-title">Adicionar usuário</div>'+
  '<form class="form-stack" id="teamForm"><label>Nome<input name="name" required maxlength="100"></label>'+
  '<label>E-mail<input name="email" type="email" required></label>'+
  '<label>Celular para login (opcional)<input name="phone" type="tel" maxlength="32" placeholder="(15) 99999-9999"></label>'+
  '<label>Permissão<select name="role"><option value="viewer">Somente leitura</option><option value="manager">Gestor</option>'+
  (mayPromote?'<option value="admin">Administrador da empresa</option>':'')+'</select></label>'+
  '<label>Senha inicial (mínimo 12 caracteres)<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>'+
  '<button type="submit" class="btn primary">Cadastrar colaborador</button>'+
  '<p class="form-note">Informe a senha inicial por um canal seguro; o colaborador poderá trocá-la em Minha conta.</p></form></section>':'';
 view.innerHTML=heading('ADMINISTRAÇÃO','Usuários da empresa.',
  'Gerencie quem pode acessar o sistema e quais recursos cada pessoa pode utilizar.')+
 (mayInvite?'<div class="socio-user-header"><button type="button" class="btn primary" id="teamInviteToggle">+ Adicionar usuário</button></div>':'')+
 (mayView?'<div class="socio-team-grid">'+members+invite+'</div>':'');
 $('#teamInviteToggle')?.addEventListener('click',()=>{const panel=$('#teamInvitePanel');if(panel){panel.hidden=!panel.hidden;if(!panel.hidden)panel.querySelector('input')?.focus();}});
 $('#teamForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget;
  await action(async()=>{
   await api('/api/team','POST',formValues(form));
   toast('Colaborador cadastrado com acesso restrito à empresa.');await team();
  });
 });
 $$('[data-team-toggle]').forEach(btn=>btn.addEventListener('click',async()=>{
  const active=btn.dataset.teamActive==='true';
  if(!active&&!confirm('Desativar este usuário e encerrar todas as suas sessões?'))return;
  await action(async()=>{
   await api('/api/team/'+btn.dataset.teamToggle,'PATCH',{active});
   toast(active?'Acesso reativado.':'Acesso desativado e sessões encerradas.');await team();
  });
 }));
 $$('[data-team-select]').forEach(select=>select.addEventListener('change',async()=>{
  const nextRole=select.value;
  if(!confirm('Alterar a permissão para '+roleLabel(nextRole)+'?')){await team();return;}
  await action(async()=>{await api('/api/team/'+select.dataset.teamSelect,'PATCH',{role:nextRole});toast('Permissão atualizada.');await team();});
 }));
}
function featureChecks(flags={},prefix='feature-'){
 return '<div class="feature-grid" role="group" aria-label="Funcionalidades da empresa">'+
  featureKeys.map(key=>'<label class="feature-choice"><input type="checkbox" name="'+prefix+key+
   '" '+(flags[key]!==false?'checked':'')+'><span><strong>'+e(featureLabels[key])+
   '</strong><small>'+(key==='meta_ads'?'Sessão de navegador do Ads Manager':'Ativar neste ambiente')+
   '</small></span></label>').join('')+'</div>';
}
function selectedFeatures(form,prefix='feature-'){
 return Object.fromEntries(featureKeys.map(key=>[key,form.elements[prefix+key]?.checked===true]));
}
async function admin(){
 const [tenants,monitor]=await Promise.all([
  api('/api/admin/tenants'),api('/api/admin/monitor').catch(()=>null)
 ]);
 const monitorById=new Map((monitor?.tenants||[]).map(t=>[t.id,t]));
 const trialLabel=t=>{
  if(t.status!=='trial')return '—';
  const entry=monitorById.get(t.id);
  if(!entry)return 'Não avaliado';
  return entry.trial.elapsed?'Janela encerrada (sem bloqueio)':entry.trial.daysRemaining+' dia(s) restantes';
 };
 const rows=tenants.map(t=>
  '<tr data-company-row data-company-name="'+e((t.name||'').toLowerCase()+' '+(t.slug||'').toLowerCase())+'" data-company-plan="'+e(t.plan)+'" data-company-status="'+e(t.status)+'">'+
   '<td><strong>'+e(t.name)+'</strong><div class="table-detail">'+
   e(t.cnpj||t.slug)+' · '+e(t.members)+' usuário(s)</div></td>'+
   '<td>'+badge(({essencial:'Essencial',equipe:'Equipe',voz:'Voz'})[t.plan]||t.plan)+'</td>'+
   '<td>'+badge(({active:'Ativa',trial:'Em teste',paused:'Pausada'})[t.status]||t.status,t.status==='active'?'green':'gray')+'</td><td>'+e(trialLabel(t))+'</td>'+
   '<td><div class="master-company-edit"><button type="button" class="btn sm soft" data-company-edit="'+e(t.id)+'">Editar</button> '+
   '<button type="button" class="btn sm soft" data-feature-edit="'+e(t.id)+'">Funcionalidades</button> '+
   '<button type="button" class="btn sm ghost" data-switch="'+e(t.id)+'">'+
   (t.id===state.me.tenant.id?'Abrir meu ambiente':'Abrir produção')+'</button></div></td></tr>').join('');
 view.innerHTML=heading('PAINEL MASTER','Empresas.','Consulte clientes, edite planos cadastrais e gerencie os módulos de cada ambiente.',
  '<button type="button" class="btn primary" id="newCompany">+ Nova empresa</button>')+
 '<section class="card card-pad socio-list-panel"><div class="socio-clean-head"><h2>Empresas cadastradas</h2><small>'+tenants.length+' ambientes</small></div>'+
 '<div class="master-company-filters" aria-label="Filtrar empresas">'+
 '<input id="masterCompanySearch" type="search" placeholder="Buscar por nome ou identificador..." aria-label="Buscar empresas">'+
 '<select id="masterCompanyStatus" aria-label="Filtrar por situação"><option value="">Todas as situações</option><option value="active">Ativas</option><option value="trial">Em teste</option><option value="paused">Pausadas</option></select>'+
 '<select id="masterCompanyPlan" aria-label="Filtrar por plano"><option value="">Todos os planos</option><option value="essencial">Essencial</option><option value="equipe">Equipe</option><option value="voz">Voz</option></select></div>'+
 '<div class="table-wrap"><table class="data-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Situação</th><th>Teste 7 dias</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
 '<div class="master-company-summary" id="masterCompanyShown">'+tenants.length+' empresas exibidas</div></section>'+
 '<div class="socio-popup-backdrop hidden" id="companyModal"><section class="socio-popup-surface socio-company-popup" role="dialog" aria-modal="true" aria-labelledby="companyHeading">'+
  '<div class="socio-popup-header"><div><small>ADMINISTRAÇÃO MASTER</small><h2 id="companyHeading">Nova empresa</h2>'+
  '<p>Consulte o CNPJ para preencher os dados públicos automaticamente.</p></div>'+
  '<button type="button" class="socio-popup-close" id="companyClose" aria-label="Fechar cadastro">×</button></div>'+
  '<form id="tenantForm" class="form-stack">'+
   '<div class="socio-cnpj-lookup"><label>CNPJ ou CPF (opcional)<input name="cnpj" maxlength="18" placeholder="00.000.000/0000-00" inputmode="numeric"></label>'+
   '<button type="button" class="btn soft" id="lookupCnpj">Buscar CNPJ</button></div>'+
   '<p class="form-note" id="cnpjFeedback" role="status">O CNPJ preenche os dados públicos automaticamente. CPF não tem consulta pública — preencha manualmente. O teste de 7 dias vale uma vez por CPF/CNPJ, telefone e e-mail.</p>'+
   '<label>Nome da empresa<input name="company" required maxlength="120" placeholder="Ex.: Pizzaria Bella"></label>'+
   '<div class="catalog-pair"><label>Razão social<input name="legalName" maxlength="200"></label>'+
   '<label>Nome fantasia<input name="tradeName" maxlength="200"></label></div>'+
   '<div class="catalog-pair"><label>Telefone comercial<input name="companyPhone" maxlength="30" placeholder="Opcional"></label>'+
   '<label>E-mail comercial<input name="companyEmail" maxlength="150" placeholder="Opcional"></label></div>'+
   '<label>Endereço (informação pública do cadastro)<textarea name="companyAddress" rows="2" maxlength="500" placeholder="Rua, número, bairro, cidade e UF" readonly></textarea></label>'+
   '<div class="socio-popup-divider"><span>ACESSO DO RESPONSÁVEL</span></div>'+
   '<label>Nome do responsável<input name="ownerName" required maxlength="100"></label>'+
   '<label>E-mail do responsável (login)<input name="ownerEmail" required type="email" maxlength="255"></label>'+
   '<div class="catalog-pair"><label>Celular para login<input name="ownerPhone" type="tel" maxlength="32" placeholder="Com DDD"></label>'+
   '<label>Plano<select name="plan"><option value="essencial">Essencial</option><option value="equipe">Equipe</option><option value="voz">Voz</option></select></label></div>'+
   '<div class="socio-popup-divider"><span>FUNCIONALIDADES DA EMPRESA</span></div>'+
   '<p class="form-note">Selecione somente os módulos contratados. Você poderá alterar depois.</p>'+
   featureChecks()+
   '<label>Senha inicial (mínimo 12 caracteres)<input name="ownerPassword" required type="password" minlength="12" maxlength="128" autocomplete="new-password"></label>'+
   '<p class="form-note">O cadastro cria um ambiente separado. Cobrança não é ativada automaticamente.</p>'+
   '<button class="btn primary socio-full-btn" type="submit">Criar empresa</button>'+
  '</form></section></div>'+
  '<div class="socio-popup-backdrop hidden" id="featuresModal"><section class="socio-popup-surface socio-company-popup" role="dialog" aria-modal="true" aria-labelledby="featuresHeading">'+
  '<div class="socio-popup-header"><div><small>CONFIGURAÇÕES DO CLIENTE</small><h2 id="featuresHeading">Funcionalidades</h2>'+
  '<p>Os módulos desmarcados ficam ocultos e bloqueados também na API, sem apagar dados existentes.</p></div>'+
  '<button type="button" id="featuresClose" class="socio-popup-close" aria-label="Fechar funcionalidades">×</button></div>'+
  '<form id="featuresForm" class="form-stack">'+
  '<div id="featuresChoices"></div>'+
  '<button type="submit" class="btn primary socio-full-btn">Salvar funcionalidades</button>'+
  '</form></section></div>'+
 '<div class="socio-popup-backdrop hidden" id="companyEditModal"><section class="socio-popup-surface socio-company-popup" role="dialog" aria-modal="true" aria-labelledby="companyEditHeading">'+
 '<div class="socio-popup-header"><div><small>ADMINISTRAÇÃO MASTER</small><h2 id="companyEditHeading">Editar empresa</h2><p>Atualize somente o cadastro da empresa e seu plano. A cobrança permanece independente.</p></div>'+
 '<button type="button" class="socio-popup-close" id="companyEditClose" aria-label="Fechar edição">×</button></div>'+
 '<form id="companyEditForm" class="form-stack">'+
 '<label>Nome da empresa<input name="name" required maxlength="120"></label>'+
 '<label>Plano cadastral<select name="plan" required><option value="essencial">Essencial</option><option value="equipe">Equipe</option><option value="voz">Voz</option></select></label>'+
 '<p class="master-company-edit-note">Alterar o plano cadastral não gera cobrança, não modifica uma assinatura Stripe e não suspende a empresa.</p>'+
 '<button type="submit" class="btn primary socio-full-btn">Salvar alterações</button></form></section></div>';
 // Filtering is local to the authorized tenant list; no cross-tenant writes.
 const applyCompanyFilters=()=>{
  const keyword=($('#masterCompanySearch')?.value||'').trim().toLocaleLowerCase('pt-BR');
  const status=$('#masterCompanyStatus')?.value||'',plan=$('#masterCompanyPlan')?.value||'';
  let visible=0;
  view.querySelectorAll('[data-company-row]').forEach(row=>{
   const matches=(!keyword||row.dataset.companyName.includes(keyword))&&
    (!status||row.dataset.companyStatus===status)&&(!plan||row.dataset.companyPlan===plan);
   row.hidden=!matches;if(matches)visible++;
  });
  const count=$('#masterCompanyShown');if(count)count.textContent=visible+' de '+tenants.length+' empresas';
 };
 ['masterCompanySearch','masterCompanyStatus','masterCompanyPlan'].forEach(id=>
  document.getElementById(id)?.addEventListener(id==='masterCompanySearch'?'input':'change',applyCompanyFilters));
 try{
  const saved=sessionStorage.getItem('socio:master-plan-filter');
  if(saved&&['essencial','equipe','voz'].includes(saved))$('#masterCompanyPlan').value=saved;
  sessionStorage.removeItem('socio:master-plan-filter');
 }catch{}
 applyCompanyFilters();
 const editModal=$('#companyEditModal'),editForm=$('#companyEditForm');let editingCompany=null;
 const closeCompanyEdit=()=>{editModal.classList.add('hidden');editingCompany=null;};
 $('#companyEditClose')?.addEventListener('click',closeCompanyEdit);
 editModal?.addEventListener('click',ev=>{if(ev.target===editModal)closeCompanyEdit();});
 view.querySelectorAll('[data-company-edit]').forEach(button=>button.addEventListener('click',()=>{
  const tenant=tenants.find(t=>t.id===button.dataset.companyEdit);
  if(!tenant)return;
  editingCompany=tenant.id;
  $('#companyEditHeading').textContent='Editar · '+tenant.name;
  editForm.elements.name.value=tenant.name;
  editForm.elements.plan.value=tenant.plan;
  editModal.classList.remove('hidden');editForm.elements.name.focus();
 }));
 editForm?.addEventListener('submit',async event=>{
  event.preventDefault();if(!editingCompany)return;
  const values=formValues(editForm);
  const original=tenants.find(t=>t.id===editingCompany);
  if(!original)return;
  if((values.plan!==original.plan)&&!confirm('Alterar o plano cadastral desta empresa para '+values.plan+'? Isso não efetua cobranças.'))return;
  const submit=editForm.querySelector('[type="submit"]');submit.disabled=true;
  try{
   await api('/api/admin/tenants/'+editingCompany,'PATCH',{name:values.name,plan:values.plan});
   toast('Cadastro e plano atualizados.');closeCompanyEdit();await admin();
  }catch(error){toast(errMsg(error),true);}
  finally{submit.disabled=false;}
 });
 const modal=$('#companyModal'),form=$('#tenantForm');
 let publicProfile=null;
 const open=()=>{modal.classList.remove('hidden');form.elements.cnpj.focus();};
 const close=()=>modal.classList.add('hidden');
 $('#newCompany').addEventListener('click',open);
 $('#companyClose').addEventListener('click',close);
 modal.addEventListener('click',ev=>{if(ev.target===modal)close();});
 const taxDigits=()=>globalThis.SocioTrialInput.taxIdDigits(form.elements.cnpj.value);
 const cpfIsValid=value=>globalThis.SocioTrialInput.cpfIsValid(value);
 let lookupTimer=null,lookedUp=null;
 const lookupCnpj=async()=>{
  const cnpj=taxDigits();
  const feedback=$('#cnpjFeedback'),btn=$('#lookupCnpj');
  if(cnpj.length!==14){feedback.textContent='Digite o CNPJ (14 dígitos) ou o CPF (11 dígitos).';return;}
  if(cnpj===lookedUp&&publicProfile)return;
  btn.disabled=true;feedback.textContent='Buscando dados públicos do CNPJ...';
  try{
   const result=await api('/api/admin/cnpj?number='+encodeURIComponent(cnpj));
   lookedUp=cnpj;publicProfile=result;
   if(!form.elements.company.value)form.elements.company.value=result.company||result.legalName||'';
   form.elements.legalName.value=result.legalName||'';
   form.elements.tradeName.value=result.tradeName||'';
   if(!form.elements.companyPhone.value)form.elements.companyPhone.value=result.phone||'';
   if(!form.elements.companyEmail.value)form.elements.companyEmail.value=result.email||'';
   const a=result.address||{};
   form.elements.companyAddress.value=[a.street,a.number,a.additional,a.neighborhood,a.city,a.state,a.postalCode].filter(Boolean).join(', ');
   feedback.textContent='Dados encontrados: '+(result.legalName||result.company)+'. Confira e complete o acesso do responsável.';
  }catch(error){publicProfile=null;lookedUp=null;feedback.textContent=errMsg(error)+' Você pode preencher manualmente.';}
  finally{btn.disabled=false;}
 };
 $('#lookupCnpj').addEventListener('click',lookupCnpj);
 form.elements.cnpj.addEventListener('input',()=>{
  publicProfile=null;clearTimeout(lookupTimer);
  const digits=taxDigits(),feedback=$('#cnpjFeedback');
  if(digits.length===11){
   feedback.textContent=cpfIsValid(digits)?
    'CPF válido. Não há consulta pública de CPF: preencha os dados da empresa manualmente.':
    'CPF inválido; confira os 11 dígitos.';
   return;
  }
  if(digits.length!==14){
   if(digits)feedback.textContent='Digite todo o CNPJ (14 dígitos) ou o CPF (11 dígitos).';
   return;
  }
  feedback.textContent='Buscando dados públicos do CNPJ...';
  lookupTimer=setTimeout(lookupCnpj,400);
 });
 form.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const data=formValues(form);
  data.features=selectedFeatures(form);
  data.companyProfile=publicProfile?.cnpj===data.cnpj.replace(/\D/g,'')?
   {address:publicProfile.address,primaryActivity:publicProfile.primaryActivity,status:publicProfile.status,
    commercialEmail:data.companyEmail,commercialPhone:data.companyPhone}:
   {commercialEmail:data.companyEmail,commercialPhone:data.companyPhone};
  await action(async()=>{
   const created=await api('/api/admin/tenants','POST',data);
   toast(created?.trial?.granted?
    'Empresa cadastrada. Teste grátis de '+created.trial.days+' dias liberado.':
    'Empresa cadastrada sem teste grátis: o CPF/CNPJ, telefone ou e-mail já usou o período de teste.');
   close();await admin();
  });
 });
 const featureModal=$('#featuresModal'),featureForm=$('#featuresForm');
 let editingTenant=null;
 const closeFeatures=()=>{featureModal.classList.add('hidden');editingTenant=null;};
 $('#featuresClose').addEventListener('click',closeFeatures);
 featureModal.addEventListener('click',ev=>{if(ev.target===featureModal)closeFeatures();});
 view.querySelectorAll('[data-feature-edit]').forEach(b=>b.addEventListener('click',()=>{
  const tenant=tenants.find(x=>x.id===b.dataset.featureEdit);
  if(!tenant)return;
  editingTenant=tenant.id;
  $('#featuresHeading').textContent='Funcionalidades · '+tenant.name;
  $('#featuresChoices').innerHTML=featureChecks(tenant.features,'edit-feature-');
  featureModal.classList.remove('hidden');
  $('#featuresClose').focus();
 }));
 featureForm.addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(!editingTenant)return;
  const data={features:selectedFeatures(featureForm,'edit-feature-')};
  const submit=featureForm.querySelector('[type="submit"]');
  submit.disabled=true;
  try{
   await api('/api/admin/tenants/'+editingTenant+'/features','PUT',data);
   toast('Funcionalidades atualizadas com sucesso.');
   closeFeatures();await admin();
  }catch(error){toast(errMsg(error),true);}
  finally{submit.disabled=false;}
 });
 view.querySelectorAll('[data-switch]').forEach(b=>b.addEventListener('click',()=>action(async()=>{
  await api('/api/admin/switch','POST',{tenantId:b.dataset.switch});
  // Reload the isolated production environment after selecting a company.
  location.assign(workspaceUrl('production','overview'));
 })));
}
async function action(fn){try{await fn();}catch(err){toast(errMsg(err),true);}}

const sidebarIcons={
 overview:'<rect x="3" y="3" width="8" height="8" rx="1.7"/><rect x="13" y="3" width="8" height="8" rx="1.7"/><rect x="3" y="13" width="8" height="8" rx="1.7"/><rect x="13" y="13" width="8" height="8" rx="1.7"/>',
 connections:'<rect x="3" y="4" width="8" height="6" rx="2"/><rect x="13" y="14" width="8" height="6" rx="2"/><path d="M11 7h3a4 4 0 0 1 4 4v2M13 17H9a4 4 0 0 1-4-4v-2"/>',
 inbox:'<path d="M4 4h16v12h-5l-3 3-3-3H4z"/><path d="M7 9h10M7 12h7"/>',
 instagram:'<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.6 6.7h.01"/>',
 reports:'<path d="M4 20V11m5 9V5m5 15v-7m5 7V8"/><path d="M2 21h20"/>',
 marketing:'<path d="M3 21V8l9-5 9 5v13M7 14v4M12 11v7M17 13v5"/>',
 channels:'<path d="M6 18c-2-1.7-3-4.1-3-6.6C3 6.6 6.7 3 12 3s9 3.6 9 8.4c0 4.5-3.7 8.6-9 8.6-1.6 0-3.2-.3-4.4-1L3 21z"/><path d="M9 9c.4 2.6 2.4 4.7 5 5l1.4-1.5"/>',
 products:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 10h18M10 3v18"/>',
 training:'<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8m8.6 8.6 2.8 2.8M2 12h4m12 0h4M4.9 19.1l2.8-2.8m8.6-8.6 2.8-2.8"/><circle cx="12" cy="12" r="3.4"/>',
 agent:'<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"/>',
 orb:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1"/>',
 team:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1c0-3.6 2.5-5 6-5s6 1.4 6 5v1z"/><path d="M17 5a3 3 0 0 1 0 6m1 4c2 .5 3 1.8 3 4v1"/>',
 admin:'<path d="M3 21V5l9-3 9 3v16M3 21h18M9 21v-5h6v5M7 9h2m6 0h2M7 13h2m6 0h2"/>',
 masterOverview:'<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>',
 masterPlans:'<path d="M4 20V11m5 9V5m5 15v-7m5 7V8"/><path d="M2 21h20"/>',
 logout:'<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 7l5 5-5 5M9 12h10"/>'
};
function initSidebarIcons(){
 $$('.nav-item[data-view],#logoutBtn').forEach(b=>{
  const kind=b.dataset.view||'logout';
  const holder=b.querySelector('.nav-symbol');
  if(!holder)return;
  holder.innerHTML='<svg viewBox="0 0 24 24" role="img" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(sidebarIcons[kind]||sidebarIcons.overview)+'</svg>';
  b.title=kind==='logout'?'Sair':titles[kind]||'Sócio';
  b.setAttribute('aria-label',b.title);
 });
}
function renderCommandItems(){
 const input=$('#commandSearch');
 const keyword=input.value.trim().toLocaleLowerCase('pt-BR');
 const names=Object.entries(titles).filter(([key,label])=>
  key!=='agent'&&key!=='channels'&&key!=='reports'&&viewAvailable(key)&&
  (isMasterView()?masterViews.has(key):!masterViews.has(key))&&
  (key!=='marketing'||(state.me?.user?.permissions||[]).includes('marketing.read'))&&
  (key!=='reports'||(state.me?.user?.permissions||[]).includes('audit.read'))&&
  (key!=='training'||(state.me?.user?.permissions||[]).includes('training.manage'))&&
  (key!=='team'||ownAccountAvailable())&&
  (!masterViews.has(key)||isPrimaryMaster())&&
  (label.toLocaleLowerCase('pt-BR').includes(keyword)||key.includes(keyword)));
 const list=$('#commandList');
 list.innerHTML=names.length?names.map(([key,label])=>
  '<button class="command-item" type="button" data-search-view="'+e(key)+'"><span class="command-item-icon">✳</span>'+
  '<span>'+e(label)+'</span><span class="command-item-arrow">↗</span></button>').join(''):
  '<div class="command-empty">Nenhuma seção encontrada.</div>';
 list.querySelectorAll('[data-search-view]').forEach(b=>b.addEventListener('click',()=>{
  closeCommand();changeView(b.dataset.searchView);
 }));
}
function openCommand(){
 if(!state.me)return;
 $('#commandOverlay').classList.remove('hidden');
 $('#commandSearch').value='';
 renderCommandItems();$('#commandSearch').focus();
}
function closeCommand(){
 $('#commandOverlay').classList.add('hidden');
 $('#quickSearchBtn').focus();
}
$('#quickSearchBtn').addEventListener('click',openCommand);
$('#commandClose').addEventListener('click',closeCommand);
$('#commandSearch').addEventListener('input',renderCommandItems);
$('#commandOverlay').addEventListener('click',event=>{
 if(event.target===$('#commandOverlay'))closeCommand();
});
document.addEventListener('keydown',event=>{
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
  event.preventDefault();if($('#commandOverlay').classList.contains('hidden'))openCommand();else closeCommand();
 }
 if(event.key==='Escape'&&!$('#commandOverlay').classList.contains('hidden'))closeCommand();
});
initSidebarIcons();
async function switchWorkspace(mode){
 if(!isPrimaryMaster())return;
 const nextMode=mode==='master'?'master':'production';
 if(nextMode===state.workspace)return;
 const switcher=$('#workspaceSwitcher');
 if(switcher?.dataset.busy==='true')return;
 if(switcher)switcher.dataset.busy='true';
 const root=document.documentElement;
 root.classList.add('socio-workspace-switching');
 try{
  // Master always opens on the platform owner's home tenant, not a customer.
  const homeTenantId=state.me.user.homeTenantId;
  if(nextMode==='master'&&state.me.tenant.id!==homeTenantId){
   await api('/api/admin/switch','POST',{tenantId:homeTenantId});
   state.me=await api('/api/me');state.csrf=state.me.csrf;
  }
  state.workspace=nextMode;
  view.classList.remove('socio-workspace-enter');
  void view.offsetWidth;
  view.classList.add('socio-workspace-enter');
  setTimeout(()=>view.classList.remove('socio-workspace-enter'),760);
  if(isMasterView())globalThis.SocioThalitaUI?.unmount();
  else globalThis.SocioThalitaUI?.mount({client:api,auth:state.me,csrfToken:state.csrf});
  await changeView(nextMode==='master'?'masterOverview':'overview');
  updateWorkspaceUrl();
 }catch(error){toast(errMsg(error),true);}
 finally{
  if(switcher)delete switcher.dataset.busy;
  syncMasterSwitch();
  setTimeout(()=>root.classList.remove('socio-workspace-switching'),640);
 }
}
$('#workspaceSwitcher')?.addEventListener('click',event=>{
 const target=event.target.closest?.('[data-workspace-target]');
 if(target)switchWorkspace(target.dataset.workspaceTarget);
});
$('#workspaceSwitcher')?.addEventListener('keydown',event=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 const tabs=$$('#workspaceSwitcher [data-workspace-target]');
 const current=tabs.indexOf(document.activeElement);
 event.preventDefault();
 const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
  (current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 tabs[next]?.focus();
});

const loginPassword=$('#loginPassword'),togglePassword=$('#togglePassword'),capsWarning=$('#capsWarning');
togglePassword.addEventListener('click',()=>{
 const reveal=loginPassword.type==='password';
 loginPassword.type=reveal?'text':'password';
 togglePassword.textContent=reveal?'Ocultar':'Mostrar';
 togglePassword.setAttribute('aria-pressed',String(reveal));
 loginPassword.focus();
});
loginPassword.addEventListener('keyup',ev=>{
 capsWarning.classList.toggle('hidden',!ev.getModifierState('CapsLock'));
});
loginPassword.addEventListener('blur',()=>capsWarning.classList.add('hidden'));
$('#loginForm').addEventListener('submit',async ev=>{
 ev.preventDefault();$('#authError').textContent='';
 const form=ev.currentTarget,submit=$('#loginSubmit');
 if(submit.disabled)return;
 submit.disabled=true;submit.setAttribute('aria-busy','true');submit.textContent='Entrando com segurança…';
 try{
  const data=await api('/api/login','POST',formValues(form));
  state.csrf=data.csrf;
  await boot();
 }catch(err){
  $('#authError').textContent=errMsg(err);
  $('#authError').focus();
 }finally{
  submit.disabled=false;submit.removeAttribute('aria-busy');
  submit.innerHTML='Entrar no Sócio <span aria-hidden="true">→</span>';
 }
});
$('#setupForm').addEventListener('submit',async ev=>{
 ev.preventDefault();$('#authError').textContent='';
 try{const data=await api('/api/setup','POST',formValues(ev.currentTarget));state.csrf=data.csrf;await boot();}
 catch(err){$('#authError').textContent=errMsg(err);}
});
$$('.nav-item[data-view]').forEach(b=>b.addEventListener('click',()=>{
 if(b.dataset.view==='training')state.aiTab='training';
 changeView(b.dataset.view);
}));
$('#logoutBtn').addEventListener('click',async()=>{globalThis.SocioWorkspaceUI?.clearCache();globalThis.SocioThalitaUI?.unmount();globalThis.SocioOrbUI?.dispose();document.body?.classList?.remove('socio-orb-view');try{await api('/api/logout','POST',{});}catch{}state.me=null;state.csrf='';state.view='overview';boot();});
boot();
