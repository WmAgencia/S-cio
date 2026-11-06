// Read-only Sócio panel companion, tenant-bound through the authenticated API.
(function(){
 let root=null,activeApi=null;
 const e=v=>String(v||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 function mount({api,enabled=false}={}){
  activeApi=api;
  if(root&&!root.isConnected)root=null;
  if(!enabled){root?.remove();root=null;return;}
  if(root)return;
  root=document.createElement('div');root.className='socio-owner-companion';
  root.innerHTML='<button type="button" class="socio-owner-launch" id="socioOwnerLaunch" aria-expanded="false" aria-controls="socioOwnerPanel" title="Consultar meu Sócio">✳ <span>Perguntar ao Sócio</span></button>'+
   '<section class="socio-owner-panel hidden" id="socioOwnerPanel" role="dialog" aria-label="Consultas ao Sócio">'+
   '<header><div><strong>Seu Sócio</strong><small>Consultas à sua empresa · somente leitura</small></div><button type="button" id="socioOwnerClose" aria-label="Fechar assistente">×</button></header>'+
   '<div class="socio-owner-messages" id="socioOwnerMessages" aria-live="polite"><div class="socio-owner-bubble">Pergunte sobre atendimentos, orçamentos, oportunidades, estoque, WhatsApps ou treinamento.</div></div>'+
   '<form id="socioOwnerAsk"><label for="socioOwnerQuestion">Sua pergunta</label><div><input id="socioOwnerQuestion" name="question" maxlength="500" required autocomplete="off" placeholder="Ex.: Quantos orçamentos tivemos?"><button type="submit">Enviar</button></div></form>'+
   '</section>';
  document.body.appendChild(root);
  const launch=root.querySelector('#socioOwnerLaunch'),panel=root.querySelector('#socioOwnerPanel'),close=root.querySelector('#socioOwnerClose');
  const toggle=open=>{panel.classList.toggle('hidden',!open);launch.setAttribute('aria-expanded',String(open));
   if(open)root.querySelector('#socioOwnerQuestion').focus();else launch.focus();};
  launch.addEventListener('click',()=>toggle(panel.classList.contains('hidden')));
  close.addEventListener('click',()=>toggle(false));
  root.addEventListener('keydown',evt=>{if(evt.key==='Escape'&&!panel.classList.contains('hidden'))toggle(false);});
  root.querySelector('#socioOwnerAsk').addEventListener('submit',async event=>{
   event.preventDefault();const form=event.currentTarget,question=String(new FormData(form).get('question')||'').trim();
   if(!question)return;
   const host=root.querySelector('#socioOwnerMessages'),button=form.querySelector('button[type=submit]');
   host.insertAdjacentHTML('beforeend','<div class="socio-owner-bubble mine">'+e(question)+'</div>');
   form.reset();button.disabled=true;button.textContent='Consultando...';
   try{
    const answer=await activeApi('/api/assistant/query','POST',{question});
    host.insertAdjacentHTML('beforeend','<div class="socio-owner-bubble">'+e(answer.reply||'Nenhum dado disponível.')+'</div>');
   }catch(error){
    host.insertAdjacentHTML('beforeend','<div class="socio-owner-bubble error">'+e(error.message||'Falha na consulta.')+'</div>');
   }finally{
    button.disabled=false;button.textContent='Enviar';host.scrollTop=host.scrollHeight;
    while(host.children.length>17)host.removeChild(host.firstElementChild);
   }
  });
 }
 window.SocioOwner={mount};
})();
