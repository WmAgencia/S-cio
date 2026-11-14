import test from 'node:test';
import assert from 'node:assert/strict';
import {
 RESULT_TYPES,RESULT_LABELS,resultCounts,pickResultKind,costPerResultCents
} from '../socio-result-metrics.mjs';

const actions=(...pairs)=>pairs.map(([action_type,value])=>({action_type,value}));

test('The strongest result wins when a row reports more than one kind',()=>{
 const row=resultCounts({actions:actions(
  ['onsite_conversion.messaging_conversation_started_7d','4'],
  ['purchase','2'])});
 assert.deepEqual(row,{purchase:2,conversation:4,lead:0,kind:'purchase',events:2});
});

test('Every alias of a result type is recognised',()=>{
 assert.equal(resultCounts({actions:actions(['omni_purchase','1'])}).purchase,1);
 assert.equal(resultCounts({actions:actions(['offsite_conversion.fb_pixel_purchase','1'])}).purchase,1);
 assert.equal(resultCounts({actions:actions(['onsite_conversion.total_messaging_connection','1'])})
  .conversation,1);
 assert.equal(resultCounts({actions:actions(['onsite_conversion.lead_grouped','1'])}).lead,1);
 assert.equal(resultCounts({actions:actions(['offsite_conversion.fb_pixel_lead','1'])}).lead,1);
});

test('A missing, invalid or negative count never invents a result',()=>{
 const empty=resultCounts({});
 assert.deepEqual(empty,{purchase:0,conversation:0,lead:0,kind:null,events:0});
 assert.equal(resultCounts({actions:actions(['purchase','abc'])}).events,0);
 assert.equal(resultCounts({actions:actions(['purchase','-2'])}).events,0);
 assert.equal(resultCounts({actions:null}).kind,null);
});

test('The ladder is purchase over conversation over lead',()=>{
 assert.equal(pickResultKind({purchase:1}),'purchase');
 assert.equal(pickResultKind({conversation:1,lead:5}),'conversation');
 assert.equal(pickResultKind({lead:1}),'lead');
 assert.equal(pickResultKind({}),null);
 assert.deepEqual(RESULT_TYPES.purchase,['purchase','omni_purchase',
  'offsite_conversion.fb_pixel_purchase']);
 assert.deepEqual(RESULT_LABELS,{purchase:'Venda',conversation:'Conversa iniciada',lead:'Lead'});
});

test('Cost per result is rounded in cents and refuses a zero denominator',()=>{
 assert.equal(costPerResultCents(1000,3),333);
 assert.equal(costPerResultCents(1200,3),400);
 assert.equal(costPerResultCents(0,3),0);
 assert.equal(costPerResultCents(1000,0),null);
 assert.equal(costPerResultCents(null,3),null);
 assert.equal(costPerResultCents(undefined,3),null);
 assert.equal(costPerResultCents('',3),null);
 assert.equal(costPerResultCents(-100,3),null);
 assert.equal(costPerResultCents(1000,'3'),333);
});
