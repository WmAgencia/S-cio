// Owner channel ("Meu Sócio"): the WhatsApp group where the owner commands
// Sócio. Only configuration lives here — group creation and campaigns are
// driven by the server worker and always wait for CONFIRMA inside the group.
(()=>{
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
 const brl=(cents)=>Number(cents||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const centsFrom=value=>{
  const clean=String(value||'').replace(/[^\d.,]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');
  const number=Number(clean);
  return Number.isFinite(number)?Math.round(number*100):NaN;
 };
 const STATE_LABEL={received:'Recebido',working:'Processando',preparing:'Preparando campanha',
  awaiting_settings:'Aguardando configuração',awaiting_confirmation:'Esperando CONFIRMA',
  done:'Concluído',failed:'Falhou',cancelled:'Cancelado'};

 async function render({root,api,me}){
  const section=el('section');section.className='card card-pad owner-channel';
  root.append(section);
  section.append(el('h2','Canal do dono no WhatsApp'));
  section.append(el('p','Assim que um número estiver conectado, eu crio o grupo '+
   '"Meu Sócio" e passo a trabalhar por lá: você envia o vídeo, eu monto a campanha, '+
   'você confirma e só então ela é criada — pausada até você dizer ATIVAR.'));
  const status=el('p');status.className='form-note';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  section.append(status);
  const canManage=me?.user?.platformOwner===true||(me?.user?.permissions||[]).includes('marketing.manage');
  let data;
  try{data=await api('/api/marketing/owner-channel');}
  catch(error){status.textContent='Não foi possível consultar o canal: '+error.message;return;}
  const group=data.group;

  if(!data.outboundEnabled)
   section.append(Object.assign(el('div'),{className:'info-strip',textContent:
    'O envio pelo WhatsApp ainda não está habilitado neste ambiente. O grupo pode ser criado, mas eu só respondo quando o envio for liberado.'}));

  if(!group){
   status.textContent='Nenhum WhatsApp conectado. Conecte um número acima e eu crio o grupo automaticamente.';
   return;
  }

  const stateText={
   active:'O grupo "Meu Sócio" está ativo na conta '+group.channelPhone+'.',
   waiting_owner_phone:'Conectado. Falta um telefone do dono cadastrado para eu adicionar ao grupo.',
   failed:'Não consegui criar o grupo'+(group.errorCode?' ('+group.errorCode+')':'')+'.'
  }[group.status]||'Situação: '+group.status;
  status.textContent=stateText+(group.status==='active'&&!data.missing.length?' Configuração completa.':'');
  if(group.status!=='active'&&canManage){
   const retry=el('button','Criar grupo agora');retry.type='button';retry.className='btn soft';
   retry.addEventListener('click',async()=>{
    retry.disabled=true;
    try{
     const result=await api('/api/marketing/owner-channel/retry','POST',{});
     status.textContent=result.created?'Grupo "Meu Sócio" criado. Veja no WhatsApp.':
      'O grupo ainda não foi criado'+(result.reason==='owner_phone_required'?
       ': cadastre o telefone do dono em Usuários.' :'.');
     if(result.created)await refresh();
    }catch(error){status.textContent='Não foi possível criar o grupo: '+error.message;}
    finally{retry.disabled=false;}
   });
   section.append(retry);
  }
  if(group.status!=='active')return;

  if(data.missing.length)
   section.append(Object.assign(el('div'),{className:'info-strip',
    textContent:'Antes de criar campanhas, falta configurar: '+data.missing.join(', ')+'.'}));

  const form=el('form');form.className='form-stack';section.append(form);
  const field=(label,control,note)=>{
   const wrap=el('label',label);wrap.append(control);
   if(note)wrap.append(Object.assign(el('small'),{className:'form-note',textContent:note}));
   form.append(wrap);return control;
  };

  const pageSelect=el('select');
  pageSelect.append(Object.assign(el('option','Selecione a página do anúncio'),{value:''}));
  field('Página do Facebook',pageSelect,'A página que assina o anúncio.');
  api('/api/marketing/tools/pages').then(result=>{
   for(const page of result?.items||[]){
    const option=el('option',page.name+' · '+page.id);option.value=String(page.id);pageSelect.append(option);
   }
   if(group.pageId)pageSelect.value=String(group.pageId);
  }).catch(()=>{
   if(group.pageId){
    const option=el('option','Página '+group.pageId);option.value=String(group.pageId);pageSelect.append(option);
    pageSelect.value=String(group.pageId);
   }
  });

  const cityWrap=el('div');cityWrap.className='owner-city';
  const cityQuery=el('input');cityQuery.type='search';cityQuery.placeholder='Digite a cidade (ex.: São Paulo)';
  cityQuery.autocomplete='off';cityQuery.maxLength=100;
  const cityResults=el('div');cityResults.className='owner-city-results';cityResults.setAttribute('role','listbox');
  cityWrap.append(cityQuery,cityResults);
  let city={key:group.cityKey||'',name:group.cityName||''};
  const cityLabel=el('small');cityLabel.className='form-note';
  const paintCity=()=>{cityLabel.textContent=city.key?'Cidade selecionada: '+city.name:'Nenhuma cidade selecionada.';};
  paintCity();
  field('Cidade da campanha',cityWrap,'A Meta busca a cidade pelo nome.');
  cityWrap.append(cityLabel);
  const searchCity=async()=>{
   const query=cityQuery.value.trim();
   if(query.length<2){cityResults.replaceChildren(el('p','Digite ao menos duas letras.'));return;}
   cityResults.replaceChildren(el('p','Buscando...'));
   try{
    const result=await api('/api/marketing/tools/cities?q='+encodeURIComponent(query));
    const items=(result?.items||[]).slice(0,10);
    cityResults.replaceChildren();
    if(!items.length){cityResults.append(el('p','Nenhuma cidade encontrada.'));return;}
    for(const item of items){
     const button=el('button',(item.name||item.key)+(item.region?' — '+item.region:''));button.type='button';
     button.className='btn sm soft';
     button.addEventListener('click',()=>{
      city={key:String(item.key),name:item.name+(item.region?' - '+item.region:'')};
      paintCity();cityResults.replaceChildren();cityQuery.value='';
     });
     cityResults.append(button);
    }
   }catch(error){cityResults.replaceChildren(el('p','Busca indisponível: '+error.message));}
  };
  const cityButton=el('button','Buscar cidade');cityButton.type='button';cityButton.className='btn sm soft';
  cityButton.addEventListener('click',searchCity);
  cityQuery.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();searchCity();}});
  cityWrap.append(cityButton);

  const budget=el('input');budget.type='text';budget.inputMode='decimal';budget.maxLength=12;
  budget.value=group.dailyBudgetCents?(group.dailyBudgetCents/100).toFixed(2).replace('.',','):'';
  field('Orçamento diário (R$)',budget,'Valor que a Meta pode gastar por dia quando a campanha estiver ativa.');

  const ticket=el('input');ticket.type='text';ticket.inputMode='decimal';ticket.maxLength=12;
  ticket.value=group.ticketCents?(group.ticketCents/100).toFixed(2).replace('.',','):'';
  field('Valor médio da venda (R$)',ticket,'Quanto o cliente costuma gastar por compra ou atendimento fechado.');

  const margin=el('input');margin.type='number';margin.min='1';margin.max='100';margin.step='1';
  margin.value=group.marginPercent?String(group.marginPercent):'';
  field('Margem de lucro (%)',margin,'Parte do valor da venda que sobra como lucro, já sem custo do produto.');

  const autopilot=el('input');autopilot.type='checkbox';autopilot.checked=group.autopilotEnabled!==false;
  const autopilotWrap=el('label');autopilotWrap.append(autopilot,
   document.createTextNode(' Acompanhar as campanhas a cada 6 horas e me perguntar antes de cada mudança'));
  field('Autopilot',autopilotWrap,
   'Sem esta opção eu não analiso nem envio recomendações sozinho. Nada muda sem a sua resposta.');

  const ages=el('div');ages.className='owner-ages';
  const ageMin=el('input');ageMin.type='number';ageMin.min='18';ageMin.max='65';ageMin.value=String(group.ageMin||18);
  const ageMax=el('input');ageMax.type='number';ageMax.min='18';ageMax.max='65';ageMax.value=String(group.ageMax||65);
  ages.append(ageMin,el('span','a'),ageMax);
  field('Idade',ages,'De 18 a 65 anos.');

  const genders=el('div');genders.className='owner-genders';
  const genderBoxes=[[1,'Masculino'],[2,'Feminino']].map(([value,label])=>{
   const box=el('input');box.type='checkbox';box.value=String(value);
   box.checked=(group.genders||[]).includes(value);
   const wrap=el('label');wrap.append(box,document.createTextNode(label));genders.append(wrap);
   return box;
  });
  field('Gênero',genders,'Nenhuma opção marcada atende todos os gêneros.');

  const destination=el('input');destination.type='tel';destination.maxLength=15;
  destination.placeholder='5515999999999';
  destination.value=group.destination||group.channelPhone||'';
  field('WhatsApp que recebe as conversas',destination,'DDI + DDD + número. O anúncio abre essa conversa.');

  const save=el('button','Salvar configuração');save.type='submit';save.className='btn primary';
  save.disabled=!canManage;form.append(save);
  if(!canManage)form.append(Object.assign(el('p'),{className:'form-note',
   textContent:'Somente o dono ou um administrador pode alterar esta configuração.'}));

  form.addEventListener('submit',async ev=>{
   ev.preventDefault();if(!canManage)return;
   const payload={};
   if(pageSelect.value)payload.pageId=pageSelect.value;
   if(city.key)payload.cityKey=city.key;
   if(city.key)payload.cityName=city.name;
   const cents=centsFrom(budget.value);
   if(Number.isFinite(cents))payload.dailyBudgetCents=cents;
   const ticketCents=centsFrom(ticket.value);
   if(Number.isFinite(ticketCents)&&ticketCents>0)payload.ticketCents=ticketCents;
   const marginValue=Number(String(margin.value).replace(',','.'));
   if(Number.isFinite(marginValue)&&marginValue>0)payload.marginPercent=marginValue;
   payload.autopilotEnabled=autopilot.checked;
   payload.ageMin=Number(ageMin.value);payload.ageMax=Number(ageMax.value);
   payload.genders=genderBoxes.filter(box=>box.checked).map(box=>Number(box.value));
   if(destination.value.trim())payload.destination=destination.value.trim();
   save.disabled=true;
   try{
    await api('/api/marketing/owner-channel','PATCH',payload);
    await refresh();
   }catch(error){status.textContent='Não foi possível salvar: '+error.message;}
   finally{save.disabled=false;}
  });

  if(data.commands.length){
   const history=el('div');history.className='owner-commands';section.append(history);
   history.append(el('h3','Últimos comandos no grupo'));
   for(const command of data.commands.slice(0,10)){
    const row=el('p');
    row.textContent=new Date(command.createdAt).toLocaleString('pt-BR')+' · '+
     (command.kind==='video'?'vídeo':command.kind==='image'?'imagem':'mensagem')+' · '+
     (STATE_LABEL[command.state]||command.state)+(command.errorCode?' ('+command.errorCode+')':'');
    history.append(row);
   }
  }

  async function refresh(){
   section.remove();
   await render({root,api,me});
  }
 }
 globalThis.SocioOwnerChannelUI={render};
})();
