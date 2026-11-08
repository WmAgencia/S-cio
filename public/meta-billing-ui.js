(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let active=null;
 function open({api,onUpdated,mode='pix'}){
  active?.();
  const dialog=document.createElement('dialog');dialog.className='socio-billing-dialog';
  dialog.innerHTML='<div class="socio-billing-head"><div><h2>Saldo e recarga Pix</h2><p>Conta de anúncios selecionada no Sócio</p></div><button type="button" data-close aria-label="Fechar faturamento">×</button></div>'+
   '<p class="form-note">A recarga usa a página oficial da Meta. A sessão de faturamento é separada do OAuth. Se precisar entrar, os comandos serão enviados ao navegador isolado desta empresa no servidor do Sócio. Confira impostos e total na Meta. Nenhum pagamento é feito automaticamente.</p>'+
   '<form data-topup><label>Valor da recarga (R$)<input name="amount" type="text" inputmode="decimal" placeholder="100,00" maxlength="12" autocomplete="off"></label>'+
   '<div class="socio-billing-actions"><button class="btn primary" type="submit">Preparar Pix na Meta</button><button class="btn soft" type="button" data-refresh>Atualizar saldo</button></div></form>'+
   '<p class="form-note">Após a primeira leitura válida, o saldo será verificado a cada 5 minutos enquanto a sessão permitir. O aviso inicial é saldo até R$ 30 ou previsão de até 3 dias. Leituras com mais de 15 minutos não são consideradas atuais.</p>'+
   '<p data-status role="status" aria-live="polite"></p>'+
   '<section data-viewer hidden><p class="form-note">Página oficial da Meta. Clique na imagem para interagir; Tab muda de campo. Você revisa e avança na própria Meta.</p>'+
    '<img data-screen width="1280" height="800" tabindex="0" alt="Navegador isolado com o faturamento oficial da Meta">'+
    '<div class="socio-billing-actions"><button type="button" class="btn soft" data-finish>Salvar sessão de faturamento</button><button type="button" class="btn soft" data-pix>Ler Pix exibido</button></div></section>'+
   '<section data-result hidden><label>Pix copia e cola<textarea data-pix-code readonly rows="4"></textarea></label><button type="button" class="btn primary" data-copy>Copiar Pix</button><p class="form-note">Código lido da Meta e conferido com o valor solicitado. Pague apenas após conferir o beneficiário no seu banco. O Sócio só confirma recarga quando observar atualização na plataforma.</p></section>';
  document.body.append(dialog);
  const $=q=>dialog.querySelector(q);
  let stopped=false,streaming=false,timer=null,blob=null,busy=false,queue=Promise.resolve();
  const status=text=>{if(!stopped)$('[data-status]').textContent=text;};
  const amount=()=>{
   const text=$('[name="amount"]').value.trim();
   if(!/^(?:[0-9]{1,6})(?:[,.][0-9]{1,2})?$/.test(text))throw Error('Digite um valor válido, por exemplo 100,00.');
   const n=Math.round(Number(text.replace(',','.'))*100);
   if(!Number.isSafeInteger(n)||n<100||n>10000000)throw Error('Informe entre R$ 1,00 e R$ 100.000,00; a Meta valida os limites finais.');
   return n;
  };
  const stopScreen=()=>{streaming=false;clearTimeout(timer);if(blob){URL.revokeObjectURL(blob);blob=null;}};
  const dispose=()=>{
   if(stopped)return;stopped=true;stopScreen();
   dialog.remove();if(active===dispose)active=null;
   void api('/api/marketing/browser/close','POST',{}).catch(()=>{});
  };
  active=dispose;
  async function screen(){
   if(stopped||!streaming)return;
   try{
    const response=await fetch('/api/marketing/browser/screen',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('O navegador não está disponível. Tente Atualizar saldo.');
    const next=URL.createObjectURL(await response.blob());
    if(stopped||!streaming){URL.revokeObjectURL(next);return;}
    $('[data-screen]').src=next;if(blob)URL.revokeObjectURL(blob);blob=next;
   }catch(error){status(error.message);stopScreen();}
   if(!stopped&&streaming)timer=setTimeout(screen,1300);
  }
  async function run(kind){
   if(busy||stopped)return;busy=true;
   dialog.querySelectorAll('button:not([data-close])').forEach(b=>b.disabled=true);
   try{
    const payload=kind==='prepare'?{amountMinor:amount(),confirmed:true}:{};
    if(kind==='prepare'){$('[data-result]').hidden=true;$('[data-pix-code]').value='';}
    status(kind==='refresh'?'Consultando saldo na página oficial…':'Abrindo a recarga na Meta…');
    const result=await api('/api/marketing/billing/'+kind,'POST',payload);
    if(stopped)return;
    if(result.state==='pix_available'){
     $('[data-pix-code]').value=result.pixCode;$('[data-result]').hidden=false;
     status('Pix capturado da Meta; o pagamento ainda não foi realizado.');
    }else{
     status(result.alert?.reason||result.message||(result.observation?'Saldo observado e atualizado.':'Confira a página oficial.'));
     if(result.observation)onUpdated?.();
     if(result.state==='observed'){stopScreen();$('[data-viewer]').hidden=true;}
     else if(result.state!=='busy'){$('[data-viewer]').hidden=false;if(!streaming){streaming=true;void screen();}}
    }
   }catch(error){status(error.message||'Não foi possível concluir.');}
   finally{busy=false;if(!stopped)dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  const input=data=>{
   queue=queue.then(()=>!stopped&&streaming?api('/api/marketing/browser/input','POST',data):undefined).catch(e=>status(e.message));
  };
  const image=$('[data-screen]');
  image.addEventListener('click',event=>{
   const rect=image.getBoundingClientRect();if(!rect.width||!rect.height)return;
   image.focus();
   input({kind:'click',x:Math.max(0,Math.min(1279,(event.clientX-rect.left)*1280/rect.width)),y:Math.max(0,Math.min(799,(event.clientY-rect.top)*800/rect.height))});
  });
  image.addEventListener('keydown',event=>{
   const keys=['Enter','Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'];
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v')return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();input({kind:'key',key:'Control+a'});return;}
   if(keys.includes(event.key)){event.preventDefault();input({kind:'key',key:event.shiftKey&&event.key==='Tab'?'Shift+Tab':event.key});}
   else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();input({kind:'text',text:event.key});}
  });
  image.addEventListener('paste',event=>{event.preventDefault();input({kind:'text',text:event.clipboardData.getData('text').slice(0,4096)});});
  image.addEventListener('wheel',event=>{event.preventDefault();input({kind:'scroll',delta:Math.max(-2000,Math.min(2000,event.deltaY))});},{passive:false});
  $('[data-topup]').addEventListener('submit',e=>{e.preventDefault();void run('prepare');});
  $('[data-refresh]').addEventListener('click',()=>void run('refresh'));
  $('[data-pix]').addEventListener('click',()=>void run('pix'));
  $('[data-finish]').addEventListener('click',async()=>{
   try{await queue;await api('/api/marketing/browser/finish','POST',{});stopScreen();$('[data-viewer]').hidden=true;status('Sessão salva. Consultando fundos disponíveis na Meta…');void run('refresh');}catch(e){status(e.message);}
  });
  $('[data-copy]').addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText($('[data-pix-code]').value);status('Pix copiado.');}catch{status('Selecione o código exibido para copiar manualmente.');}
  });
  $('[data-close]').addEventListener('click',dispose);
  dialog.addEventListener('cancel',e=>{e.preventDefault();dispose();});
  dialog.showModal();
  if(mode==='balance')void run('refresh');else $('[name="amount"]').focus();
 }
 window.SocioMetaBilling={open,dispose:()=>active?.()};
})();
