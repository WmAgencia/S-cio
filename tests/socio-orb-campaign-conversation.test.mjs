import test from 'node:test';
import assert from 'node:assert/strict';
import {askThalita} from '../socio-thalita-assistant.mjs';

const tenant='11111111-1111-4111-8111-111111111111';
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor=()=>({role:'owner',platform_owner:false,active_tenant_id:tenant,tenant_status:'active',
 user_id:'44444444-4444-4444-8444-444444444444',token_hash:'session-test',tenant_name:'Casa da Moda',
 features:{ai:true,whatsapp:true,catalog:true,quotes:true,meta_ads:true,team:true}});
const pool={query:async()=>{throw Error('Unexpected SQL');}};

test('a spoken order to build a campaign reaches the ad skill with the attached photo',async()=>{
 const seen=[];
 const result=await askThalita(pool,actor(),{message:'Quero que você faça uma campanha pra esse anúncio aqui',
  imageHash:'abc12345def'},{marketing:async(_pool,_auth,request)=>{
   seen.push(request);
   return {skillId:'ads.campaign.launch',runId:run,status:'collecting',brief:{category:'moda feminina',hasPhoto:true},
    message:'Em qual cidade você quer encontrar clientes?'};
  }});
 assert.equal(seen.length,1,'the order must reach the campaign skill, not a generic answer');
 assert.equal(seen[0].imageHash,'abc12345def');
 assert.equal(result.plan.title,'Planejando a campanha');
 assert.equal(result.plan.steps.at(-1).status,'waiting');
 assert.match(result.plan.steps.at(-1).detail,/cidade/i);
});

test('short answers and "pode criar" stay inside the open campaign conversation',async()=>{
 const seen=[];
 const result=await askThalita(pool,actor(),{message:'pode criar',runId:run},
  {marketing:async(_pool,_auth,request)=>{
   seen.push(request);
   return {skillId:'ads.campaign.launch',runId:request.runId,status:'completed',
    brief:{category:'moda feminina',cityName:'Sorocaba',dailyBudgetCents:600,hasPhoto:true},
    result:{result:{campaignId:'120210000001',adsetId:'120210000002',adId:'120210000003'}},
    message:'A Meta confirmou a criação. Campanha, conjunto e anúncio foram criados PAUSADOS.'};
  }});
 assert.equal(seen[0].runId,run);
 assert.equal(result.plan.title,'Campanha criada');
 assert.match(result.plan.steps.map(s=>s.title+' '+s.detail).join(' '),/PAUSAD/i);
 assert.match(result.plan.steps.at(-1).detail,/ativar/i);
});

test('asking how to create a campaign stays advice and never calls the skill',async()=>{
 const result=await askThalita(pool,actor(),{message:'Como eu crio uma campanha no gerenciador?'},
  {chat:async()=>({reply:'Você pode começar pelo objetivo de alcance.'}),
   marketing:async()=>{throw Error('must not create a campaign');}});
 assert.equal(result.status,'completed');
 assert.equal(result.plan.title,'Resposta preparada');
});

test('a campaign reply only keeps a run id while the skill still needs the user',async()=>{
 const result=await askThalita(pool,actor(),{message:'Faça uma campanha pra divulgar minhas roupas'},
  {marketing:async()=>({skillId:'ads.campaign.launch',runId:run,status:'ready',
   brief:{category:'moda feminina',cityName:'Sorocaba',dailyBudgetCents:600,hasPhoto:true},
   message:'Responda pode criar para eu criar a campanha PAUSADA.'})});
 assert.equal(result.plan.title,'Campanha pronta para aprovar');
 assert.equal(result.plan.steps.at(-1).status,'waiting');
});
