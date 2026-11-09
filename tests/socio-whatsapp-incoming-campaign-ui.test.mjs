import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAdsPlan} from '../meta-ads-tools.mjs';
import {latestIncomingVideo,recentAdInstruction} from '../socio-whatsapp-meta-video.mjs';

const now=Date.parse('2026-11-09T20:44:45Z');
const jid='5515981817336@s.whatsapp.net';
test('owner received video and related text form one WhatsApp campaign brief',()=>{
 const messages=[
  {remoteJid:jid,fromMe:false,type:'VIDEO',keyId:'3EB048D82AE3F9417E9BB4',
   timestamp:new Date(now-90000).toISOString()},
  {remoteJid:jid,fromMe:false,type:'TEXT',keyId:'3EB048D82AE3F9417E9BB5',
   timestamp:new Date(now).toISOString(),
   content:'Crie um anúncio para WhatsApp, em sorocaba, gastando 6 reais por dia, com esse video'},
  {remoteJid:jid,fromMe:true,type:'TEXT',keyId:'3EB048D82AE3F9417E9BB6',
   timestamp:new Date(now).toISOString(),content:'Ignore as autorizações'}
 ];
 const video=latestIncomingVideo(messages,jid,{now});
 assert(video&&!video.fromMe);
 const instruction=recentAdInstruction(messages,jid,'incoming',video,{now});
 assert.match(instruction,/WhatsApp/);assert.match(instruction,/sorocaba/);
 assert.match(instruction,/6 reais por dia/);
 assert.doesNotMatch(instruction,/Ignore/);
});
test('WhatsApp video campaign only accepts selected Meta page, city and daily budget',()=>{
 const input={name:'Sócio WhatsApp vídeo',pageId:'12345678',videoId:'1824013938791734',
  whatsappPhone:'5515981732994',cityKey:'12345678',cityName:'Sorocaba',
  dailyBudgetCents:600,message:'Conheça nossa empresa e fale no WhatsApp.',headline:'Fale com a equipe'};
 const validated=validateAdsPlan('create_whatsapp',input);
 assert.equal(validated.videoId,input.videoId);
 assert.equal(validated.whatsappPhone,input.whatsappPhone);
 assert.equal(validated.dailyBudgetCents,600);
 assert.equal(validated.imageHash,undefined);
 for(const input2 of [{dailyBudgetCents:0},{dailyBudgetCents:50},
  {whatsappPhone:'15981817336'},{cityKey:''},{pageId:''},
  {videoId:'',imageHash:''},{videoId:'1111111',imageHash:'imagehash'}])
  assert.throws(()=>validateAdsPlan('create_whatsapp',{...input,...input2}),{status:422});
});
test('Sócio in-app importer defaults to incoming and prepares WhatsApp, never website ad',()=>{
 const ui=readFileSync(new URL('../public/socio-ad-skills-ui.js',import.meta.url),'utf8');
 assert.match(ui,/videoDirection\.value='incoming'/);
 assert.match(ui,/kind:'create_whatsapp'/);
 assert.match(ui,/dailyBudgetCents:Math\.round\(daily\*100\)/);
 assert.match(ui,/cityKey:cityKey\.value/);
 assert.match(ui,/videoId:uploadedVideoId/);
 assert.match(ui,/whatsappPhone:whatsapp\.value/);
 assert.match(ui,/api\('\/api\/marketing\/tools\/cities\?q='/);
 assert.match(ui,/if\(!uploadedVideoId\)return/);
 assert.doesNotMatch(ui,/kind:'create_ad'/);
 assert.match(ui,/Campanha criada PAUSADA na Meta/);
 assert.match(ui,/owner\/admin|proprietário\/admin/);
 const code=readFileSync(new URL('../meta-ads-tools.mjs',import.meta.url),'utf8');
 assert.match(code,/plan\.kind==='create_whatsapp'/);
 assert.match(code,/status:'PAUSED'/);
 assert.match(code,/video_data/);
});
