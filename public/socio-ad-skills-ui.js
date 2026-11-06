// Conversational-first Meta Ads skills UI. WA-AKG is never replaced.
(()=>{
 const E=(tag,t)=>{const n=document.createElement(tag);if(t!==undefined)n.textContent=String(t);return n;};
 async function render({root,api,canManage,account}){
  const section=E('section');section.className='card card-pad';section.dataset.socioSkill='campaign';
  root.append(section);
  section.append(E('h2','Peça à IA. O Sócio cuida da campanha.'));
  section.append(E('p','Descreva seu objetivo normalmente. O Sócio identifica a especialidade correta, consulta os recursos permitidos e só pede o que faltar. Criação de anúncios Meta sempre PAUSADA; Google Ads ainda não está conectado.'));
  const overview=E('div');overview.className='panel';section.append(overview);
  const start=E('p','Exemplo: Quero vender roupa feminina em Sorocaba gastando seis reais por dia.');
  overview.append(start);
  const conversations=E('div');conversations.setAttribute('role','log');conversations.setAttribute('aria-label','Conversa com as skills de Meta Ads');section.append(conversations);
  const form=E('form');form.className='form-stack';section.append(form);
  const box=E('textarea');box.rows=3;box.maxLength=1400;box.placeholder='Escreva seu pedido. Pode responder “pode criar” quando estiver pronto.';
  box.required=false;box.setAttribute('aria-label','Fale com a IA do Sócio');form.append(box);
  const upload=E('input');upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.setAttribute('aria-label','Enviar foto do produto');form.append(upload);
  const button=E('button','Enviar pedido');button.className='btn primary';button.type='submit';button.disabled=!canManage;form.append(button);
  const feedback=E('p');feedback.setAttribute('role','status');form.append(feedback);
  let runId=null;
  function add(author,text){
   const line=E('article');line.className='panel';line.append(E('strong',author));
   line.append(E('p',text));conversations.append(line);
  }
  async function attachPhoto(file){
   if(!file)return null;
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>3000000)
    throw Error('Selecione uma foto JPG, PNG ou WebP com até 3 MB.');
   const encoded=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(Error('Não foi possível ler a foto.'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
   });
   const meta=await api('/api/marketing/tools/image','POST',{contentBase64:encoded});
   if(!meta.hash)throw Error('A Meta não confirmou a imagem; confira a biblioteca antes de reenviar.');
   return meta.hash;
  }
  if(!canManage){
   feedback.textContent='Somente proprietários e administradores autorizados podem preparar anúncios.';
   return;
  }
  form.addEventListener('submit',async ev=>{
   ev.preventDefault();
   const message=box.value.trim(),file=upload.files?.[0]||null;
   if(!message&&!file){feedback.textContent='Escreva um pedido ou envie a foto solicitada.';return;}
   button.disabled=true;feedback.textContent='Conferindo os dados da sua empresa e da conta '+account.account_id+'…';
   try{
    const isGoogleRequest=/(google\\s*(?:ads|adwords)|adwords|rede de pesquisa|an[uú]ncio[s]?\\s+(?:no|do|pelo)\\s+google|campanha\\s+(?:no|do|pelo)\\s+google)/i.test(message);
    if(file&&isGoogleRequest)throw Error('Não vou enviar esta foto para a Meta: você pediu Google Ads, que ainda não está integrado. Envie seu pedido sem foto para ver as orientações.');
    const imageHash=await attachPhoto(file);
    const answer=await api('/api/marketing/skills/chat','POST',{message,runId,imageHash});
    if(message)add('Você',message);
    if(file)add('Você','Foto enviada com segurança para a biblioteca de anúncios da conta selecionada.');
    runId=answer.runId;
    add('Sócio IA',answer.message||'Solicitação registrada.');
    if(answer.note)add('Rastreamento',answer.note);
    if(['completed','failed','action_required'].includes(answer.status))runId=null;
    feedback.textContent=answer.status==='ready'?'Plano pronto. Se estiver correto, responda “pode criar”.':
     answer.status==='collecting'?'Sócio aguarda apenas a próxima informação necessária.':
     answer.status==='action_required'?'Esta integração requer configuração; nenhuma campanha foi alterada.':
     answer.status==='completed'?(answer.result?.result?.campaignId?'Campanha confirmada pela Meta. Itens pausados.':'Consulta concluída. Confira a resposta.'):
     'Confira a mensagem e os resultados antes de repetir.';
    box.value='';upload.value='';
   }catch(error){feedback.textContent=error.message+' Nenhuma execução deve ser repetida sem verificar o histórico.';}
   finally{button.disabled=false;}
  });
  try{
   const data=await api('/api/marketing/skills/catalog');
   const experts=Array.isArray(data.experts)?data.experts:[];
   if(experts.length)overview.append(E('p','Especialidades: '+experts.map(x=>x.label+(x.availability==='pending_oauth_api'?' (integração pendente)':'')).join(' · ')));
   const pending=(data.skills||[]).filter(x=>x.availability.startsWith('pending'));
   if(pending.length)overview.append(E('p','Comandos por grupos WhatsApp e instalação automática de CAPI ainda estão em homologação. O painel já aceita pedidos conversacionais.'));
  }catch{}
 }
 globalThis.SocioAdSkillsUI={render};
})();
