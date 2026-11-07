import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {readGoogleAdsCampaigns} from '../socio-google-ads.mjs';

const tenant=randomUUID(),uid=randomUUID();
const env={
 SOCIO_GOOGLE_ADS_ENABLED:'true',
 SOCIO_GOOGLE_OAUTH_CLIENT_ID:'123456789-abc.apps.googleusercontent.com',
 SOCIO_GOOGLE_OAUTH_CLIENT_SECRET:'GOCSPX_mock-only-testing',
 SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN:'developer-token-mock-only',
 SOCIO_PUBLIC_URL:'https://socio.example.com',
 CHANNEL_ENCRYPTION_KEY:'mock-key-'+('a'.repeat(60))
};
const actor={role:'owner',user_id:uid,active_tenant_id:tenant,tenant_status:'trial',
 features:{meta_ads:true,whatsapp:true,catalog:true,quotes:true,ai:true,team:true}};
const cipher=sealMarketingSecret(JSON.stringify({tenant,uid,refresh:'mock-refresh-'+('r'.repeat(60))}),env);
const db=(selected='1234567890',tokenCipher=cipher)=>({
 query:async(sql,args)=>{
  assert.match(sql,/WHERE tenant_id=\$1/);
  assert.equal(args[0],tenant);
  return {rows:[{token_ciphertext:tokenCipher,selected_customer_id:selected}]};
 }
});
const oneCampaign={campaign:{id:'123',name:'Pesquisa Sorocaba',status:'ENABLED',advertisingChannelType:'SEARCH'},
 metrics:{impressions:'2500',clicks:'100',ctr:0.04,averageCpc:'200000',costMicros:'20000000',conversions:3.5}};
function requestSpy(response=[{results:[oneCampaign]}]){
 const calls=[];
 const request=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('oauth2.googleapis.com')){
   assert.equal(opts.body.get('grant_type'),'refresh_token');
   return {ok:true,json:async()=>({access_token:'mock-access-token-'+'x'.repeat(48)})};
  }
  return {ok:true,json:async()=>response};
 };
 return {calls,request};
}
test('campaign report uses only authorized selected customer, a fixed read-only query, no mutation',async()=>{
 const spy=requestSpy();
 const out=await readGoogleAdsCampaigns(db(),actor,{env,request:spy.request});
 assert.equal(spy.calls.length,2);
 const call=spy.calls[1];
 assert.equal(call.url,'https://googleads.googleapis.com/v26/customers/1234567890/googleAds:searchStream');
 assert.equal(call.opts.method,'POST'); // Google reports use POST to searchStream, not mutate
 assert.equal(call.opts.headers['developer-token'],env.SOCIO_GOOGLE_ADS_DEVELOPER_TOKEN);
 const query=JSON.parse(call.opts.body).query;
 assert.match(query,/FROM campaign/);
 assert.match(query,/LAST_30_DAYS/);
 assert.match(query,/LIMIT 100/);
 assert.doesNotMatch(call.url,/mutate/);
 assert.equal(out.readOnly,true);
 assert.equal(out.liveQuerySucceeded,true);
 assert.equal(out.summary.impressions,'2500');
 assert.equal(out.summary.costMicros,'20000000');
 assert.equal(out.campaigns[0].conversions,3.5);
 assert.equal(out.currencyCode,null);
 assert(!JSON.stringify(out).includes('mock-refresh'));
});
test('campaign reports require a selected account and do not cross tenant boundaries',async()=>{
 const spy=requestSpy();
 await assert.rejects(readGoogleAdsCampaigns(db(null),actor,{env,request:spy.request}),{status:409});
 assert.equal(spy.calls.filter(x=>x.url.includes('googleads.googleapis.com')).length,0);
 const other=sealMarketingSecret(JSON.stringify({tenant:randomUUID(),uid,refresh:'another-'+('r'.repeat(60))}),env);
 await assert.rejects(readGoogleAdsCampaigns(db('1234567890',other),actor,{env,request:spy.request}),{status:403});
 await assert.rejects(readGoogleAdsCampaigns(db(),{...actor,role:'agent'},{env,request:spy.request}),{status:403});
});
test('report refuses provider failures and inconsistent campaign data; no fake spend',async()=>{
 const failing=requestSpy([{results:[{campaign:{id:'123',name:'A'},metrics:{costMicros:'NOT_MONEY'}}]}]);
 await assert.rejects(readGoogleAdsCampaigns(db(),actor,{env,request:failing.request}),{status:503});
 const nonArray=requestSpy({results:[]});
 await assert.rejects(readGoogleAdsCampaigns(db(),actor,{env,request:nonArray.request}),{status:503});
 const network=requestSpy();
 network.request=async(url,opts)=>url.includes('oauth2.googleapis.com')
  ? {ok:true,json:async()=>({access_token:'mock-access-token-'+'x'.repeat(48)})}
  : Promise.reject(Error('do not disclose upstream errors'));
 await assert.rejects(readGoogleAdsCampaigns(db(),actor,{env,request:network.request}),{status:503});
});
test('report is wired as an authenticated GET route with no new Google Ads write operations',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/socio-integrations-ui.js',import.meta.url),'utf8');
 assert.match(server,/pathname==='\/api\/google-ads\/campaigns'/);
 assert.match(server,/readGoogleAdsCampaigns\(pool,a,\{period:/);
 assert.match(ui,/Consultar campanhas \(30 dias\)/);
 assert.doesNotMatch(server,/googleAds:mutate/);
});
