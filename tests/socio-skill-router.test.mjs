import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {speakToSocioSkill,formatSkillRead} from '../socio-skill-router.mjs';
const tenant=randomUUID(),user=randomUUID();
const actor={active_tenant_id:tenant,user_id:user,role:'owner',
 tenant_status:'active',features:{meta_ads:true,ai:true,whatsapp:true,catalog:true,quotes:true,team:true}};
const meta={id:'act_1234567890',currency:'BRL',name:'Loja Teste'};
function fake(){
 const runs=new Map();let queries=0;
 return {runs,query:async(sql,args=[])=>{
  queries++;
  if(sql.startsWith('INSERT INTO socio_skill_runs')){
   const [id,t,u,accountId,status,brief,planId,origin]=args;
   assert.equal(t,tenant);assert.equal(u,user);
   const row={id,tenant_id:t,user_id:u,account_id:accountId,
    skill:'ads.meta.command',status,brief:JSON.parse(brief),plan_id:planId,origin_conversation_id:origin,result:null};
   runs.set(id,row);return {rowCount:1};
  }
  if(sql.startsWith('SELECT * FROM socio_skill_runs')){
   const row=runs.get(args[0]);return {rowCount:row&&args[1]===tenant&&args[2]===user?1:0,
    rows:row&&args[1]===tenant&&args[2]===user?[{...row}]:[]};
  }
  if(sql.startsWith('UPDATE socio_skill_runs SET brief=$2::jsonb')){
   const row=runs.get(args[0]);row.brief=JSON.parse(args[1]);row.plan_id=args[2];row.status='ready';return {rowCount:1};
  }
  if(sql.startsWith("UPDATE socio_skill_runs SET status='executing'")){
   const row=runs.get(args[0]);if(!row||row.status!=='ready')return{rowCount:0,rows:[]};
   row.status='executing';return {rowCount:1,rows:[{...row}]};
  }
  if(sql.startsWith("UPDATE socio_skill_runs SET status=$2,result=$3")){
   const row=runs.get(args[0]);row.status=args[1];row.result=JSON.parse(args[2]);return{rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,80));
 },get count(){return queries;}};
}
test('single Socio skill router lists Meta Pixels and reports without any write',async()=>{
 const pool=fake(),preview=async(p,a,message)=>{
  assert.equal(a.active_tenant_id,tenant);
  return {data:message.includes('pixels')?{items:[{id:'123456789',name:'Pixel Principal'}]}:
   {summary:{currency:'BRL',spend:12.5,clicks:5,impressions:130,ctrPercent:3.85},items:[]}};
 };
 const opts={preview};
 const pixels=await speakToSocioSkill(pool,actor,{message:'Quais pixels tenho na conta?'},opts);
 assert.equal(pixels.status,'completed');
 assert.match(pixels.message,/Pixel Principal/);
 assert.match(pixels.message,/123456789/);
 const report=await speakToSocioSkill(pool,actor,{message:'Mostre o relatório de anúncios dos últimos 7 dias'},opts);
 assert.match(report.message,/BRL 12.50/);
 assert.match(report.message,/Cliques não são conversas/);
 assert.equal(pool.count,0,'No plan is inserted for read-only consultations');
});
test('Pixel name collected conversationally; confirmation needed; duplicate execution refused',async()=>{
 const pool=fake(),calls=[];
 const opts={resolve:async()=>meta,
  prepare:async(_p,_a,kind,input)=>{calls.push({kind,input,stage:'prepare'});return{id:randomUUID()};},
  execute:async(_p,_a,id,approved)=>{calls.push({id,approved,stage:'execute'});
   return {status:'succeeded',result:{pixelId:'99887766'}};}};
 const asked=await speakToSocioSkill(pool,actor,{message:'Crie um pixel'},opts);
 assert.equal(asked.status,'collecting');
 assert.match(asked.message,/Qual nome/);
 assert.equal(calls.length,0);
 const named=await speakToSocioSkill(pool,actor,{message:'Pixel Loja do Bairro',runId:asked.runId},opts);
 assert.equal(named.status,'ready');
 assert.equal(calls.length,1);
 assert.equal(calls[0].kind,'create_pixel');assert.equal(calls[0].input.name,'Pixel Loja do Bairro');
 const wait=await speakToSocioSkill(pool,actor,{message:'Espere',runId:asked.runId},opts);
 assert.equal(wait.status,'ready');assert.equal(calls.length,1);
 const executed=await speakToSocioSkill(pool,actor,{message:'pode criar',runId:asked.runId},opts);
 assert.equal(executed.status,'completed');
 assert.match(executed.message,/99887766/);
 assert.equal(calls.length,2);
 const replay=await speakToSocioSkill(pool,actor,{message:'pode criar',runId:asked.runId},opts);
 assert.equal(replay.status,'completed');assert.equal(calls.length,2);
});
test('manager approves exact spending change with target ID, currency and daily budget visible',async()=>{
 const pool=fake(),plans=[];
 const opts={preview:async(_p,_a,message)=>{
  const budget=message.includes('orçamento');
  return {plan:{id:randomUUID(),summary:{
   account:meta,object:{id:'123456789',name:'Anúncio de teste'},
   changes:budget?{entity:'adset',id:'123456789',dailyBudgetCents:600}:
    {entity:'ad',id:'123456789',status:'ACTIVE'},
   description:'Operação supervisionada'
  }}};
 }};
 const activation=await speakToSocioSkill(pool,actor,{message:'Ative o anúncio ID 123456789'},opts);
 assert.equal(activation.status,'ready');
 assert.match(activation.message,/123456789/);
 assert.match(activation.message,/ACTIVE/);
 assert.match(activation.message,/pode gerar gastos/);
 const budget=await speakToSocioSkill(pool,actor,{message:'Altere o orçamento do conjunto ID 123456789 para R$ 6 por dia'},opts);
 assert.equal(budget.status,'ready');
 assert.match(budget.message,/6.00 BRL/);
 assert.equal(plans.length,0);
});
test('"ok, pode criar" authorizes, and a failed command explains itself instead of looking already done',async()=>{
 const pool=fake(),calls=[];
 const opts={resolve:async()=>meta,
  prepare:async(_p,_a,kind,input)=>{calls.push({kind,input});return{id:randomUUID()};},
  execute:async()=>{calls.push({stage:'execute'});
   return {status:'failed',error:'A Meta recusou a operação: orçamento abaixo do mínimo.'};}};
 const asked=await speakToSocioSkill(pool,actor,{message:'Crie um pixel'},opts);
 await speakToSocioSkill(pool,actor,{message:'Pixel Loja do Bairro',runId:asked.runId},opts);
 const executed=await speakToSocioSkill(pool,actor,{message:'ok, pode criar',runId:asked.runId},opts);
 assert.equal(executed.status,'failed');
 assert.equal(calls.length,2,'the spoken confirmation must reach Meta');
 const why=await speakToSocioSkill(pool,actor,{message:'o que aconteceu?',runId:asked.runId},opts);
 assert.equal(why.status,'failed');
 assert.match(why.message,/orçamento abaixo do mínimo/,'the owner hears the real reason');
 assert.match(why.message,/Envie o pedido novamente/);
});
test('pixel in WhatsApp is never presented as an actual tracking implementation',async()=>{
 const p=fake();
 const reply=await speakToSocioSkill(p,actor,{message:'Instalar pixel no WhatsApp'}, {});
 assert.match(reply.message,/não existe Pixel|Não existe Pixel/);
 assert.match(reply.message,/WA-AKG/);
 assert.equal(p.count,0);
});
test('owner agent permissions remain enforced in the unified chat',async()=>{
 const p=fake();
 await assert.rejects(speakToSocioSkill(p,{...actor,role:'agent'},
  {message:'Crie um Pixel chamado Minha Loja'}),e=>e.status===403);
});
