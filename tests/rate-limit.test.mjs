import test from 'node:test';
import assert from 'node:assert/strict';
import {createLimiter} from '../lib.mjs';

function fakeDb(){
 const rows=new Map();
 let calls=0;
 const query=async(sql,params)=>{
  calls++;
  const [bucket,key,windowStart]=params;
  const id=bucket+'|'+key+'|'+windowStart.toISOString();
  const count=(rows.get(id)||0)+1;
  rows.set(id,count);
  return {rows:[{count:String(count)}]};
 };
 return {query,rows,calls:()=>calls};
}

test('shared limiter enforces the limit from the database count',async()=>{
 const db=fakeDb(),limiter=createLimiter(db.query);
 assert.equal(await limiter('auth','login:1.2.3.4',60000,3),true);
 assert.equal(await limiter('auth','login:1.2.3.4',60000,3),true);
 assert.equal(await limiter('auth','login:1.2.3.4',60000,3),true);
 assert.equal(await limiter('auth','login:1.2.3.4',60000,3),false);
});

test('two instances share one bucket, as two replicas would',async()=>{
 const db=fakeDb();
 const replicaA=createLimiter(db.query),replicaB=createLimiter(db.query);
 assert.equal(await replicaA('auth','setup:9.9.9.9',600000,2),true);
 assert.equal(await replicaB('auth','setup:9.9.9.9',600000,2),true);
 // The local map of replica B knows only one attempt, but the database does
 // not — this is exactly the gap a deploy used to open.
 assert.equal(await replicaB('auth','setup:9.9.9.9',600000,2),false);
});

test('buckets and keys never bleed into each other',async()=>{
 const db=fakeDb(),limiter=createLimiter(db.query);
 assert.equal(await limiter('sim','media:t1',60000,1),true);
 assert.equal(await limiter('sim','media:t1',60000,1),false);
 assert.equal(await limiter('sim','media:t2',60000,1),true);
 assert.equal(await limiter('auth','media:t1',60000,1),true);
});

test('a database outage falls back to the local flood gate',async()=>{
 let calls=0;
 const limiter=createLimiter(async()=>{calls++;throw new Error('db down');});
 const allowed=[];
 for(let i=0;i<13;i++)allowed.push(await limiter('auth','login:outage',60000,3));
 assert.equal(allowed.slice(0,12).every(Boolean),true,'the local gate allows four times the limit');
 assert.equal(allowed[12],false,'and then stops issuing');
 assert.equal(calls,12,'the rejected attempt never reaches the database');
});
