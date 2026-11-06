import test from 'node:test';
import assert from 'node:assert/strict';
import {officialConfig,startOfficial,finishOfficial,officialGraph,officialAccounts,disconnectOfficial} from '../meta-official.mjs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'test-secret',SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'test-encryption-key-at-least-thirty-two-characters'};
const a={active_tenant_id:'tenant-a',user_id:'user-a',token_hash:'session',role:'owner',features:{meta_ads:true},tenant_status:'active'};
test('official config rejects missing secrets and unsafe callbacks',()=>{
 for(const x of [{...env,SOCIO_META_APP_SECRET:''},{...env,SOCIO_PUBLIC_URL:'http://socio.example'},{...env,SOCIO_META_GRAPH_VERSION:'garbage'}])assert.throws(()=>officialConfig(x));
 assert.equal(officialConfig(env).appId,'2827016234367972');
});
test('login binds a hashed state to the initiating tenant, user and session',async()=>{
 const calls=[];const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
 const r=await startOfficial(pool,a,{env});const u=new URL(r.authorizationUrl);
 assert.equal(u.origin,'https://www.facebook.com');assert.equal(u.searchParams.get('redirect_uri'),'https://socio.example/api/marketing/official/callback');
 assert.equal(calls[1].args[1],a.active_tenant_id);assert.equal(calls[1].args[2],a.user_id);assert.equal(calls[1].args[3],a.token_hash);
 assert.notEqual(calls[1].args[0],u.searchParams.get('state'));
});
test('unauthorized actor cannot start login or erase a grant',async()=>{
 const pool={query:async()=>{throw Error('database must not be touched');}};
 await assert.rejects(startOfficial(pool,{...a,role:'agent'},{env}),{status:403});
 await assert.rejects(disconnectOfficial(pool,{...a,role:'agent'}),{status:403});
});
test('unknown/consumed states never exchange a code',async()=>{
 await assert.rejects(finishOfficial({query:async()=>({rows:[]})},'a'.repeat(64),'code',{env,request:async()=>{throw Error('must not contact Meta');}}),{status:400});
});
test('API sends bearer privately and refuses arbitrary paths',async()=>{
 let target,options;
 await officialGraph('/me/adaccounts','private-token',{env,request:async(u,o)=>{target=new URL(u);options=o;return {ok:true,json:async()=>({data:[]})};}});
 assert.equal(target.searchParams.has('access_token'),false);assert.equal(options.headers.Authorization,'Bearer private-token');
 assert.ok(target.searchParams.get('appsecret_proof'));assert.equal(options.redirect,'error');
 await assert.rejects(officialGraph('/someone/ads','private-token',{env}),{status:422});
});
test('copied grants from another tenant cannot access the API',async()=>{
 const pool={query:async()=>({rows:[{token_encrypted:sealMarketingSecret(JSON.stringify({tenant:'tenant-b',user:'user-a',token:'private-token'}),env)}]})};
 await assert.rejects(officialAccounts(pool,a,{env,request:async()=>{throw Error('must not contact Meta');}}),{status:403});
});
test('account response strips provider URLs and unapproved fields',async()=>{
 const pool={query:async(sql,args)=>{assert.deepEqual(args,['tenant-a','user-a']);return {rows:[{token_encrypted:sealMarketingSecret(JSON.stringify({tenant:'tenant-a',user:'user-a',token:'private-token'}),env)}]};}};
 const result=await officialAccounts(pool,a,{env,request:async()=>({ok:true,json:async()=>({data:[{id:'act_123',name:'Test',access_token:'never-forward'}],paging:{next:'https://graph.facebook.com/?access_token=never-forward'}})})});
 assert.equal(JSON.stringify(result).includes('never-forward'),false);assert.equal(result.hasMore,true);
});
