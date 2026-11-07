// Hands-free, turn-based browser voice interaction. A user explicitly starts the
// microphone, a small VAD detects the end of each utterance, and the same source
// stays connected until they close the call. No recording is retained on disk; transcript requires human review.
export function createSocioVoiceSession({onTurn,onState=()=>{},onError=()=>{},onInterrupt=()=>{},canInterrupt=()=>false,silenceMs=2100,maxTurnMs=45000,minVoicedMs=650}){
 let active=false,stream=null,context=null,analyser=null,source=null,timer=null,recorder=null;
 let startedAt=0,lastSpeechAt=0,speechStartedAt=0,ambient=.003,finishing=false,processing=false;
 let generation=0,chunks=[],mime='',samples=null,bargeStarted=0,voicedMs=0,lastPollAt=0,turnAbort=null,startingCandidate=0,lastAssistantSoundAt=0;
 const state=next=>{if(active||next==='off')onState(next);};
 const closeStream=()=>{
  if(timer){clearInterval(timer);timer=null;}
  if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;try{recorder.stop();}catch{}}
  recorder=null;chunks=[];
  try{source?.disconnect();}catch{}
  source=null;analyser=null;samples=null;
  if(stream){for(const track of stream.getTracks()){track.enabled=false;track.stop();}stream=null;}
  if(context){Promise.resolve(context.close()).catch(()=>{});context=null;}
 };
 function finishTurn(){
  if(!active||processing||finishing||!recorder||recorder.state!=='recording')return;
  finishing=true;processing=true;const thisGeneration=generation,rec=recorder,parts=chunks,kind=mime;
  state('processing');
  rec.onstop=async()=>{
   recorder=null;finishing=false;
   const blob=new Blob(parts,{type:kind});
   try{
    if(active&&thisGeneration===generation&&blob.size>=200&&blob.size<=5*1024*1024){
     const controller=new AbortController();turnAbort=controller;
     await onTurn(blob,{signal:controller.signal,generation:thisGeneration});
    }
    else if(active&&blob.size>5*1024*1024)onError('A fala ficou longa demais. Tente falar em frases mais curtas.');
   }catch(error){if(active&&thisGeneration===generation)onError(error?.message||'Não consegui processar a fala.');}
   finally{
    turnAbort=null;
    processing=false;
    if(active&&thisGeneration===generation){
     if(recorder){state('hearing');}else{lastSpeechAt=0;speechStartedAt=0;ambient=.003;state('listening');}
    }
   }
  };
  try{rec.stop();}catch(error){
   processing=false;finishing=false;recorder=null;
   if(active)onError('Não consegui concluir a gravação. '+(error?.message||''));
  }
 }
 function record(){
  if(!active||processing||recorder||!stream)return;
  try{
   const NativeRecorder=window.MediaRecorder;
   mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>NativeRecorder.isTypeSupported(t));
   if(!mime)throw Error('Este navegador não oferece um formato de gravação compatível.');
   chunks=[];
   recorder=new NativeRecorder(stream,{mimeType:mime});
   recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
   recorder.onerror=()=>{if(active)onError('O microfone apresentou uma falha.');};
   recorder.start(300);
   startedAt=Date.now();lastSpeechAt=startedAt;speechStartedAt=startedAt;voicedMs=0;startingCandidate=0;
   state('hearing');
  }catch(error){onError('Falha ao iniciar a gravação: '+(error.message||error));stop();}
 }
 function level(){
  if(!analyser||!samples)return 0;
  if(analyser.getFloatTimeDomainData){
   analyser.getFloatTimeDomainData(samples);
   let sum=0;for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];
   return Math.sqrt(sum/samples.length);
  }
  const bytes=new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(bytes);
  let sum=0;for(const b of bytes){const d=(b-128)/128;sum+=d*d;}
  return Math.sqrt(sum/bytes.length);
 }
 function discardTurn(){
  if(recorder){const old=recorder;old.onstop=null;try{old.stop();}catch{}recorder=null;}
  chunks=[];voicedMs=0;lastSpeechAt=0;speechStartedAt=0;startingCandidate=0;
  if(active)state('listening');
 }
 function poll(){
  if(!active||finishing)return;
  if(document.hidden){stop();return;}
  const rms=level(),now=Date.now(),delta=lastPollAt?Math.min(170,now-lastPollAt):85;
  lastPollAt=now;
  // Never record an echo while the assistant is speaking. A stronger,
  // sustained voice can interrupt without launching phantom STT requests.
  const assistantSpeaking=canInterrupt();
  if(assistantSpeaking)lastAssistantSoundAt=now;
  if(processing||assistantSpeaking){
   const userSpeech=assistantSpeaking&&rms>Math.max(.062,ambient*5.2);
   if(userSpeech){
    if(!bargeStarted)bargeStarted=now;
    if(now-bargeStarted>=750){
     bargeStarted=0;
     try{onInterrupt();}catch(error){onError(error?.message||'Falha ao interromper');}
     // A pending transcription must never race with the interruption.
     if(turnAbort){turnAbort.abort();turnAbort=null;}
     processing=false;lastPollAt=0;record();
    }
   }else bargeStarted=0;
   return;
  }
  // Suppress speaker echo trailing the end of TTS playback.
  if(lastAssistantSoundAt&&now-lastAssistantSoundAt<800)return;
  // RMS is not true speech recognition. Treat isolated peaks as noise,
  // require sustained activity, and reject short/noisy recordings.
  const threshold=Math.max(.020,ambient*3.0);
  const loud=rms>threshold;
  if(!loud)ambient=Math.max(.003,Math.min(.04,ambient*.992+rms*.008));
  if(loud){
   if(!recorder){
    if(!startingCandidate)startingCandidate=now;
    if(now-startingCandidate>=220)record();
   }
   if(recorder){lastSpeechAt=now;voicedMs+=delta;}
  }else if(!recorder)startingCandidate=0;
  if(!recorder)return;
  if(now-startedAt>=maxTurnMs){
   if(voicedMs>=minVoicedMs)finishTurn();else discardTurn();
   return;
  }
  if(!loud&&now-lastSpeechAt>=silenceMs){
   if(voicedMs>=minVoicedMs)finishTurn();
   else discardTurn();
  }
 }
 async function start(){
  if(active)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('O navegador não disponibilizou o microfone. Ative a permissão ou use o chat.');
  const AudioContextImpl=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextImpl)throw Error('Este navegador não oferece detecção de voz. Use o chat de texto.');
  active=true;generation++;lastPollAt=0;ambient=.003;startingCandidate=0;const thisGeneration=generation;
  state('connecting');
  try{
   const granted=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!active||generation!==thisGeneration){for(const track of granted.getTracks())track.stop();return;}
   stream=granted;
   // If the browser revokes microphone permission or the device disconnects,
   // release the entire voice session instead of leaving a stuck mic state.
   for(const track of stream.getTracks())track.addEventListener?.('ended',stop,{once:true});
   context=new AudioContextImpl();
   if(context.state==='suspended')await context.resume();
   if(!active||generation!==thisGeneration){closeStream();return;}
   source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();
   analyser.fftSize=2048;analyser.smoothingTimeConstant=.28;
   source.connect(analyser); // never connect to the output (no microphone echo)
   samples=new Float32Array(analyser.fftSize);
   document.addEventListener('visibilitychange',handleHidden);
   window.addEventListener('pagehide',stop);
   timer=setInterval(poll,85);
   state('listening');
  }catch(error){stop();throw error;}
 }
 function handleHidden(){if(document.hidden)stop();}
 function stop(){
  const wasActive=active;active=false;generation++;processing=false;finishing=false;bargeStarted=0;
  startingCandidate=0;voicedMs=0;lastPollAt=0;lastAssistantSoundAt=0;
  if(turnAbort){turnAbort.abort();turnAbort=null;}
  document.removeEventListener('visibilitychange',handleHidden);
  window.removeEventListener('pagehide',stop);
  closeStream();if(wasActive)state('off');
 }
 return {start,stop,get active(){return active;},get processing(){return processing;}};
}
