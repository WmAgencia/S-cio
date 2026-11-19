import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {startSocioInterview,getSocioInterview,advanceSocioInterview,resetSocioInterview,transcribeSocioTraining} from '../socio-training-interview.mjs';

function fakeDb(){
 const store=new Map(),jobs=[],versions=[],queries=[];
 const client={async query(sql,values=[]){
  queries.push({sql,values});
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO socio_training_interviews')){
   store.set(values[0],JSON.parse(values[1]));return {rowCount:1};
  }
  if(sql.startsWith('SELECT state FROM socio_training_interviews')){
   const state=store.get(values[0]);return {rows:state?[{state:structuredClone(state)}]:[],rowCount:state?1:0};
  }
  if(sql.startsWith('UPDATE socio_training_interviews')){
   store.set(values[0],JSON.parse(values[1]));return {rowCount:1};
  }
  if(sql.startsWith('DELETE FROM socio_training_interviews')){
   store.delete(values[0]);return {rowCount:1};
  }
  if(sql.startsWith('SELECT id FROM tenants'))return {rows:[{id:values[0]}],rowCount:1};
  if(sql.startsWith('SELECT COALESCE(MAX(version)'))return {rows:[{next:versions.filter(v=>v.tenant===values[0]).length+1}],rowCount:1};
  if(sql.startsWith('INSERT INTO training_jobs')){
   jobs.push({id:values[0],tenant:values[1],report:JSON.parse(values[2])});return {rowCount:1};
  }
  if(sql.startsWith('INSERT INTO training_versions')){
   versions.push({id:values[0],tenant:values[1],job:values[2],version:values[3],status:'draft',markdown:values[4]});return {rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql);
 },release(){}};
 return {query:(...args)=>client.query(...args),connect:async()=>client,store,jobs,versions,queries};
}
test('starts same Prospector chat/voice guided questions for each tenant separately',async()=>{
 const db=fakeDb(),a=randomUUID(),b=randomUUID();
 const x=await startSocioInterview(db,a,'voice');
 assert.equal(x.step,'company');
 assert.equal(x.mode,'voice');assert.match(x.question,/empresa/i);
 await startSocioInterview(db,b,'text');
 const answer=await advanceSocioInterview(db,a,'Empresa A');
 assert.equal(answer.step,'services');
 assert.equal((await getSocioInterview(db,b)).step,'company');
 assert(!JSON.stringify(await getSocioInterview(db,b)).includes('Empresa A'));
 assert.equal((await resetSocioInterview(db,a)).knowledgePreserved,true);
 assert.equal(await getSocioInterview(db,a),null);
 assert.equal((await getSocioInterview(db,b)).mode,'text');
});
test('guided interview creates Markdown DRAFT and never activates agent or sends WhatsApp',async()=>{
 const db=fakeDb(),tenant=randomUUID();
 await startSocioInterview(db,tenant,'text');
 // Twelve blocks, each answered by tapping the option the screen offers.
 const answers=['Aquarela Studio — design e sites','sites, design gráfico',
  'Site com até 5 páginas, entrega em 5 dias','R$ 500',
  'Logo e identidade visual','R$ 300',
  '1','2','1','https://exemplo.com.br','1,3','Nunca dar descontos','1','pix,card','1','2'];
 let state;
 for(let i=0;i<40;i++){
  state=await getSocioInterview(db,tenant);
  if(state.completed)break;
  const response=answers.shift();
  assert(response,'Unexpected step: '+state.step);
  const next=await advanceSocioInterview(db,tenant,response);
  if(next.completed)break;
 }
 const after=await getSocioInterview(db,tenant);
 assert.equal(after.completed,true);
 assert.equal(after.progress,100);
 assert.equal(db.versions.length,1);
 assert.equal(db.versions[0].status,'draft');
 const manual=db.versions[0].markdown;
 assert.match(manual,/Aquarela Studio/);
 assert.match(manual,/sites/);
 assert.match(manual,/design/i);
 assert.match(manual,/R\$ 500/);
 assert.match(manual,/PIX, Cartão/);
 assert.match(manual,/Pede orçamento ou valor fechado/);
 assert.match(manual,/Vou chamar a equipe/);
 assert.match(manual,/Vou confirmar isso com a equipe/);
 assert.equal(db.jobs[0].report.source,'guided_interview');
 assert(!db.queries.some(q=>/UPDATE agents|INSERT INTO messages|UPDATE campaigns|DELETE FROM training_versions/i.test(q.sql)));
 await assert.rejects(advanceSocioInterview(db,tenant,'outro comando'),{status:409});
});

