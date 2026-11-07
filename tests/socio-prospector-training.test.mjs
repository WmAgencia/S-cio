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
 assert.equal(answer.step,'audience');
 assert.equal((await getSocioInterview(db,b)).step,'company');
 assert(!JSON.stringify(await getSocioInterview(db,b)).includes('Empresa A'));
 assert.equal((await resetSocioInterview(db,a)).knowledgePreserved,true);
 assert.equal(await getSocioInterview(db,a),null);
 assert.equal((await getSocioInterview(db,b)).mode,'text');
});
test('service-adaptive interview creates Markdown DRAFT and never activates agent or sends WhatsApp',async()=>{
 const db=fakeDb(),tenant=randomUUID();
 await startSocioInterview(db,tenant,'text');
 const sample={
 company:'Aquarela Studio',audience:'Pequenas empresas',services:'sites, design gráfico',
 service_detail:'Site profissional em até 5 dias',service_price:'R$ 500',
 region:'Sorocaba e Brasil',process:'Revisão antes da entrega',qualify:'Qual o objetivo?',
 style:'Clara e próxima',objections:'Mostrar portfólio e pedir aprovação',
 social_proof:'https://exemplo.com.br',handoff:'Quando solicitar orçamento',
 restrictions:'Nunca dar descontos',notification:'depois',closing_mode:'1',approach:'3'
 };
 let state;
 for(let i=0;i<40;i++){
  state=await getSocioInterview(db,tenant);
  if(state.completed)break;
  let response=sample[state.step];
  if(state.step==='service_detail'&&state.messages.some(x=>x.body==='R$ 500'))response='Design e prazo conforme briefing';
  if(state.step==='service_price'&&state.messages.some(x=>x.body==='R$ 500'))response='A partir de R$ 300';
  assert(response,'Unexpected step: '+state.step);
  const next=await advanceSocioInterview(db,tenant,response);
  if(next.completed)break;
 }
 const after=await getSocioInterview(db,tenant);
 assert.equal(after.completed,true);
 assert.equal(after.progress,100);
 assert.equal(db.versions.length,1);
 assert.equal(db.versions[0].status,'draft');
 assert.match(db.versions[0].markdown,/Aquarela Studio/);
 assert.match(db.versions[0].markdown,/site/i);
 assert.match(db.versions[0].markdown,/design/i);
 assert.match(db.versions[0].markdown,/Revisão do responsável|Somente contatos|Primeira resposta|primeira resposta/i);
 assert.equal(db.jobs[0].report.source,'prospector_interview');
 assert(!db.queries.some(q=>/UPDATE agents|INSERT INTO messages|UPDATE campaigns|DELETE FROM training_versions/i.test(q.sql)));
 await assert.rejects(advanceSocioInterview(db,tenant,'outro comando'),{status:409});
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
 assert.match(ui,//api/training/versions//);
 assert.match(ui,/X-CSRF-Token/);
 assert.match(ui,/Aprender também com o histórico do WhatsApp/);
 assert.match(ui,/window\.confirm/);
 assert.match(server,//api/training/interview/audio/);
 assert.match(server,/needRole\(a,\['owner','admin'\]\)/);
 assert.match(schema,/socio_training_interviews/);
 assert.match(main,/SocioInterviewUI\.mount/);
 assert.match(main,/api\('/api/training/auto'/);
});
