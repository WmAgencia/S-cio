import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMetaAccountFinance} from '../meta-ads-tools.mjs';

test('Meta prepaid stored balance is distinguished from amount due and spend cap',()=>{
 const result=normalizeMetaAccountFinance({
  currency:'BRL',is_prepay_account:true,account_status:1,
  amount_spent:'4500',spend_cap:'40000',balance:'8000',
  funding_source_details:{type:20,amount:'30560',original_amount:'50000'}
 });
 assert.equal(result.isPrepaid,true);
 assert.equal(result.availableFundsMinor,30560);
 assert.equal(result.availableFundsSource,'meta_stored_balance');
 assert.equal(result.spendCapRemainingMinor,35500);
 assert.equal(result.amountDueMinor,8000);
 assert.notEqual(result.availableFundsMinor,result.amountDueMinor);
});
test('postpaid accounts do not report invoice balance as available prepaid funds',()=>{
 const result=normalizeMetaAccountFinance({
  currency:'BRL',is_prepay_account:false,balance:'10000',spend_cap:'0',
  funding_source_details:{type:1,amount:'10000'}
 });
 assert.equal(result.availableFundsMinor,null);
 assert.equal(result.amountDueMinor,10000);
 assert.equal(result.spendCapRemainingMinor,null);
});
test('unverified, ambiguous, or non-stored funding is never shown as wallet money',()=>{
 for(const sources of [
  null,{type:1,amount:'20000'},{type:20,original_amount:'20000'},
  [{type:20,amount:'100'},{type:20,amount:'200'}],
  {type:20,amount:'not-money'}
 ])assert.equal(normalizeMetaAccountFinance({
  currency:'BRL',is_prepay_account:true,funding_source_details:sources
 }).availableFundsMinor,null);
});
test('payment link opens official Meta billing, never claims a Pix was generated',()=>{
 const source=readFileSync(new URL('../meta-ads-tools.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
 assert.match(source,/https:\/\/adsmanager\.facebook\.com\/billing_hub\/payment_settings\//);
 assert.match(source,/paymentLinkType:'meta_billing_settings',pixCodeAvailable:false/);
 assert.match(ui,/url\.hostname==='adsmanager\.facebook\.com'/);
 assert.match(ui,/Abrir recarga na Meta/);
 assert.doesNotMatch(ui,/Pix gerado|QR Pix gerado/);
});
