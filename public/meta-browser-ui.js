(()=>{
 let dispose=()=>{};
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function render({root,api,canManage}){
  dispose();
  let stopped=false,streaming=false,imageUrl,timer,queue=Promise.resolve(),plan,key;
  dispose=()=>{stopped=true;streaming=false;clearTimeout(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);};
  const status=await api('/api/marketing/browser/status');if(stopped)return;
  root.innerHTML='<div class="page-heading"><span class="eyebrow">META ADS</span><h1>Conecte seu Ads Manager.</h1><p>Entre com sua conta do Facebook, sem criar um aplicativo Meta.</p></div>'+
   '<section class="card meta-browser-card"><h2>Sua conexão nesta empresa</h2>'+
   '<p class="meta-browser-help">O Sócio abre um navegador remoto separado para sua conta. Você verá a página real da Meta e poderá informar email, senha e a verificação solicitada por ela. As teclas são transmitidas ao servidor do Sócio, que opera esse navegador.</p>'+
   '<p id="metaBrowserMessage" class="meta-browser-message" role="status" aria-live="polite"></p>'+
   (canManage?'<div class="meta-browser-actions"><button class="btn primary" id="metaBrowserOpen" type="button">Conectar Facebook</button><button class="btn soft" id="metaBrowserFinish" type="button" hidden>Concluí o login: salvar sessão</button><button class="btn soft" id="metaBrowserClose" type="button" hidden>Fechar navegador</button><button class="btn soft" id="metaBrowserRefresh" type="button">Verificar conexão</button><button class="btn soft" id="metaBrowserDisconnect" type="button">Desconectar</button></div>':'<p>Peça ao responsável da empresa para liberar seu acesso à gestão de Meta Ads.</p>')+
   '<p id="metaBrowserHint" class="form-note" hidden>Clique na imagem para digitar. Tab muda de campo; Enter confirma. Complete as verificações da Meta antes de salvar a sessão.</p>'+
   '<img id="metaBrowserScreen" class="meta-browser-screen" hidden tabindex="0" draggable="false" alt="Página real da Meta no navegador remoto da sua conexão" width="1280" height="800">'+
   '<p id="metaBrowserAddress" class="form-note meta-browser-address"></p></section>'+
   '<section class="card meta-browser-card"><h2>Operações disponíveis</h2><p id="metaBrowserOperationsHelp" class="form-note"></p><pre id="metaBrowserOperations" class="meta-browser-operations"></pre>'+
   (canManage?'<form id="metaBrowserOperationForm" class="meta-browser-form" hidden><label>Operação<select id="metaBrowserOperation"></select></label><label>Parâmetros JSON<textarea id="metaBrowserArgs" spellcheck="false">{}</textarea></label><button type="submit" class="btn soft">Preparar operação</button></form><pre id="metaBrowserPlan" class="meta-browser-operations" hidden></pre><button id="metaBrowserExecute" class="btn primary" type="button" hidden>Executar operação revisada</button>':'')+'</section>';
  const $=id=>root.querySelector('#'+id);
  const message=text=>{if(!stopped)$('metaBrowserMessage').textContent=text;};
  function visible(value){streaming=value;for(const id of ['metaBrowserScreen','metaBrowserHint','metaBrowserFinish','metaBrowserClose'])if($(id))$(id).hidden=!value;}
  function present(value){
   if(stopped)return;
   message(!value.configured?'Conexão por navegador indisponível. Contate a administração.':value.session_present?'Sessão armazenada. A leitura dos anúncios será confirmada ao executar uma operação disponível.':'Clique em Conectar Facebook para entrar na sua conta.');
   if($('metaBrowserOpen'))$('metaBrowserOpen').disabled=!value.configured;
   $('metaBrowserAddress').textContent=value.browser_page?'Página remota: '+value.browser_page:'';
   const operations=value.operations||[];
   $('metaBrowserOperationsHelp').textContent=operations.length?'Confira os parâmetros antes de executar.':'Nenhuma operação de anúncios foi validada nesta conexão. Login não confirma criação de campanhas, relatórios, upload ou recarga de saldo.';
   $('metaBrowserOperations').textContent=operations.length?JSON.stringify(operations,null,2):'Aguardando configuração e validação das operações.';
   if($('metaBrowserOperationForm')){
    $('metaBrowserOperationForm').hidden=!operations.length;
    $('metaBrowserOperation').innerHTML=operations.map(op=>'<option value="'+escape(op.name)+'">'+escape(op.name)+'</option>').join('');
   }
  }
  async function refresh(){const value=await api('/api/marketing/browser/status');present(value);return value;}
  async function screen(){
   if(stopped||!streaming)return;
   try{
    const response=await fetch('/api/marketing/browser/screen',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('Não foi possível atualizar a página remota. Abra o navegador novamente.');
    const image=URL.createObjectURL(await response.blob());if(stopped||!streaming){URL.revokeObjectURL(image);return;}
    $('metaBrowserScreen').src=image;if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=image;
   }catch(error){message(error.message);visible(false);}
   if(!stopped&&streaming)timer=setTimeout(screen,900);
  }
  const input=data=>{queue=queue.then(()=>{if(!stopped&&streaming)return api('/api/marketing/browser/input','POST',data);}).catch(error=>message(error.message));return queue;};
  const image=$('metaBrowserScreen');
  image.addEventListener('click',event=>{const rect=image.getBoundingClientRect();input({kind:'click',x:Math.min(1279,Math.max(0,(event.clientX-rect.left)*1280/rect.width)),y:Math.min(799,Math.max(0,(event.clientY-rect.top)*800/rect.height))});});
  image.addEventListener('keydown',event=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v')return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();input({kind:'key',key:'Control+a'});return;}
   if(['Enter','Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(event.key)){event.preventDefault();input({kind:'key',key:event.shiftKey&&event.key==='Tab'?'Shift+Tab':event.key});}
   else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();input({kind:'text',text:event.key});}
  });
  image.addEventListener('paste',event=>{event.preventDefault();input({kind:'text',text:event.clipboardData.getData('text').slice(0,4096)});});
  image.addEventListener('wheel',event=>{event.preventDefault();input({kind:'scroll',delta:Math.max(-2000,Math.min(2000,event.deltaY))});},{passive:false});
  function action(id,fn){if(!$(id))return;$(id).addEventListener('click',async()=>{const button=$(id);button.disabled=true;try{await fn();}catch(error){message(error.message);}finally{button.disabled=false;}});}
  action('metaBrowserOpen',async()=>{message('Abrindo a página da Meta…');await api('/api/marketing/browser/open','POST',{});if(stopped)return;visible(true);void screen();message('Faça login na página real da Meta abaixo. Depois clique em salvar sessão.');});
  action('metaBrowserFinish',async()=>{await queue;await api('/api/marketing/browser/finish','POST',{});visible(false);await refresh();});
  action('metaBrowserClose',async()=>{visible(false);await api('/api/marketing/browser/close','POST',{});await refresh();});
  action('metaBrowserRefresh',refresh);
  action('metaBrowserDisconnect',async()=>{if(!confirm('Desconectar sua sessão do Ads Manager nesta empresa?'))return;visible(false);await api('/api/marketing/browser/disconnect','POST',{});await refresh();});
  if($('metaBrowserOperationForm'))$('metaBrowserOperationForm').addEventListener('submit',async event=>{
   event.preventDefault();try{const args=JSON.parse($('metaBrowserArgs').value);plan=await api('/api/marketing/browser/plan','POST',{operation:$('metaBrowserOperation').value,args});
    if(stopped)return;$('metaBrowserPlan').hidden=false;$('metaBrowserPlan').textContent=JSON.stringify(plan,null,2);$('metaBrowserExecute').hidden=!plan.ok;key=crypto.randomUUID();
   }catch(error){message(error.message);}
  });
  action('metaBrowserExecute',async()=>{
   if(!plan?.ok)return;if(!plan.read_only&&!confirm('Executar a alteração mostrada na prévia na sua conta de anúncios?'))return;
   const result=await api('/api/marketing/browser/execute','POST',{plan_id:plan.plan_id,allow_writes:!plan.read_only},{'Idempotency-Key':key});
   if(stopped)return;$('metaBrowserPlan').textContent=JSON.stringify(result,null,2);$('metaBrowserExecute').hidden=true;plan=null;
  });
  present(status);
  if(status.remote_browser_open&&canManage){visible(true);void screen();}
 }
 globalThis.SocioMetaBrowser={render,dispose:()=>dispose()};
})();
