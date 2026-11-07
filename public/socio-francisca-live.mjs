// Hands-free, turn-based browser voice interaction. A user explicitly starts the
// microphone, a small VAD detects the end of each utterance, and the same source
// stays connected until they close the call. No recording is retained on disk; transcript requires human review.
export function createSocioVoiceSession({onTurn,onState=()=>{},onError=()=>{},onInterrupt=()=>{},canInterrupt=()=>false,silenceMs=950,maxTurnMs=28000}){
 let active=false,stream=null,context=null,analyser=null,source=null,timer=null,recorder=null;
 let startedAt=0,lastSpeechAt=0,speechStartedAt=0,ambient=.003,finishing=false,processing=false;
 let generation=0,chunks=[],mime='',samples=null,bargeStarted=0;
 const state=next=>{if(active||next==='off')onState(next);};
 const closeStream=()=>{
  if(timer){clearInterval(timer);timer=null;}
  if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;try{recorder.stop();}catch{}}
  recorder=null;chunks=[];
  try{source?.disconnect();}catch{}
  source=null;analyser=null;samples=null;
  if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
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
    if(active&&thisGeneration===generation&&blob.size>=200&&blob.size<=5*1024*1024)await onTurn(blob);
    else if(active&&blob.size>5*1024*1024)onError('A fala ficou longa demais. Tente falar em frases mais curtas.');
   }catch(error){if(active&&thisGeneration===generation)onError(error?.message||'Não consegui processar a fala.');}
   finally{
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
   startedAt=Date.now();lastSpeechAt=startedAt;speechStartedAt=startedAt;
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
 function poll(){
  if(!active||finishing||document.hidden)return;
  const rms=level(),now=Date.now();
  if(processing){
   // Keep measuring the microphone while the assistant is speaking.
   // A sustained new user utterance interrupts playback and starts recording
   // without disconnecting the underlying microphone stream.
   const userSpeech=canInterrupt()&&rms>Math.max(.018,ambient*2.5);
   if(userSpeech){
    if(!bargeStarted)bargeStarted=now;
    if(now-bargeStarted>=140){
     bargeStarted=0;
     try{onInterrupt();}catch(error){onError(error?.message||'Falha ao interromper');}
     processing=false;
     record();
    }
   }else bargeStarted=0;
   return;
  }
  // The noise floor follows ambient input slowly, but never treats room noise
  // as confirmed user speech without a stronger signal.
  const loud=rms>Math.max(.009,ambient*2.35);
  if(!loud)ambient=Math.max(.002,Math.min(.03,ambient*.985+rms*.015));
  if(loud){
   if(!recorder)record();
   if(recorder)lastSpeechAt=now;
  }
  if(recorder&&now-startedAt>=maxTurnMs){finishTurn();return;}
  if(recorder&&!loud&&now-lastSpeechAt>=silenceMs){
   if(lastSpeechAt-speechStartedAt>=70)finishTurn();
   else if(now-startedAt>=2500){
    // Ignore a cough or very short noise rather than sending an empty turn.
    const discard=recorder;discard.onstop=null;
    try{discard.stop();}catch{}
    recorder=null;chunks=[];lastSpeechAt=0;speechStartedAt=0;
    state('listening');
   }
  }
 }
 async function start(){
  if(active)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('O navegador não disponibilizou o microfone. Ative a permissão ou use o chat.');
  const AudioContextImpl=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextImpl)throw Error('Este navegador não oferece detecção de voz. Use o chat de texto.');
  active=true;generation++;const thisGeneration=generation;
  state('connecting');
  try{
   const granted=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!active||generation!==thisGeneration){for(const track of granted.getTracks())track.stop();return;}
   stream=granted;
   context=new AudioContextImpl();
   if(context.state==='suspended')await context.resume();
   if(!active||generation!==thisGeneration){closeStream();return;}
   source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();
   analyser.fftSize=2048;analyser.smoothingTimeConstant=.28;
   source.connect(analyser); // never connect to the output (no microphone echo)
   samples=new Float32Array(analyser.fftSize);
   timer=setInterval(poll,85);
   state('listening');
  }catch(error){stop();throw error;}
 }
 function stop(){
  const wasActive=active;active=false;generation++;processing=false;finishing=false;bargeStarted=0;
  closeStream();if(wasActive)state('off');
 }
 return {start,stop,get active(){return active;},get processing(){return processing;}};
}
