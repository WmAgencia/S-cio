(()=>{
 const el=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;};
 async function render({root,api,canManage,account}){
  const section=el('section');root.append(section);section.append(el('h2','Ferramentas da conta selecionada'));
  section.append(el('p',account.account_name+' · '+account.account_id+' · '+(account.currency||'')));
  const feedback=el('p');feedback.setAttribute('role','status');section.append(feedback);
  const actions=el('div');actions.className='form-actions';section.append(actions);
  const output=el('div');section.append(output);
  const button=(parent,label,fn)=>{const b=el('button',label);b.type='button';b.className='btn';parent.append(b);b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){feedback.textContent=e.message;}finally{b.disabled=false;}});return b;};
  const read=kind=>api('/api/marketing/tools/'+kind);
  const show=async(kind)=>{
   feedback.textContent='Consultando a Meta…';const r=await read(kind);output.replaceChildren();
   if(kind==='finance'){
    output.append(el('h3','Cobrança e pagamentos'),el('p','Moeda: '+r.account.currency+' · Gasto acumulado: '+(Number(r.account.amount_spent||0)/100).toFixed(2)+' · Limite de gasto: '+(Number(r.account.spend_cap||0)>0?(Number(r.account.spend_cap)/100).toFixed(2):'não informado')));
    output.append(el('p','Gasto acumulado e limite não representam saldo pré-pago disponível. Adição de saldo e pagamentos são concluídos na área segura da Meta, conforme os meios disponíveis para esta conta.'));
    const link=el('a','Abrir cobrança e adicionar saldo na Meta');link.href=r.paymentsUrl;link.target='_blank';link.rel='noopener noreferrer';link.className='btn';output.append(link);
   }else{
    output.append(el('h3',({campaigns:'Campanhas',adsets:'Conjuntos de anúncios',ads:'Anúncios',images:'Imagens da conta',insights:'Resultados dos últimos 7 dias',history:'Histórico de operações'})[kind]||kind));
    if(!r.items.length)output.append(el('p','Nenhum registro encontrado.'));
    for(const item of r.items){
     const card=el('article');card.className='panel';output.append(card);card.append(el('h4',item.name||item.campaign_name||item.kind||item.hash||item.id));
     if(kind==='ads'&&item.creative?.thumbnail_url){try{const u=new URL(item.creative.thumbnail_url);if(u.protocol==='https:'&&/(^|\.)fbcdn\.net$|(^|\.)fbsbx\.com$/.test(u.hostname)){const image=el('img');image.src=u.href;image.alt=item.name||'Criativo do anúncio';image.width=160;image.loading='lazy';card.append(image);}}catch{}}
     const facts=el('dl');card.append(facts);for(const [key,label] of [['id','ID'],['hash','Identificador da imagem'],['effective_status','Veiculação'],['status','Situação'],['objective','Objetivo'],['impressions','Impressões'],['reach','Alcance'],['clicks','Cliques'],['spend','Valor gasto'],['created_at','Data']])if(item[key]!==undefined){facts.append(el('dt',label),el('dd',String(item[key])));}if(item.daily_budget)facts.append(el('dt','Orçamento diário'),el('dd',(Number(item.daily_budget)/100).toFixed(2)+' '+(account.currency||'')));if(item.result?.error)card.append(el('p',item.result.error));for(const [key,label] of [['campaignId','Campanha'],['adsetId','Conjunto'],['creativeId','Criativo'],['adId','Anúncio']])if(item.result?.[key])card.append(el('p',label+': '+item.result[key]));
     if(['campaigns','adsets','ads'].includes(kind)){
      const link=el('a','Visualizar no Gerenciador de Anúncios');link.href='https://adsmanager.facebook.com/adsmanager/manage/'+kind+'?act='+account.account_id.slice(4)+'&selected_'+({campaigns:'campaign',adsets:'adset',ads:'ad'})[kind]+'_ids='+encodeURIComponent(item.id);link.target='_blank';link.rel='noopener noreferrer';card.append(link);
      if(canManage){const entity={campaigns:'campaign',adsets:'adset',ads:'ad'}[kind];
       button(card,'Preparar pausa',()=>prepare('status',{entity,id:item.id,status:'PAUSED'}));
       button(card,'Preparar ativação',()=>prepare('status',{entity,id:item.id,status:'ACTIVE'}));
       const name=el('input');name.type='text';name.maxLength=120;name.value=item.name||'';name.setAttribute('aria-label','Novo nome de '+(item.name||item.id));card.append(name);
       button(card,'Preparar alteração de nome',()=>prepare('rename',{entity,id:item.id,name:name.value}));
       if(kind==='adsets'||kind==='campaigns'){const budget=el('input');budget.type='number';budget.min='1';budget.max='100000';budget.step='0.01';budget.value=item.daily_budget?(Number(item.daily_budget)/100).toFixed(2):'';budget.setAttribute('aria-label','Novo orçamento diário de '+(item.name||item.id));card.append(budget);button(card,'Preparar orçamento',()=>prepare('budget',{entity,id:item.id,dailyBudgetCents:Math.round(Number(budget.value)*100)}));}
      }
     }
    }
    if(r.hasMore)output.append(el('p','Exibindo os primeiros 100 registros. Consulte os demais no Gerenciador de Anúncios.'));
   }
   feedback.textContent='Consulta concluída.';
  };
  for(const [kind,label] of [['campaigns','Campanhas'],['adsets','Conjuntos'],['ads','Anúncios'],['images','Imagens'],['insights','Métricas'],['finance','Saldo e pagamentos'],['history','Histórico']])button(actions,label,()=>show(kind));
  const review=el('section');review.hidden=true;section.append(review);
  async function prepare(kind,input){
   feedback.textContent='Preparando prévia…';const plan=await api('/api/marketing/tools/plan','POST',{kind,input});review.hidden=false;review.replaceChildren(el('h3','Revise antes de executar'));
   const s=plan.summary;review.append(el('p',s.description),el('p','Conta: '+s.account.name+' · '+s.account.id));if(s.name)review.append(el('p',s.createsPixel?'Pixel: '+s.name:'Campanha: '+s.name));if(s.headline)review.append(el('p','Título: '+s.headline));if(s.message)review.append(el('p','Texto: '+s.message));if(s.pageId)review.append(el('p','Página: '+s.pageId));if(s.imageHash)review.append(el('p','Imagem: '+s.imageHash));if(s.dailyBudgetCents)review.append(el('p','Orçamento diário: '+(s.dailyBudgetCents/100).toFixed(2)+' '+s.account.currency));if(s.destination)review.append(el('p','Destino: '+s.destination));if(s.city)review.append(el('p','Localização: '+s.city+' · Idades: '+s.ageMin+' a '+s.ageMax));if(s.object){review.append(el('p','Item: '+s.object.name+' · '+s.object.id));const ch=s.changes;if(ch.name)review.append(el('p','Novo nome: '+ch.name));if(ch.status)review.append(el('p','Novo status: '+ch.status));if(ch.dailyBudgetCents)review.append(el('p','Novo orçamento diário: '+(ch.dailyBudgetCents/100).toFixed(2)+' '+s.account.currency));}
   const label=el('label');const check=el('input');check.type='checkbox';check.style.width='auto';label.append(check,document.createTextNode('Revisei a conta, os dados e os possíveis gastos desta operação.'));review.append(label);
   const execute=button(review,'Confirmar e executar na Meta',async()=>{
    if(!check.checked)throw Error('Confirme que revisou a operação.');
    const r=await api('/api/marketing/tools/execute','POST',{planId:plan.id,confirmed:true});
    review.replaceChildren(el('h3',r.status==='succeeded'?'Operação confirmada pela Meta':'Operação não concluída'));
    if(r.error)review.append(el('p',r.error));for(const [key,label] of [['pixelId','Pixel criado'],['campaignId','Campanha'],['adsetId','Conjunto'],['creativeId','Criativo'],['adId','Anúncio'],['id','Item'],['delivery','Veiculação']])if(r.result?.[key])review.append(el('p',label+': '+r.result[key]));
    feedback.textContent=r.status==='succeeded'?'Confira os IDs e o status retornados pela Meta.':'Confira o histórico e os itens criados antes de preparar outra operação.';
   });execute.disabled=true;check.addEventListener('change',()=>{execute.disabled=!check.checked;});
   feedback.textContent='Prévia pronta. Nenhuma alteração executada.';review.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  if(!canManage)return;
  const pixelSection=el('details');
  pixelSection.append(el('summary','Criar ou configurar Pixel da Meta · Eventos'));
  section.append(pixelSection);
  pixelSection.append(el('p','Antes de criar, consulte os Pixels existentes na conta selecionada. A Meta pode limitar quantos Pixels uma conta pode criar. Criar não instala no site nem ativa automaticamente a Conversions API.'));
  const pixelOutput=el('div');pixelSection.append(pixelOutput);
  const refreshPixels=async()=>{
   feedback.textContent='Verificando Pixels da conta autorizada…';
   const result=await api('/api/marketing/advanced/pixels');pixelOutput.replaceChildren();
   const existing=Array.isArray(result.items)?result.items:[];
   for(const pixel of existing){
    const item=el('article');item.className='panel';pixelOutput.append(item);
    item.append(el('strong',pixel.name||'Pixel'),el('p','ID: '+pixel.id),
     el('p',pixel.last_fired_time?'Última atividade informada pela Meta: '+pixel.last_fired_time:'Nenhuma atividade recente informada neste resultado.'));
   }
   if(!existing.length)pixelOutput.append(el('p','A Meta não retornou Pixels nesta conta. É possível preparar a criação de um Pixel novo.'));
   if(result.hasMore)pixelOutput.append(el('p','Há mais Pixels na Meta. Confira todos no Gerenciador de Eventos antes de criar.'));
   feedback.textContent='Consulta de Pixels concluída; nenhum Pixel foi alterado.';
  };
  button(pixelSection,'Consultar Pixels existentes',refreshPixels);
  const pixelForm=el('div');pixelForm.className='form-stack';pixelSection.append(pixelForm);
  const pixelNameLabel=el('label','Nome do novo Pixel'),pixelName=el('input');
  pixelName.type='text';pixelName.minLength=3;pixelName.maxLength=120;
  pixelName.placeholder='Ex.: Loja Sorocaba | Pixel de conversões';
  pixelNameLabel.append(pixelName);pixelForm.append(pixelNameLabel);
  button(pixelForm,'Preparar criação de Pixel',()=>prepare('create_pixel',{name:pixelName.value}));
  const steps=el('div');steps.className='panel';pixelSection.append(steps);
  steps.append(el('h3','O que falta para rastrear vendas de verdade'),
   el('p','1. Instalar o Pixel no domínio do cliente somente após o consentimento de publicidade.'),
   el('p','2. Configurar eventos reais: PageView, ViewContent, AddToCart, InitiateCheckout, Lead e Purchase.'),
   el('p','3. Integrar Conversions API (CAPI) no backend com credenciais próprias do dataset e IDs de evento iguais aos do navegador para evitar duplicidade.'),
   el('p','4. Confirmar Purchase apenas com pagamento validado por webhook; não converter cliques ou intenções do WhatsApp em vendas.'),
   el('p','5. Testar os eventos no Gerenciador de Eventos da Meta e conferir a qualidade dos sinais antes da otimização.'));
  const details=el('details');details.append(el('summary','Criar campanha com imagem · site ou WhatsApp'));section.append(details);
  details.append(el('p','Cria campanha, conjunto, criativo e anúncio sempre PAUSADOS. Para WhatsApp, selecione um número conectado pelo WA-AKG; ele precisa estar vinculado à Página na Meta. A Meta pode recusar combinações incompatíveis.'));
  const form=el('div');form.className='form-stack';details.append(form);const inputs={};
  const input=(key,label,type='text')=>{const wrap=el('label',label),field=el('input');field.type=type;wrap.append(field);form.append(wrap);inputs[key]=field;return field;};
  const kindLabel=el('label','Destino do anúncio'),kind=el('select');
  for(const [id,name] of [['create','Visitas ao site'],['create_whatsapp','Conversas pelo WhatsApp']]){
   const opt=el('option',name);opt.value=id;kind.append(opt);
  }
  kindLabel.append(kind);form.append(kindLabel);
  input('name','Nome da campanha');
  const website=input('url','Link do site (HTTPS)','url');
  const waLabel=el('label','WhatsApp de atendimento');
  const wa=el('select');waLabel.append(wa);waLabel.hidden=true;form.append(waLabel);
  kind.addEventListener('change',()=>{website.parentElement.hidden=kind.value==='create_whatsapp';waLabel.hidden=kind.value!=='create_whatsapp';});
  try{
   const channels=await api('/api/waakg/channels');
   const option=el('option','Selecione um WhatsApp conectado');option.value='';wa.append(option);
   for(const x of Array.isArray(channels)?channels:[]){
    if(x.status!=='connected'||!/^[0-9]{10,15}$/.test(x.phone||''))continue;
    const o=el('option',x.label+' · '+x.phone);o.value=x.phone;wa.append(o);
   }
  }catch{const opt=el('option','WhatsApp não disponível');opt.value='';wa.append(opt);}
  input('headline','Título do anúncio');input('message','Texto do anúncio');const budget=input('budget','Orçamento diário em '+(account.currency||'moeda da conta'),'number');budget.min='1';budget.max='100000';budget.step='0.01';
  const pageLabel=el('label','Página do Facebook');const pages=el('select');pageLabel.append(pages);form.append(pageLabel);
  const imageLabel=el('label','Imagem da conta');const images=el('select');imageLabel.append(images);form.append(imageLabel);
  const fill=(select,items,key,label)=>{select.replaceChildren();const empty=el('option','Selecione…');empty.value='';select.append(empty);for(const item of items){const o=el('option',label(item));o.value=item[key];select.append(o);}};
  button(form,'Carregar páginas e imagens',async()=>{const [p,i]=await Promise.all([read('pages'),read('images')]);fill(pages,p.items,'id',x=>x.name+' · '+x.id);fill(images,i.items,'hash',x=>(x.name||'Imagem')+' · '+x.hash);feedback.textContent=p.items.length?'Recursos da conta carregados.':'A Meta não retornou páginas acessíveis nesta conta. Confira as permissões e o vínculo da página no negócio Meta antes de criar o anúncio.';});
  const file=input('file','Enviar nova imagem (JPG, PNG ou WebP, até 3 MB)','file');file.accept='image/jpeg,image/png,image/webp';
  button(form,'Enviar imagem para a Meta',async()=>{const f=file.files?.[0];if(!f||f.size>3000000)throw Error('Selecione uma imagem de até 3 MB.');const encoded=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Falha ao ler imagem.'));r.readAsDataURL(f);});const r=await api('/api/marketing/tools/image','POST',{contentBase64:encoded});const o=el('option','Imagem enviada · '+r.hash);o.value=r.hash;images.append(o);images.value=r.hash;feedback.textContent='Imagem enviada para a conta selecionada. Nenhum anúncio publicado.';});
  input('city','Pesquisar cidade no Brasil');const cityLabel=el('label','Cidade encontrada');const cities=el('select');cityLabel.append(cities);form.append(cityLabel);
  button(form,'Buscar cidade',async()=>{const r=await api('/api/marketing/tools/cities?q='+encodeURIComponent(inputs.city.value));fill(cities,r.items,'key',x=>[x.name,x.region,x.country_name].filter(Boolean).join(' · '));});
  button(form,'Preparar campanha pausada',()=>{
   if(kind.value==='create_whatsapp'&&!wa.value)throw Error('Selecione um número WA-AKG conectado.');
   return prepare(kind.value,{name:inputs.name.value,url:inputs.url.value,whatsappPhone:wa.value,
    headline:inputs.headline.value,message:inputs.message.value,dailyBudgetCents:Math.round(Number(budget.value)*100),
    pageId:pages.value,imageHash:images.value,cityKey:cities.value,
    cityName:cities.selectedOptions[0]?.textContent.split(' · ')[0]||'',ageMin:18,ageMax:65});
  });
  const newAd=el('details');section.append(newAd);newAd.append(el('summary','Adicionar anúncio a um conjunto existente'));
  newAd.append(el('p','Cria um criativo e um anúncio PAUSADO em um conjunto da conta selecionada, sem alterar orçamento ou campanhas.'));
  const adForm=el('div');adForm.className='form-stack';newAd.append(adForm);
  const adField=(label,type='text')=>{const wrap=el('label',label),field=el('input');field.type=type;wrap.append(field);adForm.append(wrap);return field;};
  const adName=adField('Nome do anúncio');
  const adText=adField('Texto do anúncio');
  const adHeadline=adField('Título');
  const adUrl=adField('Destino HTTPS','url');
  const adSelect=(label)=>{const wrap=el('label',label),node=el('select');wrap.append(node);adForm.append(wrap);return node;};
  const adsets=adSelect('Conjunto da conta');
  const adPages=adSelect('Página da conta');
  const adImages=adSelect('Imagem da conta');
  button(adForm,'Carregar conjuntos, páginas e imagens',async()=>{
   const [sets,pages,images]=await Promise.all([read('adsets'),read('pages'),read('images')]);
   const populate=(node,items,key,label)=>{
    node.replaceChildren();const empty=el('option','Selecione…');empty.value='';node.append(empty);
    for(const x of items){const option=el('option',label(x));option.value=x[key];node.append(option);}
   };
   populate(adsets,sets.items,'id',x=>x.name+' · '+x.id);
   populate(adPages,pages.items,'id',x=>x.name+' · '+x.id);
   populate(adImages,images.items,'hash',x=>x.name||x.hash);
   feedback.textContent='Escolha os recursos e prepare a prévia; nenhum anúncio foi criado.';
  });
  button(adForm,'Preparar anúncio pausado',()=>{
   return prepare('create_ad',{name:adName.value,message:adText.value,headline:adHeadline.value,
    url:adUrl.value,adsetId:adsets.value,pageId:adPages.value,imageHash:adImages.value});
  });
 }
 globalThis.SocioAdsTools={render};
})();
