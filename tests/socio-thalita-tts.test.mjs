import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {synthesizeSocioTrainingVoice,validateTtsText,SOCIO_TRAINING_VOICE} from '../socio-training-tts.mjs';

test('Only approved Brazilian Thalita voice can be rendered',()=>{
 assert.equal(SOCIO_TRAINING_VOICE,'pt-BR-ThalitaMultilingualNeural');
 assert.equal(validateTtsText('  Olá,  cliente! '),'Olá, cliente!');
 for(const text of ['', 'a', 'x'.repeat(651), null, 42]){
  assert.throws(()=>validateTtsText(text),{status:422});
 }
});

test('Thalita TTS uses bounded server argv, returns transient audio and cleans up',async()=>{
 let tempCreated=false,removed=false,executed=false;
 const result=await synthesizeSocioTrainingVoice('Olá! Como posso ajudar?',{
  temp:async prefix=>{assert.match(prefix,/socio-voice-/);tempCreated=true;return '/tmp/socio-test-only';},
  exec:async(cmd,args,opt)=>{
   executed=true;
   assert.equal(cmd,'/opt/socio-tts/bin/edge-tts');
   assert.equal(args[args.indexOf('--voice')+1],SOCIO_TRAINING_VOICE);
   assert.equal(args[args.indexOf('--text')+1],'Olá! Como posso ajudar?');
   assert.ok(args.includes('--rate=+4%'));
   assert.equal(opt.timeout,24000);
  },
  getStat:async()=>({size:650}),
  read:async()=>Buffer.alloc(650,1),
  remove:async path=>{assert.equal(path,'/tmp/socio-test-only');removed=true;}
 });
 assert(tempCreated&&executed&&removed);
 assert.equal(result.bytes.length,650);
 assert.equal(result.mime,'audio/mpeg');
 assert.equal(result.voice,SOCIO_TRAINING_VOICE);
});

test('Provider failure fails safely and still destroys the temporary directory',async()=>{
 let removed=false;
 await assert.rejects(synthesizeSocioTrainingVoice('Olá, cliente!',{
  temp:async()=>'/tmp/socio-thalita-test',
  exec:async()=>{throw Error('provider unavailable');},
  remove:async()=>{removed=true;}
 }),{status:503});
 assert(removed);
});

test('Sócio audio is server-generated, authenticated, rate-limited, and allows barge-in',()=>{
 const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const server=load('server.mjs'),ui=load('public/socio-interview-ui.js');
 const voice=load('public/socio-francisca-live.mjs'),docker=load('meta-browser/Dockerfile');
 assert.match(server,/pathname==='\/api\/training\/interview\/tts'/);
 assert.match(server,/needRole\(a,\['owner','admin'\]\)/);
 assert.match(server,/interview-tts:/);
 assert.match(server,/current\.mode!=='voice'/);
 assert.match(server,/media-src 'self' blob:/);
 assert.match(ui,/\/api\/training\/interview\/tts/);
 assert.match(ui,/pt-BR-ThalitaMultilingualNeural/);
 assert.doesNotMatch(ui,/speechSynthesis|SpeechSynthesisUtterance/);
 assert.match(ui,/onInterrupt:.*cancelSpeech/);
 assert.match(voice,/canInterrupt/);
 assert.match(docker,/edge-tts==7\.3\.0/);
});
