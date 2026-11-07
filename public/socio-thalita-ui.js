// Persistent Prospector-style floating assistant across Sócio pages.
// Only the authenticated API can read or modify the active company's resources.
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let instance=null,api=null,me=null,csrf=null,busy=false,session=null,speaking=false,
  audio=null,voiceUrl=null,abort=null,finalize=null,turnRunId=null,voiceRequested=false;
 const get=sel=>instance?.querySelector(sel);
 function finishVoice(){
  if(abort){abort.abort();abort=null;}
  if(audio){try{audio.pause();audio.removeAttribute('src');audio.load();}catch{}audio=null;}
  if(voiceUrl){URL.revokeObjectURL(voiceUrl);voiceUrl=null;}
  speaking=false;finalize?.();finalize=null;
 }
 function closeVoice(){
  session?.stop();session=null;finishVoice();
  const btn=get('[data-thalita-voice]');if(btn)btn.textContent='◉ Conversar por voz';
  const label=get('#thalitaVoiceState');if(label)label.textContent='Voz desligada';
 }
 async function say(text){
  if(!session||!voiceRequested||!text?.trim())return;
  finishVoice();speaking=true;setStatus('Thalita está falando; pode interromper.');
  const controller=new AbortController();abort=controller;
  try{
   const resp=await fetch('/api/thalita/tts',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:JSON.stringify({text:String(text).slice(0,650)}),signal:controller.signal});
   if(!resp.ok){const j=await resp.json().catch(()=>({}));throw Error(j.error||'TTS indisponível');}
   const blob=await resp.blob();if(controller.signal.aborted)return;
   voiceUrl=URL.createObjectURL(blob);audio=new Audio(voiceUrl);
   await new Promise((resolve,reject)=>{
    let done=false;const settle=()=>{if(done)return;done=true;finalize=null;resolve();};
    finalize=settle;audio.onended=settle;audio.onerror=()=>{settle();reject(Error('Não foi possível reproduzir o áudio.'));};
    audio.play().catch(e=>{settle();reject(e);});
   });
  }catch(e){if(!controller.signal.aborted)setStatus('Áudio indisponível; você pode continuar pelo chat.');}
  finally{if(abort===controller)finishVoice();}
 }
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
 async function run(text){
  const message=String(text||'').trim();if(!message||busy)return;
  const input=get('#thalitaInput');if(input)input.value='';
  busy=true;get('[data-thalita-send]').disabled=true;add('user',message);setStatus('Consultando o Sócio…');
  try{
   const result=await api('/api/thalita/ask','POST',{message,runId:turnRunId});
   turnRunId=result.runId&&result.status==='ready'?result.runId:null;
   add('assistant',result.message||'Consulta concluída.');
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
   if(session&&voiceRequested)await say(result.message||'Consulta concluída.');
  }catch(e){add('assistant','Não foi possível concluir: '+e.message);}
  finally{
   busy=false;const btn=get('[data-thalita-send]');if(btn)btn.disabled=false;
   if(!speaking)setStatus(session?'Microfone ativo. Pode falar.':'Digite ou ligue a voz da Thalita.');
  }
 }
 async function startVoice(){
  if(session){closeVoice();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
   setStatus('Microfone indisponível neste navegador. Use o chat.');return;
  }
  try{
   const {createSocioVoiceSession}=await import('/socio-francisca-live.mjs');
   session=createSocioVoiceSession({
    canInterrupt:()=>speaking,
    onInterrupt:()=>{finishVoice();setStatus('Interrompido. Estou ouvindo.');},
    onError:message=>setStatus(message),
    onState:next=>setStatus(({connecting:'Conectando…',listening:'Ouvindo…',hearing:'Pode continuar falando…',
      processing:'Processando sua fala…',off:'Voz desligada'})[next]||'Pronta'),
    onTurn:async blob=>{
     if(blob.size>3*1024*1024){setStatus('Áudio muito longo; tente uma frase mais curta.');return;}
     const resp=await fetch('/api/thalita/transcribe',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':blob.type.split(';')[0],'X-CSRF-Token':csrf},body:blob});
     const data=await resp.json();if(!resp.ok)throw Error(data.error||'Transcrição indisponível');
     await run(data.text||'');
    }
   });
   await session.start();voiceRequested=true;
   const btn=get('[data-thalita-voice]');if(btn)btn.textContent='■ Encerrar conversa por voz';
   setStatus('Thalita conectada. Pode falar ou digitar.');
  }catch(e){closeVoice();setStatus('Não foi possível usar o microfone: '+e.message);}
 }
 function unmount(){closeVoice();instance?.remove();instance=null;api=null;me=null;csrf=null;turnRunId=null;}
 function mount({client,auth,csrfToken}){
  if(!auth?.user||!(auth.user.permissions||[]).includes('inbox.read')){unmount();return;}
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
    '<div class="px-assistant-approval" id="thalitaConfirm"></div>'+
    '<form id="thalitaForm"><label for="thalitaInput" class="ps-sr-only">Fale com Thalita</label>'+
     '<textarea id="thalitaInput" maxlength="1400" rows="2" placeholder="Pergunte ou peça uma ação…" required></textarea>'+
     '<div class="px-assistant-actions"><button type="button" class="btn soft" data-thalita-voice>◉ Conversar por voz</button>'+
     '<button type="submit" class="btn primary" data-thalita-send>Enviar</button></div>'+
     '<div id="thalitaVoiceState" class="px-assistant-hint" role="status">Digite ou ligue a voz da Thalita.</div></form>'+
    '<p class="px-assistant-disclaimer">Ações exigem autorização e confirmação. Nenhum pagamento ou anúncio é criado silenciosamente.</p></section>';
  document.body.append(instance);
  const panel=get('.px-assistant-window'),fab=get('[data-thalita-toggle]');
  function show(open){panel.classList.toggle('hidden',!open);fab.setAttribute('aria-expanded',String(open));if(open)get('#thalitaInput')?.focus();}
  fab.addEventListener('click',()=>show(panel.classList.contains('hidden')));
  get('[data-thalita-close]').addEventListener('click',()=>{show(false);closeVoice();});
  get('#thalitaForm').addEventListener('submit',ev=>{ev.preventDefault();run(get('#thalitaInput')?.value);});
  get('#thalitaInput').addEventListener('keydown',ev=>{
   if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();run(ev.currentTarget.value);}
  });
  get('[data-thalita-voice]').addEventListener('click',startVoice);
 }
 globalThis.SocioThalitaUI={mount,unmount};
})();
