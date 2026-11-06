import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isOwnerSkillCommand,stripOwnerPrefix,processOwnerSkillInbox} from '../socio-owner-skill-inbox.mjs';

const env={SOCIO_OWNER_COMMANDS_ENABLED:'true',SOCIO_OUTBOUND_ENABLED:'true',
 WA_AKG_API_KEY:'test-secret',WA_AKG_BASE_URL:'https://waakg.example.test'};
test('only explicit Sócio prefix is a command; ordinary customer messages never qualify',()=>{
 assert(isOwnerSkillCommand('Sócio, cria campanha para roupas femininas em Sorocaba'));
 assert(isOwnerSkillCommand('socio: pode criar'));
 assert.equal(stripOwnerPrefix('Sócio, pode criar'),'pode criar');
 assert.equal(stripOwnerPrefix('Socio: Quero anunciar roupa feminina'),'Quero anunciar roupa feminina');
 assert(!isOwnerSkillCommand('Cliente: quero criar uma campanha'));
 assert(!isOwnerSkillCommand('Olá, posso comprar roupas femininas?'));
 assert(!isOwnerSkillCommand('se fosse sócio, eu criava'));
});
test('WA-AKG owner bridge starts disabled and requires outbound health',async()=>{
 let calls=0;
 const pool={query:async()=>{calls++;throw Error('Should not query when disabled')}};
 const disabled=await processOwnerSkillInbox(pool,{env:{...env,SOCIO_OWNER_COMMANDS_ENABLED:'false'},enabled:true});
 assert.equal(disabled.reason,'OWNER_COMMANDS_DISABLED');
 const noOutbound=await processOwnerSkillInbox(pool,{env,enabled:false});
 assert.equal(noOutbound.reason,'OUTBOUND_NOT_READY');
 assert.equal(calls,0);
});
test('one verified owner private message can ask for a paused campaign and get a single WA-AKG reply',async()=>{
 const tenant=randomUUID(),user=randomUUID(),conversation=randomUUID(),inbound=randomUUID();
 const row={inbound_id:inbound,tenant_id:tenant,conversation_id:conversation,
  body:'Sócio, cria campanha de roupa feminina em Sorocaba gastando seis reais por dia',
  user_id:user,role:'owner',platform_owner:false,tenant_status:'active',
  tenant_name:'Loja do Bairro',features:{meta_ads:true,whatsapp:true,ai:true}};
 const records=[],queries=[];
 const pool={query:async(sql,args=[])=>{
  queries.push({sql,args});
  if(sql.startsWith('SELECT m.id AS inbound_id')){
   assert.match(sql,/u\.tenant_id=m\.tenant_id/);
   assert.match(sql,/u\.role IN \('owner','admin'\)/);
   assert.match(sql,/regexp_replace\(u\.phone/);
   assert.match(sql,/ch\.provider='waakg'/);
   assert.match(sql,/m\.provider_id LIKE 'waakg:%'/);
   assert.match(sql,/m\.direction='inbound'/);
   assert.match(sql,/s\[oó\]cio/);
   return {rowCount:records.length?0:1,rows:records.length?[]:[row]};
  }
  if(sql.startsWith('INSERT INTO socio_owner_skill_receipts')){
   assert.deepEqual(args.slice(1),[tenant,user,conversation,inbound]);
   records.push({id:args[0]});return {rowCount:1,rows:[{id:args[0]}]};
  }
  if(sql.startsWith('SELECT id FROM socio_skill_runs'))return {rowCount:0,rows:[]};
  if(sql.startsWith('UPDATE socio_owner_skill_receipts'))return {rowCount:1};
  throw Error('Unexpected SQL: '+sql.slice(0,100));
 }};
 let spoke=0,delivered=0;
 const speak=async(_db,actor,payload,opts)=>{
  spoke++;assert.equal(actor.active_tenant_id,tenant);
  assert.equal(actor.user_id,user);assert.equal(actor.role,'owner');
  assert.equal(opts.originConversationId,conversation);
  assert.equal(payload.message,'cria campanha de roupa feminina em Sorocaba gastando seis reais por dia');
  assert.equal(payload.runId,null);
  return {status:'collecting',runId:randomUUID(),message:'Me envie a foto do produto.'};
 };
 const deliver=async(_db,args)=>{
  delivered++;assert.equal(args.tenantId,tenant);
  assert.equal(args.conversationId,conversation);
  assert.equal(args.userId,user);assert.equal(args.mode,'human');
  assert.match(args.text,/foto/);
  assert.match(args.clientRequestId,/^[a-f0-9-]{36}$/);
  return {sent:true};
 };
 const result=await processOwnerSkillInbox(pool,{env,enabled:true,speak,deliver});
 assert.equal(result.processed,true);assert.equal(result.replySent,true);
 assert.equal(spoke,1);assert.equal(delivered,1);
 const again=await processOwnerSkillInbox(pool,{env,enabled:true,speak,deliver});
 assert.equal(again.reason,'NO_AUTHORIZED_OWNER_COMMAND');
 assert.equal(spoke,1);assert.equal(delivered,1);
});
test('ambiguous gateway send is not retried by the worker',async()=>{
 const row={inbound_id:randomUUID(),tenant_id:randomUUID(),conversation_id:randomUUID(),
  body:'Sócio, pode criar',user_id:randomUUID(),role:'owner',tenant_status:'active',features:{ai:true,meta_ads:true,whatsapp:true}};
 let state='processing';
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT m.id AS inbound_id'))return {rowCount:1,rows:[row]};
  if(sql.startsWith('INSERT INTO socio_owner_skill_receipts'))return {rowCount:1,rows:[{id:args[0]}]};
  if(sql.startsWith('SELECT id FROM socio_skill_runs'))return {rowCount:1,rows:[{id:randomUUID()}]};
  if(sql.startsWith('UPDATE socio_owner_skill_receipts')){
   if(sql.includes("status='uncertain'"))state='uncertain';
   return {rowCount:1};
  }
  throw Error('Unexpected SQL');
 }};
 const result=await processOwnerSkillInbox(pool,{env,enabled:true,
  speak:async()=>({status:'completed',runId:randomUUID(),message:'Pronto, criado pausado'}),
  deliver:async()=>{throw Error('Gateway timeout')}});
 assert.equal(result.replySent,false);assert.equal(result.reason,'DELIVERY_UNCONFIRMED');
 assert.equal(state,'uncertain');
});
