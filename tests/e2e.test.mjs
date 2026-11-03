
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {zipStore} from './zip-helper.mjs';
const enabled=!!process.env.DATABASE_URL;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real PostgreSQL: login, tenant isolation, imports and webhook signature protections',{skip:!enabled,timeout:35000},async t=>{
 const port=38475;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',x=>logs+=x.toString());
 t.after(()=>{child.kill('SIGTERM');});
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

 const ag=await call('/api/agent','GET',undefined,betaCookie);
 assert.doesNotMatch(ag.result.knowledge_md,/Alice|15981142577|Nome Comprador|cliente-1\.txt/);
 const webhook=await call('/webhooks/whatsapp','POST',{object:'whatsapp_business_account'});
 assert.equal(webhook.status,503);
 const noAI=await call('/api/simulate','POST',{message:'Qual o preço?'},betaCookie,betaCsrf);
 assert.equal(noAI.status,503);
});
