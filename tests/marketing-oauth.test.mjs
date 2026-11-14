import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createTestDatabase} from './helpers/test-database.mjs';
import {
 startPipeboardOAuth,finishPipeboardOAuth,listPipeboardOAuth,revokePipeboardOAuth,
 oauthClientMetadata
} from '../marketing-oauth.mjs';
import {instagramHostedReady,beginInstagramHosted,instagramHostedStatus,disconnectInstagramHosted} from '../instagram-hosted.mjs';

const env={CHANNEL_ENCRYPTION_KEY:'oauth-unit-2026-test-32-bytes-minimum-key-2026',
 SOCIO_PUBLIC_URL:'https://socio.example.test',
 AYRSHARE_API_KEY:'agency-admin-api-test-secret',
 AYRSHARE_SSO_DOMAIN:'socio-test',
 AYRSHARE_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nunit-test-only-key\n-----END PRIVATE KEY-----'};
const pipeboard={
 meta:'https://meta-ads.mcp.pipeboard.co',
 google:'https://google-ads.mcp.pipeboard.co'
};
function pbMock({evil=false}={}){
 const calls=[];
 const request=async(url,options)=>{
  const target=String(url);calls.push({target,method:options.method,body:String(options.body||'')});
  const result=x=>({ok:true,text:async()=>JSON.stringify(x)});
  if(target.endsWith('/.well-known/oauth-protected-resource'))return result({
   authorization_servers:['https://pipeboard.co']});
  if(target==='https://pipeboard.co/.well-known/oauth-authorization-server')return result({
   issuer:'https://pipeboard.co',
   authorization_endpoint:evil?'https://attacker.example/steal':'https://pipeboard.co/oauth/authorize',
   token_endpoint:'https://pipeboard.co/oauth/token',
   registration_endpoint:'https://pipeboard.co/oauth/register'
  });
  if(target==='https://pipeboard.co/oauth/register'){
   const body=JSON.parse(options.body);
   assert.deepEqual(body.redirect_uris,['https://socio.example.test/api/marketing/oauth/callback']);
   assert.equal(body.token_endpoint_auth_method,'none');
   return result({client_id:'socio-unit-test-client',token_endpoint_auth_method:'none'});
  }
  if(target==='https://pipeboard.co/oauth/token'){
   assert.equal(options.method,'POST');
   const payload=new URLSearchParams(options.body);
   assert.equal(payload.get('grant_type'),'authorization_code');
   assert.equal(payload.get('redirect_uri'),'https://socio.example.test/api/marketing/oauth/callback');
   assert.equal(payload.get('client_id'),'socio-unit-test-client');
   assert(payload.get('code_verifier').length>43);
   return result({access_token:'pipeboard-fake-access-token-1234567890',
    refresh_token:'pipeboard-fake-refresh-token-1234567890',token_type:'Bearer',expires_in:3600});
  }
  throw Error('Unexpected Pipeboard endpoint '+target);
 };
 return {request,calls};
}
function igMock(){
 const calls=[];
 const request=async(url,options)=>{
  const target=String(url),method=options.method;
  calls.push({target,method,body:String(options.body||''),profileKey:options.headers['Profile-Key']||null});
  const result=x=>({ok:true,text:async()=>JSON.stringify(x)});
  if(target==='https://api.ayrshare.com/api/profiles'&&method==='POST'){
   const payload=JSON.parse(options.body);
   assert.equal(payload.messagingActive,false);
   return result({status:'success',refId:'test-profile-reference-01',
    profileKey:'TEST-PROFILE-SECRET-20261104'});
  }
  if(target==='https://api.ayrshare.com/api/profiles/generateJWT'&&method==='POST'){
   const payload=JSON.parse(options.body);
   assert.deepEqual(payload.allowedSocial,['instagram']);
   assert.equal(payload.profileKey,'TEST-PROFILE-SECRET-20261104');
   assert.equal(payload.redirect,'https://socio.example.test/?instagram=return');
   return result({status:'success',url:'https://profile.ayrshare.com?domain=socio-test&jwt=fake-jwt'});
  }
  if(target==='https://api.ayrshare.com/api/profiles?refId=test-profile-reference-01'&&method==='GET')
   return result({profiles:[{refId:'test-profile-reference-01',status:'active',activeSocialAccounts:['instagram']}]});
  if(target==='https://api.ayrshare.com/api/profiles/social'&&method==='DELETE'){
   assert.equal(options.headers['Profile-Key'],'TEST-PROFILE-SECRET-20261104');
   assert.equal(JSON.parse(options.body).platform,'instagram');
   return result({status:'success',platform:'instagram'});
  }
  throw Error('Unexpected Ayrshare endpoint '+target);
 };
 return {calls,request};
}

test('OAuth provider redirects are allowlisted and secrets are never in URLs',async()=>{
 assert.deepEqual(oauthClientMetadata(env).redirect_uris,
  ['https://socio.example.test/api/marketing/oauth/callback']);
 await assert.rejects(startPipeboardOAuth({query:()=>{throw Error('No DB');}},
  {active_tenant_id:randomUUID(),user_id:randomUUID()},'meta',{env,request:pbMock({evil:true}).request}),
  e=>e.status===503);
 assert.equal(instagramHostedReady({}),false);
 assert.equal(instagramHostedReady(env),true);
});

test('disposable Postgres Meta-only OAuth: tenant ownership, one-use state, encrypted tokens and revoke',
 {skip:!process.env.DATABASE_URL,timeout:100000},async t=>{
 const {url:dbUrl,drop}=await createTestDatabase('socio_oauth_test_',{schema:'public'});
 const pool=new Pool({connectionString:dbUrl.href});
 t.after(async()=>{
  await pool.end().catch(()=>{});
  await drop();
 });
 const tenantA=randomUUID(),tenantB=randomUUID(),ownerA=randomUUID(),ownerB=randomUUID();
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Empresa A','oauth-a'),($2,'Empresa B','oauth-b')",
  [tenantA,tenantB]);
 await pool.query(
  "INSERT INTO users(id,tenant_id,name,email,password_hash,role,active) VALUES "+
  "($1,$2,'Owner A','oauth-a@example.test','fixture','owner',true),"+
  "($3,$4,'Owner B','oauth-b@example.test','fixture','owner',true)",
  [ownerA,tenantA,ownerB,tenantB]);
 const a={active_tenant_id:tenantA,user_id:ownerA};
 const b={active_tenant_id:tenantB,user_id:ownerB};
 const mock=pbMock();
 const auth=await startPipeboardOAuth(pool,a,'meta',{env,request:mock.request});
 const url=new URL(auth.authorizationUrl);
 assert.equal(url.host,'pipeboard.co');
 assert.equal(url.searchParams.get('response_type'),'code');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('state').length,64);
 assert(!auth.authorizationUrl.includes('CLIENT_SECRET'));
 assert.equal((await listPipeboardOAuth(pool,a)).length,0);
 const finished=await finishPipeboardOAuth(pool,url.searchParams.get('state'),
  'oauth-code-not-real-123456789',{env,request:mock.request});
 assert.equal(finished.status,'authorized');
 assert.equal(finished.provider,'meta');
 await assert.rejects(finishPipeboardOAuth(pool,url.searchParams.get('state'),
  'oauth-code-not-real-123456789',{env,request:mock.request}),e=>e.status===403);
 const record=await pool.query('SELECT token_ciphertext FROM marketing_oauth_grants WHERE tenant_id=$1',[tenantA]);
 assert.equal(record.rowCount,1);
 assert(!record.rows[0].token_ciphertext.includes('pipeboard-fake-access-token'));
 assert.equal((await listPipeboardOAuth(pool,b)).length,0);
 assert.equal((await listPipeboardOAuth(pool,a))[0].provider,'meta');
 assert.equal((await listPipeboardOAuth(pool,a))[0].last_read_status,'not_tested');
 await assert.rejects(startPipeboardOAuth(pool,a,'google',{env,request:mock.request}),
  e=>e.status===422,'Retired Google Ads OAuth must be unavailable');
 assert.deepEqual((await listPipeboardOAuth(pool,a)).map(g=>g.provider),['meta']);
 await assert.rejects(revokePipeboardOAuth(pool,b,'meta'),e=>e.status===404);
 assert.equal((await revokePipeboardOAuth(pool,a,'meta')).disconnected,true);
 assert.equal((await listPipeboardOAuth(pool,a)).length,0);
 const revoked=await pool.query("SELECT token_ciphertext,last_read_status,last_account_count,last_checked_at FROM marketing_oauth_grants WHERE tenant_id=$1 AND provider='meta'",
  [tenantA]);
 assert.equal(revoked.rows[0].token_ciphertext,null);
 assert.equal(revoked.rows[0].last_read_status,'not_tested');
 assert.equal(revoked.rows[0].last_account_count,0);
 assert.equal(revoked.rows[0].last_checked_at,null);
 const newAuthorization=await startPipeboardOAuth(pool,a,'meta',{env,request:mock.request});
 await pool.query("UPDATE users SET active=false WHERE id=$1",[ownerA]);
 await assert.rejects(finishPipeboardOAuth(pool,new URL(newAuthorization.authorizationUrl).searchParams.get('state'),
  'new-test-code-123456',{env,request:mock.request}),e=>e.status===403);
});

