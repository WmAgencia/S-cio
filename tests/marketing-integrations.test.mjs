import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client,Pool} from 'pg';
import {
 INSTAGRAM_LAB_IMAGE,PIPEBOARD_HOSTED_URL,sealMarketingSecret,openMarketingSecret,
 instagramLabHealth,pipeboardReadAccountIds,connectPipeboard,
 registerGoogleAdsScript,verifyGoogleReport,ingestGoogleReport,disconnectMarketing,
 listMarketing,googleScriptTemplate
} from '../marketing-integrations.mjs';

const env={CHANNEL_ENCRYPTION_KEY:'unit-and-integration-secret-long-enough-2026-1111',
 SOCIO_PUBLIC_URL:'https://socio.example.test',
 SOCIO_INSTAGRAM_LAB_URL:'http://socio-instagram-lab.railway.internal:8000/'};
const token='pipeboard-fixture-readonly-token-'+randomBytes(20).toString('hex');
const fakeRequest=async(url,opt)=>{
 assert.equal(String(url),PIPEBOARD_HOSTED_URL);
 assert.equal(opt.method,'POST');
 assert.equal(opt.headers.Authorization,'Bearer '+token);
 const rpc=JSON.parse(opt.body);
 assert.equal(rpc.method,'tools/call');
 assert.equal(rpc.params.name,'mcp_meta_ads_get_ad_accounts');
 return {ok:true,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,
  result:{content:[{type:'text',text:JSON.stringify({accounts:[{id:'act_1234567890'}]})}]}})};
};

test('social laboratory has a pinned private, unauthenticated-only health check; no public service port',async()=>{
 assert.equal(INSTAGRAM_LAB_IMAGE,'ghcr.io/subzeroid/aiograpi-rest:6.0.0');
 const visited=[];
 const probe=await instagramLabHealth({env,request:async(url)=>{
  visited.push(String(url));return {ok:true};
 }});
 assert.equal(probe.reachable,true);
 assert.equal(probe.accountConnected,false);
 assert.deepEqual(visited,['http://socio-instagram-lab.railway.internal:8000/health']);
 assert.deepEqual(await instagramLabHealth({env:{},request:()=>{throw Error('No query allowed');}}),
  {installed:false,reachable:false,accountConnected:false,mode:'isolated'});
 await assert.rejects(instagramLabHealth({env:{...env,SOCIO_INSTAGRAM_LAB_URL:'https://evil.test/'}}));
});

test('tokens are encrypted separately and Pipeboard only allows approved read-only account access',async()=>{
 const sealed=sealMarketingSecret(token,env);
 assert.notEqual(sealed,token);
 assert.equal(openMarketingSecret(sealed,env),token);
 assert.throws(()=>openMarketingSecret(sealed,{...env,CHANNEL_ENCRYPTION_KEY:'not-the-same-key-but-long-enough-string-2026'}));
 assert.deepEqual([...await pipeboardReadAccountIds(token,{request:fakeRequest})],['act_1234567890']);
 await assert.rejects(pipeboardReadAccountIds(token,{request:async()=>({ok:false,status:403})}),e=>e.status===503);
 const script=googleScriptTemplate({endpoint:'https://example.test/webhooks/google-ads/123',accountId:'1234567890',
  secret:'this-is-a-fake-shared-secret-12345678901234567890'});
 assert(script.includes('Utilities.computeHmacSha256Signature'));
 assert(script.includes("AdsApp.search"));
 assert(!script.includes('campaign.budget')&&!script.includes('mutate('));
});

