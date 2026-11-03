
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {zipStore} from './zip-helper.mjs';
const enabled=!!process.env.DATABASE_URL;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real PostgreSQL: login, tenant isolation, imports and webhook signature protections',{skip:!enabled,timeout:65000},async t=>{
 const port=38475,waPort=38476,waKey='mock-readonly-waakg-key',waSession='socioFixture123',waPhone='5515999999999',waJid=waPhone+'@s.whatsapp.net';
 const gatewayRequests=[];
 const fakeGateway=createServer((req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost'),path=url.pathname;
  gatewayRequests.push({path,method:req.method});
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.headers['x-api-key']!==waKey)return send(401,{status:false});
  if(path==='/api/sessions/'+waSession)return send(200,{status:true,data:{sessionId:waSession,status:'CONNECTED',me:{id:waPhone+':1@s.whatsapp.net'}}});
  if(path==='/api/chat/'+waSession)return send(200,{status:true,data:[{jid:waJid,name:'Nome particular'}, {jid:'551500000000@g.us',name:'Grupo privado'}]});
  if(path==='/api/messages/'+waSession+'/search'&&url.searchParams.get('jid')===waJid){
   return send(200,{status:true,data:[
    {remoteJid:waJid,fromMe:false,keyId:'a',timestamp:'2026-11-03T12:00:00Z',type:'TEXT',content:'Bom dia! Qual o preço do produto?'},
    {remoteJid:waJid,fromMe:true,keyId:'b',timestamp:'2026-11-03T12:01:00Z',type:'TEXT',content:'Olá! O preço oficial está no catálogo.'},
    {remoteJid:waJid,fromMe:false,keyId:'c',timestamp:'2026-11-03T12:02:00Z',type:'TEXT',content:'Gostaria de fazer um pedido.'},
    {remoteJid:waJid,fromMe:true,keyId:'d',timestamp:'2026-11-03T12:03:00Z',type:'IMAGE',content:'Foto privada'}
   ],pagination:{total:4,page:1,limit:100}});
  }
  return send(404,{status:false});
 });
 await new Promise(resolve=>fakeGateway.listen(waPort,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['server.mjs'],{
  env:{...process.env,PORT:String(port),NODE_ENV:'test',
   WA_AKG_BASE_URL:'http://127.0.0.1:'+waPort,WA_AKG_API_KEY:waKey,
   CHANNEL_ENCRYPTION_KEY:'0123456789abcdef0123456789abcdef0123456789abcdef'},
  stdio:['ignore','pipe','pipe']
 });
 let logs='';child.stderr.on('data',x=>logs+=x.toString());
 t.after(()=>{child.kill('SIGTERM');fakeGateway.close();});
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<80;i++){
  try{const r=await fetch(base+'/health');if(r.ok){ready=true;break;}}catch{}
  if(child.exitCode!==null)break;
  await sleep(200);
 }
 assert.ok(ready,'server did not start: '+logs);
 async function call(path,method='GET',data,cookie='',csrf=''){
  const headers={Origin:base};
  if(data!==undefined)headers['Content-Type']='application/json';
  if(csrf)headers['X-CSRF-Token']=csrf;
  if(cookie)headers.Cookie=cookie;
  const resp=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  const result=await resp.json();return {status:resp.status,result,cookie:resp.headers.get('set-cookie')||''};
 }
 const setup=await call('/api/setup','POST',{setupToken:process.env.SETUP_TOKEN,name:'Administradora',company:'Consecom QA',email:'qa-owner@test.invalid',password:'SenhaMuitoForte2026!'});
 assert.equal(setup.status,201,JSON.stringify(setup.result));
 const adminCookie=setup.cookie.split(';')[0],csrf=setup.result.csrf;
 const me=await call('/api/me','GET',undefined,adminCookie);
 assert.equal(me.result.user.platformOwner,true);
 const alpha=await call('/api/products','POST',{name:'Site Institucional',description:'Site responsivo',priceCents:49700},adminCookie,csrf);
 assert.equal(alpha.status,201);
 const alphaId=alpha.result.id;
 const foreign=await call('/api/admin/tenants','POST',{company:'Pizzaria Beta',ownerName:'Dono Beta',ownerEmail:'beta@test.invalid',ownerPassword:'SenhaBetaMuitoForte2026',plan:'essencial'},adminCookie,csrf);
 assert.equal(foreign.status,201);
 const switchTenant=await call('/api/admin/switch','POST',{tenantId:foreign.result.id},adminCookie,csrf);
 assert.equal(switchTenant.status,200);
 const betaProducts=await call('/api/products','GET',undefined,adminCookie);
 assert.equal(betaProducts.result.length,0);
 const crossUpdate=await call('/api/products/'+alphaId,'PATCH',{name:'Produto atacado',description:'',priceCents:1,active:true},adminCookie,csrf);
 assert.equal(crossUpdate.status,404);
 const betaLogin=await call('/api/login','POST',{email:'beta@test.invalid',password:'SenhaBetaMuitoForte2026'});
 assert.equal(betaLogin.status,200);
 const betaCookie=betaLogin.cookie.split(';')[0],betaCsrf=betaLogin.result.csrf;
 const forbidden=await call('/api/admin/tenants','GET',undefined,betaCookie);
 assert.equal(forbidden.status,403);
 const missingCsrf=await call('/api/products','POST',{name:'Produto',priceCents:500},betaCookie);
 assert.equal(missingCsrf.status,403);
 const valid=await call('/api/products','POST',{name:'Pizza',priceCents:3990},betaCookie,betaCsrf);
 assert.equal(valid.status,201);
 const my=await call('/api/products','GET',undefined,betaCookie);
 assert.equal(my.result.length,1);
 const malformed=await call('/api/imports','POST',{filename:'chat.txt',content:'texto que não é uma conversa'},betaCookie,betaCsrf);
 assert.equal(malformed.status,422);
 const imported=await call('/api/imports','POST',{filename:'chat.txt',content:'[03/11/2026, 11:01] Alice: Olá tudo bem\n[03/11/2026, 11:02] Atendente: Temos opções a partir de hoje\n[03/11/2026, 11:03] Alice: Pode enviar cardápio para 15981142577'},betaCookie,betaCsrf);
 assert.equal(imported.status,201);
 const exported='[03/11/2026, 12:01] Nome Comprador: Quero reservar a pizza de calabresa\n[03/11/2026, 12:02] Vendas: Claro! Qual tamanho?\n[03/11/2026, 12:03] Nome Comprador: A grande, por favor';
 const archive=zipStore([['cliente-1.txt',exported],['cliente-2.txt',exported],['foto.jpg','ignore media']]);
 const zipResult=await call('/api/imports/zip','POST',{filename:'exportacao.zip',contentBase64:archive},betaCookie,betaCsrf);
 assert.equal(zipResult.status,201,JSON.stringify(zipResult.result));
 assert.equal(zipResult.result.conversationCount,2);
 const list=await call('/api/imports','GET',undefined,betaCookie);
 assert.equal(list.result.length,3);

 const beforeApproval=await call('/api/agent','GET',undefined,betaCookie);
 assert.equal(beforeApproval.result.knowledge_md,'','Imported examples must not change active knowledge before approval');
 // The new training pipeline keeps results in DRAFT until explicit approval.
 const start=await call('/api/training/jobs','POST',{},betaCookie,betaCsrf);
 assert.equal(start.status,201,JSON.stringify(start.result));
 assert.equal(start.result.source,'imports_only');
 const duplicateJob=await call('/api/training/jobs','POST',{},betaCookie,betaCsrf);
 assert.equal(duplicateJob.status,409);
 const invalidApproval=await call('/api/training/versions/00000000-0000-0000-0000-000000000001/approve','POST',{},betaCookie,betaCsrf);
 assert.equal(invalidApproval.status,409);
 let last={};
 for(let i=0;i<60;i++){
  const jobs=await call('/api/training/jobs','GET',undefined,betaCookie);
  assert.equal(jobs.status,200);
  last=jobs.result[0];
  if(last?.status==='completed')break;
  await sleep(220);
 }
 assert.equal(last.status,'completed','training job remained unfinished: '+JSON.stringify(last));
 assert.equal(last.processedItems,last.totalItems);
 const versions=await call('/api/training/versions','GET',undefined,betaCookie);
 assert.equal(versions.status,200);
 assert.equal(versions.result[0].status,'draft');
 assert.equal(versions.result[0].report.salesValidated,false);
 assert.match(versions.result[0].markdown,/rascunho/);
 const approval=await call('/api/training/versions/'+versions.result[0].id+'/approve','POST',{},betaCookie,betaCsrf);
 assert.equal(approval.status,200);
 assert.equal(approval.result.autoReply,false);
 const revised=await call('/api/agent','GET',undefined,betaCookie);
 assert.match(revised.result.knowledge_md,/Conhecimento do Sócio/);
 const wrongTenant=await call('/api/admin/switch','POST',{tenantId:me.result.tenant.id},adminCookie,csrf);
 assert.equal(wrongTenant.status,200);
 const alphaJobs=await call('/api/training/jobs','GET',undefined,adminCookie);
 assert.deepEqual(alphaJobs.result,[]);
 const otherTenantApprove=await call('/api/training/versions/'+versions.result[0].id+'/approve','POST',{},adminCookie,csrf);
 assert.equal(otherTenantApprove.status,409);


 // WA-AKG historical imports are opt-in and read-only. Only the Consecom
 // operator can bind an existing gateway session to a verified number.
 const forbiddenBind=await call('/api/waakg/channels/link','POST',{sessionId:waSession,label:'Vendas 1',phone:waPhone},betaCookie,betaCsrf);
 assert.equal(forbiddenBind.status,403);
 const assignToBeta=await call('/api/admin/switch','POST',{tenantId:foreign.result.id},adminCookie,csrf);
 assert.equal(assignToBeta.status,200);
 const phoneMismatch=await call('/api/waakg/channels/link','POST',{sessionId:waSession,label:'Vendas 1',phone:'5515999999998'},adminCookie,csrf);
 assert.equal(phoneMismatch.status,422);
 const bound=await call('/api/waakg/channels/link','POST',{sessionId:waSession,label:'Vendas 1',phone:waPhone},adminCookie,csrf);
 assert.equal(bound.status,201,JSON.stringify(bound.result));
 const waChannelId=bound.result.id;
 const verified=await call('/api/waakg/channels/'+waChannelId+'/status','GET',undefined,betaCookie);
 assert.equal(verified.status,200);
 assert.equal(verified.result.connected,true);
 const sync=await call('/api/waakg/scans','POST',{channelId:waChannelId},betaCookie,betaCsrf);
 assert.equal(sync.status,201,JSON.stringify(sync.result));
 const duplicateScan=await call('/api/waakg/scans','POST',{channelId:waChannelId},betaCookie,betaCsrf);
 assert.equal(duplicateScan.status,409);
 let stateSync;
 for(let i=0;i<75;i++){
  const result=await call('/api/waakg/scans','GET',undefined,betaCookie);
  stateSync=result.result[0];
  if(stateSync.status==='completed'||stateSync.status==='failed')break;
  await sleep(220);
 }
 assert.equal(stateSync.status,'completed','WA-AKG scan not complete: '+JSON.stringify(stateSync)+' server: '+logs.slice(-450));
 assert.equal(stateSync.totalChats,1);
 assert.equal(stateSync.processedChats,1);
 assert.equal(stateSync.importedChats,1);
 assert.equal(stateSync.importedMessages,3);
 const allImports=await call('/api/imports','GET',undefined,betaCookie);
 assert.equal(allImports.result.length,4);
 assert(!allImports.result.some(x=>String(x.filename).includes(waPhone)||String(x.filename).includes(waJid)));
 assert(gatewayRequests.every(x=>x.method==='GET'),'WA-AKG scanner unexpectedly wrote to gateway');
 const knowledgeAfterSync=await call('/api/agent','GET',undefined,betaCookie);
 assert(!knowledgeAfterSync.result.knowledge_md.includes('Gostaria de fazer um pedido'),
  'WA-AKG imports must remain out of active agent knowledge until approval');
 await call('/api/admin/switch','POST',{tenantId:me.result.tenant.id},adminCookie,csrf);
 const otherTenantLinks=await call('/api/waakg/channels','GET',undefined,adminCookie);
 assert.deepEqual(otherTenantLinks.result,[]);
 const crossSync=await call('/api/waakg/scans','POST',{channelId:waChannelId},adminCookie,csrf);
 assert.equal(crossSync.status,404);
 const crossStatus=await call('/api/waakg/channels/'+waChannelId+'/status','GET',undefined,adminCookie);
 assert.equal(crossStatus.status,404);

 const ag=await call('/api/agent','GET',undefined,betaCookie);
 assert.doesNotMatch(ag.result.knowledge_md,/Alice|15981142577|Nome Comprador|cliente-1\.txt/);
 const webhook=await call('/webhooks/whatsapp','POST',{object:'whatsapp_business_account'});
 assert.equal(webhook.status,503);
 const noAI=await call('/api/simulate','POST',{message:'Qual o preço?'},betaCookie,betaCsrf);
 assert.equal(noAI.status,503);
});
