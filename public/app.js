
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const state={me:null,view:'overview',dashboard:null,csrf:'',currentConversation:null,aiTab:'training'};
const titles={overview:'Visão geral',inbox:'WhatsApp',channels:'WhatsApps',products:'Produtos e serviços',training:'Inteligência Artificial',agent:'Meu Sócio',team:'Equipe',admin:'Empresas'};
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
async function api(path,method='GET',body){
 const opts={method,credentials:'same-origin',headers:{'Accept':'application/json'}};
 if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
 if(method!=='GET'&&state.csrf)opts.headers['X-CSRF-Token']=state.csrf;
 const resp=await fetch(path,opts);
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
function setLoading(){view.innerHTML='<div class="loading">Preparando seu espaço...</div>';}
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
   $('#authScreen').classList.add('hidden');$('#appShell').classList.remove('hidden');
   $('#workspaceName').textContent=me.tenant.name;
   $('#workspaceInitial').textContent=(me.tenant.name[0]||'S').toUpperCase();
   $('#userChip').textContent=me.user.name.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
   $('#userName').textContent=me.user.name;
   $('#userRole').textContent=me.user.platformOwner?'Administrador master':me.user.role==='owner'?'Proprietário':'Equipe da empresa';
   $('#adminNav').classList.toggle('hidden',!me.user.platformOwner);
   $('#teamNav')?.classList.toggle('hidden',!!me.user.platformOwner);
   await changeView(state.view);
  }catch(error){state.me=null;state.csrf='';setupAuth(bootstrap.initialized);}
 }catch(error){setupAuth(true);$('#authError').textContent='Não foi possível conectar ao servidor. '+errMsg(error);}
}
async function changeView(next){
 if(next!=='inbox'&&activeInbox){activeInbox.cleanup();activeInbox=null;}
 if(next==='agent'){state.aiTab='agent';next='training';}
 else if(next==='training'&&state.view!=='training')state.aiTab='training';
 clearTimeout(trainingTimer);clearTimeout(waQrTimer);
 if(next==='admin'&&!state.me?.user.platformOwner)return;
 if(next==='team'&&state.me?.user.platformOwner)return;
 state.view=next;
 $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===next));
 $('#topTitle').textContent=titles[next]||'Sócio';
 setLoading();
 try{
  if(next==='overview')await overview();
  if(next==='channels')await channels();
  if(next==='products')await products();
  if(next==='training')await (state.aiTab==='agent'?agent():training());
  if(next==='inbox')await inbox();
  if(next==='team')await team();
  if(next==='admin')await admin();
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
 const [d,trend,recent,links]=await Promise.all([
  api('/api/dashboard'),api('/api/dashboard/activity?range=1m'),api('/api/inbox'),api('/api/waakg/channels')
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
    '<p class="ember-qr-disclaimer">Conexão por QR Code. Leitura e análise do histórico autorizadas; envio externo ainda desativado.</p>'+
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
 const canManage=state.me.user.platformOwner||['owner','admin'].includes(state.me.user.role);
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
const centsFromInput=text=>{
 const raw=String(text??'').trim().replace(',','.');
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(raw))throw Error('Preço inválido. Use, por exemplo, 129.90.');
 return Math.round(Number(raw)*100);
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
function catalogVariantRow(variant={}){
 return '<div class="catalog-variant-row" data-variant-row>'+
  '<input data-variant-name aria-label="Nome da variação" maxlength="100" placeholder="Tamanho, cor ou modelo" value="'+e(variant.name||'')+'">'+
  '<input data-variant-price aria-label="Preço da variação" type="number" min="0" step="0.01" placeholder="Preço R$" value="'+e(variant.price_cents===undefined?'':(variant.price_cents/100).toFixed(2))+'">'+
  '<input data-variant-stock aria-label="Estoque da variação" type="number" min="0" step="1" placeholder="Estoque" value="'+e(variant.stock_quantity??'')+'">'+
  '<input data-variant-sku aria-label="SKU da variação" maxlength="50" placeholder="SKU opcional" value="'+e(variant.sku||'')+'">'+
  '<button type="button" class="btn sm ghost" data-remove-variant aria-label="Excluir variação">×</button>'+
 '</div>';
}
async function products(selected=null){
 const [list,storage]=await Promise.all([api('/api/products'),api('/api/products/storage')]);
 if(selected&&!list.some(p=>p.id===selected))selected=null;
 state.catalogProductId=selected&&selected!=='new'?selected:null;
 const current=list.find(p=>p.id===selected);
 const photo=p=>p.media?.length?'<img class="catalog-cover-image" src="'+e(p.media[0].url)+'" alt="'+e(p.media[0].alt||p.name)+'" loading="lazy">':
   '<div class="catalog-placeholder">◈</div>';
 const productCards=list.length?'<div class="catalog-list">'+list.map(p=>{
  const stockedVariants=p.variants?.filter(v=>v.active!==false)||[];
  const available=p.active&&(stockedVariants.length?stockedVariants.some(v=>v.stock_quantity===null||v.stock_quantity>0):(p.stock_quantity===null||p.stock_quantity>0));
  return '<button type="button" class="catalog-product '+(selected===p.id?'is-selected':'')+'" data-select-product="'+e(p.id)+'">'+
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
   (current.campaigns.length?'<div class="catalog-campaign-list">'+current.campaigns.map(c=>
     '<div><strong>'+e(c.provider==='meta_ads'?'Meta Ads':'Google Ads')+'</strong> · '+e(c.label||c.campaign_id)+
     '<span class="form-note"> '+e(c.campaign_id)+' · Não verificada</span>'+
     '<button class="btn sm ghost" data-delete-campaign="'+e(c.id)+'">Remover</button></div>').join('')+'</div>':'')+
   '<form id="catalogCampaignForm" class="form-stack"><label>Plataforma<select name="provider"><option value="meta_ads">Meta Ads</option><option value="google_ads">Google Ads</option></select></label>'+
   '<label>ID da campanha<input name="campaignId" maxlength="150" required placeholder="Identificador na plataforma"></label>'+
   '<label>Nome interno<input name="label" maxlength="120" placeholder="Ex.: Campanha Black Friday"></label>'+
   '<button class="btn soft" type="submit">Associar campanha →</button></form></section>':'';
 const modalOpen=selected==='new'||Boolean(current);
 view.innerHTML=heading('CATÁLOGO','Produtos e serviços.','Catálogo, preços e disponibilidade da empresa.',
  '<button class="btn primary" id="newProduct">+ Novo produto</button>')+
  '<section class="card card-pad socio-catalog-clean">'+
   '<div class="socio-clean-head"><h2>Seu catálogo</h2><small>'+list.length+' produto(s) cadastrado(s)</small></div>'+
   productCards+'</section>'+
  '<div class="socio-popup-backdrop'+(modalOpen?'':' hidden')+'" id="productModal" role="presentation">'+
   '<section class="socio-popup-surface socio-product-popup" role="dialog" aria-modal="true" aria-labelledby="productFormTitle">'+
    '<div class="socio-popup-header"><div><small>CATÁLOGO DA EMPRESA</small>'+
    '<h2 id="productFormTitle">'+(current?'Editar produto':'Novo produto')+'</h2>'+
    '<p>Preencha as informações do produto. Fotos e variações ficam no mesmo lugar.</p></div>'+
    '<button type="button" class="socio-popup-close" id="closeProductModal" aria-label="Fechar cadastro">×</button></div>'+
    '<form class="form-stack" id="productForm">'+
     '<label>Nome ou título do produto<input name="name" required maxlength="120" placeholder="Ex.: Kit profissional" value="'+e(current?.name||'')+'"></label>'+
     '<div class="catalog-pair"><label>Preço (R$)<input name="price" required type="number" min="0" step="0.01" value="'+e(current?(current.price_cents/100).toFixed(2):'')+'"></label>'+
     '<label>Preço anterior (opcional)<input name="compareAtPrice" type="number" min="0" step="0.01" value="'+e(current?.compare_at_price_cents!=null?(current.compare_at_price_cents/100).toFixed(2):'')+'"></label></div>'+
     '<div class="catalog-pair"><label>Código / SKU<input name="sku" maxlength="50" placeholder="Opcional" value="'+e(current?.sku||'')+'"></label>'+
     '<label>Estoque disponível<input name="stock" type="number" min="0" step="1" placeholder="Sem controle" value="'+e(current?.stock_quantity??'')+'"></label></div>'+
     '<label>Descrição do produto<textarea name="description" maxlength="1200" placeholder="Características, benefícios e condições...">'+e(current?.description||'')+'</textarea></label>'+
     '<label>Disponibilidade<select name="active"><option value="true"'+(current?.active===false?'':' selected')+'>Disponível</option>'+
       '<option value="false"'+(current?.active===false?' selected':'')+'>Indisponível</option></select></label>'+
     (!current?'<label>Fotos do produto (JPG, PNG, WebP; até 8)<input type="file" name="newPhotos" accept="image/jpeg,image/png,image/webp" multiple '+(!storage.configured?'disabled':'')+'></label>'+
     '<div class="socio-clean-section"><h3>Variações</h3><div id="newVariantRows"></div>'+
      '<button class="btn soft" id="addNewVariant" type="button">+ Adicionar variação</button></div>':'')+
     '<div class="form-actions"><button class="btn primary" type="submit">'+(current?'Salvar alterações':'Cadastrar produto')+'</button>'+
      (current?'<button class="btn ghost" type="button" id="clearProduct">Novo produto</button>':'')+'</div>'+
    '</form>'+
    (current?detail:'')+
   '</section></div>';
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
 if(modalOpen)$('#productForm')?.elements?.name?.focus();
 view.querySelectorAll('[data-select-product]').forEach(btn=>btn.addEventListener('click',()=>products(btn.dataset.selectProduct)));
 $('#clearProduct')?.addEventListener('click',()=>products(null));
 $('#productForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget,d=formValues(form);
  await action(async()=>{
   const data={name:d.name,description:d.description,sku:d.sku,
    priceCents:centsFromInput(d.price),compareAtPriceCents:d.compareAtPrice?centsFromInput(d.compareAtPrice):null,
    stockQuantity:stockFromInput(d.stock),active:d.active==='true'};
   const result=await api(current?'/api/products/'+current.id:'/api/products',current?'PATCH':'POST',data);
   const productId=current?.id||result.id;
   if(!current){
    const variants=[...form.querySelectorAll('#newVariantRows [data-variant-row]')].map(row=>{
     const get=selector=>row.querySelector(selector)?.value||'';
     return {name:get('[data-variant-name]'),sku:get('[data-variant-sku]'),
      priceCents:centsFromInput(get('[data-variant-price]')),
      stockQuantity:stockFromInput(get('[data-variant-stock]')),active:true};
    });
    if(variants.length)await api('/api/products/'+productId+'/variants','PUT',{variants});
    const photos=[...(form.elements.newPhotos?.files||[])];
    if(photos.length>8)throw Error('Máximo de oito fotos por produto.');
    for(const file of photos){
     const contentBase64=await compressCatalogImage(file);
     await api('/api/products/'+productId+'/media','POST',{contentBase64,alt:d.name});
    }
   }
   toast('Catálogo atualizado.');await products(productId);
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
   const rows=[...$('#catalogVariantRows').querySelectorAll('[data-variant-row]')];
   const variants=rows.map(row=>{
    const get=selector=>row.querySelector(selector)?.value||'';
    return {name:get('[data-variant-name]'),sku:get('[data-variant-sku]'),
     priceCents:centsFromInput(get('[data-variant-price]')),
     stockQuantity:stockFromInput(get('[data-variant-stock]')),active:true};
   });
   await api('/api/products/'+current.id+'/variants','PUT',{variants});
   toast('Variações atualizadas.');await products(current.id);
  });
 });
 $('#catalogCampaignForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const d=formValues(ev.currentTarget);
  await action(async()=>{
   await api('/api/products/'+current.id+'/campaigns','POST',d);
   toast('Campanha associada como referência manual.');await products(current.id);
  });
 });
 view.querySelectorAll('[data-delete-campaign]').forEach(btn=>btn.addEventListener('click',()=>action(async()=>{
  await api('/api/products/'+current.id+'/campaigns/'+btn.dataset.deleteCampaign,'DELETE',{});
  toast('Associação removida.');await products(current.id);
 })));
}

function mountAiGuideTabs(){
 if(state.view!=='training')return;
 const selected=state.aiTab==='agent'?'agent':'training';
 const tabs='<div class="ai-guide-head"><div class="ai-guide-title"><span class="eyebrow">CENTRAL DE INTELIGÊNCIA</span>'+
 '<h1>Inteligência artificial</h1><p>Treine, configure e teste o seu Sócio em um só lugar.</p></div>'+
 '<div class="ai-guide-tabs" role="tablist" aria-label="Áreas da inteligência artificial">'+
 '<button type="button" role="tab" data-ai-tab="training" aria-selected="'+(selected==='training')+'" class="'+(selected==='training'?'active':'')+'">Aprendizado e análises</button>'+
 '<button type="button" role="tab" data-ai-tab="agent" aria-selected="'+(selected==='agent')+'" class="'+(selected==='agent'?'active':'')+'">Personalidade e testes</button></div></div>';
 view.insertAdjacentHTML('afterbegin',tabs);
 // The content inside each tab retains its original API calls and handlers.
 view.querySelectorAll('[data-ai-tab]').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.aiTab===state.aiTab)return;
  state.aiTab=button.dataset.aiTab;changeView('training');
 }));
}

