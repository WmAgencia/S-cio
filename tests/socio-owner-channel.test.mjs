import test from 'node:test';
import assert from 'node:assert/strict';
import {
 OWNER_GROUP_SUBJECT,ownerDestination,missingOwnerSettings,provisionOwnerGroups,
 pollOwnerGroups,processOwnerCommands,readOwnerChannel,updateOwnerChannelSettings,draftAdCopy,__test
} from '../socio-owner-channel.mjs';

const tenantId='11111111-1111-4111-8111-111111111111';
const groupId='22222222-2222-4222-8222-222222222222';
const channelId='33333333-3333-4333-8333-333333333333';
const commandId='44444444-4444-4444-8444-444444444444';
const env={SOCIO_OUTBOUND_ENABLED:'true',WA_AKG_API_KEY:'gateway-unit-test-key-very-long',
 WA_AKG_BASE_URL:'http://127.0.0.1:39000',SOCIO_PUBLIC_URL:'https://socio.example.com'};

const stubPool=handler=>({calls:[],query:async function(sql,args=[]){
 this.calls.push({sql,args});
 return handler(sql,args)||{rowCount:0,rows:[]};
}});
const configured={
 id:groupId,tenant_id:tenantId,group_id:groupId,channel_id:channelId,status:'active',
 group_jid:'123456789012345@g.us',session_id:'socio_session_12345678',
 channel_phone:'5515999999999',whatsapp_destination:null,
 ad_page_id:'123456789012345',ad_city_key:'1234567',ad_city_name:'São Paulo',
 ad_daily_budget_cents:5000,ad_age_min:18,ad_age_max:65,ad_genders:[],last_video_id:'987654321'
};

test('Owner destination and settings are explicit, never guessed',()=>{
 assert.equal(ownerDestination({channel_phone:'55 15 99999-9999'}),'5515999999999');
 assert.equal(ownerDestination({whatsapp_destination:'5511888888888',channel_phone:'5515999999999'}),'5511888888888');
 assert.equal(ownerDestination({channel_phone:'1234'}),null);
 assert.equal(ownerDestination({channel_phone:'11999999999'}),null,'must start with country code 55');
 assert.deepEqual(missingOwnerSettings({}),[
  'Página do Facebook','cidade da campanha','orçamento diário','WhatsApp de destino']);
 assert.deepEqual(missingOwnerSettings(configured),[]);
 assert.equal(OWNER_GROUP_SUBJECT,'Meu Sócio');
});

test('Message classification keeps only text, image and video',()=>{
 const {messageKind,looksLikeCaption}=__test;
 assert.equal(messageKind({type:'text',content:'oi'}),'text');
 assert.equal(messageKind({type:'video',content:'confira'}),'video');
 assert.equal(messageKind({type:'imageMessage',content:''}),'image');
 assert.equal(messageKind({type:'sticker',content:'x'}),'other');
 assert.equal(messageKind({type:'audio',content:'x'}),'other');
 assert.equal(messageKind({type:'document',content:'x'}),'other');
 assert.equal(messageKind({type:'reaction',content:'👍'}),'other');
 assert.equal(messageKind({type:'protocolMessage',content:''}),'other');
 assert.equal(messageKind({type:'text',content:'   '}),'other');
 assert.equal(looksLikeCaption('confira o produto'),true);
 assert.equal(looksLikeCaption('video.mp4'),false);
 assert.equal(looksLikeCaption(''),false);
});

