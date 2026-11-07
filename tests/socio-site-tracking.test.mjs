import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {createTrackingSite,listTrackingSites,enableTrackingSite,
 makeCapiEvent,verifySiteEventSignature,receiveSignedSiteEvent} from '../socio-site-tracking.mjs';

const tenant=randomUUID(),uid=randomUUID(),siteId=randomUUID(),eventId=randomUUID();
const now=Date.parse('2026-11-06T20:00:00Z'),second=Math.floor(now/1000),secret='test-site-only-secret-string-abc';
const env={SOCIO_SITE_EVENTS_ENABLED:'true',SOCIO_META_CAPI_ENABLED:'false',
 CHANNEL_ENCRYPTION_KEY:'not-real-master-secret-'+('x'.repeat(50))};
const actor={role:'owner',user_id:uid,active_tenant_id:tenant,tenant_status:'trial',
 features:{whatsapp:true,catalog:true,quotes:true,meta_ads:true,ai:true,team:true}};
const event={event_name:'Lead',event_id:eventId,event_time:second,
 consent:true,event_source_url:'https://example.com/form?x=1',fbp:'fb.1.1800000000000.123456789'};
test('CAPI event must have consent, verified UUID and origin; anonymous website cannot emit Purchase',()=>{
 const r=makeCapiEvent(event,{now});
 assert.equal(r.event_name,'Lead');assert.equal(r.action_source,'website');
 assert.equal(r.event_id,eventId);assert.equal(r.user_data.fbp,event.fbp);
 assert.equal(r.event_source_url,'https://example.com/form');
 assert(!('value' in r));
 for(const data of [{...event,event_name:'Purchase'},{...event,consent:false},
  {...event,event_id:'fake'},{...event,event_source_url:'http://example.com'},
  {...event,email:'test@example.com'}])assert.throws(()=>makeCapiEvent(data,{now}));
 assert.throws(()=>makeCapiEvent({...event,event_time:second-9*86400},{now}),{status:422});
});
test('one-time tracking setup checks existing authorized Pixel; no automatic event sender',async()=>{
 let insert=0;
 const db={query:async(sql,args)=>{
  assert.match(sql,/INSERT INTO socio_tracking_sites/);
  assert.equal(args[1],tenant);assert.equal(args[2],uid);
  assert.equal(args[3],'https://example.com');assert.equal(args[4],'123456789123');
  assert.equal(args[6],undefined);
  assert(!args[5].includes('site-hmac:'));
  insert++;
  return {rowCount:1};
 }};
 const result=await createTrackingSite(db,actor,{origin:'https://example.com/',pixelId:'123456789123'},{
  env,pixels:async(_db,a,kind)=>{assert.equal(a.active_tenant_id,tenant);assert.equal(kind,'pixels');
   return {items:[{id:'123456789123'}],hasMore:false};}});
 assert.equal(insert,1);assert.equal(result.enabled,false);
 assert.equal(result.signingSecret.length>30,true);
 assert.match(result.note,/exclusivamente ao backend/);
 await assert.rejects(createTrackingSite(db,actor,{origin:'https://example.com',pixelId:'9999999999'},
  {env,pixels:async()=>({items:[{id:'123456789123'}],hasMore:false})}),{status:409});
 await assert.rejects(createTrackingSite(db,{...actor,role:'agent'},
  {origin:'https://example.com',pixelId:'123456789123'},{env,pixels:async()=>{throw Error('no')}}),{status:403});
});
test('HMAC site signature binds timestamp and raw body, rejects tampering and replay',()=>{
 const raw=Buffer.from(JSON.stringify(event)),timestamp=String(second);
 const signature='sha256='+createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
 assert.equal(verifySiteEventSignature(raw,signature,timestamp,secret,{now}),true);
 assert.throws(()=>verifySiteEventSignature(Buffer.from('{}'),signature,timestamp,secret,{now}),{status:403});
 assert.throws(()=>verifySiteEventSignature(raw,signature,timestamp,secret,{now:now+301000}),{status:403});
});
test('signed incoming event is scoped to site domain, saved once and not delivered while CAPI disabled',async()=>{
 const ciphertext=sealMarketingSecret('site-hmac:'+tenant+':'+siteId+':'+secret,env);
 let inserts=0;
 const pool={query:async(sql,args)=>{
  if(sql.includes('FROM socio_tracking_sites WHERE id=$1')){
   assert.equal(args[0],siteId);
   return {rows:[{id:siteId,tenant_id:tenant,owner_user_id:uid,
    site_origin:'https://example.com',pixel_id:'123456789123',enabled:true,signing_ciphertext:ciphertext}]};
  }
  if(sql.startsWith('INSERT INTO socio_tracking_events')){
   assert.equal(args[1],tenant);assert.equal(args[2],siteId);assert.equal(args[3],eventId);
   inserts++;return {rowCount:inserts===1?1:0};
  }
  throw Error('Unexpected DB operation: '+sql);
 }};
 const raw=Buffer.from(JSON.stringify(event)),timestamp=String(second);
 const headers={'x-socio-site-id':siteId,'x-socio-timestamp':timestamp,
  'x-socio-signature':'sha256='+createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex')};
 const one=await receiveSignedSiteEvent(pool,raw,headers,{env,now,
  request:async()=>{throw Error('No Meta API call when disabled')}});
 assert.equal(one.received,true);assert.equal(one.delivered,false);assert.equal(one.duplicate,false);
 const two=await receiveSignedSiteEvent(pool,raw,headers,{env,now});
 assert.equal(two.duplicate,true);
 const wrong=Buffer.from(JSON.stringify({...event,event_source_url:'https://another-company.com/'}));
 const headers2={...headers,'x-socio-signature':'sha256='+createHmac('sha256',secret).update(timestamp+'.').update(wrong).digest('hex')};
 await assert.rejects(receiveSignedSiteEvent(pool,wrong,headers2,{env,now}),{status:403});
 assert.equal(inserts,2);
 await assert.rejects(receiveSignedSiteEvent(pool,raw,headers,{env:{...env,SOCIO_SITE_EVENTS_ENABLED:'false'},now}),{status:503});
});
test('site listing and enable do not cross tenants or turn on collection without platform opt-in',async()=>{
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT')){assert.equal(args[0],tenant);return {rows:[{id:siteId,site_origin:'https://example.com',enabled:false}]};}
  if(sql.startsWith('UPDATE')){assert.equal(args[0],siteId);assert.equal(args[1],tenant);return {rows:[{id:siteId,enabled:args[2]}]};}
  throw Error('Unexpected query');
 }};
 const list=await listTrackingSites(pool,actor,{env});
 assert.equal(list.sites.length,1);assert.equal(list.metaCapiEnabled,false);
 await assert.rejects(enableTrackingSite(pool,actor,siteId,true,{env:{...env,SOCIO_SITE_EVENTS_ENABLED:'false'}}),{status:503});
 assert.equal((await enableTrackingSite(pool,actor,siteId,true,{env})).enabled,true);
 await assert.rejects(enableTrackingSite(pool,{...actor,role:'agent'},siteId,true,{env}),{status:403});
});
test('server routes protect public event intake, site admin, and do not emit Purchase',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const module=readFileSync(new URL('../socio-site-tracking.mjs',import.meta.url),'utf8');
 assert.match(server,/\/webhooks\/site-events/);
 assert.match(server,/\/api\/tracking\/sites/);
 assert.match(module,/Purchase exige confirmação autenticada do pagamento/);
 assert.match(module,/ON CONFLICT\(site_id,event_name,event_id\) DO NOTHING/);
 assert.match(module,/SOCIO_META_CAPI_ENABLED/);
 assert(!module.includes("event_name:'Purchase'"));
});
