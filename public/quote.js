(function(){
'use strict';
const by=id=>document.getElementById(id);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(x||0)/100);
const token=location.hash.slice(1);
const status=(text,kind='')=>{by('quoteStatus').className=kind;by('quoteStatus').textContent=text};
const api=async(path,method='GET',body)=>{
 const response=await fetch('/api/public/quotes/'+token+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível realizar a operação.');
 return result;
};
async function render(){
 if(!/^[a-f0-9]{64}$/.test(token)){status('O link não é válido. Solicite outro orçamento à empresa.','error');return;}
 try{
  const q=await api('');
  const available=q.status==='issued';
  const approved=q.status==='accepted';
  const labels={draft:'Em preparação',issued:'Aguardando sua aprovação',accepted:'Aprovado pelo cliente',expired:'Expirado',declined:'Recusado',superseded:'Substituído',cancelled:'Cancelado'};
  const lines=(q.items||[]).map(item=>'<div class="item"><div><strong>'+escape(item.name)+'</strong>'+
   (item.variantName?'<small>'+escape(item.variantName)+'</small>':'')+
   '<small>'+escape(item.quantity)+' × '+brl(item.unitPriceCents)+'</small></div><strong>'+brl(item.totalCents)+'</strong></div>').join('');
  by('quoteContent').innerHTML='<h1>'+escape(q.business_name)+'</h1><p>Proposta comercial · Versão '+escape(q.version)+'</p>'+
   '<div class="status">'+escape(labels[q.status]||'Indisponível')+'</div><h2>Produtos e serviços</h2>'+lines+
   '<div class="total"><span>Total</span><span>'+brl(q.amount_cents)+'</span></div>'+
   '<p>Validade: '+(q.expires_at?escape(new Date(q.expires_at).toLocaleDateString('pt-BR')):'não publicado')+
   '. O estoque e as condições poderão ser conferidos novamente na confirmação.</p>'+
   (available?'<form class="panel" id="buyerForm"><h2>Confirme sua aprovação</h2>'+
    '<label>Seu nome<input type="text" name="buyerName" minlength="2" maxlength="100" required autocomplete="name"></label>'+
    '<label><input type="checkbox" name="agree" required> Conferi os itens, quantidades e o valor e desejo aprovar o orçamento.</label>'+
    '<div class="buttons"><button class="primary" type="submit">Aprovar orçamento</button>'+
    '<button type="button" id="decline">Recusar</button></div></form>':'')+
   (approved?'<div class="panel"><strong>Pedido registrado</strong><p>O orçamento foi aprovado. Esta confirmação não significa pagamento ou entrega. A empresa deverá confirmar os próximos passos.</p>'+
    (q.paymentTestAvailable&&q.order_status==='pending_payment'?
    '<button id="checkout" type="button">Abrir checkout de TESTE (sem cobrança real)</button>':'')+
    (q.order_status==='paid_test'?'<p class="success">Pagamento concluído em ambiente de teste. Não é um pagamento real.</p>':'')+'</div>':'');
  status('');
  by('buyerForm')?.addEventListener('submit',async ev=>{
   ev.preventDefault();const data=new FormData(ev.currentTarget);
   try{await api('/accept','POST',{buyerName:data.get('buyerName'),agree:data.get('agree')==='on'});status('Orçamento aprovado.','success');await render();}
   catch(err){status(err.message,'error')}
  });
  by('decline')?.addEventListener('click',async()=>{
   if(!confirm('Deseja recusar este orçamento?'))return;
   try{await api('/decline','POST',{});await render()}catch(err){status(err.message,'error')}
  });
  by('checkout')?.addEventListener('click',async()=>{
   try{
    const result=await api('/checkout','POST',{});
    if(result.testMode===true)location.assign(result.url);
   }catch(err){status(err.message,'error')}
  });
 }catch(err){status(err.message,'error');by('quoteContent').innerHTML='';}
}
render();
})();