test('Provisioning creates the group, saves it active and sends the welcome',async()=>{
 const sent=[];
 const pool=stubPool(sql=>{
  if(/FROM channels ch JOIN waakg_links l/.test(sql))return {rowCount:1,rows:[{
   channel_id:channelId,tenant_id:tenantId,phone:'5515999999999',label:'Loja',session_id:'socio_session_12345678'}]};
  if(/SELECT phone FROM users/.test(sql))return {rowCount:2,rows:[{phone:'5515888888888'},{phone:'5515999999999'}]};
  if(/INSERT INTO socio_owner_groups/.test(sql))return {rowCount:1,rows:[]};
  return {rowCount:0,rows:[]};
 });
 const created=[];
 const result=await provisionOwnerGroups(pool,{env,
  status:async()=>({connected:true,connectedNumber:'5515999999999'}),
  create:async(sessionId,subject,participants)=>{created.push({sessionId,subject,participants});
   return {jid:'123456789012345@g.us',subject};},
  send:async payload=>{sent.push(payload);return {sent:true,providerId:'x'};}});
 assert.equal(result.groups[0].created,true);
 assert.equal(created.length,1);
 assert.equal(created[0].subject,'Meu Sócio');
 assert.deepEqual(created[0].participants,['5515888888888@s.whatsapp.net'],'own number is excluded');
 const insert=pool.calls.find(c=>/INSERT INTO socio_owner_groups/.test(c.sql));
 assert.equal(insert.args[3],'123456789012345@g.us');
 assert.equal(insert.args[5],'active');
 assert.equal(sent.length,1);
 assert.equal(sent[0].jid,'123456789012345@g.us');
 assert.match(sent[0].text,/CONFIRMA/);
 assert.match(sent[0].text,/ATIVAR/);
});

test('Provisioning waits for the owner phone and fails closed on a mismatched session',async()=>{
 const pool=stubPool(sql=>{
  if(/FROM channels ch JOIN waakg_links l/.test(sql))return {rowCount:1,rows:[{
   channel_id:channelId,tenant_id:tenantId,phone:'5515999999999',label:'Loja',session_id:'socio_session_12345678'}]};
  return {rowCount:0,rows:[]};
 });
 const result=await provisionOwnerGroups(pool,{env,
  status:async()=>({connected:true,connectedNumber:'5515999999999'}),
  create:async()=>{throw new Error('must not create without participants');},
  send:async()=>({sent:true})});
 assert.equal(result.groups[0].reason,'owner_phone_required');
 const save=pool.calls.find(c=>/INSERT INTO socio_owner_groups/.test(c.sql));
 assert.equal(save.args[5],'waiting_owner_phone');
 assert.equal(save.args[6],'OWNER_PHONE_REQUIRED');

 const pool2=stubPool(sql=>{
  if(/FROM channels ch JOIN waakg_links l/.test(sql))return {rowCount:1,rows:[{
   channel_id:channelId,tenant_id:tenantId,phone:'5515999999999',label:'Loja',session_id:'socio_session_12345678'}]};
  return {rowCount:0,rows:[]};
 });
 let created=0;
 const failed=await provisionOwnerGroups(pool2,{env,
  status:async()=>({connected:true,connectedNumber:'5515111111111'}),
  create:async()=>{created++;},send:async()=>({sent:true})});
 assert.equal(created,0);
 assert.equal(failed.groups[0].error,'409');
 const save2=pool2.calls.find(c=>/INSERT INTO socio_owner_groups/.test(c.sql));
 assert.equal(save2.args[5],'failed');
});

test('Polling stores unseen inbound text and media idempotently',async()=>{
 const inserted=[];
 const pool=stubPool((sql,args)=>{
  if(/FROM socio_owner_groups g/.test(sql)&&/last_seen_at NULLS FIRST/.test(sql))
   return {rowCount:1,rows:[{id:groupId,tenant_id:tenantId,group_jid:'123456789012345@g.us',
    session_id:'socio_session_12345678'}]};
  if(/INSERT INTO socio_owner_commands/.test(sql)){inserted.push(args);return {rowCount:1,rows:[]};}
  return {rowCount:1,rows:[]};
 });
 const read=async(jidSession,groupJid)=>{
  assert.equal(groupJid,'123456789012345@g.us');
  return [
   {fromMe:true,keyId:'own-1',type:'text',content:'resposta do sócio'},
   {fromMe:false,keyId:'msg-1',type:'text',content:'criar campanha',participant:'5515888888888@s.whatsapp.net'},
   {fromMe:false,keyId:'msg-2',type:'video',content:'confira'},
   {fromMe:false,keyId:'msg-3',type:'sticker',content:'👍'},
   {fromMe:false,keyId:'x',type:'text',content:'curto'}
  ];
 };
 const result=await pollOwnerGroups(pool,{env,read});
 assert.equal(result.stored,2);
 assert.deepEqual(inserted.map(a=>[a[3],a[4],a[5],a[6],a[7]]),[
  ['msg-1','5515888888888@s.whatsapp.net','text','criar campanha',null],
  ['msg-2',null,'video','confira','msg-2']]);
 assert.ok(pool.calls.some(c=>/UPDATE socio_owner_groups SET last_seen_at/.test(c.sql)));
});