test('each choice block offers tappable options and accepts a free word',async()=>{
 const db=fakeDb(),tenant=randomUUID();
 await startSocioInterview(db,tenant,'text');
 await advanceSocioInterview(db,tenant,'Aquarela Studio');
 await advanceSocioInterview(db,tenant,'sites');
 await advanceSocioInterview(db,tenant,'Site em 5 dias');
 const price=await advanceSocioInterview(db,tenant,'R$ 500');
 assert.equal(price.step,'process');
 assert(price.choices.length>=3,'o passo de contratação mostra opções');
 assert(price.choices.every(x=>x.id&&x.label));
 // A free description at a choice step is refused, with the reason.
 await assert.rejects(advanceSocioInterview(db,tenant,'mediria'),{status:422});
 const style=await advanceSocioInterview(db,tenant,'1');
 assert.equal(style.step,'style');
 assert(style.choices.length>=3);
 const objections=await advanceSocioInterview(db,tenant,'2');
 assert.equal(objections.step,'objections');
 const proof=await advanceSocioInterview(db,tenant,'3');
 assert.equal(proof.step,'proof');
 const handoff=await advanceSocioInterview(db,tenant,'https://exemplo.com.br');
 assert.equal(handoff.step,'handoff');
 assert.equal(handoff.multiple,true,'o passo de encaminhamento é múltipla escolha');
 assert(handoff.choices.length>=4);
 const restrictions=await advanceSocioInterview(db,tenant,'1,3,4');
 assert.equal(restrictions.step,'restrictions');
 // An answer outside the offered options is refused with a clear message.
 const closing=await advanceSocioInterview(db,tenant,'Não prometer desconto');
 assert.equal(closing.step,'closing');
 await assert.rejects(advanceSocioInterview(db,tenant,'nao sei'),{status:422});
});
test('voice transcription validates size, auth configuration, type and reports literal text without persistence',async()=>{
 const bytes=Buffer.alloc(100,65);
 await assert.rejects(transcribeSocioTraining(bytes,'application/zip'),{status:422});
 await assert.rejects(transcribeSocioTraining(bytes,'audio/webm',{env:{}}),{status:503});
 let requested=false;
 const response=await transcribeSocioTraining(bytes,'audio/webm',{env:{GROQ_API_KEY:'mock-key-not-real-123456789'},
  request:async(url,opts)=>{
   requested=true;assert.match(url,/audio\/transcriptions/);
   assert.equal(opts.method,'POST');
   assert.match(opts.headers.Authorization,/Bearer mock-key/);
   return {ok:true,json:async()=>({text:'Quero que meu atendimento seja objetivo.'})};
  }});
 assert.equal(requested,true);assert.equal(response.approved,false);
 assert.match(response.text,/objetivo/);
});
test('UI has Prospector palette, opt-in voice/text training, CSRF and review-before-use with old functions intact',()=>{
 const root=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const html=root('public/index.html'),ui=root('public/socio-interview-ui.js'),style=root('public/prospector-socio.css');
 const server=root('server.mjs'),schema=root('schema.sql'),main=root('public/app.js');
 assert.match(html,/prospector-socio.css/);
 assert.match(html,/socio-interview-ui.js/);
 assert.ok(html.indexOf('/prospector-socio.css')>html.indexOf('/ember-theme.css'));
 assert.match(style,/--purple:#6738f7/);
 assert.match(style,/prefers-reduced-motion/);
 assert.match(ui,/data-ps-start="voice"/);
 assert.match(ui,/data-ps-start="text"/);
 assert.ok(ui.includes('/api/training/versions/'));
 assert.match(ui,/X-CSRF-Token/);
 assert.match(ui,/Aprender também com o histórico do WhatsApp/);
 assert.match(ui,/window\.confirm/);
 assert.ok(server.includes('/api/training/interview/audio'));
 assert.match(server,/needRole\(a,\['owner','admin'\]\)/);
 assert.match(schema,/socio_training_interviews/);
 assert.match(main,/SocioInterviewUI\.mount/);
 assert.ok(main.includes("api('/api/training/auto'"));
});
