import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool,Client} from 'pg';
import {
 instagramReady,instagramAuthorizeUrl,encryptInstagramToken,decryptInstagramToken,
 verifyInstagramSignature,parseInstagramWebhook,beginInstagramOAuth,completeInstagramOAuth,
 ingestInstagramWebhook,sendInstagramReply,revokeInstagramAccount
} from '../instagram-integration.mjs';

const env={
 INSTAGRAM_APP_ID:'12345678',INSTAGRAM_APP_SECRET:'not-a-real-app-secret-fixture',
 INSTAGRAM_WEBHOOK_VERIFY_TOKEN:'fixture-only-verification',
 CHANNEL_ENCRYPTION_KEY:'integration-test-only-long-encryption-key-2026-2026',
 SOCIO_PUBLIC_URL:'https://socio.example.test',INSTAGRAM_GRAPH_VERSION:'v26.0',
 SOCIO_OUTBOUND_ENABLED:'true'
};
const sign=raw=>'sha256='+createHmac('sha256',env.INSTAGRAM_APP_SECRET).update(raw).digest('hex');
const rawEvent=(mid='fixture-1',recipient='9988776655',sender='1234512345',when=Date.now())=>Buffer.from(JSON.stringify({
 object:'instagram',entry:[{id:recipient,messaging:[{
  sender:{id:sender},recipient:{id:recipient},timestamp:when,
  message:{mid,text:'Olá! Preciso de ajuda.'}
 }]}]
}));
const ok=data=>({ok:true,json:async()=>data});