async function training(){
 clearTimeout(trainingTimer);
 const [list,ag,jobs,versions,waConfig,waLinks,waScans]=await Promise.all([
  api('/api/imports'),api('/api/agent'),api('/api/training/jobs'),api('/api/training/versions'),
  api('/api/waakg/config'),api('/api/waakg/channels'),api('/api/waakg/scans')
 ]);
 const latest=jobs[0],open=jobs.find(x=>['queued','analyzing','paused'].includes(x.status));
 const percent=latest?.totalItems?Math.min(100,Math.round(100*Number(latest.processedItems||0)/Number(latest.totalItems))):0;
 const draft=versions.find(x=>x.status==='draft'),published=versions.find(x=>x.status==='approved');
 const controls=open?'<div class="row-actions">'+
  (open.status==='paused'?'<button class="btn soft" id="analysisResume">Retomar</button>':'<button class="btn soft" id="analysisPause">Pausar</button>')+
  '<button class="btn soft" id="analysisCancel">Cancelar</button></div>':
  '<button class="btn primary" id="analysisStart" '+(list.length?'':'disabled')+'>Analisar '+list.length+' conversa(s) →</button>';
 const summary=latest?.report?.summary||'A análise é baseada somente nas conversas importadas nesta empresa. '+
  'Sincronize o histórico disponível dos WhatsApps autorizados acima ou importe arquivos antes de analisar.';
 const syncActive=waScans.some(j=>['queued','scanning','importing'].includes(j.status));
 const waCard='<section class="card card-pad section-gap"><div class="section-title">Analisar conversas dos WhatsApps conectados</div>'+
   '<p class="form-note">Importa texto das sessões autorizadas, sem mensagens automáticas. O WA-AKG atual lista no máximo 50 chats por sessão e até 400 mensagens por conversa; mídias e grupos são ignorados.</p>'+
   (waLinks.length?'<button class="btn soft" id="waSyncAll" '+(!waConfig.configured?'disabled':'')+'>Sincronizar histórico dos '+waLinks.length+' WhatsApp(s) →</button>':
   '<p class="form-note">Conecte primeiro uma sessão existente na guia WhatsApps.</p>')+
   (!waConfig.configured?'<p class="form-note">Gateway pendente de configuração pela Consecom.</p>':'')+
   (waScans.length?'<div class="section-gap">'+waScans.slice(0,8).map(j=>{
     const pct=j.status==='completed'?100:j.totalChats?Math.round(100*j.processedChats/j.totalChats):0;
     const label=waLinks.find(c=>c.id===j.channelId)?.label||'WhatsApp';
     return '<div class="section-gap"><strong>'+e(label)+' — '+pct+'%</strong><span class="form-note"> '+e(j.status)+'</span>'+
      '<div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div>'+
      '<p class="form-note">'+e(j.processedChats)+'/'+e(j.totalChats)+' conversas processadas, '+e(j.importedChats)+' importadas, '+e(j.importedMessages)+' mensagens. '+
      (j.partialCoverage?'Cobertura parcial: listagem do gateway limitada. ':'')+
      (j.truncatedChats?'Algumas conversas excedem 400 mensagens. ':'')+
      (j.errorCode?'Erro: '+e(j.errorCode):'')+'</p>'+
      (['queued','scanning','importing','paused','failed'].includes(j.status)?
        '<div class="row-actions"><button class="btn sm soft" data-wa-action="'+(j.status==='paused'||j.status==='failed'?'resume':'pause')+'" data-job="'+e(j.id)+'">'+(j.status==='paused'||j.status==='failed'?'Retomar':'Pausar')+'</button>'+
        '<button class="btn sm soft" data-wa-action="cancel" data-job="'+e(j.id)+'">Cancelar</button></div>':'')+'</div>';
   }).join('')+'</div>':'')+
   '<p class="form-note">Depois de sincronizar, use <strong>Analisar conversas</strong> abaixo para gerar relatório e Markdown. A aprovação do conhecimento continua manual.</p></section>';
 const trainingCard='<section class="card card-pad section-gap" id="analysisCard">'+
  '<div class="section-title">Análise automática — rascunho supervisionado</div>'+
  '<p class="form-note">O percentual indica registros realmente processados. Não mede a eficácia de vendas sem conversões verificadas.</p>'+
  '<div class="progress-track"><div class="progress-fill" style="width:'+percent+'%"></div></div>'+
  '<p><strong>'+percent+'% analisado</strong> · '+(latest?e(latest.processedItems)+' de '+e(latest.totalItems)+' conversas':'Nenhuma análise iniciada')+
  ' · '+e(latest?.status||'pronto para começar')+'</p>'+
  '<p class="form-note">'+e(summary)+'</p>'+controls+
  (draft?'<div class="section-gap"><strong>Versão '+e(draft.version)+' gerada — aguardando aprovação</strong>'+
    '<p class="form-note">'+e(draft.report?.summary||'')+'</p>'+
    '<div class="code-preview">'+e(draft.markdown||'')+'</div>'+
    '<button class="btn primary section-gap" id="analysisApprove" data-id="'+e(draft.id)+'">Aprovar conhecimento →</button></div>':'')+
  (published?'<p class="form-note">Última versão aprovada: '+e(published.version)+'. A publicação não ativa envios automáticos.</p>':'')+
  '</section>';

 view.innerHTML=
 waCard+trainingCard+
 '<div class="two-pane train"><div class="card card-pad"><div class="section-title">Importar conversas de sucesso</div><div class="file-drop"><span class="file-icon">⇧</span><strong>Escolha conversas .txt, .md ou .zip</strong><small>Múltiplos arquivos · até 700 KB por texto ou 2 MB por ZIP</small><input type="file" id="importInput" accept=".txt,.md,.zip,text/plain,text/markdown,application/zip" multiple aria-label="Escolher conversas"></div><p class="form-note">No WhatsApp: abra a conversa → Exportar conversa → Sem mídia. Você também pode enviar o ZIP da exportação diretamente, sem extraí-lo.</p><div class="info-strip"><strong>Privacidade em primeiro lugar</strong>Utilize conversas que sua empresa está autorizada a tratar. Telefones, e-mails e documentos numéricos são mascarados; nomes de participantes são substituídos por identificadores genéricos.</div><div id="importFeedback" class="form-note"></div></div>'+
 '<div>'+panel('Base de experiência',list.length+' conversa(s) importada(s).',
 '<div class="card-pad"><div class="progress-track"><div class="progress-fill" style="width:'+Math.min(100,list.length*10)+'%"></div></div><p class="form-note">'+Math.min(list.length,10)+' de 10 referências sugeridas para o primeiro treinamento.</p></div>'+
 (list.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Arquivo</th><th>Mensagens</th></tr></thead><tbody>'+list.map(x=>'<tr><td><strong>'+e(x.filename)+'</strong><div class="table-detail">'+date(x.created_at)+'</div></td><td>'+e(x.message_count)+'</td></tr>').join('')+'</tbody></table></div>':empty('✳','Ainda não há exemplos','Suas primeiras conversas de referência aparecerão aqui.')))+
 '<div class="card card-pad section-gap"><div class="section-title">Conhecimento aprovado</div><p class="form-note">Somente análises revisadas e aprovadas entram no conhecimento do agente. Produtos e preços continuam em configuração separada.</p><div class="code-preview">'+e(ag.knowledge_md||'# Aguardando as primeiras conversas de referência...')+'</div></div></div></div>';
 const run=async(path)=>action(async()=>{await api(path,'POST',{});await training();});
 $('#waSyncAll')?.addEventListener('click',async()=>{
  await action(async()=>{
   let started=0,errors=[];
   for(const c of waLinks){
    if(waScans.some(j=>j.channelId===c.id&&['queued','scanning','importing','paused'].includes(j.status)))continue;
    try{await api('/api/waakg/scans','POST',{channelId:c.id});started++;}
    catch(err){errors.push(c.label+': '+errMsg(err));}
   }
   toast(started+' sincronização(ões) iniciada(s).'+(errors.length?' '+errors.join(' | '):''),!started);
   await training();
  });
 });
 view.querySelectorAll('[data-wa-action]').forEach(button=>button.addEventListener('click',()=>run('/api/waakg/scans/'+button.dataset.job+'/'+button.dataset.waAction)));
 $('#analysisStart')?.addEventListener('click',()=>run('/api/training/jobs'));
 $('#analysisPause')?.addEventListener('click',()=>run('/api/training/jobs/'+open.id+'/pause'));
 $('#analysisResume')?.addEventListener('click',()=>run('/api/training/jobs/'+open.id+'/resume'));
 $('#analysisCancel')?.addEventListener('click',()=>run('/api/training/jobs/'+open.id+'/cancel'));
 $('#analysisApprove')?.addEventListener('click',()=>run('/api/training/versions/'+draft.id+'/approve'));
 if((open&&open.status!=='paused')||syncActive){
  trainingTimer=setTimeout(()=>{if(state.view==='training')training().catch(error=>toast(errMsg(error),true));},1750);
 }
 $('#importInput').addEventListener('change',async ev=>{
  const files=Array.from(ev.target.files||[]);
  const feedback=$('#importFeedback');if(!files.length)return;
  if(files.some(f=>!(/\.(txt|md|zip)$/i.test(f.name))||f.size>(/\.zip$/i.test(f.name)?2000000:700000)))return toast('Selecione textos até 700 KB ou ZIPs até 2 MB.',true);
  let okay=0;const errors=[];
  for(const file of files){
   feedback.textContent='Importando '+e(file.name)+'... ('+(okay+errors.length+1)+'/'+files.length+')';
   try{
    if(/\.zip$/i.test(file.name)){
     const bytes=new Uint8Array(await file.arrayBuffer()),parts=[];
     for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
     const result=await api('/api/imports/zip','POST',{filename:file.name,contentBase64:btoa(parts.join(''))});
     okay+=result.conversationCount;
    }else{await api('/api/imports','POST',{filename:file.name,content:await file.text()});okay++;}
   }
   catch(ex){errors.push(file.name+': '+errMsg(ex));}
  }
  toast(okay+' arquivo(s) importado(s).'+(errors.length?' '+errors.length+' falha(s).':'') ,!okay);
  await training();
  if(errors.length)$('#importFeedback').textContent=errors.join(' | ');
 });
 mountAiGuideTabs();
}
async function agent(){
 const ag=await api('/api/agent');
 const missing=!state.me.groqConfigured;
 view.innerHTML=
 '<div class="two-pane train"><div class="card card-pad"><div class="section-title">Identidade e comportamento</div><form id="agentForm" class="form-stack"><label>Nome do agente<input name="name" required maxlength="80" value="'+e(ag.name||'Sócio')+'"></label><label>Tom de voz<input name="tone" required maxlength="300" value="'+e(ag.tone||'Profissional e natural')+'"></label><label>Instruções e limites<textarea name="instructions" required maxlength="6000" rows="8">'+e(ag.instructions||'')+'</textarea></label><label>Modo operacional<select name="enabled"><option value="false"'+(!ag.enabled?' selected':'')+'>Em preparação</option><option value="true"'+(ag.enabled?' selected':'')+'>Preparado para integrar (não envia sozinho)</option></select></label><button type="submit" class="btn primary">Salvar personalidade →</button><p class="form-note">Marcar como preparado não conecta um WhatsApp ou libera envios automáticos.</p></form></div>'+
 '<div class="card"><div class="panel-head"><div><h2>Laboratório de conversas</h2><p>Faça perguntas como se fosse um cliente.</p></div>'+badge('Simulação','gray')+'</div><div class="messages-preview" id="simulationMessages"><div class="bubble">Olá! Este é seu laboratório. Configure produtos e treinamento e faça uma pergunta para experimentar a personalidade do seu Sócio.</div></div><form class="chat-compose" id="simulateForm"><input name="message" required maxlength="1200" placeholder="Ex.: Quais serviços vocês oferecem?" autocomplete="off"><button type="submit" class="btn primary">Enviar ↗</button></form>'+(missing?'<div class="info-strip" style="margin:14px">Conecte GROQ_API_KEY nas variáveis do Railway para ativar respostas reais no simulador.</div>':'')+'</div></div>';
 $('#agentForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/agent','PUT',{...d,enabled:d.enabled==='true'});toast('Personalidade atualizada.');await agent();});});
 $('#simulateForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget,txt=val(form,'message');if(!txt)return;
  const msgs=$('#simulationMessages');msgs.insertAdjacentHTML('beforeend','<div class="bubble agent">'+e(txt)+'</div>');form.reset();msgs.scrollTop=msgs.scrollHeight;
  await action(async()=>{
   const result=await api('/api/simulate','POST',{message:txt});
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
 mountAiGuideTabs();
}
async function inbox(){
 if(!window.SocioInbox)throw new Error('Módulo de conversas não foi carregado. Recarregue a página.');
 if(activeInbox)activeInbox.cleanup();
 activeInbox=window.SocioInbox.create({api,e,toast,view,changeView,
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
async function team(){
 const data=await api('/api/team');
 view.innerHTML=heading('PESSOAS','Sua equipe.','Convide colaboradores com acesso apenas aos dados da sua empresa.')+
 '<section class="card card-pad" style="margin-bottom:18px"><div class="section-title">Meu acesso ao Sócio</div>'+
 '<p class="form-note">Entre com e-mail ou celular cadastrado e sua senha. O número é pessoal do usuário; não utiliza o número de WhatsApp da empresa.</p>'+
 '<form id="myPhoneForm" class="form-stack" style="max-width:470px"><label>Meu celular com DDD (opcional)<input name="phone" type="tel" maxlength="32" autocomplete="tel" value="'+e(state.me?.user?.phone||'')+'" placeholder="(15) 99999-9999"></label>'+
 '<label>Senha atual para confirmar<input name="currentPassword" type="password" required autocomplete="current-password" placeholder="Sua senha atual"></label>'+
 '<button class="btn primary" type="submit">Salvar número de acesso</button><p class="form-note">Deixe o campo vazio e confirme a senha para remover o número. O login por e-mail continuará disponível.</p></form></section>'+
 '<div class="two-pane"><div>'+panel('Pessoas cadastradas',data.length+' usuário(s).',
 '<div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Acesso</th></tr></thead><tbody>'+data.map(u=>'<tr><td><strong>'+e(u.name)+'</strong><div class="table-detail">'+e(u.email)+(u.phone?' · '+e(u.phone):'')+'</div></td><td>'+badge(u.role==='owner'?'Proprietário':u.role==='admin'?'Administrador':'Atendente')+'</td></tr>').join('')+'</tbody></table></div>')+'</div>'+
 '<div class="card card-pad"><div class="section-title">Adicionar colaborador</div><form class="form-stack" id="teamForm"><label>Nome<input name="name" required maxlength="100"></label><label>E-mail<input name="email" type="email" required></label><label>Celular para login (opcional)<input name="phone" type="tel" maxlength="32" placeholder="(15) 99999-9999"></label><label>Permissão<select name="role"><option value="agent">Atendente</option><option value="admin">Administrador da empresa</option></select></label><label>Senha temporária (mín. 12 caracteres)<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><button class="btn primary" type="submit">Cadastrar colaborador →</button><p class="form-note">Compartilhe a senha com segurança e peça que o usuário a altere. Recuperação automática de senha será adicionada em uma próxima versão.</p></form></div></div>';
 $('#myPhoneForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget,data=formValues(form);
  await action(async()=>{
   const result=await api('/api/me/phone','POST',data);
   state.me.user.phone=result.phone;
   form.elements.currentPassword.value='';
   toast(result.phone?'Número vinculado à sua conta. Agora você pode entrar por e-mail ou celular.':'Número de acesso removido.');
   await team();
  });
 });
 $('#teamForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/team','POST',d);toast('Colaborador cadastrado.');await team();});});
}
async function admin(){
 const tenants=await api('/api/admin/tenants');
 view.innerHTML=heading('CONTROLE CONSECOM','Empresas do Sócio.','Gerencie clientes, planos e ambientes independentes da plataforma.')+
 '<div class="two-pane"><div>'+panel('Empresas cadastradas',tenants.length+' ambiente(s) isolado(s).',
 '<div class="table-wrap"><table class="data-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Acesso</th></tr></thead><tbody>'+tenants.map(t=>'<tr><td><strong>'+e(t.name)+'</strong><div class="table-detail">'+e(t.slug)+' · '+e(t.members)+' usuário(s)</div></td><td>'+badge(t.plan)+'</td><td><button class="btn sm ghost" data-switch="'+e(t.id)+'">'+(t.id===state.me.tenant.id?'Atual':'Acessar')+'</button></td></tr>').join('')+'</tbody></table></div>')+'</div>'+
 '<div class="card card-pad"><div class="section-title">Cadastrar empresa cliente</div><form id="tenantForm" class="form-stack"><label>Nome da empresa<input name="company" required maxlength="120" placeholder="Ex.: Pizzaria Bella"></label><label>Nome do responsável<input name="ownerName" required maxlength="100"></label><label>E-mail do responsável<input name="ownerEmail" required type="email"></label><label>Celular para login (opcional)<input name="ownerPhone" type="tel" maxlength="32" placeholder="(15) 99999-9999"></label><label>Plano<select name="plan"><option value="essencial">Essencial · R$129/mês</option><option value="equipe">Equipe</option><option value="voz">Voz (futuro)</option></select></label><label>Senha inicial (mín. 12 caracteres)<input type="password" name="ownerPassword" required minlength="12" maxlength="128" autocomplete="new-password"></label><button class="btn primary" type="submit">Criar espaço da empresa →</button><p class="form-note">O plano é um registro administrativo; cobranças e assinaturas ainda não são processadas automaticamente.</p></form></div></div>';
 $('#tenantForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/admin/tenants','POST',d);toast('Empresa cadastrada e isolada.');await admin();});});
 view.querySelectorAll('[data-switch]').forEach(b=>b.addEventListener('click',()=>action(async()=>{await api('/api/admin/switch','POST',{tenantId:b.dataset.switch});toast('Ambiente alterado.');state.view='overview';await boot();})));
}
async function action(fn){try{await fn();}catch(err){toast(errMsg(err),true);}}

