import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseVideoPilotConfig,runVideoPilotOnce} from '../socio-whatsapp-meta-video-pilot.mjs';

const now=Date.parse('2026-11-09T20:10:00Z');
const operation=randomUUID(),tenant=randomUUID(),user=randomUUID(),channel=randomUUID();
const env={
 SOCIO_WA_VIDEO_PILOT_ONCE:'true',SOCIO_WA_VIDEO_PILOT_ID:operation,
 SOCIO_WA_VIDEO_PILOT_SOURCE:'5515981732994',
 SOCIO_WA_VIDEO_PILOT_DESTINATION:'15981817336',
 SOCIO_WA_VIDEO_PILOT_ACCOUNT:'act_1347914770832022',
 SOCIO_WA_VIDEO_PILOT_CUTOFF:'2026-11-09T19:40:30Z'
};
const row={tenant_id:tenant,user_id:user,channel_id:channel,
 tenant_status:'active',tenant_name:'Empresa A',role:'owner',platform_owner:false,
 features:{meta_ads:true,whatsapp:true,ai:true},account_id:env.SOCIO_WA_VIDEO_PILOT_ACCOUNT};
function db({owners=1,claimed=true}={}){
 const calls=[],status=[];
 return {calls,status,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT t.id AS tenant_id')){
   assert.match(sql,/meta_official_grants g/);
   assert.match(sql,/ads_management/);
   assert.match(sql,/waakg_links l/);
   assert.match(sql,/u.role IN \('owner','admin'\)/);
   assert.deepEqual(args,[env.SOCIO_WA_VIDEO_PILOT_SOURCE,env.SOCIO_WA_VIDEO_PILOT_ACCOUNT]);
   return {rowCount:owners,rows:Array.from({length:owners},()=>row)};
  }
  if(sql.startsWith('INSERT INTO socio_whatsapp_meta_video_pilot_jobs')){
   assert.equal(args[0],operation);
   assert.equal(args[1],tenant);
   assert.equal(args[2],channel);
   assert.equal(args[3],user);
   assert.equal(args[4],env.SOCIO_WA_VIDEO_PILOT_ACCOUNT);
   return {rowCount:claimed?1:0,rows:claimed?[{id:operation}]:[]};
  }
  if(sql.startsWith('UPDATE socio_whatsapp_meta_video_pilot_jobs')){
   status.push({state:args[1],id:args[2]});
   return {rowCount:1};
  }
  if(sql.startsWith('INSERT INTO audit')){
   assert.equal(args[1],tenant);assert.equal(args[2],user);
   assert.equal(args[3],'marketing.official.video.pilot');
   assert.equal(JSON.parse(args[4]).operationId,operation);
   return {rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,120));
 }};
}
test('one-off pilot is entirely disabled without explicit complete flag and within bounded time',async()=>{
 assert.equal(parseVideoPilotConfig({...env,SOCIO_WA_VIDEO_PILOT_ONCE:'false'},{now}),null);
 assert.equal(parseVideoPilotConfig({...env,SOCIO_WA_VIDEO_PILOT_ID:''},{now}),null);
 assert.equal(parseVideoPilotConfig({...env,SOCIO_WA_VIDEO_PILOT_ACCOUNT:'act_wrong'},{now}),null);
 assert.equal(parseVideoPilotConfig({...env,SOCIO_WA_VIDEO_PILOT_CUTOFF:'2026-10-01T00:00:00Z'},{now}),null);
 assert.equal(parseVideoPilotConfig({...env,SOCIO_WA_VIDEO_PILOT_SOURCE:env.SOCIO_WA_VIDEO_PILOT_DESTINATION},{now}),null);
 assert.equal(parseVideoPilotConfig(env,{now}).recipient,'5515981817336');
 let calls=0;
 const result=await runVideoPilotOnce({query:async()=>{calls++;throw Error('Should never query')}},{env:{},now});
 assert.equal(result.processed,false);
 assert.equal(calls,0);
});
test('pilot cannot import from an ambiguous or nonexistent exact Meta-owner grant',async()=>{
 for(const owners of [0,2]){
  const database=db({owners});let finds=0,uploads=0;
  const r=await runVideoPilotOnce(database,{
   env,now,find:async()=>{finds++},importVideo:async()=>{uploads++}
  });
  assert.equal(r.processed,false);assert.equal(finds,0);assert.equal(uploads,0);
  assert.equal(database.calls.length,1);
 }
});
test('pilot fetches one exact outbound video before a fixed cutoff and imports it only once',async()=>{
 const database=db();let finds=0,uploads=0;
 const r=await runVideoPilotOnce(database,{env,now,
  find:async(_pool,actor,input,options)=>{
   finds++;assert.equal(actor.active_tenant_id,tenant);
   assert.equal(actor.user_id,user);
   assert.equal(input.channelId,channel);
   assert.equal(input.recipientPhone,'5515981817336');
   assert.equal(options.env,env);
   assert.equal(options.now,Date.parse(env.SOCIO_WA_VIDEO_PILOT_CUTOFF));
   return {video:{messageId:'3EB048D82AE3F9417E9BB4'}};
  },
  importVideo:async(_pool,actor,input,options)=>{
   uploads++;assert.equal(actor.active_tenant_id,tenant);
   assert.equal(input.messageId,'3EB048D82AE3F9417E9BB4');
   assert.equal(input.confirmed,true);
   assert.equal(options.now,Date.parse(env.SOCIO_WA_VIDEO_PILOT_CUTOFF));
   return {status:'uploaded',videoId:'1616096903323428',accountId:env.SOCIO_WA_VIDEO_PILOT_ACCOUNT};
  }
 });
 assert.equal(finds,1);assert.equal(uploads,1);
 assert.equal(r.reason,'PILOT_UPLOADED');
 assert.equal(r.videoId,'1616096903323428');
 assert.deepEqual(database.status,[{state:'uploaded',id:'1616096903323428'}]);
 assert(database.calls.some(x=>x.sql.startsWith('INSERT INTO audit')));
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/SOCIO_WA_VIDEO_PILOT_ONCE==='true'/);
 assert.match(server,/runVideoPilotOnce\(pool\)/);
});
test('pilot never replays a claimed operation even after a service restart',async()=>{
 const database=db({claimed:false});let scans=0,uploads=0;
 const r=await runVideoPilotOnce(database,{env,now,
  find:async()=>{scans++},importVideo:async()=>{uploads++}
 });
 assert.equal(r.reason,'PILOT_ALREADY_ATTEMPTED');
 assert.equal(scans,0);assert.equal(uploads,0);
});
test('pilot records no video as a terminal status and does not upload anything',async()=>{
 const database=db();let uploads=0;
 const r=await runVideoPilotOnce(database,{
  env,now,find:async()=>({video:null}),importVideo:async()=>{uploads++}
 });
 assert.equal(r.reason,'PILOT_VIDEO_NOT_FOUND');
 assert.equal(uploads,0);
 assert.equal(database.status[0].state,'not_found');
});
test('pilot preserves uncertain Meta POST as terminal and does not retry',async()=>{
 const database=db(),r=await runVideoPilotOnce(database,{
  env,now,find:async()=>({video:{messageId:'3EB048D82AE3F9417E9BB4'}}),
  importVideo:async()=>{throw Object.assign(Error('Meta POST timed out'),{uncertain:true})}
 });
 assert.equal(r.reason,'PILOT_UNCERTAIN');
 assert.equal(database.status[0].state,'uncertain');
});
