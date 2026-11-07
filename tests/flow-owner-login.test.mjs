import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlowImages} from '../flow-images.mjs';
import {allowFlowResource,allowFlowNavigation,validateFlowInput} from '../flow-images/browser-policy.mjs';
test('only platform owner can access shared Google session, screen or keyboard',async()=>{
 const api=createFlowImages({runtime:{browser:async()=>assert.fail('must not reach browser')}});
 for(const kind of ['status','open','screen','input','finish','close'])
  await assert.rejects(api.browser({role:'owner',platform_owner:false},kind,{}),e=>e.status===403);
});
test('browser inputs are validated before crossing the worker boundary',async()=>{
 const seen=[];const api=createFlowImages({runtime:{browser:async(kind,input)=>{seen.push({kind,input});return {ok:true};}}});
 const owner={role:'owner',platform_owner:true};
 await assert.rejects(api.browser(owner,'input',{kind:'click',x:-1,y:0}),e=>e.status===422);
 await assert.rejects(api.browser(owner,'goto',{url:'https://example.com'}),e=>e.status===404);
 await api.browser(owner,'input',{kind:'key',key:'Tab',url:'https://example.com'});
 assert.deepEqual(seen,[{kind:'input',input:{kind:'key',key:'Tab'}}]);
});
test('Flow login navigation is restricted to Google authentication and Flow',()=>{
 for(const url of ['https://flow.google.com/','https://accounts.google.com/v3/signin','https://labs.google/fx/tools/flow'])assert.equal(allowFlowNavigation(url),true);
 for(const url of ['http://127.0.0.1','https://docs.google.com/','https://example.com/','https://user:pass@flow.google.com/','https://flow.google.com:8443/'])assert.equal(allowFlowNavigation(url),false);
 assert.equal(allowFlowResource('https://lh3.googleusercontent.com/image'),true);
 assert.equal(allowFlowResource('https://metadata.google.internal/'),false);
 assert.equal(allowFlowResource('https://example.com/'),false);
});
test('text input is bounded and cannot run arbitrary browser commands',()=>{
 assert.throws(()=>validateFlowInput({kind:'text',text:'x'.repeat(4097)}));
 assert.throws(()=>validateFlowInput({kind:'key',key:'F12'}));
 assert.deepEqual(validateFlowInput({kind:'text',text:'fixture',secret:'drop'}),{kind:'text',text:'fixture'});
});
