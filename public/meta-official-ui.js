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
   status.textContent=!data.configured?'A conexão oficial aguarda configuração na hospedagem.':data.connected?'Conta Meta conectada. Alterações de campanhas permanecem desativadas.':'Conecte sua conta Meta para autorizar o acesso.';
   if(canManage){const b=button('Conectar com Facebook',async()=>{const r=await api('/api/marketing/official/connect','POST');location.assign(r.authorizationUrl);});b.disabled=!data.configured;}
   if(data.connected){
    button('Consultar contas autorizadas',async()=>{const r=await api('/api/marketing/official/accounts');list.replaceChildren();for(const x of r.accounts){const li=document.createElement('li');li.textContent=x.name+' · '+x.id+' · '+x.currency;list.append(li);}if(!r.accounts.length)status.textContent='Nenhuma conta de anúncios disponível nesta autorização.';if(r.hasMore)status.textContent='Exibindo as primeiras 100 contas autorizadas.';});
    if(canManage)button('Desconectar do Sócio',async()=>{await api('/api/marketing/official/disconnect','POST');await render({root,api,canManage});});
   }
  }catch(e){status.textContent=e.message;}
 }
 globalThis.SocioMetaOfficial={render};
})();
