(()=>{
 let dispose=()=>{};
 async function render({root,api}){
  dispose();let stopped=false,streaming=false,timer,imageUrl,queue=Promise.resolve();
  dispose=()=>{stopped=true;streaming=false;clearTimeout(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);};
  const status=await api('/api/flow/browser/status');if(stopped)return;
  root.innerHTML='<section class="card card-pad flow-image-card"><h2>Conta Google compartilhada</h2>'+
   '<p>Esta conexão é exclusiva do administrador master. Entre na página real do Google abaixo. O navegador roda no servidor do Sócio; o que você digitar é transmitido a ele para preencher o Google, sem ser registrado nos logs. A sessão fica salva de forma criptografada.</p>'+
   '<div class="flow-image-actions"><button type="button" class="btn primary" id="flowOwnerOpen">Conectar minha conta Google</button>'+
   '<button type="button" class="btn soft" id="flowOwnerSave" hidden>Concluí o login: salvar conexão</button>'+
   '<button type="button" class="btn soft" id="flowOwnerClose" hidden>Fechar conexão</button></div>'+
   '<p id="flowOwnerMessage" role="status" aria-live="polite"></p>'+
   '<img id="flowOwnerScreen" class="meta-browser-screen" hidden tabindex="0" draggable="false" alt="Página real do Google na conexão exclusiva do administrador" width="1280" height="800">'+
   '<form id="flowOwnerTextForm" hidden><label for="flowOwnerText">Digitar no campo selecionado do Google</label>'+
   '<input id="flowOwnerText" type="password" autocomplete="off" spellcheck="false" maxlength="4096" placeholder="Digite aqui para enviar ao Google">'+
   '<div class="flow-image-actions"><button type="submit" class="btn soft">Enviar texto ao campo</button><button type="button" class="btn soft" id="flowOwnerTab">Próximo campo (Tab)</button><button type="button" class="btn soft" id="flowOwnerEnter">Confirmar no Google (Enter)</button></div>'+
   '<p class="form-note">No celular: toque no campo desejado na imagem, digite aqui e envie. O texto fica oculto e é apagado deste campo após o envio.</p></form></section>';
  const $=id=>root.querySelector('#'+id),message=t=>{if(!stopped)$('flowOwnerMessage').textContent=t;};
  function visible(v){streaming=v;for(const id of ['flowOwnerScreen','flowOwnerTextForm','flowOwnerSave','flowOwnerClose'])$(id).hidden=!v;}
  function present(s){$('flowOwnerOpen').disabled=!s.configured;message(!s.configured?'Navegador indisponível no servidor.':s.session_present?'Sessão Google salva. A geração por API ainda precisa ser validada.':'Conecte sua conta para continuar.');}
  const input=d=>{queue=queue.then(()=>{if(!stopped&&streaming)return api('/api/flow/browser/input','POST',d);}).catch(e=>message(e.message));return queue;};
  async function screen(){
   if(stopped||!streaming)return;
   try{const r=await fetch('/api/flow/browser/screen',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Não foi possível atualizar a página Google. Abra a conexão novamente.');
    const url=URL.createObjectURL(await r.blob());if(stopped||!streaming){URL.revokeObjectURL(url);return;}
    $('flowOwnerScreen').src=url;if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=url;
   }catch(e){message(e.message);visible(false);}
   if(!stopped&&streaming)timer=setTimeout(screen,1200);
  }
  const image=$('flowOwnerScreen');
  image.addEventListener('click',event=>{const r=image.getBoundingClientRect();input({kind:'click',x:Math.max(0,Math.min(1279,(event.clientX-r.left)*1280/r.width)),y:Math.max(0,Math.min(799,(event.clientY-r.top)*800/r.height))});});
  image.addEventListener('keydown',event=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v')return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();void input({kind:'key',key:'Control+a'});return;}
   if(['Enter','Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(event.key)){event.preventDefault();void input({kind:'key',key:event.shiftKey&&event.key==='Tab'?'Shift+Tab':event.key});}
   else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();void input({kind:'text',text:event.key});}
  });
  image.addEventListener('paste',event=>{event.preventDefault();void input({kind:'text',text:event.clipboardData.getData('text').slice(0,4096)});});
  image.addEventListener('wheel',event=>{event.preventDefault();void input({kind:'scroll',delta:Math.max(-2000,Math.min(2000,event.deltaY))});},{passive:false});
  $('flowOwnerTextForm').addEventListener('submit',async event=>{event.preventDefault();const text=$('flowOwnerText').value;$('flowOwnerText').value='';await input({kind:'text',text});});
  $('flowOwnerTab').addEventListener('click',()=>void input({kind:'key',key:'Tab'}));
  $('flowOwnerEnter').addEventListener('click',()=>void input({kind:'key',key:'Enter'}));
  const action=(id,fn)=>$(id).addEventListener('click',async()=>{const b=$(id);b.disabled=true;try{await fn();}catch(e){message(e.message);}finally{if(!stopped)b.disabled=false;}});
  action('flowOwnerOpen',async()=>{message('Abrindo a página Google no servidor…');await api('/api/flow/browser/open','POST',{});if(stopped)return;visible(true);void screen();message('Faça login no Google abaixo e depois salve a conexão. Se o Google rejeitar o navegador, não repita tentativas.');});
  action('flowOwnerSave',async()=>{await queue;await api('/api/flow/browser/finish','POST',{});visible(false);message('Sessão Google salva. A geração por API ainda precisa ser capturada e validada.');});
  action('flowOwnerClose',async()=>{visible(false);await api('/api/flow/browser/close','POST',{});});
  present(status);if(status.remote_browser_open){visible(true);void screen();}
 }
 globalThis.SocioFlowOwner={render,dispose:()=>dispose()};
})();
