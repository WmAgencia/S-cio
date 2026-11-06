// Read-only daily Meta report schedule, panel delivery only. No WhatsApp/group sends.
(()=>{
 const el=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);return n;};
 async function render({root,api,canManage,account}){
  const section=el('section');section.className='card card-pad';root.append(section);
  section.append(el('h2','Relatórios automáticos da Meta Ads'),el('p',
   'Guarde um relatório por dia no painel da sua empresa. O envio para grupo WhatsApp aguarda homologação do WA-AKG.'));
  const state=el('p');state.setAttribute('role','status');section.append(state);
  const form=el('form');form.className='form-stack';section.append(form);
  const field=(label,control)=>{const wrap=el('label',label);wrap.append(control);form.append(wrap);return control;};
  const time=el('input');time.type='time';time.value='20:00';time.required=true;
  field('Horário do relatório',time);
  const tz=el('select');for(const [value,name] of [
   ['America/Sao_Paulo','Brasília / São Paulo'],['America/Fortaleza','Fortaleza'],
   ['America/Belem','Belém'],['America/Cuiaba','Cuiabá'],['America/Manaus','Manaus'],
   ['America/Rio_Branco','Rio Branco']]){
    const option=el('option',name);option.value=value;tz.append(option);
   }
  field('Fuso horário',tz);
  const period=el('select');
  for(const [value,name] of [['yesterday','Dia anterior (fechado)'],['today','Hoje (parcial)'],
   ['last_7d','Últimos 7 dias'],['last_30d','Últimos 30 dias']]){
    const option=el('option',name);option.value=value;period.append(option);
   }
  field('Período analisado',period);
  const enabled=el('input');enabled.type='checkbox';
  const checkbox=el('label');checkbox.append(enabled,document.createTextNode('Ativar geração diária (somente no painel)'));form.append(checkbox);
  const save=el('button','Salvar programação');save.type='submit';save.className='btn primary';save.disabled=!canManage;form.append(save);
  const history=el('div');section.append(history);
  async function refresh(){
   const result=await api('/api/marketing/report-schedule');
   if(result.schedule){
    time.value=result.schedule.hour;tz.value=result.schedule.time_zone;period.value=result.schedule.period;
    enabled.checked=result.schedule.enabled;
    state.textContent='Conta '+result.schedule.account_id+' · Próxima data: '+
      new Date(result.schedule.next_run_at).toLocaleString('pt-BR')+
      ' · '+(result.schedule.enabled?(result.serviceEnabled?'Ativo':'Salvo, aguardando habilitação do worker'):'Desativado');
   }else state.textContent='Nenhum relatório diário agendado para esta empresa.';
   history.replaceChildren(el('h3','Relatórios disponíveis'));
   if(!result.runs.length)history.append(el('p','Ainda não há relatórios gerados. A geração automática depende da configuração do serviço.'));
   for(const row of result.runs){
    const article=el('article');article.className='panel';history.append(article);
    article.append(el('strong',new Date(row.scheduled_for).toLocaleString('pt-BR')+' · '+row.status));
    if(row.summary){
     const s=row.summary;article.append(el('p','Gasto: '+s.spend+' '+s.currency+' · Cliques: '+s.clicks+
      ' · Impressões: '+s.impressions+' · CPC: '+(s.cpc===null?'indisponível':s.cpc)));
     article.append(el('p','Leads e vendas não são inferidos pelos cliques da Meta.'));
    }
    if(row.error_code)article.append(el('p','Falha: '+row.error_code));
   }
  }
  form.addEventListener('submit',async ev=>{
   ev.preventDefault();if(!canManage)return;
   save.disabled=true;
   try{
    await api('/api/marketing/report-schedule','PUT',{hour:time.value,timeZone:tz.value,period:period.value,enabled:enabled.checked});
    await refresh();state.textContent+=' · Configurações salvas.';
   }catch(err){state.textContent='Não foi possível salvar: '+err.message;}
   finally{save.disabled=false;}
  });
  try{await refresh();}catch(e){state.textContent='Relatórios indisponíveis: '+e.message;}
 }
 globalThis.SocioMetaScheduleUI={render};
})();
