// Tenant-safe WhatsApp attribution controls; no ad publication or WhatsApp sending.
(()=>{
 const el=(tag,value)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);return node;};
 const field=(form,title,name,placeholder,max=90)=>{
  const wrapper=el('label',title),input=el('input');
  input.type='text';input.name=name;input.maxLength=max;input.placeholder=placeholder;wrapper.append(input);form.append(wrapper);
  return input;
 };
 async function render({root,api,canManage,account}){
  const section=el('section');section.className='card card-pad';
  section.dataset.tracking='whatsapp';root.append(section);
  section.append(el('h2','Rastreamento WhatsApp — origem dos leads'));
  section.append(el('p','Gere links rastreáveis por anúncio e acompanhe códigos enviados pelos clientes. Não é atribuição confirmada pela Meta; vendas e pagamentos permanecem métricas separadas.'));
  const status=el('p');status.setAttribute('role','status');section.append(status);
  const report=el('div');section.append(report);
  const reload=async()=>{
   const [links,stats,funnel]=await Promise.all([
    api('/api/marketing/attribution/links'),api('/api/marketing/attribution/report'),
    api('/api/marketing/attribution/funnel')]);
   report.replaceChildren();
   const summary=el('p','Origem: código observado na mensagem, não um clique comprovado.');report.append(summary);
   report.append(el('p','Funil de respostas e pedidos registrado pelo WA-AKG. Pagamentos de teste Stripe não são faturamento real.'));
   if(funnel.collectionEnabled===false)report.append(el('p','A coleta automática de novos códigos está desligada. As contagens podem estar incompletas. Conecte e homologue um número WA-AKG antes de habilitá-la.'));
   const table=el('div');table.className='attribution-results';report.append(table);
   if(!stats.items?.length){table.append(el('p','Nenhum anúncio com link rastreável cadastrado.'));return;}
   const funnelById=new Map((funnel.items||[]).map(x=>[x.id,x]));
   for(const item of stats.items){
    const card=el('article');card.className='panel';table.append(card);
    card.append(el('strong',item.label),el('p','Conta '+item.account_id+(item.campaign_id?' · Campanha '+item.campaign_id:'')+(item.ad_id?' · Anúncio '+item.ad_id:'')));
    const detail=funnelById.get(item.id);
    if(detail){
     card.append(el('p','Conversas com código: '+detail.conversations+
      ' · Respondidas pela empresa: '+detail.businessResponded+
      ' · Clientes que responderam novamente: '+detail.customerFollowedUp));
     card.append(el('p','Orçamentos: '+detail.quoteRequests+' · Intenções: '+
      detail.purchaseIntents+' · Pedidos cadastrados: '+detail.ordersCreated));
     card.append(el('p','Primeira resposta média: '+
      (detail.averageFirstBusinessReplySeconds===null?'sem dados':
       Math.round(detail.averageFirstBusinessReplySeconds/60)+' min (aproximado)')));
     if(Number(detail.sandboxPaidOrders)>0)card.append(el('p','Somente em teste Stripe: '+
      detail.sandboxPaidOrders+' pagamento(s), '+
      new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(detail.sandboxRevenueCents)/100)+
      '. Esses pagamentos não são vendas reais.'));
     card.append(el('p','Vendas reais e receita confirmada: indisponíveis sem um provedor de pagamentos de produção validado.'));
    }else{
     card.append(el('p','Conversas com código: '+item.conversations+
      ' · Orçamentos: '+item.quote_requests+' · Intenções de compra: '+item.purchase_intents));
    }
    const saved=links.links.find(x=>x.id===item.id);
    if(saved){
     const link=el('a','Abrir link do WhatsApp');link.href=saved.url;link.rel='noopener noreferrer';link.target='_blank';card.append(link);
     const copy=el('button','Copiar link');copy.className='btn soft';copy.type='button';card.append(copy);
     copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(saved.url);status.textContent='Link copiado.';}catch{status.textContent='Não foi possível copiar automaticamente. Use o link acima.';}});
     if(canManage&&item.active){
      const off=el('button','Desativar');off.type='button';off.className='btn soft';card.append(off);
      off.addEventListener('click',async()=>{
       if(!confirm('Desativar este link para novos rastreamentos? Os registros antigos serão preservados.'))return;
       off.disabled=true;try{await api('/api/marketing/attribution/links/'+item.id,'DELETE');await reload();}
       catch(error){status.textContent=error.message;off.disabled=false;}
      });
     }
     if(!item.active)card.append(el('p','Link desativado para novos registros.'));
    }
   }
  };
  if(canManage){
   const form=el('form');form.className='form-stack';section.append(form);
   const channels=el('select');channels.name='channelId';channels.required=true;
   const wrap=el('label','WhatsApp da empresa');wrap.append(channels);form.append(wrap);
   const name=field(form,'Identificação do link','label','Ex.: Anúncio de Sorocaba');
   name.required=true;name.minLength=3;
   field(form,'ID da campanha (opcional)','campaignId','Somente números',30);
   field(form,'ID do conjunto (opcional)','adsetId','Somente números',30);
   field(form,'ID do anúncio (opcional)','adId','Somente números',30);
   const submit=el('button','Gerar link rastreável');submit.className='btn primary';submit.type='submit';form.append(submit);
   const output=el('div');form.append(output);
   try{
    const raw=await api('/api/waakg/channels');
    const connected=(Array.isArray(raw)?raw:[]).filter(x=>x.status==='connected');
    for(const channel of connected){
     const option=el('option',channel.label+' · '+channel.phone);option.value=channel.id;channels.append(option);
    }
    if(!connected.length){submit.disabled=true;form.append(el('p','Conecte primeiro um WhatsApp pelo WA-AKG.'));}
   }catch(e){submit.disabled=true;status.textContent='Não foi possível consultar os números: '+e.message;}
   form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    submit.disabled=true;status.textContent='Gerando link para a conta '+account.account_id+'…';
    const values=new FormData(form),input=Object.fromEntries(values);
    try{
     const created=await api('/api/marketing/attribution/links','POST',input);
     output.replaceChildren(el('p','Link criado. Use apenas em anúncios ou páginas que aceitam mensagem pré-preenchida. Nenhuma campanha foi editada.'));
     const url=el('input');url.readOnly=true;url.value=created.url;url.setAttribute('aria-label','Link de WhatsApp rastreável');output.append(url);
     await reload();status.textContent='Link registrado. A origem só aparecerá quando um cliente enviar a mensagem com o código.';
    }catch(e){status.textContent=e.message;}
    finally{submit.disabled=false;}
   });
  }
  try{await reload();}catch(e){status.textContent='O relatório de rastreamento ainda não está disponível: '+e.message;}
 }
 globalThis.SocioAttribution={render};
})();
