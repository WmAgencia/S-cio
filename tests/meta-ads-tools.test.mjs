import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAdsPlan,campaignStructurePayloads,whatsappWelcomeMessage} from '../meta-ads-tools.mjs';
test('campaign plans reject invalid budgets, destinations and targeting',()=>{
 const valid={name:'Campaign',url:'https://example.test',headline:'Headline',message:'Description',pageId:'123456',imageHash:'image-hash',cityKey:'654321',cityName:'Sorocaba',dailyBudgetCents:2000};
 assert.equal(validateAdsPlan('create',valid).dailyBudgetCents,2000);
 for(const patch of [{url:'javascript:alert(1)'},{dailyBudgetCents:20},{dailyBudgetCents:2000.5},{pageId:'other'},{cityKey:''},{ageMin:12},{ageMin:60,ageMax:20}])assert.throws(()=>validateAdsPlan('create',{...valid,...patch}));
 const wa={...valid,whatsappPhone:'5515999999999'};delete wa.url;
 assert.equal(validateAdsPlan('create_whatsapp',wa).whatsappPhone,'5515999999999');
 assert.throws(()=>validateAdsPlan('create_whatsapp',{...wa,whatsappPhone:'551599'}));
 assert.equal(validateAdsPlan('create_pixel',{name:'Pixel empresa Sorocaba'}).name,'Pixel empresa Sorocaba');
 assert.throws(()=>validateAdsPlan('create_pixel',{name:'x'}),{status:422});
 assert.throws(()=>validateAdsPlan('create_pixel',{name:42}),{status:422});
 assert.equal(validateAdsPlan('create_ad',{...valid,adsetId:'222222'}).adsetId,'222222');
 assert.throws(()=>validateAdsPlan('create_ad',{...valid,adsetId:'xyz'}));
 assert.throws(()=>validateAdsPlan('delete',{entity:'campaign',id:'123456'}));
 assert.equal(validateAdsPlan('budget',{entity:'campaign',id:'123456',dailyBudgetCents:2000}).entity,'campaign');
 assert.throws(()=>validateAdsPlan('budget',{entity:'ad',id:'123456',dailyBudgetCents:2000}));
 assert.throws(()=>validateAdsPlan('status',{entity:'campaign',id:'123456',status:'DELETED'}));
});
test('campaign plans reject an optimization goal that does not belong to the objective',()=>{
 const valid={name:'Campaign',url:'https://example.test',headline:'Headline',message:'Description',pageId:'123456',imageHash:'image-hash',cityKey:'654321',cityName:'Sorocaba',dailyBudgetCents:2000};
 assert.throws(()=>validateAdsPlan('create',{...valid,objective:'OUTCOME_AWARENESS',optimizationGoal:'LINK_CLICKS'}),{status:422});
 assert.throws(()=>validateAdsPlan('create',{...valid,objective:'OUTCOME_UNKNOWN'}),{status:422});
 assert.throws(()=>validateAdsPlan('create',{...valid,budgetMode:'lifetime'}),{status:422});
 assert.equal(validateAdsPlan('create',{...valid,optimizationGoal:'LANDING_PAGE_VIEWS'}).optimizationGoal,'LANDING_PAGE_VIEWS');
 const wa={...valid,whatsappPhone:'5515999999999'};delete wa.url;
 assert.throws(()=>validateAdsPlan('create_whatsapp',{...wa,objective:'OUTCOME_TRAFFIC'}),{status:422});
});
test('campaign structure places the budget at the level the strategy chose',()=>{
 const wa=campaignStructurePayloads({name:'Campanha',pageId:'123',whatsappPhone:'5515999999999',
  cityKey:'654321',ageMin:18,ageMax:65,dailyBudgetCents:2000});
 assert.equal(wa.campaign.objective,'OUTCOME_ENGAGEMENT');
 assert.equal(wa.campaign.status,'PAUSED');
 assert.equal(wa.campaign.daily_budget,undefined);
 assert.equal(wa.adset.optimization_goal,'CONVERSATIONS');
 assert.equal(wa.adset.daily_budget,2000);
 assert.equal(wa.adset.destination_type,'WHATSAPP');
 assert.deepEqual(wa.adset.promoted_object,{page_id:'123',whatsapp_phone_number:'5515999999999'});
 assert.equal(wa.adset.campaign_id,null);
 const cbo=campaignStructurePayloads({name:'Campanha',pageId:'123',countryCode:'BR',ageMin:18,ageMax:65,
  dailyBudgetCents:2000,objective:'OUTCOME_AWARENESS',optimizationGoal:'REACH',budgetMode:'campaign'},'987');
 assert.equal(cbo.campaign.objective,'OUTCOME_AWARENESS');
 assert.equal(cbo.campaign.daily_budget,2000);
 assert.equal(cbo.campaign.is_adset_budget_sharing_enabled,undefined);
 assert.equal(cbo.adset.campaign_id,'987');
 assert.equal(cbo.adset.daily_budget,undefined);
 assert.equal(cbo.adset.destination_type,undefined);
 assert.equal(cbo.adset.optimization_goal,'REACH');
});
test('the Conversas greeting and the ready message are configured on the creative',()=>{
 const valid={name:'Campanha',headline:'Headline',message:'Description',pageId:'123456',imageHash:'image-hash',cityKey:'654321',cityName:'Sorocaba',dailyBudgetCents:2000,whatsappPhone:'5515999999999'};
 const plan=validateAdsPlan('create_whatsapp',{...valid,welcomeMessage:'Oi! Como podemos ajudar?',quickReply:'Quero saber mais.'});
 assert.equal(plan.welcomeMessage,'Oi! Como podemos ajudar?');
 assert.equal(plan.quickReply,'Quero saber mais.');
 assert.equal(validateAdsPlan('create_whatsapp',{...valid,welcomeMessage:'x'.repeat(400)}).welcomeMessage,undefined,'an oversized greeting is left out instead of cutting the sentence');
 const payload=JSON.parse(whatsappWelcomeMessage('Oi! Como podemos ajudar?','Quero saber mais.'));
 assert.equal(payload.landing_screen_type,'welcome_message');
 assert.equal(payload.text_format.customer_action_type,'autofill_message');
 assert.equal(payload.text_format.message.text,'Oi! Como podemos ajudar?');
 assert.equal(payload.text_format.message.autofill_message.content,'Quero saber mais.');
 const greetingOnly=JSON.parse(whatsappWelcomeMessage('Oi! Como podemos ajudar?'));
 assert.equal(greetingOnly.text_format.customer_action_type,undefined);
 assert.equal(greetingOnly.text_format.message.autofill_message,undefined);
 assert.equal(whatsappWelcomeMessage(''),null,'a site ad or a plan without the greeting carries no welcome message');
});