test('Instagram managed SSO: tenant profile, encrypted keys, authorized URL, status and logout',
 {skip:!process.env.DATABASE_URL,timeout:80000},async t=>{
 const {url:dbUrl,drop}=await createTestDatabase('socio_ig_sso_test_',{schema:'public'});
 const pool=new Pool({connectionString:dbUrl.href});
 t.after(async()=>{
  await pool.end().catch(()=>{});
  await drop();
 });
 const tenant=randomUUID(),user=randomUUID(),bTenant=randomUUID(),bUser=randomUUID();
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Empresa A','ig-sso-a'),($2,'Empresa B','ig-sso-b')",[tenant,bTenant]);
 await pool.query("INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES "+
  "($1,$2,'Owner A','ig-sso-a@example.test','fixture','owner'),"+
  "($3,$4,'Owner B','ig-sso-b@example.test','fixture','owner')",
  [user,tenant,bUser,bTenant]);
 const owner={active_tenant_id:tenant,user_id:user},other={active_tenant_id:bTenant,user_id:bUser};
 const fake=igMock();
 const started=await beginInstagramHosted(pool,owner,'Empresa A',{env,request:fake.request});
 assert.equal(new URL(started.authorizationUrl).hostname,'profile.ayrshare.com');
 assert.equal(started.status,'pending');
 const stored=await pool.query("SELECT profile_ref,profile_key_ciphertext FROM instagram_hosted_profiles WHERE tenant_id=$1",[tenant]);
 assert.equal(stored.rowCount,1);
 assert(!stored.rows[0].profile_key_ciphertext.includes('TEST-PROFILE-SECRET'));
 assert.equal((await instagramHostedStatus(pool,owner,{env,request:fake.request})).linked,true);
 assert.equal((await instagramHostedStatus(pool,other,{env,request:fake.request})).linked,false);
 const again=await beginInstagramHosted(pool,owner,'Empresa A',{env,request:fake.request});
 assert.equal(again.status,'pending');
 assert.equal(fake.calls.filter(c=>c.target==='https://api.ayrshare.com/api/profiles'&&c.method==='POST').length,1);
 assert.equal((await disconnectInstagramHosted(pool,owner,{env,request:fake.request})).ok,true);
 assert.equal((await pool.query('SELECT status FROM instagram_hosted_profiles WHERE tenant_id=$1',[tenant])).rows[0].status,'pending');
 await assert.rejects(disconnectInstagramHosted(pool,other,{env,request:fake.request}),e=>e.status===404);
});

