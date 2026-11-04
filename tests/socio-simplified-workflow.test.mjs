import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCnpj,validCnpj,mapCompanyRecord,lookupCompany} from '../cnpj-lookup.mjs';
import {groqReady,groqResponse,groqKnowledgeDraft} from '../groq-client.mjs';
import {startAutoTraining,autoTrainingStatus,processNextAutoTraining} from '../training-auto.mjs';
const root=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('only plausible Brazilian company identifiers enter public lookup',async()=>{
 assert.equal(normalizeCnpj('11.222.333/0001-81'),'11222333000181');
 assert.equal(validCnpj('11.222.333/0001-81'),true);
 assert.equal(validCnpj('11.111.111/1111-11'),false);
 assert.equal(validCnpj('11222333000180'),false);
 let requested='';
 const record=await lookupCompany('11.222.333/0001-81',{fetchImpl:async(url)=>{
  requested=url;
  return {ok:true,status:200,json:async()=>({
   razao_social:'Empresa Exemplo Ltda',nome_fantasia:'Empresa Exemplo',
   email:'contato@empresa.exemplo',municipio:'Sorocaba',uf:'SP',logradouro:'Rua Central',
   bairro:'Centro',cep:'18000000',cnae_fiscal_descricao:'Serviços de tecnologia'
  })};
 }});
 assert.match(requested,/brasilapi\.com\.br\/api\/cnpj\/v1\/11222333000181/);
 assert.equal(record.company,'Empresa Exemplo');
 assert.equal(record.legalName,'Empresa Exemplo Ltda');
 assert.equal(record.address.state,'SP');
 assert.equal(record.address.city,'Sorocaba');
 assert.equal('qsa' in record,false,'No private stakeholder data in tenant onboarding');
 await assert.rejects(lookupCompany('00000000000000',{fetchImpl:()=>{throw Error('Network should not be reached');}}),/inválido/);
});
test('Groq uses the same official provider/model as Prospector and fails safely without a key',async()=>{
 assert.equal(groqReady({}),false);
 await assert.rejects(groqResponse({instructions:'Teste',input:'Olá',env:{}}),/GROQ_API_KEY/);
 const env={GROQ_API_KEY:'test-key-not-real-example-12345',GROQ_MODEL:'openai/gpt-oss-120b'};
 let request;
 const response=await groqResponse({instructions:'Assistente de testes',input:'Bom dia',env,fetchImpl:async(url,opts)=>{
  request={url,body:JSON.parse(opts.body),headers:opts.headers};
  return {ok:true,json:async()=>({choices:[{message:{content:'Olá, como posso ajudar?'}}]})};
 }});
 assert.equal(response.reply,'Olá, como posso ajudar?');
 assert.equal(response.model,'openai/gpt-oss-120b');
 assert.equal(request.url,'https://api.groq.com/openai/v1/chat/completions');
 assert.equal(request.body.model,'openai/gpt-oss-120b');
 assert.equal(request.body.messages[0].role,'system');
 assert.equal(request.body.messages[1].role,'user');
 assert.equal(request.body.stream,false);
 assert.equal(request.headers.Authorization,'Bearer '+env.GROQ_API_KEY);
 const fallback=await groqKnowledgeDraft({markdown:'# Rascunho\\nConteúdo',report:{conversations:5},env:{}});
 assert.equal(fallback.provider,'deterministic');
 assert.equal(fallback.model,null);
});
test('one-button connected history pipeline is tenant scoped and read-only',async()=>{
 let started=false;
 const tenantId='11111111-1111-4111-8111-111111111111';
 const channelId='22222222-2222-4222-8222-222222222222';
 const scanId='33333333-3333-4333-8333-333333333333';
 const log=[];
 const client={query:async(sql,params=[])=>{
  log.push({sql,params});
  if(sql.startsWith('SELECT id FROM training_auto_runs'))return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT id FROM training_jobs'))return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT id FROM waakg_scans'))return {rows:[],rowCount:0};
  return {rows:[],rowCount:1};
 },release(){}};
 const pool={
  connect:async()=>client,
  query:async(sql,params)=>{
   log.push({sql,params});
   if(sql.includes('FROM waakg_links l'))return {rows:[{id:channelId,session_id:'socio_session',phone:'5515999999999'}],rowCount:1};
   if(sql.startsWith('SELECT id,status,scan_ids'))return {rows:[],rowCount:0};
   return {rows:[],rowCount:0};
  }
 };
 const run=await startAutoTraining(pool,tenantId,{
  configured:()=>true,getStatus:async()=>({connected:true,connectedNumber:'5515999999999'})
 });
 assert.equal(run.status,'scanning');
 assert.equal(run.connectedChannels,1);
 assert(log.some(x=>x.sql.includes('INSERT INTO waakg_scans')));
 assert(log.some(x=>x.sql.includes('INSERT INTO training_auto_runs')));
 assert(log.some(x=>x.sql.includes('WHERE l.tenant_id=$1')));
 const missing=await autoTrainingStatus(pool,tenantId);
 assert.equal(missing,null);
});
test('simplified UI has QR modal, no duplicate WhatsApp menu and master-only companies',()=>{
 const html=root('public/index.html'),js=root('public/app.js'),inbox=root('public/inbox.js');
 const ux=root('public/socio-ux.js'),css=root('public/socio-ux.css'),server=root('server.mjs');
 assert.match(html,/data-view="inbox"[^>]*>[^<]*<span[^>]*>[^<]*<\/span> WhatsApp<\/button>/);
 assert.doesNotMatch(html,/data-view="channels"/);
 assert.match(html,/id="teamNav"/);
 assert.match(js,/teamNav.*platformOwner/);
 assert.match(js,/dashboardConnectWhatsApp/);
 assert.match(js,/socio-connected-list/);
 assert.doesNotMatch(js,/Gerado ao conectar/);
 assert.match(inbox,/data-inbox-connect/);
 assert.match(ux,/waakg\/channels\/connect/);
 assert.match(ux,/waakg\/channels\/.*\/qr/);
 assert.match(css,/socio-popup-backdrop/);
 assert.match(js,/id="newProduct"/);
 assert.match(js,/id="productModal"/);
 assert.match(js,/id="newVariantRows"/);
 assert.match(js,/id="companyModal"/);
 assert.match(js,/id="lookupCnpj"/);
 assert.match(js,/id="startAutoTraining"/);
 assert.match(server,/path.*api\/admin\/cnpj/);
 assert.match(server,/startAutoTraining/);
 assert.match(server,/messagesReceivedToday/);
 assert.match(server,/groqResponse/);
});
