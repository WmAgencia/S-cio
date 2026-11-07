// Read-only SaaS administration views. All data is returned by platform-only APIs.
(()=>{
 'use strict';
 let currentRender=0;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
 const int=value=>new Intl.NumberFormat('pt-BR').format(number(value));
 const labels={essencial:'Essencial',equipe:'Equipe',voz:'Voz'};
 const statusLabels={active:'Ativa',trial:'Em teste',paused:'Pausada'};
 const date=value=>{
  if(!value||!Number.isFinite(new Date(value).getTime()))return '—';
  return new Date(value).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
 };
 const tile=(label,value,detail,icon,tone='purple')=>'<div class="master-kpi master-tone-'+tone+'">'+
  '<span class="master-kpi-icon" aria-hidden="true">'+icon+'</span><div class="master-kpi-copy">'+
  '<small>'+esc(label)+'</small><strong>'+esc(value)+'</strong><span>'+esc(detail)+'</span></div></div>';
 const panel=(title,description,body,more='')=>'<section class="master-panel"><div class="master-panel-head"><div>'+
  '<h2>'+esc(title)+'</h2>'+(description?'<p>'+esc(description)+'</p>':'')+'</div>'+more+'</div>'+body+'</section>';
 const actions=()=>'<div class="master-page-actions"><button type="button" class="btn primary" data-master-go="admin">+ Nova empresa</button>'+
  '<button type="button" class="btn soft" data-master-refresh>Atualizar dados</button></div>';
 const monthData=tenants=>{
  const current=new Date();const result=[];
  for(let i=11;i>=0;i--){
   const begin=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()-i,1));
   const key=begin.toISOString().slice(0,7);
   result.push({key,label:begin.toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'}).replace('.',''),count:0});
  }
  const map=new Map(result.map(item=>[item.key,item]));
  tenants.forEach(t=>{const d=new Date(t.created_at);if(Number.isFinite(d.getTime())){
   const key=d.toISOString().slice(0,7);const target=map.get(key);if(target)target.count++;
  }});
  return result;
 };
 const monthlyChart=tenants=>{
  const points=monthData(tenants),max=Math.max(1,...points.map(p=>p.count));
  return '<div class="master-month-chart" role="img" aria-label="Novas empresas cadastradas por mês nos últimos doze meses">'+
   points.map(p=>'<div class="master-month-col" title="'+esc(p.label)+': '+int(p.count)+' empresa(s)">'+
   '<div class="master-month-value">'+int(p.count)+'</div><div class="master-month-track">'+
   '<div class="master-month-bar" style="height:'+Math.max(p.count?8:0,Math.round(100*p.count/max))+'%"></div>'+
   '</div><span>'+esc(p.label)+'</span></div>').join('')+'</div>';
 };
 const planCounts=tenants=>['essencial','equipe','voz'].map(key=>({key,label:labels[key],count:tenants.filter(t=>t.plan===key).length}));
 const planChart=tenants=>{
  const all=tenants.length,plans=planCounts(tenants),max=Math.max(1,...plans.map(p=>p.count));
  const segments=['#6a46dc','#8e78ed','#c9bdfa'];let progress=0;
  const slices=plans.map((p,i)=>{const start=progress;progress+=all?p.count/all*100:0;return segments[i]+' '+start.toFixed(2)+'% '+progress.toFixed(2)+'%';});
  const donut=all?'conic-gradient('+slices.join(',')+')':'conic-gradient(#ece9f6 0% 100%)';
  return '<div class="master-plan-chart"><div class="master-donut" role="img" aria-label="Distribuição das empresas por plano" style="background:'+donut+'">'+
   '<div class="master-donut-center"><strong>'+int(all)+'</strong><small>empresas</small></div></div>'+
   '<div class="master-plan-legend">'+plans.map((p,i)=>'<div class="master-plan-row">'+
   '<div class="master-plan-row-top"><span><i style="background:'+segments[i]+'"></i>'+esc(p.label)+'</span>'+
   '<strong>'+int(p.count)+' <small>('+Math.round(all?p.count/all*100:0)+'%)</small></strong></div>'+
   '<div class="master-plan-track"><span style="width:'+Math.round(100*p.count/max)+'%;background:'+segments[i]+'"></span></div></div>').join('')+'</div></div>';
 };
 const statusBadge=value=>'<span class="master-status master-status-'+(value in statusLabels?value:'other')+'">'+esc(statusLabels[value]||value||'Indefinida')+'</span>';
 const feedback=message=>'<div class="master-no-data">'+esc(message)+'</div>';
 const table=(rows,headers)=>'<div class="master-table-wrap"><table class="master-table"><thead><tr>'+
  headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
 const overview=(tenants,monitor)=>{
  const total=tenants.length,active=tenants.filter(t=>t.status==='active').length,
   trial=tenants.filter(t=>t.status==='trial').length,paused=tenants.filter(t=>t.status==='paused').length,
   team=tenants.reduce((a,t)=>a+number(t.members),0);
  const summary=monitor?.summary||null,observed=Array.isArray(monitor?.tenants)?monitor.tenants:[];
  const attention=observed.filter(t=>t.needsAttention).sort((a,b)=>
   number(b.pendingQuotes)-number(a.pendingQuotes)).slice(0,6);
  const attentionRows=attention.map(t=>'<tr><td><strong>'+esc(t.name)+'</strong><small>'+
   esc(labels[t.plan]||t.plan)+'</small></td><td>'+statusBadge(t.accountStatus)+'</td>'+
   '<td>'+int(t.pendingQuotes)+'</td><td>'+int(t.openOpportunities)+'</td>'+
   '<td><button class="master-text-action" data-master-go="admin">Gerenciar</button></td></tr>');
  return '<div class="master-page"><header class="master-hero"><div><span class="master-eyebrow">PAINEL MASTER · CONSECOM</span>'+
   '<h1>Visão geral do SaaS</h1><p>Acompanhe cadastros, planos e operação das empresas em um único lugar.</p></div>'+
   actions()+'</header>'+
   '<div class="master-kpis">'+tile('Empresas cadastradas',int(total),'Total de ambientes','▦')+
   tile('Contas ativas',int(active),'Status cadastral, não pagamento','✓','green')+
   tile('Em teste',int(trial),'Período de avaliação','◷','amber')+
   tile('Usuários cadastrados',int(team),'Somatório das equipes','♙','blue')+
   tile('Contas pausadas',int(paused),'Ambientes com status pausado','Ⅱ','neutral')+'</div>'+
   '<div class="master-main-grid">'+
   panel('Crescimento dos cadastros','Novas empresas nos últimos 12 meses',monthlyChart(tenants))+
   panel('Distribuição dos planos','Planos cadastrados, não assinaturas pagas',planChart(tenants),
    '<button class="master-text-action" data-master-go="masterPlans">Ver planos</button>')+'</div>'+
   '<div class="master-main-grid master-secondary-grid">'+
   panel('Pontos de atenção','Demandas registradas nas empresas monitoradas'+(monitor?.partial?' · amostra de até 100 empresas':''),
    attentionRows.length?table(attentionRows,['Empresa','Status','Orçamentos pendentes','Oportunidades','']):feedback('Nenhuma pendência identificada nos registros consultados.'))+
   panel('Saúde do SaaS','Indicadores de acompanhamento cadastral',
    '<div class="master-health-list">'+
    '<div><span>Testes encerrados no calendário</span><strong>'+int(summary?.trialCalendarElapsed||0)+'</strong></div>'+
    '<div><span>Testes terminando em até 3 dias</span><strong>'+int(summary?.trialEndingWithin3Days||0)+'</strong></div>'+
    '<div><span>Empresas com status ativo</span><strong>'+int(active)+'</strong></div>'+
    '<div><span>MRR / receita confirmada</span><strong>Indisponível</strong></div>'+
    '</div><p class="master-disclaimer">Status ativo não significa cliente pagante. Receita e assinaturas só aparecerão após conciliação com o sistema de pagamentos.</p>')+
   '</div><p class="master-updated">Dados consultados em '+esc(new Date().toLocaleString('pt-BR'))+'. Nenhum pagamento ou status foi alterado.</p></div>';
 };
 const planView=(tenants,monitor)=>{
  const plans=planCounts(tenants),rows=plans.map(p=>{
   const ofPlan=tenants.filter(t=>t.plan===p.key);
   return '<tr><td><strong>'+esc(p.label)+'</strong></td><td>'+int(p.count)+'</td>'+
    '<td>'+int(ofPlan.filter(t=>t.status==='active').length)+'</td>'+
    '<td>'+int(ofPlan.filter(t=>t.status==='trial').length)+'</td>'+
    '<td>'+int(ofPlan.filter(t=>t.status==='paused').length)+'</td>'+
    '<td><button class="master-text-action" data-master-go="admin" data-master-plan="'+p.key+'">Ver empresas</button></td></tr>';
  });
  return '<div class="master-page"><header class="master-hero"><div><span class="master-eyebrow">GESTÃO DO SAAS</span>'+
   '<h1>Planos e utilização</h1><p>Distribuição por plano, situação cadastral e empresas.</p></div>'+
   actions()+'</header><div class="master-main-grid">'+
   panel('Distribuição dos planos','Empresas atualmente cadastradas',planChart(tenants))+
   panel('O que é medido','Indicadores verificados e limitações',
    '<div class="master-health-list"><div><span>Empresas cadastradas</span><strong>'+int(tenants.length)+'</strong></div>'+
    '<div><span>Cadastros ativos</span><strong>'+int(tenants.filter(t=>t.status==='active').length)+'</strong></div>'+
    '<div><span>Assinaturas pagas</span><strong>Indisponível</strong></div>'+
    '<div><span>Faturamento mensal recorrente</span><strong>Indisponível</strong></div></div>'+
    '<p class="master-disclaimer">Alterar o plano cadastral não realiza uma cobrança ou altera uma assinatura na Stripe.</p>')+
   '</div>'+panel('Planos por situação','Resumo completo de todas as empresas',table(rows,['Plano','Total','Ativas','Em teste','Pausadas','']))+
   '<p class="master-updated">Atualizado em '+esc(new Date().toLocaleString('pt-BR'))+'.</p></div>';
 };
 async function render({root,api,me,navigate,mode='overview'}){
  if(!me?.user?.platformOwner)throw Error('Acesso restrito à administração Master.');
  const serial=++currentRender;
  root.innerHTML='<div class="master-loading" role="status">Carregando dados do painel Master…</div>';
  const [raw,monitor]=await Promise.all([
   api('/api/admin/tenants'),api('/api/admin/monitor').catch(()=>null)
  ]);
  if(serial!==currentRender)return;
  if(!Array.isArray(raw))throw Error('A listagem de empresas não foi retornada.');
  root.innerHTML=mode==='plans'?planView(raw,monitor):overview(raw,monitor);
  root.querySelectorAll('[data-master-go]').forEach(button=>button.addEventListener('click',()=>{
   if(button.dataset.masterPlan)try{sessionStorage.setItem('socio:master-plan-filter',button.dataset.masterPlan);}catch{}
   navigate(button.dataset.masterGo);
  }));
  root.querySelectorAll('[data-master-refresh]').forEach(button=>button.addEventListener('click',()=>render({root,api,me,navigate,mode})
   .catch(err=>{root.innerHTML=feedback(err?.message||'Não foi possível atualizar os dados.');})));
 }
 globalThis.SocioMasterDashboard={render,invalidate(){currentRender++;}};
})();