test('disposable Postgres: per-company Pipeboard, signed Google Ads import, replay and revocation',
 {skip:!process.env.DATABASE_URL,timeout:110000},async t=>{
 const name='socio_marketing_test_'+randomBytes(5).toString('hex');
 const base=new URL(process.env.DATABASE_URL),target=new URL(base);
 target.pathname='/'+name;
 const admin=new Client({connectionString:base.href});
 await admin.connect();
 await admin.query('CREATE DATABASE '+name);
 const pool=new Pool({connectionString:target.href});
 t.after(async()=>{
  await pool.end().catch(()=>{});
  await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)').catch(()=>{});
  await admin.end();
 });
 await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 const tenantA=randomUUID(),tenantB=randomUUID(),ownerA=randomUUID(),ownerB=randomUUID();
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES ($1,'Empresa A','test-a'),($2,'Empresa B','test-b')",[tenantA,tenantB]);
 await pool.query(
  "INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES "+
  "($1,$2,'Gestor A','manager-a@example.test','fixture','owner'),"+
  "($3,$4,'Gestor B','manager-b@example.test','fixture','owner')",
  [ownerA,tenantA,ownerB,tenantB]);
 const a={active_tenant_id:tenantA,user_id:ownerA},
  b={active_tenant_id:tenantB,user_id:ownerB};
 const meta=await connectPipeboard(pool,a,{
  accountId:'act_1234567890',label:'Conta A',token
 },{request:fakeRequest,env});
 assert.equal(meta.status,'verified');
 const stored=await pool.query(
  "SELECT secret_ciphertext FROM marketing_connections WHERE tenant_id=$1 AND provider='pipeboard_meta'",[tenantA]);
 assert.equal(stored.rowCount,1);
 assert(!stored.rows[0].secret_ciphertext.includes(token));
 await assert.rejects(connectPipeboard(pool,b,{
  accountId:'act_2222222222',label:'Conta B',token
 },{request:fakeRequest,env}),e=>e.status===403);
 const google=await registerGoogleAdsScript(pool,a,{accountId:'1234567890',label:'Google A'},env);
 assert.equal(google.status,'pending');
 assert(google.endpoint.startsWith('https://socio.example.test/webhooks/google-ads/'));
 assert(!JSON.stringify((await listMarketing(pool,a))).includes(google.secret),'Script secret never returned in GET');
 const template=googleScriptTemplate({endpoint:google.endpoint,accountId:'1234567890',secret:google.secret});
 assert(template.includes('UrlFetchApp.fetch'));
 const today=new Date().toISOString().slice(0,10),runId=randomUUID();
 const raw=Buffer.from(JSON.stringify({version:1,accountId:'1234567890',runId,
  timestamp:Date.now(),rows:[{date:today,campaignId:'12220001',campaignName:'Campanha teste',
   impressions:100,clicks:9,costMicros:10050000,conversions:1.2}]}));
 const signature='sha256='+createHmac('sha256',google.secret).update(raw).digest('hex');
 const signed=await ingestGoogleReport(pool,google.id,raw,signature,{env});
 assert.equal(signed.stored,1);
 assert.equal(signed.reused,false);
 const replay=await ingestGoogleReport(pool,google.id,raw,signature,{env});
 assert.equal(replay.reused,true);
 assert.equal(replay.stored,0);
 const reports=await listMarketing(pool,a);
 assert.equal(reports.reports.length,1);
 assert.equal(reports.reports[0].campaign_name,'Campanha teste');
 assert.equal(reports.reports[0].cost_micros,'10050000');
 assert.equal((await listMarketing(pool,b)).reports.length,0);
 assert.equal((await listMarketing(pool,b)).connections.length,0);
 const changed=Buffer.from(raw);
 changed[changed.length-2]^=1;
 await assert.rejects(ingestGoogleReport(pool,google.id,changed,signature,{env}),e=>e.status===403);
 const oldRaw=Buffer.from(JSON.stringify({...JSON.parse(raw),runId:randomUUID(),timestamp:Date.now()-24*3600000}));
 const oldSig='sha256='+createHmac('sha256',google.secret).update(oldRaw).digest('hex');
 await assert.rejects(ingestGoogleReport(pool,google.id,oldRaw,oldSig,{env}),e=>e.status===422);
 await assert.rejects(disconnectMarketing(pool,b,google.id),e=>e.status===404);
 const disconnected=await disconnectMarketing(pool,a,google.id);
 assert.equal(disconnected.ok,true);
 const after=(await pool.query('SELECT secret_ciphertext FROM marketing_connections WHERE id=$1',[google.id])).rows[0];
 assert.equal(after.secret_ciphertext,null);
 await assert.rejects(ingestGoogleReport(pool,google.id,raw,signature,{env}),e=>e.status===403);
 // Revoking credentials preserves historical read-only metrics.
 assert.equal((await listMarketing(pool,a)).reports.length,1);
});
