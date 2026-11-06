(()=>{
 let cleanup=()=>{};
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function render({root,api,canManage}){
  cleanup();let stopped=false,timer,polling=false,plan,executionKey;
  cleanup=()=>{stopped=true;clearTimeout(timer);};
  const initial=await api('/api/marketing/local/status');if(stopped)return;
  root.innerHTML='<div class="view-heading"><div><span class="eyebrow">META ADS</span><h1>Conecte pelo seu navegador.</h1><p>O login acontece em uma janela separada no seu computador.</p></div></div>'+
   '<section class="card meta-browser-card"><h2>Conector do computador</h2><p class="meta-browser-help">Instale o conector uma vez. Depois, o Sócio abre a página real da Meta no Chrome ou Edge deste computador. Sua senha, teclas e cookies da Meta ficam fora do servidor do Sócio.</p>'+
   '<p id="metaLocalStatus" class="meta-browser-message" role="status" aria-live="polite"></p>'+
   (canManage?'<div class="meta-browser-actions"><a class="btn soft" id="metaLocalDownload" href="/downloads/socio-meta-connector.zip" download>Baixar conector Windows</a><button class="btn primary" id="metaLocalConnect" type="button">Conectar no meu navegador</button><button class="btn soft" id="metaLocalLogin" type="button" hidden>Abrir login da Meta</button><button class="btn soft" id="metaLocalRefresh" type="button">Verificar conexão</button><button class="btn soft" id="metaLocalDisconnect" type="button" hidden>Desconectar computador</button></div>':'<p>Solicite ao responsável da empresa acesso à gestão de Meta Ads.</p>')+
   '<p class="form-note">Windows 64 bits: extraia o ZIP, execute instalar.cmd e confirme a instalação. Depois clique em Conectar no meu navegador. Ao concluir o login, feche a janela da Meta aberta pelo conector e mantenha o conector ativo.</p>'+
   '<div id="metaLocalPairing" hidden><a id="metaLocalLink" class="btn primary" rel="noreferrer">Abrir conector instalado</a><p class="form-note">Se a abertura não acontecer, use este código no conector. Ele expira em dez minutos e só pode ser usado uma vez.</p><code id="metaLocalCode"></code></div>'+
   '<p class="form-note">A Meta ainda pode pedir CAPTCHA ou verificação em duas etapas. Conclua pessoalmente na janela dela. Não há garantia de eliminar essas verificações.</p></section>'+
   '<section class="card meta-browser-card"><h2>Operações disponíveis</h2><p class="form-note">A conexão não libera automaticamente campanhas, uploads, pixels ou pagamentos. Cada operação precisa ser aprendida e validada com sua conta.</p><pre id="metaLocalOperations" class="meta-browser-operations">Aguardando o conector.</pre>'+
   (canManage?'<form id="metaLocalForm" class="meta-browser-form" hidden><label>Operação<select id="metaLocalOperation"></select></label><label>Parâmetros JSON<textarea id="metaLocalArgs" spellcheck="false">{}</textarea></label><button class="btn soft" type="submit">Preparar operação</button></form><pre id="metaLocalResult" class="meta-browser-operations" hidden></pre><button id="metaLocalExecute" type="button" class="btn primary" hidden>Executar operação revisada</button>':'')+'</section>';
  const $=id=>root.querySelector('#'+id),message=text=>{if(!stopped)$('metaLocalStatus').textContent=text;};
  function present(state){
   if(stopped)return;
   message(!state.paired?'Instale o conector e conecte este computador.':!state.online?'Computador vinculado, mas o conector está offline. Abra Iniciar Conector Socio no seu computador.':state.browserOpen?'A página da Meta está aberta no seu computador. Termine o login e feche essa janela.':state.sessionPresent?'Sessão presente no computador. As operações disponíveis podem ser verificadas abaixo.':'Computador conectado. Abra o login da Meta para entrar na sua conta.');
   if($('metaLocalLogin'))$('metaLocalLogin').hidden=!state.online;
   if($('metaLocalDisconnect'))$('metaLocalDisconnect').hidden=!state.paired;
   if(state.paired)$('metaLocalPairing').hidden=true;
  }
  async function refresh(){const state=await api('/api/marketing/local/status');present(state);return state;}
  async function monitor(){
   if(stopped||polling)return;polling=true;
   try{await refresh();}catch(error){message(error.message);}finally{polling=false;if(!stopped)timer=setTimeout(monitor,5000);}
  }
  async function command(kind,input={}){
   const created=await api('/api/marketing/local/jobs','POST',{kind,input},{'Idempotency-Key':kind==='execute'?executionKey:crypto.randomUUID()});
   for(let attempt=0;attempt<180&&!stopped;attempt++){
    const job=await api('/api/marketing/local/jobs/'+created.jobId);
    if(stopped)return null;
    if(job.status==='done')return job.result;
    if(job.uncertain)throw Error('Resultado incerto. Confira a Meta antes de repetir.');
    await new Promise(done=>setTimeout(done,3000));
   }
   if(!stopped)throw Error('A operação continua pendente no conector. Não repita uma alteração antes de conferir seu resultado.');
   return null;
  }
  function action(id,fn){if(!$(id))return;$(id).addEventListener('click',async()=>{const button=$(id);button.disabled=true;try{await fn();}catch(error){message(error.message);}finally{button.disabled=false;}});}
  action('metaLocalConnect',async()=>{
   const paired=await api('/api/marketing/local/pairing','POST',{});if(stopped)return;
   const target=new URL(paired.connectUrl);if(target.protocol!=='socio-meta:'||target.hostname!=='connect')throw Error('Link de conexão inválido.');
   $('metaLocalLink').href=target.href;$('metaLocalCode').textContent=paired.pairCode;$('metaLocalPairing').hidden=false;
   message('Clique em Abrir conector instalado e confirme no navegador. Se ainda não instalou, baixe o ZIP primeiro.');
  });
  action('metaLocalRefresh',async()=>{
   const state=await refresh();if(!state.online)return;message('Consultando operações no seu computador…');
   const result=await command('status');if(!result||stopped)return;
   $('metaLocalOperations').textContent=result.operations?.length?JSON.stringify(result.operations,null,2):'Nenhuma operação aprendida nesta conexão.';
   if($('metaLocalForm')){
    $('metaLocalForm').hidden=!result.operations?.length;
    $('metaLocalOperation').innerHTML=(result.operations||[]).map(op=>'<option value="'+escape(op.name)+'">'+escape(op.name)+'</option>').join('');
   }
   await refresh();
  });
  action('metaLocalLogin',async()=>{message('Abrindo a Meta no seu computador…');const result=await command('login');if(result&&!stopped){message(result.message||'Confira a janela no computador.');await refresh();}});
  action('metaLocalDisconnect',async()=>{if(!confirm('Revogar o acesso deste computador ao Sócio?'))return;await api('/api/marketing/local/disconnect','POST',{});await refresh();});
  if($('metaLocalForm'))$('metaLocalForm').addEventListener('submit',async event=>{
   event.preventDefault();try{const args=JSON.parse($('metaLocalArgs').value);message('Preparando no conector…');plan=await command('plan',{operation:$('metaLocalOperation').value,args});if(!plan||stopped)return;
    $('metaLocalResult').hidden=false;$('metaLocalResult').textContent=JSON.stringify(plan,null,2);$('metaLocalExecute').hidden=!plan.ok;executionKey=crypto.randomUUID();
   }catch(error){message(error.message);}
  });
  action('metaLocalExecute',async()=>{
   if(!plan?.ok)return;if(!plan.read_only&&!confirm('Executar a alteração exibida na prévia na sua conta de anúncios?'))return;
   const result=await command('execute',{plan_id:plan.plan_id,allow_writes:!plan.read_only});if(!result||stopped)return;
   $('metaLocalResult').textContent=JSON.stringify(result,null,2);$('metaLocalExecute').hidden=true;plan=null;
  });
  present(initial);timer=setTimeout(monitor,5000);
 }
 globalThis.SocioMetaLocal={render,dispose:()=>cleanup()};
})();
