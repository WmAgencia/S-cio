import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/trial-input.js';

const {taxIdDigits,cpfIsValid}=globalThis.SocioTrialInput;

test('taxIdDigits keeps only digits',()=>{
 assert.equal(taxIdDigits('11.222.333/0001-81'),'11222333000181');
 assert.equal(taxIdDigits(' 529.982.247-25 '),'52998224725');
 assert.equal(taxIdDigits(undefined),'');
 assert.equal(taxIdDigits(null),'');
});

test('cpfIsValid mirrors the server-side check-digit rule',()=>{
 assert.equal(cpfIsValid('529.982.247-25'),true);
 assert.equal(cpfIsValid('52998224725'),true);
 assert.equal(cpfIsValid('52998224724'),false);
 assert.equal(cpfIsValid('111.111.111-11'),false);
 assert.equal(cpfIsValid('5299822472'),false);
 assert.equal(cpfIsValid('11222333000181'),false);
});

test('helpers are frozen on the global',()=>{
 assert.ok(Object.isFrozen(globalThis.SocioTrialInput));
});
