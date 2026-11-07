// Persistent Prospector-style floating assistant across Sócio pages.
// Only the authenticated API can read or modify the active company's resources.
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let instance=null,api=null,me=null,csrf=null,busy=false,session=null,speaking=false,
  playbackContext=null,playbackSource=null,abort=null,finalize=null,turnRunId=null,voiceRequested=false,
  voiceEpoch=0,transcriptionAbort=null,queryEpoch=0,startingVoice=false;
 const get=sel=>instance?.querySelector(sel);
 // Audio output is unlocked by the explicit microphone click using a shared
 // Web Audio context. A new Audio().play() after asynchronous STT/LLM/TTS often
 // fails browser autoplay rules even though microphone permission succeeded.
 function unlockPlayback(){
  const Native=window.AudioContext||window.webkitAudioContext;
  if(!Native)throw Error('Este navegador não oferece reprodução de áudio.');
  if(!playbackContext||playbackContext.state==='closed')playbackContext=new Native();
  // Must be called synchronously from the user's button click.
  const ready=playbackContext.resume();
  Promise.resolve(ready).catch(()=>setStatus('Toque novamente em Conversar por voz para permitir áudio.'));
 }
 function finishVoice(){
  if(abort){abort.abort();abort=null;}
  if(playbackSource){try{playbackSource.onended=null;playbackSource.stop();playbackSource.disconnect();}catch{}playbackSource=null;}
  speaking=false;finalize?.();finalize=null;
 }
 function closeVoice(){
  voiceEpoch++;queryEpoch++;startingVoice=false;
  if(transcriptionAbort){transcriptionAbort.abort();transcriptionAbort=null;}
  const activeSession=session;session=null;voiceRequested=false;
  activeSession?.stop();finishVoice();
  if(playbackContext){Promise.resolve(playbackContext.close()).catch(()=>{});playbackContext=null;}
  const btn=get('[data-thalita-voice]');if(btn)btn.textContent='◉ Conversar por voz';
  const label=get('#thalitaVoiceState');if(label)label.textContent='Voz desligada';
 }
 async function say(text,{onPlaybackStart}={}){
  if(!session||!voiceRequested||!text?.trim())return;
  finishVoice();speaking=true;setStatus('Preparando voz Thalita…');
  const controller=new AbortController();abort=controller;
  let failed=false;
  try{
   if(!playbackContext||playbackContext.state==='closed')throw Error('Saída de áudio não iniciada. Encerre e ative a voz novamente.');
   if(playbackContext.state!=='running')await playbackContext.resume();
   const resp=await fetch('/api/thalita/tts',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:JSON.stringify({text:String(text).slice(0,650)}),signal:controller.signal});
   if(!resp.ok){const j=await resp.json().catch(()=>({}));throw Error(j.error||'TTS indisponível');}
   const bytes=await resp.arrayBuffer();if(controller.signal.aborted)return;
   const buffer=await playbackContext.decodeAudioData(bytes);if(controller.signal.aborted)return;
   const source=playbackContext.createBufferSource();playbackSource=source;
   source.buffer=buffer;source.connect(playbackContext.destination);
   await new Promise((resolve,reject)=>{
    let done=false;
    const settle=()=>{if(done)return;done=true;finalize=null;resolve();};
    finalize=settle;source.onended=settle;
    try{source.start();setStatus('Thalita falando · pode interromper.');onPlaybackStart?.();}
    catch(error){settle();reject(error);}
   });
  }catch(error){
   if(!controller.signal.aborted){
    failed=true;
    setStatus('Não foi possível ouvir a Thalita: '+String(error.message||'falha').slice(0,150));
   }
  }finally{
   if(abort===controller){finishVoice();if(!failed)setStatus(session?'Microfone ativo. Pode falar.':'Voz desligada');}
  }
 }
 const meaningfulVoiceText=text=>{
  const normalized=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[!?.,]/g,'').trim();
  // STT hallucinations produced repeatedly by silence/ambient noise.
  return normalized.length>=3&&!/^(?:e ai\s*)+$|^(?:oi|ola|hum|aham|ta|ok|obrigado|e|ai|sim|nao)$/.test(normalized);
 };
 function setStatus(message){
  const label=get('#thalitaVoiceState');if(label)label.textContent=String(message);
 }
 function add(role,text){
  const feed=get('#thalitaMessages');if(!feed)return;
  const el=document.createElement('div');el.className='px-assistant-line '+(role==='user'?'user':'assistant');
  const name=document.createElement('small');name.textContent=role==='user'?'Você':'Thalita';
  const content=document.createElement('p');content.textContent=String(text||'').slice(0,4200);
  el.append(name,content);feed.append(el);feed.scrollTop=feed.scrollHeight;
 }
 async function run(text,{voiceToken=null}={}){
  const message=String(text||'').trim();if(!message||busy)return;
  if(voiceToken!==null&&(!voiceRequested||voiceEpoch!==voiceToken))return;
  const queryId=++queryEpoch;
  const isActive=()=>queryId===queryEpoch&&instance&&
   (voiceToken===null||(voiceRequested&&voiceToken===voiceEpoch));
  const input=get('#thalitaInput');if(input)input.value='';
  busy=true;get('[data-thalita-send]').disabled=true;
  add('user',message);setStatus('Consultando seus dados…');
  // A short spoken acknowledgement makes the tool lookup sound natural,
  // without manufacturing metrics or putting a long report into the TTS.
  if(session&&voiceRequested){
   const mentionMeta=/meta\s*(ads|edge|eds?)|campanh|facebook\s*ads/i.test(message);
   void say(mentionMeta?'Perfeito, vou conferir suas campanhas e os resultados.':
    'Certo, vou consultar os dados e já te explico.').catch(()=>{});
  }
  try{
   const result=await api('/api/thalita/ask','POST',{message,runId:turnRunId});
   if(!isActive())return;
   turnRunId=result.runId&&result.status==='ready'?result.runId:null;
   const answer=result.message||'Consulta concluída.';
   if(session&&voiceRequested){
    let shown=false;
    const show=()=>{if(!shown&&isActive()){shown=true;add('assistant',answer);}};
    await say(result.speechText||answer,{onPlaybackStart:show});
    show(); // If TTS is unavailable, the answer still remains readable.
   }else add('assistant',answer);
   const holder=get('#thalitaConfirm');holder.replaceChildren();
   if(result.status==='approval_required'&&result.confirmation){
    const explanation=document.createElement('p');explanation.textContent=result.confirmation.label;
    const yes=document.createElement('button');yes.type='button';yes.className='btn primary';
    yes.textContent='Confirmar alteração';
    const no=document.createElement('button');no.type='button';no.className='btn soft';no.textContent='Cancelar';
    yes.addEventListener('click',async()=>{
     if(!window.confirm('Confirmar esta alteração no sistema da sua empresa?'))return;
     yes.disabled=true;no.disabled=true;
     try{const r=await api('/api/thalita/confirm','POST',{id:result.confirmation.id,confirm:true});
      holder.replaceChildren();add('assistant',r.message||'Alteração confirmada.');}
     catch(e){add('assistant','Não foi possível concluir: '+e.message);holder.replaceChildren();}
    });
    no.addEventListener('click',()=>{holder.replaceChildren();add('assistant','Alteração cancelada.');});
    holder.append(explanation,yes,no);
   }

  }catch(e){if(isActive())add('assistant','Não foi possível concluir: '+e.message);}
  finally{
   busy=false;const btn=get('[data-thalita-send]');if(btn)btn.disabled=false;
   // Preserve an audio failure message instead of immediately overwriting it.
   if(!speaking&&!get('#thalitaVoiceState')?.textContent?.startsWith('Não foi possível ouvir'))
    setStatus(session?'Microfone ativo. Pode falar.':'Digite ou ligue a voz da Thalita.');
  }
 }
 async function startVoice(){
  // One microphone session at a time, even if a click happens during import
  // or while getUserMedia is awaiting a browser permission decision.
  if(session||startingVoice){closeVoice();return;}
  startingVoice=true;
  const startingEpoch=++voiceEpoch;
  try{unlockPlayback();}catch(error){startingVoice=false;setStatus(error.message);return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
   startingVoice=false;setStatus('Microfone indisponível neste navegador. Use o chat.');return;
  }
  try{
   const {createSocioVoiceSession}=await import('/socio-francisca-live.mjs');
   if(startingEpoch!==voiceEpoch)return;
   const newSession=createSocioVoiceSession({
    canInterrupt:()=>session===newSession&&speaking,
    onInterrupt:()=>{if(session!==newSession)return;finishVoice();setStatus('Interrompido. Estou ouvindo.');},
    onError:message=>{if(session===newSession)setStatus(message);},
    onState:next=>{
     if(session!==newSession)return;
     setStatus(({connecting:'Conectando…',listening:'Ouvindo…',hearing:'Pode continuar falando…',
      processing:'Processando sua fala…',off:'Voz desligada'})[next]||'Pronta');
     if(next==='off')closeVoice();
    },
    onTurn:async(blob,{signal}={})=>{
     const epoch=voiceEpoch;
     if(!voiceRequested||session!==newSession||signal?.aborted)return;
     if(blob.size>3*1024*1024){setStatus('Áudio muito longo; tente uma frase mais curta.');return;}
     const controller=new AbortController();
     transcriptionAbort=controller;
     if(signal?.aborted)controller.abort();
     else signal?.addEventListener('abort',()=>controller.abort(),{once:true});
     try{
      const resp=await fetch('/api/thalita/transcribe',{method:'POST',credentials:'same-origin',
       headers:{'Content-Type':blob.type.split(';')[0],'X-CSRF-Token':csrf},
       body:blob,signal:controller.signal});
      const data=await resp.json();
      if(controller.signal.aborted||epoch!==voiceEpoch||!voiceRequested||session!==newSession)return;
      if(!resp.ok)throw Error(data.error||'Transcrição indisponível');
      if(!meaningfulVoiceText(data.text)){setStatus('Não identifiquei uma solicitação clara. Pode continuar falando.');return;}
      await run(data.text,{voiceToken:epoch});
     }catch(error){
      if(!controller.signal.aborted&&epoch===voiceEpoch&&voiceRequested&&session===newSession)throw error;
     }finally{if(transcriptionAbort===controller)transcriptionAbort=null;}
    }
   });
   session=newSession;
   await newSession.start();
   if(startingEpoch!==voiceEpoch||session!==newSession||!newSession.active)return;
   startingVoice=false;voiceRequested=true;
   const btn=get('[data-thalita-voice]');if(btn)btn.textContent='■ Encerrar conversa por voz';
   setStatus('Thalita conectada. Pode falar ou digitar.');
   void say('Oi! Sou a Thalita. Estou ouvindo. Pode falar comigo.');
  }catch(e){
   if(startingEpoch===voiceEpoch){
    closeVoice();setStatus('Não foi possível usar o microfone: '+e.message);
   }
  }finally{if(startingEpoch===voiceEpoch)startingVoice=false;}
 }
 function unmount(){closeVoice();instance?.remove();instance=null;api=null;me=null;csrf=null;turnRunId=null;}
 function mount({client,auth,csrfToken}){
  if(!auth?.user||auth.tenant?.features?.ai===false){unmount();return;}
  if(instance){
   if(me?.tenant?.id!==auth?.tenant?.id){unmount();}
   else{api=client;me=auth;csrf=csrfToken;return;}
  }
  api=client;me=auth;csrf=csrfToken;
  instance=document.createElement('div');instance.id='socioThalitaDock';instance.className='px-assistant-dock';
  instance.innerHTML='<button class="px-assistant-fab" type="button" data-thalita-toggle aria-label="Abrir conversa com Thalita" aria-expanded="false">'+
   '<span class="px-assistant-sigil">✳</span><span>Thalita</span></button>'+
   '<section class="px-assistant-window hidden" aria-label="Assistente Thalita" role="dialog" aria-modal="false">'+
    '<header><span class="px-assistant-avatar">✳</span><div><strong>Thalita</strong><small>Assistente da sua empresa</small></div>'+
    '<button class="px-assistant-close" type="button" data-thalita-close aria-label="Fechar Thalita">×</button></header>'+
    '<div class="px-assistant-feed" id="thalitaMessages" role="log" aria-live="polite">'+
     '<div class="px-assistant-line assistant"><small>Thalita</small><p>Oi! Posso consultar indicadores, explicar resultados e preparar ações para você aprovar. O que precisa?</p></div></div>'+
    '<div class="px-assistant-suggestions" role="group" aria-label="Perguntas rápidas">'+
     '<button type="button" data-thalita-suggest="Me mostre os indicadores e mensagens de hoje.">Resumo de hoje</button>'+
     '<button type="button" data-thalita-suggest="Quais produtos e estoques temos cadastrados?">Produtos</button>'+
     '<button type="button" data-thalita-suggest="Quantos WhatsApps conectados e conversas em aberto temos?">WhatsApp</button>'+
     '<button type="button" data-thalita-suggest="Qual foi o gasto e CPC da Meta Ads hoje?">Meta Ads</button>'+
     '<button type="button" data-thalita-suggest="Como estão as campanhas Google Ads hoje?">Google Ads</button>'+
    '</div>'+
    '<div class="px-assistant-approval" id="thalitaConfirm"></div>'+
    '<form id="thalitaForm"><label for="thalitaInput" class="ps-sr-only">Fale com Thalita</label>'+
     '<textarea id="thalitaInput" maxlength="1400" rows="2" placeholder="Pergunte ou peça uma ação…" required></textarea>'+
     '<div class="px-assistant-actions"><button type="button" class="btn soft" data-thalita-voice>◉ Conversar por voz</button>'+
     '<button type="submit" class="btn primary" data-thalita-send>Enviar</button></div>'+
     '<div id="thalitaVoiceState" class="px-assistant-hint" role="status">Digite ou ligue a voz da Thalita.</div></form>'+
    '<p class="px-assistant-disclaimer">Ações exigem autorização e confirmação. Nenhum pagamento ou anúncio é criado silenciosamente.</p></section>';
  document.body.append(instance);
  const panel=get('.px-assistant-window'),fab=get('[data-thalita-toggle]');
  function show(open){if(!open)closeVoice();panel.classList.toggle('hidden',!open);fab.setAttribute('aria-expanded',String(open));if(open)get('#thalitaInput')?.focus();}
  fab.addEventListener('click',()=>show(panel.classList.contains('hidden')));
  get('[data-thalita-close]').addEventListener('click',()=>show(false));
  get('#thalitaForm').addEventListener('submit',ev=>{ev.preventDefault();run(get('#thalitaInput')?.value);});
  get('#thalitaInput').addEventListener('keydown',ev=>{
   if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();run(ev.currentTarget.value);}
  });
  instance.querySelectorAll('[data-thalita-suggest]').forEach(button=>button.addEventListener('click',()=>run(button.dataset.thalitaSuggest)));
  get('[data-thalita-voice]').addEventListener('click',startVoice);
 }
 globalThis.SocioThalitaUI={mount,unmount};
})();
