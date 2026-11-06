import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAdsPlan} from '../meta-ads-tools.mjs';
test('campaign plans reject invalid budgets, destinations and targeting',()=>{
 const valid={name:'Campaign',url:'https://example.test',headline:'Headline',message:'Description',pageId:'123456',imageHash:'image-hash',cityKey:'654321',cityName:'Sorocaba',dailyBudgetCents:2000};
 assert.equal(validateAdsPlan('create',valid).dailyBudgetCents,2000);
 for(const patch of [{url:'javascript:alert(1)'},{dailyBudgetCents:20},{dailyBudgetCents:2000.5},{pageId:'other'},{cityKey:''},{ageMin:12},{ageMin:60,ageMax:20}])assert.throws(()=>validateAdsPlan('create',{...valid,...patch}));
 assert.throws(()=>validateAdsPlan('delete',{entity:'campaign',id:'123456'}));
 assert.throws(()=>validateAdsPlan('budget',{entity:'campaign',id:'123456',dailyBudgetCents:2000}));
 assert.throws(()=>validateAdsPlan('status',{entity:'campaign',id:'123456',status:'DELETED'}));
});
