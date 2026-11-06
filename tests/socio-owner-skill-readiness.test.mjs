import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ownerWhatsAppReadiness} from '../socio-owner-skill-readiness.mjs';

const tenant=randomUUID(),actor={active_tenant_id:tenant,user_id:randomUUID(),
 role:'owner',tenant_status:'active',features:{meta_ads:true,whatsapp:true,ai:true,quotes:true,catalog:true,team:true}};
const channel=()=>({id:randomUUID(),status:'connected',phone:'5515888123456',session_id:'socio_test_001'});
const flags={SOCIO_OWNER_COMMANDS_ENABLED:'true',SOCIO_OWNER_MEDIA_ENABLED:'true',
 SOCIO_OWNER_AUDIO_ENABLED:'true',SOCIO_OUTBOUND_ENABLED:'true',
 SOCIO_OWNER_MEDIA_TENANT_ID:tenant,GROQ_API_KEY:'long-authorization-not-a-real-key-111'};
function db(channels,owners=1){
 const called=[];return{called,query:async(sql,params)=>{
  called.push({sql,params});
  assert.deepEqual(params,[tenant]);
  if(sql.startsWith('SELECT ch.id,ch.status,ch.phone'))return {rows:channels};
  if(sql.startsWith('SELECT COUNT(*)::int AS matches')){
   assert.match(sql,/u.role IN \('owner','admin'\)/);
   assert.match(sql,/HAVING COUNT\(u.id\)=1/);
   return {rows:[{matches:owners}]};
  }
  throw Error('Unexpected SQL read');
 }};
}
test('WA-AKG readiness returns tenant-scoped verified pilot state but performs no mutations',async()=>{
 const pool=db([channel()]);
 let checked=0;
 const x=await ownerWhatsAppReadiness(pool,actor,{env:flags,getStatus:async(id)=>{
  checked++;assert.equal(id,'socio_test_001');
  return {connected:true,connectedNumber:'5515888123456'};
 }});
 assert.equal(x.textReady,true);assert.equal(x.photoReady,true);assert.equal(x.audioReady,true);
 assert.equal(x.connectedSessions,1);assert.equal(x.verifiedOwnerConversations,1);
 assert.equal(x.readOnly,true);assert.equal(x.tenantScoped,true);assert.equal(checked,1);
 assert.equal(pool.called.length,2);
 assert(pool.called.every(v=>/SELECT/.test(v.sql)&&!/(INSERT|UPDATE|DELETE|POST)/.test(v.sql)));
 assert(!JSON.stringify(x).includes('GROQ_API_KEY'));
 assert(!JSON.stringify(x).includes('5515888123456'));
 assert(!JSON.stringify(x).includes('socio_test_001'));
});
test('diagnostic never declares ready when a connected session is missing, mismatched or unreachable',async()=>{
 const zero=await ownerWhatsAppReadiness(db([]),actor,{env:flags,getStatus:async()=>{throw Error('not reachable')}});
 assert.equal(zero.textReady,false);assert.equal(zero.connectedSessions,0);
 let called=0;
 const mismatch=await ownerWhatsAppReadiness(db([channel()]),actor,{env:flags,getStatus:async()=>{
  called++;return {connected:true,connectedNumber:'5511000000000'};
 }});
 assert.equal(mismatch.textReady,false);assert.equal(mismatch.sessionProblems,1);
 const unreachable=await ownerWhatsAppReadiness(db([channel()]),actor,{env:flags,getStatus:async()=>{throw Error('timeout')}});
 assert.equal(unreachable.connectedSessions,0);assert.equal(unreachable.sessionProblems,1);
 assert.equal(called,1);
});
test('without private verified owner or opt-in flags, no WhatsApp command can be reported ready',async()=>{
 const noOwner=await ownerWhatsAppReadiness(db([channel()],0),actor,{env:flags,getStatus:async()=>({connected:true,connectedNumber:'5515888123456'})});
 assert.equal(noOwner.textReady,false);
 const off=await ownerWhatsAppReadiness(db([channel()]),actor,{env:{...flags,SOCIO_OWNER_COMMANDS_ENABLED:'false',SOCIO_OUTBOUND_ENABLED:'false'},getStatus:async()=>({connected:true,connectedNumber:'5515888123456'})});
 assert.equal(off.textReady,false);assert.match(off.blockers.join(';'),/desabilitado/);
 const noPilot=await ownerWhatsAppReadiness(db([channel()]),actor,{env:{...flags,SOCIO_OWNER_MEDIA_TENANT_ID:randomUUID()},getStatus:async()=>({connected:true,connectedNumber:'5515888123456'})});
 assert.equal(noPilot.textReady,true);
 assert.equal(noPilot.photoReady,false);assert.equal(noPilot.audioReady,false);
});
test('diagnostic rejects agent, disabled tenant features and paused businesses before database access',async()=>{
 let used=0;const dbNever={query:async()=>{used++;throw Error('Unexpected read')}};
 await assert.rejects(ownerWhatsAppReadiness(dbNever,{...actor,role:'agent'},{env:flags}),{status:403});
 await assert.rejects(ownerWhatsAppReadiness(dbNever,{...actor,features:{...actor.features,whatsapp:false}},{env:flags}),{status:403});
 await assert.rejects(ownerWhatsAppReadiness(dbNever,{...actor,tenant_status:'paused'},{env:flags}),{status:403});
 assert.equal(used,0);
});
test('status endpoint and panel are read-only and text command requires owner identity uniqueness',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/socio-ad-skills-ui.js',import.meta.url),'utf8');
 const inbox=readFileSync(new URL('../socio-owner-skill-inbox.mjs',import.meta.url),'utf8');
 assert.match(server,/\/api\/marketing\/skills\/whatsapp-readiness/);
 assert.match(server,/ownerWhatsAppReadiness\(pool,a\)/);
 assert.match(ui,/Diagnóstico do WhatsApp do proprietário/);
 assert.match(ui,/Verificar conexão WA-AKG/);
 assert.match(inbox,/SELECT COUNT\(\*\) FROM users verified_owner/);
 assert.match(inbox,/verified_owner.tenant_id=m.tenant_id/);
});
