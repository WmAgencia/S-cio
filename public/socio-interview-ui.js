// Prospector's guided-chat training experience, adapted to the Sócio tenant model.
// Other tools (WhatsApp scan, models, voice, image creation) are preserved.
(()=>{
 const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const node=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e;};
 let root=null,host=null,api=null,toast=null,csrf='',user=null,state=null,versions=[],busy=false,recorder=null,stream=null,recordChunks=[],recordTimer=null,transcriptText='',speaking=false,liveVoice=null,voiceState='off',finishSpeech=null,speechAbort=null,speechPlayer=null,speechUrl=null;
 const canEdit=()=>user?.platformOwner||(user?.permissions||[]).includes('training.manage');
 // Thalita is rendered by our own authenticated Edge TTS route, not by a browser-dependent voice.
 // Explicit playback cancellation allows users to interrupt her mid-sentence.
 const cancelSpeech=()=>{
  const abort=speechAbort;speechAbort=null;
  try{abort?.abort();}catch{}
  if(speechPlayer){try{speechPlayer.pause();speechPlayer.removeAttribute('src');speechPlayer.load();}catch{}speechPlayer=null;}
  if(speechUrl){URL.revokeObjectURL(speechUrl);speechUrl=null;}
  finishSpeech?.();finishSpeech=null;speaking=false;
  updateVoiceStatus();
 };
 const say=async text=>{
  if(!state?.interview||state.interview.mode!=='voice'||!liveVoice)return;
  cancelSpeech();
  const controller=new AbortController();speechAbort=controller;
  speaking=true;updateVoiceStatus();
  try{
   const response=await fetch('/api/training/interview/tts',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:JSON.stringify({text:String(text||'').slice(0,650)}),signal:controller.signal});
   if(!response.ok){
    const result=await response.json().catch(()=>({}));
    throw new Error(result.error||'Não foi possível gerar a voz Thalita.');
   }
   if(response.headers.get('X-TTS-Voice')!=='pt-BR-ThalitaMultilingualNeural')
    throw new Error('A voz solicitada não corresponde à Thalita.');
   const blob=await response.blob();
   if(controller.signal.aborted)return;
   speechUrl=URL.createObjectURL(blob);
   const player=new Audio(speechUrl);
   speechPlayer=player;
   await new Promise((resolve,reject)=>{
    let settled=false;
    const done=()=>{if(settled)return;settled=true;finishSpeech=null;resolve();};
    finishSpeech=done;
    player.onended=done;
    player.onerror=()=>{done();reject(new Error('O navegador não reproduziu a voz Thalita.'));};
    player.play().catch(error=>{done();reject(error);});
   });
  }catch(error){
   if(!controller.signal.aborted)toast('Voz Thalita indisponível. Continue pelo chat: '+String(error.message||'erro').slice(0,110),true);
  }finally{
   if(speechAbort===controller)cancelSpeech();
  }
 };
 const stopVoice=()=>{
  const active=liveVoice;liveVoice=null;voiceState='off';
  try{active?.stop();}catch{}
  cancelSpeech();
  if(recordTimer)clearTimeout(recordTimer);recordTimer=null;
  if(recorder?.state==='recording')recorder.stop();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  recorder=null;recordChunks=[];
 };
 const voiceStatusText=()=>({
  connecting:'Conectando microfone…',listening:'Microfone ativo · pode falar',hearing:'Estou ouvindo…',
  speaking:'Thalita está falando · você pode interromper',processing:'Entendendo sua resposta…',
  off:'Voz Thalita desligada · ative quando quiser'
 })[speaking?'speaking':voiceState]||'Treinamento por voz';
 function updateVoiceStatus(){
  const status=host?.querySelector('#psVoiceStatus');
  if(status)status.textContent=voiceStatusText();
  const btn=host?.querySelector('[data-ps-record]');
  if(btn)btn.textContent=liveVoice?'Desligar voz':'Conversar por voz';
 }
 async function beginLiveVoice(){
  if(liveVoice||!state?.interview||state.interview.completed)return;
  const {createSocioVoiceSession}=await import('/socio-francisca-live.mjs?v=20261113d');
  const session=createSocioVoiceSession({
   canInterrupt:()=>speaking,
   onInterrupt:()=>{cancelSpeech();voiceState='hearing';updateVoiceStatus();},
   onState:status=>{voiceState=status;updateVoiceStatus();},
   onError:message=>toast(message,true),
   maxTurnMs:22000,
   onTurn:async blob=>{
    if(!liveVoice)return;
    if(blob.size>3*1024*1024){toast('Fale em frases um pouco mais curtas.',true);return;}
    const mime=(blob.type||'audio/webm').split(';')[0];
    const response=await fetch('/api/training/interview/audio',{
     method:'POST',credentials:'same-origin',
     headers:{'Content-Type':mime,'X-CSRF-Token':csrf},body:blob});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Transcrição indisponível.');
    await submit(String(result.text||'').trim());
   }
  });
  liveVoice=session;
  try{await session.start();updateVoiceStatus();}
  catch(error){liveVoice=null;session.stop();voiceState='off';updateVoiceStatus();throw error;}
 }
 async function toggleLiveVoice(){
  if(liveVoice){stopVoice();updateVoiceStatus();return;}
  try{await beginLiveVoice();await say(state?.interview?.question||'');}
  catch(error){toast('Não foi possível ativar a voz contínua. Continue digitando: '+String(error.message||'').slice(0,120),true);}
 }
 async function refresh(){
  const [i,v]=await Promise.all([api('/api/training/interview'),api('/api/training/versions')]);
  state=i||{interview:null};versions=Array.isArray(v)?v:[];paint();
 }
 const getDraft=()=>versions.find(x=>x.status==='draft')||versions.find(x=>x.id===state?.interview?.draftVersionId)||versions.find(x=>x.status==='approved')||null;
 const trainingCards=markdown=>{
  const text=String(markdown||'');
  const parts=text.split(/(?=^#{1,3}\s+[^\n]+)/m).filter(Boolean);
  return parts.map((raw,index)=>{
   const lines=raw.trim().split('\n');
   const title=String(lines[0]||'').replace(/^#{1,3}\s+/,'').trim()||'Orientações gerais';
   const summary=lines.slice(1).join(' ').replace(/[*_`>#-]/g,' ').replace(/\s+/g,' ').trim().slice(0,170);
   return {index,raw,title,summary};
  });
 };
 const button=(text,attr='',className='btn soft')=>'<button type="button" class="'+className+'" '+attr+'>'+escape(text)+'</button>';
 const welcome=()=>'<div class="ps-interview-welcome"><div class="ps-avatar">✳</div>'+
  '<span class="ps-kicker">TREINAMENTO GUIADO · ESTILO PROSPECTOR</span>'+
  '<h2>Vamos treinar o seu Sócio.</h2>'+
  '<p>Responda às perguntas sobre sua empresa. Uma conversa simples que vira um manual de atendimento para você revisar.</p>'+
  '<div class="ps-mode-grid">'+
   '<button type="button" data-ps-start="voice" class="ps-mode"><span aria-hidden="true" class="ps-mode-icon">◉</span><strong>Conversar por voz com Thalita</strong><small>Ouça a voz neural Thalita e responda com o microfone. Você pode escrever também.</small><b>Começar por voz</b></button>'+
   '<button type="button" data-ps-start="text" class="ps-mode"><span aria-hidden="true" class="ps-mode-icon">✎</span><strong>Conversar pelo chat</strong><small>Uma pergunta por vez, sem formulários longos. Revise tudo antes de ativar.</small><b>Começar por texto</b></button>'+
  '</div><small>O atendimento atual da empresa não muda até que você aprove o novo treinamento.</small></div>';
 function conversation(i){
  const progress=Math.max(0,Math.min(100,Number(i.progress)||0));
  const choices=Array.isArray(i.choices)?i.choices:[];
  return '<section class="ps-chat-card" aria-label="Conversa de treinamento">'+
   '<header class="ps-chat-header"><div class="ps-face">✳</div><div><strong>Sócio · Treinamento</strong><small>'+(i.mode==='voice'?'Thalita · voz e chat':'Conversa por texto')+'</small></div>'+
   '<span class="ps-progress-number">'+progress+'%</span>'+
   button('Recomeçar','data-ps-reset aria-label="Reiniciar entrevista"','btn sm soft')+'</header>'+
   '<div class="ps-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+progress+'" aria-label="Progresso da entrevista"><div style="width:'+progress+'%"></div></div>'+
   '<div class="ps-feed" role="log" aria-live="polite" aria-label="Histórico do treinamento">'+(i.messages||[]).map(m=>
     '<div class="ps-line '+(m.role==='user'?'mine':'assistant')+'">'+(m.role==='assistant'?'<span class="ps-small-avatar">✳</span>':'')+
     '<div class="ps-bubble"><small>'+(m.role==='assistant'?'Sócio':'Você')+'</small><p>'+escape(m.body)+'</p></div></div>').join('')+
   '</div>'+
   (i.completed?'<div class="ps-concluded" role="status">Entrevista concluída. Revise o manual abaixo antes de aprovar.</div>':
   (choices.length?'<div class="ps-choices" role="group" aria-label="Escolha o estilo de primeira resposta">'+choices.map((x,n)=>
    '<button type="button" data-ps-choice="'+escape(x.id)+'" '+(busy?'disabled':'')+'><span>'+(n+1)+'</span><strong>'+escape(x.label)+'</strong><small>'+escape(x.description)+'</small></button>').join('')+'</div>':'')+
   '<form id="psInterviewForm" class="ps-composer"><label for="psInterviewAnswer" class="ps-sr-only">Sua resposta</label>'+
   '<textarea id="psInterviewAnswer" name="text" rows="2" maxlength="850" required '+(busy?'disabled':'')+
   ' placeholder="'+(i.step==='approach_custom'?'Digite a primeira resposta do seu jeito…':'Escreva sua resposta ou use o microfone…')+'">'+escape(transcriptText)+'</textarea>'+
   '<div class="ps-composer-actions">'+(i.mode==='voice'?button(liveVoice?'Desligar voz':'Conversar por voz','data-ps-record','btn soft'):'<span class="ps-composer-hint">Responda naturalmente.</span>')+
   '<button type="submit" class="btn primary" '+(busy?'disabled':'')+'>'+(busy?'Enviando…':'Enviar resposta →')+'</button></div>'+
   '<div id="psVoiceStatus" role="status" class="ps-voice-status">'+(i.mode==='voice'?escape(voiceStatusText()):'Sua resposta fica privada no espaço da empresa.')+'</div></form>')+
   '</section>';
 }
 const review=()=>{
  const draft=getDraft();
  if(!draft)return '';
  const approved=draft.status==='approved',editable=draft.status==='draft'&&canEdit();
  return '<section class="ps-review" aria-label="Revisão do manual"><div class="ps-review-head"><div><span class="ps-kicker">REVISÃO DO PROPRIETÁRIO</span><h3>Manual de atendimento</h3><p>Versão '+escape(draft.version)+' · '+(approved?'Aprovada':'Rascunho privado. Nada será ativado sem aprovação.')+'</p></div>'+
   '<span class="ps-pill '+(approved?'approved':'')+'">'+(approved?'Ativo':'Aguardando revisão')+'</span></div>'+
   '<div class="ps-review-cards" aria-label="Orientações da IA">'+trainingCards(draft.markdown).map(card=>
    '<article class="ps-review-card"><div class="ps-review-card-top"><span class="ps-review-symbol">✳</span><small>Orientação '+(card.index+1)+'</small></div>'+
    '<h4>'+escape(card.title)+'</h4><p>'+escape(card.summary||'Orientações detalhadas disponíveis para revisão.')+'</p>'+
    '<details><summary>Ler orientação completa</summary><pre>'+escape(card.raw)+'</pre></details>'+
    (canEdit()?'<div class="ps-review-card-actions"><button type="button" class="btn sm soft" data-ps-card-edit="'+card.index+'">Editar</button>'+
    '<button type="button" class="btn sm soft ps-delete-action" data-ps-card-delete="'+card.index+'">Excluir</button></div>':'')+'</article>').join('')+'</div>'+
   '<details class="ps-markdown-advanced"><summary>Editar manual completo em Markdown</summary>'+
   '<textarea id="psDraftMarkdown" rows="15" maxlength="22000" aria-label="Manual Markdown" '+(editable?'':'readonly')+'>'+escape(draft.markdown)+'</textarea></details>'+
   '<dialog id="psCardDialog" class="ps-card-dialog"><form method="dialog"><header><h4>Editar orientação</h4><button type="submit" value="cancel" aria-label="Fechar">×</button></header>'+
   '<label for="psCardText">Conteúdo da orientação</label><textarea id="psCardText" rows="9" maxlength="22000"></textarea>'+
   '<footer><button type="submit" value="cancel" class="btn soft">Cancelar</button><button type="button" class="btn primary" data-ps-card-save>Salvar orientação</button></footer></form></dialog>'+
   (editable?'<div class="ps-review-actions">'+button('Salvar alterações','data-ps-save')+button('Aprovar manual','data-ps-approve','btn primary')+'</div>':
    '<p class="ps-review-note">'+(approved?'O manual está disponível para a IA da sua empresa.':'Somente o proprietário ou administrador pode aprovar.')+'</p>')+'</section>';
 };
 function paint(){
  if(!host)return;
  const i=state?.interview,approved=versions.find(x=>x.status==='approved');
  host.innerHTML='<header class="ps-heading"><div><span class="ps-kicker">INTELIGÊNCIA ARTIFICIAL</span><h1>Treinamento da IA</h1><p>O mesmo processo guiado do Prospector, adaptado ao atendimento do Sócio.</p></div>'+
    '<span class="ps-pill '+(approved?'approved':'')+'">'+(approved?'Manual aprovado':'Preparação')+'</span></header>'+
   '<div class="ps-training-content">'+(i?conversation(i):welcome())+review()+'</div>'+
   '<p class="ps-training-privacy">Método de vendas compartilhado; serviços, valores, conversas e manual sempre separados por empresa. Treinar não envia WhatsApp nem cria cobranças.</p>';
  host.querySelectorAll('[data-ps-start]').forEach(b=>b.addEventListener('click',()=>run(async()=>{
   const result=await api('/api/training/interview/start','POST',{mode:b.dataset.psStart});
   state=result;transcriptText='';paint();if(result.interview.mode==='voice'){try{await beginLiveVoice();await say(result.interview.question);}catch(error){toast('Microfone indisponível: '+String(error.message||''),true);}}
  })));
  host.querySelector('#psInterviewForm')?.addEventListener('submit',ev=>{
   ev.preventDefault();const text=host.querySelector('#psInterviewAnswer')?.value||'';void submit(text);
  });
  host.querySelectorAll('[data-ps-choice]').forEach(b=>b.addEventListener('click',()=>submit(b.dataset.psChoice)));
  host.querySelector('[data-ps-reset]')?.addEventListener('click',()=>run(async()=>{
   if(!window.confirm('Recomeçar esta conversa? Seu manual aprovado será preservado.'))return;
   stopVoice();await api('/api/training/interview/reset','POST',{});
   transcriptText='';await refresh();
  }));
  host.querySelector('[data-ps-record]')?.addEventListener('click',()=>void toggleLiveVoice());
  let editingCardIndex=null;
  const dialog=host.querySelector('#psCardDialog');
  host.querySelectorAll('[data-ps-card-edit]').forEach(b=>b.addEventListener('click',()=>{
   const draft=getDraft(),cards=trainingCards(draft?.markdown),card=cards[Number(b.dataset.psCardEdit)];
   if(!card||!canEdit()||!dialog)return;
   editingCardIndex=card.index;
   dialog.querySelector('#psCardText').value=card.raw;
   dialog.showModal();
  }));
  const saveCard=async(index,newText,remove=false)=>{
   const current=getDraft(),cards=trainingCards(current?.markdown),card=cards[index];
   if(!current||!canEdit()||!card)throw Error('Orientação indisponível.');
   if(remove)cards.splice(index,1);else cards[index].raw=String(newText||'').trim()+'\n\n';
   const markdown=cards.map(item=>item.raw).join('').trim();
   if(markdown.length<20||markdown.length>22000)throw Error('O manual precisa conservar pelo menos 20 caracteres de orientações.');
   let draftId=current.id;
   if(current.status==='approved'){
    const fork=await api('/api/training/versions/'+current.id+'/fork','POST',{});
    draftId=fork.versionId;
   }
   await api('/api/training/versions/'+draftId+'/edit','POST',{markdown});
   toast(remove?'Orientação excluída do novo rascunho. Aprove o manual para aplicar.':'Orientação salva no rascunho. Aprove o manual para aplicar.');
   await refresh();
  };
  host.querySelectorAll('[data-ps-card-delete]').forEach(b=>b.addEventListener('click',()=>{
   if(!window.confirm('Excluir esta orientação do próximo manual? O manual ativo permanece intacto até aprovação.'))return;
   void run(()=>saveCard(Number(b.dataset.psCardDelete),'',true));
  }));
  host.querySelector('[data-ps-card-save]')?.addEventListener('click',()=>{
   const value=dialog?.querySelector('#psCardText')?.value||'';
   if(editingCardIndex===null)return;
   const index=editingCardIndex;
   if(dialog.open)dialog.close();
   void run(()=>saveCard(index,value));
  });
  host.querySelector('[data-ps-save]')?.addEventListener('click',()=>run(async()=>{
   const draft=getDraft();if(!draft||draft.status!=='draft')return;
   await api('/api/training/versions/'+draft.id+'/edit','POST',{markdown:host.querySelector('#psDraftMarkdown').value});
   toast('Rascunho salvo. Ainda não foi ativado.');await refresh();
  }));
  host.querySelector('[data-ps-approve]')?.addEventListener('click',()=>run(async()=>{
   const draft=getDraft();if(!draft||draft.status!=='draft')return;
   const text=host.querySelector('#psDraftMarkdown').value;
   await api('/api/training/versions/'+draft.id+'/edit','POST',{markdown:text});
   await api('/api/training/versions/'+draft.id+'/approve','POST',{});
   toast('Treinamento aprovado. As respostas automáticas permanecem sob controle do proprietário.');
   await refresh();
  }));
  const feed=host.querySelector('.ps-feed');if(feed)feed.scrollTop=feed.scrollHeight;
 }
 async function run(callback){
  if(busy)return;busy=true;
  try{await callback();}
  catch(e){toast(e.message||'Não foi possível concluir.',true);}
  finally{busy=false;}
 }
 async function submit(value){
  if(busy)return;
  const text=String(value||'').trim();
  if(!text){toast('Informe sua resposta.',true);return;}
  await run(async()=>{
   const result=await api('/api/training/interview/turn','POST',{text});
   state=result;transcriptText='';await refresh();
   if(result.interview.completed)stopVoice();else await say(result.interview.question);
  });
 }
 async function toggleRecording(){
  if(recorder?.state==='recording'){recorder.stop();return;}
  if(!window.MediaRecorder||!navigator.mediaDevices?.getUserMedia){toast('Microfone indisponível neste dispositivo. Continue pelo chat.',true);return;}
  if(busy)return;
  let current;
  try{
   stopVoice();
   stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   const mime=['audio/webm','audio/ogg','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
   if(!mime)throw Error('O navegador não oferece um formato de gravação compatível.');
   current=new MediaRecorder(stream,{mimeType:mime});recorder=current;recordChunks=[];
   current.ondataavailable=ev=>{if(ev.data?.size)recordChunks.push(ev.data);};
   current.onstop=async()=>{
    if(recordTimer)clearTimeout(recordTimer);recordTimer=null;
    const blob=new Blob(recordChunks,{type:mime});recordChunks=[];
    stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;
    if(blob.size>3*1024*1024){toast('Gravação excedeu 3 MB. Responda com uma mensagem mais curta.',true);return;}
    const status=host?.querySelector('#psVoiceStatus');if(status)status.textContent='Transcrevendo sua resposta…';
    try{
     busy=true;
     const resp=await fetch('/api/training/interview/audio',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':mime,'X-CSRF-Token':csrf},body:blob});
     const data=await resp.json();if(!resp.ok)throw Error(data.error||'Não foi possível transcrever.');
     transcriptText=String(data.text||'');
     if(host?.querySelector('#psInterviewAnswer'))host.querySelector('#psInterviewAnswer').value=transcriptText;
     if(status)status.textContent='Áudio transcrito. Revise sua resposta e clique em Enviar.';
    }catch(e){toast(e.message||'Falha no microfone.',true);if(status)status.textContent='Você pode continuar digitando.';}
    finally{busy=false;}
   };
   current.start();const b=host.querySelector('[data-ps-record]');if(b)b.textContent='■ Finalizar gravação';
   const status=host.querySelector('#psVoiceStatus');if(status)status.textContent='Ouvindo. Clique em Finalizar ou aguarde até 30 segundos.';
   recordTimer=setTimeout(()=>{if(current.state==='recording')current.stop();},30000);
  }catch(e){stopVoice();toast('Microfone indisponível: '+String(e.message||'Erro'),true);}
 }
 async function mount({root:target,api:client,toast:notify,csrf:token,user:auth}){
  stopVoice();root=target;api=client;toast=notify;csrf=token;user=auth;
  host=node('section','ps-interview-shell');host.id='socioInterview';
  const legacy=root.querySelector('.socio-training-clean');
  if(legacy){
   const details=node('details','ps-optional-training');
   const summary=node('summary','','Aprender também com o histórico do WhatsApp');
   details.append(summary);
   const help=node('p','','Esta opção analisa conversas disponíveis nos números autorizados e prepara outro rascunho para revisão.');
   details.append(help);legacy.replaceWith(details);details.append(legacy);
  }
  const toolbar=root.querySelector('.ai-guide-head');
  if(toolbar)toolbar.insertAdjacentElement('afterend',host);else root.prepend(host);
  try{await refresh();}
  catch(e){host.replaceChildren(node('p','ps-error','Não foi possível carregar o treinamento. '+(e.message||'')));}
 }
 globalThis.SocioInterviewUI={mount,dispose:stopVoice};
})();
