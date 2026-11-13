import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMediaKey,collectMediaObjects,MAX_OBJECT_BYTES,MAX_FILES} from '../backup-runner/media-keys.mjs';

const uuid=()=>crypto.randomUUID();
const productImage=()=>uuid()+'/'+uuid()+'/'+uuid()+'.jpg';
const adVideo=(ext='mp4')=>'ads-private/'+uuid()+'/'+uuid()+'/source.'+ext;

test('catalogue photos are copied and ad videos are recognised as transient',()=>{
 assert.equal(classifyMediaKey(productImage()),'product-image');
 assert.equal(classifyMediaKey(adVideo('mp4')),'transient');
 assert.equal(classifyMediaKey(adVideo('mov')),'transient');
});

// The production bucket held four 11.7 MB ad videos; the old photo-only
// allowlist rejected them, so every nightly run failed at list-source and
// nothing from the media bucket was ever protected. The videos go to the Meta
// account and must not be archived, so the run has to skip them, not copy them.
test('a bucket full of ad videos no longer fails the snapshot',()=>{
 const contents=[1,2,3,4].map(()=>({Key:adVideo(),Size:11761523}));
 const result=collectMediaObjects(contents);
 assert.deepEqual(result.items,[]);
 assert.equal(result.files,0);
 assert.equal(result.bytes,0);
});

test('a mixed bucket copies the photos and leaves the videos alone',()=>{
 const photo={Key:productImage(),Size:512*1024};
 const contents=[{Key:adVideo(),Size:11761523},photo,{Key:adVideo('mov'),Size:9000000}];
 const result=collectMediaObjects(contents);
 assert.deepEqual(result.items,[{key:photo.Key,size:photo.Size,kind:'product-image'}]);
 assert.equal(result.files,1);
 assert.equal(result.bytes,photo.Size);
});

test('monitoring probes are ignored',()=>{
 assert.equal(classifyMediaKey('health/'+uuid()+'.jpg'),'probe');
 const result=collectMediaObjects([{Key:'health/'+uuid()+'.jpg',Size:1024}]);
 assert.deepEqual(result.items,[]);
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
 assert.throws(()=>collectMediaObjects([...full,{Key:productImage(),Size:1}]),{code:'SNAPSHOT_LIMIT'});
 assert.throws(()=>collectMediaObjects([{Key:productImage(),Size:MAX_OBJECT_BYTES}],{bytes:1000*1024*1024}),
  {code:'SNAPSHOT_LIMIT'});
});

test('limits accumulate across listing pages',()=>{
 const page1=collectMediaObjects([{Key:productImage(),Size:MAX_OBJECT_BYTES}]);
 const page2=collectMediaObjects([{Key:productImage(),Size:512}],page1);
 assert.equal(page2.files,2);
 assert.equal(page2.bytes,MAX_OBJECT_BYTES+512);
 assert.throws(()=>collectMediaObjects([{Key:productImage(),Size:256}],
  {files:MAX_FILES,bytes:0}),{code:'SNAPSHOT_LIMIT'});
});
