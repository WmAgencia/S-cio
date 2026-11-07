import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {googleAdsConfig,startGoogleAdsOAuth,finishGoogleAdsOAuth,
 googleAdsStatus,listGoogleAdsAccounts,selectGoogleAdsAccount,disconnectGoogleAds} from '../socio-google-ads.mjs';

const tenant=randomUUID(),uid=randomUUID();
const env={
 SOCIO_GOOGLE_ADS_ENABLED:'true',SOCIO_GOOGLE_OAUTH_CLIENT_ID:'123456789-abc.apps.googleusercontent.com',
 SOCIO_GOOGLE_OAUTH_CLIENT_SECRET:'GOCSPX_fake-secret-only-testing',
 SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN:'dev-token-only-testing-999',
 SOCIO_PUBLIC_URL:'https://socio-app-production-762c.up.railway.app',
 CHANNEL_ENCRYPTION_KEY:'not-real-key-'+('x'.repeat(50))
};
const actor={role:'owner',user_id:uid,active_tenant_id:tenant,tenant_status:'trial',
 token_hash:'a'.repeat(64),features:{meta_ads:true,whatsapp:true,catalog:true,quotes:true,ai:true,team:true}};
test('Google Ads is disabled until OAuth credentials, developer token, encryption and opt-in',()=>{
 const no=googleAdsConfig({});
 assert.equal(no.ready,false);
 assert(no.blockers.some(x=>x.includes('developer token')));
 const good=googleAdsConfig(env);
 assert.equal(good.ready,true);
 assert.equal(good.callback,'https://socio-app-production-762c.up.railway.app/api/google-ads/oauth/callback');
 assert.equal(good.mode,'oauth_read_only');
});
test('OAuth starts only as authorized tenant with encrypted one-use PKCE and Google scope',async()=>{
 let stateRow;
 const db={query:async(sql,args)=>{
  assert.match(sql,/INSERT INTO socio_google_ads_states/);
  assert.equal(args[1],tenant);assert.equal(args[2],uid);assert.equal(args[3],actor.token_hash);
  stateRow=args;return {rowCount:1};
 }};
 const started=await startGoogleAdsOAuth(db,actor,{env});
 const u=new URL(started.authorizationUrl);
 assert.equal(u.origin,'https://accounts.google.com');
 assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/adwords');
 assert.equal(u.searchParams.get('access_type'),'offline');
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('state').length,64);
 assert(!stateRow[4].includes('google-ads-pkce:'));
 assert(!JSON.stringify(started).includes(env.SOCIO_GOOGLE_OAUTH_CLIENT_SECRET));
 await assert.rejects(startGoogleAdsOAuth(db,{...actor,role:'agent'},{env}),{status:403});
 await assert.rejects(startGoogleAdsOAuth(db,actor,{env:{...env,SOCIO_GOOGLE_ADS_ENABLED:'false'}}),{status:503});
});
test('callback only consumes state with live session and encrypts token; no provider data in response',async()=>{
 const verifier='secure-verifier-'+('v'.repeat(55));
 const stored=sealMarketingSecret('google-ads-pkce:'+tenant+':'+verifier,env);
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push(sql);
  if(sql.startsWith('DELETE FROM socio_google_ads_states'))return {rows:[{tenant_id:tenant,user_id:uid,verifier_ciphertext:stored}],rowCount:1};
  if(sql.startsWith('INSERT INTO socio_google_ads_grants')){
   assert.equal(args[0],tenant);
   assert(!args[2].includes('refresh-token-secret'));
   return {rowCount:1};
  }
  throw Error('unexpected SQL');
 }};
 const resp=await finishGoogleAdsOAuth(pool,'b'.repeat(64),'valid-code-1234',{env,request:async(url,opts)=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(opts.body.get('code_verifier'),verifier);
  return {ok:true,json:async()=>({refresh_token:'refresh-token-secret-'+('r'.repeat(70)),access_token:'access'})};
 }});
 assert.equal(resp.connected,true);assert.equal(resp.readOnly,true);
 assert.equal(calls.length,2);
 await assert.rejects(finishGoogleAdsOAuth({query:async()=>({rows:[]})},'b'.repeat(64),'valid-code-1234',{env}),{status:403});
});
test('account discovery requires valid Google Ads developer token header and tenant-bound encrypted grant',async()=>{
 const cipher=sealMarketingSecret(JSON.stringify({tenant,uid,refresh:'r'.repeat(80)}),env);
 let selected=null,n=0;
 const pool={query:async(sql,args)=>{
  n++;
  assert.equal(args[0],tenant);
  if(sql.includes('SELECT token_ciphertext'))return {rows:[{token_ciphertext:cipher,selected_customer_id:selected}]};
  if(sql.startsWith('UPDATE socio_google_ads_grants SET checked_at'))return {rowCount:1};
  if(sql.startsWith('UPDATE socio_google_ads_grants SET selected_customer_id')){selected=args[1];return {rowCount:1};}
  throw Error('SQL mismatch '+sql);
 }};
 const request=async(url,opts)=>{
  if(url.includes('oauth2.googleapis.com')){
   assert.equal(opts.body.get('grant_type'),'refresh_token');
   return {ok:true,json:async()=>({access_token:'long-access-token-'+'a'.repeat(30)})};
  }
  assert.equal(url,'https://googleads.googleapis.com/v26/customers:listAccessibleCustomers');
  assert.equal(opts.headers['developer-token'],env.SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN);
  assert.match(opts.headers.Authorization,/Bearer long-access-token/);
  return {ok:true,json:async()=>({resourceNames:['customers/1234567890','customers/0987654321']})};
 };
 const result=await listGoogleAdsAccounts(pool,actor,{env,request});
 assert.equal(result.accounts.length,2);
 assert.equal(result.readOnly,true);
 assert(!JSON.stringify(result).includes('r'.repeat(80)));
 const chosen=await selectGoogleAdsAccount(pool,actor,'0987654321',{env,request});
 assert.equal(chosen.selectedCustomerId,'0987654321');
 assert.equal(selected,'0987654321');
 await assert.rejects(selectGoogleAdsAccount(pool,actor,'5555555555',{env,request}),{status:403});
 await assert.rejects(selectGoogleAdsAccount(pool,{...actor,role:'agent'},'1234567890',{env,request}),{status:403});
 assert(n>=5);
});
test('Google disconnected state is clear and every grant query is tenant-scoped',async()=>{
 const pool={query:async(sql,args)=>{assert.equal(args[0],tenant);return {rows:[],rowCount:1};}};
 const status=await googleAdsStatus(pool,actor,{env});
 assert.equal(status.connected,false);assert.equal(status.canCreateCampaigns,false);
 assert.equal(status.checkedAccountCount,null);
 const disconnected=await disconnectGoogleAds(pool,actor);
 assert.equal(disconnected.disconnected,true);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/\/api\/google-ads\/oauth\/callback/);
 assert.match(server,/\/api\/google-ads\/accounts\/select/);
 assert.match(server,/\/api\/google-ads\/disconnect/);
 assert(!server.includes("googleads.googleapis.com/v26/campaigns:mutate"));
});
