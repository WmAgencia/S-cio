import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMediaKey,collectMediaObjects,MAX_OBJECT_BYTES,MAX_FILES} from '../backup-runner/media-keys.mjs';

const uuid=()=>crypto.randomUUID();
const productImage=()=>uuid()+'/'+uuid()+'/'+uuid()+'.jpg';
const adVideo=(ext='mp4')=>'ads-private/'+uuid()+'/'+uuid()+'/source.'+ext;

test('catalogue photos and ad creatives are both part of the snapshot',()=>{
 assert.equal(classifyMediaKey(productImage()),'product-image');
 assert.equal(classifyMediaKey(adVideo('mp4')),'ad-video');
 assert.equal(classifyMediaKey(adVideo('mov')),'ad-video');
});

// The production bucket held four 11.7 MB ad videos; the old photo-only
// allowlist rejected them, so every nightly run failed at list-source and
// nothing from the media bucket was ever protected.
test('a real snapshot of ad videos is accepted',()=>{
 const contents=[1,2,3,4].map(()=>({Key:adVideo(),Size:11761523}));
 const result=collectMediaObjects(contents);
 assert.equal(result.items.length,4);
 assert.equal(result.files,4);
 assert.equal(result.bytes,4*11761523);
 for(const item of result.items){
  assert.equal(item.kind,'ad-video');
  assert.equal(item.size,11761523);
 }
});

test('monitoring probes are ignored',()=>{
 assert.equal(classifyMediaKey('health/'+uuid()+'.jpg'),'probe');
 const result=collectMediaObjects([{Key:'health/'+uuid()+'.jpg',Size:1024}]);
 assert.deepEqual(result.items,[]);
 assert.equal(result.files,0);
});

test('an unknown namespace fails loudly instead of being skipped',()=>{
 assert.equal(classifyMediaKey('public/campaigns/hero.png'),'unknown');
 assert.equal(classifyMediaKey(''),'unknown');
 assert.equal(classifyMediaKey(undefined),'unknown');
 assert.throws(()=>collectMediaObjects([{Key:'tenant/extra/config.json',Size:512}]),
  {code:'UNEXPECTED_NAMESPACE'});
});

test('empty and oversized objects are rejected',()=>{
 assert.throws(()=>collectMediaObjects([{Key:productImage(),Size:0}]),{code:'OBJECT_TOO_LARGE'});
 assert.throws(()=>collectMediaObjects([{Key:productImage(),Size:MAX_OBJECT_BYTES+1}]),{code:'OBJECT_TOO_LARGE'});
 assert.throws(()=>collectMediaObjects([{Key:productImage(),Size:'not-a-size'}]),{code:'OBJECT_TOO_LARGE'});
 assert.doesNotThrow(()=>collectMediaObjects([{Key:productImage(),Size:MAX_OBJECT_BYTES}]));
});

test('file and byte caps stop a runaway snapshot',()=>{
 const full=Array.from({length:MAX_FILES},()=>({Key:productImage(),Size:1}));
 assert.equal(collectMediaObjects(full).files,MAX_FILES);
 assert.throws(()=>collectMediaObjects([...full,{Key:adVideo(),Size:1}]),{code:'SNAPSHOT_LIMIT'});
 assert.throws(()=>collectMediaObjects([{Key:adVideo(),Size:MAX_OBJECT_BYTES}],{bytes:1000*1024*1024}),
  {code:'SNAPSHOT_LIMIT'});
});

test('limits accumulate across listing pages',()=>{
 const page1=collectMediaObjects([{Key:adVideo(),Size:MAX_OBJECT_BYTES}]);
 const page2=collectMediaObjects([{Key:productImage(),Size:512}],page1);
 assert.equal(page2.files,2);
 assert.equal(page2.bytes,MAX_OBJECT_BYTES+512);
 assert.throws(()=>collectMediaObjects([{Key:productImage(),Size:256}],
  {files:MAX_FILES,bytes:0}),{code:'SNAPSHOT_LIMIT'});
});
