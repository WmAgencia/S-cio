import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDecision} from '../training-auto.mjs';

test('automatic training waits while any selected chat scan is unfinished',()=>{
 assert.equal(scanDecision(['queued'],1).state,'waiting');
 assert.equal(scanDecision(['importing'],1).state,'waiting');
 assert.equal(scanDecision(['paused'],1).state,'waiting');
 assert.equal(scanDecision(['completed'],2).state,'waiting');
});
test('automatic training never approves failed or cancelled scans',()=>{
 assert.deepEqual(scanDecision(['completed','failed'],2),{state:'failed',errorCode:'SCAN_INTERRUPTED'});
 assert.deepEqual(scanDecision(['cancelled'],1),{state:'failed',errorCode:'SCAN_INTERRUPTED'});
 assert.deepEqual(scanDecision(['unknown'],1),{state:'failed',errorCode:'SCAN_INVALID_STATE'});
});
test('automatic training only proceeds once every selected scan completed',()=>{
 assert.deepEqual(scanDecision(['completed','completed'],2),{state:'ready'});
});
