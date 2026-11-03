
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
const enabled=!!process.env.DATABASE_URL;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real PostgreSQL: login, tenant isolation, imports and webhook signature protections',{skip:!enabled,timeout:35000},async t=>{
 const port=38475;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),NODE_ENV:'test',META_APP_SECRET:'test-app-secret'},stdio:['ignore','pipe','pipe']});
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
 const ag=await call('/api/agent','GET',undefined,betaCookie);
 assert.doesNotMatch(ag.result.knowledge_md,/Alice|15981142577/);
 
 const invalidLink=await call('/api/channels','POST',{label:'Canal B',phone:'5515998114257',externalPhoneId:'1234567890123'},betaCookie,betaCsrf);
 assert.equal(invalidLink.status,422);
 const chan=await call('/api/channels','POST',{label:'Canal B',phone:'5515998114257'},betaCookie,betaCsrf);
 assert.equal(chan.status,201);
 const auto=await call('/api/channels/'+chan.result.id+'/auto','POST',{enabled:true},betaCookie,betaCsrf);
 assert.equal(auto.status,409);
 const sql=new Pool({connectionString:process.env.DATABASE_URL});
 t.after(()=>sql.end());
 // A provider-validated ID can only be provisioned after server-side Meta verification.
 // This fixture simulates a channel already verified by Consecom.
 await sql.query("UPDATE channels SET external_phone_id=$2 WHERE id=$1",[chan.result.id,'1234567890123']);
 const payload={
  object:'whatsapp_business_account',
  entry:[{changes:[{value:{metadata:{phone_number_id:'1234567890123'},contacts:[{profile:{name:'Cliente teste'}}],messages:[{id:'wamid.inbound.1',from:'5515999999999',type:'text',text:{body:'Olá, quanto custa?'}}]}}]}]
 };
 const raw=JSON.stringify(payload),signature='sha256='+createHmac('sha256','test-app-secret').update(raw).digest('hex');
 const send=async(sig)=>fetch(base+'/webhooks/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sig},body:raw});
 assert.equal((await send('sha256=invalid')).status,403);
 assert.equal((await send(signature)).status,200);
 assert.equal((await send(signature)).status,200);
 const received=await call('/api/inbox','GET',undefined,betaCookie);
 assert.equal(received.result.length,1);
 const thread=await call('/api/conversations/'+received.result[0].id+'/messages','GET',undefined,betaCookie);
 assert.equal(thread.result.messages.length,1,'duplicate inbound deliveries must be idempotent');
 assert.equal(thread.result.jobs.length,0,'AI starts off by default');
 const rejectedReply=await call('/api/conversations/'+received.result[0].id+'/reply','POST',{text:'Olá, tudo bem?'},betaCookie,betaCsrf);
 assert.equal(rejectedReply.status,409,'manual sending without verified access token must be blocked');

 const noAI=await call('/api/simulate','POST',{message:'Qual o preço?'},betaCookie,betaCsrf);
 assert.equal(noAI.status,503);
});
