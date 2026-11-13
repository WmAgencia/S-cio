import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignDesign,planExplanation} from '../socio-campaign-design.mjs';

test('each stated objective becomes the right Meta objective and optimization',()=>{
 const wa=campaignDesign({destination:'whatsapp',dailyBudgetCents:600});
 assert.equal(wa.objective,'OUTCOME_ENGAGEMENT');
 assert.equal(wa.optimizationGoal,'CONVERSATIONS');
 assert.equal(wa.budgetMode,'adset');
 assert.match(wa.structureLabel,/ABO/);
 assert.match(wa.structureLabel,/CBO/);
 const site=campaignDesign({destination:'website',goal:'sales_site',dailyBudgetCents:600});
 assert.equal(site.objective,'OUTCOME_TRAFFIC');
 assert.equal(site.optimizationGoal,'LANDING_PAGE_VIEWS');
 const traffic=campaignDesign({destination:'website',goal:'traffic'});
 assert.equal(traffic.objective,'OUTCOME_TRAFFIC');
 assert.equal(traffic.optimizationGoal,'LINK_CLICKS');
 const aware=campaignDesign({destination:'website',goal:'awareness'});
 assert.equal(aware.objective,'OUTCOME_AWARENESS');
 assert.equal(aware.optimizationGoal,'REACH');
 assert.equal(campaignDesign({}),null,'without an objective or destination there is no strategy to build');
});

test('the plan explains objective, structure, audience, budget, ad and funnel',()=>{
 const brief={category:'sistema de gestão',destination:'whatsapp',countryCode:'BR',dailyBudgetCents:600,videoId:'123456789012345'};
 const text=planExplanation(brief,campaignDesign(brief));
 for(const part of [/Objetivo: Conversas no WhatsApp/,/Estrutura:/,/ABO/,/Público: todo o Brasil/,
  /Verba: R\$ 6,00 por dia/,/o vídeo que você enviou/,/Funil:/])assert.match(text,part);
});

test('the destination always wins over a goal that names another channel',()=>{
 assert.equal(campaignDesign({goal:'sales_whatsapp',destination:'website'}).optimizationGoal,'LANDING_PAGE_VIEWS');
 assert.equal(campaignDesign({goal:'sales_site',destination:'whatsapp'}).optimizationGoal,'CONVERSATIONS');
});