test('read-only connection test keeps tenant scope and calls only account listing tools',async()=>{
 const {testPipeboardConnection,decodeMcpReply,normalizeAdsAccounts}=await import('../marketing-oauth.mjs');
 const {sealMarketingSecret}=await import('../marketing-integrations.mjs');
 const tenant=randomUUID(),identity={active_tenant_id:tenant,user_id:randomUUID()};
 const sealed=sealMarketingSecret('socio-oauth-v1:'+JSON.stringify({access_token:'test-access-token-no-production-data'}),env);
 const calls=[],writes=[];
 const pool={query:async(sql,args)=>{
  assert.equal(args[0],tenant);
  if(sql.startsWith('SELECT '))return {rowCount:1,rows:[{
   token_ciphertext:sealed,expires_at:new Date(Date.now()+60000)}]};
  if(sql.startsWith('UPDATE marketing_oauth_grants SET last_read_status')){
   assert.equal(args[1],'meta');
   assert.equal(args[2],sealed);
   assert.equal(args[3],'verified');
   assert.equal(args[4],1);
   writes.push(args);
   return {rowCount:1,rows:[{last_checked_at:new Date()}]};
  }
  throw Error('SQL inesperado: '+sql);
 }};
 const request=async(url,opts)=>{
  const rpc=JSON.parse(opts.body);calls.push(rpc);
  let result={};
  if(rpc.method==='tools/list')result={tools:[{name:'delete_campaign',inputSchema:{}},{name:'mcp_meta_ads_get_ad_accounts',inputSchema:{required:['user_id']}}]};
  if(rpc.method==='tools/call'){
   assert.equal(rpc.params.name,'mcp_meta_ads_get_ad_accounts');
   result={content:[{type:'text',text:JSON.stringify({accounts:[{id:'act_123456',name:'Conta teste'}]})}]};
  }
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({jsonrpc:'2.0',id:rpc.id,result})};
 };
 const verified=await testPipeboardConnection(pool,identity,'meta',{env,request});
 assert.equal(verified.status,'verified');assert.deepEqual(verified.accounts,[{id:'act_123456',name:'Conta teste'}]);
 assert.equal(writes.length,1,'Verificação real de leitura persistida apenas no tenant correto');
 assert.deepEqual(calls.map(x=>x.method),['initialize','notifications/initialized','tools/list','tools/call']);
 assert.deepEqual(normalizeAdsAccounts({structuredContent:{resourceNames:['customers/1234567890']}},'google'),[{id:'1234567890',name:'1234567890'}]);
 assert.throws(()=>decodeMcpReply('{"id":1,"result":{"isError":true}}',1));
 await assert.rejects(testPipeboardConnection({query:async()=>({rowCount:0})},identity,'google',{env,request}),e=>e.status===422);
 await assert.rejects(testPipeboardConnection(pool,identity,'google',{env,request}),e=>e.status===422);
});

 test('FastMCP string return wrappers preserve real Meta account data',async()=>{
 const {normalizeAdsAccounts}=await import('../marketing-oauth.mjs');
 assert.deepEqual(normalizeAdsAccounts({structuredContent:{result:JSON.stringify({data:[{id:'act_123456',name:'Conta real formato'}]})}},'meta'),[{id:'act_123456',name:'Conta real formato'}]);
 assert.throws(()=>normalizeAdsAccounts({structuredContent:{result:JSON.stringify({error:'denied'})}},'meta'));
 });
