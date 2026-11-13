// Hands-free, turn-based browser voice interaction. A user explicitly starts the
// microphone, a small VAD detects the end of each utterance, and the same source
// stays connected until they close the call. No recording is retained on disk; transcript requires human review.
export function createSocioVoiceSession({onTurn,onState=()=>{},onError=()=>{},onInterrupt=()=>{},canInterrupt=()=>false,silenceMs=1800,maxTurnMs=45000,minVoicedMs=380,bargeMs=360}){
 let active=false,stream=null,context=null,analyser=null,source=null,timer=null,recorder=null;
 let startedAt=0,lastSpeechAt=0,speechStartedAt=0,ambient=.003,finishing=false,processing=false;
 let generation=0,chunks=[],mime='',samples=null,bargeStarted=0,bargeCandidate=false,bargeLastVoiceAt=0,voicedMs=0,lastPollAt=0,turnAbort=null,startingCandidate=0,lastAssistantSoundAt=0;
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
 function record(force){
  if(!active||(processing&&!force)||recorder||!stream)return;
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
 // RMS alone cannot tell soft speech from a steady room hum: a quiet voice has
 // a low average but a clear peak, which is what the recogniser needs.
 function level(){
  if(!analyser||!samples)return {rms:0,peak:0};
  if(analyser.getFloatTimeDomainData){
   analyser.getFloatTimeDomainData(samples);
   let sum=0,peak=0;
   for(let i=0;i<samples.length;i++){const v=samples[i];sum+=v*v;const a=Math.abs(v);if(a>peak)peak=a;}
   return {rms:Math.sqrt(sum/samples.length),peak};
  }
  const bytes=new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(bytes);
  let sum=0,peak=0;
  for(const b of bytes){const d=(b-128)/128;sum+=d*d;const a=Math.abs(d);if(a>peak)peak=a;}
  return {rms:Math.sqrt(sum/bytes.length),peak};
 }
 // Normalised voice energy for the orb: 0 when the room is quiet, 1 at a clear
 // speaking voice. The inward animation follows this while the owner talks.
 function meter(){
  if(!active)return 0;
  const {rms,peak}=level();
  const threshold=Math.max(.009,ambient*2.2);
  if(rms<=threshold&&peak<=Math.max(.05,threshold*3.2))return 0;
  return Math.max(0,Math.min(1,(rms*.9+peak*.45-.02)/.16));
 }
 function discardTurn(){
  if(recorder){const old=recorder;old.onstop=null;try{old.stop();}catch{}recorder=null;}
  chunks=[];voicedMs=0;lastSpeechAt=0;speechStartedAt=0;startingCandidate=0;bargeCandidate=false;bargeStarted=0;bargeLastVoiceAt=0;
  if(active)state('listening');
 }
 function poll(){
  if(!active||finishing)return;
  if(document.hidden){stop();return;}
  const {rms,peak}=level(),now=Date.now(),delta=lastPollAt?Math.min(170,now-lastPollAt):85;
  lastPollAt=now;
  // Never record an echo while the assistant is speaking. A stronger,
  // sustained voice can interrupt without launching phantom STT requests.
  const assistantSpeaking=canInterrupt();
  if(assistantSpeaking)lastAssistantSoundAt=now;
  if(processing||assistantSpeaking){
   // Interrupting has to work in a real room: the ambient floor is frozen while
   // the assistant speaks, and human speech dips between syllables. Require a
   // clear peak plus average energy, and let short gaps (up to ~380 ms) pass
   // without cancelling an interruption the owner already started.
   const bargeGate=Math.max(.02,ambient*2.2);
   const userSpeech=assistantSpeaking&&peak>Math.max(.05,bargeGate*2.4)&&rms>bargeGate;
   if(userSpeech){
    bargeLastVoiceAt=now;
    // Record from the first voiced frame: when the interruption is confirmed the
    // opening words must survive, otherwise the reply starts mid-sentence.
    if(!bargeStarted){bargeStarted=now;bargeCandidate=true;record(true);}
    if(recorder){lastSpeechAt=now;voicedMs+=delta;}
    if(now-bargeStarted>=bargeMs){
     bargeStarted=0;bargeLastVoiceAt=0;bargeCandidate=false;
     try{onInterrupt();}catch(error){onError(error?.message||'Falha ao interromper');}
     // A pending transcription must never race with the interruption.
     if(turnAbort){turnAbort.abort();turnAbort=null;}
     processing=false;lastPollAt=0;
    }
   }else if(bargeStarted&&now-bargeLastVoiceAt>=380){
    // Sound really stopped before the interruption was confirmed (echo or a
    // cough): throw the candidate away and keep the assistant talking.
    bargeStarted=0;bargeLastVoiceAt=0;
    if(bargeCandidate){bargeCandidate=false;discardTurn();}
   }
   return;
  }
  // Suppress speaker echo trailing the end of TTS playback.
  if(lastAssistantSoundAt&&now-lastAssistantSoundAt<800)return;
  // A soft voice must count as speech. Require both enough average energy and a
  // real peak so the room's steady hum still never opens a turn, and let the
  // ambient floor adapt quickly to a noisy place.
  const threshold=Math.max(.009,ambient*2.2);
  const loud=rms>threshold&&peak>Math.max(.05,threshold*3.2);
  if(!loud)ambient=Math.max(.002,Math.min(.05,ambient*.97+rms*.03));
  if(loud){
   if(!recorder){
    if(!startingCandidate)startingCandidate=now;
    if(now-startingCandidate>=120)record();
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
  const wasActive=active;active=false;generation++;processing=false;finishing=false;bargeStarted=0;bargeCandidate=false;bargeLastVoiceAt=0;
  startingCandidate=0;voicedMs=0;lastPollAt=0;lastAssistantSoundAt=0;
  if(turnAbort){turnAbort.abort();turnAbort=null;}
  document.removeEventListener('visibilitychange',handleHidden);
  window.removeEventListener('pagehide',stop);
  closeStream();if(wasActive)state('off');
 }
 return {start,stop,getLevel:meter,get active(){return active;},get processing(){return processing;}};
}
