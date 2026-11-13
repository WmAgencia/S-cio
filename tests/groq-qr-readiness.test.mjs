import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groqReady,groqResponse,groqKnowledgeDraft,groqModel} from '../groq-client.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const env={GROQ_API_KEY:'fake-test-key-123456789012345678',GROQ_MODEL:'openai/gpt-oss-120b'};

test('Groq client falls back to another compatible model only on model errors',async()=>{
 let calls=[];
 const reply=await groqResponse({env,instructions:'Você ajuda clientes.',input:'Olá',fetchImpl:async(url,opts)=>{
  const body=JSON.parse(opts.body);calls.push({url,body});
  if(body.model==='openai/gpt-oss-120b')return {ok:false,status:404};
  return {ok:true,json:async()=>({choices:[{message:{content:'Como posso ajudar?'}}]})};
 }});
 assert.equal(reply.reply,'Como posso ajudar?');
 assert.equal(reply.model,'llama-3.3-70b-versatile');
 assert.equal(calls.length,2);
 assert.equal(calls[0].body.reasoning_effort,'low');
 assert.equal(calls[0].body.max_tokens>=240,true);
 assert.equal(calls[1].body.reasoning_effort,undefined);
 assert(calls.every(call=>call.url==='https://api.groq.com/openai/v1/chat/completions'));
});
test('each Groq use gets the model chosen for its job',async()=>{
 assert.equal(groqModel({}),'qwen/qwen3.8-27b','planning defaults to the top-scored model');
 assert.equal(groqModel({},'planning'),'qwen/qwen3.8-27b');
 assert.equal(groqModel({},'chat'),'openai/gpt-oss-20b','customer replies default to the fast model');
 assert.equal(groqModel({GROQ_MODEL:'llama-3.3-70b-versatile'},'planning'),'llama-3.3-70b-versatile');
 assert.equal(groqModel({GROQ_MODEL:'llama-3.3-70b-versatile'},'chat'),'openai/gpt-oss-20b',
  'the legacy variable no longer slows down customer replies');
 assert.equal(groqModel({GROQ_MODEL_CHAT:'openai/gpt-oss-120b'},'chat'),'openai/gpt-oss-120b');
 assert.equal(groqModel({GROQ_MODEL_PLANNING:'minimaxai/minimax-m2.7'},'planning'),'minimaxai/minimax-m2.7');
 const calls=[];
 await groqResponse({env,instructions:'Atenda o cliente.',input:'Olá',purpose:'chat',
  fetchImpl:async(_url,opts)=>{calls.push(JSON.parse(opts.body).model);
   return {ok:true,json:async()=>({choices:[{message:{content:'Olá! Como posso ajudar?'}}]})};}});
 assert.deepEqual(calls,['openai/gpt-oss-20b']);
 const planning=[];
 const planned=await groqResponse({env:{GROQ_API_KEY:env.GROQ_API_KEY},
  instructions:'Planeje a campanha.',input:'Campanha para moda em Sorocaba.',purpose:'planning',
  fetchImpl:async(_url,opts)=>{const body=JSON.parse(opts.body);planning.push({model:body.model,effort:body.reasoning_effort});
   if(body.model==='qwen/qwen3.8-27b')return {ok:false,status:404};
   return {ok:true,json:async()=>({choices:[{message:{content:'Plano aprovado.'}}]})};}});
 assert.deepEqual(planning,[{model:'qwen/qwen3.8-27b',effort:undefined},
  {model:'llama-3.3-70b-versatile',effort:undefined}],
  'planning uses Qwen first and keeps the existing fallback order');
 assert.equal(planned.reply,'Plano aprovado.');
});
test('Groq credentials and rate-limit failures never get mistaken for model errors',async()=>{
 for(const [status,expected] of [[401,/Credencial Groq rejeitada/],[429,/Limite de uso do Groq/]]){
  let count=0;
  await assert.rejects(groqResponse({env,instructions:'Teste',input:'Teste',fetchImpl:async()=>{
   count++;return {ok:false,status};
  }}),expected);
  assert.equal(count,1,'Must not retry on authentication or rate-limit failure');
 }
 await assert.rejects(groqResponse({env:{},instructions:'Teste',input:'Teste'}),/GROQ_API_KEY/);
});
test('Groq Markdown remains draft and identifies failed provider safely',async()=>{
 const markdown='# Rascunho de aprendizado\nEste é um rascunho preliminar para revisão.';
 const fallback=await groqKnowledgeDraft({markdown,report:{conversations:4,messages:30},env:{}});
 assert.equal(fallback.markdown,markdown);
 assert.equal(fallback.provider,'deterministic');
 const report=await groqKnowledgeDraft({markdown,report:{conversations:4},env,
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'# Conhecimento revisado\n'+
  'Recomendações de atendimento em português, revisáveis pela equipe e sem promessas não comprovadas.'.repeat(2)}}]})})
 });
 assert.equal(report.provider,'groq');
 assert.match(report.markdown,/Conhecimento revisado/);
});
test('WhatsApp QR UX can restart pending sessions and preserves real code requirement',()=>{
 const ui=source('public/socio-ux.js'),server=source('server.mjs');
 assert.match(ui,/data-qr-resume/);
 assert.match(ui,/socioQrRetry/);
 assert.match(ui,/x\.qrChecks>=8/);
 assert.match(ui,/\/api\/waakg\/channels\/'.*\/start/);
 assert.match(ui,/qrOk\(qr\.image\)/);
 assert.match(ui,/status\.connected/);
 assert.match(ui,/if\(active!==x\)return/);
 assert.match(server,/await ensureSessionProvisioned\(record\.session_id,record\.label\)/);
 assert.doesNotMatch(ui,/iVBORw0KGgo|QR_FICTICIO|QR fake/i);
});