const claimCmd=(overrides={})=>({id:commandId,tenant_id:tenantId,group_id:groupId,kind:'text',
 body:'ajuda',state:'received',attempts:1,context:{},media_message_id:null,...overrides});

function commandPool({group=configured,command=claimCmd(),prepare,execute}={}){
 const replies=[];
 const pool=stubPool((sql,args)=>{
  if(/SET state='received'/.test(sql)||/error_code='STALLED'/.test(sql))return {rowCount:0,rows:[]};
  if(/SET state='working',attempts/.test(sql))return {rowCount:1,rows:[command]};
  if(/SELECT g\.\*,ch\.phone AS channel_phone/.test(sql))return {rowCount:1,rows:[group]};
  if(/SELECT u\.id AS user_id/.test(sql))return {rowCount:1,rows:[{user_id:'u1',role:'owner',
   platform_owner:false,active_tenant_id:tenantId,tenant_status:'active',features:{},tenant_name:'Loja'}]};
  if(/SELECT state,kind,created_at/.test(sql))return {rowCount:0,rows:[]};
  if(/SELECT id FROM socio_owner_commands/.test(sql))return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[]};
 });
 const send=async payload=>{replies.push(payload);return {sent:true,providerId:'p'};};
 const run=opts=>processOwnerCommands(pool,{env,send,prepare,execute,...opts});
 return {pool,replies,run};
}

test('Every unhandled text gets the help menu',async()=>{
 const {replies,run}=commandPool({group:{...configured,ad_page_id:null,ad_city_key:null,
  ad_city_name:null,ad_daily_budget_cents:null,channel_phone:null}});
 const result=await run();
 assert.equal(result.processed,true);
 assert.equal(result.handled,'help');
 assert.equal(replies.length,1);
 assert.match(replies[0].text,/CONFIRMA/);
 assert.match(replies[0].text,/configure no Sócio: Página do Facebook/);
});

test('A video without settings is stored, never discarded',async()=>{
 const replies=[];
 const group={...configured,ad_page_id:null,ad_city_key:null,ad_city_name:null,
  ad_daily_budget_cents:null,last_video_id:null};
 const pool=stubPool((sql,args)=>{
  if(/SET state='received'/.test(sql)||/error_code='STALLED'/.test(sql))return {rowCount:0,rows:[]};
  if(/SET state='working',attempts/.test(sql))return {rowCount:1,rows:[claimCmd({
   kind:'video',body:null,media_message_id:'msg-2',context:{}})]};
  if(/SELECT g\.\*,ch\.phone AS channel_phone/.test(sql))return {rowCount:1,rows:[group]};
  return {rowCount:1,rows:[]};
 });
 const result=await processOwnerCommands(pool,{env,
  send:async p=>{replies.push(p);return {sent:true};},
  prepare:async()=>{throw new Error('must not prepare without settings');},
  download:async()=>{throw new Error('must not download without settings');}});
 assert.equal(result.processed,true);
 const stored=pool.calls.find(c=>/SET last_video_message_id/.test(c.sql));
 assert.equal(stored.args[1],'msg-2');
 const state=pool.calls.find(c=>/SET state='awaiting_settings'/.test(c.sql));
 assert.ok(state,'command must wait for settings instead of failing');
 assert.match(replies[0].text,/Recebi seu vídeo/);
});

