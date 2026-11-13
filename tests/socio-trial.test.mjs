import test from 'node:test';
import assert from 'node:assert/strict';
import {
 TRIAL_DAYS,normalizeTaxId,validCpf,taxIdType,trialClaimDigest,trialClaims,claimTrial,trialEndFrom,readTrial
} from '../socio-trial.mjs';

const env={SOCIO_TRIAL_HASH_KEY:'test-trial-key-with-enough-length'};

test('validCpf accepts a real check-digit CPF and rejects tampering',()=>{
 assert.equal(validCpf('529.982.247-25'),true);
 assert.equal(validCpf('52998224724'),false);
 assert.equal(validCpf('111.111.111-11'),false);
 assert.equal(validCpf('5299822472'),false);
 assert.equal(validCpf(''),false);
});

test('taxIdType distinguishes CNPJ, CPF and garbage',()=>{
 assert.equal(taxIdType('11.222.333/0001-81'),'cnpj');
 assert.equal(taxIdType('529.982.247-25'),'cpf');
 assert.equal(taxIdType('123'),null);
 assert.equal(taxIdType(''),null);
 assert.equal(normalizeTaxId('11.222.333/0001-81'),'11222333000181');
});

test('claim digests are stable, keyed, and never contain the raw value',()=>{
 const a=trialClaimDigest('tax_id','52998224725',{env});
 const b=trialClaimDigest('tax_id','52998224725',{env});
 assert.equal(a,b);
 assert.match(a,/^[0-9a-f]{64}$/);
 assert.ok(!a.includes('52998224725'));
 assert.notEqual(a,trialClaimDigest('phone','52998224725',{env}));
 assert.notEqual(a,trialClaimDigest('tax_id','52998224725',{env:{SOCIO_TRIAL_HASH_KEY:'another-key-long-enough'}}));
});

test('trialClaims normalizes phone and e-mail and skips empties',()=>{
 const claims=trialClaims({taxId:'11.222.333/0001-81',phone:'+55 (11) 98888-7777',email:'  Dona@Loja.COM '},{env});
 assert.deepEqual(claims.map(c=>c.kind),['tax_id','phone','email']);
 assert.deepEqual(claims.map(c=>c.value),['11222333000181','5511988887777','dona@loja.com']);
 assert.deepEqual(trialClaims({},{env}),[]);
});

test('trialClaimSecret refuses to work without a key',()=>{
 assert.throws(()=>trialClaimDigest('email','a@b.co',{env:{}}),/configurado|SOCIO_TRIAL_HASH_KEY|teste/i);
});

function fakeClient(existing=new Set()){
 const written=[];
 return {written,async query(sql,params){
  if(!/INSERT INTO socio_trial_claims/i.test(sql))throw new Error('unexpected query '+sql);
  const key=params[0]+':'+params[1];
  if(existing.has(key))return {rowCount:0};
  existing.add(key);written.push(params);return {rowCount:1};
 }};
}

test('claimTrial grants once per identity and reports conflicts afterwards',async()=>{
 const existing=new Set(),client=fakeClient(existing);
 const first=await claimTrial(client,'tenant-a',{taxId:'11.222.333/0001-81',phone:'11988887777',email:'a@loja.com'},{env});
 assert.deepEqual(first,{granted:true,conflicts:[]});
 assert.equal(client.written.length,3);

 const second=await claimTrial(client,'tenant-b',{taxId:'11222333000181',phone:'21977776666',email:'b@loja.com'},{env});
 assert.equal(second.granted,false);
 assert.deepEqual(second.conflicts,['tax_id']);
 assert.equal(client.written.length,5,'only phone and e-mail claim rows are new');
});

test('claimTrial without identity grants the trial',async()=>{
 const client=fakeClient();
 const result=await claimTrial(client,'tenant-a',{},{env});
 assert.deepEqual(result,{granted:true,conflicts:[]});
});

test('trialEndFrom adds exactly the trial window',()=>{
 const now=new Date('2026-11-12T00:00:00Z');
 assert.equal(trialEndFrom(now).toISOString(),'2026-11-19T00:00:00.000Z');
 assert.equal(TRIAL_DAYS,7);
});

test('readTrial counts remaining days and expired trials',()=>{
 const now=new Date('2026-11-12T12:00:00Z');
 const live=readTrial({created_at:'2026-11-10T12:00:00Z',trial_ends_at:'2026-11-17T12:00:00Z'},now);
 assert.equal(live.calendarExpired,false);
 assert.equal(live.daysRemaining,5);
 assert.equal(live.granted,true);
 const expired=readTrial({created_at:'2026-11-01T00:00:00Z',trial_ends_at:'2026-11-08T00:00:00Z'},now);
 assert.equal(expired.calendarExpired,true);
 assert.equal(expired.daysRemaining,0);
 assert.equal(expired.granted,false);
});

test('readTrial falls back to created_at when trial_ends_at is missing',()=>{
 const now=new Date('2026-11-12T00:00:00Z');
 const trial=readTrial({created_at:'2026-11-10T00:00:00Z'},now);
 assert.equal(trial.endsAt,'2026-11-17T00:00:00.000Z');
 assert.equal(trial.daysRemaining,5);
 assert.equal(trial.granted,true);
});
