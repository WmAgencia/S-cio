(()=>{
 async function render({root,api,canManage}){
  root.replaceChildren();
  const title=document.createElement('h1');title.textContent='Meta Ads';root.append(title);
  const intro=document.createElement('p');intro.textContent='Conecte sua conta pelo app oficial Sócio Ads para consultar as contas de anúncios autorizadas.';root.append(intro);
  const status=document.createElement('p');status.setAttribute('role','status');root.append(status);
  const result=new URLSearchParams(location.search).get('meta_official');
  if(result){const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=result==='authorized'?'Autorização recebida da Meta.':result==='cancelled'?'Conexão cancelada na Meta.':'A conexão não foi concluída. Confira as permissões do aplicativo e tente novamente.';root.append(notice);}
  const privacy=document.createElement('p');for(const [label,url] of [['Privacidade','/privacidade.html'],['Exclusão de dados','/exclusao-dados.html']]){const link=document.createElement('a');link.href=url;link.textContent=label;privacy.append(link,document.createTextNode(' '));}root.append(privacy);
  const actions=document.createElement('div');root.append(actions);
  const list=document.createElement('ul');root.append(list);
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.className='btn';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}});actions.append(b);return b;};
  try{
   const data=await api('/api/marketing/official/status');
   status.textContent=!data.configured?'A conexão oficial aguarda configuração na hospedagem.':data.connected?'Conta Meta conectada. Operações exigem conta selecionada e confirmação da prévia.':'Conecte sua conta Meta para autorizar o acesso.';
   if(canManage){const b=button('Conectar com Facebook',async()=>{const r=await api('/api/marketing/official/connect','POST');location.assign(r.authorizationUrl);});b.disabled=!data.configured;}
   if(data.connected){
    const selected=document.createElement('p');selected.setAttribute('role','status');root.append(selected);
    const showSelected=x=>{selected.textContent=x?'Conta selecionada para esta empresa: '+x.account_name+' · '+x.account_id+' · '+(x.currency||''):'Nenhuma conta selecionada. Escolha onde esta empresa fará suas campanhas.';};
    showSelected(data.selectedAccount);
    const field=document.createElement('div');field.className='field';root.append(field);
    const label=document.createElement('label');label.htmlFor='metaAdAccount';label.textContent='Conta de anúncios';field.append(label);
    const select=document.createElement('select');select.id='metaAdAccount';select.disabled=true;field.append(select);
    const save=button('Usar esta conta',async()=>{
     const result=await api('/api/marketing/official/account','POST',{accountId:select.value});
     data.selectedAccount=result.selectedAccount;showSelected(result.selectedAccount);status.textContent='Conta de anúncios salva para esta empresa.';await render({root,api,canManage});
    });save.hidden=!canManage;save.disabled=true;
    const load=async()=>{
     select.disabled=true;save.disabled=true;
     const r=await api('/api/marketing/official/accounts');list.replaceChildren();select.replaceChildren();
     const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Selecione uma conta de anúncios';select.append(placeholder);
     for(const x of r.accounts){const option=document.createElement('option');option.value=x.id;option.textContent=x.name+' · '+x.id+' · '+x.currency;select.append(option);}
     select.value=data.selectedAccount?.account_id||'';select.disabled=!canManage||!r.accounts.length;save.disabled=!canManage||!select.value;
     if(!r.accounts.length)status.textContent='Nenhuma conta de anúncios disponível nesta autorização.';
     if(r.hasMore)status.textContent='Exibindo as primeiras 100 contas autorizadas.';
    };
    select.addEventListener('change',()=>{save.disabled=!canManage||!select.value;});
    button('Atualizar contas',load);
    await load();
    if(data.selectedAccount){
     const report=document.createElement('section');report.className='card card-pad';root.append(report);
     const heading=document.createElement('h2');heading.textContent='Testar minha integração Meta';report.append(heading);
     const description=document.createElement('p');
     description.textContent='Teste somente leitura usando a autorização do aplicativo Sócio desta empresa, não a conexão Meta do ChatGPT. Nenhum anúncio será alterado.';
     report.append(description);
     const feedback=document.createElement('p');feedback.setAttribute('role','status');report.append(feedback);
     const details=document.createElement('div');report.append(details);
     button('Testar conexão oficial (sem alterações)',async()=>{
      feedback.textContent='Consultando a conta e as ferramentas da Meta…';details.replaceChildren();
      const result=await api('/api/marketing/official/preflight');
      feedback.textContent=result.status==='read_ready'?'Consultas principais funcionando no Sócio.':
       result.reason||'Teste concluído com pendências.';
      const summary=document.createElement('p');
      summary.textContent='Conta: '+(result.accountName||'não selecionada')+' · '+(result.accountId||'')+
       ' · ads_read: '+(result.hasAdsRead?'sim':'não')+' · ads_management: '+(result.hasAdsManagement?'sim':'não');
      details.append(summary);
      for(const check of result.checks||[]){
       const line=document.createElement('p');
       line.textContent=(check.ok?'✓ ':'✕ ')+check.kind+': '+(check.ok?check.count+' registros recebidos'+(check.more?' (há mais)':''):check.error);
       details.append(line);
      }
      const note=document.createElement('p');
      note.textContent='Este teste confirma consultas somente quando a própria API do Sócio retorna sucesso. Não testa publicações, pagamentos ou o WhatsApp.';
      details.append(note);
     });
    }
    if(data.selectedAccount&&globalThis.SocioAdsTools)await globalThis.SocioAdsTools.render({root,api,canManage,account:data.selectedAccount});
    if(data.selectedAccount&&globalThis.SocioMetaAdvanced)await globalThis.SocioMetaAdvanced.render({root,api,account:data.selectedAccount});
    if(data.selectedAccount&&globalThis.SocioMetaCommandUI)await globalThis.SocioMetaCommandUI.render({root,api,canManage,account:data.selectedAccount});
    if(data.selectedAccount&&globalThis.SocioMetaScheduleUI)await globalThis.SocioMetaScheduleUI.render({root,api,canManage,account:data.selectedAccount});
    if(data.selectedAccount&&globalThis.SocioAttribution)await globalThis.SocioAttribution.render({root,api,canManage,account:data.selectedAccount});
    if(canManage)button('Desconectar do Sócio',async()=>{await api('/api/marketing/official/disconnect','POST');await render({root,api,canManage});});
   }
  }catch(e){status.textContent=e.message;}
 }
 globalThis.SocioMetaOfficial={render};
})();
