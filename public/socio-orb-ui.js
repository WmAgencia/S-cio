// "Conversar com IA": a blank canvas with a living orb. The orb is driven by
// the amplitude of the assistant's own voice (Web Audio analyser), answers in
// real time through the tenant's authenticated assistant endpoint, and shows
// each step of a plan only after that step actually completed.
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let instance=null,api=null,csrf=null,navigate=null;
 let voice=null,startingVoice=false,voiceRequested=false,voiceEpoch=0;
 let audioContext=null,analyser=null,freq=null,raf=0,amp=0,level=0;
 let speaking=false,ttsAbort=null,queryAbort=null,runId=null,runEpoch=0;
 let history=[],media=null,busy=false,disposed=false;
 const get=sel=>instance?.querySelector(sel);
 const stage=()=>get('#orbStage');
 const statusText=message=>{const el=get('#orbStatus');if(el)el.textContent=String(message)};
 const setPhase=phase=>{
  const page=get('.orb-page');if(!page)return;
  page.classList.remove('is-idle','is-listening','is-thinking','is-speaking','is-swallowing');
  if(phase)page.classList.add('is-'+phase);
 };
 function unlockAudio(){
  const Native=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Native)throw Error('Este navegador não oferece reprodução de áudio.');
  if(!audioContext||audioContext.state==='closed')audioContext=new Native();
  analyser=audioContext.createAnalyser();
  analyser.fftSize=1024;analyser.smoothingTimeConstant=.65;
  analyser.connect(audioContext.destination);
  freq=new Uint8Array(analyser.frequencyBinCount);
  return audioContext.resume();
 }
 function startLevelLoop(){
  cancelAnimationFrame(raf);
  const tick=()=>{
   if(disposed){return;}
   let raw=0;
   if(analyser&&freq){
    analyser.getByteFrequencyData(freq);
    let sum=0,count=0;
    // Speech energy lives mostly under ~1.5 kHz; ignore the noisy top end.
    for(let i=1;i<Math.min(freq.length,64);i++){sum+=freq[i];count++;}
    raw=count?sum/(count*255):0;
   }
   level+=(raw-level)*(raw>level?.42:.09);
   const target=Math.min(1,level*1.55);
   amp+=(target-amp)*.32;
   const s=stage();
   if(s){
    s.style.setProperty('--orb-amp',amp.toFixed(3));
    s.style.setProperty('--orb-scale',(1+amp*.34).toFixed(3));
    s.style.setProperty('--orb-glow',(26+amp*54).toFixed(1)+'px');
    s.style.setProperty('--orb-spin',(1-amp*.45).toFixed(3));
   }
   raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);
 }
 function stopLevelLoop(){cancelAnimationFrame(raf);raf=0;level=0;amp=0;
  const s=stage();if(s){s.style.setProperty('--orb-amp','0');s.style.setProperty('--orb-scale','1');s.style.setProperty('--orb-glow','26px');s.style.setProperty('--orb-spin','1');}
 }
 // ---------------------------------------------------------------- speaking
 function chunkText(text){
  const clean=String(text||'').replace(/\s+/g,' ').trim();
  if(!clean)return [];
  const sentences=clean.match(/[^.!?…]+[.!?…]*/g)||[clean];
  const parts=[];let current='';
  for(const sentence of sentences){
   if((current+' '+sentence).trim().length>190&&current){parts.push(current.trim());current=sentence;}
   else current+=' '+sentence;
  }
  if(current.trim())parts.push(current.trim());
  return parts.slice(0,4);
 }
 async function fetchVoice(part,signal){
  const resp=await fetch('/api/thalita/tts',{method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
   body:JSON.stringify({text:String(part).slice(0,650)}),signal});
  if(!resp.ok){const data=await resp.json().catch(()=>({}));throw Error(data.error||'Voz indisponível');}
  return resp.arrayBuffer();
 }
 function playBuffer(buffer){
  return new Promise((resolve,reject)=>{
   if(!audioContext||audioContext.state==='closed')return reject(Error('Áudio encerrado.'));
   const source=audioContext.createBufferSource();
   source.buffer=buffer;source.connect(analyser);
   source.onended=()=>{try{source.disconnect();}catch{}resolve();};
   try{source.start();}catch(error){reject(error);}
  });
 }
 function stopSpeech(){
  if(ttsAbort){ttsAbort.abort();ttsAbort=null;}
  speaking=false;stopLevelLoop();
  if(get('.orb-page')?.classList.contains('is-speaking'))setPhase(voice?'listening':'idle');
 }
 async function speak(text){
  const parts=chunkText(text);
  if(!parts.length||!audioContext||audioContext.state==='closed')return;
  stopSpeech();
  const controller=new AbortController();ttsAbort=controller;
  speaking=true;setPhase('speaking');statusText('Falando');
  try{
   if(audioContext.state!=='running')await audioContext.resume();
   let pending=fetchVoice(parts[0],controller.signal);
   for(let i=0;i<parts.length;i++){
    const bytes=await pending;pending=null;
    if(controller.signal.aborted)return;
    if(i+1<parts.length)pending=fetchVoice(parts[i+1],controller.signal).catch(()=>null);
    const buffer=await audioContext.decodeAudioData(bytes.slice(0));
    if(controller.signal.aborted)return;
    startLevelLoop();
    await playBuffer(buffer);
    if(controller.signal.aborted)return;
   }
  }catch(error){
   if(!controller.signal.aborted)statusText('Voz indisponível · resposta por texto');
  }finally{
   if(ttsAbort===controller){
    ttsAbort=null;speaking=false;stopLevelLoop();
    if(get('.orb-page'))setPhase(voice?'listening':'idle');
    statusText(voice?'Ouvindo':'Pronto');
   }
  }
 }
 // ------------------------------------------------------------------ caption
 function showCaption(text,role='assistant'){
  const box=get('#orbTranscript');if(!box)return;
  const line=document.createElement('p');
  line.className='orb-line '+role;
  line.textContent=String(text||'').slice(0,1200);
  box.replaceChildren(line);
  requestAnimationFrame(()=>line.classList.add('in'));
  box.scrollTop=box.scrollHeight;
 }
 // ---------------------------------------------------------------- plan cards
 function planReset(title){
  const panel=get('#orbPlanPanel'),list=get('#orbSteps');
  if(!panel||!list)return null;
  panel.hidden=false;panel.classList.add('visible');
  const heading=get('#orbPlanTitle');if(heading)heading.textContent=title||'Executando seu pedido';
  list.replaceChildren();
  return list;
 }
 function planAdd(list,title,{detail='',status='pending'}={}){
  const li=document.createElement('li');
  li.className='orb-step';
  li.dataset.status=status;
  li.style.setProperty('--i',String(list.children.length));
  li.innerHTML='<span class="orb-step-mark" aria-hidden="true"></span>'+
   '<div class="orb-step-body"><strong>'+esc(title)+'</strong><small>'+esc(detail)+'</small></div>';
  list.append(li);
  return li;
 }
 function planUpdate(li,status,detail){
  if(!li)return;
  li.dataset.status=status;
  if(detail!==undefined){const small=li.querySelector('small');if(small)small.textContent=String(detail);}
  const list=li.parentElement;
  if(list){const done=[...list.children].filter(x=>x.dataset.status==='done'||x.dataset.status==='error').length;
   const counter=get('#orbPlanCount');if(counter)counter.textContent=done+'/'+list.children.length;}
 }
 function planHide(){
  const panel=get('#orbPlanPanel');if(!panel)return;
  window.setTimeout(()=>{panel.classList.remove('visible');panel.hidden=true;},260);
 }
 // ------------------------------------------------------------------- media
 function mediaCard(li,file,status,detail){
  if(!li)return;
  const label=file.seoName||file.name||'mídia';
  const kind=file.kind==='image'?'foto':'vídeo';
  planUpdate(li,status,detail);
  const body=li.querySelector('strong');
  if(body&&li.dataset.titled!=='1'){body.textContent=kind==='foto'?'Foto recebida':'Vídeo recebido';li.dataset.titled='1';}
  const chip=get('#orbMediaChip');
  if(chip){
   chip.hidden=false;chip.textContent=(kind==='foto'?'🖼 ':'🎬 ')+label;
   chip.classList.toggle('ready',status==='done');
  }
 }
 function swallow(file,dropEvent){
  const s=stage();if(!s)return;
  const page=get('.orb-page');page?.classList.add('is-swallowing');
  let fly=document.createElement('div');
  fly.className='orb-media-fly';
  if(file.kind==='image'){
   const img=document.createElement('img');img.alt='';img.src=file.preview;fly.append(img);
  }else{
   const video=document.createElement('video');
   video.playsInline=true;video.muted=true;video.preload='metadata';video.src=file.preview;
   fly.append(video);
   video.addEventListener('loadeddata',()=>{try{video.currentTime=.1;}catch{}},{once:true});
  }
  s.append(fly);
  const box=s.getBoundingClientRect();
  const startX=dropEvent?.clientX??box.left+box.width/2;
  const startY=dropEvent?.clientY??box.top+box.height/2;
  const core=s.querySelector('.orb-field')?.getBoundingClientRect();
  const endX=core?core.left+core.width/2:box.left+box.width/2;
  const endY=core?core.top+core.height/2:box.top+box.height/2;
  const size=148;
  fly.style.left=(startX-box.left-size/2)+'px';
  fly.style.top=(startY-box.top-size/2)+'px';
  const dx=endX-startX,dy=endY-startY;
  const anim=fly.animate([
   {transform:'translate(0,0) scale(1) rotate(0deg)',opacity:1,filter:'blur(0)'},
   {transform:'translate('+dx*.35+'px,'+dy*.35+'px) scale(.72) rotate(-6deg)',opacity:.94,offset:.4},
   {transform:'translate('+dx+'px,'+dy+'px) scale(.06) rotate(18deg)',opacity:0,filter:'blur(6px)'}
  ],{duration:700,easing:'cubic-bezier(.6,.02,.3,1)',fill:'forwards'});
  anim.onfinish=()=>{fly.remove();fly=null;};
  window.setTimeout(()=>page?.classList.remove('is-swallowing'),760);
 }
 async function uploadMedia(file){
  media=file;
  const list=get('#orbSteps');
  if(!list)return;
  const li=planAdd(list,file.kind==='image'?'Enviando foto para a biblioteca':'Enviando vídeo para a biblioteca',
   {status:'running',detail:'Validando arquivo…'});
  mediaCard(li,file,'running','Validando arquivo…');
  try{
   if(file.kind==='image'){
    if(file.size>3*1024*1024)throw Error('Fotos acima de 3 MB não podem ser enviadas pela orbe.');
    const base64=await fileToBase64(file.raw);
    const result=await api('/api/marketing/tools/image','POST',{contentBase64:base64});
    file.meta={imageHash:result.hash};
    mediaCard(li,file,'done','Foto publicada na biblioteca da Meta · '+sizeLabel(file.size));
    statusText('Foto recebida');
   }else{
    if(file.size>90*1024*1024)throw Error('Vídeos acima de 90 MB não podem ser enviados pela orbe.');
    if(file.size<512)throw Error('O arquivo parece vazio ou corrompido.');
    mediaCard(li,file,'running','Reservando espaço na biblioteca…');
    const reserved=await api('/api/ads-media/reserve','POST',{filename:file.raw.name||'video.mp4'});
    mediaCard(li,file,'running','Enviando '+sizeLabel(file.size)+'…');
    const resp=await fetch('/api/ads-media/'+reserved.id+'/upload',{method:'POST',credentials:'same-origin',
     headers:{'X-CSRF-Token':csrf,
      'Content-Type':/\.mov$/i.test(file.raw.name)?'video/quicktime':'video/mp4'},
     body:file.raw});
    const answer=await resp.json().catch(()=>({}));
    if(!resp.ok)throw Error(answer.error||'Falha no envio do vídeo.');
    file.meta={mediaId:reserved.id};
    mediaCard(li,file,'done','Vídeo guardado na biblioteca da empresa · '+sizeLabel(file.size));
    statusText('Vídeo recebido');
   }
  }catch(error){
   mediaCard(li,file,'error',String(error.message||'Não foi possível enviar a mídia.').slice(0,160));
   statusText('Falha ao receber a mídia');
   media=null;
  }
 }
 const sizeLabel=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1).replace('.',',')+' MB':
  Math.max(1,Math.round(bytes/1024))+' KB';
 function fileToBase64(raw){
  return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>{const value=String(reader.result||'');resolve(value.slice(value.indexOf(',')+1));};
   reader.onerror=()=>reject(Error('Não consegui ler a foto.'));
   reader.readAsDataURL(raw);
  });
 }
 function acceptFile(raw,event){
  if(!raw)return;
  const image=/^image\/(png|jpe?g|webp)$/i.test(raw.type)||/\.(png|jpe?g|webp)$/i.test(raw.name||'');
  const video=/^video\/(mp4|quicktime)$/i.test(raw.type)||/\.(mp4|mov)$/i.test(raw.name||'');
  if(!image&&!video){
   statusText('Envie um vídeo MP4/MOV ou uma foto JPG/PNG/WebP');
   return;
  }
  if(busy){statusText('Aguarde o pedido atual terminar');return;}
  const file={raw,kind:image?'image':'video',name:raw.name||'mídia',
   preview:URL.createObjectURL(raw),size:raw.size};
  swallow(file,event);
  void uploadMedia(file);
  if(!voiceRequested)statusText('Mídia recebida · agora fale ou escreva a instrução');
 }
 // ------------------------------------------------------------------- turns
 function mediaNote(){
  if(!media)return '';
  if(media.kind==='image')return '\n[O usuário anexou a foto "'+media.name+'" na biblioteca da Meta da empresa.]';
  return '\n[O usuário anexou o vídeo "'+media.name+'" na biblioteca de mídia da empresa.]';
 }
 function confirmCard(list,confirmation,answer){
  const li=planAdd(list,'Aguardando sua confirmação',{status:'waiting',detail:confirmation.label||''});
  const actions=document.createElement('div');
  actions.className='orb-step-actions';
  const yes=document.createElement('button');yes.type='button';yes.className='orb-btn primary';yes.textContent='Confirmar';
  const no=document.createElement('button');no.type='button';no.className='orb-btn soft';no.textContent='Cancelar';
  yes.addEventListener('click',async()=>{
   yes.disabled=true;no.disabled=true;
   planUpdate(li,'running','Aplicando a alteração autorizada…');
   try{
    const result=await api('/api/thalita/confirm','POST',{id:confirmation.id,confirm:true});
    planUpdate(li,'done',result.message||'Alteração aplicada.'.slice(0,160));
    showCaption(result.message||answer);void speak(result.message||answer);
   }catch(error){
    planUpdate(li,'error',String(error.message||'Não foi possível concluir.').slice(0,160));
   }
  });
  no.addEventListener('click',()=>{planUpdate(li,'done','Alteração descartada. Nenhum dado foi modificado.');});
  actions.append(yes,no);
  li.querySelector('.orb-step-body')?.append(actions);
  li.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 async function runTurn(text,{fromVoice=false}={}){
  const message=String(text||'').trim();
  if(!message||busy)return;
  const epoch=++runEpoch;
  const isActive=()=>!disposed&&epoch===runEpoch;
  busy=true;
  const input=get('#orbInput');if(input)input.value='';
  if(!fromVoice)showCaption(message,'user');
  const list=planReset(media?(media.kind==='image'?'Foto em uso · preparando seu pedido':'Vídeo em uso · preparando seu pedido'):'Executando seu pedido');
  const interpret=planAdd(list,media?'Interpretando sua instrução':'Entendendo seu pedido',{status:'running',detail:'Lendo o pedido…'});
  const query=planAdd(list,'Consultando os dados da empresa',{status:'pending'});
  const deliver=planAdd(list,'Preparando a resposta',{status:'pending'});
  setPhase('thinking');statusText('Pensando');
  const controller=new AbortController();queryAbort=controller;
  try{
   await pause(160);
   planUpdate(interpret,'done',media?'Instrução entendida · mídia anexada':'Pedido entendido');
   planUpdate(query,'running','Consultando registros autorizados…');
   const result=await api('/api/thalita/ask','POST',{
    message:message+mediaNote(),runId,history:history.slice(-6)
   },{},{signal:controller.signal});
   if(!isActive())return;
   runId=result.runId&&result.status==='ready'?result.runId:null;
   const answer=String(result.message||'Consulta concluída.');
   planUpdate(query,'done',queryDetail(result));
   planUpdate(deliver,'running','Montando a resposta…');
   history.push({role:'user',text:message.slice(0,350)},{role:'assistant',text:answer.slice(0,350)});
   if(history.length>10)history=history.slice(-10);
   await pause(180);
   planUpdate(deliver,result.status==='approval_required'?'waiting':'done',
    result.status==='approval_required'?'Ação precisa da sua confirmação':'Resposta pronta');
   showCaption(answer);
   if(result.status==='approval_required'&&result.confirmation)confirmCard(list,result.confirmation,answer);
   const spoken=String(result.speechText||answer);
   if(audioContext&&audioContext.state!=='closed')void speak(spoken);
   else statusText('Resposta pronta');
  }catch(error){
   if(!isActive())return;
   planUpdate(query,'error',String(error.message||'Falha ao consultar.').slice(0,160));
   showCaption('Não foi possível concluir: '+String(error.message||'erro inesperado'));
   statusText('Não foi possível concluir');
  }finally{
   if(queryAbort===controller)queryAbort=null;
   if(epoch===runEpoch){busy=false;if(!speaking)setPhase(voiceRequested?'listening':'idle');}
  }
 }
 function queryDetail(result){
  if(result.status==='approval_required')return 'Dados conferidos · alteração pronta para revisão';
  if(result.status==='needs_details')return 'Preciso de mais alguns dados';
  if(result.status==='unavailable')return 'Consulta indisponível agora';
  if(Array.isArray(result.data?.products))return result.data.products.length+' produto(s) consultados';
  return 'Dados atualizados';
 }
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 // -------------------------------------------------------------------- voice
 function stopVoice(){
  voiceEpoch++;voiceRequested=false;startingVoice=false;
  const current=voice;voice=null;
  try{current?.stop();}catch{}
  stopSpeech();
  const mic=get('[data-orb-mic]');
  if(mic){mic.classList.remove('on');mic.setAttribute('aria-pressed','false');}
  setPhase('idle');statusText('Voz desligada');
 }
 async function startVoice(){
  if(startingVoice){stopVoice();return;}
  startingVoice=true;voiceEpoch++;const epoch=voiceEpoch;
  try{
   await unlockAudio();
   startLevelLoop();
  }catch(error){startingVoice=false;statusText(error.message);return;}
  if(!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder){
   startingVoice=false;statusText('Microfone indisponível neste navegador · use o texto');return;
  }
  try{
   const [{createSocioVoiceSession},{newSemanticTurnBuffer}]=await Promise.all([
    import('/socio-francisca-live.mjs'),import('/socio-semantic-turn.mjs')
   ]);
   if(epoch!==voiceEpoch)return;
   const semantic=newSemanticTurnBuffer({maxWaitMs:16000,maxParts:3,maxChars:950});
   const session=createSocioVoiceSession({
    canInterrupt:()=>speaking,
    onInterrupt:()=>{stopSpeech();statusText('Interrompido · estou ouvindo');},
    onError:message=>{if(voice===session)statusText(message);},
    onState:next=>{
     if(voice!==session)return;
     if(next==='off'){stopVoice();return;}
     if(!speaking)setPhase(next==='listening'||next==='hearing'?'listening':'thinking');
     statusText(({connecting:'Conectando…',listening:'Ouvindo',hearing:'Pode continuar falando…',
      processing:'Processando sua fala…',off:'Voz desligada'})[next]||'Ouvindo');
    },
    onTurn:async(blob,{signal}={})=>{
     const turnEpoch=voiceEpoch;
     if(!voiceRequested||voice!==session||signal?.aborted)return;
     if(blob.size>3*1024*1024){statusText('Fala longa demais · tente uma frase mais curta');return;}
     setPhase('thinking');statusText('Transcrevendo');
     const resp=await fetch('/api/thalita/transcribe',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':blob.type.split(';')[0],'X-CSRF-Token':csrf},body:blob,signal});
     const data=await resp.json().catch(()=>({}));
     if(!resp.ok)throw Error(data.error||'Transcrição indisponível');
     if(signal?.aborted||turnEpoch!==voiceEpoch||!voiceRequested||voice!==session)return;
     const text=String(data.text||'').trim();
     if(!meaningful(text)){statusText('Não entendi · pode repetir?');setPhase('listening');return;}
     const assessed=semantic.take(text)||{hold:false,text};
     if(assessed.hold){statusText('Pode continuar falando…');setPhase('listening');return;}
     await runTurn(assessed.text,{fromVoice:true});
    }
   });
   voice=session;
   await session.start();
   if(epoch!==voiceEpoch||voice!==session||!session.active)return;
   startingVoice=false;voiceRequested=true;
   const mic=get('[data-orb-mic]');
   if(mic){mic.classList.add('on');mic.setAttribute('aria-pressed','true');}
   setPhase('listening');statusText('Ouvindo');
   if(audioContext&&audioContext.state!=='closed')void speak('Oi! Pode falar. Arraste um vídeo ou foto para cá quando quiser.');
  }catch(error){
   if(epoch===voiceEpoch){stopVoice();statusText('Não foi possível usar o microfone: '+String(error.message||'').slice(0,120));}
  }finally{if(epoch===voiceEpoch)startingVoice=false;}
 }
 function meaningful(text){
  const normalized=String(text||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[!?.,]/g,'').trim();
  return normalized.length>=3&&!/^(?:e ai\s*)+$|^(?:oi|ola|hum|aham|ta|ok|obrigado|e|ai|sim|nao)$/.test(normalized);
 }
 // ------------------------------------------------------------ orb renderer
 // The dotted-mesh renderer lives in /socio-orb-mesh.js so the orb page and
 // the dashboard entry draw the exact same object.
 function createOrbRenderer(canvas){
  return globalThis.SocioOrbMesh?.create(canvas,{amp:ampNow,light:true})??null;
 }
 let orbRenderer=null;
 const ampNow=()=>amp;
 // -------------------------------------------------------------------- mount
 function wire(){
  get('[data-orb-back]')?.addEventListener('click',()=>navigate?.('overview'));
  get('[data-orb-mic]')?.addEventListener('click',startVoice);
  get('[data-orb-attach]')?.addEventListener('click',()=>get('#orbFile')?.click());
  get('#orbFile')?.addEventListener('change',event=>{
   const raw=event.currentTarget.files?.[0];
   event.currentTarget.value='';
   acceptFile(raw,null);
  });
  get('#orbForm')?.addEventListener('submit',event=>{
   event.preventDefault();
   const value=get('#orbInput')?.value?.trim();
   if(value)void runTurn(value);
  });
  const s=stage();
  if(!s)return;
  let dragDepth=0;
  s.addEventListener('dragenter',event=>{
   if(!event.dataTransfer)return;
   event.preventDefault();dragDepth++;
   get('.orb-page')?.classList.add('is-dragging');
  });
  s.addEventListener('dragover',event=>{
   if(!event.dataTransfer)return;
   event.preventDefault();event.dataTransfer.dropEffect='copy';
  });
  s.addEventListener('dragleave',()=>{
   dragDepth=Math.max(0,dragDepth-1);
   if(!dragDepth)get('.orb-page')?.classList.remove('is-dragging');
  });
  s.addEventListener('drop',event=>{
   event.preventDefault();dragDepth=0;
   get('.orb-page')?.classList.remove('is-dragging');
   const raw=event.dataTransfer?.files?.[0];
   acceptFile(raw,event);
  });
  s.addEventListener('click',event=>{
   if(event.target.closest('button,input,.orb-composer'))return;
   if(!voiceRequested)startVoice();
  });
 }
 function dispose(){
  disposed=true;
  if(queryAbort){queryAbort.abort();queryAbort=null;}
  stopVoice();
  media?.preview&&URL.revokeObjectURL(media.preview);
  media=null;
  orbRenderer?.stop();orbRenderer=null;
  cancelAnimationFrame(raf);raf=0;
  if(audioContext&&audioContext.state!=='closed')Promise.resolve(audioContext.close()).catch(()=>{});
  audioContext=null;analyser=null;freq=null;
  instance?.remove();instance=null;api=null;csrf=null;navigate=null;
  history=[];runId=null;busy=false;
 }
 function render({root,api:client,csrfToken,navigate:go}){
  dispose();disposed=false;
  api=client;csrf=csrfToken;navigate=go;
  root.innerHTML='<div class="orb-page is-idle" data-orb>'+
   '<header class="orb-top">'+
    '<button class="orb-back" type="button" data-orb-back><span aria-hidden="true">←</span> Visão geral</button>'+
    '<span class="orb-status" id="orbStatus" role="status" aria-live="polite">Pronto</span>'+
    '<button class="orb-mic-btn" type="button" data-orb-mic aria-pressed="false" aria-label="Ativar microfone e conversar por voz">'+
     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">'+
      '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>'+
     '<span>Falar</span></button>'+
   '</header>'+
   '<div class="orb-stage" id="orbStage">'+
    '<div class="orb-field" aria-hidden="true">'+
     '<span class="orb-aura"></span>'+
     '<canvas class="orb-canvas" id="orbCanvas"></canvas>'+
    '</div>'+
    '<div class="orb-transcript" id="orbTranscript" aria-live="polite">'+
     '<p class="orb-line assistant in">Arraste um vídeo ou foto para dentro da orbe e diga o que fazer. Eu executo e mostro cada passo.</p>'+
    '</div>'+
    '<p class="orb-drop-hint" aria-hidden="true">Solte para a orbe engolir</p>'+
    '<p class="orb-media-chip" id="orbMediaChip" hidden></p>'+
    '<input type="file" id="orbFile" accept="video/mp4,video/quicktime,image/png,image/jpeg,image/webp" hidden>'+
   '</div>'+
   '<aside class="orb-plan-panel" id="orbPlanPanel" aria-label="Plano em execução" hidden>'+
    '<header><div><span class="orb-plan-eyebrow">PLANO</span><strong id="orbPlanTitle">Executando seu pedido</strong></div>'+
     '<small id="orbPlanCount"></small></header>'+
    '<ol class="orb-steps" id="orbSteps"></ol>'+
   '</aside>'+
   '<form class="orb-composer" id="orbForm" autocomplete="off">'+
    '<button class="orb-attach" type="button" data-orb-attach aria-label="Anexar vídeo ou foto">'+
     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">'+
      '<path d="M12 5v14M5 12h14"/></svg></button>'+
    '<label class="ps-sr-only" for="orbInput">Mensagem para a IA</label>'+
    '<input id="orbInput" type="text" maxlength="900" placeholder="Fale ou escreva o que você precisa…">'+
    '<button class="orb-send" type="submit" aria-label="Enviar pedido">'+
     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
      '<path d="M12 19V5M6 11l6-6 6 6"/></svg></button>'+
   '</form>'+
  '</div>';
  instance=root.querySelector('[data-orb]');
  orbRenderer=createOrbRenderer(get('#orbCanvas'));
  wire();
  startLevelLoop();
  get('#orbInput')?.focus({preventScroll:true});
 }
 globalThis.SocioOrbUI={render,dispose};
})();
