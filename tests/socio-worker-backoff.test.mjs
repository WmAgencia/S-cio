import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerBackoff} from '../socio-worker-backoff.mjs';

test('worker backoff prevents hot retries and resets after recovery',()=>{
 let now=1000;
 const cooldown=createWorkerBackoff({baseMs:5000,maxMs:20000,now:()=>now});
 assert.equal(cooldown.canRun(),true);
 assert.deepEqual(cooldown.failed(),{failures:1,delayMs:5000});
 assert.equal(cooldown.canRun(),false);
 now+=5000;
 assert.equal(cooldown.canRun(),true);
 assert.deepEqual(cooldown.failed(),{failures:2,delayMs:10000});
 assert.equal(cooldown.canRun(),false);
 now+=10000;
 assert.deepEqual(cooldown.failed(),{failures:3,delayMs:20000});
 now+=20000;
 assert.deepEqual(cooldown.failed(),{failures:4,delayMs:20000});
 cooldown.recovered();
 assert.equal(cooldown.canRun(),true);
 assert.deepEqual(cooldown.snapshot(),{failures:0,retryInMs:0});
 assert.deepEqual(cooldown.failed(),{failures:1,delayMs:5000});
});

test('worker cooldown rejects unsafe configuration',()=>{
 assert.throws(()=>createWorkerBackoff({baseMs:1}),/Invalid/);
 assert.throws(()=>createWorkerBackoff({baseMs:2000,maxMs:1000}),/Invalid/);
 assert.throws(()=>createWorkerBackoff({now:null}),/Invalid/);
});
