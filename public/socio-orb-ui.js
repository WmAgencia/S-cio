// "Conversar com IA": a blank canvas with a living orb. The orb is driven by
// the amplitude of the assistant's own voice (Web Audio analyser), answers in
// real time through the tenant's authenticated assistant endpoint, and shows
// each step of a plan only after that step actually completed.
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let instance=null,api=null,csrf=null,navigate=null;
 let voice=null,startingVoice=false,voiceRequested=false,voiceEpoch=0;
 let audioContext=null,analyser=null,freq=null,raf=0,amp=0,level=0,activeSource=null;
 let speaking=false,ttsAbort=null,queryAbort=null,runId=null,runEpoch=0;
 let history=[],media=null,mediaUpload=null,busy=false,disposed=false,greeting='Olá! Como posso te ajudar hoje?';
 // Which answer the open campaign is waiting for; only "media" auto-continues,
 // otherwise a dropped file would be read as the city or the budget.
 let pendingSlot=null,dragHole=null;
 // The orb page is the bound root itself, so a plain querySelector could never
 // find it; every phase class lives on that very element.
 const get=sel=>!instance?null:instance.matches(sel)?instance:instance.querySelector(sel);
 const stage=()=>get('#orbStage');
 // Kept for screen readers only; the page never shows routine status pills.
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
   const fromAssistant=speaking&&analyser&&freq;
   let raw=0;
   if(fromAssistant){
    analyser.getByteFrequencyData(freq);
    let sum=0,count=0;
    // Speech energy lives mostly under ~1.5 kHz; ignore the noisy top end.
    for(let i=1;i<Math.min(freq.length,64);i++){sum+=freq[i];count++;}
    raw=count?sum/(count*255):0;
   }else if(voiceRequested&&voice?.active){
    raw=Number(voice.getLevel?.())||0;
   }
   level+=(raw-level)*(raw>level?.42:.09);
   const target=Math.min(1,level*1.55);
   // Signed amplitude: the assistant's voice pushes the orb outward, the owner's
   // voice pulls it inward, so the animation mirrors who is talking.
   const signed=fromAssistant?target:-target;
   amp+=(signed-amp)*.32;
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
 // The microphone keeps driving the orb after the assistant finishes a reply.
 function syncLevelLoop(){
  if(voiceRequested&&voice?.active)startLevelLoop();else stopLevelLoop();
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
   activeSource=source;
   source.onended=()=>{if(activeSource===source)activeSource=null;try{source.disconnect();}catch{}resolve();};
   try{source.start();}catch(error){activeSource=null;reject(error);}
  });
 }
 function stopSpeech(){
  if(ttsAbort){ttsAbort.abort();ttsAbort=null;}
  // Aborting the fetch is not enough: the already-decoded buffer keeps playing
  // unless its source node is stopped, which is what makes barge-in feel deaf.
  if(activeSource){const source=activeSource;activeSource=null;try{source.stop();}catch{}try{source.disconnect();}catch{}}
  speaking=false;syncLevelLoop();
  if(get('.orb-page')?.classList.contains('is-speaking'))setPhase(voiceRequested?'listening':'idle');
 }
 async function speak(text){
  const parts=chunkText(text);
  if(!parts.length||!audioContext||audioContext.state==='closed')return;
  stopSpeech();
  const controller=new AbortController();ttsAbort=controller;
  speaking=true;setPhase('speaking');
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
    ttsAbort=null;speaking=false;syncLevelLoop();
    if(get('.orb-page'))setPhase(voiceRequested?'listening':'idle');
   }
  }
 }
 // ------------------------------------------------------------------ caption
 function showCaption(text,role='assistant'){
  const box=get('#orbTranscript');if(!box)return;
  const line=document.createElement('p');
  line.className='orb-line '+role;
  const content=String(text||'').slice(0,1600);
  // The campaign plan arrives as bullet lines; collapsing them into one
  // paragraph would hide the structure the owner is being asked to approve.
  if(content.includes('\n'))line.classList.add('multiline');
  line.textContent=content;
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
 function planCount(list){
  if(!list)return;
  const done=[...list.children].filter(x=>['done','error','waiting'].includes(x.dataset.status)).length;
  const counter=get('#orbPlanCount');if(counter)counter.textContent=done+'/'+list.children.length;
 }
 function planUpdate(li,status,detail,title){
  if(!li)return;
  li.dataset.status=status;
  if(detail!==undefined){const small=li.querySelector('small');if(small)small.textContent=String(detail);}
  if(title!==undefined){const strong=li.querySelector('strong');if(strong)strong.textContent=String(title);}
  planCount(li.parentElement);
 }
 // The server plans the work for this specific request; the page only presents it.
 function renderPlan(plan){
  if(!plan||!Array.isArray(plan.steps)||!plan.steps.length)return null;
  const list=planReset(String(plan.title||'Plano do seu pedido'));
  if(!list)return null;
  for(const step of plan.steps.slice(0,7)){
   planAdd(list,String(step?.title||'Etapa'),{
    status:['done','running','waiting','error'].includes(step?.status)?step.status:'done',
    detail:String(step?.detail||'')});
  }
  planCount(list);
  return list;
 }
 // The skill writes one step id at a time after Meta confirms it; this log
 // mirrors that, so the page never invents a stage that did not happen.
 const EXEC_STAGES=[
  {id:'campaignId',running:'Criando a campanha na Meta…',done:'Campanha criada'},
  {id:'adsetId',running:'Criando o conjunto de anúncios…',done:'Conjunto de anúncios criado'},
  {id:'creativeId',running:'Criando o criativo do anúncio…',done:'Criativo criado'},
  {id:'adId',running:'Criando o anúncio…',done:'Anúncio criado'}
 ];
 function executionLog(list){
  planAdd(list,'Planejamento e copy conferidos',{status:'done',
   detail:'Público, orçamento e texto aprovados por você'});
  const items=EXEC_STAGES.map(stage=>planAdd(list,stage.running,{status:'pending',detail:'Na fila'}));
  planUpdate(items[0],'running','Preparando o envio para a Meta…');
  return {list,items,finished:false};
 }
 function renderExecution(exec,progress){
  if(!exec)return;
  const ids=progress?.result&&typeof progress.result==='object'?progress.result:{};
  const finished=progress?.planStatus==='succeeded'||progress?.runStatus==='completed';
  const failed=progress?.planStatus==='failed'||progress?.planStatus==='uncertain'||progress?.runStatus==='failed';
  let runningShown=false,errorShown=false;
  EXEC_STAGES.forEach((stage,i)=>{
   const li=exec.items[i],id=ids[stage.id];
   if(id){planUpdate(li,'done','Confirmado pela Meta',stage.done);return;}
   if(!runningShown&&failed&&!errorShown){
    runningShown=true;errorShown=true;
    planUpdate(li,'error',String(ids.error||'A Meta não confirmou esta etapa.').slice(0,150),'Não confirmado nesta etapa');
    return;
   }
   if(!runningShown&&!finished){
    runningShown=true;planUpdate(li,'running','Enviando para a Meta agora…',stage.running);return;
   }
   planUpdate(li,'pending','Na fila',stage.running);
  });
  if(finished&&!exec.finished){
   exec.finished=true;
   planAdd(exec.list,'Tudo pausado',{status:'done',detail:'Nada veicula nem gasta até você ativar'});
  }
  planCount(exec.list);
 }
 function startProgressPolling(runId,exec,isActive){
  const controller=new AbortController();let stopped=false;
  const tick=async()=>{
   if(stopped||!isActive())return;
   let progress=null;
   try{progress=await api('/api/thalita/progress?runId='+encodeURIComponent(runId),'GET',undefined,{},{signal:controller.signal});}catch{}
   if(stopped||!isActive())return;
   if(progress)renderExecution(exec,progress);
   window.setTimeout(tick,900);
  };
  tick();
  return {stop(){stopped=true;controller.abort();}};
 }
 function planHide(){
  const panel=get('#orbPlanPanel');if(!panel)return;
  window.setTimeout(()=>{panel.classList.remove('visible');panel.hidden=true;},260);
 }
 // ------------------------------------------------------------------- media
 function mediaCard(li,file,status,detail){
  if(!li)return;
  const label=file.name||'criativo';
  const kind=file.kind==='image'?'foto':'vídeo';
  planUpdate(li,status,detail);
  const body=li.querySelector('strong');
  if(body&&li.dataset.titled!=='1'){body.textContent=kind==='foto'?'Foto recebida':'Vídeo recebido';li.dataset.titled='1';}
  const chip=get('#orbMediaChip');
  if(!chip)return;
  chip.hidden=false;
  chip.dataset.status=status;
  chip.setAttribute('aria-label','Remover '+(kind==='foto'?'foto':'vídeo')+' anexado: '+label);
  const thumb=get('#orbMediaThumb');
  if(thumb){thumb.hidden=file.kind!=='image';if(file.kind==='image')thumb.src=file.preview;}
  const name=get('#orbMediaName');
  if(name)name.textContent=label.length>26?label.slice(0,23)+'…':label;
 }
 function clearMedia(){
  media=null;
  const chip=get('#orbMediaChip');if(chip){chip.hidden=true;chip.dataset.status='';}
  const thumb=get('#orbMediaThumb');if(thumb)thumb.removeAttribute('src');
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
  let finish,ok=false;mediaUpload=new Promise(resolve=>finish=resolve);
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
   }else{
    if(file.size>64*1024*1024)throw Error('Vídeos acima de 64 MB não podem ser enviados para a Meta.');
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
    mediaCard(li,file,'running','Preparando o vídeo na biblioteca da Meta…');
    const uploaded=await api('/api/ads-media/'+reserved.id+'/meta','POST',{});
    file.meta={mediaId:reserved.id,videoId:uploaded.videoId};
    mediaCard(li,file,'done',(uploaded.ready===false?'Vídeo enviado · a Meta ainda está processando':'Vídeo pronto na biblioteca da Meta')+' · '+sizeLabel(file.size));
   }
   ok=true;
  }catch(error){
   mediaCard(li,file,'error',String(error.message||'Não foi possível enviar a mídia.').slice(0,160));
   clearMedia();
  }finally{
   mediaUpload=null;finish();
   if(ok)mediaAttached(file);
  }
 }
 // A dropped or attached file is not a one-off upload: it joins the
 // conversation and, when the owner is building an ad, becomes its creative.
 function mediaAttached(file){
  const foto=file.kind==='image',kind=foto?'Foto':'Vídeo';
  const note=kind+(foto?' anexada':' anexado')+' à conversa: '+String(file.name||'').slice(0,60)+'.';
  history.push({role:'user',text:note},
   {role:'assistant',text:kind+' '+(foto?'anexada':'anexado')+' à conversa. Quando você pedir um anúncio, '+(foto?'ela':'ele')+' entra como criativo.'});
  if(history.length>10)history=history.slice(-10);
  showCaption(note+(runId&&pendingSlot==='media'?'':' Quando você pedir o anúncio, '+(foto?'ela':'ele')+' entra como criativo.'),'user');
  // The campaign is waiting for exactly this file: continue the same run so the
  // owner does not have to repeat that the attachment is the creative.
  if(runId&&pendingSlot==='media'&&!busy)void runTurn('Anexei o criativo do anúncio.',{hidden:true});
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
   showCaption('Envie um vídeo MP4/MOV ou uma foto JPG/PNG/WebP.');
   return;
  }
  if(busy){statusText('Aguarde o pedido atual terminar');return;}
  const file={raw,kind:image?'image':'video',name:raw.name||'mídia',
   preview:URL.createObjectURL(raw),size:raw.size};
  dragHole=null;
  swallow(file,event);
  // The swallow ends in the orb's own dots drawing a quick check.
  window.setTimeout(()=>{if(!disposed)orbRenderer?.playCheck?.();},760);
  void uploadMedia(file);
 }
 // ------------------------------------------------------------------- turns
 function mediaRef(){
  if(!media?.meta)return {};
  if(media.kind==='image'&&media.meta.imageHash)return {imageHash:media.meta.imageHash};
  if(media.kind==='video'&&media.meta.videoId)return {videoId:media.meta.videoId};
  return {};
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
 async function runTurn(text,{fromVoice=false,hidden=false}={}){
  const message=String(text||'').trim();
  if(!message||busy)return;
  const epoch=++runEpoch;
  const isActive=()=>!disposed&&epoch===runEpoch;
  busy=true;
  const input=get('#orbInput');if(input)input.value='';
  if(!fromVoice&&!hidden)showCaption(message,'user');
  // Confirming a ready campaign is the one turn that writes to Meta, so it gets
  // the live execution log instead of the generic reading step.
  const confirming=Boolean(runId)&&/^(pode criar|pode fazer|confirmo|autorizo|aprovo(?: a campanha)?|sim[,. ]+pode criar|sim[,. ]+confirmo)[.! ]*$/i.test(message);
  const list=planReset(confirming?'Criando sua campanha na Meta':'Entendendo o seu pedido');
  const execution=confirming?executionLog(list):null;
  const read=confirming?null:planAdd(list,'Lendo o pedido',{status:'running',
   detail:media?'Instrução e criativo anexado':'Lendo o que você precisa'});
  const progressPoll=execution?startProgressPolling(runId,execution,isActive):null;
  setPhase('thinking');
  const controller=new AbortController();queryAbort=controller;
  try{
   // Never let a short answer outrun the attachment: the skill would ask for
   // media that is still being uploaded.
   if(mediaUpload)await mediaUpload;
   const result=await api('/api/thalita/ask','POST',{
    message,runId,history:history.slice(-6),...mediaRef()
   },{},{signal:controller.signal});
   progressPoll?.stop();
   if(!isActive())return;
   // The campaign conversation continues while the skill still needs answers
   // or waits for "pode criar"; dropping the id is what lost the context.
   runId=result.runId&&(result.status==='ready'||result.status==='collecting')?result.runId:null;
   pendingSlot=result.status==='collecting'&&String(result.skillId||'')==='ads.campaign.launch'?String(result.slot||'')||null:null;
   const answer=String(result.message||'Consulta concluída.');
   const planned=renderPlan(result.plan);
   if(!planned)planUpdate(read,'done',queryDetail(result));
   history.push({role:'user',text:message.slice(0,350)},{role:'assistant',text:answer.slice(0,350)});
   if(history.length>10)history=history.slice(-10);
   showCaption(answer);
   if(result.status==='approval_required'&&result.confirmation){
    confirmCard(planned||list,result.confirmation,answer);
   }
   if(result.status==='completed'&&media?.meta&&String(result.skillId||'')==='ads.campaign.launch')clearMedia();
   const spoken=String(result.speechText||answer);
   if(audioContext&&audioContext.state!=='closed')void speak(spoken);
   else setPhase(voiceRequested?'listening':'idle');
  }catch(error){
   if(!isActive())return;
   progressPoll?.stop();
   if(execution&&!execution.finished){
    const failedStep=execution.items.find(x=>x.dataset.status==='error')||execution.items.find(x=>x.dataset.status==='running')||execution.items[0];
    if(failedStep.dataset.status!=='error'){
     planUpdate(failedStep,'error',String(error.message||'Falha ao executar.').slice(0,150),'Não confirmado nesta etapa');
    }
   }
   planUpdate(read,'error',String(error.message||'Falha ao consultar.').slice(0,160));
   showCaption('Não foi possível concluir: '+String(error.message||'erro inesperado'));
  }finally{
   progressPoll?.stop();
   if(queryAbort===controller)queryAbort=null;
   if(epoch===runEpoch){busy=false;if(!speaking)setPhase(voiceRequested?'listening':'idle');}
  }
 }
 function queryDetail(result){
  if(result.status==='approval_required')return 'Dados conferidos · alteração pronta para revisão';
  if(result.status==='needs_details'||result.status==='collecting')return 'Preciso de mais alguns dados';
  if(result.status==='ready')return 'Campanha pronta para a sua aprovação';
  if(result.status==='unavailable')return 'Consulta indisponível agora';
  if(result.status==='failed')return 'A Meta não confirmou a criação';
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
  setPhase('idle');
 }
 async function startVoice(){
  if(startingVoice){stopVoice();return;}
  startingVoice=true;voiceEpoch++;const epoch=voiceEpoch;
  try{
   await unlockAudio();
   startLevelLoop();
  }catch(error){startingVoice=false;stopLevelLoop();showCaption(error.message);return;}
  if(!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder){
   startingVoice=false;stopLevelLoop();showCaption('O microfone não está disponível neste navegador. Use o texto.');return;
  }
  try{
   const [{createSocioVoiceSession},{newSemanticTurnBuffer}]=await Promise.all([
    import('/socio-francisca-live.mjs?v=20261113d'),import('/socio-semantic-turn.mjs')
   ]);
   if(epoch!==voiceEpoch)return;
   const semantic=newSemanticTurnBuffer({maxWaitMs:16000,maxParts:3,maxChars:950});
   const session=createSocioVoiceSession({
    silenceMs:1900,maxTurnMs:45000,minVoicedMs:240,
    canInterrupt:()=>speaking,
    // Talking over the assistant only stops its audio. The caption, history and
    // the open campaign run stay exactly where they were, so the conversation
    // continues instead of restarting.
    onInterrupt:()=>{stopSpeech();},
    onError:message=>{if(voice===session)showCaption(message);},
    onState:next=>{
     if(voice!==session)return;
     if(next==='off'){stopVoice();return;}
     if(!speaking)setPhase(next==='listening'||next==='hearing'?'listening':'thinking');
    },
    onTurn:async(blob,{signal}={})=>{
     const turnEpoch=voiceEpoch;
     if(!voiceRequested||voice!==session||signal?.aborted)return;
     if(blob.size>3*1024*1024){showCaption('A fala ficou longa demais. Fale em frases mais curtas.');return;}
     setPhase('thinking');
     const resp=await fetch('/api/thalita/transcribe',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':blob.type.split(';')[0],'X-CSRF-Token':csrf},body:blob,signal});
     const data=await resp.json().catch(()=>({}));
     if(!resp.ok){
      const message=String(data.error||'Transcrição indisponível');
      // A stray sound or a breath is not an error to report: keep listening.
      if(resp.status===422&&/identifiquei|detectei fala/i.test(message)){setPhase('listening');return;}
      throw Error(message);
     }
     if(signal?.aborted||turnEpoch!==voiceEpoch||!voiceRequested||voice!==session)return;
     const text=String(data.text||'').trim();
     if(!meaningful(text)){setPhase('listening');return;}
     const assessed=semantic.take(text)||{hold:false,text};
     if(assessed.hold){setPhase('listening');return;}
     await runTurn(assessed.text,{fromVoice:true});
    }
   });
   voice=session;
   await session.start();
   if(epoch!==voiceEpoch||voice!==session||!session.active)return;
   startingVoice=false;voiceRequested=true;
   const mic=get('[data-orb-mic]');
   if(mic){mic.classList.add('on');mic.setAttribute('aria-pressed','true');}
   setPhase('listening');
   showCaption(greeting);
   if(audioContext&&audioContext.state!=='closed')void speak(greeting);
  }catch(error){
   if(epoch===voiceEpoch){stopVoice();showCaption('Não foi possível usar o microfone: '+String(error.message||'').slice(0,120));}
  }finally{if(epoch===voiceEpoch)startingVoice=false;}
 }
 // Short answers are real answers. Only pure fillers are dropped, otherwise
 // "sim", "não", "ok" and "obrigado" would vanish between the owner and the orb.
 function meaningful(text){
  const normalized=String(text||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
   .replace(/[^a-z0-9]+/g,' ').trim();
  return normalized.length>=2&&!/^(?:e|e ai|oi+|ola|hum+|hmm+|aham|aha|ah+|eh+|mmm+|uh+|ta|tchau)$/.test(normalized);
 }
 // ------------------------------------------------------------ orb renderer
 // The dotted-mesh renderer lives in /socio-orb-mesh.js so the orb page and
 // the dashboard entry draw the exact same object.
 function createOrbRenderer(canvas){
  return globalThis.SocioOrbMesh?.create(canvas,{amp:ampNow,light:true,hole:()=>dragHole})??null;
 }
 let orbRenderer=null;
 const ampNow=()=>amp;
 // -------------------------------------------------------------------- mount
 function wire(){
  get('[data-orb-back]')?.addEventListener('click',()=>navigate?.('overview'));
  get('[data-orb-mic]')?.addEventListener('click',startVoice);
  get('[data-orb-attach]')?.addEventListener('click',()=>get('#orbFile')?.click());
  get('#orbMediaChip')?.addEventListener('click',clearMedia);
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
  // The part of the orb under the pointer opens into a donut. The radius fades
  // out near the rim so the hole only exists where the orb actually is.
  const trackHole=event=>{
   const canvas=get('#orbCanvas');
   if(!canvas){dragHole=null;return;}
   const rect=canvas.getBoundingClientRect();
   if(!rect.width||!rect.height){dragHole=null;return;}
   const x=event.clientX-rect.left,y=event.clientY-rect.top;
   const side=Math.min(rect.width,rect.height),reach=side*.52;
   const d=Math.hypot(x-rect.width/2,y-rect.height/2);
   const fade=1-Math.max(0,d-reach*.6)/(reach*.4);
   dragHole={x,y,r:d>=reach?0:side*.165*Math.min(1,fade)};
  };
  s.addEventListener('dragenter',event=>{
   if(!event.dataTransfer)return;
   event.preventDefault();dragDepth++;
   get('.orb-page')?.classList.add('is-dragging');
   trackHole(event);
  });
  s.addEventListener('dragover',event=>{
   if(!event.dataTransfer)return;
   event.preventDefault();event.dataTransfer.dropEffect='copy';
   trackHole(event);
  });
  s.addEventListener('dragleave',()=>{
   dragDepth=Math.max(0,dragDepth-1);
   if(!dragDepth){get('.orb-page')?.classList.remove('is-dragging');dragHole=null;}
  });
  s.addEventListener('drop',event=>{
   event.preventDefault();dragDepth=0;dragHole=null;
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
  history=[];runId=null;busy=false;pendingSlot=null;dragHole=null;
 }
 function render({root,api:client,csrfToken,navigate:go,me}={}){
  dispose();disposed=false;
  api=client;csrf=csrfToken;navigate=go;
  const brand=String(me?.tenant?.name||'').trim().slice(0,40);
  const person=String(me?.user?.name||'').trim().split(/\s+/)[0].slice(0,40);
  const who=brand||person;
  greeting=who?'Olá, '+who+'! Como posso te ajudar hoje?':'Olá! Como posso te ajudar hoje?';
  root.innerHTML='<div class="orb-page is-idle" data-orb>'+
   '<header class="orb-top">'+
    '<button class="orb-back" type="button" data-orb-back><span aria-hidden="true">←</span> Visão geral</button>'+
    '<span class="ps-sr-only" id="orbStatus" role="status" aria-live="polite"></span>'+
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
     '<p class="orb-line assistant in">'+esc(greeting)+'</p>'+
    '</div>'+
    '<p class="orb-drop-hint" aria-hidden="true">Solte para a orbe engolir</p>'+
    '<input type="file" id="orbFile" accept="video/mp4,video/quicktime,image/png,image/jpeg,image/webp" hidden>'+
   '</div>'+
   '<aside class="orb-plan-panel" id="orbPlanPanel" aria-label="Plano em execução" hidden>'+
    '<header><div><span class="orb-plan-eyebrow">PLANO</span><strong id="orbPlanTitle">Entendendo o seu pedido</strong></div>'+
     '<small id="orbPlanCount"></small></header>'+
    '<ol class="orb-steps" id="orbSteps"></ol>'+
   '</aside>'+
   '<form class="orb-composer" id="orbForm" autocomplete="off">'+
    '<button class="orb-media-pill" type="button" id="orbMediaChip" hidden>'+
     '<img class="orb-media-thumb" id="orbMediaThumb" alt="" hidden>'+
     '<span class="orb-media-name" id="orbMediaName"></span>'+
     '<span class="orb-media-x" aria-hidden="true">×</span></button>'+
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