const sidebarIcons={
 overview:'<rect x="3" y="3" width="8" height="8" rx="1.7"/><rect x="13" y="3" width="8" height="8" rx="1.7"/><rect x="3" y="13" width="8" height="8" rx="1.7"/><rect x="13" y="13" width="8" height="8" rx="1.7"/>',
 inbox:'<path d="M4 4h16v12h-5l-3 3-3-3H4z"/><path d="M7 9h10M7 12h7"/>',
 channels:'<path d="M6 18c-2-1.7-3-4.1-3-6.6C3 6.6 6.7 3 12 3s9 3.6 9 8.4c0 4.5-3.7 8.6-9 8.6-1.6 0-3.2-.3-4.4-1L3 21z"/><path d="M9 9c.4 2.6 2.4 4.7 5 5l1.4-1.5"/>',
 products:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 10h18M10 3v18"/>',
 training:'<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8m8.6 8.6 2.8 2.8M2 12h4m12 0h4M4.9 19.1l2.8-2.8m8.6-8.6 2.8-2.8"/><circle cx="12" cy="12" r="3.4"/>',
 agent:'<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"/>',
 team:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1c0-3.6 2.5-5 6-5s6 1.4 6 5v1z"/><path d="M17 5a3 3 0 0 1 0 6m1 4c2 .5 3 1.8 3 4v1"/>',
 admin:'<path d="M3 21V5l9-3 9 3v16M3 21h18M9 21v-5h6v5M7 9h2m6 0h2M7 13h2m6 0h2"/>',
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
  key!=='agent'&&(key!=='admin'||state.me?.user.platformOwner)&&
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

$('#loginForm').addEventListener('submit',async ev=>{
 ev.preventDefault();$('#authError').textContent='';
 try{const data=await api('/api/login','POST',formValues(ev.currentTarget));state.csrf=data.csrf;await boot();}
 catch(err){$('#authError').textContent=errMsg(err);}
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
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout','POST',{});}catch{}state.me=null;state.csrf='';state.view='overview';boot();});
boot();
