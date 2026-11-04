/* Sócio Phase 3: supervised quote and sales management; never auto sends. */
(function(){
 'use strict';
 let revision=null,linkToShare='',requestedConversationId=null,activeRequestId=null;
 async function render({api,e,toast,view,me,navigate}){
  const [sales,products,contacts,leads]=await Promise.all([
   api('/api/sales'),api('/api/products'),api('/api/inbox'),api('/api/sales/quote-requests')
  ]);
  const requests=leads.requests||[];
  const canConfigureAlerts=me?.user?.role==='owner'||me?.user?.platformOwner===true;
  const allowed=products.filter(p=>p.active);
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
   '<div class="view-heading"><div><span class="eyebrow">VENDAS SUPERVISIONADAS</span><h1>Orçamentos e pedidos</h1>'+
   '<p>Escolha produtos reais, compartilhe o link de aprovação e acompanhe seus pedidos. Nenhum envio ou cobrança é automático.</p></div></div>'+
   '<section class="card card-pad quote-request-panel"><div class="quote-request-header"><div><h2>Pedidos de orçamento recebidos</h2>'+
   '<p class="form-note">Pedidos identificados nas mensagens do WhatsApp. A IA não cria preços nem envia orçamentos sem sua revisão.</p></div>'+
   (canConfigureAlerts?'<label class="quote-alert-toggle"><input type="checkbox" id="quoteOwnerAlerts" '+
    (leads.alertWhatsAppEnabled?'checked':'')+'> Avisar o proprietário pelo WhatsApp</label>':'')+
   '</div>'+
   (requests.length?'<div class="quote-request-list">'+requests.map(q=>
    '<article class="quote-request-item"><div><strong>'+e(q.customer_name||q.customer_phone||'Cliente')+'</strong>'+
    '<p>'+e(q.summary||'Solicitação de orçamento').slice(0,500)+'</p>'+
    '<small>'+e(q.status==='pending'?'Aguardando orçamento':q.status==='preparing'?'Em preparação':'Resolvido')+
     ' · '+e(new Date(q.created_at).toLocaleDateString('pt-BR'))+
     (q.alert_status==='sent'?' · Aviso enviado ao dono':q.alert_status==='unconfirmed'?' · Verifique aviso no WhatsApp':'')+'</small></div>'+
    '<div class="quote-request-actions">'+
    (q.status!=='resolved'?'<button type="button" class="btn sm primary" data-quote-prepare="'+e(q.id)+
      '">Preparar orçamento</button><button type="button" class="btn sm soft" data-quote-resolve="'+e(q.id)+'">Marcar resolvido</button>':'')+
    '</div></article>').join('')+'</div>':
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
   '<section class="card card-pad"><h2>Pedidos</h2><p class="form-note">Pedido aprovado não significa pagamento confirmado ou mercadoria reservada.</p>'+
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
 window.SocioSales={render};
})();