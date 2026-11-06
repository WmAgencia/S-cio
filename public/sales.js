/* Sócio Phase 3: supervised quote and sales management; never auto sends. */
(function(){
 'use strict';
 let revision=null,linkToShare='',requestedConversationId=null,activeRequestId=null;
 async function render({api,e,toast,view,me,navigate,mode='quotes'}){
  if(mode==='sales')return renderPurchaseQueue({api,e,toast,view,navigate});
  const [sales,products,contacts,leads]=await Promise.all([
   api('/api/sales'),api('/api/products'),api('/api/inbox'),api('/api/sales/quote-requests')
  ]);
  const requests=leads.requests||[];
  const canConfigureAlerts=me?.user?.role==='owner'||me?.user?.platformOwner===true;
  const allowed=products.filter(p=>p.active);
  const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
  const mentionedProducts=summary=>allowed.filter(p=>normalize(p.name).length>=4&&normalize(summary).includes(normalize(p.name))).slice(0,8).map(p=>p.name);
  const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0)/100);
  const sale=revision?sales.quotes.find(q=>q.id===revision):null;
  if(revision&&!sale)revision=null;
  const selectProduct=(selected='')=>'<select data-sale-product required><option value="">Escolha um produto</option>'+
   allowed.map(p=>'<option value="'+e(p.id)+'"'+(p.id===selected?' selected':'')+'>'+e(p.name)+' — '+money(p.price_cents)+'</option>').join('')+'</select>';
  const makeRow=(item={})=>'<div class="sale-item" data-sale-item>'+
   selectProduct(item.productId)+
   '<select data-sale-variant aria-label="Variação" disabled><option value="">Padrão</option></select>'+
   '<label>Qtd.<input type="number" min="1" max="100" step="1" data-sale-quantity required value="'+e(item.quantity||1)+'"></label>'+
   '<button type="button" class="btn ghost" data-sale-remove aria-label="Remover item">×</button></div>';
  const itemByQuote=(q)=>q.items.map(x=>({productId:x.productId,variantId:x.variantId,quantity:x.quantity}));
  const activeQuote=revision?sales.quotes.find(x=>x.id===revision):null;
  const items=activeQuote?itemByQuote(activeQuote):[{}];
  const label={draft:'Rascunho',issued:'Aguardando cliente',accepted:'Aprovado',declined:'Recusado',superseded:'Versão antiga',cancelled:'Cancelado',expired:'Expirado'};
  view.innerHTML='<div class="socio-sales">'+
   '<div class="view-heading"><div><span class="eyebrow">PROPOSTAS COMERCIAIS</span><h1>Orçamentos</h1>'+
   '<p>Pedidos recebidos, propostas personalizadas e valores conferidos antes do envio ao cliente.</p></div></div>'+
   '<section class="card card-pad quote-request-panel"><div class="quote-request-header"><div><h2>Pedidos de orçamento recebidos</h2>'+
   '<p class="form-note">Pedidos identificados nas mensagens do WhatsApp. A IA não cria preços nem envia orçamentos sem sua revisão.</p></div>'+
   (canConfigureAlerts?'<label class="quote-alert-toggle"><input type="checkbox" id="quoteOwnerAlerts" '+
    (leads.alertWhatsAppEnabled?'checked':'')+'> Avisar o proprietário pelo WhatsApp</label>':'')+
   '</div>'+
   (requests.length?'<div class="quote-request-list">'+requests.map(q=>
    '<article class="quote-request-item"><div><strong>'+e(q.customer_name||q.customer_phone||'Cliente')+'</strong>'+
    '<p>'+e(q.summary||'Solicitação de orçamento').slice(0,500)+'</p>'+
    (mentionedProducts(q.summary).length?'<p class="quote-mentioned-products"><strong>Produtos mencionados:</strong> '+e(mentionedProducts(q.summary).join(' · '))+'</p>':'')+
    '<small>'+e(q.status==='pending'?'Aguardando orçamento':q.status==='preparing'?'Em preparação':'Resolvido')+
     ' · '+e(new Date(q.created_at).toLocaleDateString('pt-BR'))+
     (q.alert_status==='sent'?' · Aviso enviado ao dono':q.alert_status==='unconfirmed'?' · Verifique aviso no WhatsApp':'')+'</small></div>'+
    '<div class="quote-request-actions">'+
    '<button type="button" class="btn sm soft" data-quote-chat="'+e(q.conversation_id)+'">Conversar</button>'+
    (q.delivery_status==='sent'?'<span class="sale-state">Enviado ao cliente</span>':
     q.delivery_status==='unconfirmed'?'<span class="sale-state">Envio incerto — confira o WhatsApp</span>':'')+
    (q.status!=='resolved'?'<button type="button" class="btn sm primary" data-quote-prepare="'+e(q.id)+
      '">Preparar orçamento</button><button type="button" class="btn sm soft" data-quote-resolve="'+e(q.id)+'">Marcar resolvido</button>':'')+
    '</div>'+
    (q.status!=='resolved'?
     '<details class="quote-quick-editor"><summary>Finalizar e enviar orçamento</summary>'+
      '<form data-quote-draft="'+e(q.id)+'" class="quote-draft-form form-stack">'+
       '<label>Descrição dos materiais, serviços e condições<textarea name="text" rows="4" maxlength="2300" required placeholder="Descreva os itens, quantidades, prazos e condições">'+e(q.draft_text||q.summary||'')+'</textarea></label>'+
       '<label>Valor final (R$)<input name="amount" type="number" min="0.01" max="999999.99" step="0.01" required value="'+e(q.draft_amount_cents?Number(q.draft_amount_cents/100).toFixed(2):'')+'"></label>'+
       '<div class="quote-request-actions"><button class="btn sm soft" type="submit">Salvar orçamento</button>'+
       '<button class="btn sm primary" type="button" data-quote-send="'+e(q.id)+'" '+(!q.draft_text||!q.draft_amount_cents||q.delivery_status!=='not_sent'?'disabled':'')+'>Enviar para o WhatsApp</button></div>'+
       '<p class="form-note">O envio só acontece por um WhatsApp autorizado e uma conversa assumida por humano. Confira o texto antes de enviar.</p>'+
      '</form></details>':'')+
    '</article>').join('')+'</div>':
    '<p class="form-note">Nenhum pedido identificado ainda. Quando o cliente pedir um orçamento pelo WhatsApp, ele aparecerá aqui.</p>')+
   '<p class="form-note">Notificações por WhatsApp são opcionais, exigem autorização do dono e um número da empresa conectado. Nenhuma mensagem é reenviada automaticamente se a entrega for incerta.</p>'+
   '</section>'+
   '<div class="sale-grid"><section class="card card-pad"><h2>'+(activeQuote?'Revisar orçamento · versão '+e(activeQuote.version):'Criar orçamento')+'</h2>'+
    '<form id="saleForm" class="form-stack"><label>Conversa do cliente<select name="conversationId" required>'+
     '<option value="">Selecione uma conversa</option>'+contacts.map(c=>'<option value="'+e(c.id)+'"'+((activeQuote?.conversation_id||requestedConversationId)===c.id?' selected':'')+'>'+
     e(c.customer_name||c.customer_phone)+' · '+e(c.channel_label||'WhatsApp')+'</option>').join('')+'</select></label>'+
     '<div class="sale-label">Itens do catálogo</div><div id="saleItems">'+items.map(makeRow).join('')+'</div>'+
     '<div class="row-actions"><button type="button" class="btn soft" id="saleAdd">+ Adicionar item</button>'+
     '<button type="submit" class="btn primary" '+(!allowed.length||!contacts.length?'disabled':'')+'>'+
     (activeQuote?'Gerar nova versão':'Criar rascunho')+'</button></div>'+
    '</form>'+
    (!contacts.length?'<p class="form-note">Você precisa ter uma conversa de WhatsApp registrada para emitir um orçamento.</p>':'')+
    (!allowed.length?'<p class="form-note">Cadastre um produto ativo antes de criar orçamentos. <button type="button" class="btn sm soft" id="goToCatalog">Abrir catálogo</button></p>':'')+
    '<p class="form-note">O sistema usa exclusivamente preço e disponibilidade do catálogo, sem descontos ou valores arbitrários.</p>'+
   '</section>'+
   '<section class="card card-pad"><h2>Orçamentos recentes</h2>'+
    (sales.quotes.length?'<div class="sale-records">'+sales.quotes.map(q=>
      '<div class="sale-record"><div><strong>'+e(q.customer_name||q.customer_phone||'Cliente')+'</strong>'+
      '<small>Versão '+e(q.version)+' · '+e(label[q.status]||q.status)+'</small>'+
      '<small>'+money(q.amount_cents)+'</small></div><div class="sale-record-actions">'+
      (['draft','issued'].includes(q.status)?'<button class="btn sm primary" data-sale-issue="'+e(q.id)+'">'+
       (q.status==='issued'?'Renovar link':'Gerar link')+'</button>'+
       '<button class="btn sm soft" data-sale-revise="'+e(q.id)+'">Revisar</button>'+
       '<button class="btn sm ghost" data-sale-cancel="'+e(q.id)+'">Cancelar</button>':'')+
      '</div></div>').join('')+'</div>':'<p class="form-note">Nenhum orçamento emitido.</p>')+
   '</section></div>'+
   '<section class="card card-pad hidden"><h2>Pedidos</h2><p class="form-note">Pedido aprovado não significa pagamento confirmado ou mercadoria reservada.</p>'+
    (sales.orders.length?'<div class="sale-records">'+sales.orders.map(o=>
     '<div class="sale-record"><div><strong>'+e(o.customer_name)+'</strong><small>'+money(o.amount_cents)+
     '</small></div><span class="sale-state">'+
     e(o.status==='pending_payment'?'Aguardando pagamento/atendimento':o.status==='paid_test'?'Pago apenas no teste':o.status==='manual_review'?'Revisão manual':o.status)+
     '</span></div>').join('')+'</div>':'<p class="form-note">Nenhum pedido aprovado.</p>')+
   '</section>'+
   '<section class="card card-pad sale-links"><h2>Link para enviar ao cliente</h2>'+
    '<p class="form-note">O Sócio não dispara o link automaticamente. Copie e compartilhe pelo atendimento autorizado.</p>'+
    '<input id="saleShareLink" readonly aria-label="Link de aprovação" value="'+e(linkToShare)+'" placeholder="Gere um link em um orçamento">'+
    '<button type="button" class="btn soft" id="saleCopy">Copiar link</button></section>'+
   (sales.paymentTestAvailable?'<p class="form-note">Stripe em modo de teste: habilitado. Isso não aceita pagamentos reais.</p>':
    '<p class="form-note">Pagamento: somente fluxos de aprovação. O checkout Stripe de teste permanece desativado até receber credenciais de sandbox.</p>')+
  '</div>';
  const $=s=>view.querySelector(s), findAll=s=>[...view.querySelectorAll(s)];
  $('#goToCatalog')?.addEventListener('click',()=>navigate?.('products'));
  $('#quoteOwnerAlerts')?.addEventListener('change',async ev=>{
   const enabled=ev.currentTarget.checked;
   if(enabled&&!confirm('Autoriza o Sócio a avisar o proprietário no WhatsApp conectado quando um cliente pedir orçamento?')){
    ev.currentTarget.checked=false;return;
   }
   ev.currentTarget.disabled=true;
   try{
    await api('/api/sales/quote-alerts','PUT',{enabled});
    toast(enabled?'Avisos para o proprietário habilitados.':'Avisos automáticos desativados.');
   }catch(err){ev.currentTarget.checked=!enabled;toast(err.message,true);}
   finally{ev.currentTarget.disabled=false;}
  });
  view.querySelectorAll('[data-quote-chat]').forEach(btn=>btn.addEventListener('click',()=>navigate?.('inbox',btn.dataset.quoteChat)));
  view.querySelectorAll('[data-quote-draft]').forEach(form=>form.addEventListener('submit',async event=>{
   event.preventDefault();
   const amount=Math.round(Number(form.elements.amount.value)*100);
   const text=form.elements.text.value.trim();
   try{
    await api('/api/sales/quote-requests/'+form.dataset.quoteDraft+'/draft','POST',{text,amountCents:amount});
    toast('Orçamento salvo. Revise antes de enviar.');
    await render({api,e,toast,view,me,navigate,mode:'quotes'});
   }catch(error){toast(error.message,true);}
  }));
  view.querySelectorAll('[data-quote-send]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(!confirm('Confirma o envio deste orçamento salvo diretamente ao WhatsApp do cliente?'))return;
   btn.disabled=true;
   try{
    await api('/api/sales/quote-requests/'+btn.dataset.quoteSend+'/send','POST',{});
    toast('Envio confirmado pelo gateway do WhatsApp.');
    await render({api,e,toast,view,me,navigate,mode:'quotes'});
   }catch(error){toast(error.message,true);btn.disabled=false;}
  }));
  view.querySelectorAll('[data-quote-prepare]').forEach(btn=>btn.addEventListener('click',async()=>{
   const q=requests.find(x=>x.id===btn.dataset.quotePrepare);
   if(!q)return;
   activeRequestId=q.id;requestedConversationId=q.conversation_id;revision=null;linkToShare='';
   try{
    await api('/api/sales/quote-requests/'+q.id+'/status','PATCH',{status:'preparing'});
    await render({api,e,toast,view,me,navigate});
    $('#saleForm')?.scrollIntoView({behavior:'smooth',block:'start'});
    $('#saleForm select[name="conversationId"]')?.focus();
   }catch(err){toast(err.message,true);}
  }));
  view.querySelectorAll('[data-quote-resolve]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(!confirm('Marcar esta solicitação como resolvida?'))return;
   try{
    await api('/api/sales/quote-requests/'+btn.dataset.quoteResolve+'/status','PATCH',{status:'resolved'});
    if(activeRequestId===btn.dataset.quoteResolve){activeRequestId=null;requestedConversationId=null;}
    await render({api,e,toast,view,me,navigate});
   }catch(err){toast(err.message,true);}
  }));
  function syncVariants(row,selected){
   const pid=row.querySelector('[data-sale-product]').value,p=allowed.find(x=>x.id===pid),v=row.querySelector('[data-sale-variant]');
   const variants=(p?.variants||[]).filter(x=>x.active);
   v.disabled=!variants.length;
   v.innerHTML=variants.length?'<option value="">Selecione a variação</option>'+variants.map(x=>'<option value="'+e(x.id)+'"'+(x.id===selected?' selected':'')+'>'+
    e(x.name)+' — '+money(x.price_cents)+'</option>').join(''):'<option value="">Padrão</option>';
  }
  findAll('#saleItems [data-sale-item]').forEach((row,i)=>syncVariants(row,items[i]?.variantId));
  $('#saleItems').addEventListener('change',ev=>{
   const row=ev.target.closest('[data-sale-item]');
   if(row&&ev.target.matches('[data-sale-product]'))syncVariants(row);
  });
  $('#saleItems').addEventListener('click',ev=>{
   if(ev.target.closest('[data-sale-remove]')){
    if(findAll('[data-sale-item]').length<=1)return toast('O orçamento precisa ter ao menos um item.',true);
    ev.target.closest('[data-sale-item]').remove();
   }
  });
  $('#saleAdd').addEventListener('click',()=>{
   if(findAll('[data-sale-item]').length>=15)return toast('Limite de 15 itens.',true);
   $('#saleItems').insertAdjacentHTML('beforeend',makeRow());
  });
  $('#saleForm').addEventListener('submit',async ev=>{
   ev.preventDefault();
   try{
    const form=ev.currentTarget;
    const selected=form.elements.conversationId.value;
    const rows=findAll('[data-sale-item]').map(row=>({
     productId:row.querySelector('[data-sale-product]').value,
     variantId:row.querySelector('[data-sale-variant]').value||null,
     quantity:Number(row.querySelector('[data-sale-quantity]').value)
    }));
    await api('/api/sales/quotes','POST',{
     conversationId:selected,items:rows,...(activeQuote?{seriesId:activeQuote.series_id}:{})
    });
    revision=null;requestedConversationId=null;activeRequestId=null;linkToShare='';
    toast('Orçamento salvo como rascunho. Gere um link antes de enviar.');
    await render({api,e,toast,view,me,navigate});
   }catch(err){toast(err.message,true)}
  });
  findAll('[data-sale-revise]').forEach(btn=>btn.addEventListener('click',()=>{
   revision=btn.dataset.saleRevise;requestedConversationId=null;activeRequestId=null;render({api,e,toast,view,me,navigate});
  }));
  findAll('[data-sale-issue]').forEach(btn=>btn.addEventListener('click',async()=>{
   try{
    const info=await api('/api/sales/quotes/'+btn.dataset.saleIssue+'/issue','POST',{});
    linkToShare=location.origin+info.path;
    toast('Link de aprovação gerado. Envie manualmente ao cliente.');
    await render({api,e,toast,view,me,navigate});
   }catch(err){toast(err.message,true)}
  }));
  findAll('[data-sale-cancel]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(!confirm('Cancelar este orçamento e invalidar seu link?'))return;
   try{
    await api('/api/sales/quotes/'+btn.dataset.saleCancel+'/cancel','POST',{});
    if(revision===btn.dataset.saleCancel)revision=null;
    linkToShare='';await render({api,e,toast,view,me,navigate});
   }catch(err){toast(err.message,true)}
  }));
  $('#saleCopy').addEventListener('click',async()=>{
   if(!linkToShare)return toast('Gere um link primeiro.',true);
   try{await navigator.clipboard.writeText(linkToShare);toast('Link copiado.');}
   catch{prompt('Copie o link:',linkToShare);}
  });
 }

 async function renderPurchaseQueue({api,e,toast,view,navigate}){
  const [result,sales,catalog]=await Promise.all([
   api('/api/sales/intents'),api('/api/sales'),api('/api/products')
  ]);
  const intents=result.intents||[],products=catalog.filter(p=>p.active);
  const money=n=>n===null||n===undefined?'A confirmar':
   new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)/100);
  const count=intents.filter(x=>x.status==='pending').length;
  const orderStatus={pending_payment:'Aguardando pagamento',paid_test:'Pago apenas em teste',manual_review:'Em revisão'};
  const kanbanStages=[
   ['pending','Aguardando atendimento','Novas oportunidades'],
   ['contacted','Em atendimento','Equipe já iniciou o contato'],
   ['completed','Concluídas manualmente','Conclusão não comprova pagamento'],
   ['dismissed','Descartadas','Oportunidades encerradas']
  ];
  const kanban='<section class="commerce-kanban card card-pad" aria-label="Kanban comercial">'+
   '<div class="commerce-section-heading"><h2>Funil de oportunidades</h2><span>Dados registrados no Sócio</span></div>'+
   '<div class="commerce-kanban-columns">'+kanbanStages.map(([status,title,subtitle])=>{
    const rows=intents.filter(x=>x.status===status);
    return '<section class="commerce-kanban-lane" aria-label="'+e(title)+'">'+
     '<header><strong>'+e(title)+'</strong><span>'+rows.length+'</span></header>'+
     '<small>'+e(subtitle)+'</small>'+
     '<div class="commerce-kanban-items">'+(rows.length?rows.slice(0,40).map(x=>
      '<button type="button" class="commerce-kanban-item" data-focus-intent="'+e(x.id)+'" aria-label="Ver oportunidade de '+e(x.customer_name||'cliente')+'">'+
      '<strong>'+e(x.customer_name||'Cliente')+'</strong>'+
      '<span>'+e((x.summary||'Sem detalhes').slice(0,95))+'</span>'+
      '<small>'+money(x.amount_cents)+'</small></button>').join(''):
      '<div class="commerce-kanban-empty">Nenhuma oportunidade</div>')+'</div></section>';
   }).join('')+'</div><p class="form-note">Clique em uma oportunidade para abrir os detalhes. O Kanban não representa faturamento confirmado.</p></section>';
  const card=x=>{
   const items=Array.isArray(x.items)?x.items:[];
   const names=items.length?items.map(i=>i.quantity+'× '+i.name+(i.variantName?' · '+i.variantName:'')).join(', '):'Produtos e quantidades a confirmar';
   return '<article class="commerce-lead-card" tabindex="0" aria-label="Oportunidade de compra de '+e(x.customer_name||'cliente')+'" data-intent="'+e(x.id)+'">'+
    '<div class="commerce-lead-main"><div class="commerce-lead-avatar">'+e((x.customer_name||'C').slice(0,1).toUpperCase())+'</div>'+
    '<div class="commerce-lead-copy"><span class="commerce-lead-eyebrow">'+
     e(x.status==='pending'?'Cliente quer comprar':x.status==='contacted'?'Atendimento iniciado':x.status==='completed'?'Concluída manualmente':'Descartada')+
     '</span><h3>'+e(x.customer_name||'Cliente')+'</h3><small>'+e(x.customer_phone||'Número não informado')+'</small>'+
     '<p>'+e(names)+'</p></div><div class="commerce-lead-total"><small>Valor estimado</small><strong>'+money(x.amount_cents)+'</strong></div></div>'+
    '<div class="commerce-lead-actions"><button type="button" class="btn primary" data-lead-chat="'+e(x.conversation_id)+'">Conversar com cliente</button>'+
    '<button type="button" class="btn soft" data-lead-expand="'+e(x.id)+'">Ver detalhes</button>'+
    (x.status==='pending'?'<button type="button" class="btn soft" data-lead-status="'+e(x.id)+'" data-status="contacted">Iniciar atendimento</button>':'')+
    '</div><div class="commerce-lead-detail hidden" data-lead-detail="'+e(x.id)+'">'+
    '<p class="form-note">Mensagem original: '+e(x.summary)+'</p>'+
    '<p class="form-note">Uma oportunidade não comprova venda, reserva de estoque ou pagamento.</p>'+
    '<form data-lead-edit="'+e(x.id)+'" class="form-stack"><div class="commerce-lead-items"></div>'+
    '<div class="row-actions"><button type="button" class="btn soft" data-lead-add>+ Produto</button>'+
    '<button type="submit" class="btn primary">Salvar itens e recalcular total</button></div></form>'+
    '<div class="row-actions"><button type="button" class="btn soft" data-lead-status="'+e(x.id)+'" data-status="completed">Marcar concluída manualmente</button>'+
    '<button type="button" class="btn ghost" data-lead-status="'+e(x.id)+'" data-status="dismissed">Descartar</button></div>'+
    '</div></article>';
  };
  view.innerHTML='<div class="socio-sales commerce-page">'+
   '<div class="view-heading"><div><span class="eyebrow">OPORTUNIDADES DE COMPRA</span><h1>Vendas</h1>'+
   '<p>Clientes que demonstraram intenção de comprar. Revise os produtos, converse e finalize o pagamento diretamente no atendimento.</p></div></div>'+
   '<div class="commerce-summary"><div><small>Aguardando atendimento</small><strong>'+count+'</strong></div>'+
    '<div><small>Em acompanhamento</small><strong>'+intents.filter(x=>x.status==='contacted').length+'</strong></div>'+
    '<div><small>Concluídas manualmente</small><strong>'+intents.filter(x=>x.status==='completed').length+'</strong></div></div>'+
   kanban+
   '<section class="commerce-section"><div class="commerce-section-heading"><h2>Oportunidades identificadas</h2><span>'+intents.length+' registros</span></div>'+
   (intents.length?'<div class="commerce-lead-list">'+intents.map(card).join('')+'</div>':
    '<div class="card card-pad commerce-empty"><h3>As oportunidades aparecerão aqui</h3><p>Quando um cliente demonstrar intenção clara de comprar, o Sócio registra o pedido para a equipe conferir e assumir a conversa.</p></div>')+'</section>'+
   '<section class="card card-pad"><h2>Pedidos aprovados</h2><p class="form-note">Um pedido aprovado pelo cliente não significa pagamento ou entrega concluídos.</p>'+
   (sales.orders.length?'<div class="sale-records">'+sales.orders.map(o=>
    '<div class="sale-record"><div><strong>'+e(o.customer_name||'Cliente')+'</strong><small>'+money(o.amount_cents)+'</small></div>'+
    '<span class="sale-state">'+e(orderStatus[o.status]||o.status)+'</span>'+
    '<button type="button" class="btn soft" data-lead-chat="'+e(o.conversation_id)+'">Conversar</button></div>').join('')+'</div>':
    '<p class="form-note">Nenhum pedido aprovado ainda.</p>')+'</section></div>';
  const row=(selected={})=>{
   const p=products.find(p=>p.id===selected.productId);
   const variants=(p?.variants||[]).filter(v=>v.active);
   return '<div class="commerce-item-row" data-purchase-row><select data-item-product aria-label="Produto" required>'+
    '<option value="">Selecione o produto</option>'+products.map(p=>
    '<option value="'+e(p.id)+'"'+(p.id===selected.productId?' selected':'')+'>'+e(p.name)+'</option>').join('')+'</select>'+
    '<select data-item-variant aria-label="Variação" '+(!variants.length?'disabled':'')+'>'+
    (variants.length?'<option value="">Selecione a variação</option>'+variants.map(v=>
     '<option value="'+e(v.id)+'"'+(v.id===selected.variantId?' selected':'')+'>'+e(v.name)+'</option>').join(''):
     '<option value="">Padrão</option>')+'</select>'+
    '<input data-item-qty type="number" min="1" max="100" step="1" aria-label="Quantidade" value="'+e(selected.quantity||1)+'" required>'+
    '<button class="btn ghost" type="button" data-item-remove aria-label="Remover produto">×</button></div>';
  };
  const updateVariants=group=>{
   const p=products.find(p=>p.id===group.querySelector('[data-item-product]').value);
   const select=group.querySelector('[data-item-variant]');
   const variants=(p?.variants||[]).filter(v=>v.active);
   select.disabled=!variants.length;
   select.innerHTML=variants.length?'<option value="">Selecione a variação</option>'+
    variants.map(v=>'<option value="'+e(v.id)+'">'+e(v.name)+'</option>').join(''):'<option value="">Padrão</option>';
  };
  view.querySelectorAll('[data-focus-intent]').forEach(button=>button.addEventListener('click',()=>{
   const target=[...view.querySelectorAll('[data-intent]')].find(article=>article.dataset.intent===button.dataset.focusIntent);
   if(!target)return;
   target.scrollIntoView({behavior:'auto',block:'center'});
   target.focus({preventScroll:true});
   const details=target.querySelector('[data-lead-detail]');
   if(details?.classList.contains('hidden'))target.querySelector('[data-lead-expand]')?.click();
  }));
  view.querySelectorAll('[data-intent]').forEach(article=>{
   const item=intents.find(x=>x.id===article.dataset.intent);
   article.addEventListener('click',event=>{
    if(event.target.closest('button,input,select,textarea,form,[data-lead-detail]'))return;
    article.querySelector('[data-lead-expand]')?.click();
   });
   article.addEventListener('keydown',event=>{
    if(event.target===article&&(event.key==='Enter'||event.key===' ')){
     event.preventDefault();article.querySelector('[data-lead-expand]')?.click();
    }
   });
   const form=article.querySelector('[data-lead-edit]');
   const container=form.querySelector('.commerce-lead-items');
   container.innerHTML=(item.items?.length?item.items:[{}]).map(row).join('');
   form.addEventListener('change',event=>{
    if(event.target.matches('[data-item-product]'))updateVariants(event.target.closest('[data-purchase-row]'));
   });
   form.querySelector('[data-lead-add]').addEventListener('click',()=>{
    if(container.querySelectorAll('[data-purchase-row]').length>=15)return toast('Limite de 15 itens.',true);
    container.insertAdjacentHTML('beforeend',row());
   });
   container.addEventListener('click',event=>{
    if(!event.target.closest('[data-item-remove]'))return;
    if(container.querySelectorAll('[data-purchase-row]').length<=1)return toast('Mantenha ao menos um produto.',true);
    event.target.closest('[data-purchase-row]').remove();
   });
   form.addEventListener('submit',async event=>{
    event.preventDefault();
    const items=[...container.querySelectorAll('[data-purchase-row]')].map(node=>({
     productId:node.querySelector('[data-item-product]').value,
     variantId:node.querySelector('[data-item-variant]').value||null,
     quantity:Number(node.querySelector('[data-item-qty]').value)
    }));
    try{
     await api('/api/sales/intents/'+item.id,'PATCH',{items});
     toast('Valores recalculados a partir do catálogo.');
     await renderPurchaseQueue({api,e,toast,view,navigate});
    }catch(err){toast(err.message,true);}
   });
  });
  view.querySelectorAll('[data-lead-expand]').forEach(btn=>btn.addEventListener('click',()=>{
   const section=view.querySelector('[data-lead-detail="'+btn.dataset.leadExpand+'"]');
   const closed=section.classList.toggle('hidden');
   btn.textContent=closed?'Ver detalhes':'Ocultar detalhes';
  }));
  view.querySelectorAll('[data-lead-chat]').forEach(btn=>btn.addEventListener('click',()=>navigate?.('inbox',btn.dataset.leadChat)));
  view.querySelectorAll('[data-lead-status]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(btn.dataset.status==='completed'&&!confirm('Marcar como concluída manualmente? Isso não confirma pagamento.'))return;
   try{
    await api('/api/sales/intents/'+btn.dataset.leadStatus,'PATCH',{status:btn.dataset.status});
    toast('Status atualizado.');
    await renderPurchaseQueue({api,e,toast,view,navigate});
   }catch(error){toast(error.message,true);}
  }));
 }

 window.SocioSales={render};
})();