test('CONFIRMA with nothing pending is answered, not executed',async()=>{
 let executed=0;
 const pool=stubPool((sql)=>{
  if(/SET state='received'/.test(sql)||/error_code='STALLED'/.test(sql))return {rowCount:0,rows:[]};
  if(/SET state='working',attempts/.test(sql))return {rowCount:1,rows:[claimCmd({body:'CONFIRMA'})]};
  if(/SELECT g\.\*,ch\.phone AS channel_phone/.test(sql))return {rowCount:1,rows:[configured]};
  if(/state='awaiting_confirmation'/.test(sql))return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[]};
 });
 const replies=[];
 const result=await processOwnerCommands(pool,{env,
  send:async p=>{replies.push(p);return {sent:true};},
  prepare:async()=>{executed++;},execute:async()=>{executed++;}});
 assert.equal(result.handled,'nothing_pending');
 assert.equal(executed,0);
 assert.match(replies[0].text,/nenhuma campanha esperando/);
});

test('A confirmed proposal executes the plan and reports the created ids',async()=>{
 const planId='55555555-5555-4555-8555-555555555555';
 const prepared=[];
 const pool=stubPool((sql)=>{
  if(/SET state='received'/.test(sql)||/error_code='STALLED'/.test(sql))return {rowCount:0,rows:[]};
  if(/SET state='working',attempts/.test(sql))return {rowCount:1,rows:[claimCmd({body:'CONFIRMA'})]};
  if(/SELECT g\.\*,ch\.phone AS channel_phone/.test(sql))return {rowCount:1,rows:[configured]};
  if(/state='awaiting_confirmation'/.test(sql))return {rowCount:1,rows:[{
   id:'66666666-6666-4666-8666-666666666666',context:{planId,action:'create'}}]};
  return {rowCount:1,rows:[]};
 });
 const replies=[];
 const result=await processOwnerCommands(pool,{env,
  send:async p=>{replies.push(p);return {sent:true};},
  prepare:async()=>{prepared.push('prepare');},
  execute:async(poolArg,actor,id,dry)=>{assert.equal(id,planId);assert.equal(dry,true);
   return {status:'succeeded',result:{campaignId:'2380001',adsetId:'2380002',adId:'2380003'}};}});
 assert.equal(result.handled,'created');
 assert.equal(prepared.length,0);
 assert.match(replies[0].text,/Campanha criada e PAUSADA/);
 assert.match(replies[0].text,/2380001/);
});

test('TRAFEGO runs the traffic manager and APROVAR applies pending changes',async()=>{
 let ran=0;
 const trafficPool=stubPool(sql=>{
  if(/SET state='received'/.test(sql)||/error_code='STALLED'/.test(sql))return {rowCount:0,rows:[]};
  if(/SET state='working',attempts/.test(sql))return {rowCount:1,rows:[claimCmd({body:'tráfego'})]};
  if(/SELECT g\.\*,ch\.phone AS channel_phone/.test(sql))return {rowCount:1,rows:[configured]};
  return {rowCount:1,rows:[]};
 });
 const replies=[];
 const result=await processOwnerCommands(trafficPool,{env,
  send:async p=>{replies.push(p);return {sent:true};},
  traffic:async()=>{ran++;return {executed:[{}],pending:[],skipped:[],
   report:'Tráfego Meta Ads: 1 ajuste aplicado.'};}});
 assert.equal(ran,1);
 assert.equal(result.handled,'traffic');
 assert.match(replies[0].text,/1 ajuste aplicado/);

 let approved=0;
 const approvePool=stubPool(sql=>{
  if(/SET state='received'/.test(sql)||/error_code='STALLED'/.test(sql))return {rowCount:0,rows:[]};
  if(/SET state='working',attempts/.test(sql))return {rowCount:1,rows:[claimCmd({body:'APROVAR'})]};
  if(/SELECT g\.\*,ch\.phone AS channel_phone/.test(sql))return {rowCount:1,rows:[configured]};
  return {rowCount:1,rows:[]};
 });
 const approvedReply=[];
 const approveResult=await processOwnerCommands(approvePool,{env,
  send:async p=>{approvedReply.push(p);return {sent:true};},
  approveTraffic:async()=>{approved++;return {applied:[{}],failed:[],
   report:'✓ Orçamento ajustado.'};}});
 assert.equal(approved,1);
 assert.equal(approveResult.handled,'approve');
 assert.match(approvedReply[0].text,/Orçamento ajustado/);
});

