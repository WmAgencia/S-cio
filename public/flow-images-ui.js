(()=>{
 let dispose=()=>{};
 async function render({root,api,me}){
  dispose();let stopped=false,timer,busy=false;
  dispose=()=>{stopped=true;clearTimeout(timer);};
  const status=await api('/api/flow/status');if(stopped)return;
  const savedKey='socio-flow-job:'+me.tenant.id;
  root.innerHTML='<section class="card card-pad flow-image-card"><span class="eyebrow">CRIAÇÃO DE IMAGENS</span>'+
   '<h2>Descreva sua próxima imagem.</h2><p>Uma imagem por pedido, com Nano Banana 2.1.</p>'+
   '<p class="form-note" id="flowConnection" role="status"></p>'+
   '<form id="flowImageForm"><label for="flowPrompt">O que você quer criar?</label>'+
   '<textarea id="flowPrompt" name="prompt" required maxlength="8000" rows="5" placeholder="Ex.: Uma xícara de café em uma mesa de madeira, com luz natural."></textarea>'+
   '<div class="flow-image-actions"><button type="submit" class="btn primary" id="flowGenerate">Gerar imagem</button>'+
   '<button type="button" class="btn soft" id="flowRefresh">Verificar conexão</button></div></form>'+
   '<p class="form-note">Os pedidos usam a conta compartilhada do proprietário e respeitam a cota do Google.</p>'+
   '<p id="flowProgress" role="status" aria-live="polite"></p><div id="flowResult"></div></section>';
  const $=id=>root.querySelector('#'+id);
  let ready=status.ready;
  const sync=()=>{$('flowGenerate').disabled=!ready||busy;$('flowPrompt').disabled=busy;};
  const showStatus=s=>{$('flowConnection').textContent=s.message;ready=s.ready;sync();};
  showStatus(status);
  function clearSaved(){try{sessionStorage.removeItem(savedKey);}catch{}}
  async function track(id,count=0){
   if(stopped)return;
   try{
    const job=await api('/api/flow/images/'+id);if(stopped)return;
    if(job.status==='succeeded'&&job.image?.content_url){
     busy=false;sync();clearSaved();$('flowProgress').textContent='Sua imagem está pronta.';
     const image=document.createElement('img');image.src=job.image.content_url;image.alt='Imagem gerada a partir do seu prompt';image.className='flow-image-result';
     const link=document.createElement('a');link.href=job.image.content_url;link.download='imagem';link.className='btn primary';link.textContent='Baixar imagem';
     $('flowResult').replaceChildren(image,link);return;
    }
    if(['failed','unknown'].includes(job.status)){
     busy=false;sync();clearSaved();$('flowProgress').textContent=job.error?.message||'Não foi possível concluir. Confira o Flow antes de gerar novamente.';return;
    }
    $('flowProgress').textContent=job.status==='queued'?'Seu pedido está na fila.':'Gerando sua imagem…';
    if(count<180)timer=setTimeout(()=>track(id,count+1),2000);
    else{busy=false;sync();$('flowProgress').textContent='O pedido continua em processamento. Use Verificar conexão para consultar o mesmo pedido.';}
   }catch(error){if(!stopped){busy=false;sync();$('flowProgress').textContent=error.message+' O pedido foi preservado; consulte novamente antes de repetir.';}}
  }
  function resume(){let id;try{id=sessionStorage.getItem(savedKey);}catch{}if(id&&/^[a-f0-9-]{36}$/.test(id)){busy=true;sync();void track(id);}}
  $('flowRefresh').addEventListener('click',async()=>{
   try{const s=await api('/api/flow/status');if(stopped)return;showStatus(s);if(!busy)resume();}catch(error){if(!stopped)$('flowProgress').textContent=error.message;}
  });
  $('flowImageForm').addEventListener('submit',async event=>{
   event.preventDefault();if(busy||!ready)return;
   busy=true;sync();$('flowResult').replaceChildren();$('flowProgress').textContent='Enviando seu pedido…';
   const requestKey=crypto.randomUUID();
   try{
    const job=await api('/api/flow/images','POST',{prompt:$('flowPrompt').value},{'Idempotency-Key':requestKey});
    try{sessionStorage.setItem(savedKey,job.id);}catch{}
    if(!stopped)void track(job.id);
   }catch(error){if(!stopped){busy=false;sync();$('flowProgress').textContent=error.message;}}
  });
  resume();
 }
 globalThis.SocioFlowImages={render,dispose:()=>dispose()};
})();
