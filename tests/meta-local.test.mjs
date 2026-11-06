import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConnectionLink,connectorRequest,PRODUCTION_ORIGIN} from '../meta-connector/protocol.mjs';
import {createCommandRunner} from '../meta-connector/runtime.mjs';
import {connectorBundle} from '../meta-connector/bundle.mjs';
test('local connection links accept only the configured service and one-time opaque codes',()=>{
 const url='socio-meta://connect?server='+encodeURIComponent(PRODUCTION_ORIGIN)+'&code='+'a'.repeat(64);
 assert.equal(parseConnectionLink(url).server,PRODUCTION_ORIGIN);
 for(const bad of [url.replace('socio-meta:','https:'),url.replace(encodeURIComponent(PRODUCTION_ORIGIN),encodeURIComponent('https://evil.test')),url.replace('a'.repeat(64),'invalid'),url+'&ignored=ok#fragment'])assert.throws(()=>parseConnectionLink(bad));
 assert.throws(()=>parseConnectionLink('socio-meta://connect?server=http%3A%2F%2Flocalhost%3A3000&code='+'a'.repeat(64)));
});
test('connector API calls refuse redirects, unknown routes and authorization failures',async()=>{
 await assert.rejects(()=>connectorRequest(PRODUCTION_ORIGIN,'/arbitrary',{},'secret'),/Rota/);
 let captured;
 await connectorRequest(PRODUCTION_ORIGIN,'/api/meta-connector/poll',{},'local-token',async(url,options)=>{captured={url,options};return Response.json({job:null});});
 assert.equal(captured.options.redirect,'error');assert.equal(captured.options.headers.Authorization,'Bearer local-token');
 await assert.rejects(()=>connectorRequest(PRODUCTION_ORIGIN,'/api/meta-connector/poll',{},'local-token',async()=>Response.json({},{status:401})),{status:401});
});
test('local login uses a visible window and never exports cookies or typed credentials',async()=>{
 let opened,options;
 const cookies=[{name:'c_user',value:'PRIVATE_USER_COOKIE'},{name:'xs',value:'PRIVATE_SESSION_COOKIE'}];
 const runner=createCommandRunner({aa:{closeBrowser:async()=>{},shutdown:async()=>{}},host:{hostSite:()=>({operations:[]})},sessions:{loadSession:()=>({cookies})},windowLogin:async(site,url,input)=>{opened={site,url};options=input;return {ok:true,cookies};}});
 const result=await runner.run('login');assert.equal(options.waitForEnter,false);assert.equal(opened.url,'https://adsmanager.facebook.com/');
 assert.equal(result.sessionPresent,true);assert.ok(!JSON.stringify(result).includes('PRIVATE_'));assert.ok(!JSON.stringify(runner.status()).includes('PRIVATE_'));
 await assert.rejects(()=>runner.run('shell',{command:'arbitrary'}),/autorizado/);
});
test('plans stay local, are one-use and writes require the passed approval flag',async()=>{
 let sent;
 const runner=createCommandRunner({aa:{closeBrowser:async()=>{},shutdown:async()=>{}},sessions:{loadSession:()=>({cookies:[]})},windowLogin:async()=>({ok:false}),host:{
  hostSite:()=>({operations:[]}),planCall:()=>({ok:true,readOnly:false,request:{url:'https://adsmanager.facebook.com/request'},op:'test'}),callPlanned:async(plan,options)=>{sent=options;return {ok:true};},
 }});
 const plan=await runner.run('plan',{operation:'test',args:{}});assert.ok(plan.plan_id);
 assert.equal((await runner.run('execute',{plan_id:plan.plan_id,allow_writes:false})).ok,true);assert.equal(sent.allowWrites,false);assert.equal(sent.maxTier,1);
 assert.equal((await runner.run('execute',{plan_id:plan.plan_id,allow_writes:true})).ok,false);
});
test('download bundle is a complete ZIP without credentials or user profiles',async()=>{
 const bytes=await connectorBundle();assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
 assert.equal(bytes.readUInt16LE(bytes.length-12),9);
 for(const file of ['install.ps1','connector.mjs','package-lock.json','iniciar-conector.cmd'])assert.ok(bytes.includes(Buffer.from(file)));
 assert.ok(!bytes.includes(Buffer.from('CHANNEL_ENCRYPTION_KEY=')));
});
