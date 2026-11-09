// Conversational-first Meta Ads skills UI. WA-AKG is never replaced.
(()=>{
 const E=(tag,t)=>{const n=document.createElement(tag);if(t!==undefined)n.textContent=String(t);return n;};
 async function render({root,api,canManage,account}){
  const section=E('section');section.className='card card-pad';section.dataset.socioSkill='campaign';
  root.append(section);
  section.append(E('h2','Peça à IA. O Sócio cuida da campanha.'));
  section.append(E('p','Descreva seu objetivo normalmente. O Sócio identifica a especialidade correta, consulta os recursos permitidos e só pede o que faltar. Criação de anúncios Meta sempre PAUSADA; Google Ads ainda não está conectado.'));
  const overview=E('div');overview.className='panel';section.append(overview);
  const waCheck=E('details');waCheck.append(E('summary','Diagnóstico do WhatsApp do proprietário'));section.append(waCheck);
  waCheck.append(E('p','Conferir ligação WA-AKG, identidade e habilitação de texto, fotos e áudio. Diagnóstico apenas de leitura; não inicia sessões nem envia mensagens.'));
  const waBtn=E('button','Verificar conexão WA-AKG');waBtn.type='button';waBtn.className='btn soft';waCheck.append(waBtn);
  const waFeedback=E('p');waFeedback.setAttribute('role','status');waCheck.append(waFeedback);
  const waResults=E('div');waCheck.append(waResults);
  waBtn.addEventListener('click',async()=>{
   waBtn.disabled=true;waFeedback.textContent='Verificando canal e permissões da sua empresa…';waResults.replaceChildren();
   try{
    const status=await api('/api/marketing/skills/whatsapp-readiness');
    waFeedback.textContent=status.textReady?'Comandos privados de texto prontos para homologação.':'Há pendências antes de habilitar os comandos privados.';
    for(const line of [
     'Canais cadastrados: '+status.channels+' · Sessões WA-AKG conectadas e verificadas: '+status.connectedSessions,
     'Conversas privadas de proprietários verificadas: '+status.verifiedOwnerConversations,
     'Texto: '+(status.textReady?'pronto para piloto':'pendente')+
       ' · Fotos: '+(status.photoReady?'prontas para piloto':'pendentes')+
       ' · Áudio: '+(status.audioReady?'pronto para piloto':'pendente'),
     ...(status.blockers||[]).map(x=>'Pendente: '+x),
     status.nextStep,status.note
    ])waResults.append(E('p',line));
   }catch(error){waFeedback.textContent='Diagnóstico indisponível: '+error.message;}
   finally{waBtn.disabled=false;}
  });

  const start=E('p','Exemplos: “Quero vender roupa feminina em Sorocaba gastando seis reais por dia” ou “Analise meus anúncios e explique o que melhorar”.');
  overview.append(start);
  const conversations=E('div');conversations.setAttribute('role','log');conversations.setAttribute('aria-label','Conversa com as skills de Meta Ads');section.append(conversations);
  const form=E('form');form.className='form-stack';section.append(form);
  const box=E('textarea');box.rows=3;box.maxLength=1400;box.placeholder='Escreva seu pedido. Pode responder “pode criar” quando estiver pronto.';
  box.required=false;box.setAttribute('aria-label','Fale com a IA do Sócio');form.append(box);
  const upload=E('input');upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.setAttribute('aria-label','Enviar foto do produto');form.append(upload);
  const button=E('button','Enviar pedido');button.className='btn primary';button.type='submit';button.disabled=!canManage;form.append(button);
  const feedback=E('p');feedback.setAttribute('role','status');form.append(feedback);
  let runId=null,linkedVideoId=null;
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
  if(canManage){
   const videoBox=E('details');videoBox.dataset.socioSkill='whatsapp-video';section.append(videoBox);
   videoBox.append(E('summary','Usar vídeo do WhatsApp em anúncio da Meta Ads'));
   videoBox.append(E('p','Encontre o vídeo enviado ou recebido na conversa com o proprietário autorizado. Depois importe para a biblioteca Meta e prepare uma campanha de WhatsApp PAUSADA. Só aceite remetentes cadastrados como owner/admin. Nenhum anúncio é ativado automaticamente.'));
   const videoForm=E('div');videoForm.className='form-stack';videoBox.append(videoForm);
   videoForm.append(E('label','WhatsApp da empresa conectado'));
   const videoChannel=E('select');videoChannel.setAttribute('aria-label','Canal conectado de origem do vídeo');videoForm.append(videoChannel);
   videoForm.append(E('label','Origem da mídia no WhatsApp'));
   const videoDirection=E('select');videoDirection.setAttribute('aria-label','Direção da mídia');
   const outgoing=E('option','Vídeo enviado por este WhatsApp');outgoing.value='outgoing';
   const incoming=E('option','Vídeo recebido de proprietário autorizado');incoming.value='incoming';
   videoDirection.append(outgoing,incoming);videoForm.append(videoDirection);
   videoForm.append(E('label','Número da outra pessoa na conversa'));
   const videoRecipient=E('input');videoRecipient.type='tel';videoRecipient.maxLength=24;
   videoRecipient.placeholder='DDD + telefone, por exemplo 15 99999-9999';
   videoRecipient.setAttribute('aria-label','Número da conversa com o vídeo');videoForm.append(videoRecipient);
   const findVideoBtn=E('button','Localizar último vídeo da conversa');findVideoBtn.type='button';
   findVideoBtn.className='btn soft';videoForm.append(findVideoBtn);
   const selectedInfo=E('p');selectedInfo.setAttribute('role','status');videoForm.append(selectedInfo);
   const videoConfirm=E('button','Confirmar e enviar vídeo para a biblioteca Meta');videoConfirm.type='button';
   videoConfirm.className='btn primary';videoConfirm.disabled=true;videoForm.append(videoConfirm);
   const resultText=E('p');resultText.setAttribute('role','status');videoForm.append(resultText);
   let selectedVideo=null,loadedChannels=false,selectedInstruction=null;
   const prepareFromVideo=E('button','Preparar campanha de WhatsApp com este vídeo');
   prepareFromVideo.type='button';prepareFromVideo.className='btn soft';prepareFromVideo.disabled=true;
   videoForm.append(prepareFromVideo);
   prepareFromVideo.addEventListener('click',()=>{
    if(!linkedVideoId)return;
    box.value=(selectedInstruction||'Crie um anúncio para WhatsApp com esse vídeo').slice(0,1400);
    runId=null;
    form.requestSubmit();
   });
   // A library upload is NOT an ad. Review and confirm a separate PAUSED
   // ad in an existing ad set; the selected Meta account never changes here.
   const adForm=E('div');adForm.className='form-stack';videoBox.append(adForm);
   const adTitle=E('h3','Criar anúncio PAUSADO com o vídeo importado');adForm.append(adTitle);
   adForm.append(E('p','O vídeo precisa concluir o processamento na Meta. Selecione conjunto, Página, link e textos; o Sócio prepara a prévia antes de criar o anúncio.'));
   const adAccount=E('p','Conta selecionada: '+String(account.account_id||''));
   adForm.append(adAccount);
   const videoStatus=E('p');videoStatus.setAttribute('role','status');adForm.append(videoStatus);
   const adInputs={};
   function field(name,label,tag='input'){
    const labelEl=E('label',label);adForm.append(labelEl);
    const el=E(tag);el.setAttribute('aria-label',label);
    adForm.append(el);adInputs[name]=el;return el;
   }
   const adset=field('adsetId','Conjunto de anúncios existente','select');
   const page=field('pageId','Página autorizada','select');
   const adName=field('name','Nome do anúncio');adName.maxLength=120;
   const landing=field('url','Site HTTPS de destino');landing.type='url';
   const headline=field('headline','Título do anúncio');headline.maxLength=120;
   const primaryText=field('message','Texto principal do anúncio','textarea');primaryText.maxLength=2200;primaryText.rows=3;
   const previewAd=E('button','Preparar anúncio com vídeo (pausado)');previewAd.type='button';
   previewAd.className='btn soft';previewAd.disabled=true;adForm.append(previewAd);
   const confirmAd=E('button','Confirmar criação do anúncio pausado');confirmAd.type='button';
   confirmAd.className='btn primary';confirmAd.disabled=true;adForm.append(confirmAd);
   const adResult=E('p');adResult.setAttribute('role','status');adForm.append(adResult);
   let uploadedVideoId=null,adPlanId=null;
   function resetAdPlan(){adPlanId=null;confirmAd.disabled=true;adResult.textContent='';}
   for(const el of Object.values(adInputs))el.addEventListener('input',resetAdPlan);
   async function loadMetaAdAssets(){
    const [sets,pages]=await Promise.all([
     api('/api/marketing/tools/adsets'),api('/api/marketing/tools/pages')
    ]);
    adset.replaceChildren();page.replaceChildren();
    for(const item of Array.isArray(sets.items)?sets.items:[]){
     const option=E('option',String(item.name||'Conjunto')+' · '+String(item.id||''));
     option.value=String(item.id||'');adset.append(option);
    }
    for(const item of Array.isArray(pages.items)?pages.items:[]){
     const option=E('option',String(item.name||'Página')+' · '+String(item.id||''));
     option.value=String(item.id||'');page.append(option);
    }
    previewAd.disabled=!adset.options.length||!page.options.length||!uploadedVideoId;
    if(!adset.options.length||!page.options.length)
     videoStatus.textContent='Esta conta precisa de uma Página autorizada e um conjunto existente antes de criar o anúncio.';
   }
   previewAd.addEventListener('click',async()=>{
    resetAdPlan();previewAd.disabled=true;
    adResult.textContent='Conferindo vídeo, Página, conjunto e dados da campanha…';
    try{
     if(!uploadedVideoId)throw Error('Primeiro importe o vídeo para esta conta Meta.');
     const plan=await api('/api/marketing/tools/plan','POST',{
      kind:'create_ad',input:{
       name:adName.value.trim(),adsetId:adset.value,pageId:page.value,
       url:landing.value.trim(),headline:headline.value.trim(),
       message:primaryText.value.trim(),videoId:uploadedVideoId
      }
     });
     if(!plan.id)throw Error('A Meta não confirmou uma prévia válida.');
     adPlanId=plan.id;confirmAd.disabled=false;
     adResult.textContent='Prévia confirmada: '+String(plan.summary?.description||'Anúncio PAUSADO')+
      ' · '+String(plan.summary?.name||'')+
      ' · título: '+String(plan.summary?.headline||'')+
      ' · destino: '+String(plan.summary?.destination||'')+
      '. Confira e clique em Confirmar para criar SEM ativar.';
    }catch(e){adResult.textContent='Prévia indisponível: '+e.message;}
    finally{previewAd.disabled=false;}
   });
   confirmAd.addEventListener('click',async()=>{
    if(!adPlanId)return;
    const planId=adPlanId;adPlanId=null;confirmAd.disabled=true;
    adResult.textContent='Criando criativo e anúncio PAUSADOS na Meta… Não repita sem conferir o histórico.';
    try{
     const res=await api('/api/marketing/tools/execute','POST',{planId,confirmed:true});
     if(res.status!=='succeeded'||!res.result?.adId)
      throw Error(res.error||'A Meta não confirmou o anúncio. Verifique o histórico antes de tentar novamente.');
     adResult.textContent='Anúncio criado PAUSADO na Meta. ID: '+res.result.adId+
      ' · Criativo ID: '+String(res.result.creativeId||'')+
      '. A veiculação não foi ativada e não gera gasto.';
    }catch(e){adResult.textContent=e.message+' Confira o Gerenciador de Anúncios antes de qualquer nova tentativa.';}
   });

   async function loadChannels(){
    const res=await api('/api/marketing/tools/whatsapp-video/channels');
    const channels=Array.isArray(res.channels)?res.channels:[];
    videoChannel.replaceChildren();
    for(const ch of channels){
     const option=E('option',String(ch.label||'WhatsApp')+' · '+String(ch.phone||''));
     option.value=ch.id;videoChannel.append(option);
    }
    if(!channels.length)selectedInfo.textContent='Conecte e verifique seu WhatsApp antes de procurar vídeos.';
    findVideoBtn.disabled=!channels.length;
    loadedChannels=true;
   }
   videoBox.addEventListener('toggle',async()=>{
    if(!videoBox.open||loadedChannels)return;
    try{await loadChannels();}catch(e){selectedInfo.textContent='Não consegui listar os canais: '+e.message;}
   });
   function clearVideo(){
    selectedVideo=null;videoConfirm.disabled=true;
    prepareFromVideo.disabled=true;linkedVideoId=null;selectedInstruction=null;
    selectedInfo.textContent='';resultText.textContent='';
   }
   videoRecipient.addEventListener('input',clearVideo);
   videoChannel.addEventListener('change',clearVideo);
   videoDirection.addEventListener('change',clearVideo);
   findVideoBtn.addEventListener('click',async()=>{
    clearVideo();findVideoBtn.disabled=true;selectedInfo.textContent='Verificando sessão, destino e histórico de vídeos…';
    try{
     const query=new URLSearchParams({channelId:videoChannel.value,recipientPhone:videoRecipient.value,
      direction:videoDirection.value});
     const found=await api('/api/marketing/tools/whatsapp-video/last?'+query);
     if(!found.video){selectedInfo.textContent=found.message||'Vídeo não encontrado no histórico sincronizado.';return;}
     selectedVideo={channelId:found.channelId,recipientPhone:found.recipientPhone,
      direction:videoDirection.value,messageId:found.video.messageId,sentAt:found.video.sentAt};
     selectedInstruction=typeof found.instruction==='string'?found.instruction:null;
     selectedInfo.textContent='Vídeo '+(videoDirection.value==='incoming'?'recebido':'enviado')+' em '+
      new Date(found.video.sentAt).toLocaleString('pt-BR')+
      '. '+(selectedInstruction?'Última instrução relacionada: “'+selectedInstruction+'”. ':'')+
      'Confirme se é o arquivo desejado. O upload será apenas para a biblioteca Meta.';
     videoConfirm.disabled=false;
    }catch(e){selectedInfo.textContent=e.message;}
    finally{findVideoBtn.disabled=false;}
   });
   videoConfirm.addEventListener('click',async()=>{
    if(!selectedVideo)return;
    const video=selectedVideo;videoConfirm.disabled=true;
    resultText.textContent='Recuperando vídeo autorizado e enviando à Meta. Não atualize nem repita a operação.';
    try{
     const answer=await api('/api/marketing/tools/whatsapp-video/import','POST',{
      channelId:video.channelId,recipientPhone:video.recipientPhone,direction:video.direction,
      messageId:video.messageId,confirmed:true
     });
     resultText.textContent=(answer.message||'Upload consultado.')+
      (answer.videoId?' ID Meta: '+answer.videoId+'.':'')+
      (answer.replayed?' Operação já registrada, não repetida.':'');
     selectedVideo=null;
     if(answer.status==='uploaded'&&answer.videoId){
      uploadedVideoId=String(answer.videoId);
      linkedVideoId=uploadedVideoId;prepareFromVideo.disabled=false;
      videoStatus.textContent='Vídeo importado. ID '+uploadedVideoId+'. Verificando os recursos necessários para criar o anúncio…';
      try{await loadMetaAdAssets();}catch(e){videoStatus.textContent='O vídeo foi importado, mas não consegui listar Página e conjuntos: '+e.message;}
     }
    }catch(e){resultText.textContent=e.message+' Consulte a biblioteca Meta antes de tentar novamente.';selectedVideo=null;}
   });
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
    const isGoogleRequest=/(google\s*(?:ads|adwords)|adwords|rede de pesquisa|an[uú]ncio[s]?\s+(?:no|do|pelo)\s+google|campanha\s+(?:no|do|pelo)\s+google)/i.test(message);
    if(file&&isGoogleRequest)throw Error('Não vou enviar esta foto para a Meta: você pediu Google Ads, que ainda não está integrado. Envie seu pedido sem foto para ver as orientações.');
    const imageHash=await attachPhoto(file);
    if(file&&linkedVideoId)throw Error('Selecione uma foto ou um vídeo, não ambos.');
    const answer=await api('/api/marketing/skills/chat','POST',{message,runId,imageHash,
     videoId:linkedVideoId});
    if(message)add('Você',message);
    if(file)add('Você','Foto enviada com segurança para a biblioteca de anúncios da conta selecionada.');
    runId=answer.runId;
    add('Sócio IA',answer.message||'Solicitação registrada.');
    if(answer.status==='ready'&&Array.isArray(answer.creativeVariants)&&answer.creativeVariants.length){
     const drafts=answer.creativeVariants.slice(0,3).map((draft,i)=>
      (i+1)+(i===0?' (selecionada para criação)':' (alternativa para revisão)')+
      ': '+String(draft.headline||'').slice(0,120)+' — '+String(draft.message||'').slice(0,500)
     ).join('\n\n');
     add('Prévia dos textos',drafts+'\n\nO plano atual usa a opção 1. As outras são referências para revisar ou criar outro pedido; não serão publicadas automaticamente.');
    }
    if(answer.note)add('Rastreamento',answer.note);
    if(['completed','failed','action_required'].includes(answer.status)){
     runId=null;linkedVideoId=null;
    }
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