test('Instagram credentials fail closed; OAuth and encryption never leak secrets',()=>{
 assert.equal(instagramReady({}),false);
 assert.equal(instagramReady(env),true);
 assert.throws(()=>instagramAuthorizeUrl('not-random',env));
 const link=instagramAuthorizeUrl('f'.repeat(64),env);
 const params=new URL(link).searchParams;
 assert.equal(params.get('client_id'),env.INSTAGRAM_APP_ID);
 assert.equal(params.get('redirect_uri'),'https://socio.example.test/api/instagram/oauth/callback');
 assert.equal(params.get('scope'),'instagram_business_basic,instagram_business_manage_messages');
 assert(!link.includes(env.INSTAGRAM_APP_SECRET));
 const sealed=encryptInstagramToken('a-valid-fixture-access-token-123456',env);
 assert(!sealed.includes('a-valid-fixture-access-token'));
 assert.equal(decryptInstagramToken(sealed,env),'a-valid-fixture-access-token-123456');
 assert.throws(()=>decryptInstagramToken(sealed,{...env,CHANNEL_ENCRYPTION_KEY:'wrong-but-long-enough-secret-111111111111'}));
});
test('signed Instagram webhook accepts only authentic inbound text and de-duplicates events',()=>{
 const raw=rawEvent();
 assert.equal(verifyInstagramSignature(raw,sign(raw),env),true);
 assert.equal(verifyInstagramSignature(raw,'sha256='+'0'.repeat(64),env),false);
 assert.equal(verifyInstagramSignature(raw,'',env),false);
 const parsed=parseInstagramWebhook(JSON.parse(raw.toString()));
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].text,'Olá! Preciso de ajuda.');
 const fixture=JSON.parse(raw.toString());
 fixture.entry[0].messaging.push(structuredClone(fixture.entry[0].messaging[0]));
 assert.equal(parseInstagramWebhook(fixture).length,1,'Duplicate events in batch ignored');
 fixture.entry[0].messaging[0].message.is_echo=true;
 assert.equal(parseInstagramWebhook(fixture).length,1,'Echo ignored');
 fixture.entry[0].messaging[1].message.is_echo=true;
 assert.equal(parseInstagramWebhook(fixture).length,0,'All echoes ignored');
 assert.equal(parseInstagramWebhook({object:'whatsapp_business_account',entry:fixture.entry}).length,0);
 assert.equal(parseInstagramWebhook(JSON.parse(rawEvent('x','999','888',Date.now()-9*86400000))).length,0);
 assert.equal(parseInstagramWebhook(JSON.parse(rawEvent('x','999','888',Date.now()+80000))).length,0);
});
test('real ephemeral PostgreSQL: OAuth, isolation, HMAC, idempotency, 23h manual send and revocation',
 {skip:!process.env.DATABASE_URL,timeout:95000},async t=>{
 const name='socio_instagram_phase6_test_'+Math.random().toString(16).slice(2,12),
  sourceUrl=new URL(process.env.DATABASE_URL);sourceUrl.pathname='/'+name;
 const admin=new Client({connectionString:process.env.DATABASE_URL});
 await admin.connect();
 await admin.query('CREATE DATABASE '+name);
 const pool=new Pool({connectionString:sourceUrl.href});
 t.after(async()=>{
  await pool.end().catch(()=>{});
  // Close the disposable pool cleanly; FORCE can race with late client socket events.
  await admin.query('DROP DATABASE IF EXISTS '+name).catch(()=>{});
  await admin.end();
 });
 await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 const alpha=randomUUID(),beta=randomUUID(),userA=randomUUID(),userB=randomUUID();
 await pool.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3),($4,$5,$6)',
  [alpha,'Empresa A','ig-alpha',beta,'Empresa B','ig-beta']);
 await pool.query("INSERT INTO users(id,tenant_id,name,email,password_hash,role) "+
  "VALUES($1,$2,'Dona A','owner-a@ig.test','fixture','owner'),"+
  "($3,$4,'Dono B','owner-b@ig.test','fixture','owner')",
  [userA,alpha,userB,beta]);
 const oauth=await beginInstagramOAuth(pool,alpha,userA,env);
 const state=new URL(oauth.authorizationUrl).searchParams.get('state');
 let sent=0;
 const request=async(url,options)=>{
  const target=String(url);
  if(target.includes('api.instagram.com/oauth/access_token'))
   return ok({access_token:'short-lived-example-long-enough',user_id:'9988776655'});
  if(target.startsWith('https://graph.instagram.com/access_token?'))
   return ok({access_token:'long-lived-example-long-enough',expires_in:5184000});
  if(target.includes('/me?fields='))
   return ok({id:'9988776655',username:'consecom_teste',account_type:'BUSINESS'});
  if(target.includes('/messages')){
   sent++;
   assert.equal(options.method,'POST');
   assert.equal(JSON.parse(options.body).recipient.id,'1234512345');
   assert(!JSON.stringify(options.body).includes('agendar-prospeccao'));
   return ok({message_id:'meta-message-'+sent});
  }
  throw Error('Unexpected Meta URL');
 };
 const linked=await completeInstagramOAuth(pool,state,'example-code-12',{env,request});
 assert.equal(linked.username,'consecom_teste');
 const profile=await pool.query('SELECT token_ciphertext,tenant_id FROM instagram_accounts WHERE channel_id=$1',[linked.channelId]);
 assert.equal(profile.rows[0].tenant_id,alpha);
 assert(!profile.rows[0].token_ciphertext.includes('long-lived-example'));
 await assert.rejects(completeInstagramOAuth(pool,state,'example-code-12',{env,request}),e=>e.status===403);
 const other=await beginInstagramOAuth(pool,beta,userB,env);
 await assert.rejects(completeInstagramOAuth(pool,new URL(other.authorizationUrl).searchParams.get('state'),
  'example-code-12',{env,request}),e=>e.status===409);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM instagram_accounts')).rows[0].n,1);
 await assert.rejects(ingestInstagramWebhook(pool,rawEvent(),'sha256='+'0'.repeat(64),{env}),e=>e.status===403);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n,0);
 const inboundRaw=rawEvent();
 const first=await ingestInstagramWebhook(pool,inboundRaw,sign(inboundRaw),{env});
 assert.equal(first.imported,1);
 const replay=await ingestInstagramWebhook(pool,inboundRaw,sign(inboundRaw),{env});
 assert.equal(replay.imported,0);
 const conversation=(await pool.query("SELECT id,customer_phone FROM conversations WHERE tenant_id=$1",[alpha])).rows[0];
 assert.equal(conversation.customer_phone,'ig:1234512345');
 await assert.rejects(sendInstagramReply(pool,{tenantId:beta,conversationId:conversation.id,
  userId:userB,text:'Não permitido',clientRequestId:randomUUID(),env,request}),e=>e.status===403);
 await assert.rejects(sendInstagramReply(pool,{tenantId:alpha,conversationId:conversation.id,
  userId:userA,text:'Desligado',clientRequestId:randomUUID(),
  env:{...env,SOCIO_OUTBOUND_ENABLED:'false'},request}),e=>e.status===503);
 const messageId=randomUUID();
 const outbound=await sendInstagramReply(pool,{tenantId:alpha,conversationId:conversation.id,
  userId:userA,text:'Olá! Vamos ajudar.',clientRequestId:messageId,env,request});
 assert.equal(outbound.sent,true);
 assert.equal(sent,1);
 const duplicate=await sendInstagramReply(pool,{tenantId:alpha,conversationId:conversation.id,
  userId:userA,text:'Olá! Vamos ajudar.',clientRequestId:messageId,env,request});
 assert.equal(duplicate.reused,true);
 assert.equal(sent,1,'Replay cannot produce second remote DM');
 await assert.rejects(sendInstagramReply(pool,{tenantId:alpha,conversationId:conversation.id,
  userId:userA,text:'Texto diferente',clientRequestId:messageId,env,request}),e=>e.status===409);
 await pool.query("INSERT INTO conversation_ui_state(tenant_id,conversation_id,handling_mode) "+
  "VALUES($1,$2,'ai_assist')",[alpha,conversation.id]);
 await assert.rejects(sendInstagramReply(pool,{tenantId:alpha,conversationId:conversation.id,
  userId:userA,text:'Não é automático',clientRequestId:randomUUID(),env,request}),e=>e.status===403);
 await pool.query("UPDATE conversation_ui_state SET handling_mode='human' WHERE tenant_id=$1 AND conversation_id=$2",
  [alpha,conversation.id]);
 await pool.query("UPDATE messages SET created_at=now()-interval '25 hours' WHERE tenant_id=$1 AND direction='inbound'",[alpha]);
 await assert.rejects(sendInstagramReply(pool,{tenantId:alpha,conversationId:conversation.id,
  userId:userA,text:'Fora da janela',clientRequestId:randomUUID(),env,request}),e=>e.status===403);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE direction='outbound'")).rows[0].n,1);
 await assert.rejects(revokeInstagramAccount(pool,beta,userB,linked.channelId),e=>e.status===404);
 const revoked=await revokeInstagramAccount(pool,alpha,userA,linked.channelId);
 assert.equal(revoked.revoked,true);
 const deleted=await pool.query('SELECT status,token_ciphertext FROM instagram_accounts WHERE channel_id=$1',[linked.channelId]);
 assert.equal(deleted.rows[0].status,'revoked');
 assert.equal(deleted.rows[0].token_ciphertext,null);
 const revokedRaw=rawEvent('fixture-2');
 const after=await ingestInstagramWebhook(pool,revokedRaw,sign(revokedRaw),{env});
 assert.equal(after.imported,0,'Revoked company cannot receive Instagram DMs');
 assert.equal(after.ignored,1);
});
