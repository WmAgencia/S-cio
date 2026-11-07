// Tenant integration status. Read-only checks and explicit Google OAuth actions.
// Never asks users to paste client IDs, client secrets or ad account access tokens.
(()=>{
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
 async function render({root,api}){
  const details=el('details');details.className='card card-pad';root.append(details);
  const heading=el('summary','Integrações e pendências de ativação');details.append(heading);
  const state=el('p','Consultando segurança e serviços…');state.setAttribute('role','status');details.append(state);
  const body=el('div');details.append(body);
  let report;
  try{report=await api('/api/integrations/readiness');}
  catch(e){state.textContent='Não foi possível verificar as integrações: '+e.message;return;}
  state.textContent=report.readyChecks+' de '+report.totalChecks+
   ' integrações com evidência de conexão. Configurar não é o mesmo que homologar.';
  for(const item of report.tasks){
   const block=el('section');block.className='panel';body.append(block);
   block.append(el('strong',item.name+' — '+(item.verified?'conexão verificada':item.configured?'configurada, aguardando teste':'pendente')));
   block.append(el('p',item.action));
   for(const reason of (item.blockers||[]).slice(0,5))block.append(el('p','Pendente: '+reason));
  }
  const google=report.tasks.find(x=>x.id==='google');
  if(!google?.configured)return;
  const group=el('section');group.className='panel';body.append(group);
  group.append(el('h3','Google Ads'));
  const feedback=el('p','A conta deve autorizar o acesso pelo Google. Nenhuma campanha será criada.');feedback.setAttribute('role','status');group.append(feedback);
  const action=el('button',google.connected?'Consultar contas Google Ads':'Conectar Google Ads');
  action.type='button';action.className='btn soft';group.append(action);
  const selectors=el('div');group.append(selectors);
  action.addEventListener('click',async()=>{
   action.disabled=true;feedback.textContent='Conferindo acesso oficial…';
   try{
    if(!google.connected){
     const result=await api('/api/google-ads/connect','POST',{});
     const u=new URL(result.authorizationUrl);
     if(u.origin!=='https://accounts.google.com')throw new Error('Endereço de login inesperado.');
     window.location.assign(u.toString());return;
    }
    const list=await api('/api/google-ads/accounts');
    feedback.textContent=list.accounts.length+' conta(s) com acesso direto encontradas.';
    selectors.replaceChildren();
    if(!list.accounts.length)selectors.append(el('p','Nenhuma conta retornada. Verifique sua permissão no Google Ads.'));
    else{
     const select=el('select');select.setAttribute('aria-label','Conta Google Ads');
     for(const account of list.accounts){
      const option=el('option',account.id);option.value=account.id;select.append(option);
     }
     if(list.selectedCustomerId)select.value=list.selectedCustomerId;
     selectors.append(select);
     const choose=el('button','Selecionar conta');choose.type='button';choose.className='btn soft';selectors.append(choose);
     choose.addEventListener('click',async()=>{
      choose.disabled=true;
      try{
       await api('/api/google-ads/accounts/select','POST',{accountId:select.value});
       feedback.textContent='Conta Google Ads selecionada: '+select.value+'. A execução de campanhas continua bloqueada até homologação.';
      }catch(e){feedback.textContent='Não foi possível selecionar: '+e.message;}
      finally{choose.disabled=false;}
     });
    }
   }catch(e){feedback.textContent='Não foi possível verificar: '+e.message;}
   finally{action.disabled=false;}
  });
 }
 globalThis.SocioIntegrationsUI={render};
})();
