import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlowImages} from '../flow-images.mjs';
import {createFlowRuntime} from '../flow-images/runtime.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const auth={active_tenant_id:'tenant-a',user_id:'user-a',role:'owner'};
test('Flow status discloses missing live validation',async()=>{
 const api=createFlowImages({runtime:{request:async()=>new Response(JSON.stringify({ready:false}),{status:503})}});
 const s=await api.status(auth);assert.equal(s.ready,false);assert.equal(s.model,'Nano Banana 2.1');assert.equal(s.liveValidated,false);
});
test('Flow rejects model switching and extra fields before any provider call',async()=>{
 const api=createFlowImages({runtime:{request:async()=>assert.fail('must not call')}});
 await assert.rejects(api.create({},auth,{prompt:'a',model:'pro'},'a'),e=>e.status===422);
 await assert.rejects(api.create({}, {...auth,role:'agent'}, {prompt:'a'},'a'),e=>e.status===403);
});
test('Flow image reads enforce tenant scope before reaching the shared owner account',async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
 const api=createFlowImages({runtime:{request:async()=>assert.fail('must not call')}});
 await assert.rejects(api.read(pool,auth,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),e=>e.status===404);
 assert.deepEqual(calls[0].args,['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','tenant-a']);
 assert.match(calls[0].sql,/tenant_id=\$2/);
});
test('Flow rewrites upstream image paths to session-protected tenant paths',async()=>{
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const api=createFlowImages({runtime:{request:async()=>new Response(JSON.stringify({id,status:'succeeded',image:{content_url:`/v1/images/${id}/content`,mime_type:'image/png'}}))}});
 const result=await api.read({query:async()=>({rows:[{job_id:id}]})},auth,id);
 assert.equal(result.image.content_url,`/api/flow/images/${id}/content`);
});
test('real isolated worker boots and refuses generation before capture',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'socio-flow-worker-'));
 const previous={key:process.env.CHANNEL_ENCRYPTION_KEY,dir:process.env.SOCIO_META_BROWSER_DIR};
 process.env.CHANNEL_ENCRYPTION_KEY='fixture-flow-worker-encryption-key-12345';
 process.env.SOCIO_META_BROWSER_DIR=dir;
 const runtime=createFlowRuntime();
 t.after(async()=>{await runtime.close();
  for(const [name,value] of [['CHANNEL_ENCRYPTION_KEY',previous.key],['SOCIO_META_BROWSER_DIR',previous.dir]]){
   if(value===undefined)delete process.env[name];else process.env[name]=value;
  }rmSync(dir,{recursive:true,force:true});});
 const ready=await runtime.request('/readyz');assert.equal(ready.status,503);assert.equal((await ready.json()).ready,false);
 const browser=await runtime.browser('status');assert.equal(browser.session_present,false);assert.equal(browser.remote_browser_open,false);
 const result=await runtime.request('/v1/images',{method:'POST',body:{prompt:'test'}});
 assert.equal(result.status,503);
});
