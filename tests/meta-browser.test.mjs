import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMetaBrowser} from '../meta-browser.mjs';
const env={CHANNEL_ENCRYPTION_KEY:'fixture-key-for-remote-browser-2026',SOCIO_META_BROWSER_ALLOW_WRITES:'true'};
function fixture(){
 const profiles=new Map(),writes=new Map(),calls=[];
 const runtime={async call(id,method,data){calls.push({id,method,data});return method==='status'?{session_present:false,operations:[]}:{ok:true,id};},async stop(id){calls.push({id,method:'stop'});},async close(){}};
 const pool={async query(sql,v){
  const actor=(v[0]||'')+':'+(v[1]||'');
  if(sql.startsWith('SELECT id FROM meta_browser_connections'))return {rows:profiles.has(actor)?[{id:profiles.get(actor)}]:[]};
  if(sql.startsWith('INSERT INTO meta_browser_connections')){const scope=v[1]+':'+v[2];if(!profiles.has(scope))profiles.set(scope,v[0]);return {rows:[{id:profiles.get(scope)}]};}
  if(sql.startsWith('UPDATE meta_browser_connections')){profiles.delete(v[1]+':'+v[2]);return {rows:[]};}
  if(sql.startsWith('INSERT INTO meta_browser_writes')){const key=v[1]+':'+v[4];if(writes.has(key))return {rows:[]};writes.set(key,{id:v[0],payload_hash:v[5],status:'pending'});return {rows:[{id:v[0]}]};}
  if(sql.startsWith('SELECT payload_hash'))return {rows:[writes.get(v[0]+':'+v[1])].filter(Boolean)};
  if(sql.startsWith('UPDATE meta_browser_writes')){for(const row of writes.values())if(row.id===v[0]){row.status='done';row.result=JSON.parse(v[1]);}return {rows:[]};}
  throw Error('Unexpected SQL');
 }};
 return {pool,runtime,calls};
}
const actor=(tenant=randomUUID(),user=randomUUID())=>({active_tenant_id:tenant,user_id:user,role:'owner'});
test('browser profile follows both current tenant and actor; disconnect rotates the profile',async()=>{
 const f=fixture(),service=createMetaBrowser({env,runtime:f.runtime}),a=actor(),b=actor(),otherTenant={...a,active_tenant_id:randomUUID()};
 assert.equal((await service.status(f.pool,a)).requiresMetaApp,false);
 await service.action(f.pool,a,'open');await service.action(f.pool,b,'open');await service.action(f.pool,otherTenant,'open');
 assert.equal(new Set(f.calls.map(c=>c.id)).size,3);
 const first=f.calls[0].id;await service.action(f.pool,a,'disconnect');await service.action(f.pool,a,'open');
 assert.notEqual(first,f.calls.at(-1).id);
 await assert.rejects(()=>service.action(f.pool,{...a,role:'agent'},'open'),{status:403});
});
test('input validation and durable write keys preserve actor isolation',async()=>{
 const f=fixture(),service=createMetaBrowser({env,runtime:f.runtime}),a=actor(),b=actor();
 await service.action(f.pool,a,'open');await service.action(f.pool,b,'open');
 await assert.rejects(()=>service.action(f.pool,a,'input',{kind:'click',x:9999,y:2}),{status:422});
 await assert.rejects(()=>service.action(f.pool,a,'input',{kind:'key',key:'F12'}),{status:422});
 await service.action(f.pool,a,'input',{kind:'text',text:'sensitive-input',tenant_id:b.active_tenant_id});
 assert.deepEqual(f.calls.at(-1).data,{kind:'text',text:'sensitive-input'});
 const plan={plan_id:'ab'.repeat(24),allow_writes:true};
 const left=await service.action(f.pool,a,'execute',plan,'same-key-0001');
 assert.deepEqual(await service.action(f.pool,a,'execute',plan,'same-key-0001'),left);
 await service.action(f.pool,b,'execute',plan,'same-key-0001');
 assert.equal(f.calls.filter(c=>c.method==='execute').length,2);
 await assert.rejects(()=>service.action(f.pool,a,'execute',{...plan,plan_id:'cd'.repeat(24)},'same-key-0001'),{status:409});
});
test('browser refuses writes when disabled and starts without any Meta application credentials',async()=>{
 const f=fixture(),service=createMetaBrowser({env:{...env,SOCIO_META_BROWSER_ALLOW_WRITES:'false'},runtime:f.runtime}),a=actor();
 assert.equal((await service.status(f.pool,a)).configured,true);
 await service.action(f.pool,a,'open');
 await assert.rejects(()=>service.action(f.pool,a,'execute',{plan_id:'ab'.repeat(24),allow_writes:true},'test-key-0001'),{status:403});
 const disabled=createMetaBrowser({env:{}});assert.equal((await disabled.status(f.pool,a)).configured,false);
 await assert.rejects(()=>disabled.action(f.pool,a,'open'),{status:503});
});
