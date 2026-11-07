// Same selected Microsoft Edge voice as Prospector. No user-supplied voice ID.
// The per-request MP3 is ephemeral and is never sent to a customer.
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile as callbackExecFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFile=promisify(callbackExecFile);
export const SOCIO_TRAINING_VOICE='pt-BR-ThalitaMultilingualNeural';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function validateTtsText(value){
 if(typeof value!=='string')throw fail(422,'Envie texto para o treinamento por voz.');
 const text=value.trim().replace(/\s+/g,' ');
 if(text.length<2||text.length>650)throw fail(422,'O texto para voz deve conter de 2 a 650 caracteres.');
 return text;
}
export async function synthesizeSocioTrainingVoice(value,{exec=execFile,temp=mkdtemp,read=readFile,remove=rm,getStat=stat}={}){
 const text=validateTtsText(value);
 const directory=await temp(join(tmpdir(),'socio-voice-'));
 const output=join(directory,'speech.mp3');
 try{
  await exec('/opt/socio-tts/bin/edge-tts',[
   '--voice',SOCIO_TRAINING_VOICE,'--rate=+4%','--pitch=+0Hz','--volume=+0%',
   '--text',text,'--write-media',output,'--no-progress'
  ],{timeout:24000,maxBuffer:120000});
  const info=await getStat(output);
  if(info.size<256||info.size>3*1024*1024)throw fail(503,'TTS retornou um áudio inválido.');
  const bytes=await read(output);
  if(!Buffer.isBuffer(bytes)||bytes.length<256||bytes.length>3*1024*1024)
   throw fail(503,'TTS retornou um áudio inválido.');
  return {bytes,mime:'audio/mpeg',voice:SOCIO_TRAINING_VOICE};
 }catch(error){
  if(error.status)throw error;
  throw fail(503,'Voz Thalita temporariamente indisponível. O treinamento por texto continua funcionando.');
 }finally{
  await remove(directory,{recursive:true,force:true}).catch(()=>{});
 }
}
