
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {zipStore} from './zip-helper.mjs';
import sharp from 'sharp';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
const enabled=!!process.env.DATABASE_URL;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real PostgreSQL: login, tenant isolation, imports and webhook signature protections',{skip:!enabled,timeout:65000},async t=>{
 const port=38475,waPort=38476,waKey='mock-readonly-waakg-key',waSession='socioFixture123',waPhone='5515999999999',waJid=waPhone+'@s.whatsapp.net';
 const gatewayRequests=[],dynamicSessions=new Map(),dynamicPhone='5515888888888';
 const fakeGateway=createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost'),path=url.pathname;
  gatewayRequests.push({path,method:req.method});
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.headers['x-api-key']!==waKey)return send(401,{status:false});

  if(req.method==='POST'&&path==='/api/sessions'){
   const parts=[];for await(const part of req)parts.push(part);
   const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
   if(!/^socio_[0-9a-f]{40}$/.test(payload.sessionId))return send(422,{status:false});
   dynamicSessions.set(payload.sessionId,{connected:false,started:false,botDisabled:false,name:payload.name});
   return send(200,{status:true,data:{sessionId:payload.sessionId,name:payload.name}});
  }
  const match=path.match(/^\/api\/sessions\/(socio_[0-9a-f]{40})(?:\/(bot-config|start|restart|stop|logout|qr))?$/);
  if(match){
   const item=dynamicSessions.get(match[1]);
   if(!item)return send(404,{status:false});
   const action=match[2];
   if(req.method==='GET'&&!action)return send(200,{status:true,data:{
    sessionId:match[1],status:item.connected?'CONNECTED':item.started?'SCAN_QR':'STOPPED',
    me:item.connected?{id:dynamicPhone+':1@s.whatsapp.net'}:null}});
   if(req.method==='POST'&&action==='bot-config'){
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
    item.botDisabled=body.enabled===false;
    return send(200,{status:true,data:{enabled:item.botDisabled===false}});
   }
   if(req.method==='GET'&&action==='bot-config')return send(200,{status:true,data:{enabled:!item.botDisabled}});
   if(req.method==='POST'&&['start','restart','stop','logout'].includes(action)){
    if(['start','restart'].includes(action))item.started=true;
    if(['stop','logout'].includes(action)){item.started=false;item.connected=false;}
    return send(200,{status:true});
   }
   if(req.method==='GET'&&action==='qr')return send(200,{success:true,
    base64:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='});
  }

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
   CHANNEL_ENCRYPTION_KEY:'0123456789abcdef0123456789abcdef0123456789abcdef',
   SOCIO_STORAGE_DRIVER:'memory'},
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
 const lavenderCSS=await fetch(base+'/cloud-theme.css');
 assert.equal(lavenderCSS.status,200,'Lavender stylesheet must be served in production');
 assert.match(lavenderCSS.headers.get('content-type')||'',/text\/css/);
 assert.match(await lavenderCSS.text(),/\.lucid-dashboard/);
 const approvedCSS=await fetch(base+'/ember-theme.css');
 assert.equal(approvedCSS.status,200,'Approved espresso theme must be served');
 assert.match(approvedCSS.headers.get('content-type')||'',/text\/css/);
 assert.match(await approvedCSS.text(),/\.ember-dashboard/);
 const unifiedPopup=await fetch(base+'/socio-ux.js');
 assert.equal(unifiedPopup.status,200);
 assert.match(await unifiedPopup.text(),/openQr/);
 const popupCSS=await fetch(base+'/socio-ux.css');
 assert.equal(popupCSS.status,200);
 assert.match(await popupCSS.text(),/socio-popup-backdrop/);
 const loginPage=await fetch(base+'/');
 assert.equal(loginPage.status,200);
 const pageHtml=await loginPage.text();
 assert.match(pageHtml,/href="\/cloud-theme\.css"/);
 assert.match(pageHtml,/href="\/ember-theme\.css"/);
 assert.ok(pageHtml.indexOf('/ember-theme.css')>pageHtml.indexOf('/cloud-theme.css'));
 const inboxScript=await fetch(base+'/inbox.js');
 assert.equal(inboxScript.status,200);
 assert.match(inboxScript.headers.get('content-type')||'',/javascript/);
 assert.match(await inboxScript.text(),/SocioInbox/);
 const inboxCSS=await fetch(base+'/inbox.css');
 assert.equal(inboxCSS.status,200);
 assert.match(await inboxCSS.text(),/\.wa-inbox/);



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
 const badCnpj=await call('/api/admin/cnpj?number=00000000000000','GET',undefined,adminCookie);
 assert.equal(badCnpj.status,422,'Invalid CNPJ must not call external service');
 const badCompany=await call('/api/admin/tenants','POST',{
  cnpj:'00000000000000',company:'Empresa inválida',ownerName:'Teste',
  ownerEmail:'invalid-cnpj@test.invalid',ownerPassword:'SenhaMuitoForte2026!'
 },adminCookie,csrf);
 assert.equal(badCompany.status,422,'Tenant cannot be created with invalid CNPJ');
 const unknownTraining=await call('/api/training/auto','GET',undefined,adminCookie);
 assert.equal(unknownTraining.status,200);
 assert.equal(unknownTraining.result.run,null);
 const emptyTraining=await call('/api/training/auto','POST',{},adminCookie,csrf);
 assert.equal(emptyTraining.status,422,'One-click analysis requires connected WhatsApp');
 const dashboardToday=await call('/api/dashboard','GET',undefined,adminCookie);
 assert.equal(dashboardToday.status,200);
 assert.equal(Number.isInteger(dashboardToday.result.messagesReceivedToday),true);
 const readiness=await call('/api/ops/readiness','GET',undefined,adminCookie);
 assert.equal(readiness.status,200,JSON.stringify(readiness.result));
 assert.equal(readiness.result.numbers.verified,0,'No test phone is connected');
 assert.equal(readiness.result.groq.tested,false,'Key presence is not a completed live test');
 assert.equal(readiness.result.catalog.activeProducts,0);
 const invalidGroqCheck=await call('/api/ops/groq/test','POST',{},adminCookie);
 assert.equal(invalidGroqCheck.status,403,'Groq test requires a CSRF-protected session');

 const me=await call('/api/me','GET',undefined,adminCookie);
 assert.equal(me.result.user.platformOwner,true);
 const initialActivity=await call('/api/dashboard/activity?range=12m','GET',undefined,adminCookie);
 assert.equal(initialActivity.status,200,JSON.stringify(initialActivity.result));
 assert.equal(initialActivity.result.points.length,12,'Chart has 12 monthly buckets');
 assert.ok(initialActivity.result.points.every(p=>Number.isInteger(p.inbound)&&Number.isInteger(p.outbound)));
 const dailyActivity=await call('/api/dashboard/activity?range=1m','GET',undefined,adminCookie);
 assert.equal(dailyActivity.status,200);
 assert.equal(dailyActivity.result.points.length,30,'Last-month filter returns real daily buckets');
 const lastWeekActivity=await call('/api/dashboard/activity?range=7d','GET',undefined,adminCookie);
 assert.equal(lastWeekActivity.status,200);
 assert.equal(lastWeekActivity.result.points.length,7,'Approved UI 7-day filter shows 7 real daily buckets');
 const lastNinetyDays=await call('/api/dashboard/activity?range=90d','GET',undefined,adminCookie);
 assert.equal(lastNinetyDays.status,200);
 assert.equal(lastNinetyDays.result.points.length,90,'Approved UI 90-day filter shows 90 real daily buckets');
 const badRange=await call('/api/dashboard/activity?range=decades','GET',undefined,adminCookie);
 assert.equal(badRange.status,400,'User input cannot enter SQL date interval');
 const anonymousActivity=await call('/api/dashboard/activity?range=6m');
 assert.equal(anonymousActivity.status,401,'Analytics must require authentication');

 assert.equal(me.result.user.phone,null,'Existing accounts continue working without a phone');
 const noCsrf=await call('/api/me/phone','POST',{phone:'(15) 99999-9911',currentPassword:'SenhaMuitoForte2026!'},adminCookie);
 assert.equal(noCsrf.status,403,'Phone change requires CSRF');
 const badPassword=await call('/api/me/phone','POST',{phone:'(15) 99999-9911',currentPassword:'SenhaErradaDeProposito'},adminCookie,csrf);
 assert.equal(badPassword.status,401,'Phone change requires current password');
 const bindPhone=await call('/api/me/phone','POST',{phone:'(15) 99999-9911',currentPassword:'SenhaMuitoForte2026!'},adminCookie,csrf);
 assert.equal(bindPhone.status,200,JSON.stringify(bindPhone.result));
 assert.equal(bindPhone.result.phone,'5515999999911');
 const loginPhone=await call('/api/login','POST',{identifier:'+55 15 99999-9911',password:'SenhaMuitoForte2026!'});
 assert.equal(loginPhone.status,200,'Owner should authenticate by normalized phone');
 const loginEmail=await call('/api/login','POST',{identifier:'QA-OWNER@Test.Invalid',password:'SenhaMuitoForte2026!'});
 assert.equal(loginEmail.status,200,'Owner should still authenticate by email');
 const rejectedLogin=await call('/api/login','POST',{identifier:'(15) 99999-9911',password:'SenhaIncorreta'});
 assert.equal(rejectedLogin.status,401);
 const unknownNumber=await call('/api/login','POST',{identifier:'(15) 99999-9900',password:'SenhaMuitoForte2026!'});
 assert.equal(unknownNumber.status,401,'No fallback to company WhatsApp number');
 const duplicatePhone=await call('/api/me/phone','POST',{phone:'15999999911',currentPassword:'SenhaMuitoForte2026!'},adminCookie,csrf);
 assert.equal(duplicatePhone.status,200,'Same account can keep its phone');

 // Real PostgreSQL inbox: migration, tenant isolation, notes, accessibility
 // metadata and human/AI-assist state. No WhatsApp send is attempted.
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();t.after(()=>db.end());
 const conversationId=randomUUID(),otherConversationId=randomUUID(),channelId=randomUUID(),messageId=randomUUID();
 const ownerTenant=me.result.tenant.id;
 await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider) VALUES($1,$2,'Atendimento','5515890000000','manual')",[channelId,ownerTenant]);
 for(const [convId,phone] of [[conversationId,'5515891111111'],[otherConversationId,'5515892222222']]){
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) VALUES($1,$2,$3,'Cliente de teste',$4)",[convId,ownerTenant,channelId,phone]);
 }
 await db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'inbound','Olá, preciso de ajuda')",[messageId,ownerTenant,conversationId]);
 const inbox=await call('/api/inbox/v2','GET',undefined,adminCookie);
 assert.equal(inbox.status,200,JSON.stringify(inbox.result));
 assert.equal(inbox.result.conversations.length,2);
 assert.equal(inbox.result.capabilities.whatsappSend,false);
 const searchInbox=await call('/api/inbox/v2?search=preciso%20de%20ajuda','GET',undefined,adminCookie);
 assert.equal(searchInbox.result.conversations.length,1);
 const noCsrfInbox=await call('/api/conversations/'+conversationId+'/ui','PATCH',{pinned:true},adminCookie);
 assert.equal(noCsrfInbox.status,403,'Conversation changes require CSRF');
 const prefs=await call('/api/conversations/'+conversationId+'/ui','PATCH',
  {pinned:true,favorite:true,marked_unread:true,labels:['VIP','Retorno'],draft:'Rascunho da equipe',handling_mode:'ai_assist'},
  adminCookie,csrf);
 assert.equal(prefs.status,200,JSON.stringify(prefs.result));
 assert.equal(prefs.result.preferences.pinned,true);
 assert.equal(prefs.result.preferences.handling_mode,'ai_assist');
 const filtered=await call('/api/inbox/v2?filter=unread','GET',undefined,adminCookie);
 assert.equal(filtered.status,200);
 assert.equal(filtered.result.conversations.length,1);
 const messageStatus=await call('/api/conversations/'+conversationId+'/messages/'+messageId+'/ui','PATCH',
  {starred:true,reaction:'❤️'},adminCookie,csrf);
 assert.equal(messageStatus.status,200,JSON.stringify(messageStatus.result));
 assert.equal(messageStatus.result.internalOnly,true);
 const note=await call('/api/conversations/'+conversationId+'/notes','POST',
  {text:'Anotação de teste para a equipe',replyToMessageId:messageId},adminCookie,csrf);
 assert.equal(note.status,201,JSON.stringify(note.result));
 assert.equal(note.result.whatsappSent,false);
 const history=await call('/api/conversations/'+conversationId+'/history?limit=1','GET',undefined,adminCookie);
 assert.equal(history.status,200);
 assert.equal(history.result.hasMore,true);
 const historyFull=await call('/api/conversations/'+conversationId+'/history','GET',undefined,adminCookie);
 assert.equal(historyFull.status,200);
 assert.equal(historyFull.result.messages.length,2);
 assert(historyFull.result.messages.some(m=>m.reply_to_id===messageId));
 assert(historyFull.result.messages.some(m=>m.id===messageId&&m.starred===true&&m.reaction==='❤️'));
 const forwarded=await call('/api/conversations/'+conversationId+'/forward-internal','POST',
  {messageId,targetConversationId:otherConversationId},adminCookie,csrf);
 assert.equal(forwarded.status,201);
 assert.equal(forwarded.result.whatsappSent,false);
 const otherHistory=await call('/api/conversations/'+otherConversationId+'/history','GET',undefined,adminCookie);
 assert.equal(otherHistory.result.messages[0].direction,'note');
 const markedRead=await call('/api/conversations/'+conversationId+'/ui','PATCH',{read:true},adminCookie,csrf);
 assert.equal(markedRead.status,200);
 assert.equal(markedRead.result.preferences.marked_unread,false);
 const noSend=await call('/api/conversations/'+conversationId+'/send','POST',{text:'não enviar'},adminCookie,csrf);
 assert.equal(noSend.status,503,'WhatsApp send must be disabled before explicit live verification');

 const alpha=await call('/api/products','POST',{name:'Site Institucional',description:'Site responsivo',priceCents:49700},adminCookie,csrf);
 assert.equal(alpha.status,201);
 const alphaId=alpha.result.id;
 // Supervised sales Phase 3: immutable catalog price snapshots, revision
 // invalidation, public buyer approval and order idempotency.
 const noCsrfQuote=await call('/api/sales/quotes','POST',{conversationId,items:[{productId:alphaId,quantity:1}]},adminCookie);
 assert.equal(noCsrfQuote.status,403,'Quote creation requires CSRF');
 const invalidQuantity=await call('/api/sales/quotes','POST',{conversationId,items:[{productId:alphaId,quantity:999}]},adminCookie,csrf);
 assert.equal(invalidQuantity.status,422);
 const quoteOne=await call('/api/sales/quotes','POST',
  {conversationId,items:[{productId:alphaId,quantity:2,unitPriceCents:1}]},adminCookie,csrf);
 assert.equal(quoteOne.status,201,JSON.stringify(quoteOne.result));
 assert.equal(quoteOne.result.amount_cents,99400,'Price must be sourced from the official catalog, never client payload');
 const issuedOne=await call('/api/sales/quotes/'+quoteOne.result.id+'/issue','POST',{},adminCookie,csrf);
 assert.equal(issuedOne.status,200);
 const tokenOne=issuedOne.result.path.split('#')[1];
 assert.equal(tokenOne.length,64);
 const publicOne=await call('/api/public/quotes/'+tokenOne,'GET');
 assert.equal(publicOne.status,200);
 assert.equal(publicOne.result.items[0].unitPriceCents,49700);
 const revision=await call('/api/sales/quotes','POST',
  {conversationId,seriesId:quoteOne.result.series_id,items:[{productId:alphaId,quantity:1}]},adminCookie,csrf);
 assert.equal(revision.status,201);
 assert.equal(revision.result.version,2);
 const invalidated=await call('/api/public/quotes/'+tokenOne,'GET');
 assert.equal(invalidated.status,404,'Old buyer links must be invalidated when repriced');
 const issuedTwo=await call('/api/sales/quotes/'+revision.result.id+'/issue','POST',{},adminCookie,csrf);
 assert.equal(issuedTwo.status,200);
 const tokenTwo=issuedTwo.result.path.split('#')[1];
 const noConsent=await call('/api/public/quotes/'+tokenTwo+'/accept','POST',{buyerName:'Cliente',agree:false});
 assert.equal(noConsent.status,422);
 const accepted=await call('/api/public/quotes/'+tokenTwo+'/accept','POST',{buyerName:'Compradora Exemplo',agree:true});
 assert.equal(accepted.status,200,JSON.stringify(accepted.result));
 assert.equal(accepted.result.status,'pending_payment');
 const twice=await call('/api/public/quotes/'+tokenTwo+'/accept','POST',{buyerName:'Compradora Exemplo',agree:true});
 assert.equal(twice.status,200);
 assert.equal(twice.result.id,accepted.result.id,'Buyer retry must not duplicate order');
 assert.equal(twice.result.alreadyApproved,true);
 const unavailableCheckout=await call('/api/public/quotes/'+tokenTwo+'/checkout','POST',{});
 assert.equal(unavailableCheckout.status,503,'Real payment must remain disabled without test credentials');
 const afterSales=await call('/api/sales','GET',undefined,adminCookie);
 assert.equal(afterSales.status,200);
 assert.equal(afterSales.result.orders.length,1);
 assert.equal(afterSales.result.orders[0].status,'pending_payment');
 assert.equal(afterSales.result.quotes.length,2);
 const noReprice=await call('/api/sales/quotes','POST',
  {conversationId,seriesId:quoteOne.result.series_id,items:[{productId:alphaId,quantity:1}]},adminCookie,csrf);
 assert.equal(noReprice.status,409,'An approved quote must stay immutable');
 const publicPage=await fetch(base+'/quote.html');
 assert.equal(publicPage.status,200);
 assert.match(await publicPage.text(),/ORÇAMENTO DIGITAL/);

 const foreign=await call('/api/admin/tenants','POST',{company:'Pizzaria Beta',ownerName:'Dono Beta',ownerEmail:'beta@test.invalid',ownerPhone:'15981112222',ownerPassword:'SenhaBetaMuitoForte2026',plan:'essencial'},adminCookie,csrf);
 assert.equal(foreign.status,201);
 const switchTenant=await call('/api/admin/switch','POST',{tenantId:foreign.result.id},adminCookie,csrf);
 assert.equal(switchTenant.status,200);
 const betaProducts=await call('/api/products','GET',undefined,adminCookie);
 assert.equal(betaProducts.result.length,0);
 const betaSales=await call('/api/sales','GET',undefined,adminCookie);
 assert.equal(betaSales.status,200);
 assert.deepEqual(betaSales.result.quotes,[],'Company B must not see company A proposals');
 assert.deepEqual(betaSales.result.orders,[],'Company B must not see company A orders');
 const crossQuote=await call('/api/sales/quotes','POST',
  {conversationId,items:[{productId:alphaId,quantity:1}]},adminCookie,csrf);
 assert.equal(crossQuote.status,404,'One tenant cannot quote another tenant conversation');
 const crossCancelQuote=await call('/api/sales/quotes/'+revision.result.id+'/cancel','POST',{},adminCookie,csrf);
 assert.equal(crossCancelQuote.status,409,'Other company must not cancel customer-approved quotes');

 const betaActivity=await call('/api/dashboard/activity?range=6m','GET',undefined,adminCookie);
 assert.equal(betaActivity.status,200);
 assert.equal(betaActivity.result.points.reduce((n,p)=>n+p.inbound+p.outbound,0),0,
  'Fresh tenant cannot see messages in other company charts');

 const crossUpdate=await call('/api/products/'+alphaId,'PATCH',{name:'Produto atacado',description:'',priceCents:1,active:true},adminCookie,csrf);
 assert.equal(crossUpdate.status,404);
 const betaLogin=await call('/api/login','POST',{email:'beta@test.invalid',password:'SenhaBetaMuitoForte2026'});
 assert.equal(betaLogin.status,200);
 const betaByPhone=await call('/api/login','POST',{identifier:'(15) 98111-2222',password:'SenhaBetaMuitoForte2026'});
 assert.equal(betaByPhone.status,200,'Phone auth must resolve the correct tenant user');
 const duplicateAcrossTenants=await call('/api/me/phone','POST',{phone:'5515999999911',currentPassword:'SenhaBetaMuitoForte2026'},betaLogin.cookie.split(';')[0],betaLogin.result.csrf);
 assert.equal(duplicateAcrossTenants.status,409,'Two separate tenant users cannot claim one login phone');

 const betaCookie=betaLogin.cookie.split(';')[0],betaCsrf=betaLogin.result.csrf;
 // Phase 4: roles, permissions and session invalidation must be enforced by
 // the server on each request rather than just hidden UI controls.
 const initialTeam=await call('/api/team','GET',undefined,betaCookie);
 assert.equal(initialTeam.status,200);
 assert.equal(initialTeam.result.length,1);
 assert.equal(initialTeam.result[0].role,'owner');
 const noCsrfInvite=await call('/api/team','POST',{
  name:'Sem CSRF',email:'no-csrf@example.test',role:'agent',password:'SenhaTemporaria2026!'
 },betaCookie);
 assert.equal(noCsrfInvite.status,403);
 const invited=await call('/api/team','POST',{
  name:'Atendente Teste',email:'agent-phase4@example.test',role:'agent',password:'SenhaAtendente2026!'
 },betaCookie,betaCsrf);
 assert.equal(invited.status,201,JSON.stringify(invited.result));
 const employeeId=invited.result.id;
 const employeeLogin=await call('/api/login','POST',{email:'agent-phase4@example.test',password:'SenhaAtendente2026!'});
 assert.equal(employeeLogin.status,200);
 const employeeCookie=employeeLogin.cookie.split(';')[0],employeeCsrf=employeeLogin.result.csrf;
 const employeeMe=await call('/api/me','GET',undefined,employeeCookie);
 assert.equal(employeeMe.status,200);
 assert(!employeeMe.result.user.permissions.includes('team.promote'));
 for(const endpoint of ['/api/team','/api/ops/audit','/api/sales','/api/agent','/api/training/auto','/api/training/versions']){
  const denied=await call(endpoint,'GET',undefined,employeeCookie);
  assert.equal(denied.status,403,'Attendant must not read '+endpoint);
 }
 const employeeCatalog=await call('/api/products','GET',undefined,employeeCookie);
 assert.equal(employeeCatalog.status,200,'Attendant can read their company catalog');
 const employeeBlockedCreate=await call('/api/products','POST',{name:'Proibido',priceCents:1},employeeCookie,employeeCsrf);
 assert.equal(employeeBlockedCreate.status,403);
 const employeeBlockedSwitch=await call('/api/admin/switch','POST',{tenantId:me.result.tenant.id},employeeCookie,employeeCsrf);
 assert.equal(employeeBlockedSwitch.status,403,'Company agent cannot switch tenant');
 const employeeCrossTenantNote=await call('/api/conversations/'+conversationId+'/notes','POST',{text:'Invasão'},employeeCookie,employeeCsrf);
 assert.equal(employeeCrossTenantNote.status,404);

 const newAdmin=await call('/api/team','POST',{
  name:'Administrador Teste',email:'admin-phase4@example.test',role:'admin',password:'SenhaAdministrador2026!'
 },betaCookie,betaCsrf);
 assert.equal(newAdmin.status,201);
 const adminTeamUserId=newAdmin.result.id;
 const subordinateAdmin=await call('/api/login','POST',{email:'admin-phase4@example.test',password:'SenhaAdministrador2026!'});
 assert.equal(subordinateAdmin.status,200);
 const subordinateCookie=subordinateAdmin.cookie.split(';')[0],subordinateCsrf=subordinateAdmin.result.csrf;
 const subordinateAttempt=await call('/api/team','POST',{
  name:'Promovido indevidamente',email:'unauthorized-admin@example.test',role:'admin',password:'SenhaAdminNaoPermitido2026!'
 },subordinateCookie,subordinateCsrf);
 assert.equal(subordinateAttempt.status,422,'Tenant admins must not grant administrator privileges');
 const subordinateEdit=await call('/api/team/'+employeeId,'PATCH',{role:'admin'},subordinateCookie,subordinateCsrf);
 assert.equal(subordinateEdit.status,403,'Tenant admins cannot change another member role');
 const ownerPromote=await call('/api/team/'+employeeId,'PATCH',{role:'admin'},betaCookie,betaCsrf);
 assert.equal(ownerPromote.status,200);
 assert.equal(ownerPromote.result.role,'admin');
 const ownerDemote=await call('/api/team/'+employeeId,'PATCH',{role:'agent'},betaCookie,betaCsrf);
 assert.equal(ownerDemote.status,200);
 const ownDemote=await call('/api/team/'+initialTeam.result[0].id,'PATCH',{role:'agent'},betaCookie,betaCsrf);
 assert.equal(ownDemote.status,403,'Owner cannot demote self');
 const foreignRoleEdit=await call('/api/team/'+me.result.user.id,'PATCH',{role:'agent'},betaCookie,betaCsrf);
 assert.equal(foreignRoleEdit.status,404,'Owner cannot change a member of another tenant');
 const invalidPatch=await call('/api/team/'+employeeId,'PATCH',{platform_owner:true},betaCookie,betaCsrf);
 assert.equal(invalidPatch.status,422);

 const deactivated=await call('/api/team/'+employeeId,'PATCH',{active:false},betaCookie,betaCsrf);
 assert.equal(deactivated.status,200);
 assert.equal(deactivated.result.active,false);
 const invalidatedSession=await call('/api/me','GET',undefined,employeeCookie);
 assert.equal(invalidatedSession.status,401,'Deactivating an account invalidates existing sessions');
 const blockedLogin=await call('/api/login','POST',{email:'agent-phase4@example.test',password:'SenhaAtendente2026!'});
 assert.equal(blockedLogin.status,401,'Inactive users cannot sign back in');
 const reactivated=await call('/api/team/'+employeeId,'PATCH',{active:true},betaCookie,betaCsrf);
 assert.equal(reactivated.status,200);
 const activeLogin=await call('/api/login','POST',{email:'agent-phase4@example.test',password:'SenhaAtendente2026!'});
 assert.equal(activeLogin.status,200);
 const activeCookie=activeLogin.cookie.split(';')[0],activeCsrf=activeLogin.result.csrf;
 const anotherSession=await call('/api/login','POST',{email:'agent-phase4@example.test',password:'SenhaAtendente2026!'});
 assert.equal(anotherSession.status,200);
 const wrongPasswordChange=await call('/api/me/password','POST',{
  currentPassword:'senha errada',newPassword:'SenhaNova2026!MuitoForte'
 },activeCookie,activeCsrf);
 assert.equal(wrongPasswordChange.status,401);
 const passwordChanged=await call('/api/me/password','POST',{
  currentPassword:'SenhaAtendente2026!',newPassword:'SenhaNova2026!MuitoForte'
 },activeCookie,activeCsrf);
 assert.equal(passwordChanged.status,200);
 assert.equal(passwordChanged.result.otherSessionsRevoked,true);
 const otherSessionRevoked=await call('/api/me','GET',undefined,anotherSession.cookie.split(';')[0]);
 assert.equal(otherSessionRevoked.status,401,'Password rotation invalidates other sessions');
 assert.equal((await call('/api/me','GET',undefined,activeCookie)).status,200,'Current session survives own password change');
 assert.equal((await call('/api/login','POST',{email:'agent-phase4@example.test',password:'SenhaAtendente2026!'})).status,401);
 assert.equal((await call('/api/login','POST',{email:'agent-phase4@example.test',password:'SenhaNova2026!MuitoForte'})).status,200);

 const auditResult=await call('/api/ops/audit?limit=80','GET',undefined,betaCookie);
 assert.equal(auditResult.status,200);
 assert(auditResult.result.events.some(x=>x.action==='team.member_updated'));
 assert(auditResult.result.events.some(x=>x.action==='auth.password_changed'));
 assert(auditResult.result.events.every(x=>x.actor!=='Atendente Teste'||x.action==='auth.password_changed'));
 assert.equal((await call('/api/ops/audit?limit=900','GET',undefined,betaCookie)).status,422);
 const switchToOtherAudit=await call('/api/admin/switch','POST',{tenantId:me.result.tenant.id},adminCookie,csrf);
 assert.equal(switchToOtherAudit.status,200);
 const foreignAudit=await call('/api/ops/audit','GET',undefined,adminCookie);
 assert.equal(foreignAudit.status,200);
 assert(!foreignAudit.result.events.some(x=>x.action==='auth.password_changed'),'Other tenant must not see member password changes');
 await call('/api/admin/switch','POST',{tenantId:foreign.result.id},adminCookie,csrf);

 // Composite FKs must block cross-tenant relationships even if an unsafe
 // future route accidentally supplies a valid foreign UUID.
 await assert.rejects(
  db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_phone) VALUES($1,$2,$3,'5515999000777')",
   [randomUUID(),foreign.result.id,channelId]),
  error=>error.code==='23503','Database must reject foreign-tenant channel');
 await assert.rejects(
  db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body) VALUES($1,$2,$3,'inbound','not allowed')",
   [randomUUID(),foreign.result.id,conversationId]),
  error=>error.code==='23503','Database must reject foreign-tenant conversation messages');

 const unauthorizedCnpj=await call('/api/admin/cnpj?number=11222333000181','GET',undefined,betaCookie);
 assert.equal(unauthorizedCnpj.status,403,'CNPJ prefill is restricted to the master account');
 const betaReadiness=await call('/api/ops/readiness','GET',undefined,betaCookie);
 assert.equal(betaReadiness.status,200);
 assert.equal(betaReadiness.result.catalog.activeProducts,0,'Tenant B should not see products from tenant A');
 const hiddenInbox=await call('/api/inbox/v2','GET',undefined,betaCookie);
 assert.equal(hiddenInbox.status,200);
 assert.equal(hiddenInbox.result.conversations.length,0,'Tenant B cannot see tenant A inbox');
 const crossHistory=await call('/api/conversations/'+conversationId+'/history','GET',undefined,betaCookie);
 assert.equal(crossHistory.status,404,'Tenant B cannot read tenant A history');
 const crossPreferences=await call('/api/conversations/'+conversationId+'/ui','PATCH',{archived:true},betaCookie,betaCsrf);
 assert.equal(crossPreferences.status,404,'Tenant B cannot modify tenant A preferences');
 const crossFavorite=await call('/api/conversations/'+conversationId+'/messages/'+messageId+'/ui','PATCH',{starred:true},betaCookie,betaCsrf);
 assert.equal(crossFavorite.status,404,'Tenant B cannot favorite tenant A messages');

 const forbidden=await call('/api/admin/tenants','GET',undefined,betaCookie);
 assert.equal(forbidden.status,403);
 const missingCsrf=await call('/api/products','POST',{name:'Produto',priceCents:500},betaCookie);
 assert.equal(missingCsrf.status,403);
 const valid=await call('/api/products','POST',{name:'Pizza',priceCents:3990},betaCookie,betaCsrf);
 assert.equal(valid.status,201);
 const my=await call('/api/products','GET',undefined,betaCookie);
 assert.equal(my.result.length,1);
 // Tenant-isolated catalog: images, custom variants and campaign references.
 const productId=valid.result.id;
 const storage=await call('/api/products/storage','GET',undefined,betaCookie);
 assert.equal(storage.status,200);
 assert.equal(storage.result.configured,true);
 const variantSave=await call('/api/products/'+productId+'/variants','PUT',{variants:[
  {name:'Pequena',sku:'BET-P',priceCents:2990,stockQuantity:3,active:true},
  {name:'Grande',sku:'BET-G',priceCents:4990,stockQuantity:0,active:true}
 ]},betaCookie,betaCsrf);
 assert.equal(variantSave.status,200,JSON.stringify(variantSave.result));
 const variantsCrossTenant=await call('/api/products/'+alphaId+'/variants','PUT',{variants:[{name:'Invasão',priceCents:1}]},betaCookie,betaCsrf);
 assert.equal(variantsCrossTenant.status,404);
 const photo=await sharp({create:{width:96,height:96,channels:3,background:'#be8272'}}).png().toBuffer();
 const uploaded=await call('/api/products/'+productId+'/media','POST',{contentBase64:photo.toString('base64'),alt:'Pizza'},betaCookie,betaCsrf);
 assert.equal(uploaded.status,201,JSON.stringify(uploaded.result));
 const mediaId=uploaded.result.id;
 const ownFile=await fetch(base+uploaded.result.url,{headers:{Cookie:betaCookie}});
 assert.equal(ownFile.status,200);
 assert.equal(ownFile.headers.get('content-type'),'image/jpeg');
 assert.equal(Buffer.from(await ownFile.arrayBuffer()).subarray(0,3).toString('hex'),'ffd8ff');
 await call('/api/admin/switch','POST',{tenantId:me.result.tenant.id},adminCookie,csrf);
 const hiddenFile=await fetch(base+uploaded.result.url,{headers:{Cookie:adminCookie}});
 assert.equal(hiddenFile.status,404);
 await call('/api/admin/switch','POST',{tenantId:foreign.result.id},adminCookie,csrf);
 const forbiddenUpload=await call('/api/products/'+alphaId+'/media','POST',{contentBase64:photo.toString('base64')},betaCookie,betaCsrf);
 assert.equal(forbiddenUpload.status,404);
 const campaign=await call('/api/products/'+productId+'/campaigns','POST',{provider:'meta_ads',campaignId:'1200000123456789',label:'Pizza Sorocaba'},betaCookie,betaCsrf);
 assert.equal(campaign.status,201);
 assert.equal(campaign.result.verified,false);
 const listCatalog=await call('/api/products','GET',undefined,betaCookie);
 assert.equal(listCatalog.result[0].variants.length,2);
 assert.equal(listCatalog.result[0].media.length,1);
 assert.equal(listCatalog.result[0].campaigns.length,1);
 const crossCampaign=await call('/api/products/'+alphaId+'/campaigns','POST',{provider:'meta_ads',campaignId:'12000012345'},betaCookie,betaCsrf);
 assert.equal(crossCampaign.status,404);
 const deleted=await call('/api/products/'+productId+'/media/'+mediaId,'DELETE',{},betaCookie,betaCsrf);
 assert.equal(deleted.status,200);
 const gone=await fetch(base+uploaded.result.url,{headers:{Cookie:betaCookie}});
 assert.equal(gone.status,404);

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
 const noCsrfSync=await call('/api/inbox/sync','POST',{channelId:waChannelId},betaCookie);
 assert.equal(noCsrfSync.status,403,'Inbox sync must require CSRF');
 const synced=await call('/api/inbox/sync','POST',{channelId:waChannelId,offset:0},betaCookie,betaCsrf);
 assert.equal(synced.status,200,JSON.stringify(synced.result));
 assert.equal(synced.result.chatsImported,1);
 assert.equal(synced.result.messagesImported,3,'Only available text is imported; media stays excluded');
 assert.equal(synced.result.readOnly,true);
 const importedInbox=await call('/api/inbox/v2?search=Nome%20particular','GET',undefined,betaCookie);
 assert.equal(importedInbox.status,200);
 assert.equal(importedInbox.result.conversations.length,1);
 assert.equal(importedInbox.result.conversations[0].customer_name,'Nome particular');
 const importedHistory=await call('/api/conversations/'+importedInbox.result.conversations[0].id+'/history','GET',undefined,betaCookie);
 assert.equal(importedHistory.status,200);
 assert.equal(importedHistory.result.messages.length,3);
 assert(importedHistory.result.messages.every(m=>m.direction!=='note'));
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
 // Phase 2: one-click analysis must use ONLY scanned WA-AKG messages.
 // Previously uploaded exports (3 imports) must not contaminate its summary.
 const autoStart=await call('/api/training/auto','POST',{},betaCookie,betaCsrf);
 assert.equal(autoStart.status,201,JSON.stringify(autoStart.result));
 const duplicateAuto=await call('/api/training/auto','POST',{},betaCookie,betaCsrf);
 assert.equal(duplicateAuto.status,409,'Only one active automatic scan per tenant');
 let autoRun=null;
 for(let i=0;i<90;i++){
  const status=await call('/api/training/auto','GET',undefined,betaCookie);
  assert.equal(status.status,200);
  autoRun=status.result.run;
  if(['completed','failed'].includes(autoRun?.status))break;
  await sleep(240);
 }
 assert.equal(autoRun.status,'completed','Auto training failed: '+JSON.stringify(autoRun));
 assert.equal(autoRun.percent,100);
 assert.equal(autoRun.channels,1);
 assert.equal(autoRun.approvalRequired,true);
 assert.equal(autoRun.source,'available_waakg_text');
 const autoVersions=await call('/api/training/versions','GET',undefined,betaCookie);
 const autoDraft=autoVersions.result.find(v=>v.status==='draft');
 const previousKnowledge=autoVersions.result.find(v=>v.status==='approved');
 assert.ok(autoDraft,'Auto training did not produce a draft');
 assert.ok(previousKnowledge,'A previously approved version should remain active');
 assert.equal(autoDraft.report.conversations,1,'Only chats enumerated by the auto scan belong in this draft');
 assert.equal(autoDraft.report.messages,3,'Only three text messages from gateway are eligible');
 assert.equal(autoDraft.report.salesValidated,false);
 const beforeNewApproval=await call('/api/agent','GET',undefined,betaCookie);
 assert.equal(beforeNewApproval.result.knowledge_md,previousKnowledge.markdown);
 const badEdit=await call('/api/training/versions/'+autoDraft.id+'/edit','POST',{markdown:'short'},betaCookie,betaCsrf);
 assert.equal(badEdit.status,422);
 const newKnowledge='# Conhecimento aprovado pelo humano\\n\\nSempre verificar preços oficiais antes de criar orçamento.';
 const saved=await call('/api/training/versions/'+autoDraft.id+'/edit','POST',{markdown:newKnowledge},betaCookie,betaCsrf);
 assert.equal(saved.status,200,JSON.stringify(saved.result));
 const stillOld=await call('/api/agent','GET',undefined,betaCookie);
 assert.equal(stillOld.result.knowledge_md,previousKnowledge.markdown,'Editing a draft must never activate it');
 const autoApprove=await call('/api/training/versions/'+autoDraft.id+'/approve','POST',{},betaCookie,betaCsrf);
 assert.equal(autoApprove.status,200);
 const nowApproved=await call('/api/agent','GET',undefined,betaCookie);
 assert.equal(nowApproved.result.knowledge_md,newKnowledge);
 const archivedEdit=await call('/api/training/versions/'+previousKnowledge.id+'/edit','POST',{markdown:newKnowledge},betaCookie,betaCsrf);
 assert.equal(archivedEdit.status,409);
 const restored=await call('/api/training/versions/'+previousKnowledge.id+'/restore','POST',{},betaCookie,betaCsrf);
 assert.equal(restored.status,200);
 const afterRollback=await call('/api/agent','GET',undefined,betaCookie);
 assert.equal(afterRollback.result.knowledge_md,previousKnowledge.markdown);
 const wrongRollback=await call('/api/training/versions/'+previousKnowledge.id+'/restore','POST',{},betaCookie,betaCsrf);
 assert.equal(wrongRollback.status,409,'An already-active version must not be restored again');
 const cancelStart=await call('/api/training/auto','POST',{},betaCookie,betaCsrf);
 assert.equal(cancelStart.status,201);
 const cancelled=await call('/api/training/auto/'+cancelStart.result.id+'/cancel','POST',{},betaCookie,betaCsrf);
 assert.equal(cancelled.status,200);
 const cancelStatus=await call('/api/training/auto','GET',undefined,betaCookie);
 assert.equal(cancelStatus.result.run.status,'cancelled');
 const cancelAgain=await call('/api/training/auto/'+cancelStart.result.id+'/cancel','POST',{},betaCookie,betaCsrf);
 assert.equal(cancelAgain.status,409);

 await call('/api/admin/switch','POST',{tenantId:me.result.tenant.id},adminCookie,csrf);
 const otherTenantLinks=await call('/api/waakg/channels','GET',undefined,adminCookie);
 assert.deepEqual(otherTenantLinks.result,[]);
 const crossInboxSync=await call('/api/inbox/sync','POST',{channelId:waChannelId},adminCookie,csrf);
 assert.equal(crossInboxSync.status,404,'Other tenants cannot pull WhatsApp conversations');
 const crossSync=await call('/api/waakg/scans','POST',{channelId:waChannelId},adminCookie,csrf);
 assert.equal(crossSync.status,404);
 const crossStatus=await call('/api/waakg/channels/'+waChannelId+'/status','GET',undefined,adminCookie);
 assert.equal(crossStatus.status,404);


 // Dedicated WA-AKG self-service: authenticated tenant owner can create a
 // randomized session without seeing server credentials or another tenant's QR.
 const self=await call('/api/waakg/channels/connect','POST',{label:'Atendimento 2'},betaCookie,betaCsrf);
 assert.equal(self.status,201,JSON.stringify(self.result));
 const selfId=self.result.id;
 const provisioned=[...dynamicSessions.values()];
 assert.equal(provisioned.length,1);
 assert.equal(provisioned[0].botDisabled,true);
 assert.equal(provisioned[0].started,true);
 assert.equal(self.result.sessionId,undefined,'Gateway session identifier must remain server-only');
 const qr=await call('/api/waakg/channels/'+selfId+'/qr','GET',undefined,betaCookie);
 assert.equal(qr.status,200);
 assert.equal(qr.result.ready,true);
 assert.match(qr.result.image,/^data:image\/png;base64,/);
 const beforeConnect=await call('/api/waakg/channels/'+selfId+'/status','GET',undefined,betaCookie);
 assert.equal(beforeConnect.result.connected,false);
 const hidden=await call('/api/waakg/channels/'+selfId+'/qr','GET',undefined,adminCookie);
 assert.equal(hidden.status,404);
 const newConnected=provisioned[0];newConnected.connected=true;
 const verifiedSelf=await call('/api/waakg/channels/'+selfId+'/status','GET',undefined,betaCookie);
 assert.equal(verifiedSelf.status,200);
 assert.equal(verifiedSelf.result.connected,true);
 assert.equal(verifiedSelf.result.phone,dynamicPhone);
 const listSelf=await call('/api/waakg/channels','GET',undefined,betaCookie);
 assert(listSelf.result.some(x=>x.id===selfId&&x.phone===dynamicPhone));
 const pausedSelf=await call('/api/waakg/channels/'+selfId+'/stop','POST',{},betaCookie,betaCsrf);
 assert.equal(pausedSelf.status,200);
 const restartedSelf=await call('/api/waakg/channels/'+selfId+'/start','POST',{},betaCookie,betaCsrf);
 assert.equal(restartedSelf.status,200);
 const fakeMethods=gatewayRequests.filter(x=>x.method==='POST');
 assert(fakeMethods.length>=4);
 assert(fakeMethods.every(x=>x.path.startsWith('/api/sessions')));

 const ag=await call('/api/agent','GET',undefined,betaCookie);
 assert.doesNotMatch(ag.result.knowledge_md,/Alice|15981142577|Nome Comprador|cliente-1\.txt/);
 const webhook=await call('/webhooks/whatsapp','POST',{object:'whatsapp_business_account'});
 assert.equal(webhook.status,503);
 const noAI=await call('/api/simulate','POST',{message:'Qual o preço?'},betaCookie,betaCsrf);
 assert.equal(noAI.status,503);
});
