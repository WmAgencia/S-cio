// Ephemeral opt-in voice answers for the guided Sócio interview.
// Audio is sent to Groq Whisper only after the user presses Record and Stop.
// Never stores, queues, or automatically approves a transcript.
const bad=(status,message)=>Object.assign(new Error(message),{status});
const types=new Map([['audio/webm','webm'],['audio/ogg','ogg'],['audio/mp4','m4a'],['audio/x-m4a','m4a'],
 ['audio/mpeg','mp3'],['audio/wav','wav']]);
export async function transcribeTrainingAudio({audioBase64,mime,env=process.env,fetchImpl=fetch,timeoutMs=30000}={}){
 if(!env.GROQ_API_KEY||String(env.GROQ_API_KEY).trim().length<20)throw bad(503,'Transcrição por voz indisponível neste momento.');
 const type=String(mime||'').split(';')[0].toLowerCase(),ext=types.get(type);
 if(!ext||typeof audioBase64!=='string'||audioBase64.length<100||audioBase64.length>5_000_000||
   !/^[a-zA-Z0-9+/]*={0,2}$/.test(audioBase64))
  throw bad(422,'Áudio inválido; grave uma resposta de até 3 MB.');
 const bytes=Buffer.from(audioBase64,'base64');
 if(bytes.length<70||bytes.length>3_500_000)throw bad(422,'Áudio fora dos limites permitidos.');
 const webm=bytes.subarray(0,4).toString('hex')==='1a45dfa3';
 const ogg=bytes.subarray(0,4).toString('ascii')==='OggS';
 const mp4=bytes.subarray(4,8).toString('ascii')==='ftyp';
 const wav=bytes.subarray(0,4).toString('ascii')==='RIFF';
 const mp3=bytes.subarray(0,3).toString('hex')==='494433'||bytes[0]===0xff;
 if(!(type==='audio/webm'&&webm||type==='audio/ogg'&&ogg||
   ['audio/mp4','audio/x-m4a'].includes(type)&&mp4||type==='audio/wav'&&wav||type==='audio/mpeg'&&mp3))
  throw bad(422,'Formato de gravação não reconhecido.');
 const form=new FormData();
 form.set('file',new Blob([bytes],{type}), 'resposta.'+ext);
 form.set('model','whisper-large-v3-turbo');
 form.set('language','pt');
 form.set('response_format','json');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),Math.min(40000,Math.max(1000,Number(timeoutMs)||30000)));
 try{
  const response=await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions',{
   method:'POST',headers:{Authorization:'Bearer '+env.GROQ_API_KEY},body:form,signal:controller.signal});
  if(!response.ok)throw bad(503,response.status===429?'Limite de transcrições atingido.':'Falha ao transcrever. Tente novamente.');
  const data=await response.json(),text=String(data.text||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,1000);
  if(text.length<2)throw bad(422,'Não foi possível reconhecer palavras. Grave novamente ou escreva sua resposta.');
  return {text,provider:'groq',model:'whisper-large-v3-turbo',editable:true};
 }catch(e){
  if(e.name==='AbortError')throw bad(503,'A transcrição excedeu o tempo permitido.');
  if(e.status)throw e;
  throw bad(503,'Não foi possível comunicar com o serviço de transcrição.');
 }finally{clearTimeout(timer);}
}