test('Owner-channel settings are owner-only and strictly validated',async()=>{
 const row={channelId,subject:'Meu Sócio',status:'active',errorCode:null,pageId:'1234567890',
  cityKey:'1234567',cityName:'São Paulo',dailyBudgetCents:5000,ageMin:18,ageMax:65,genders:[],
  destination:null,lastVideoId:null,lastSeenAt:null,createdAt:'2026-01-01',channelPhone:'5515999999999'};
 const pool=()=>stubPool(sql=>{
  if(/^SELECT g\.id/.test(sql))return {rowCount:1,rows:[row]};
  if(/^UPDATE socio_owner_groups SET/.test(sql))return {rowCount:1,rows:[{id:groupId}]};
  return {rowCount:0,rows:[]};
 });
 const owner={role:'owner',platform_owner:false,active_tenant_id:tenantId};
 const staff={role:'staff',platform_owner:false,active_tenant_id:tenantId};
 const snapshot=await readOwnerChannel(pool(),tenantId);
 assert.deepEqual(snapshot.missing,[],'destination falls back to the channel phone');
 await assert.rejects(updateOwnerChannelSettings(pool(),staff,{pageId:'1234'}),/Somente o dono/);
 await assert.rejects(updateOwnerChannelSettings(pool(),owner,{destination:'11999999999'}),/DDI\+DDD/);
 await assert.rejects(updateOwnerChannelSettings(pool(),owner,{dailyBudgetCents:50}),/Orçamento/);
 await assert.rejects(updateOwnerChannelSettings(pool(),owner,{ageMin:40,ageMax:30}),/idade/);
 await assert.rejects(updateOwnerChannelSettings(pool(),owner,{cityKey:'1234567'}),/cidade/);
 await assert.rejects(updateOwnerChannelSettings(pool(),owner,{genders:[1,3]}),/inválida/);
 await assert.rejects(updateOwnerChannelSettings(pool(),owner,{}),/Nada para atualizar/);
 const p=pool();
 await updateOwnerChannelSettings(p,owner,{destination:'55 11 98888-8888',genders:[1,2]});
 const update=p.calls.find(c=>/^UPDATE socio_owner_groups SET/.test(c.sql));
 assert.match(update.sql,/whatsapp_destination=\$\d/);
 assert.match(update.sql,/ad_genders=\$\d/);
 assert.ok(update.args.includes('5511988888888'));
 assert.ok(update.args.includes('{1,2}'));
 assert.equal(update.args[0],tenantId);
});

test('Ad copy falls back to catalog data without inventing prices',async()=>{
 const pool=stubPool(sql=>{
  if(/FROM products/.test(sql))return {rowCount:1,rows:[{
   name:'Corte feminino',description:'Corte e escova',price_cents:5500}]};
  return {rowCount:0,rows:[]};
 });
 const copy=await draftAdCopy(pool,{tenantId,tenantName:'Studio Bela',env:{}});
 assert.equal(copy.provider,'template');
 assert.equal(copy.headline,'Corte feminino');
 assert.match(copy.message,/Studio Bela/);
 assert.match(copy.message,/55,00/);
 const empty=await draftAdCopy(stubPool(()=>({rowCount:0,rows:[]})),{tenantId,tenantName:'Studio Bela',env:{}});
 assert.equal(empty.headline,'Studio Bela');
 assert.match(empty.message,/WhatsApp/);
});
